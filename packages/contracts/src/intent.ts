import { z } from 'zod';
import { isValidTimeZone } from './datetime';

/** Controlled attribute vocabulary: unknown materials are rejected, not guessed. */
export const ATTRIBUTES = [
  'paper',
  'kraft',
  'plastic',
  'food-safe',
  'recyclable',
  'compostable',
  'reusable',
  'fragrance-free',
  'fragranced',
  'alcohol-free',
  'latex',
  'individually-wrapped',
] as const;
export const AttributeSchema = z.enum(ATTRIBUTES);
export type Attribute = z.infer<typeof AttributeSchema>;

export const PRODUCT_KINDS = ['packaging-box', 'hygiene-kit', 'food-container'] as const;
export const ProductKindSchema = z.enum(PRODUCT_KINDS);
export type ProductKind = z.infer<typeof ProductKindSchema>;

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  'packaging-box': 'Packaging boxes',
  'hygiene-kit': 'Hygiene kits',
  'food-container': 'Food containers',
};

const MinorString = z
  .string()
  .regex(/^\d+$/, 'Amount must be integer minor units')
  .refine((v) => BigInt(v) > 0n, 'Amount must be positive')
  .refine((v) => BigInt(v) <= 10_000_000n, 'Amount exceeds the demo ceiling of 100,000.00');

const TimeZoneSchema = z.string().refine(isValidTimeZone, 'Unknown IANA time zone');

/** Confirmed, testable intent (backend spec §6). Stored immutably once confirmed. */
export const IntentSpecSchema = z
  .object({
    productKind: ProductKindSchema,
    productLabel: z.string().min(2).max(120),
    quantity: z.number().int().positive().max(100_000),
    unit: z.string().min(1).max(24),
    requiredAttributes: z.array(AttributeSchema).max(12),
    prohibitedAttributes: z.array(AttributeSchema).max(12),
    budgetMinor: MinorString,
    currency: z.literal('USD'),
    deadlineISO: z.string().datetime({ offset: true }),
    timezone: TimeZoneSchema,
    hardConstraints: z.array(z.string().max(200)).max(20),
    softPreferences: z.array(z.string().max(200)).max(20),
    assumptions: z.array(z.string().max(300)).max(20),
    unresolvedQuestions: z.array(z.string().max(300)).max(20),
  })
  .superRefine((spec, ctx) => {
    const overlap = spec.requiredAttributes.filter((a) => spec.prohibitedAttributes.includes(a));
    if (overlap.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['prohibitedAttributes'],
        message: `An attribute cannot be both required and prohibited: ${overlap.join(', ')}`,
      });
    }
  });
export type IntentSpec = z.infer<typeof IntentSpecSchema>;

export const BuyerTypeSchema = z.enum(['ORG', 'BUSINESS']);
export type BuyerType = z.infer<typeof BuyerTypeSchema>;

export const CompileIntentRequestSchema = z.object({
  rawText: z.string().trim().min(8).max(2000),
  buyerType: BuyerTypeSchema,
  currency: z.literal('USD').default('USD'),
  timezone: TimeZoneSchema,
});
export type CompileIntentRequest = z.infer<typeof CompileIntentRequestSchema>;

export type SourceSpan = { start: number; end: number; text: string };

export type IntentField =
  | 'quantity'
  | 'productKind'
  | 'requiredAttributes'
  | 'prohibitedAttributes'
  | 'budgetMinor'
  | 'deadlineISO';

/** Draft produced by the compiler. Missing hard fields stay null and become clarification questions. */
export type IntentDraft = {
  productKind: ProductKind | null;
  productLabel: string | null;
  quantity: number | null;
  unit: string;
  requiredAttributes: Attribute[];
  prohibitedAttributes: Attribute[];
  budgetMinor: string | null;
  currency: 'USD';
  deadlineISO: string | null;
  timezone: string;
  hardConstraints: string[];
  softPreferences: string[];
  assumptions: string[];
  unresolvedQuestions: string[];
};

export type CompileIntentResponse = {
  draft: IntentDraft;
  sourceSpans: Partial<Record<IntentField, SourceSpan[]>>;
  complete: boolean;
  validationIssues: string[];
  ignoredInstructions: string[];
  compiler: { provider: string; model: string; promptVersion: string; compilerVersion: string };
};

export const CreatePurchaseRequestSchema = z.object({
  rawText: z.string().trim().min(8).max(2000),
  intent: IntentSpecSchema,
  confirmed: z.literal(true),
  compilerVersion: z.string().max(64),
});
export type CreatePurchaseRequest = z.infer<typeof CreatePurchaseRequestSchema>;

export const CreateMissionRequestSchema = CreatePurchaseRequestSchema.extend({
  title: z.string().trim().min(3).max(120),
});
export type CreateMissionRequest = z.infer<typeof CreateMissionRequestSchema>;
