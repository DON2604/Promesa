import { Injectable } from '@nestjs/common';
import {
  type EvidenceAssertion,
  type EvidenceKind,
  type IntentSpec,
  type ProvenanceSource,
  type VerificationLevel,
} from '@promesa/contracts';
import { type Prisma } from '@prisma/client';
import { hashObject } from '../../common/hash';
import { type Tx } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../events/outbox.service';
import { EVALUATOR_VERSION, POLICY_VERSION, type CommitmentFacts, evaluateTwin } from './evaluator';

export type EvidenceInput = {
  kind: EvidenceKind;
  assertion: EvidenceAssertion;
  source: ProvenanceSource;
  sourceEventId: string;
  summary: string;
  occurredAt: Date;
  observedAt: Date;
  ingestedAt?: Date;
  verification: VerificationLevel;
  isSimulated: boolean;
  payload: Record<string, unknown>;
  attestedBy?: string;
};

export type Actor = {
  type: 'USER' | 'SYSTEM' | 'DEMO_SIMULATOR';
  id: string;
  correlationId: string;
};

export type AcceptedTerms = {
  sku: string;
  title: string;
  material: string[];
  quantity: number;
  totalMinor: string;
  currency: string;
  deliverBy: string;
  deliveryTimezone: string;
  refundPolicy: string;
  cancellationPolicy: string;
};

/**
 * Single write path for PromiseTwin facts. Evidence and evaluations are append-only;
 * snapshots are appended only when the evaluated state actually changes.
 */
@Injectable()
export class TwinEngine {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async appendEvidence(tx: Tx, twinId: string, input: EvidenceInput, actor: Actor) {
    const twin = await tx.promiseTwin.findUniqueOrThrow({ where: { id: twinId } });
    const checksum = hashObject({
      kind: input.kind,
      assertion: input.assertion,
      source: input.source,
      sourceEventId: input.sourceEventId,
      occurredAt: input.occurredAt,
      payload: input.payload,
    });
    const evidence = await tx.evidence.create({
      data: {
        tenantId: twin.tenantId,
        twinId,
        kind: input.kind,
        assertionType: input.assertion,
        source: input.source,
        sourceEventId: input.sourceEventId,
        summary: input.summary,
        occurredAt: input.occurredAt,
        observedAt: input.observedAt,
        ingestedAt: input.ingestedAt ?? new Date(),
        payloadJson: input.payload as Prisma.InputJsonValue,
        verificationLevel: input.verification,
        isSimulated: input.isSimulated,
        attestedBy: input.attestedBy,
        checksum,
      },
    });
    const version = twin.aggregateVersion + 1;
    await tx.promiseTwin.update({ where: { id: twinId }, data: { aggregateVersion: version } });
    await this.outbox.append(tx, {
      tenantId: twin.tenantId,
      aggregateType: 'twin',
      aggregateId: twinId,
      version,
      eventType: 'twin.evidence_added',
      payload: { evidenceId: evidence.id, assertion: input.assertion, kind: input.kind },
      isSimulated: input.isSimulated,
    });
    await this.audit.record(tx, {
      tenantId: twin.tenantId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'twin.evidence.append',
      resourceType: 'evidence',
      resourceId: evidence.id,
      after: { checksum },
      correlationId: actor.correlationId,
    });
    return evidence;
  }

