import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  ClipboardX,
  Code2,
  FileCode2,
  ExternalLink,
  FileWarning,
  Flag,
  Link as LinkIcon,
  LockKeyhole,
  ListChecks,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  SyntheticEvent,
} from 'react'
import {
  EasterHireError,
  createCandidatePayload,
  defaultJobDescription,
  demoPayload,
  extractSignals,
  integrityRestrictionCopy,
  parsePublicRoute,
  toPublicRoleLink,
  validatePublicPayload,
} from './candidateData'
import type { CandidateArtifact, PublicCandidatePayload } from './candidateData'
import {
  DRAFT_BODY_MAX_BYTES,
  LOCAL_DRAFT_PERSISTENCE_TIMEOUT_MS,
  assertDraftBodySize,
  byteSize,
} from './opsContracts'
import type { TraceContext } from './opsContracts'
import {
  LOCAL_REVIEW_PACKET_MAX_COUNT,
  ReplayError,
  appendCodeReplayEvent,
  appendReplayEvent,
  buildReviewPacket,
  parseReviewPacket,
  reconstructFinalCode,
  serializeReviewPacket,
  startReplayRecording,
} from './replayContracts'
import type { ReplayEventType, ReplayRecording, ReviewPacket, ReviewPacketListItem } from './replayContracts'

const roleStoragePrefix = 'easter-hire:published-role:'
const draftStoragePrefix = 'easter-hire:draft:'
const reviewPacketStoragePrefix = 'easter-hire:review-packet:'
const reviewPacketIndexStorageKey = 'easter-hire:review-packet-index'

type RouteState =
  | { mode: 'candidate'; payload: PublicCandidatePayload; artifactId?: string }
  | { mode: 'builder' }
  | { mode: 'review'; packetId?: string }
  | { mode: 'error'; message: string; code: string }

