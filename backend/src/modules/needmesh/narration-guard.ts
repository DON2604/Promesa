const MONEY = /\$\s?\d[\d,]*(?:\.\d+)?/g;

const normalize = (figure: string) => Number(figure.replace(/[$,\s]/g, '')).toFixed(2);

/**
 * A model may rephrase, but it must not introduce a dollar figure that the deterministic planner
 * did not produce. Any unknown figure rejects the whole narration and the deterministic text is
 * used instead. Text is explanation only; it never reaches the policy engine.
 */
export function figuresAreGrounded(output: string, facts: unknown): boolean {
  const allowed = new Set((JSON.stringify(facts).match(MONEY) ?? []).map(normalize));
  return (output.match(MONEY) ?? []).map(normalize).every((figure) => allowed.has(figure));
}
