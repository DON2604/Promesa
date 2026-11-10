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
}
