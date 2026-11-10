'use client';

import { IntentComposer } from '@/components/intent/intent-composer';
import { RoleGate } from '@/components/role-gate';
import { Kicker } from '@/components/ui';

export default function NewPurchasePage() {
  return (
    <RoleGate tenantKind="BUSINESS" roles={['BUYER']}>
      {(me) => (
        <div className="space-y-8">
          <header>
            <Kicker>New purchase · {me.activeTenant.name}</Kicker>
            <h1 className="font-display mt-2 text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
              Protect a purchase
            </h1>
            <p className="mt-2 max-w-2xl text-muted">
              Describe what you need. Promesa turns it into constraints a merchant can accept, and
              opens a PromiseTwin that tracks whether the promise is kept.
            </p>
          </header>
          <IntentComposer mode="purchase" defaultTimezone={me.activeTenant.timezone} />
        </div>
      )}
    </RoleGate>
  );
}
