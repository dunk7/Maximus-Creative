import type { RuntimeConfig } from "./types.js";

export type LlmProvider = RuntimeConfig["llmProvider"];

export interface LlmTarget {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  label: string;
}

export interface LlmCallResult {
  provider: LlmProvider;
  model: string;
  label: string;
  attempt: number;
  fallbacksUsed: number;
}

export const GOOGLE_MODEL_PRIORITY = [
  "gemini-3.5-pro",
  "gemini-3.5-pro-preview",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-pro-latest",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash",
];

export const OPENAI_MODEL_PRIORITY = [
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
];

export const ANTHROPIC_MODEL_PRIORITY = [
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
];

export const GROK_MODEL_PRIORITY = [
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-3",
  "grok-3-mini",
];

let cachedGoogleModels: { at: number; models: string[] } | null = null;

export async function listGoogleModels(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (cachedGoogleModels && now - cachedGoogleModels.at < 6 * 60 * 60 * 1000) {
    return cachedGoogleModels.models;
  }

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
  });

  if (!res.ok) return [];

  const data = (await res.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };

  const models = (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));

  cachedGoogleModels = { at: now, models };
  return models;
}

export function pickBestModels(available: string[], priority: string[], limit = 3): string[] {
  const picked: string[] = [];
  for (const candidate of priority) {
    if (available.includes(candidate)) picked.push(candidate);
    if (picked.length >= limit) break;
  }
  if (picked.length === 0 && available.length > 0) {
    return available.slice(0, limit);
  }
  return picked;
}

export async function buildLlmFallbackChain(config: RuntimeConfig): Promise<LlmTarget[]> {
  const chain: LlmTarget[] = [];
  const googleKey = config.googleApiKey || (config.llmProvider === "google" ? config.llmApiKey : "");
  const grokKey = config.grokApiKey || (config.llmProvider === "grok" ? config.llmApiKey : "");
  const openaiKey = config.openaiApiKey;
  const anthropicKey = config.anthropicApiKey;

  if (!config.llmAuto && config.llmApiKey && config.llmModel) {
    chain.push({
      provider: config.llmProvider,
      model: config.llmModel,
      apiKey: config.llmApiKey,
      label: `${config.llmProvider}/${config.llmModel}`,
    });
    return chain;
  }

  if (googleKey) {
    const available = await listGoogleModels(googleKey);
    const models = pickBestModels(available, GOOGLE_MODEL_PRIORITY, 4);
    for (const model of models) {
      chain.push({
        provider: "google",
        model,
        apiKey: googleKey,
        label: `google/${model}`,
      });
    }
  }

  if (grokKey) {
    for (const model of GROK_MODEL_PRIORITY.slice(0, 3)) {
      chain.push({
        provider: "grok",
        model,
        apiKey: grokKey,
        label: `grok/${model}`,
      });
    }
  }

  if (openaiKey) {
    for (const model of OPENAI_MODEL_PRIORITY.slice(0, 3)) {
      chain.push({
        provider: "openai",
        model,
        apiKey: openaiKey,
        label: `openai/${model}`,
      });
    }
  }

  if (anthropicKey) {
    for (const model of ANTHROPIC_MODEL_PRIORITY.slice(0, 3)) {
      chain.push({
        provider: "anthropic",
        model,
        apiKey: anthropicKey,
        label: `anthropic/${model}`,
      });
    }
  }

  if (chain.length === 0 && config.llmApiKey) {
    chain.push({
      provider: config.llmProvider,
      model: config.llmModel || "gemini-2.5-flash",
      apiKey: config.llmApiKey,
      label: `${config.llmProvider}/${config.llmModel || "default"}`,
    });
  }

  return chain;
}

export function invalidateGoogleModelCache(): void {
  cachedGoogleModels = null;
}

export type LlmPurpose = "chat" | "tick" | "synthesis" | "shell-approval" | "task";

export interface LlmRoutingHint {
  purpose: LlmPurpose;
  userMessage?: string;
  toolStep?: number;
  toolsOffered?: number;
}

const FAST_MODEL_RE = /flash|mini|haiku|lite/i;
const STRONG_MODEL_RE = /pro|sonnet|gpt-4\.1|gpt-4o(?!-mini)|grok-4/i;

const SIMPLE_CHAT_RE =
  /^(hi|hello|hey|yo|thanks|thank you|thx|ok|okay|yes|no|sure|cool|nice|good morning|good night|gm|gn)\b/i;

export function isSimpleChatMessage(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 160) return false;
  if (trimmed.includes("?") && trimmed.length > 80) return false;
  if (/run_shell|edit_file|deploy|build|npm |git |solana|wallet|balance/i.test(trimmed)) return false;
  return trimmed.length < 60 || SIMPLE_CHAT_RE.test(trimmed);
}

function modelScore(model: string, preferFast: boolean): number {
  const fast = FAST_MODEL_RE.test(model);
  const strong = STRONG_MODEL_RE.test(model);
  if (preferFast) {
    if (fast) return 0;
    if (strong) return 2;
    return 1;
  }
  if (strong) return 0;
  if (fast) return 2;
  return 1;
}

/** Reorder fallback chain: fast models first for simple chat, strong models first for ticks/tools. */
export function routeLlmChain(chain: LlmTarget[], hint?: LlmRoutingHint): LlmTarget[] {
  if (chain.length <= 1 || !hint) return chain;

  const inToolLoop = (hint.toolStep ?? 0) > 0;
  const preferFast =
    hint.purpose === "synthesis" ||
    (hint.purpose === "chat" &&
      !inToolLoop &&
      hint.userMessage != null &&
      isSimpleChatMessage(hint.userMessage));

  const preferStrong =
    hint.purpose === "tick" ||
    hint.purpose === "task" ||
    hint.purpose === "shell-approval" ||
    inToolLoop;

  if (!preferFast && !preferStrong) return chain;

  const sorted = [...chain].sort((a, b) => {
    const sa = modelScore(a.model, preferFast && !preferStrong);
    const sb = modelScore(b.model, preferFast && !preferStrong);
    if (sa !== sb) return sa - sb;
    return 0;
  });

  return sorted;
}
