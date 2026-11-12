import { Injectable } from '@nestjs/common';
import type { PresenceView, Role, TenantKind } from '@promesa/contracts';
import type { Principal } from '../identity/principal';

const FRESH_MS = 30_000;

type Seen = {
  userId: string;
  displayName: string;
  tenantName: string;
  tenantKind: TenantKind;
  role: Role;
  missionId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
};

/**
 * In-memory "who is looking at this mission right now". Browsers send a heartbeat every few
 * seconds; an entry expires after 30 s of silence. Single-process only and never used for authorization.
 */
@Injectable()
export class PresenceService {
  private readonly seen = new Map<string, Seen>();

  heartbeat(principal: Principal, missionId: string | null, now = Date.now()) {
    const key = `${principal.userId}:${principal.tenantId}:${principal.role}`;
    const prev = this.seen.get(key);
    this.seen.set(key, {
      userId: principal.userId,
      displayName: principal.displayName,
      tenantName: principal.tenantName,
      tenantKind: principal.tenantKind,
      role: principal.role,
      missionId,
      firstSeenAt: prev && prev.missionId === missionId ? prev.firstSeenAt : now,
      lastSeenAt: now,
    });
  }

  list(viewer: Principal, missionId: string | null, now = Date.now()): PresenceView {
    for (const [key, s] of this.seen) if (now - s.lastSeenAt > FRESH_MS) this.seen.delete(key);
    const all = [...this.seen.values()];
    const here = missionId ? all.filter((s) => s.missionId === missionId) : all;
    return {
      onlineTotal: new Set(all.map((s) => s.userId)).size,
      users: here
        .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
        .map((s) => ({
          userId: s.userId,
          displayName: s.displayName,
          tenantName: s.tenantName,
          tenantKind: s.tenantKind,
          role: s.role,
          isYou: s.userId === viewer.userId,
          since: new Date(s.firstSeenAt).toISOString(),
        })),
    };
  }
}
