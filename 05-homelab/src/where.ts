import { existsSync } from "node:fs";
import { hostname } from "node:os";

export type Place = "codespaces" | "dev-container" | "container" | "host";

/** Best-effort guess at where this code is running. Env vars are hints, not proof. */
export function detectPlace(env: NodeJS.ProcessEnv = process.env, inDocker = existsSync("/.dockerenv")): Place {
  if (env.CODESPACES === "true") return "codespaces";
  if (env.REMOTE_CONTAINERS === "true" || env.DEVCONTAINER === "true") return "dev-container";
  if (inDocker || env.container !== undefined) return "container";
  return "host";
}

export function report(env: NodeJS.ProcessEnv = process.env): string {
  return `node ${process.version} on ${process.platform}/${process.arch} | host ${hostname()} | place: ${detectPlace(env)}`;
}