  async evaluate(
    tx: Tx,
    twinId: string,
    opts: { now: Date; simulatedClock: boolean; actor: Actor; label?: string },
  ) {
    const twin = await tx.promiseTwin.findUniqueOrThrow({
      where: { id: twinId },
      include: {
        evidence: true,
        purchase: { include: { commitment: true, captures: true } },
        snapshots: { orderBy: { eventSeq: 'desc' }, take: 1 },
      },
    });
    const intent = twin.intentSnapshotJson as unknown as IntentSpec;
    const commitment = twin.purchase.commitment;
    const terms = commitment?.acceptedTermsJson as unknown as AcceptedTerms | undefined;
    const commitmentFacts: CommitmentFacts | null =
      commitment && terms && !commitment.revokedAt
        ? {
            id: commitment.id,
            version: commitment.version,
            attributes: terms.material,
            quantity: terms.quantity,
            totalMinor: BigInt(terms.totalMinor),
            currency: terms.currency,
            deliverBy: new Date(terms.deliverBy),
          }
        : null;
    const capture = twin.purchase.captures.at(-1);

    const result = evaluateTwin({
      intent,
      commitment: commitmentFacts,
      evidence: twin.evidence.map((e) => ({
        id: e.id,
        kind: e.kind as EvidenceKind,
        assertion: e.assertionType as EvidenceAssertion,
        source: e.source as ProvenanceSource,
        verification: e.verificationLevel as VerificationLevel,
        occurredAt: e.occurredAt,
        observedAt: e.observedAt,
        payload: e.payloadJson as Record<string, unknown>,
      })),
      payment: {
        capturedMinor: capture?.amountMinor ?? null,
        captureStatus: capture?.paypalStatus ?? null,
        paypalCaptureId: capture?.paypalCaptureId ?? null,
      },
      now: opts.now,
      simulatedClock: opts.simulatedClock,
    });

    const version = twin.evaluationVersion + 1;
    const evaluation = await tx.twinEvaluation.create({
      data: {
        twinId,
        version,
        model: 'deterministic',
        modelVersion: EVALUATOR_VERSION,
        promptVersion: 'n/a',
        policyVersion: POLICY_VERSION,
        evidenceIdsJson: result.evidenceIds,
        constraintResultsJson: result.constraints as unknown as Prisma.InputJsonValue,
        causeHypothesesJson: result.causes as unknown as Prisma.InputJsonValue,
        resultJson: {
          evidenceGaps: result.evidenceGaps,
          facts: result.facts,
          predictions: result.predictions,
        } as unknown as Prisma.InputJsonValue,
        health: result.health,
        rationale: result.interpretation,
        clockNow: opts.now,
        clockSimulated: opts.simulatedClock,
        constraintEvaluations: {
          create: result.constraints.map((c) => ({
            constraintId: c.constraintId,
            status: c.status,
            evidenceIds: c.evidenceIds,
            sellerCommitmentId: c.sellerCommitted ? (commitmentFacts?.id ?? null) : null,
            policyRuleId: `${POLICY_VERSION}#${c.constraintId}`,
            explanation: c.explanation,
          })),
        },
      },
    });

    const state = {
      health: result.health,
      commitmentVersion: commitmentFacts?.version ?? null,
      evidenceIds: result.evidenceIds,
      evaluationVersion: version,
      constraints: result.constraints,
      interpretation: result.interpretation,
    };
    const stateHash = hashObject({ ...state, evaluationVersion: undefined });
    const previous = twin.snapshots[0];
    const previousHash = previous
      ? hashObject({
          ...(previous.stateJson as Record<string, unknown>),
          evaluationVersion: undefined,
        })
      : null;
    const changed = stateHash !== previousHash;
    const aggregateVersion = twin.aggregateVersion + 1;

    if (changed) {
      const eventSeq = (previous?.eventSeq ?? 0) + 1;
      await tx.twinSnapshot.create({
        data: {
          twinId,
          aggregateVersion,
          eventSeq,
          label:
            opts.label ??
            `Evaluation v${version}: ${result.health.replace('_', ' ').toLowerCase()}`,
          stateJson: state as unknown as Prisma.InputJsonValue,
          knownAt: opts.now,
          snapshotHash: hashObject({ twinId, eventSeq, state }),
          isSimulated: opts.simulatedClock || twin.purchase.isDemo,
        },
      });
    }

    await tx.promiseTwin.update({
      where: { id: twinId },
      data: {
        health: result.health,
        evaluationVersion: version,
        aggregateVersion,
        lastEvaluatedAt: opts.now,
        commitmentSnapshotJson: (terms ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.outbox.append(tx, {
      tenantId: twin.tenantId,
      aggregateType: 'twin',
      aggregateId: twinId,
      version: aggregateVersion,
      eventType: changed ? 'twin.health_changed' : 'twin.evaluated',
      payload: { evaluationId: evaluation.id, health: result.health, evaluationVersion: version },
      isSimulated: opts.simulatedClock,
    });
    await this.audit.record(tx, {
      tenantId: twin.tenantId,
      actorType: opts.actor.type,
      actorId: opts.actor.id,
      action: 'twin.evaluate',
      resourceType: 'promise_twin',
      resourceId: twinId,
      policyDecision: `${POLICY_VERSION}:${result.health}`,
      before: { health: twin.health, evaluationVersion: twin.evaluationVersion },
      after: { health: result.health, evaluationVersion: version },
      correlationId: opts.actor.correlationId,
    });
    return { evaluation, result, changed };
  }
}
