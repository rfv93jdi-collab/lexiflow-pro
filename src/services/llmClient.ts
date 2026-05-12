/**
 * LLMost OpenAI-compatible API (https://llmost.ru/docs)
 */

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string | LlmContentPart[];
};

function getBaseUrl(): string {
  const u = process.env.LLMOST_BASE_URL || "https://llmost.ru/api/v1";
  return u.replace(/\/$/, "");
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getLlmModel(): string {
  const raw = process.env.LLMOST_MODEL || "openai/gpt-4o-mini";
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim();
  }
  return t || "openai/gpt-4o-mini";
}

export function extractJsonObject(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(t);
  if (fence) return fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

export async function llmChatCompletions(body: {
  model?: string;
  messages: LlmMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}): Promise<string> {
  const url = isBrowser()
    ? "/api/llmost/chat/completions"
    : `${getBaseUrl()}/chat/completions`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!isBrowser()) {
    const apiKey = process.env.LLMOST_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!apiKey) {
      throw new Error("Не задан LLMOST_API_KEY (см. .env.example и https://llmost.ru/docs)");
    }
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: body.model || getLlmModel(),
      messages: body.messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? 8192,
      ...(body.response_format ? { response_format: body.response_format } : {}),
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    try {
      const j = JSON.parse(raw) as { error?: { message?: string } };
      const msg = j?.error?.message || raw;
      throw new Error(`LLMost: ${msg}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("LLMost:")) throw e;
      throw new Error(`LLMost HTTP ${res.status}: ${raw.slice(0, 500)}`);
    }
  }

  let data: { choices?: { message?: { content?: string | null } }[]; error?: { message?: string } };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("LLMost: невалидный JSON в ответе");
  }

  if (data.error?.message) {
    throw new Error(`LLMost: ${data.error.message}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (content == null || content === "") {
    throw new Error("LLMost: пустой ответ модели");
  }
  return typeof content === "string" ? content : String(content);
}