export default function App() {
  const [route, setRoute] = useState<RouteState>(() => readRouteState())

  useEffect(() => {
    const syncRoute = () => setRoute(readRouteState())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  if (route.mode === 'builder') {
    return <BuilderExperience />
  }

  if (route.mode === 'review') {
    return <ReviewExperience packetId={route.packetId} />
  }

  if (route.mode === 'error') {
    return <InvalidRoleLink code={route.code} message={route.message} />
  }

  return <CandidateExperience payload={route.payload} initialArtifactId={route.artifactId} />
}

function CandidateExperience({
  payload,
  initialArtifactId,
}: {
  payload: PublicCandidatePayload
  initialArtifactId?: string
}) {
  const initialArtifact = findArtifact(payload, initialArtifactId)
  const [activeArtifactId, setActiveArtifactId] = useState(initialArtifact.artifactId)
  const [consentAcceptedAt, setConsentAcceptedAt] = useState<string | null>(null)
  const [hasDraftWork, setHasDraftWork] = useState(false)
  const [draftConflictTarget, setDraftConflictTarget] = useState<string | null>(null)
  const [replayRecording, setReplayRecording] = useState<ReplayRecording | null>(null)

  const activeArtifact = findArtifact(payload, activeArtifactId)
  const publicSignals = [
    ...payload.publicSignals.work,
    ...payload.publicSignals.stack.slice(0, 2),
    ...payload.publicSignals.domains.slice(0, 2),
  ].slice(0, 7)

  useEffect(() => {
    const nextArtifact = findArtifact(payload, initialArtifactId)
    setActiveArtifactId(nextArtifact.artifactId)
    setConsentAcceptedAt(null)
    setHasDraftWork(false)
    setDraftConflictTarget(null)
    setReplayRecording(null)
  }, [payload, initialArtifactId])

  useEffect(() => {
    assertCandidateSurfaceSafe()
  })

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDraftWork) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [hasDraftWork])

  function selectArtifact(artifactId: string) {
    if (artifactId === activeArtifact.artifactId) return
    if (hasDraftWork) {
      recordCandidateReplayEvent('artifact_switch_blocked', 'Artifact switch blocked', { targetArtifactId: artifactId })
      setDraftConflictTarget(artifactId)
      return
    }
    switchArtifact(artifactId)
  }

  function switchArtifact(artifactId: string) {
    setActiveArtifactId(artifactId)
    setConsentAcceptedAt(null)
    setHasDraftWork(false)
    setDraftConflictTarget(null)
    setReplayRecording(null)
  }

  function discardAndSwitch() {
    if (!draftConflictTarget) return
    window.localStorage.removeItem(draftStorageKey(payload.roleId, activeArtifact.artifactId))
    switchArtifact(draftConflictTarget)
  }

  function acceptConsent() {
    const acceptedAt = new Date().toISOString()
    const trace = createAttemptTrace(payload.roleId, activeArtifact.artifactId)
    setReplayRecording(
      startReplayRecording({
        trace,
        starterCode: activeArtifact.starterCode,
        consentAcceptedAt: acceptedAt,
        nowMs: nowMs(),
      }),
    )
    setConsentAcceptedAt(acceptedAt)
  }

  function recordCandidateReplayEvent(
    type: ReplayEventType,
    label: string,
    metadata?: Record<string, string | number | boolean>,
  ) {
    setReplayRecording((currentRecording) => {
      if (!currentRecording) return currentRecording
      try {
        return appendReplayEvent(currentRecording, { type, label, metadata, nowMs: nowMs() })
      } catch {
        return currentRecording
      }
    })
  }

  return (
    <main className="candidate-shell">
      <header className="candidate-hero">
        <div className="brand-pill" aria-hidden="true">
          EH
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Easter Hire</p>
          <h1>{payload.role}</h1>
          <p>
            {payload.company} is using work-shaped challenge artifacts to evaluate the same judgment this role uses on
            the job.
          </p>
          <div className="signal-strip" aria-label="Public role signals">
            {publicSignals.map((signal) => (
              <span key={signal}>{signal}</span>
            ))}
          </div>
        </div>
      </header>

      <section className="role-hub" aria-labelledby="artifact-heading">
        <div className="hub-heading">
          <div>
            <p className="eyebrow">Visible clues</p>
            <h2 id="artifact-heading">Choose a work artifact</h2>
          </div>
          <p>{payload.artifacts.length} role-specific artifacts generated from public-safe role signals.</p>
        </div>

        <div className="artifact-grid">
          {payload.artifacts.map((artifact) => (
            <ArtifactCard
              artifact={artifact}
              isActive={artifact.artifactId === activeArtifact.artifactId}
              key={artifact.artifactId}
              onSelect={() => selectArtifact(artifact.artifactId)}
            />
          ))}
        </div>
      </section>

      {draftConflictTarget ? (
        <section className="error-band" aria-live="assertive">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>DraftConflictError</strong>
            <p>Switching artifacts would discard the current draft. Confirm before leaving this challenge.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setDraftConflictTarget(null)}>
            Keep working
          </button>
          <button className="danger-button" type="button" onClick={discardAndSwitch}>
            Discard draft
          </button>
        </section>
      ) : null}

      <section className="issue-workspace" aria-label="Candidate challenge workspace">
        <ChallengeBrief artifact={activeArtifact} />
        {consentAcceptedAt ? (
          <ProtectedCodeEditor
            artifact={activeArtifact}
            payload={payload}
            roleId={payload.roleId}
            onDraftWorkChange={setHasDraftWork}
            onReplayRecordingChange={(updater) => setReplayRecording((currentRecording) => updater(currentRecording))}
            replayRecording={replayRecording}
          />
        ) : (
          <ConsentGate artifact={activeArtifact} onAccept={acceptConsent} />
        )}
      </section>
    </main>
  )
}

function ArtifactCard({
  artifact,
  isActive,
  onSelect,
}: {
  artifact: CandidateArtifact
  isActive: boolean
  onSelect: () => void
}) {
  return (
    <button className={isActive ? 'artifact-card active' : 'artifact-card'} type="button" onClick={onSelect}>
      <span className="artifact-type">
        {artifactIcon(artifact.artifactType)}
        {artifact.artifactType}
      </span>
      <strong>{artifact.artifactTitle}</strong>
      <p>{artifact.artifactExcerpt}</p>
      <span className="artifact-meta">
        {artifact.difficulty} - {artifact.timeEstimate}
      </span>
    </button>
  )
}

