# Easter Hire Candidate Experience Spec

## Summary

The candidate-facing experience is the default product surface: a high-trust role hub with visible work-shaped artifact cards, a clear consent gate, and a focused issue-style coding workspace. The design goal is discovery without hazing.

## Constraints & Fallbacks

Public candidate links must contain only bounded public identifiers: `roleId` and optional `artifactId`, with total query/hash length capped at `160` characters. If a public link contains raw JD text, JSON/base64 app state, private rubric data, or any invalid schema, the app must reject it with `InvalidPublicRouteError` and render only a safe "Invalid role link" state.

Candidate routes must render exactly `0` recruiter, builder, debug, seed, regeneration, publish, or private-rubric controls. If any public candidate surface attempts to mount those controls, the app must fail fast with `PublicSurfaceLeakError` rather than hiding or degrading them.

Challenge generation must fail closed unless the JD yields either at least `2` work signals or at least `1` work signal plus `1` stack/domain signal. If this threshold is not met, the system must return `InsufficientRoleSignalError`, show "Not enough role signal," and render `0` candidate artifact cards.

Every candidate artifact must include at least `2` provenance signals, an `artifactExcerpt` of `80-240` characters, and a `roleRelevance` sentence of `60-180` characters. If fewer than `2` valid artifacts remain after validation, reject the entire challenge set with `InvalidArtifactProvenanceError`.

The locked editor must render `0` editable code fields until the candidate accepts the consent gate. The consent gate must disclose time estimate, clipboard limits, evaluation criteria, and persistence status; missing consent must raise `ConsentRequiredError`.

Clipboard restrictions must be described as a "best-effort browser restriction" exactly once and must never be described as secure, cheat-proof, proctored, or cheating prevention. If required integrity copy is missing or forbidden copy appears, fail validation with `IntegrityCopyError`.

In frontend-only prototype mode, submission may perform `0` network calls and the receipt must say "Prototype only: not sent to a hiring team." If receipt copy implies real persistence or delivery, block the receipt with `MockReceiptDisclosureError`.

Public challenge payloads may expose only public `reviewerSignals`, limited to `2-4` strings of at most `140` characters each. Private rubrics, scoring weights, solutions, hidden tests, and answer keys must never appear in public payloads; violation raises `PrivateEvaluationLeakError`.

Candidate drafts must be capped at `64KB`, autosaved locally within `1000ms`, and protected from reset, route changes, artifact switching, or refresh loss by explicit destructive confirmation. If a dirty draft would be discarded, reject the action with `DraftConflictError` and preserve the draft.

The candidate UI must support `360-1440px` viewport widths with `0px` horizontal overflow and no clipped primary controls. If layout verification detects horizontal scroll or clipped actions, the build must fail rather than ship the candidate surface.

### Operations Constraints & Fallbacks

Production draft autosave must be rate-limited to at most `1` persisted draft write per `candidateAttemptId` and `artifactId` every `10s`, with each draft capped at `64KB` and exactly `1` pending write per key. If the client or server exceeds that limit, reject the write with `429 DraftWriteRateExceeded` or `409 DraftVersionConflict` and do not enqueue, retry, or partially persist it.

Public role payloads must be rejected before JSON parsing if the request body exceeds `32KB`, and each artifact payload must remain under `8KB`. If either bound is exceeded, return `413 PayloadTooLarge` immediately.

A public role link may be shown only after durable storage commits exactly `1` role row and `2-4` artifact rows in one transaction. If the durable role does not exist, return `404 RoleNotFound`; if the artifact set is invalid, roll back and return `422 InvalidArtifactSet`.

Candidate attempts must use the state machine `created -> consented -> draft_active -> submitted -> receipt_issued -> review_ready`, and no transition may skip a state. If a transition lacks required consent, draft, submission, or receipt data, reject it with `409 ConsentRequired` or `409 InvalidAttemptTransition`.

Submission must atomically write the latest draft buffer, the submission record, the receipt record, and `attemptState=submitted` within `5s`. If any write fails or times out, roll back the transaction, return `503 SubmitTransactionFailed`, and leave the attempt in `draft_active`.

Reviewer handoff must be idempotent and may lag receipt creation by at most `60s`. If handoff is not complete after `60s`, mark `handoff_status=failed`, emit `review_handoff_failed`, and exclude the attempt from reviewer queues until repaired.

A reconciler must run every `60s` and mark any illegal or incomplete attempt state older than `120s` as `needs_repair`. `needs_repair` attempts must never appear in candidate success screens or reviewer queues.

Client draft persistence must either complete within `1000ms` or show `DraftPersistenceError`; local storage quota failures may be silently swallowed `0` times. Submit must synchronously flush the current editor buffer before creating a receipt, otherwise block with `DraftFlushFailed`.

Every candidate event, API request, log, metric, and trace span must include `traceId`, `candidateAttemptId`, `roleId`, and `artifactId`. If any field is missing, reject the event with `400 MissingTraceContext` and emit one structured error using a generated `errorId`.

