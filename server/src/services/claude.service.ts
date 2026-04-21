import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const MODEL_IDS = {
  opus: 'claude-opus-4-5',
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export type ClaudeModel = keyof typeof MODEL_IDS;

export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string };
};
type TextBlock = { type: 'text'; text: string };
type InputBlock = TextBlock | ImageBlock;

export async function callClaude(
  prompt: string,
  model: ClaudeModel = 'sonnet',
  extraBlocks: ImageBlock[] = [],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const content: InputBlock[] = [
    ...extraBlocks,
    { type: 'text', text: prompt },
  ];

  const res = await client.messages.create({
    model: MODEL_IDS[model],
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.temperature ?? 0,
    messages: [{ role: 'user', content: content as never }],
  });

  if (res.stop_reason === 'max_tokens') {
    console.warn(`[claude] response truncated (max_tokens=${opts.maxTokens ?? 16000} hit on model=${model})`);
  }

  const text = res.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return text.trim();
}

export function parseJsonResponse<T = unknown>(raw: string): T {
  let s = raw.trim();
  // Strip leading markdown fence
  s = s.replace(/^```(?:json)?\s*/i, '');
  // Strip from last fence onward (drops trailing commentary too)
  const lastFence = s.lastIndexOf('```');
  if (lastFence !== -1) s = s.slice(0, lastFence);
  s = s.trim();
  // Find the start of JSON
  const first = s.search(/[\[{]/);
  if (first > 0) s = s.slice(first);

  try {
    return JSON.parse(s) as T;
  } catch (e) {
    const repaired = tryRepairTruncatedJson(s);
    if (repaired !== null) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // fall through to original error
      }
    }
    console.error(`[claude] JSON parse failed (len=${s.length}): ${(e as Error).message}`);
    console.error(`[claude] tail: ${s.slice(-300)}`);
    throw e;
  }
}

function tryRepairTruncatedJson(s: string): string | null {
  // Repair truncated array of objects by trimming to last complete `}` and closing `]`.
  if (s.startsWith('[')) {
    const lastObjEnd = s.lastIndexOf('}');
    if (lastObjEnd > 0) {
      const candidate = s.slice(0, lastObjEnd + 1) + ']';
      console.warn(`[claude] attempting JSON repair: trimmed ${s.length - candidate.length + 1} trailing chars`);
      return candidate;
    }
  }
  // Repair truncated top-level object: not safe to guess, skip.
  return null;
}
