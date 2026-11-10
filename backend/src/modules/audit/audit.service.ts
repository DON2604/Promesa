import { Injectable } from '@nestjs/common';
import { hashObject } from '../../common/hash';
import { type Tx } from '../../infra/prisma.service';

export type AuditInput = {
  tenantId: string | null;
  actorType: 'USER' | 'SYSTEM' | 'DEMO_SIMULATOR';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  policyDecision?: string;
  before?: unknown;
  after?: unknown;
  correlationId: string;
};

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK_KEY = 7_204_311;

/**
 * Append-only audit with a rolling SHA-256 chain. The chain is a tamper-evidence signal over
 * stored rows only; it is not a blockchain and not a proof of real-world truth.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, input: AuditInput) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
    const last = await tx.auditLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { entryHash: true },
    });
    const prevHash = last?.entryHash ?? GENESIS;
    const beforeHash = input.before === undefined ? null : hashObject(input.before);
    const afterHash = input.after === undefined ? null : hashObject(input.after);
    const createdAt = new Date();
    const entryHash = hashObject({
      prevHash,
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      policyDecision: input.policyDecision ?? null,
      beforeHash,
      afterHash,
      createdAt,
    });
    return tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        policyDecision: input.policyDecision,
        beforeHash,
        afterHash,
        correlationId: input.correlationId,
        prevHash,
        entryHash,
        createdAt,
      },
    });
  }
}
