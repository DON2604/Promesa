import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { type Tx } from '../../infra/prisma.service';

export type OutboxInput = {
  tenantId: string;
  aggregateType: 'twin' | 'purchase' | 'mission' | 'demo';
  aggregateId: string;
  version: number;
  eventType: string;
  payload: Prisma.InputJsonValue;
  isSimulated?: boolean;
};

const MARKETPLACE_ROLES = ['SPONSOR', 'MERCHANT_ADMIN', 'MERCHANT_OPERATOR'] as const;

/**
 * Transactional outbox: call inside the same transaction as the state change so an event exists
 * if and only if the state committed. SSE and (Phase 2) BullMQ dispatch read from this table.
 */
@Injectable()
export class OutboxService {
  async append(tx: Tx, event: OutboxInput) {
    return tx.outboxEvent.create({
      data: {
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        version: event.version,
        eventType: event.eventType,
        payloadJson: event.payload,
        isSimulated: event.isSimulated ?? false,
      },
    });
  }

  /**
   * One row per tenant that can see the mission: the organization, its merchants and sponsors,
   * merchants with offers, and (while published) every sponsor and merchant tenant. The SSE stream
   * is tenant-filtered, so this is what lets a sponsor or merchant in another browser see changes live.
   */
  async appendMission(tx: Tx, event: Omit<OutboxInput, 'tenantId' | 'aggregateType'>) {
    const mission = await tx.mission.findUniqueOrThrow({
      where: { id: event.aggregateId },
      select: {
        orgTenantId: true,
        visibility: true,
        orders: { select: { merchantTenantId: true, sponsorTenantId: true } },
        proposals: { select: { merchantTenantId: true } },
      },
    });
    const audience = new Set<string>([mission.orgTenantId]);
    for (const o of mission.orders) {
      audience.add(o.merchantTenantId);
      if (o.sponsorTenantId) audience.add(o.sponsorTenantId);
    }
    for (const p of mission.proposals) audience.add(p.merchantTenantId);
    if (mission.visibility === 'PUBLIC') {
      const market = await tx.membership.findMany({
        where: { role: { in: [...MARKETPLACE_ROLES] } },
        select: { tenantId: true },
        distinct: ['tenantId'],
      });
      for (const m of market) audience.add(m.tenantId);
    }
    for (const tenantId of audience) {
      await this.append(tx, { ...event, tenantId, aggregateType: 'mission' });
    }
  }
}
