import type Database from "better-sqlite3";
import { setMeta } from "./db.js";
import type { RuntimeConfig, ToolCall, ToolDefinition } from "./types.js";
import {
  buildLlmFallbackChain,
  invalidateGoogleModelCache,
  routeLlmChain,
  type LlmCallResult,
  type LlmRoutingHint,
  type LlmTarget,
} from "./llm-router.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
  meta?: LlmCallResult;
}

function parseOpenAiToolCalls(data: any): ToolCall[] {
  const toolCalls = data.choices?.[0]?.message?.tool_calls ?? [];
  return toolCalls.map((tc: any) => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}"),
  }));
}

async function callOpenAiCompatible(
  target: LlmTarget,
  baseUrl: string,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  const body = {
    model: target.model,
    messages: messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
      }
      return { role: m.role, content: m.content };
    }),
    tools: tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    })),
    tool_choice: "auto",
  };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${target.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${target.provider} error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    toolCalls: parseOpenAiToolCalls(data),
  };
}

async function callOpenAi(
  target: LlmTarget,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  return callOpenAiCompatible(target, "https://api.openai.com/v1", messages, tools);
}

async function callGrok(
  target: LlmTarget,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  return callOpenAiCompatible(target, "https://api.x.ai/v1", messages, tools);
}

async function callAnthropic(
  target: LlmTarget,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const convo = messages.filter((m) => m.role !== "system");

  const body = {
    model: target.model,
    max_tokens: 4096,
    system,
    messages: convo.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    })),
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": target.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const toolCalls: ToolCall[] = [];
  let content = "";

  for (const block of data.content ?? []) {
    if (block.type === "text") content += block.text;
    if (block.type === "tool_use") {
      toolCalls.push({ name: block.name, arguments: block.input ?? {} });
    }
  }

  return { content, toolCalls };
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const cleaned = { ...schema };
  delete cleaned.additionalProperties;

  if (Array.isArray(cleaned.enum)) {
    cleaned.enum = cleaned.enum.map(String);
  }

  if (cleaned.properties && typeof cleaned.properties === "object") {
    cleaned.properties = Object.fromEntries(
      Object.entries(cleaned.properties as Record<string, Record<string, unknown>>).map(
        ([key, value]) => [key, sanitizeSchemaForGemini(value)]
      )
    );
  }

  if (cleaned.items && typeof cleaned.items === "object") {
    cleaned.items = sanitizeSchemaForGemini(cleaned.items as Record<string, unknown>);
  }

  return cleaned;
}

function toGeminiContents(messages: ChatMessage[]): Array<{ role: string; parts: GeminiPart[] }> {
  const contents: Array<{ role: string; parts: GeminiPart[] }> = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    if (message.role === "tool" && message.name) {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.name,
              response: { result: message.content },
            },
          },
        ],
      });
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    contents.push({
      role,
      parts: [{ text: message.content }],
    });
  }

  return contents;
}

async function callGoogle(
  target: LlmTarget,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${target.model}:generateContent`;

  const body: Record<string, unknown> = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: toGeminiContents(messages),
  };

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: sanitizeSchemaForGemini(t.parameters),
        })),
      },
    ];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": target.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Gemini error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  };

  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const toolCalls: ToolCall[] = [];
  let content = "";

  for (const part of parts) {
    if ("text" in part && part.text) content += part.text;
    if ("functionCall" in part && part.functionCall) {
      toolCalls.push({
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      });
    }
  }

  return { content, toolCalls };
}

async function callWithTarget(
  target: LlmTarget,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  if (target.provider === "anthropic") return callAnthropic(target, messages, tools);
  if (target.provider === "google") return callGoogle(target, messages, tools);
  if (target.provider === "grok") return callGrok(target, messages, tools);
  return callOpenAi(target, messages, tools);
}

function persistActiveLlm(db: Database.Database, target: LlmTarget, attempt: number, fallbacksUsed: number): void {
  setMeta(db, "active_llm_provider", target.provider);
  setMeta(db, "active_llm_model", target.model);
  setMeta(db, "active_llm_label", target.label);
  setMeta(db, "active_llm_at", new Date().toISOString());
  setMeta(db, "last_llm_attempt", String(attempt));
  setMeta(db, "last_llm_fallbacks", String(fallbacksUsed));
}

export interface CallLlmOptions {
  routing?: LlmRoutingHint;
}

export async function callLlm(
  config: RuntimeConfig,
  db: Database.Database,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options?: CallLlmOptions
): Promise<LlmResponse> {
  const chain = routeLlmChain(await buildLlmFallbackChain(config), options?.routing);

  if (chain.length === 0) {
    return {
      content: "No LLM API keys configured. Running in offline reflection mode.",
      toolCalls: [],
    };
  }

  const errors: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const target = chain[i];
    try {
      const response = await callWithTarget(target, messages, tools);
      const meta: LlmCallResult = {
        provider: target.provider,
        model: target.model,
        label: target.label,
        attempt: i + 1,
        fallbacksUsed: i,
      };
      persistActiveLlm(db, target, i + 1, i);
      return { ...response, meta };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${target.label}: ${message.slice(0, 200)}`);
      if (target.provider === "google" && message.includes("404")) {
        invalidateGoogleModelCache();
      }
    }
  }

  setMeta(db, "last_llm_error", errors.join(" | ").slice(0, 2000));
  setMeta(db, "last_llm_error_at", new Date().toISOString());

  return {
    content: `All LLM providers failed (${chain.length} attempts). Maximus stays alive in offline mode. Errors: ${errors.slice(0, 3).join(" ; ")}`,
    toolCalls: [],
  };
}
