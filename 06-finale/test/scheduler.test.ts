// Tests for the interview scheduling playbook: time zones, conflicts, no slot, gate default deny, nothing sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkPlaybook, loadPlaybook } from "../src/playbook.js";
import { StandInModel } from "../src/model.js";
import { runPlaybook } from "../src/system.js";
import { findSlots, localParts, type Calendars, type Person } from "../src/scheduler.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const standin = new StandInModel();
const tmp = () => mkdtempSync(join(tmpdir(), "bd6s-"));
const cal = (people: Record<string, Person>): Calendars => ({ people });
const ms = (iso: string) => Date.parse(iso);

test("scheduler: time zones: a slot sits inside every person's own working hours, and each sees their own clock", () => {
  const c = cal({ ny: { name: "A", role: "candidate", tz: "America/New_York" }, chi: { name: "B", role: "manager", tz: "America/Chicago" }, lon: { name: "C", role: "interviewer", tz: "Europe/London" } });
  const r = findSlots(c, { candidate: "ny", panel: ["chi", "lon"], minutes: 45, from: "2026-12-01", to: "2026-12-01" }, 3);
  assert.deepEqual(r.problems, []);
  // Chicago opens at 15:00Z (CST), London closes at 17:00Z (GMT): only 15:00-17:00Z works.
  assert.deepEqual(r.slots.map((s) => s.start), ["2026-12-01T15:00:00.000Z", "2026-12-01T15:45:00.000Z"]);
  assert.match(r.slots[0]!.local.chi!, /9:00 AM CST/);
  assert.match(r.slots[0]!.local.ny!, /10:00 AM EST/);
  assert.match(r.slots[0]!.local.lon!, /3:00 PM GMT/);
});

test("scheduler: time zones: daylight saving moves the UTC time, not the local working hours", () => {
  const c = cal({ a: { name: "A", role: "candidate", tz: "America/Chicago" }, b: { name: "B", role: "manager", tz: "America/Chicago" } });
  // US clocks change Sunday March 8, 2026. 9:00 AM Chicago is 15:00Z on Friday, 14:00Z on Monday.
  const fri = findSlots(c, { candidate: "a", panel: ["b"], minutes: 60, from: "2026-03-06", to: "2026-03-06" }, 1);
  const mon = findSlots(c, { candidate: "a", panel: ["b"], minutes: 60, from: "2026-03-09", to: "2026-03-09" }, 1);
  assert.equal(fri.slots[0]!.start, "2026-03-06T15:00:00.000Z");
  assert.equal(mon.slots[0]!.start, "2026-03-09T14:00:00.000Z");
  assert.equal(localParts(ms(mon.slots[0]!.start), "America/Chicago").minutes, 9 * 60);
});

test("scheduler: conflicts: no proposal overlaps anyone's busy time or another proposal", () => {
  const busy = [{ start: "2026-12-01T15:00:00Z", end: "2026-12-01T16:00:00Z" }, { start: "2026-12-01T16:30:00Z", end: "2026-12-01T18:00:00Z" }];
  const c = cal({ a: { name: "A", role: "candidate", tz: "America/Chicago", busy }, b: { name: "B", role: "manager", tz: "America/Chicago", busy: [{ start: "2026-12-01T19:00:00Z", end: "2026-12-01T20:00:00Z" }] } });
  const r = findSlots(c, { candidate: "a", panel: ["b"], minutes: 30, from: "2026-12-01", to: "2026-12-01" }, 5);
  assert.equal(r.slots[0]!.start, "2026-12-01T16:00:00.000Z", "the first free half hour, between the two busy blocks");
  const all = [...busy, { start: "2026-12-01T19:00:00Z", end: "2026-12-01T20:00:00Z" }];
  for (const s of r.slots) for (const b of all) assert.ok(!(ms(b.start) < ms(s.end) && ms(s.start) < ms(b.end)), `${s.start} overlaps ${b.start}`);
  for (let i = 1; i < r.slots.length; i++) assert.ok(ms(r.slots[i]!.start) >= ms(r.slots[i - 1]!.end), "proposals do not overlap each other");
  assert.equal(r.slots.length, 5);
});

test("scheduler: no slot: time zones that never overlap, a fully booked calendar, and a weekend all return none, honestly", () => {
  const c = cal({
    chi: { name: "A", role: "candidate", tz: "America/Chicago" }, kol: { name: "B", role: "interviewer", tz: "Asia/Kolkata" },
    full: { name: "C", role: "manager", tz: "America/Chicago", busy: [{ start: "2026-11-30T00:00:00Z", end: "2026-12-07T00:00:00Z" }] },
  });
  for (const req of [
    { candidate: "chi", panel: ["kol"], minutes: 30, from: "2026-12-01", to: "2026-12-04" },
    { candidate: "chi", panel: ["full"], minutes: 30, from: "2026-12-01", to: "2026-12-04" },
    { candidate: "chi", panel: ["chi"], minutes: 30, from: "2026-12-05", to: "2026-12-06" },
  ]) {
    const r = findSlots(c, req);
    assert.deepEqual(r.slots, [], JSON.stringify(req));
    assert.deepEqual(r.problems, []);
    assert.ok(r.checked > 0, "it looked before saying no");
  }
});

