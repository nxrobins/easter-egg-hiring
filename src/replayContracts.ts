import type { CandidateArtifact, PublicCandidatePayload } from './candidateData'
import { assertTraceContext, byteSize } from './opsContracts'
import type { TraceContext } from './opsContracts'

export const REPLAY_PACKET_MAX_BYTES = 512 * 1024
export const REPLAY_EVENT_MAX_COUNT = 600
export const REPLAY_DELTA_INSERT_MAX_CHARS = 2048
export const REPLAY_EVENT_LABEL_MAX_CHARS = 80
export const LOCAL_REVIEW_PACKET_MAX_COUNT = 10

export const replayErrorCodes = [
  'ReplayConsentRequired',
  'ReplayPayloadTooLarge',
  'ReplayEventLimitExceeded',
  'ReplayDeltaTooLarge',
  'ReplayCaptureError',
  'ReplayPersistenceError',
  'ReviewPacketNotFound',
  'ReplaySummaryIntegrityError',
] as const

export type ReplayErrorCode = (typeof replayErrorCodes)[number]

export class ReplayError extends Error {
  code: ReplayErrorCode

  constructor(code: ReplayErrorCode, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

export const replayEventTypes = [
  'consent_accepted',
  'editor_focus',
  'editor_blur',
  'editor_change',
  'clipboard_blocked',
  'reset_requested',
  'reset_confirmed',
  'reset_cancelled',
  'artifact_switch_blocked',
  'draft_autosaved',
  'submit_clicked',
  'draft_flushed',
  'receipt_issued',
] as const

export type ReplayEventType = (typeof replayEventTypes)[number]

export type ReplayDelta = {
  start: number
  deleteCount: number
  insertedText: string
}

export type ReplayEvent = {
  eventId: string
  type: ReplayEventType
  sequence: number
  atMs: number
  label: string
  trace: TraceContext
  delta?: ReplayDelta
  metadata?: Record<string, string | number | boolean>
}

export type ReplayRecording = {
  schemaVersion: 1
  trace: TraceContext
  starterCode: string
  consentAcceptedAt: string
  startedAtMs: number
  events: ReplayEvent[]
}

export type ReviewPacket = {
  schemaVersion: 1
  packetId: string
  createdAt: string
  submittedAt: string
  attemptState: 'receipt_issued'
  roleId: string
  artifactId: string
  traceId: string
  candidateAttemptId: string
  company: string
  role: string
  artifact: Pick<
    CandidateArtifact,
    | 'artifactId'
    | 'artifactType'
    | 'artifactTitle'
    | 'artifactExcerpt'
    | 'roleRelevance'
    | 'task'
    | 'acceptanceCriteria'
    | 'reviewerSignals'
    | 'timeEstimate'
    | 'difficulty'
  >
  consentAcceptedAt: string
  starterCode: string
  finalCode: string
  diff: LineDiff[]
  replayEvents: ReplayEvent[]
  processSummary: string[]
}

export type ReviewPacketListItem = {
  packetId: string
  createdAt: string
  company: string
  role: string
  artifactTitle: string
  candidateAttemptId: string
}

export type LineDiff = {
  kind: 'unchanged' | 'added' | 'removed'
  text: string
}

type ReplayEventInput = {
  type: ReplayEventType
  label: string
  nowMs: number
  delta?: ReplayDelta
  metadata?: Record<string, string | number | boolean>
}

const moralSummaryTerms = ['cheat', 'honest', 'dishonest', 'effort', 'confidence', 'intent']

export function startReplayRecording({
  trace,
  starterCode,
  consentAcceptedAt,
  nowMs,
}: {
  trace: TraceContext
  starterCode: string
  consentAcceptedAt: string
  nowMs: number
}): ReplayRecording {
  const cleanTrace = assertTraceContext(trace)
  const recording: ReplayRecording = {
    schemaVersion: 1,
    trace: cleanTrace,
    starterCode,
    consentAcceptedAt,
    startedAtMs: nowMs,
    events: [],
  }

  return appendReplayEvent(recording, {
    type: 'consent_accepted',
    label: 'Consent accepted',
    nowMs,
  })
}

export function appendReplayEvent(recording: ReplayRecording | null, input: ReplayEventInput): ReplayRecording {
  if (!recording) {
    throw new ReplayError('ReplayConsentRequired', 'Replay capture cannot record events before consent.')
  }

  if (!replayEventTypes.includes(input.type)) {
    throw new ReplayError('ReplayCaptureError', `Unsupported replay event type: ${input.type}`)
  }

  if (input.label.length > REPLAY_EVENT_LABEL_MAX_CHARS) {
    throw new ReplayError('ReplayCaptureError', 'Replay event label exceeds 80 characters.')
  }

  if (input.delta && input.delta.insertedText.length > REPLAY_DELTA_INSERT_MAX_CHARS) {
    throw new ReplayError('ReplayDeltaTooLarge', 'Replay delta inserted text exceeds 2048 characters.')
  }

  const nextEvents = [
    ...recording.events,
    {
      eventId: `${recording.trace.candidateAttemptId}-${recording.events.length + 1}`,
      type: input.type,
      sequence: recording.events.length + 1,
      atMs: Math.max(0, Math.round(input.nowMs - recording.startedAtMs)),
      label: input.label,
      trace: recording.trace,
      delta: input.delta,
      metadata: input.metadata,
    },
  ]

  if (nextEvents.length > REPLAY_EVENT_MAX_COUNT) {
    throw new ReplayError('ReplayEventLimitExceeded', 'Replay event count exceeds 600 events.')
  }

  const nextRecording = { ...recording, events: nextEvents }
  validateReplayRecording(nextRecording)
  return nextRecording
}

export function appendCodeReplayEvent(
  recording: ReplayRecording | null,
  previousCode: string,
  nextCode: string,
  nowMs: number,
  type: 'editor_change' | 'reset_confirmed' = 'editor_change',
) {
  return appendReplayEvent(recording, {
    type,
    label: type === 'reset_confirmed' ? 'Reset confirmed' : 'Code changed',
    nowMs,
    delta: createTextDelta(previousCode, nextCode),
    metadata: {
      previousBytes: byteSize(previousCode),
      nextBytes: byteSize(nextCode),
    },
  })
}

export function createTextDelta(previousCode: string, nextCode: string): ReplayDelta {
  let start = 0
  while (
    start < previousCode.length &&
    start < nextCode.length &&
    previousCode.charCodeAt(start) === nextCode.charCodeAt(start)
  ) {
    start += 1
  }

  let previousEnd = previousCode.length
  let nextEnd = nextCode.length
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousCode.charCodeAt(previousEnd - 1) === nextCode.charCodeAt(nextEnd - 1)
  ) {
    previousEnd -= 1
    nextEnd -= 1
  }

  const insertedText = nextCode.slice(start, nextEnd)
  if (insertedText.length > REPLAY_DELTA_INSERT_MAX_CHARS) {
    throw new ReplayError('ReplayDeltaTooLarge', 'Replay delta inserted text exceeds 2048 characters.')
  }

  return {
    start,
    deleteCount: previousEnd - start,
    insertedText,
  }
}

export function applyTextDelta(value: string, delta: ReplayDelta) {
  if (delta.start < 0 || delta.deleteCount < 0 || delta.start + delta.deleteCount > value.length) {
    throw new ReplayError('ReplayCaptureError', 'Replay delta does not apply to the current buffer.')
  }

  return `${value.slice(0, delta.start)}${delta.insertedText}${value.slice(delta.start + delta.deleteCount)}`
}

export function reconstructFinalCode(starterCode: string, events: ReplayEvent[], throughSequence?: number) {
  const maxSequence = throughSequence ?? Number.POSITIVE_INFINITY
  return events.reduce((buffer, event) => {
    if (!event.delta || event.sequence > maxSequence) return buffer
    return applyTextDelta(buffer, event.delta)
  }, starterCode)
}

export function buildReviewPacket({
  payload,
  artifact,
  recording,
  finalCode,
  submittedAt,
  createdAt,
}: {
  payload: PublicCandidatePayload
  artifact: CandidateArtifact
  recording: ReplayRecording
  finalCode: string
  submittedAt: string
  createdAt: string
}): ReviewPacket {
  validateReplayRecording(recording)

  const reconstructedCode = reconstructFinalCode(recording.starterCode, recording.events)
  if (reconstructedCode !== finalCode) {
    throw new ReplayError('ReplayCaptureError', 'Replay reconstruction does not match final code.')
  }

  const packet: ReviewPacket = {
    schemaVersion: 1,
    packetId: `${recording.trace.candidateAttemptId}-${recording.events.length}`,
    createdAt,
    submittedAt,
    attemptState: 'receipt_issued',
    roleId: payload.roleId,
    artifactId: artifact.artifactId,
    traceId: recording.trace.traceId,
    candidateAttemptId: recording.trace.candidateAttemptId,
    company: payload.company,
    role: payload.role,
    artifact: {
      artifactId: artifact.artifactId,
      artifactType: artifact.artifactType,
      artifactTitle: artifact.artifactTitle,
      artifactExcerpt: artifact.artifactExcerpt,
      roleRelevance: artifact.roleRelevance,
      task: artifact.task,
      acceptanceCriteria: artifact.acceptanceCriteria,
      reviewerSignals: artifact.reviewerSignals,
      timeEstimate: artifact.timeEstimate,
      difficulty: artifact.difficulty,
    },
    consentAcceptedAt: recording.consentAcceptedAt,
    starterCode: recording.starterCode,
    finalCode,
    diff: createLineDiff(recording.starterCode, finalCode),
    replayEvents: recording.events,
    processSummary: createProcessSummary(recording.events, recording.starterCode, finalCode),
  }

  validateReviewPacket(packet)
  return packet
}

export function validateReplayRecording(recording: ReplayRecording) {
  assertTraceContext(recording.trace)

  if (recording.events.length === 0 || recording.events[0]?.type !== 'consent_accepted') {
    throw new ReplayError('ReplayConsentRequired', 'Replay recording must begin with consent.')
  }

  if (recording.events.length > REPLAY_EVENT_MAX_COUNT) {
    throw new ReplayError('ReplayEventLimitExceeded', 'Replay event count exceeds 600 events.')
  }

  let previousAtMs = -1
  for (const [index, event] of recording.events.entries()) {
    assertTraceContext(event.trace)
    if (event.trace.traceId !== recording.trace.traceId) {
      throw new ReplayError('ReplayCaptureError', 'Replay event traceId does not match recording.')
    }
    if (event.trace.candidateAttemptId !== recording.trace.candidateAttemptId) {
      throw new ReplayError('ReplayCaptureError', 'Replay event candidateAttemptId does not match recording.')
    }
    if (event.trace.roleId !== recording.trace.roleId || event.trace.artifactId !== recording.trace.artifactId) {
      throw new ReplayError('ReplayCaptureError', 'Replay event role or artifact id does not match recording.')
    }
    if (event.sequence !== index + 1 || event.atMs < previousAtMs) {
      throw new ReplayError('ReplayCaptureError', 'Replay events must be sequential and monotonic.')
    }
    if (event.delta && event.delta.insertedText.length > REPLAY_DELTA_INSERT_MAX_CHARS) {
      throw new ReplayError('ReplayDeltaTooLarge', 'Replay delta inserted text exceeds 2048 characters.')
    }
    previousAtMs = event.atMs
  }
}

export function validateReviewPacket(packet: ReviewPacket) {
  const trace = {
    traceId: packet.traceId,
    candidateAttemptId: packet.candidateAttemptId,
    roleId: packet.roleId,
    artifactId: packet.artifactId,
  }
  assertTraceContext(trace)
  validateProcessSummary(packet.processSummary)

  if (packet.roleId !== packet.replayEvents[0]?.trace.roleId || packet.artifactId !== packet.replayEvents[0]?.trace.artifactId) {
    throw new ReplayError('ReplayCaptureError', 'Review packet identity does not match replay events.')
  }

  if (reconstructFinalCode(packet.starterCode, packet.replayEvents) !== packet.finalCode) {
    throw new ReplayError('ReplayCaptureError', 'Review packet final code does not match replay.')
  }

  if (byteSize(JSON.stringify(packet)) > REPLAY_PACKET_MAX_BYTES) {
    throw new ReplayError('ReplayPayloadTooLarge', 'Review packet exceeds 512KB.')
  }
}

export function serializeReviewPacket(packet: ReviewPacket) {
  validateReviewPacket(packet)
  const serialized = JSON.stringify(packet)
  if (byteSize(serialized) > REPLAY_PACKET_MAX_BYTES) {
    throw new ReplayError('ReplayPayloadTooLarge', 'Review packet exceeds 512KB.')
  }
  return serialized
}

export function parseReviewPacket(serialized: string): ReviewPacket {
  const packet = JSON.parse(serialized) as ReviewPacket
  validateReviewPacket(packet)
  return packet
}

export function createLineDiff(starterCode: string, finalCode: string): LineDiff[] {
  const starterLines = starterCode.split('\n')
  const finalLines = finalCode.split('\n')
  let prefix = 0
  while (prefix < starterLines.length && prefix < finalLines.length && starterLines[prefix] === finalLines[prefix]) {
    prefix += 1
  }

  let starterSuffix = starterLines.length - 1
  let finalSuffix = finalLines.length - 1
  while (starterSuffix >= prefix && finalSuffix >= prefix && starterLines[starterSuffix] === finalLines[finalSuffix]) {
    starterSuffix -= 1
    finalSuffix -= 1
  }

  return [
    ...starterLines.slice(0, prefix).map((text) => ({ kind: 'unchanged' as const, text })),
    ...starterLines.slice(prefix, starterSuffix + 1).map((text) => ({ kind: 'removed' as const, text })),
    ...finalLines.slice(prefix, finalSuffix + 1).map((text) => ({ kind: 'added' as const, text })),
    ...starterLines.slice(starterSuffix + 1).map((text) => ({ kind: 'unchanged' as const, text })),
  ]
}

export function createProcessSummary(events: ReplayEvent[], starterCode: string, finalCode: string) {
  const codeChanges = events.filter((event) => event.type === 'editor_change').length
  const blockedActions = events.filter((event) => event.type === 'clipboard_blocked').length
  const resets = events.filter((event) => event.type === 'reset_confirmed').length
  const elapsedMs = events.at(-1)?.atMs ?? 0
  const changedLines = createLineDiff(starterCode, finalCode).filter((line) => line.kind !== 'unchanged').length
  const summary = [
    `${codeChanges} code change events recorded.`,
    `${blockedActions} protected editor actions blocked.`,
    `${resets} reset confirmations recorded.`,
    `${changedLines} changed diff lines from starter to final answer.`,
    `Receipt issued after ${Math.round(elapsedMs / 1000)} seconds of recorded activity.`,
  ]
  validateProcessSummary(summary)
  return summary
}

export function validateProcessSummary(summary: string[]) {
  for (const line of summary) {
    const lower = line.toLowerCase()
    if (moralSummaryTerms.some((term) => lower.includes(term))) {
      throw new ReplayError('ReplaySummaryIntegrityError', 'Process summary contains an unsupported intent claim.')
    }
  }
}
