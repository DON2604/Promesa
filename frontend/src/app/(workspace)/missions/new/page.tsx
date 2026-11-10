'use client';

import { IntentComposer } from '@/components/intent/intent-composer';
import { RoleGate } from '@/components/role-gate';
import { Kicker } from '@/components/ui';
import { useOrgProfile } from '@/lib/queries';

export default function NewMissionPage() {
  const profile = useOrgProfile();
  return (
    <RoleGate tenantKind="ORG" roles={['ORG_ADMIN', 'ORG_OPERATOR']}>
      {(me) => (
        <div className="space-y-8">
          <header>
            <Kicker>AI Mission Studio · {me.activeTenant.name}</Kicker>
            <h1 className="font-display mt-2 text-[clamp(2rem,4vw,3rem)] leading-[1.05]">
              Tell us what’s needed
            </h1>
            <p className="mt-2 max-w-2xl text-muted">
              Type or speak the need. AI separates hard rules (quantity, budget, deadline,
              materials) from soft preferences, asks about anything missing, and shows the Mission
              Blueprint for you to edit and confirm. Agents then source, negotiate and plan merchant
              orders; sponsors fund each one through PayPal.
            </p>
          </header>
          <IntentComposer
            mode="mission"
            defaultTimezone={me.activeTenant.timezone}
            preferences={profile.data?.preferences}
          />
        </div>
      )}
    </RoleGate>
  );
}