test("scheduler: a bad request is reported, not guessed: unknown person, unknown zone, no panel, bad window", () => {
  const c = cal({ a: { name: "A", role: "candidate", tz: "Mars/Olympus" } });
  const r = findSlots(c, { candidate: "a", panel: ["ghost"], minutes: 600, from: "2026-12-05", to: "2026-12-01" });
  assert.deepEqual(r.slots, []);
  const all = r.problems.join("\n");
  for (const want of [/no calendar for "ghost"/, /unknown time zone "Mars\/Olympus"/, /600 min/, /bad date window/]) assert.match(all, want);
  assert.match(findSlots(c, { candidate: "a", panel: [], from: "2026-12-01", to: "2026-12-01" }).problems.join(), /no interviewer/);
});

test("scheduling playbook: the approval gate denies by default; no invite is recorded, and an invite written inside an item is denied", async () => {
  const r = await runPlaybook(loadPlaybook("scheduling"), { model: standin, approve: "deny", outRoot: tmp() });
  const invites = r.items.flatMap((i) => i.calls).filter((c) => c.tool === "send_invite");
  assert.ok(invites.length >= 2);
  assert.ok(invites.every((c) => ["not-approved", "skipped", "deny"].includes(c.decision)));
  assert.ok(invites.some((c) => c.decision === "not-approved"), "the scheduler's own invite waits on a recruiter");
  assert.equal(r.items.find((i) => i.id === "S-403")!.calls.filter((c) => c.tool === "send_invite").at(-1)?.decision, "deny", "an invite written inside an item is denied");
  assert.ok(!existsSync(join(r.outDir, "invites-stub.jsonl")) && !existsSync(join(r.outDir, "outbox-stub.jsonl")), "nothing reached even the stub outbox");
  const s401 = r.items.find((i) => i.id === "S-401")!;
  assert.equal(s401.schedule?.slots.length, 3);
  assert.match(readFileSync(join(r.outDir, "drafts/S-401-invite.md"), "utf8"), /^DRAFT INVITE for recruiter approval\. Not sent\./);
  assert.ok(r.items.flatMap((i) => i.humanDecisions).some((d) => /S-401: a recruiter picks one of 3 proposed times/.test(d)));
});

test("scheduling playbook: no slot means no invite and a recruiter takes over; the delete asked for in a reschedule is denied", async () => {
  const r = await runPlaybook(loadPlaybook("scheduling"), { model: standin, approve: "yes", outRoot: tmp() });
  for (const id of ["S-402", "S-403"]) {
    const i = r.items.find((x) => x.id === id)!;
    assert.deepEqual(i.schedule?.slots, [], id);
    assert.ok(i.calls.filter((c) => c.tool === "send_invite" && !c.why?.includes("item cannot")).every((c) => c.decision === "skipped"), id);
    assert.ok(i.humanDecisions.some((d) => d.includes("no slot proposed")), id);
  }
  assert.ok(!existsSync(join(r.outDir, "drafts/S-402-invite.md")));
  assert.equal(r.items.find((i) => i.id === "S-404")!.calls.find((c) => c.tool === "delete_record")?.decision, "deny");
  assert.match(r.items.find((i) => i.id === "S-404")!.triage.review ?? "", /always gets a person/);
});

test("scheduling playbook: nothing is sent, even approved: send_invite is a stub that only writes a local line", async () => {
  const r = await runPlaybook(loadPlaybook("scheduling"), { model: standin, approve: "yes", outRoot: tmp() });
  const sent = r.items.flatMap((i) => i.calls).filter((c) => c.tool === "send_invite" && c.decision === "allow");
  assert.ok(sent.length > 0 && sent.every((c) => /^STUB, nothing sent\. Recorded in invites-stub\.jsonl/.test(c.result ?? "")));
  const lines = readFileSync(join(r.outDir, "invites-stub.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, sent.length);
  assert.ok(lines.every((l) => (JSON.parse(l) as { invite: string }).invite.startsWith("DRAFT INVITE")), "only the scheduler's draft reaches the stub");
  assert.equal(r.items.find((i) => i.id === "S-403")!.calls.filter((c) => c.tool === "send_invite").at(-1)?.decision, "deny", "an item's own invite stays denied even approved");
});

test("scheduling playbook: the salary question gets an honest I don't know; the recruiters-only doc is not visible to candidates", async () => {
  const r = await runPlaybook(loadPlaybook("scheduling"), { model: standin, approve: "deny", outRoot: tmp() });
  assert.equal(r.items.find((i) => i.id === "S-406")!.rag.grounded, false);
  assert.ok(r.items.every((i) => !i.rag.sources.includes("panel-notes.md")));
  assert.ok(r.items.find((i) => i.id === "S-405")!.rag.grounded);
});

test("scheduling schema: a broken scheduler section is caught before any work", () => {
  const dir = join(tmp(), "scheduling");
  cpSync(join(ROOT, "playbooks/scheduling"), dir, { recursive: true });
  const raw = JSON.parse(readFileSync(join(dir, "playbook.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(join(dir, "calendars.json"), JSON.stringify({ people: { x: { name: "X", tz: "Nowhere/Land" } } }));
  const probs = checkPlaybook({ ...raw, scheduler: { labels: ["ghost"], calendars: "calendars.json", proposals: 9 } }, dir).join("\n");
  for (const want of [/scheduler label "ghost" is not a triage label/, /proposals" must be 1 to 5/, /unknown time zone "Nowhere\/Land"/]) assert.match(probs, want);
  assert.match(checkPlaybook({ ...raw, scheduler: { labels: ["interview_request"], calendars: "../../etc/passwd" } }, dir).join("\n"), /"scheduler.calendars" must be inside the playbook folder/);
  const cli = spawnSync(process.execPath, [join(ROOT, "dist/src/cli.js"), "--check", "scheduling"], { encoding: "utf8" });
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /OK: playbook "scheduling" passed/);
});
