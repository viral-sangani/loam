/** Minimal client for the OpenAI-compatible model gateway. Runs inside Convex actions. */

const BASE_URL = process.env.LLM_BASE_URL ?? "https://models.dehold.co/v1";
const MODEL = process.env.LLM_MODEL ?? "gpt-6-luna";

async function chat(system: string, user: string, maxTokens: number, json: boolean): Promise<string> {
  const key = process.env.DEHOLD_API_KEY;
  if (!key) throw new Error("DEHOLD_API_KEY is not set on the Convex deployment");
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Model gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

export async function chatJSON<T>(system: string, user: string, maxTokens = 1500): Promise<T> {
  return parseJSON<T>(await chat(system, user, maxTokens, true));
}

/** A plain-text (Markdown) reply. */
export async function chatText(system: string, user: string, maxTokens = 1200): Promise<string> {
  return (await chat(system, user, maxTokens, false)).trim();
}

/** Tolerates code fences or chatter around the JSON object. */
function parseJSON<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}
