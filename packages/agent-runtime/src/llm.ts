import type { RuntimeConfig, ToolCall, ToolDefinition } from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface LlmResponse {
  content: string;
  toolCalls: ToolCall[];
}

function parseOpenAiToolCalls(data: any): ToolCall[] {
  const toolCalls = data.choices?.[0]?.message?.tool_calls ?? [];
  return toolCalls.map((tc: any) => ({
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments || "{}"),
  }));
}

async function callOpenAi(
  config: RuntimeConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  const body = {
    model: config.llmModel,
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

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    toolCalls: parseOpenAiToolCalls(data),
  };
}

async function callAnthropic(
  config: RuntimeConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const convo = messages.filter((m) => m.role !== "system");

  const body = {
    model: config.llmModel,
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
      "x-api-key": config.llmApiKey,
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

export async function callLlm(
  config: RuntimeConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[]
): Promise<LlmResponse> {
  if (!config.llmApiKey) {
    return {
      content: "No LLM_API_KEY configured. Running in offline reflection mode.",
      toolCalls: [],
    };
  }

  if (config.llmProvider === "anthropic") {
    return callAnthropic(config, messages, tools);
  }
  return callOpenAi(config, messages, tools);
}
