import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
export type Provider = "anthropic" | "experiential";
export type Settings = {
  solariKey: string;
  modelKey: string;
  model: string;
  provider?: Provider;
  githubToken?: string;
};
export class UserError extends Error {}
export async function readSettings(): Promise<Settings> {
  let local: Record<string, string | undefined> = {};
  try {
    local = parseEnv(await readFile(".env", "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const env = { ...local, ...process.env };
  const provider = env.QA_PROVIDER || "anthropic";
  if (provider !== "anthropic" && provider !== "experiential")
    throw new UserError("QA_PROVIDER must be anthropic or experiential.");
  return {
    solariKey: env.SOLARI_API_KEY || "",
    modelKey:
      (provider === "experiential"
        ? env.EXPLABS_API_KEY
        : env.ANTHROPIC_API_KEY) || "",
    model: env.QA_MODEL || "",
    provider,
    githubToken: env.GITHUB_TOKEN,
  };
}
export function modelBase(provider: Provider = "anthropic") {
  return provider === "experiential"
    ? "https://api.experientiallabs.ai"
    : "https://api.anthropic.com";
}
export function requireSettings(s: Settings) {
  if (!s.solariKey || !s.modelKey || !s.model)
    throw new UserError(
      "Set SOLARI_API_KEY, QA_MODEL and the selected provider API key in the local .env file.",
    );
}
export async function verifyModel(s: Settings, signal: AbortSignal) {
  requireSettings(s);
  const experiential = s.provider === "experiential";
  const response = await fetch(
    modelBase(s.provider) +
      (experiential
        ? "/v1/models"
        : `/v1/models/${encodeURIComponent(s.model)}`),
    {
      headers: experiential
        ? { authorization: `Bearer ${s.modelKey}` }
        : { "x-api-key": s.modelKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    },
  ).catch((error) => {
    if (signal.aborted) throw error;
    throw new UserError(
      "Model verification could not reach the selected provider within 30 seconds. No browser was provisioned. Check provider availability and network access.",
    );
  });
  if (response.status === 401)
    throw new UserError(
      "The selected provider rejected the API key (HTTP 401). Check the provider and its key in .env.",
    );
  if (response.status === 404)
    throw new UserError(
      "QA_MODEL is not available to this account. Set an available model ID.",
    );
  if (!response.ok)
    throw new UserError(
      `Model verification failed (HTTP ${response.status}). No browser was provisioned.`,
    );
  if (experiential) {
    const data = (await response.json()) as { data?: { id: string }[] };
    if (!data.data?.some((m) => m.id === s.model))
      throw new UserError(
        "QA_MODEL is not listed in the Experiential catalog for this key.",
      );
  } else await response.body?.cancel();
}