function ChallengeBrief({ artifact }: { artifact: CandidateArtifact }) {
  return (
    <section className="workspace-panel brief-panel">
      <div className="panel-heading">
        <span className="icon-token">
          {artifactIcon(artifact.artifactType)}
        </span>
        <div>
          <p className="eyebrow">Issue workspace</p>
          <h2>{artifact.artifactTitle}</h2>
        </div>
      </div>

      <div className="artifact-body">
        <p>{artifact.artifactExcerpt}</p>
        <p className="role-relevance">{artifact.roleRelevance}</p>
      </div>

      <div className="brief-section">
        <h3>Task</h3>
        <p>{artifact.task}</p>
      </div>

      <div className="brief-section">
        <h3>Acceptance criteria</h3>
        {artifact.acceptanceCriteria.map((item) => (
          <div className="check-row" key={item}>
            <Check size={16} aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <div className="brief-section">
        <h3>Public reviewer signals</h3>
        {artifact.reviewerSignals.map((signal) => (
          <p className="signal-line" key={signal}>
            {signal}
          </p>
        ))}
      </div>
    </section>
  )
}

function ConsentGate({ artifact, onAccept }: { artifact: CandidateArtifact; onAccept: () => void }) {
  return (
    <section className="workspace-panel consent-panel" aria-labelledby="consent-heading">
      <div className="panel-heading">
        <LockKeyhole size={20} aria-hidden="true" />
        <div>
          <p className="eyebrow">Challenge mode</p>
          <h2 id="consent-heading">Start with clear rules</h2>
        </div>
      </div>

      <div className="consent-list">
        <div>
          <strong>Time estimate</strong>
          <p>{artifact.timeEstimate}</p>
        </div>
        <div>
          <strong>Clipboard limits</strong>
          <p>{integrityRestrictionCopy}</p>
        </div>
        <div>
          <strong>Evaluation criteria</strong>
          <p>{artifact.reviewerSignals.slice(0, 2).join(' ')}</p>
        </div>
        <div>
          <strong>Persistence status</strong>
          <p>Your draft is local to this browser during the prototype; submission is a mock receipt.</p>
        </div>
        <div>
          <strong>Activity replay</strong>
          <p>After you start, local code changes and named challenge events are recorded for reviewer-visible process replay.</p>
        </div>
      </div>

      <button className="primary-button wide" type="button" onClick={onAccept}>
        <ArrowRight size={18} aria-hidden="true" />
        Start challenge mode
      </button>
    </section>
  )
}

function ProtectedCodeEditor({
  artifact,
  payload,
  roleId,
  onDraftWorkChange,
  onReplayRecordingChange,
  replayRecording,
}: {
  artifact: CandidateArtifact
  payload: PublicCandidatePayload
  roleId: string
  onDraftWorkChange: (hasWork: boolean) => void
  onReplayRecordingChange: (updater: (recording: ReplayRecording | null) => ReplayRecording | null) => void
  replayRecording: ReplayRecording | null
}) {
  const [code, setCode] = useState(() => readDraft(roleId, artifact))
  const [blockedNotice, setBlockedNotice] = useState('Clipboard and context menu locked')
  const [resetPending, setResetPending] = useState(false)
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const replayRecordingRef = useRef(replayRecording)
  const hasDraftWork = code !== artifact.starterCode && !submittedAt

  useEffect(() => {
    replayRecordingRef.current = replayRecording
  }, [replayRecording])

  useEffect(() => {
    setCode(readDraft(roleId, artifact))
    setBlockedNotice('Clipboard and context menu locked')
    setResetPending(false)
    setSubmittedAt(null)
    onDraftWorkChange(false)
  }, [artifact, roleId, onDraftWorkChange])

  useEffect(() => {
    onDraftWorkChange(hasDraftWork)
  }, [hasDraftWork, onDraftWorkChange])

  useEffect(() => {
    if (!replayRecording || replayRecording.events.length !== 1 || code === artifact.starterCode) return
    captureCodeChange(artifact.starterCode, code)
  }, [artifact.starterCode, code, replayRecording])

  useEffect(() => {
    const autosave = window.setTimeout(() => {
      try {
        assertDraftBodySize(code)
        window.localStorage.setItem(draftStorageKey(roleId, artifact.artifactId), code)
        captureSemanticEvent('draft_autosaved', 'Draft autosaved', { bytes: byteSize(code) })
      } catch {
        setBlockedNotice('DraftPersistenceError: local draft save failed')
      }
    }, LOCAL_DRAFT_PERSISTENCE_TIMEOUT_MS)
    return () => window.clearTimeout(autosave)
  }, [artifact.artifactId, code, roleId])

  function blockAction(event: SyntheticEvent, action: string) {
    event.preventDefault()
    event.stopPropagation()
    captureSemanticEvent('clipboard_blocked', `${action} blocked`)
    setBlockedNotice(`${action} blocked in protected editor`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const key = event.key.toLowerCase()
    const modifier = event.ctrlKey || event.metaKey
    const clipboardShortcut = modifier && ['c', 'v', 'x'].includes(key)
    const insertPaste = event.shiftKey && key === 'insert'

    if (clipboardShortcut || insertPaste) {
      blockAction(event, `${modifier ? 'Shortcut' : 'Paste'} ${event.key}`)
    }
  }

  function handleBeforeInput(event: FormEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.inputType?.toLowerCase().includes('paste')) {
      blockAction(event, 'Paste')
    }
  }

  function updateCode(value: string) {
    try {
      assertDraftBodySize(value)
    } catch {
      setBlockedNotice('PayloadTooLarge: draft is capped at 64KB')
      return
    }
    if (!captureCodeChange(code, value)) return
    setCode(value)
    setSubmittedAt(null)
    setResetPending(false)
  }

  function requestReset() {
    if (hasDraftWork) {
      captureSemanticEvent('reset_requested', 'Reset requested')
      setResetPending(true)
      setBlockedNotice('DraftConflictError: confirm reset before discarding code')
      return
    }
    resetDraft()
  }

  function resetDraft() {
    if (code !== artifact.starterCode && !captureCodeChange(code, artifact.starterCode, 'reset_confirmed')) return
    window.localStorage.removeItem(draftStorageKey(roleId, artifact.artifactId))
    setCode(artifact.starterCode)
    setResetPending(false)
    setSubmittedAt(null)
    setBlockedNotice('Starter restored')
  }

  function submitMockReceipt() {
    try {
      let nextRecording = appendReplayEvent(replayRecordingRef.current, {
        type: 'submit_clicked',
        label: 'Submit clicked',
        nowMs: nowMs(),
      })
      if (!flushCurrentDraft()) {
        commitReplayRecording(nextRecording)
        return
      }
      nextRecording = appendReplayEvent(nextRecording, {
        type: 'draft_flushed',
        label: 'Draft flushed',
        metadata: { bytes: byteSize(code) },
        nowMs: nowMs(),
      })
      const receiptIssuedAt = new Date().toISOString()
      nextRecording = appendReplayEvent(nextRecording, {
        type: 'receipt_issued',
        label: 'Receipt issued',
        nowMs: nowMs(),
      })
      const packet = buildReviewPacket({
        payload,
        artifact,
        recording: nextRecording,
        finalCode: code,
        submittedAt: receiptIssuedAt,
        createdAt: receiptIssuedAt,
      })
      saveReviewPacket(packet)
      commitReplayRecording(nextRecording)
      setSubmittedAt(new Date(receiptIssuedAt).toLocaleString())
      setResetPending(false)
      onDraftWorkChange(false)
    } catch (error) {
      const typed = error instanceof ReplayError ? error.code : 'ReplayPersistenceError'
      setBlockedNotice(`${typed}: receipt blocked until replay evidence is valid`)
    }
  }

  function flushCurrentDraft() {
    try {
      assertDraftBodySize(code)
      window.localStorage.setItem(draftStorageKey(roleId, artifact.artifactId), code)
      return true
    } catch {
      setBlockedNotice('DraftFlushFailed: current draft could not be saved')
      return false
    }
  }

  function cancelReset() {
    captureSemanticEvent('reset_cancelled', 'Reset cancelled')
    setResetPending(false)
  }

  function captureCodeChange(
    previousCode: string,
    nextCode: string,
    type: 'editor_change' | 'reset_confirmed' = 'editor_change',
  ) {
    try {
      const nextRecording = appendCodeReplayEvent(replayRecordingRef.current, previousCode, nextCode, nowMs(), type)
      commitReplayRecording(nextRecording)
      return true
    } catch (error) {
      const typed = error instanceof ReplayError ? error.code : 'ReplayCaptureError'
      setBlockedNotice(`${typed}: replay capture failed`)
      return false
    }
  }

  function captureSemanticEvent(
    type: ReplayEventType,
    label: string,
    metadata?: Record<string, string | number | boolean>,
  ) {
    try {
      const nextRecording = appendReplayEvent(replayRecordingRef.current, { type, label, metadata, nowMs: nowMs() })
      commitReplayRecording(nextRecording)
      return true
    } catch (error) {
      const typed = error instanceof ReplayError ? error.code : 'ReplayCaptureError'
      setBlockedNotice(`${typed}: replay capture failed`)
      return false
    }
  }

  function commitReplayRecording(nextRecording: ReplayRecording) {
    replayRecordingRef.current = nextRecording
    onReplayRecordingChange(() => nextRecording)
  }

  return (
    <section className="workspace-panel editor-panel" aria-labelledby="editor-title">
      <div className="editor-toolbar">
        <div className="panel-heading compact">
          <Code2 size={20} aria-hidden="true" />
          <div>
            <p className="eyebrow">Locked coding area</p>
            <h2 id="editor-title">Challenge editor</h2>
          </div>
        </div>
        <button className="secondary-button" type="button" onClick={requestReset}>
          <RefreshCw size={18} aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="lock-notice" aria-live="polite">
        <ClipboardX size={18} aria-hidden="true" />
        <span>{blockedNotice}</span>
      </div>
      <p className="restriction-note">{integrityRestrictionCopy}</p>

      {resetPending ? (
        <div className="confirm-strip" aria-live="assertive">
          <strong>DraftConflictError</strong>
          <span>Reset will discard the current draft.</span>
          <button className="secondary-button" type="button" onClick={cancelReset}>
            Keep draft
          </button>
          <button className="danger-button" type="button" onClick={resetDraft}>
            Confirm reset
          </button>
        </div>
      ) : null}

      <textarea
        className="code-editor"
        value={code}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        onChange={(event) => updateCode(event.target.value)}
        onCopy={(event: ClipboardEvent<HTMLTextAreaElement>) => blockAction(event, 'Copy')}
        onCut={(event: ClipboardEvent<HTMLTextAreaElement>) => blockAction(event, 'Cut')}
        onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => blockAction(event, 'Paste')}
        onContextMenu={(event: MouseEvent<HTMLTextAreaElement>) => blockAction(event, 'Right-click menu')}
        onDrop={(event: DragEvent<HTMLTextAreaElement>) => blockAction(event, 'Drop')}
        onDragOver={(event: DragEvent<HTMLTextAreaElement>) => blockAction(event, 'Drag paste')}
        onFocus={() => captureSemanticEvent('editor_focus', 'Editor focused')}
        onBlur={() => captureSemanticEvent('editor_blur', 'Editor blurred')}
        onKeyDown={handleKeyDown}
        onBeforeInput={handleBeforeInput}
        aria-label="Protected candidate code editor"
      />

      <div className="editor-actions">
        <span>
          {byteSize(code).toLocaleString()} / {DRAFT_BODY_MAX_BYTES.toLocaleString()} bytes
        </span>
        <button className="primary-button" type="button" onClick={submitMockReceipt}>
          <Send size={18} aria-hidden="true" />
          Submit mock answer
        </button>
      </div>

      {submittedAt ? (
        <div className="receipt" role="status">
          <BadgeCheck size={20} aria-hidden="true" />
          <div>
            <strong>Mock receipt created</strong>
            <p>Prototype only: not sent to a hiring team.</p>
            <span>{submittedAt}</span>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function BuilderExperience() {
  const [company, setCompany] = useState('Northstar Labs')
  const [role, setRole] = useState('Developer Experience Engineer')
  const [jobDescription, setJobDescription] = useState(defaultJobDescription)
  const [seed, setSeed] = useState(4187)
  const [status, setStatus] = useState('Builder mode')
  const buildResult = useMemo(() => {
    try {
      return { payload: createCandidatePayload({ company, role, jobDescription, seed }), error: null }
    } catch (error) {
      const typed = error instanceof EasterHireError ? error : new Error('Unknown builder error')
      return { payload: null, error: typed }
    }
  }, [company, jobDescription, role, seed])
  const signals = useMemo(() => extractSignals(jobDescription), [jobDescription])

  function publishLocalRole() {
    if (!buildResult.payload) {
      setStatus(buildResult.error?.message ?? 'Cannot publish')
      return
    }
    window.localStorage.setItem(`${roleStoragePrefix}${buildResult.payload.roleId}`, JSON.stringify(buildResult.payload))
    const publicHash = toPublicRoleLink(buildResult.payload)
    window.history.replaceState(null, '', publicHash)
    window.dispatchEvent(new Event('hashchange'))
  }

  return (
    <main className="builder-shell">
      <header className="builder-topbar">
        <div>
          <p className="eyebrow">Easter Hire builder</p>
          <h1>Generate a public-safe candidate role</h1>
        </div>
        <button className="primary-button" type="button" onClick={publishLocalRole} disabled={!buildResult.payload}>
          <ExternalLink size={18} aria-hidden="true" />
          Publish local role
        </button>
      </header>

      <section className="builder-grid">
        <div className="workspace-panel">
          <div className="panel-heading">
            <Wand2 size={20} aria-hidden="true" />
            <h2>Private generation inputs</h2>
          </div>
          <div className="field-grid two-up">
            <label>
              <span>Company</span>
              <input aria-label="Company" value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label>
              <span>Role</span>
              <input aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)} />
            </label>
          </div>
          <label className="jd-field">
            <span>Job description</span>
            <textarea
              aria-label="Job description"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
            />
          </label>
          <label>
            <span>Random seed</span>
            <input
              aria-label="Random seed"
              inputMode="numeric"
              value={seed}
              onChange={(event) => setSeed(Number.parseInt(event.target.value, 10) || 0)}
            />
          </label>
        </div>

        <div className="workspace-panel">
          <div className="panel-heading">
            <LinkIcon size={20} aria-hidden="true" />
            <h2>Public-safe output</h2>
          </div>
          <p className={buildResult.error ? 'builder-status error' : 'builder-status'}>{buildResult.error?.message ?? status}</p>
          <div className="signal-strip compact-signals">
            {[...signals.work, ...signals.stack, ...signals.domains].slice(0, 8).map((signal) => (
              <span key={signal}>{signal}</span>
            ))}
          </div>
          {buildResult.payload ? (
            <div className="builder-artifacts">
              {buildResult.payload.artifacts.map((artifact) => (
                <div className="mini-artifact" key={artifact.artifactId}>
                  <strong>{artifact.artifactTitle}</strong>
                  <span>{artifact.provenanceSignals.join(', ')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Not enough role signal</div>
          )}
        </div>
      </section>
    </main>
  )
}

function ReviewExperience({ packetId }: { packetId?: string }) {
  const [packets, setPackets] = useState(() => readReviewPackets())
  const selectedPacket = packets.find((packet) => packet.packetId === packetId) ?? packets[0]
  const [replayStep, setReplayStep] = useState(() => selectedPacket?.replayEvents.length ?? 0)

  useEffect(() => {
    setReplayStep(selectedPacket?.replayEvents.length ?? 0)
  }, [selectedPacket?.packetId, selectedPacket?.replayEvents.length])

  function clearPackets() {
    clearReviewPackets()
    setPackets([])
  }

  function selectPacket(nextPacketId: string) {
    window.history.replaceState(null, '', `#review=${nextPacketId}`)
    window.dispatchEvent(new Event('hashchange'))
  }

  if (!selectedPacket) {
    return (
      <main className="review-shell">
        <section className="workspace-panel empty-review">
          <FileCode2 size={30} aria-hidden="true" />
          <p className="eyebrow">ReviewPacketNotFound</p>
          <h1>Local reviewer packet</h1>
          <p>No local mock submissions are available in this browser.</p>
          <button className="secondary-button" type="button" onClick={clearPackets}>
            <Trash2 size={18} aria-hidden="true" />
            Clear local review packets
          </button>
        </section>
      </main>
    )
  }

  const replayCode = reconstructFinalCode(selectedPacket.starterCode, selectedPacket.replayEvents, replayStep)

  return (
    <main className="review-shell">
      <header className="review-topbar">
        <div>
          <p className="eyebrow">Private local route</p>
          <h1>Local reviewer packet</h1>
          <p>Prototype only: local review packet, not sent to a hiring team.</p>
        </div>
        <button className="danger-button" type="button" onClick={clearPackets}>
          <Trash2 size={18} aria-hidden="true" />
          Clear local review packets
        </button>
      </header>

      <section className="review-grid">
        <aside className="workspace-panel packet-list" aria-label="Local mock attempts">
          <div className="panel-heading">
            <ListChecks size={20} aria-hidden="true" />
            <h2>Mock attempts</h2>
          </div>
          <p className="review-disclosure">
            Showing {packets.length} of {LOCAL_REVIEW_PACKET_MAX_COUNT} local packets stored in this browser.
          </p>
          {packets.map((packet) => (
            <button
              className={packet.packetId === selectedPacket.packetId ? 'packet-row active' : 'packet-row'}
              key={packet.packetId}
              type="button"
              onClick={() => selectPacket(packet.packetId)}
            >
              <strong>{packet.artifact.artifactTitle}</strong>
              <span>{packet.role}</span>
              <small>{new Date(packet.createdAt).toLocaleString()}</small>
            </button>
          ))}
        </aside>

        <section className="review-main">
          <section className="workspace-panel review-summary">
            <div className="panel-heading">
              <BadgeCheck size={20} aria-hidden="true" />
              <div>
                <p className="eyebrow">Evidence packet</p>
                <h2>{selectedPacket.artifact.artifactTitle}</h2>
              </div>
            </div>
            <div className="meta-grid">
              <MetaItem label="Attempt state" value={selectedPacket.attemptState} />
              <MetaItem label="Trace" value={selectedPacket.traceId} />
              <MetaItem label="Attempt" value={selectedPacket.candidateAttemptId} />
              <MetaItem label="Artifact" value={selectedPacket.artifactId} />
            </div>
            <div className="brief-section">
              <h3>Process summary</h3>
              {selectedPacket.processSummary.map((line) => (
                <p className="signal-line" key={line}>
                  {line}
                </p>
              ))}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="panel-heading">
              <FileWarning size={20} aria-hidden="true" />
              <h2>Artifact context</h2>
            </div>
            <div className="artifact-body">
              <p>{selectedPacket.artifact.artifactExcerpt}</p>
              <p className="role-relevance">{selectedPacket.artifact.roleRelevance}</p>
            </div>
            <div className="brief-section">
              <h3>Task</h3>
              <p>{selectedPacket.artifact.task}</p>
            </div>
          </section>

          <section className="workspace-panel">
            <div className="panel-heading">
              <Code2 size={20} aria-hidden="true" />
              <h2>Starter diff</h2>
            </div>
            <pre className="diff-view" aria-label="Starter code diff">
              {selectedPacket.diff.map((line, index) => (
                <code className={`diff-line ${line.kind}`} key={`${line.kind}-${index}`}>
                  {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
                  {line.text || ' '}
                </code>
              ))}
            </pre>
          </section>

          <section className="workspace-panel">
            <div className="panel-heading">
              <Sparkles size={20} aria-hidden="true" />
              <h2>Replay scrubber</h2>
            </div>
            <div className="scrubber-row">
              <input
                aria-label="Replay step"
                max={selectedPacket.replayEvents.length}
                min={0}
                onChange={(event) => setReplayStep(Number.parseInt(event.target.value, 10))}
                type="range"
                value={replayStep}
              />
              <span>
                {replayStep} / {selectedPacket.replayEvents.length}
              </span>
            </div>
            <pre className="review-code" aria-label="Reconstructed replay code">
              {replayCode}
            </pre>
          </section>

          <section className="workspace-panel">
            <div className="panel-heading">
              <ListChecks size={20} aria-hidden="true" />
              <h2>Semantic event timeline</h2>
            </div>
            <div className="timeline">
              {selectedPacket.replayEvents.map((event) => (
                <div className="timeline-row" key={event.eventId}>
                  <span>{event.atMs}ms</span>
                  <strong>{event.type}</strong>
                  <p>{event.label}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="workspace-panel">
            <div className="panel-heading">
              <FileCode2 size={20} aria-hidden="true" />
              <h2>Final answer</h2>
            </div>
            <pre className="review-code" aria-label="Final submitted code">
              {selectedPacket.finalCode}
            </pre>
          </section>
        </section>
      </section>
    </main>
  )
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InvalidRoleLink({ code, message }: { code: string; message: string }) {
  return (
    <main className="candidate-shell invalid-shell">
      <section className="workspace-panel invalid-panel">
        <FileWarning size={30} aria-hidden="true" />
        <p className="eyebrow">{code}</p>
        <h1>Invalid role link</h1>
        <p>{message}</p>
      </section>
    </main>
  )
}

function readRouteState(): RouteState {
  if (window.location.hash === '#builder') {
    return { mode: 'builder' }
  }

  if (window.location.hash === '#review') {
    return { mode: 'review' }
  }

  if (/^#review=[a-z0-9-]+$/u.test(window.location.hash)) {
    return { mode: 'review', packetId: window.location.hash.replace('#review=', '') }
  }

  try {
    const route = parsePublicRoute(window.location.hash)
    if (!route) return { mode: 'builder' }
    const payload = readPublishedPayload(route.roleId)
    return { mode: 'candidate', payload, artifactId: route.artifactId }
  } catch (error) {
    const typed = error instanceof EasterHireError ? error : new EasterHireError('InvalidPublicRouteError', 'Invalid role link.')
    return { mode: 'error', code: typed.code, message: typed.message }
  }
}

function assertCandidateSurfaceSafe() {
  const candidateRoot = document.querySelector('.candidate-shell')
  if (!candidateRoot) return
  const forbiddenText = [
    'Job description',
    'Random seed',
    'Publish local role',
    'Private generation inputs',
    '#review',
    'Review packet',
    'Local reviewer packet',
    'Clear local review packets',
  ]
  const renderedText = candidateRoot.textContent ?? ''
  const hasForbiddenText = forbiddenText.some((text) => renderedText.includes(text))
  const hasForbiddenControl = candidateRoot.querySelector('[aria-label="Job description"], [aria-label="Random seed"]')

  if (hasForbiddenText || hasForbiddenControl) {
    throw new EasterHireError('PublicSurfaceLeakError', 'Candidate surface attempted to render builder controls.')
  }
}

function readPublishedPayload(roleId: string) {
  if (roleId === demoPayload.roleId) return demoPayload
  const raw = window.localStorage.getItem(`${roleStoragePrefix}${roleId}`)
  if (!raw) {
    throw new EasterHireError('InvalidPublicRouteError', 'This role id was not found in the local prototype registry.')
  }
  const parsed = JSON.parse(raw) as PublicCandidatePayload
  validatePublicPayload(parsed)
  return parsed
}

function findArtifact(payload: PublicCandidatePayload, artifactId?: string) {
  return payload.artifacts.find((artifact) => artifact.artifactId === artifactId) ?? payload.artifacts[0]
}

function readDraft(roleId: string, artifact: CandidateArtifact) {
  const draft = window.localStorage.getItem(draftStorageKey(roleId, artifact.artifactId))
  return draft ?? artifact.starterCode
}

function draftStorageKey(roleId: string, artifactId: string) {
  return `${draftStoragePrefix}${roleId}:${artifactId}`
}

function saveReviewPacket(packet: ReviewPacket) {
  const serialized = serializeReviewPacket(packet)
  const index = readReviewPacketIndex()
  const existingIndex = index.findIndex((item) => item.packetId === packet.packetId)

  if (existingIndex === -1 && index.length >= LOCAL_REVIEW_PACKET_MAX_COUNT) {
    throw new ReplayError('ReplayPayloadTooLarge', 'Local review packet limit reached.')
  }

  const nextItem: ReviewPacketListItem = {
    packetId: packet.packetId,
    createdAt: packet.createdAt,
    company: packet.company,
    role: packet.role,
    artifactTitle: packet.artifact.artifactTitle,
    candidateAttemptId: packet.candidateAttemptId,
  }
  const nextIndex = [nextItem, ...index.filter((item) => item.packetId !== packet.packetId)]

  try {
    window.localStorage.setItem(reviewPacketKey(packet.packetId), serialized)
    window.localStorage.setItem(reviewPacketIndexStorageKey, JSON.stringify(nextIndex))
  } catch {
    window.localStorage.removeItem(reviewPacketKey(packet.packetId))
    throw new ReplayError('ReplayPersistenceError', 'Local review packet could not be saved.')
  }
}

function readReviewPackets() {
  return readReviewPacketIndex()
    .map((item) => readReviewPacket(item.packetId))
    .filter((packet): packet is ReviewPacket => Boolean(packet))
}

function readReviewPacket(packetId: string) {
  try {
    const serialized = window.localStorage.getItem(reviewPacketKey(packetId))
    return serialized ? parseReviewPacket(serialized) : null
  } catch {
    return null
  }
}

function readReviewPacketIndex(): ReviewPacketListItem[] {
  try {
    const serialized = window.localStorage.getItem(reviewPacketIndexStorageKey)
    if (!serialized) return []
    const parsed = JSON.parse(serialized) as ReviewPacketListItem[]
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, LOCAL_REVIEW_PACKET_MAX_COUNT)
  } catch {
    return []
  }
}

function clearReviewPackets() {
  for (const item of readReviewPacketIndex()) {
    window.localStorage.removeItem(reviewPacketKey(item.packetId))
  }
  window.localStorage.removeItem(reviewPacketIndexStorageKey)
}

function reviewPacketKey(packetId: string) {
  return `${reviewPacketStoragePrefix}${packetId}`
}

function createAttemptTrace(roleId: string, artifactId: string): TraceContext {
  return {
    traceId: makeLocalId('trace'),
    candidateAttemptId: makeLocalId('attempt'),
    roleId,
    artifactId,
  }
}

function makeLocalId(prefix: string) {
  const randomId = window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${randomId}`.toLowerCase().replace(/[^a-z0-9-]/gu, '-')
}

function nowMs() {
  return window.performance?.now?.() ?? Date.now()
}

function artifactIcon(type: CandidateArtifact['artifactType']) {
  if (type === 'feature flag') return <Flag size={16} aria-hidden="true" />
  if (type === 'dashboard tile') return <Sparkles size={16} aria-hidden="true" />
  if (type === 'changelog') return <FileWarning size={16} aria-hidden="true" />
  if (type === 'support thread') return <ClipboardX size={16} aria-hidden="true" />
  return <AlertTriangle size={16} aria-hidden="true" />
}