Production telemetry must include invalid route rate, generation rejection rate, autosave latency, autosave failure rate, draft size p95, consent-to-start conversion, start-to-submit conversion, submit transaction failure rate, and reviewer handoff failure rate. CI must fail telemetry contract tests if any required metric emitter is missing.

Structured logs may include `0` raw JD characters and `0` candidate draft/code characters. Logs may contain only ids, byte sizes, content hashes, state names, timings, and error codes; forbidden fields must trigger `LogRedactionError` and fail CI.

### Process Replay Constraints & Fallbacks

Replay capture must record exactly `0` events before consent and may persist at most `600` replay events, `2048` inserted characters per delta, and `512KB` per serialized replay packet. If any bound is exceeded, the app must fail fast with `ReplayConsentRequired`, `ReplayEventLimitExceeded`, `ReplayDeltaTooLarge`, or `ReplayPayloadTooLarge`, block receipt creation, and preserve the in-memory draft.

A review packet may be created only if `starterCode + replayDeltas === finalCode`, every event has monotonic relative ordering, and the packet belongs to exactly `1` `traceId`, `candidateAttemptId`, `roleId`, and `artifactId`. If reconstruction, ordering, or identity validation fails, block submission with `ReplayCaptureError`.

Replay artifacts may contain candidate code, but logs, metrics, traces, debug panels, and telemetry may contain `0` replay deltas, final code, editor snapshots, diffs, or review packet objects. Forbidden replay/code fields must raise `LogRedactionError` and fail CI.

The local prototype may store at most `10` review packets, each capped at `512KB`, and must expose a visible clear-local-review-packets control on the review surface. If storage quota, packet validation, or review persistence fails, create `0` receipts, show `ReplayPersistenceError`, and preserve the current draft.

Candidate routes must render exactly `0` reviewer navigation controls, review packet links, review packet labels, or `#review` affordances. If the candidate surface attempts to expose reviewer access, fail with `PublicSurfaceLeakError`.

Process summaries must be derived only from recorded event counts, timestamps, and validated diffs, with `0` claims about cheating, honesty, effort, confidence, or intent. Any unbacked or moralized summary copy must fail validation with `ReplaySummaryIntegrityError`.

Replay may capture only named semantic actions such as editor focus, editor blur, code change, reset, blocked clipboard action, autosave, submit, draft flush, and receipt issue. Pointer coordinates, pointer trails, full-screen recording, webcam data, keystroke biometrics, and unnamed clicks must be captured `0` times.

## Explicit Anti-Goals

- We are not required to defend against candidates who bypass browser-side clipboard restrictions using devtools, browser extensions, custom clients, OCR, screenshots, external devices, or manual retyping workflows. Clipboard blocking is a friction and consistency layer, not a security boundary.
- We are not required to support every possible engineering assessment format in this pass. System design interviews, long-form architecture essays, pair-programming sessions, behavioral interviews, and multi-day take-homes are out of scope.
- We are not required to optimize the issue-workspace metaphor for every engineering culture, seniority level, or candidate background in this pass. The v1 candidate experience may assume familiarity with common engineering artifacts such as incidents, changelogs, feature flags, support tickets, and dashboards.
- We are not required to engineer advanced recovery for corrupted, hand-edited, or maliciously modified hash payloads beyond rejecting invalid public role data and showing a safe empty/error state.
- We are not required to build proctoring, identity verification, webcam monitoring, keystroke biometrics, plagiarism scoring, or external-tool detection in this pass.
- We are not required to preserve candidate work across devices, browsers, private-mode sessions, storage-clearing events, or expired prototype links unless backend persistence is explicitly added later.
- We are not required to make the easter egg discovery fully secret. For v1, visible work-shaped artifact cards are acceptable; the "easter egg" is the framing and relevance, not an obscure hidden unlock.
- We are not required to perfectly reconstruct browser-specific input behavior across IME composition, mobile keyboard autocorrect, autocomplete tools, browser undo stacks, or operating-system text services in this pass. Replay may support standard textarea input events only.
- We are not required to preserve replay packets across devices, browsers, private browsing sessions, storage-clearing events, or shared-machine cleanup unless backend persistence is explicitly added later.
- We are not required to defend against candidates or reviewers who manually inspect, modify, export, or delete localStorage data in this frontend-only prototype.
- We are not required to classify candidate intent from clipboard, reset, focus, blur, or timing events. The system records neutral process facts only, not cheating, effort, confidence, or honesty judgments.
- We are not required to support full screen recording, pointer trails, webcam capture, keystroke biometrics, eye tracking, or proctoring-grade behavioral replay in this pass.
- We are not required to guarantee wall-clock accuracy under device clock changes, sleep/wake behavior, throttled background tabs, or browser timer clamping. Replay ordering may rely on monotonic relative timestamps only.
