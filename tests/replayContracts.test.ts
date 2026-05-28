import { describe, expect, it } from 'vitest'
import { demoPayload } from '../src/candidateData'
import { OperationalError } from '../src/opsContracts'
import {
  LOCAL_REVIEW_PACKET_MAX_COUNT,
  REPLAY_DELTA_INSERT_MAX_CHARS,
  REPLAY_EVENT_MAX_COUNT,
  REPLAY_PACKET_MAX_BYTES,
  ReplayError,
  appendCodeReplayEvent,
  appendReplayEvent,
  buildReviewPacket,
  reconstructFinalCode,
  startReplayRecording,
  validateProcessSummary,
} from '../src/replayContracts'
import type { ReplayErrorCode, ReplayRecording } from '../src/replayContracts'

const artifact = demoPayload.artifacts[0]
const trace = {
  traceId: 'trace-1',
  candidateAttemptId: 'attempt-1',
  roleId: demoPayload.roleId,
  artifactId: artifact.artifactId,
}

function expectReplayCode(action: () => void, code: ReplayErrorCode) {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ReplayError)
  expect((thrown as ReplayError).code).toBe(code)
}

function createRecording() {
  return startReplayRecording({
    trace,
    starterCode: artifact.starterCode,
    consentAcceptedAt: '2026-05-28T10:00:00.000Z',
    nowMs: 1_000,
  })
}

function createSubmittedRecording(finalCode = `${artifact.starterCode}\n// candidate change`) {
  let recording = createRecording()
  recording = appendCodeReplayEvent(recording, artifact.starterCode, finalCode, 1_050)
  recording = appendReplayEvent(recording, { type: 'submit_clicked', label: 'Submit clicked', nowMs: 1_100 })
  recording = appendReplayEvent(recording, { type: 'draft_flushed', label: 'Draft flushed', nowMs: 1_120 })
  recording = appendReplayEvent(recording, { type: 'receipt_issued', label: 'Receipt issued', nowMs: 1_140 })
  return recording
}

describe('replay contract limits', () => {
  it('keeps replay limits exact and boring', () => {
    expect(REPLAY_PACKET_MAX_BYTES).toBe(512 * 1024)
    expect(REPLAY_EVENT_MAX_COUNT).toBe(600)
    expect(REPLAY_DELTA_INSERT_MAX_CHARS).toBe(2048)
    expect(LOCAL_REVIEW_PACKET_MAX_COUNT).toBe(10)
  })

  it('records zero events before consent', () => {
    expectReplayCode(
      () => appendReplayEvent(null, { type: 'editor_focus', label: 'Editor focused', nowMs: 1 }),
      'ReplayConsentRequired',
    )
  })

  it('rejects oversized event count, delta size, and packet size', () => {
    let recording: ReplayRecording = createRecording()
    for (let index = 1; index < REPLAY_EVENT_MAX_COUNT; index += 1) {
      recording = appendReplayEvent(recording, { type: 'editor_focus', label: 'Editor focused', nowMs: 1_000 + index })
    }

    expectReplayCode(
      () => appendReplayEvent(recording, { type: 'editor_blur', label: 'Editor blurred', nowMs: 2_000 }),
      'ReplayEventLimitExceeded',
    )

    expectReplayCode(
      () => appendCodeReplayEvent(createRecording(), '', 'x'.repeat(REPLAY_DELTA_INSERT_MAX_CHARS + 1), 1_010),
      'ReplayDeltaTooLarge',
    )

    let oversizedRecording = startReplayRecording({
      trace,
      starterCode: 'x'.repeat(REPLAY_PACKET_MAX_BYTES),
      consentAcceptedAt: '2026-05-28T10:00:00.000Z',
      nowMs: 1_000,
    })
    oversizedRecording = appendReplayEvent(oversizedRecording, {
      type: 'submit_clicked',
      label: 'Submit clicked',
      nowMs: 1_010,
    })
    oversizedRecording = appendReplayEvent(oversizedRecording, {
      type: 'draft_flushed',
      label: 'Draft flushed',
      nowMs: 1_020,
    })
    oversizedRecording = appendReplayEvent(oversizedRecording, {
      type: 'receipt_issued',
      label: 'Receipt issued',
      nowMs: 1_030,
    })
    expectReplayCode(
      () =>
        buildReviewPacket({
          payload: demoPayload,
          artifact,
          recording: oversizedRecording,
          finalCode: 'x'.repeat(REPLAY_PACKET_MAX_BYTES),
          submittedAt: '2026-05-28T10:05:00.000Z',
          createdAt: '2026-05-28T10:05:00.000Z',
        }),
      'ReplayPayloadTooLarge',
    )
  })

  it('rejects missing trace fields and non-monotonic replay events', () => {
    expect(() =>
      startReplayRecording({
        trace: { ...trace, artifactId: '' },
        starterCode: artifact.starterCode,
        consentAcceptedAt: '2026-05-28T10:00:00.000Z',
        nowMs: 1_000,
      }),
    ).toThrow(OperationalError)

    const recording = createSubmittedRecording()
    expectReplayCode(
      () =>
        buildReviewPacket({
          payload: demoPayload,
          artifact,
          recording: {
            ...recording,
            events: recording.events.map((event, index) => (index === 2 ? { ...event, atMs: 0 } : event)),
          },
          finalCode: `${artifact.starterCode}\n// candidate change`,
          submittedAt: '2026-05-28T10:05:00.000Z',
          createdAt: '2026-05-28T10:05:00.000Z',
        }),
      'ReplayCaptureError',
    )
  })
})

