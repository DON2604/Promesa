import { parseIntent, PARSER_VERSION } from '../intent/intent-parser';
import type { LLMProvider, LlmTask, StructuredRequest } from './llm-provider';

/**
 * Deterministic, offline provider for CI and demo mode. It performs real extraction with the
 * rule-based parser rather than returning canned answers, so behaviour is testable and honest.
 * For narration it returns the deterministic explanation the planner already produced.
 */
export class FixtureLLMProvider implements LLMProvider {
  readonly name = 'fixture';
  readonly model = PARSER_VERSION;
  readonly modelTasks: readonly LlmTask[] = [];

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    switch (request.task) {
      case 'intent.compile': {
        const now = new Date(String(request.trustedContext.now));
        const timezone = String(request.trustedContext.timezone);
        const result = parseIntent(request.untrustedInput, { now, timezone });
        return request.schema.parse(result);
      }
      case 'mission.narrate':
        return request.schema.parse(request.trustedContext.deterministic);
    }
  }
}
