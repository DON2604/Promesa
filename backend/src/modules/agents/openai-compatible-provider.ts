import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError } from '../../common/errors';
import type { LLMProvider, LlmTask, StructuredRequest } from './llm-provider';

export type OpenAICompatibleConfig = {
  name: 'openai' | 'gemini';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
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
    const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 25_000),
      body: JSON.stringify({
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
      }),
    });
    if (!response.ok) {
      throw new AppError('LLM_UNAVAILABLE', `${this.name} returned HTTP ${response.status}.`, 502);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new AppError('LLM_EMPTY', `${this.name} returned no content.`, 502);
    return request.schema.parse(JSON.parse(content));
  }
}
