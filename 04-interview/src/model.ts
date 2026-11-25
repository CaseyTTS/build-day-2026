// Model layer: a built-in stand-in (default, no key, deterministic) or a real model from env. License: MIT.
//   MODEL_PROVIDER=standin (default) | ollama | openai
//   ollama: OLLAMA_HOST (default http://localhost:11434), MODEL (a model you pulled)
//   openai: OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1, any OpenAI-compatible API), MODEL

export interface ChatModel {
  name: string;
  complete(system: string, user: string): Promise<string>;
}

// Canned answers keyed by task id. "solo" = answering alone, "team" = adding to a teammate's turn.
// Deliberately good but not perfect, so the scorecard shows a spread.
const CANNED: Record<string, { solo: string; team: string }> = {
  T1: {
    solo:
      "The goal is that a full export for the largest accounts finishes without timing out. " +
      "I'd ask how big the biggest accounts are and whether customers need the file right away or can get an emailed link. " +
      "First step: reproduce it on staging with a large seeded account and measure a baseline, so we know what faster means.",
    team:
      "Adding to that: one more question is whether the export can stream rows instead of building the whole file in memory, " +
      "because that changes the design. The risk is breaking existing integrations that parse the file, so the format stays the same.",
  },
  T2: {
    solo:
      "I would not approve it. DAY is in seconds but Date.now() is in milliseconds, so the cutoff is only about 43 minutes ago. " +
      "The job deletes almost every record, which is data loss in an audit table. " +
      "The fix: DAY should be 24 * 60 * 60 * 1000. I'd also add a test with records on both sides of the cutoff, not an empty fixture.",
    team:
      "The cutoff math is the problem: DAY is in seconds and Date.now() is in milliseconds. Before it runs in production I'd add a dry run that logs the row count it would delete, " +
      "and an alert if that count is far above the usual nightly number.",
  },
  T3: {
    solo:
      "Production data is off-limits, so I won't query it. I'd start with the application logs for that account's export requests " +
      "and the query timings, then rebuild a similar data shape on staging and profile the export there. " +
      "If I need row counts for that account I'd ask the database owner for them, because that tells us if it is volume or a slow query.",
    team:
      "I can take staging: seed an account at a similar size and profile it, so we can compare with what the logs show.",
  },
  T4: {
    solo:
      "First, turn off the flag or revert the change so customers get the old behavior back. " +
      "Then watch the export error rate and latency dashboards to confirm they return to the baseline. " +
      "I'd post an update in the incident channel and let support know what changed and when it was fixed.",
    team:
      "While that rollback runs I'll watch the error rate dashboard and confirm it drops. " +
      "Afterward I'd write up the root cause and add a new test for the failing case so it is caught next time.",
  },
};

export class StandInModel implements ChatModel {
  name = "stand-in (built-in canned answers, no network)";
  async complete(_system: string, user: string): Promise<string> {
    const id = /TASK_ID:\s*(T\d)/.exec(user)?.[1];
    const mode = /MODE:\s*team/.test(user) ? "team" : "solo";
    if (!id || !CANNED[id]) return "I don't have an answer for that task.";
    return CANNED[id][mode];
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export class OllamaModel implements ChatModel {
  constructor(private host: string, private model: string) {}
  get name() { return `ollama:${this.model}`; }
  async complete(system: string, user: string): Promise<string> {
    const data = await postJson(`${this.host.replace(/\/$/, "")}/api/chat`, {
      model: this.model, stream: false, options: { temperature: 0 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return String(data?.message?.content ?? "").trim();
  }
}

export class OpenAICompatibleModel implements ChatModel {
  constructor(private baseUrl: string, private model: string, private apiKey?: string) {}
  get name() { return `openai-compatible:${this.model}`; }
  async complete(system: string, user: string): Promise<string> {
    const data = await postJson(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      model: this.model, temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }, this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {});
    return String(data?.choices?.[0]?.message?.content ?? "").trim();
  }
}

export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ChatModel {
  const provider = (env.MODEL_PROVIDER ?? "standin").toLowerCase();
  if (provider === "standin") return new StandInModel();
  if (!env.MODEL) throw new Error(`MODEL_PROVIDER=${provider} needs MODEL (the model name).`);
  if (provider === "ollama") return new OllamaModel(env.OLLAMA_HOST ?? "http://localhost:11434", env.MODEL);
  if (provider === "openai") {
    const base = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    if (!env.OPENAI_API_KEY && base.includes("api.openai.com")) throw new Error("MODEL_PROVIDER=openai needs OPENAI_API_KEY.");
    return new OpenAICompatibleModel(base, env.MODEL, env.OPENAI_API_KEY);
  }
  throw new Error(`Unknown MODEL_PROVIDER "${provider}". Use standin, ollama or openai.`);
}
