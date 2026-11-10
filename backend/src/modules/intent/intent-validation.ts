import { type IntentDraft, type IntentSpec, IntentSpecSchema } from '@promesa/contracts';

export type IntentValidation =
  { ok: true; spec: IntentSpec; issues: string[] } | { ok: false; issues: string[] };

const MIN_LEAD_MS = 60 * 60 * 1000;

/** Deterministic checks that run after any compiler (fixture or LLM). The model never has the last word. */
export function validateIntent(candidate: IntentDraft | IntentSpec, now: Date): IntentValidation {
  const parsed = IntentSpecSchema.safeParse(candidate);
  const issues: string[] = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || 'intent';
      issues.push(`${field}: ${issue.message}`);
    }
    return { ok: false, issues };
  }
  const spec = parsed.data;
  const deadline = new Date(spec.deadlineISO);
  if (deadline.getTime() < now.getTime() + MIN_LEAD_MS) {
    issues.push('deadlineISO: The deadline must be at least one hour in the future.');
  }
  if (spec.requiredAttributes.length === 0 && spec.prohibitedAttributes.length === 0) {
    issues.push(
      'requiredAttributes: Add at least one required or prohibited attribute so offers can be tested.',
    );
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec, issues };
}
