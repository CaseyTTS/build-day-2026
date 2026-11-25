// Three implementations of one Candidate interface. License: MIT.
import { createInterface } from "node:readline";
import type { Candidate, ConsentRecord, Task, TurnDraft } from "./types.js";
import type { ChatModel } from "./model.js";

/** Where a person's lines come from: the terminal, or a script (tests, demos, piped input). */
export interface LineSource {
  ask(prompt: string): Promise<string | null>; // null = end of input
  close(): void;
}

export function scriptedLines(lines: string[], echo: (s: string) => void = () => {}): LineSource {
  const queue = [...lines];
  return {
    async ask(prompt) { echo(prompt); const l = queue.shift(); if (l !== undefined) echo(l + "\n"); return l ?? null; },
    close() {},
  };
}

export function terminalLines(input = process.stdin, output = process.stdout): LineSource {
  const rl = createInterface({ input, terminal: false });
  const it = rl[Symbol.asyncIterator]();
  return {
    async ask(prompt) { output.write(prompt); const r = await it.next(); return r.done ? null : r.value; },
    close() { rl.close(); },
  };
}

/** (a) A person answering in the CLI. Multi-line answers end with a blank line. */
export class HumanCandidate implements Candidate {
  kind = "human" as const;
  constructor(public id: string, private io: LineSource, public label = `Person (${id})`) {}

  async consent(notice: string): Promise<ConsentRecord[] | null> {
    const a = await this.io.ask(`\n${notice}\n[${this.id}] > `);
    return a?.trim().toLowerCase() === "yes" ? [{ who: this.id, how: "typed yes after the notice" }] : null;
  }

  async respond(task: Task, priorTurns: TurnDraft[]): Promise<TurnDraft[]> {
    const lines: string[] = [];
    let header = `\n[${this.id}] ${task.id} ${task.title}${priorTurns.length ? " (your teammates have answered above)" : ""}\n` +
      `(finish your answer with a blank line)\n> `;
    for (;;) {
      const l = await this.io.ask(header);
      header = "> ";
      if (l === null) break;
      if (l.trim() === "") { if (lines.length) break; else continue; }
      lines.push(l.trim());
    }
    return [{ speaker: this.id, speakerKind: "human", text: lines.join(" ") || "(no answer)" }];
  }
}

/** (b) A bot or agent behind a model endpoint. The default model is the built-in stand-in. */
export class BotCandidate implements Candidate {
  kind = "bot" as const;
  constructor(public id: string, private model: ChatModel, public label = `Bot (${id}, ${model.name})`) {}

  async consent(notice: string): Promise<ConsentRecord[] | null> {
    // A bot cannot consent for itself. The notice goes into its context and the person running it is the one agreeing.
    return [{ who: `${this.id} (operator)`, how: "operator started the run; notice was shown in the bot's context" }];
  }

  async respond(task: Task, priorTurns: TurnDraft[]): Promise<TurnDraft[]> {
    const system = "You are being interviewed with a work-sample task. Answer in 3-5 plain sentences. Be specific and honest about what you would check.";
    const team = priorTurns.length > 0;
    const user = [
      `TASK_ID: ${task.id}`,
      `MODE: ${team ? "team" : "solo"}`,
      task.prompt,
      team ? `\nYour teammates said so far:\n${priorTurns.map((t) => `- ${t.speaker}: ${t.text}`).join("\n")}\nAdd what is missing; don't repeat it.` : "",
    ].join("\n");
    const text = (await this.model.complete(system, user)).replace(/\s+/g, " ").trim();
    return [{ speaker: this.id, speakerKind: "bot", text: text || "(no answer)" }];
  }
}

/** (c) A team: members take turns on the same task, each seeing the turns before theirs. */
export class TeamCandidate implements Candidate {
  kind = "team" as const;
  constructor(public id: string, private team: Candidate[], public label = `Team (${id})`) {
    if (team.some((m) => m.kind === "team")) throw new Error("Nested teams are not supported.");
  }
  get members() { return this.team.map((m) => ({ id: m.id, kind: m.kind as "human" | "bot" })); }

  async consent(notice: string): Promise<ConsentRecord[] | null> {
    const all: ConsentRecord[] = [];
    for (const m of this.team) {
      const r = await m.consent(notice);
      if (!r) return null; // one member says no: nothing is recorded for anyone
      all.push(...r);
    }
    return all;
  }

  async respond(task: Task, priorTurns: TurnDraft[]): Promise<TurnDraft[]> {
    const turns: TurnDraft[] = [];
    for (const m of this.team) turns.push(...(await m.respond(task, [...priorTurns, ...turns])));
    return turns;
  }
}
