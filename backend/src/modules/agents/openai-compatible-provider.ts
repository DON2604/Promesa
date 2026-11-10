import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError } from '../../common/errors';
import type { GeminiBudget } from './gemini-budget';
import {
  LlmDeclined,
  type LLMProvider,
  type LlmTask,
  type StructuredRequest,
} from './llm-provider';

export type OpenAICompatibleConfig = {
  name: 'openai' | 'gemini';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** Set for Gemini. When the local free-tier budget is spent, no request is sent. */
  budget?: GeminiBudget;
};

/**
 * Chat-completions client (OpenAI, and Gemini through its OpenAI-compatible endpoint).
 * Output is always re-validated with the caller's Zod schema; the model never receives secrets
 * and its text is never an authority for money movement.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly modelTasks: readonly LlmTask[] = ['mission.narrate'];

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.model = config.model;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const schema = JSON.stringify(zodToJsonSchema(request.schema, { target: 'jsonSchema7' }));
    const body = JSON.stringify({
      model: this.config.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${request.systemPolicy}\nThe JSON must satisfy this JSON Schema: ${schema}`,
        },
        {
          role: 'user',
          content: JSON.stringify({ facts: request.trustedContext.facts }),
        },
      ],
    });
    if (this.config.budget) {
      const slot = this.config.budget.tryReserve(Math.ceil(body.length / 4));
      if (!slot.ok) throw new LlmDeclined(slot.reason);
    }
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
        body,
      });
    } catch (error) {
      // No retry: a retry is another request against the same free-tier minute.
      if (this.config.budget) {
        throw new LlmDeclined(
          `Gemini could not be reached (${error instanceof Error ? error.name : 'error'}).`,
        );
      }
      throw error;
    }
    if (!response.ok) {
      if (this.config.budget) {
        if (response.status === 429) {
          const limit = await readRateLimit(response);
          this.config.budget.penalize(limit);
          throw new LlmDeclined(
            limit.daily
              ? 'Gemini daily free-tier quota is exhausted. Further calls are paused until midnight Pacific.'
              : 'Gemini rate limit reached. Further calls are paused.',
          );
        }
        throw new LlmDeclined(`Gemini returned HTTP ${response.status}.`);
      }
      throw new AppError('LLM_UNAVAILABLE', `${this.name} returned HTTP ${response.status}.`, 502);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      if (this.config.budget) throw new LlmDeclined('Gemini returned no content.');
      throw new AppError('LLM_EMPTY', `${this.name} returned no content.`, 502);
    }
    try {
      return request.schema.parse(JSON.parse(content));
    } catch (error) {
      if (this.config.budget)
        throw new LlmDeclined('Gemini returned JSON that did not match the narration schema.');
      throw error;
    }
  }
}

async function readRateLimit(
  response: Response,
): Promise<{ daily: boolean; retryAfterMs?: number }> {
  const retryAfter = response.headers.get('retry-after');
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, Date.parse(retryAfter) - Date.now());
  }
  let daily = false;
  try {
    const text = (await response.text()).slice(0, 2_000);
    daily = /per[_ ]?day|PerDay|daily quota|GenerateRequestsPerDay/i.test(text);
  } catch {
    daily = false;
  }
  return { daily, retryAfterMs };
}
