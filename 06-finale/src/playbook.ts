// Playbooks: the whole job lives in config. Load one, check it, fail fast if it is malformed. License: MIT.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "./harness.js";

/** Inbox item ids name output files, so they are restricted to a safe file-name alphabet. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type Decision = "allow" | "ask" | "deny";
export interface ToolCall { tool: string; args?: Record<string, string>; why?: string }

export interface Playbook {
  name: string;
  title: string;
  description: string;
  inbox: string; // JSONL file, relative to the playbook folder
  triage: {
    labels: Record<string, string[]>; // label -> keywords (the stand-in classifier uses these)
    routes: Record<string, string>; // label -> queue or seat
    urgent_terms: string[];
    always_human_labels: string[];
    always_human?: boolean;
    always_human_terms?: string[]; // text terms that always get a person, whatever the label
    review_below?: number;
  };
  rag: { docs: string; default_groups: string[]; min_score?: number; mode: "answer" | "draft" };
  harness: { policy: Record<string, Decision> }; // tool -> decision; anything not listed is denied
  actions: Record<string, ToolCall[]>; // triage label -> the calls the system proposes
  interviewer?: { labels: string[]; rubric: string; tasks: string; seat_note: string };
  /** Optional interview scheduling: which labels get slots proposed, and the calendars fixture. */
  scheduler?: { labels: string[]; calendars: string; proposals?: number };
  /** Folder the playbook was loaded from (set by the loader). */
  dir: string;
}