describe('replay reconstruction and review packet construction', () => {
  it('reconstructs final code from starter code and deltas', () => {
    const finalCode = `${artifact.starterCode}\n// candidate change`
    const recording = createSubmittedRecording(finalCode)

    expect(reconstructFinalCode(artifact.starterCode, recording.events)).toBe(finalCode)
  })

  it('blocks review packet creation when replay reconstruction does not match final code', () => {
    expectReplayCode(
      () =>
        buildReviewPacket({
          payload: demoPayload,
          artifact,
          recording: createSubmittedRecording(),
          finalCode: `${artifact.starterCode}\n// different final answer`,
          submittedAt: '2026-05-28T10:05:00.000Z',
          createdAt: '2026-05-28T10:05:00.000Z',
        }),
      'ReplayCaptureError',
    )
  })

  it('builds a review packet with final code, diff, artifact context, trace fields, and neutral summary', () => {
    const finalCode = `${artifact.starterCode}\n// candidate change`
    const packet = buildReviewPacket({
      payload: demoPayload,
      artifact,
      recording: createSubmittedRecording(finalCode),
      finalCode,
      submittedAt: '2026-05-28T10:05:00.000Z',
      createdAt: '2026-05-28T10:05:00.000Z',
    })

    expect(packet.finalCode).toBe(finalCode)
    expect(packet.diff.some((line) => line.kind === 'added')).toBe(true)
    expect(packet.artifact.artifactTitle).toBe(artifact.artifactTitle)
    expect(packet.traceId).toBe(trace.traceId)
    expect(packet.candidateAttemptId).toBe(trace.candidateAttemptId)
    expect(packet.attemptState).toBe('receipt_issued')
    expect(packet.replayEvents.map((event) => event.type)).toContain('editor_change')
    expect(packet.processSummary.join(' ')).toContain('code change events recorded')
  })

  it('rejects moralized or unbacked process summary claims', () => {
    expectReplayCode(() => validateProcessSummary(['Candidate showed honest effort.']), 'ReplaySummaryIntegrityError')
    expectReplayCode(() => validateProcessSummary(['Clipboard event proves cheating intent.']), 'ReplaySummaryIntegrityError')
  })
})
