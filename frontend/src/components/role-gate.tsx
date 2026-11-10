'use client';

import type { ReactNode } from 'react';
import type { Me, Role, TenantKind } from '@promesa/contracts';
import { humanize } from '@/lib/format';
import { useMe } from '@/lib/queries';
import { ButtonLink, LoadingSheet, StateBlock } from './ui';

/** UX gate only. The API enforces the same roles on every request. */
export function RoleGate({
  tenantKind,
  roles,
  children,
}: {
  tenantKind: TenantKind;
  roles: Role[];
  children: (me: Me) => ReactNode;
}) {
  const me = useMe();
  if (!me.data) return <LoadingSheet />;
  const ok = me.data.activeTenant.kind === tenantKind && roles.includes(me.data.activeRole);
  if (ok) return <>{children(me.data)}</>;
  const eligible = me.data.memberships.filter(
    (m) => m.tenantKind === tenantKind && roles.includes(m.role),
  );
  return (
    <StateBlock
      title={`This needs the ${roles.map(humanize).join(' or ')} role in a ${tenantKind === 'ORG' ? 'community organisation' : 'business'} workspace.`}
      action={
        <ButtonLink href="/dashboard" variant="secondary">
          Back to overview
        </ButtonLink>
      }
    >
      {eligible.length > 0
        ? `Switch to ${eligible[0]?.tenantName} using the workspace selector at the top.`
        : 'Sign in as a persona that holds this role.'}
    </StateBlock>
  );
}
