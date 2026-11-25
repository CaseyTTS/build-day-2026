// Model layer shared by every stage. License: MIT.
// Adapted from Build Day drop 4 (src/model.ts): same env switch, same wire formats.
//   MODEL_PROVIDER=standin (default) | ollama | openai
//   ollama: OLLAMA_HOST (default http://localhost:11434), MODEL (a model you pulled)
//   openai: OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1, any OpenAI-compatible API), MODEL
// The stand-in never calls the network. Each stage has its own deterministic stand-in logic
// (keyword triage, extractive RAG answer, canned interview answers from the playbook's tasks file).

export interface ChatModel {
  name: string;
  /** true for the built-in stand-in: stages use their deterministic fallback instead of a prompt. */
  standin: boolean;
  complete(system: string, user: string): Promise<string>;
}

/** Canned interview answers keyed by task id, read from the playbook's tasks file. */
export type Canned = Record<string, { solo: string; team: string }>;

export class StandInModel implements ChatModel {
  name = "stand-in (built-in, deterministic, no network)";
  standin = true;
  constructor(private canned: Canned = {}) {}
  withCanned(canned: Canned): StandInModel { return new StandInModel(canned); }
  complete(_system: string, user: string): Promise<string> {
    const id = /TASK_ID:\s*(\S+)/.exec(user)?.[1];
    const mode = /MODE:\s*team/.test(user) ? "team" : "solo";
    const c = id ? this.canned[id] : undefined;
    return Promise.resolve(c ? c[mode] : "I don't have an answer for that task.");
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export class OllamaModel implements ChatModel {
  standin = false;
  constructor(private host: string, private model: string) {}
  get name() { return `ollama:${this.model}`; }
  async complete(system: string, user: string): Promise<string> {
    const data = (await postJson(`${this.host.replace(/\/$/, "")}/api/chat`, {
      model: this.model, stream: false, options: { temperature: 0 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    })) as { message?: { content?: string } };
    return String(data?.message?.content ?? "").trim();
  }
}

export class OpenAICompatibleModel implements ChatModel {
  standin = false;
  constructor(private baseUrl: string, private model: string, private apiKey?: string) {}
  get name() { return `openai-compatible:${this.model}`; }
  async complete(system: string, user: string): Promise<string> {
    const data = (await postJson(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      model: this.model, temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }, this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})) as { choices?: { message?: { content?: string } }[] };
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

/** Pull the first JSON object out of a model reply (models like to wrap JSON in prose or fences). */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? "") as Record<string, unknown>; } catch { return null; }
}
