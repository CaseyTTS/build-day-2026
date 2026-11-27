// Interview scheduling for the finale's scheduling playbook. License: MIT.
//   request -> everyone's calendar (fixture JSON) -> open slots in each person's own time zone -> invite DRAFT
// Plain code, no model: the slot search is rules you can audit. The model never picks a time.
// Nothing here sends anything. The invite is a draft; the send_invite tool is gated and is a stub.
import { readFileSync } from "node:fs";

export interface Busy { start: string; end: string } // ISO 8601 with an offset or Z
export interface Person { name: string; role: string; tz: string; workday?: { start: string; end: string }; busy?: Busy[] }
export interface Calendars { people: Record<string, Person> }
export interface InterviewRequest { candidate: string; panel: string[]; minutes?: number; from: string; to: string; opening?: string }
export interface Slot { start: string; end: string; local: Record<string, string> }
export interface ScheduleResult { slots: Slot[]; problems: string[]; checked: number }

const DAY_MS = 86_400_000;
const STEP_MIN = 15;
const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

export function loadCalendars(file: string): Calendars {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Calendars;
  if (typeof raw !== "object" || raw === null || typeof raw.people !== "object" || raw.people === null) throw new Error(`${file}: needs a "people" object`);
  return raw;
}

/** True when the IANA zone name is one Node knows. */
export function validZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** Weekday and minutes-after-midnight of an instant, in a person's own time zone (handles DST). */
export function localParts(ms: number, tz: string): { weekday: string; minutes: number; date: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday!, minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

/** "Tue Dec 1, 10:00 AM CST" in the person's own zone. */
export function formatLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(ms));
}

const hm = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s); if (!m) throw new Error(`bad time "${s}" (use HH:MM)`); return Number(m[1]) * 60 + Number(m[2]); };

function freeFor(p: Person, start: number, end: number): boolean {
  const day = p.workday ?? { start: "09:00", end: "17:00" };
  const ws = hm(day.start), we = hm(day.end);
  const a = localParts(start, p.tz), b = localParts(end - 1, p.tz);
  // whole interview inside one local working day, Monday to Friday
  if (!WEEKDAYS.has(a.weekday) || a.date !== b.date || a.minutes < ws || b.minutes + 1 > we) return false;
  return !(p.busy ?? []).some((x) => Date.parse(x.start) < end && start < Date.parse(x.end));
}

/**
 * First `max` slots where the candidate and every panel member are free, inside each person's own
 * working hours and time zone, between `from` and `to` (dates, inclusive, read as UTC days).
 * Returns problems instead of throwing when the request names someone with no calendar.
 */
export function findSlots(cal: Calendars, req: InterviewRequest, max = 3): ScheduleResult {
  const problems: string[] = [];
  const ids = [req.candidate, ...(req.panel ?? [])];
  if (!req.panel?.length) problems.push("no interviewer named on the request");
  for (const id of ids) {
    const p = cal.people[id];
    if (!p) problems.push(`no calendar for "${id}"`);
    else if (!validZone(p.tz)) problems.push(`"${id}" has an unknown time zone "${p.tz}"`);
  }
  const minutes = req.minutes ?? 45;
  if (!(minutes >= 15 && minutes <= 240)) problems.push(`interview length ${minutes} min is outside 15-240`);
  const from = Date.parse(`${req.from}T00:00:00Z`), to = Date.parse(`${req.to}T00:00:00Z`) + DAY_MS;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) problems.push(`bad date window ${req.from} to ${req.to}`);
  else if (to - from > 14 * DAY_MS) problems.push("date window is longer than 14 days");
  if (problems.length) return { slots: [], problems, checked: 0 };

  const people = ids.map((id) => [id, cal.people[id]!] as const);
  const slots: Slot[] = [];
  let checked = 0;
  for (let s = from; s + minutes * 60_000 <= to && slots.length < max; s += STEP_MIN * 60_000) {
    const e = s + minutes * 60_000;
    checked++;
    if (people.every(([, p]) => freeFor(p, s, e))) {
      slots.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), local: Object.fromEntries(people.map(([id, p]) => [id, formatLocal(s, p.tz)])) });
      s = e - STEP_MIN * 60_000; // next proposal starts after this one ends, so the options do not overlap
    }
  }
  return { slots, problems, checked };
}

/** The invite a recruiter reads before deciding. A draft only: nothing in this repo can send it. */
export function draftInvite(cal: Calendars, req: InterviewRequest, slots: Slot[], itemId: string): string {
  const who = (id: string) => `${cal.people[id]!.name} (${cal.people[id]!.role}, ${cal.people[id]!.tz})`;
  return [
    `DRAFT INVITE for recruiter approval. Not sent. (${itemId})`, "",
    `Interview: ${req.opening ?? "interview"}, ${req.minutes ?? 45} minutes, video call`,
    `Candidate: ${who(req.candidate)}`,
    `Panel: ${req.panel.map(who).join("; ")}`, "",
    "Proposed times (each person sees their own time zone):",
    ...slots.map((s, n) => `${n + 1}. ${s.start} to ${s.end} UTC\n${Object.entries(s.local).map(([id, t]) => `   - ${cal.people[id]!.name}: ${t}`).join("\n")}`),
    "", "A recruiter picks one time and approves the invite. Until then nobody is contacted.", "",
  ].join("\n");
}
