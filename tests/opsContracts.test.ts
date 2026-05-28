import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_PAYLOAD_MAX_BYTES,
  DRAFT_BODY_MAX_BYTES,
  ILLEGAL_STATE_REPAIR_THRESHOLD_MS,
  LOCAL_DRAFT_PERSISTENCE_TIMEOUT_MS,
  OperationalError,
  PUBLIC_ROLE_PAYLOAD_MAX_BYTES,
  REMOTE_DRAFT_WRITE_INTERVAL_MS,
  assertAttemptTransition,
  assertArtifactPayloadSize,
  assertDraftBodySize,
  assertLogPayloadSafe,
  assertPublicRolePayloadSize,
  assertTraceContext,
  classifyAttemptForRepair,
  forbiddenLogFields,
  requiredMetricNames,
  requiredTraceFields,
} from '../src/opsContracts'
import type { OperationalErrorCode } from '../src/opsContracts'

function expectOperationalCode(action: () => void, code: OperationalErrorCode) {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(OperationalError)
  expect((thrown as OperationalError).code).toBe(code)
}

describe('operations contract constants', () => {
  it('keeps production limits exact and boring', () => {
    expect(REMOTE_DRAFT_WRITE_INTERVAL_MS).toBe(10_000)
    expect(LOCAL_DRAFT_PERSISTENCE_TIMEOUT_MS).toBe(1_000)
    expect(DRAFT_BODY_MAX_BYTES).toBe(64 * 1024)
    expect(PUBLIC_ROLE_PAYLOAD_MAX_BYTES).toBe(32 * 1024)
    expect(ARTIFACT_PAYLOAD_MAX_BYTES).toBe(8 * 1024)
  })

  it('defines required trace fields and telemetry metric names', () => {
    expect(requiredTraceFields).toEqual(['traceId', 'candidateAttemptId', 'roleId', 'artifactId'])
    expect(requiredMetricNames).toEqual([
      'invalid_route_rate',
      'generation_rejection_rate',
      'autosave_latency_ms',
      'autosave_failure_rate',
      'draft_size_p95_bytes',
      'consent_to_start_conversion',
      'start_to_submit_conversion',
      'submit_transaction_failure_rate',
      'review_handoff_failure_rate',
    ])
  })
})

describe('attempt state machine', () => {
  it('allows legal transitions only in order', () => {
    expect(() => assertAttemptTransition('created', 'consented', { hasConsent: true })).not.toThrow()
    expect(() => assertAttemptTransition('consented', 'draft_active', { hasConsent: true })).not.toThrow()
    expect(() =>
      assertAttemptTransition('draft_active', 'submitted', { hasDraft: true, hasSubmission: true }),
    ).not.toThrow()
    expect(() => assertAttemptTransition('submitted', 'receipt_issued', { hasReceipt: true })).not.toThrow()
    expect(() => assertAttemptTransition('receipt_issued', 'review_ready')).not.toThrow()
  })

  it('rejects skipped transitions', () => {
    expectOperationalCode(
      () =>
        assertAttemptTransition('created', 'submitted', {
          hasConsent: true,
          hasDraft: true,
          hasSubmission: true,
        }),
      'InvalidAttemptTransition',
    )
  })

  it('rejects draft activation without consent', () => {
    expectOperationalCode(() => assertAttemptTransition('consented', 'draft_active'), 'ConsentRequired')
  })

  it('classifies stale illegal or incomplete states as repair work', () => {
    expect(
      classifyAttemptForRepair({
        state: 'orphaned_submission',
        updatedAtMs: 0,
        nowMs: ILLEGAL_STATE_REPAIR_THRESHOLD_MS,
      }),
    ).toBe('needs_repair')

    expect(
      classifyAttemptForRepair({
        state: 'submitted',
        updatedAtMs: 0,
        nowMs: ILLEGAL_STATE_REPAIR_THRESHOLD_MS,
        isComplete: false,
      }),
    ).toBe('needs_repair')

    expect(
      classifyAttemptForRepair({
        state: 'draft_active',
        updatedAtMs: 0,
        nowMs: ILLEGAL_STATE_REPAIR_THRESHOLD_MS,
        isComplete: true,
      }),
    ).toBe('draft_active')
  })
})

describe('payload, trace, and logging validators', () => {
  it('rejects oversized payloads with PayloadTooLarge', () => {
    expectOperationalCode(() => assertDraftBodySize('x'.repeat(DRAFT_BODY_MAX_BYTES + 1)), 'PayloadTooLarge')
    expectOperationalCode(
      () => assertPublicRolePayloadSize('x'.repeat(PUBLIC_ROLE_PAYLOAD_MAX_BYTES + 1)),
      'PayloadTooLarge',
    )
    expectOperationalCode(
      () => assertArtifactPayloadSize('x'.repeat(ARTIFACT_PAYLOAD_MAX_BYTES + 1)),
      'PayloadTooLarge',
    )
  })

  it('rejects trace events missing any required context field', () => {
    expectOperationalCode(
      () =>
        assertTraceContext({
          traceId: 'trace-1',
          candidateAttemptId: 'attempt-1',
          roleId: 'role-1',
        }),
      'MissingTraceContext',
    )

    expect(
      assertTraceContext({
        traceId: 'trace-1',
        candidateAttemptId: 'attempt-1',
        roleId: 'role-1',
        artifactId: 'artifact-1',
      }),
    ).toEqual({
      traceId: 'trace-1',
      candidateAttemptId: 'attempt-1',
      roleId: 'role-1',
      artifactId: 'artifact-1',
    })
  })

  it('rejects forbidden raw content fields in structured logs', () => {
    expect(forbiddenLogFields).toEqual([
      'jobDescription',
      'draft',
      'code',
      'starterCode',
      'solution',
      'answerKey',
      'replayDelta',
      'finalCode',
      'candidateCode',
      'editorSnapshot',
      'diff',
      'reviewPacket',
    ])

    for (const field of forbiddenLogFields) {
      expectOperationalCode(() => assertLogPayloadSafe({ [field]: 'raw content' }), 'LogRedactionError')
    }

    expectOperationalCode(
      () =>
        assertLogPayloadSafe({
          traceId: 'trace-1',
          nested: { draft: 'candidate answer' },
        }),
      'LogRedactionError',
    )

    expect(() =>
      assertLogPayloadSafe({
        traceId: 'trace-1',
        candidateAttemptId: 'attempt-1',
        roleId: 'role-1',
        artifactId: 'artifact-1',
        byteSize: 2048,
        contentHash: 'sha256:abc',
        state: 'draft_active',
        errorCode: 'PayloadTooLarge',
      }),
    ).not.toThrow()
  })
})
