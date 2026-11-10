import { type Tx } from '../../infra/prisma.service';

export type Clock = { now: Date; simulated: boolean };

/** Scenario-bound records use their simulated clock; everything else uses the real wall clock. */
export async function resolveClock(tx: Tx, scenarioKey: string | null | undefined): Promise<Clock> {
  if (scenarioKey) {
    const clock = await tx.demoClock.findUnique({ where: { scenarioKey } });
    if (clock) return { now: clock.simulatedNow, simulated: true };
  }
  return { now: new Date(), simulated: false };
}
