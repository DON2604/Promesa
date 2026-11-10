import { Inject, Injectable } from '@nestjs/common';
import { type CompileIntentRequest, type CompileIntentResponse } from '@promesa/contracts';
import { z } from 'zod';
import {
  LLM_PROVIDER,
  type LLMProvider,
  INTENT_PROMPT_VERSION,
  INTENT_SYSTEM_POLICY,
} from '../agents/llm-provider';
import { PARSER_VERSION } from './intent-parser';
import { validateIntent } from './intent-validation';

const SpanSchema = z.object({ start: z.number().int(), end: z.number().int(), text: z.string() });

/** Structural schema for compiler output; semantic validation happens deterministically afterwards. */
const CompileOutputSchema = z.object({
  draft: z.object({
    productKind: z.enum(['packaging-box', 'hygiene-kit', 'food-container']).nullable(),
    productLabel: z.string().nullable(),
    quantity: z.number().int().nullable(),
    unit: z.string(),
    requiredAttributes: z.array(z.any()),
    prohibitedAttributes: z.array(z.any()),
    budgetMinor: z.string().nullable(),
    currency: z.literal('USD'),
    deadlineISO: z.string().nullable(),
    timezone: z.string(),
    hardConstraints: z.array(z.string()),
    softPreferences: z.array(z.string()),
    assumptions: z.array(z.string()),
    unresolvedQuestions: z.array(z.string()),
  }),
  sourceSpans: z.record(z.array(SpanSchema)),
  complete: z.boolean(),
  ignoredInstructions: z.array(z.string()),
});

@Injectable()
export class IntentService {
  constructor(@Inject(LLM_PROVIDER) private readonly llm: LLMProvider) {}

  /** Draft only — no financial operation and nothing persisted until the buyer confirms. */
  async compile(request: CompileIntentRequest): Promise<CompileIntentResponse> {
    const now = new Date();
    const output = (await this.llm.generateStructured({
      task: 'intent.compile',
      schema: CompileOutputSchema,
      systemPolicy: INTENT_SYSTEM_POLICY,
      trustedContext: {
        now: now.toISOString(),
        timezone: request.timezone,
        buyerType: request.buyerType,
        currency: request.currency,
      },
      untrustedInput: request.rawText,
    })) as Omit<CompileIntentResponse, 'compiler' | 'validationIssues'>;

    const validation = output.complete ? validateIntent(output.draft, now) : null;
    return {
      ...output,
      complete: Boolean(validation?.ok),
      validationIssues: validation && !validation.ok ? validation.issues : [],
      compiler: {
        provider: this.llm.name,
        model: this.llm.model,
        promptVersion: INTENT_PROMPT_VERSION,
        compilerVersion: PARSER_VERSION,
      },
    };
  }
}