export class PlaybookError extends Error {
  constructor(public file: string, public problems: string[]) {
    super(`Playbook ${file} is malformed:\n  - ${problems.join("\n  - ")}`);
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
const DECISIONS = ["allow", "ask", "deny"];

/** Every problem at once, so a broken playbook is fixed in one pass. Returns [] when valid. */
export function checkPlaybook(raw: unknown, dir: string): string[] {
  const p: string[] = [];
  if (!isObj(raw)) return ["top level must be a JSON object"];
  for (const k of ["name", "title", "description", "inbox"]) if (typeof raw[k] !== "string" || !raw[k]) p.push(`"${k}" must be a non-empty string`);
  const outside = (v: unknown) => {
    if (typeof v !== "string") return false;
    const target = resolve(dir, v);
    try {
      const rel = relative(realpathSync(dir), realpathSync(target));
      return rel.startsWith("..") || isAbsolute(rel);
    } catch {
      const rel = relative(dir, target);
      return rel.startsWith("..") || isAbsolute(rel);
    }
  };
  const paths: [string, unknown][] = [["inbox", raw.inbox], ["rag.docs", isObj(raw.rag) ? raw.rag.docs : undefined],
    ["interviewer.rubric", isObj(raw.interviewer) ? raw.interviewer.rubric : undefined], ["interviewer.tasks", isObj(raw.interviewer) ? raw.interviewer.tasks : undefined],
    ["scheduler.calendars", isObj(raw.scheduler) ? raw.scheduler.calendars : undefined]];
  for (const [k, v] of paths) if (outside(v)) p.push(`"${k}" must be inside the playbook folder`);
  if (p.length) return p; // never read files outside the playbook folder, so stop here
  if (typeof raw.inbox === "string" && !outside(raw.inbox)) {
    if (!existsSync(join(dir, raw.inbox))) p.push(`inbox file "${raw.inbox}" not found`);
    else readFileSync(join(dir, raw.inbox), "utf8").split("\n").forEach((l, n) => {
      if (!l.trim()) return;
      let item: unknown;
      try { item = JSON.parse(l); } catch { p.push(`inbox line ${n + 1} is not valid JSON`); return; }
      if (!isObj(item) || typeof item.id !== "string" || !ITEM_ID.test(item.id)) p.push(`inbox line ${n + 1}: "id" must be letters, digits, . _ or -`);
      else if (typeof item.attachment === "string" && outside(item.attachment)) p.push(`inbox line ${n + 1}: attachment must be inside the playbook folder`);
    });
  }

  const t = raw.triage;
  let labels: string[] = [];
  if (!isObj(t)) p.push(`"triage" must be an object`);
  else {
    if (!isObj(t.labels) || Object.keys(t.labels).length < 2) p.push(`"triage.labels" needs at least 2 labels`);
    else {
      labels = Object.keys(t.labels);
      for (const [l, kws] of Object.entries(t.labels)) if (!isStrArr(kws) || kws.length === 0) p.push(`triage label "${l}" needs a non-empty list of keywords`);
    }
    if (!isObj(t.routes)) p.push(`"triage.routes" must be an object`);
    else {
      for (const l of labels) if (typeof t.routes[l] !== "string") p.push(`triage label "${l}" has no route`);
      for (const l of Object.keys(t.routes)) if (!labels.includes(l)) p.push(`route "${l}" is not a triage label`);
    }
    if (!isStrArr(t.urgent_terms)) p.push(`"triage.urgent_terms" must be a list of strings`);
    if (!isStrArr(t.always_human_labels)) p.push(`"triage.always_human_labels" must be a list of strings`);
    else for (const l of t.always_human_labels) if (!labels.includes(l)) p.push(`always_human_labels has unknown label "${l}"`);
    if (t.always_human_terms !== undefined && !isStrArr(t.always_human_terms)) p.push(`"triage.always_human_terms" must be a list of strings`);
    if (t.review_below !== undefined && (typeof t.review_below !== "number" || t.review_below < 0 || t.review_below > 1)) p.push(`"triage.review_below" must be a number from 0 to 1`);
  }

  const r = raw.rag;
  if (!isObj(r)) p.push(`"rag" must be an object`);
  else {
    if (typeof r.docs !== "string") p.push(`"rag.docs" must be a folder path`);
    else if (!existsSync(join(dir, r.docs)) || !statSync(join(dir, r.docs)).isDirectory()) p.push(`rag docs folder "${r.docs}" not found`);
    else if (!readdirSync(join(dir, r.docs)).some((f) => f.endsWith(".md"))) p.push(`rag docs folder "${r.docs}" has no .md files`);
    if (!isStrArr(r.default_groups) || r.default_groups.length === 0) p.push(`"rag.default_groups" must be a non-empty list`);
    if (r.mode !== "answer" && r.mode !== "draft") p.push(`"rag.mode" must be "answer" or "draft"`);
  }

  const h = raw.harness;
  const policy = isObj(h) && isObj(h.policy) ? h.policy : null;
  if (!policy) p.push(`"harness.policy" must be an object of tool -> allow|ask|deny`);
  else for (const [tool, d] of Object.entries(policy)) {
    const def = TOOLS[tool];
    if (!def) p.push(`harness.policy names unknown tool "${tool}"`);
    if (typeof d !== "string" || !DECISIONS.includes(d)) { p.push(`harness.policy "${tool}" must be allow, ask or deny`); continue; }
    // Hard floor: a playbook can tighten these, never loosen them.
    if (def && def.risk !== "read" && def.risk !== "write" && d === "allow") p.push(`tool "${tool}" is ${def.risk}; it can be "ask" or "deny", never "allow"`);
  }

  if (!isObj(raw.actions)) p.push(`"actions" must be an object of triage label -> tool calls`);
  else for (const [l, calls] of Object.entries(raw.actions)) {
    if (!labels.includes(l)) p.push(`actions has unknown triage label "${l}"`);
    if (!Array.isArray(calls)) { p.push(`actions "${l}" must be a list`); continue; }
    for (const c of calls) if (!isObj(c) || typeof c.tool !== "string") p.push(`actions "${l}" has a call without a "tool"`);
      else if (policy && !(c.tool in policy)) p.push(`actions "${l}" proposes "${c.tool}", which harness.policy does not mention (it would always be denied; list it as "deny" if that is the point)`);
  }

  const iv = raw.interviewer;
  if (iv !== undefined) {
    if (!isObj(iv)) p.push(`"interviewer" must be an object`);
    else {
      if (!isStrArr(iv.labels)) p.push(`"interviewer.labels" must be a list`);
      else for (const l of iv.labels) if (!labels.includes(l)) p.push(`interviewer label "${l}" is not a triage label`);
      if (typeof iv.seat_note !== "string") p.push(`"interviewer.seat_note" must be a string`);
      for (const k of ["rubric", "tasks"]) if (typeof iv[k] !== "string" || !existsSync(join(dir, iv[k]))) p.push(`interviewer ${k} file not found`);
      if (typeof iv.rubric === "string" && typeof iv.tasks === "string" && existsSync(join(dir, iv.rubric)) && existsSync(join(dir, iv.tasks))) {
        try {
          const rub = JSON.parse(readFileSync(join(dir, iv.rubric), "utf8")) as { criteria?: { id: string; taskId: string; signals?: unknown[] }[]; appliesTo?: string[] };
          const tasks = JSON.parse(readFileSync(join(dir, iv.tasks), "utf8")) as { id: string; criterion: string; prompt?: string; standin?: unknown }[];
          if (!Array.isArray(tasks) || tasks.length < 3 || tasks.length > 5) p.push(`interviewer tasks: use 3 to 5 tasks`);
          if (!Array.isArray(rub.criteria) || !rub.criteria.length) p.push(`interviewer rubric has no criteria`);
          else for (const c of rub.criteria) {
            if (!tasks.some((t) => t.id === c.taskId && t.criterion === c.id)) p.push(`rubric criterion "${c.id}" has no matching task`);
            if (!Array.isArray(c.signals) || c.signals.length < 2) p.push(`rubric criterion "${c.id}" needs at least 2 signals`);
          }
          if (!isStrArr(rub.appliesTo) || !rub.appliesTo.length) p.push(`interviewer rubric needs "appliesTo"`);
        } catch (e) { p.push(`interviewer rubric/tasks is not valid JSON (${(e as Error).message})`); }
      }
    }
  }
  const sc = raw.scheduler;
  if (sc !== undefined) {
    if (!isObj(sc)) p.push(`"scheduler" must be an object`);
    else {
      if (!isStrArr(sc.labels) || !sc.labels.length) p.push(`"scheduler.labels" must be a non-empty list`);
      else for (const l of sc.labels) if (!labels.includes(l)) p.push(`scheduler label "${l}" is not a triage label`);
      if (sc.proposals !== undefined && (typeof sc.proposals !== "number" || sc.proposals < 1 || sc.proposals > 5)) p.push(`"scheduler.proposals" must be 1 to 5`);
      if (typeof sc.calendars !== "string" || !existsSync(join(dir, sc.calendars))) p.push(`scheduler calendars file not found`);
      else {
        try {
          const cal = JSON.parse(readFileSync(join(dir, sc.calendars), "utf8")) as { people?: unknown };
          if (!isObj(cal.people) || !Object.keys(cal.people).length) p.push(`scheduler calendars need a non-empty "people" object`);
          else for (const [id, who] of Object.entries(cal.people)) {
            if (!isObj(who) || typeof who.tz !== "string" || typeof who.name !== "string") { p.push(`calendar "${id}" needs "name" and "tz"`); continue; }
            try { new Intl.DateTimeFormat("en-US", { timeZone: who.tz }); } catch { p.push(`calendar "${id}" has an unknown time zone "${who.tz}"`); }
          }
        } catch (e) { p.push(`scheduler calendars is not valid JSON (${(e as Error).message})`); }
      }
    }
  }
  return p;
}

export function loadPlaybook(nameOrPath: string, root = resolve(dirname(fileURLToPath(import.meta.url)), "../../playbooks")): Playbook {
  const dir = existsSync(join(nameOrPath, "playbook.json")) ? resolve(nameOrPath) : join(root, nameOrPath);
  const file = join(dir, "playbook.json");
  if (!existsSync(file)) {
    const have = existsSync(root) ? readdirSync(root).filter((d) => existsSync(join(root, d, "playbook.json"))) : [];
    throw new PlaybookError(file, [`no playbook named "${nameOrPath}". Available: ${have.join(", ") || "none"}`]);
  }
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new PlaybookError(file, [`not valid JSON: ${(e as Error).message}`]); }
  const problems = checkPlaybook(raw, dir);
  if (problems.length) throw new PlaybookError(file, problems);
  return { ...(raw as Omit<Playbook, "dir">), dir };
}
