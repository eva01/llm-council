import { OPENROUTER_API_URL } from "./config";
import type { Env } from "./types";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type OpenRouterResponse = {
  choices: Array<{
    message: {
      content?: string;
      reasoning_details?: unknown;
    };
  }>;
};

export async function queryModel(
  env: Env,
  model: string,
  messages: ChatMessage[],
  timeoutMs = 120_000
) {
  if (!env.OPENROUTER_API_KEY) {
    console.error("Missing OPENROUTER_API_KEY");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.error("OpenRouter error", response.status, await safeText(response));
      return null;
    }

    const data = (await response.json()) as OpenRouterResponse;
    const message = data.choices?.[0]?.message;

    return {
      content: message?.content ?? "",
      reasoning_details: message?.reasoning_details
    };
  } catch (err) {
    console.error(`Error querying model ${model}:`, err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function queryModelsParallel(
  env: Env,
  models: string[],
  messages: ChatMessage[]
) {
  const results = await Promise.all(models.map((model) => queryModel(env, model, messages)));
  return Object.fromEntries(models.map((model, i) => [model, results[i]]));
}

async function safeText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "<unavailable>";
  }
}
