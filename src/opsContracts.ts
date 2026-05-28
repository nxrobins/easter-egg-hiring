export const REMOTE_DRAFT_WRITE_INTERVAL_MS = 10_000
export const LOCAL_DRAFT_PERSISTENCE_TIMEOUT_MS = 1_000
export const DRAFT_BODY_MAX_BYTES = 64 * 1024
export const PUBLIC_ROLE_PAYLOAD_MAX_BYTES = 32 * 1024
export const ARTIFACT_PAYLOAD_MAX_BYTES = 8 * 1024
export const SUBMIT_TRANSACTION_TIMEOUT_MS = 5_000
export const REVIEWER_HANDOFF_MAX_LAG_MS = 60_000
export const RECONCILER_INTERVAL_MS = 60_000
export const ILLEGAL_STATE_REPAIR_THRESHOLD_MS = 120_000
export const MAX_PENDING_WRITES_PER_DRAFT_KEY = 1

export const operationalErrorCodes = [
  'DraftWriteRateExceeded',
  'DraftVersionConflict',
  'PayloadTooLarge',
  'RoleNotFound',
  'InvalidArtifactSet',
  'ConsentRequired',
  'InvalidAttemptTransition',
  'SubmitTransactionFailed',
  'DraftPersistenceError',
  'DraftFlushFailed',
  'MissingTraceContext',
  'LogRedactionError',
] as const

export type OperationalErrorCode = (typeof operationalErrorCodes)[number]

export class OperationalError extends Error {
  code: OperationalErrorCode
  httpStatus: number

  constructor(code: OperationalErrorCode, message: string, httpStatus = 500) {
    super(message)
    this.name = code
    this.code = code
    this.httpStatus = httpStatus
  }
}

export const attemptStates = [
  'created',
  'consented',
  'draft_active',
  'submitted',
  'receipt_issued',
  'review_ready',
  'needs_repair',
] as const

export type AttemptState = (typeof attemptStates)[number]

export const requiredTraceFields = ['traceId', 'candidateAttemptId', 'roleId', 'artifactId'] as const
export type RequiredTraceField = (typeof requiredTraceFields)[number]

export type TraceContext = Record<RequiredTraceField, string>

export const requiredMetricNames = [
  'invalid_route_rate',
  'generation_rejection_rate',
  'autosave_latency_ms',
  'autosave_failure_rate',
  'draft_size_p95_bytes',
  'consent_to_start_conversion',
  'start_to_submit_conversion',
  'submit_transaction_failure_rate',
  'review_handoff_failure_rate',
] as const

export type RequiredMetricName = (typeof requiredMetricNames)[number]

export const forbiddenLogFields = [
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
] as const

type TransitionGuard = {
  hasConsent?: boolean
  hasDraft?: boolean
  hasSubmission?: boolean
  hasReceipt?: boolean
}

type AttemptSnapshot = {
  state: string
  updatedAtMs: number
  nowMs?: number
  isComplete?: boolean
}

const nextAttemptState: Partial<Record<AttemptState, AttemptState>> = {
  created: 'consented',
  consented: 'draft_active',
  draft_active: 'submitted',
  submitted: 'receipt_issued',
  receipt_issued: 'review_ready',
}

const forbiddenLogFieldSet = new Set<string>(forbiddenLogFields.map((field) => field.toLowerCase()))

export function byteSize(value: string) {
  return new TextEncoder().encode(value).length
}

export function assertDraftBodySize(value: string) {
  assertByteLimit(value, DRAFT_BODY_MAX_BYTES, 'Draft body exceeds 64KB.')
}

export function assertPublicRolePayloadSize(value: string) {
  assertByteLimit(value, PUBLIC_ROLE_PAYLOAD_MAX_BYTES, 'Public role payload exceeds 32KB.')
}

export function assertArtifactPayloadSize(value: string) {
  assertByteLimit(value, ARTIFACT_PAYLOAD_MAX_BYTES, 'Artifact payload exceeds 8KB.')
}

export function assertAttemptTransition(from: AttemptState, to: AttemptState, guard: TransitionGuard = {}) {
  if (to === 'needs_repair') return

  if (from === 'needs_repair' || nextAttemptState[from] !== to) {
    throw new OperationalError('InvalidAttemptTransition', `Invalid attempt transition: ${from} -> ${to}.`, 409)
  }

  if ((to === 'consented' || to === 'draft_active') && !guard.hasConsent) {
    throw new OperationalError('ConsentRequired', `Consent is required before transition: ${from} -> ${to}.`, 409)
  }

  if (to === 'submitted' && (!guard.hasDraft || !guard.hasSubmission)) {
    throw new OperationalError('InvalidAttemptTransition', 'Submission requires a current draft and submission record.', 409)
  }

  if (to === 'receipt_issued' && !guard.hasReceipt) {
    throw new OperationalError('InvalidAttemptTransition', 'Receipt transition requires receipt data.', 409)
  }
}

export function assertTraceContext(context: Partial<Record<RequiredTraceField, string | null | undefined>>) {
  for (const field of requiredTraceFields) {
    const value = context[field]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new OperationalError('MissingTraceContext', `Missing trace context field: ${field}.`, 400)
    }
  }

  return context as TraceContext
}

export function assertLogPayloadSafe(payload: Record<string, unknown>) {
  const forbiddenField = findForbiddenLogField(payload)
  if (forbiddenField) {
    throw new OperationalError('LogRedactionError', `Structured log contains forbidden field: ${forbiddenField}.`, 500)
  }
}

export function isAttemptState(value: string): value is AttemptState {
  return (attemptStates as readonly string[]).includes(value)
}

export function classifyAttemptForRepair(snapshot: AttemptSnapshot): AttemptState {
  const nowMs = snapshot.nowMs ?? Date.now()
  const isStale = nowMs - snapshot.updatedAtMs >= ILLEGAL_STATE_REPAIR_THRESHOLD_MS
  const isComplete = snapshot.isComplete ?? true

  if (snapshot.state === 'needs_repair') return 'needs_repair'
  if ((!isAttemptState(snapshot.state) || !isComplete) && isStale) return 'needs_repair'
  if (!isAttemptState(snapshot.state)) {
    throw new OperationalError('InvalidAttemptTransition', `Unknown attempt state: ${snapshot.state}.`, 409)
  }

  return snapshot.state
}

function assertByteLimit(value: string, limit: number, message: string) {
  if (byteSize(value) > limit) {
    throw new OperationalError('PayloadTooLarge', message, 413)
  }
}

function findForbiddenLogField(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const forbiddenField = findForbiddenLogField(item)
      if (forbiddenField) return forbiddenField
    }
    return null
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenLogFieldSet.has(key.toLowerCase())) return key
    const forbiddenField = findForbiddenLogField(child)
    if (forbiddenField) return forbiddenField
  }

  return null
}
