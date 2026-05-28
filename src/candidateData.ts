import { assertArtifactPayloadSize, assertPublicRolePayloadSize } from './opsContracts'

export type Signals = {
  stack: string[]
  work: string[]
  domains: string[]
  seniority: string
}

export type ArtifactType = 'incident' | 'changelog' | 'feature flag' | 'support thread' | 'dashboard tile'

export type CandidateArtifact = {
  artifactId: string
  artifactType: ArtifactType
  artifactTitle: string
  artifactExcerpt: string
  roleRelevance: string
  provenanceSignals: string[]
  task: string
  acceptanceCriteria: string[]
  reviewerSignals: string[]
  starterCode: string
  timeEstimate: string
  difficulty: string
}

export type PublicCandidatePayload = {
  schemaVersion: 1
  roleId: string
  company: string
  role: string
  publicSignals: {
    stack: string[]
    work: string[]
    domains: string[]
    seniority: string
  }
  artifacts: CandidateArtifact[]
}

export type BuildInput = {
  company: string
  role: string
  jobDescription: string
  seed: number
}

export type BuildFailureCode =
  | 'InsufficientRoleSignalError'
  | 'InvalidArtifactProvenanceError'
  | 'PrivateEvaluationLeakError'
  | 'InvalidPublicRouteError'
  | 'PublicSurfaceLeakError'
  | 'IntegrityCopyError'

export class EasterHireError extends Error {
  code: BuildFailureCode

  constructor(code: BuildFailureCode, message: string) {
    super(message)
    this.name = code
    this.code = code
  }
}

type Blueprint = {
  blueprintId: string
  artifactType: ArtifactType
  artifactTitle: string
  matches: string[]
  build: (signals: Signals, random: () => number) => Omit<CandidateArtifact, 'artifactId'>
}

const allowedArtifactTypes: ArtifactType[] = [
  'incident',
  'changelog',
  'feature flag',
  'support thread',
  'dashboard tile',
]

const forbiddenPublicKeys = [
  'jobDescription',
  'privateRubric',
  'rubric',
  'solution',
  'hiddenTests',
  'answerKey',
  'scoringWeight',
  'scoreWeight',
]

const publicRoutePattern = /^#role=([a-z0-9-]{3,64})(?:&artifact=([a-z0-9-]{3,64}))?$/u

const integrityPhrase = 'best-effort browser restriction'
const forbiddenIntegrityTerms = ['secure', 'cheat-proof', 'proctored', 'prevents cheating']

export const integrityRestrictionCopy = validateIntegrityCopy(
  `Copy, cut, paste, drop, and right-click are disabled as a ${integrityPhrase}.`,
)

const techPatterns = [
  ['TypeScript', /\btypescript\b|\bts\b/i],
  ['React', /\breact\b/i],
  ['Node.js', /\bnode(?:\.js)?\b/i],
  ['Python', /\bpython\b/i],
  ['GraphQL', /\bgraphql\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['Redis', /\bredis\b/i],
  ['AWS', /\baws\b|lambda|cloudfront|s3\b/i],
  ['Kubernetes', /\bkubernetes\b|\bk8s\b/i],
  ['Terraform', /\bterraform\b/i],
  ['Kafka', /\bkafka\b/i],
  ['Go', /\bgolang\b|\bgo services\b|\bgo\b/i],
  ['Java', /\bjava\b/i],
  ['Next.js', /\bnext(?:\.js)?\b/i],
  ['Django', /\bdjango\b/i],
  ['Rails', /\brails\b|ruby on rails/i],
] satisfies Array<[string, RegExp]>

const workPatterns = [
  ['frontend', /frontend|front-end|ui\b|react|component|design system/i],
  ['backend', /backend|back-end|service|api|endpoint|server|webhook/i],
  ['data', /data pipeline|analytics|warehouse|etl|event stream|metrics|reporting/i],
  ['infrastructure', /infra|infrastructure|kubernetes|terraform|deploy|ci\/cd|platform/i],
  ['security', /security|auth|permission|oauth|token|privacy|compliance/i],
  ['testing', /test automation|unit test|integration test|qa|reliability|regression/i],
  ['observability', /observability|telemetry|logging|tracing|metrics|incident/i],
  ['performance', /performance|latency|profile|scalability|throughput/i],
  ['accessibility', /accessibility|a11y|screen reader|keyboard/i],
  ['payments', /payment|billing|invoice|stripe|checkout|subscription/i],
  ['realtime', /realtime|real-time|websocket|collaboration|chat|presence/i],
  ['mobile', /mobile|ios|android|react native/i],
  ['developer experience', /developer experience|devex|internal tool|workflow|cli/i],
] satisfies Array<[string, RegExp]>

const domainPatterns = [
  ['marketplace', /marketplace|two-sided|seller|buyer/i],
  ['healthcare', /healthcare|patient|clinical|hipaa/i],
  ['finance', /finance|banking|ledger|risk|loan/i],
  ['education', /education|learning|student|course/i],
  ['commerce', /commerce|ecommerce|cart|checkout|retail/i],
  ['ai tooling', /\bai\b|ml\b|model|prompt|inference/i],
  ['developer tools', /developer tool|developer experience|devex|sdk|api platform|internal developer/i],
] satisfies Array<[string, RegExp]>

export const defaultJobDescription = `Senior Product Engineer, Developer Experience

We are hiring an engineer to build TypeScript and React surfaces for internal developer workflows. The work includes API integrations, design-system components, test automation, performance profiling, telemetry, and debugging production incidents. Candidates should be comfortable with Node services, accessibility, observability, and shipping small improvements without breaking existing workflows.`

const blueprints: Blueprint[] = [
  {
    blueprintId: 'incident-webhook-echo',
    artifactType: 'support thread',
    artifactTitle: 'Support Thread: Duplicate Customer Action',
    matches: ['backend', 'api', 'Node.js', 'GraphQL', 'payments', 'security'],
    build: (signals, random) => {
      const work = firstWorkSignal(signals, ['backend', 'payments'])
      const stack = primaryStack(signals)
      return {
        artifactType: 'support thread',
        artifactTitle: pick(['Support Thread: Duplicate Customer Action', 'Partner Escalation: Replayed Webhook'], random),
        artifactExcerpt:
          'Support has two customer records showing the same partner action applied twice. The payload timestamps differ by seconds, and the audit trail is too noisy to tell which event should win.',
        roleRelevance: `This mirrors the ${work} work in the role: protecting a production integration from duplicate events while keeping the customer-facing workflow auditable.`,
        provenanceSignals: signalSet(signals, [work, stack, 'security', 'payments']),
        task: `Design and implement an idempotent ${stack} handler for a ${work} event that may arrive out of order or more than once.`,
        acceptanceCriteria: [
          `Rejects or safely ignores duplicate ${work} event deliveries.`,
          'Keeps event processing auditable without leaking sensitive payload fields.',
          'Includes tests for duplicate, stale, and valid event paths.',
        ],
        reviewerSignals: [
          'Makes idempotency explicit and durable enough for the stated environment.',
          'Separates validation, persistence, and side effects.',
          'Names the operational failure modes the code is defending against.',
        ],
        starterCode: `type PartnerEvent = {
  id: string
  userId: string
  action: 'created' | 'updated' | 'deleted'
  occurredAt: string
}

const processedEventIds = new Set<string>()

export async function handlePartnerEvent(event: PartnerEvent) {
  processedEventIds.add(event.id)
}`,
        timeEstimate: '50-70 min',
        difficulty: seniorityDifficulty(signals),
      }
    },
  },
  {
    blueprintId: 'incident-render-budget',
    artifactType: 'incident',
    artifactTitle: 'Incident Note: Render Budget Drift',
    matches: ['frontend', 'performance', 'React', 'TypeScript', 'Next.js'],
    build: (signals, random) => {
      const work = firstWorkSignal(signals, ['frontend', 'performance'])
      const stack = primaryStack(signals)
      return {
        artifactType: 'incident',
        artifactTitle: pick(['Incident Note: Render Budget Drift', 'Perf Review: Slow Workflow Panel'], random),
        artifactExcerpt:
          'The workflow panel crossed its render budget after a small rollout. A profile shows repeated state derivation during routine clicks, but the visible behavior must remain unchanged.',
        roleRelevance: `This reflects the ${work} work in the role: improving a real user workflow without rewriting unrelated product surfaces or weakening accessibility.`,
        provenanceSignals: signalSet(signals, [work, stack, 'performance', 'testing']),
        task: `Implement a contained ${stack} fix that reduces avoidable ${work} renders while preserving state and accessibility behavior.`,
        acceptanceCriteria: [
          `Keeps the same visible ${work} behavior for the workflow panel.`,
          'Adds a focused regression check around the expensive state transition.',
          'Explains the performance signal that proves the fix worked.',
        ],
        reviewerSignals: [
          'Targets the actual bottleneck instead of rewriting the component tree.',
          'Preserves keyboard and screen-reader access.',
          'Uses a test or measurement tied to the production symptom.',
        ],
        starterCode: `type WorkflowItem = {
  id: string
  status: 'queued' | 'running' | 'done'
  owner: string
}

export function summarize(items: WorkflowItem[]) {
  return items.reduce(
    (acc, item) => {
      acc[item.status] += 1
      return acc
    },
    { queued: 0, running: 0, done: 0 },
  )
}`,
        timeEstimate: '45-60 min',
        difficulty: seniorityDifficulty(signals),
      }
    },
  },
  {
    blueprintId: 'dashboard-silent-alert',
    artifactType: 'dashboard tile',
    artifactTitle: 'Dashboard Tile: Silent Workflow',
    matches: ['observability', 'testing', 'backend', 'developer experience', 'Node.js'],
    build: (signals, random) => {
      const work = firstWorkSignal(signals, ['observability', 'backend'])
      const stack = primaryStack(signals)
      return {
        artifactType: 'dashboard tile',
        artifactTitle: pick(['Dashboard Tile: Silent Workflow', 'Ops Tile: Missing Failure Signal'], random),
        artifactExcerpt:
          'The workflow tile stayed green during a customer-impacting timeout. Logs exist, but there is no stable signal tying the decision point, failure reason, and correlation id together.',
        roleRelevance: `This is the ${work} judgment the role needs: making failures visible with useful telemetry while avoiding noisy or sensitive production signals.`,
        provenanceSignals: signalSet(signals, [work, stack, 'observability', 'testing']),
        task: `Add useful ${work} telemetry to a ${stack} workflow without turning the code into a logging exercise.`,
        acceptanceCriteria: [
          `Captures the ${work} decision point, failure reason, and correlation id.`,
          'Avoids logging secrets or high-cardinality payloads.',
          'Provides one alert condition that would have caught the incident.',
        ],
        reviewerSignals: [
          'Adds instrumentation at the decision boundary.',
          'Keeps signal names stable and reviewable.',
          'Connects telemetry to incident response rather than vanity metrics.',
        ],
        starterCode: `type RunResult = {
  ok: boolean
  reason?: string
  correlationId: string
}

export async function runWorkflow(userId: string): Promise<RunResult> {
  const correlationId = crypto.randomUUID()
  const ok = userId.length % 5 !== 0

  return { ok, reason: ok ? undefined : 'upstream_timeout', correlationId }
}`,
        timeEstimate: '35-50 min',
        difficulty: seniorityDifficulty(signals),
      }
    },
  },
  {
    blueprintId: 'changelog-vanishing-event',
    artifactType: 'changelog',
    artifactTitle: 'Changelog Entry: Event Schema v3',
    matches: ['data', 'PostgreSQL', 'Kafka', 'analytics', 'observability'],
    build: (signals, random) => {
      const work = firstWorkSignal(signals, ['data', 'observability'])
      const stack = primaryStack(signals)
      return {
        artifactType: 'changelog',
        artifactTitle: pick(['Changelog Entry: Event Schema v3', 'Analytics Note: Metric Drop'], random),
        artifactExcerpt:
          'A weekly metric dropped after the event schema moved from optional plan fields to nullable plan fields. The backfill notes never say how historical rows should be repaired.',
        roleRelevance: `This maps to the ${work} work in the role: protecting metrics and ingestion behavior when product events change shape under production load.`,
        provenanceSignals: signalSet(signals, [work, stack, 'data', 'observability']),
        task: `Find why a ${work} metric loses rows and propose a typed repair path that protects future ${stack} event changes.`,
        acceptanceCriteria: [
          `Identifies the ${work} join or schema assumption causing the drop.`,
          'Adds a validation check for future event shape changes.',
          'Keeps historical backfill behavior explicit.',
        ],
        reviewerSignals: [
          'Treats missing data as a first-class failure mode.',
          'Documents the schema contract in code or tests.',
          'Separates one-time repair from ongoing ingestion behavior.',
        ],
        starterCode: `type SignupEvent = {
  user_id: string
  plan?: 'free' | 'team' | 'enterprise' | null
  created_at: string
}

export function normalizeSignup(event: SignupEvent) {
  return {
    userId: event.user_id,
    plan: event.plan,
    createdAt: new Date(event.created_at),
  }
}`,
        timeEstimate: '45-65 min',
        difficulty: seniorityDifficulty(signals),
      }
    },
  },
  {
    blueprintId: 'feature-flag-fuse',
    artifactType: 'feature flag',
    artifactTitle: 'Feature Flag: Canary Fuse',
    matches: ['infrastructure', 'security', 'developer experience', 'AWS', 'Kubernetes', 'Terraform'],
    build: (signals, random) => {
      const work = firstWorkSignal(signals, ['infrastructure', 'developer experience'])
      const stack = primaryStack(signals)
      return {
        artifactType: 'feature flag',
        artifactTitle: pick(['Feature Flag: Canary Fuse', 'Rollout Flag: Fast Revert Path'], random),
        artifactExcerpt:
          'A rollout flag can open to five percent of users, but the current preview does not show who changed it, when rollback triggers, or which cohorts are protected.',
        roleRelevance: `This is practical ${work} work from the role: making rollout behavior visible, reversible, and safe before irreversible writes reach users.`,
        provenanceSignals: signalSet(signals, [work, stack, 'security', 'developer experience']),
        task: `Design a ${work} rollout guard for a ${stack} workflow where a bad deploy must be contained quickly and visibly.`,
        acceptanceCriteria: [
          `Defines when the ${work} flag opens, closes, and rolls back.`,
          'Includes a minimal audit trail for operator actions.',
          'Avoids irreversible writes during dry-run or preview mode.',
        ],
        reviewerSignals: [
          'Keeps rollout behavior deterministic and explainable.',
          'Surfaces operator intent and rollback criteria.',
          'Protects users outside the intended exposure group.',
        ],
        starterCode: `type RolloutState = {
  enabled: boolean
  percentage: number
  changedBy: string
}

export function canServeVariant(userId: string, rollout: RolloutState) {
  if (!rollout.enabled) return false
  return userId.length % 100 < rollout.percentage
}`,
        timeEstimate: '55-75 min',
        difficulty: seniorityDifficulty(signals),
      }
    },
  },
]

export function extractSignals(jobDescription: string): Signals {
  const stack = techPatterns.filter(([, pattern]) => pattern.test(jobDescription)).map(([label]) => label)
  const work = workPatterns.filter(([, pattern]) => pattern.test(jobDescription)).map(([label]) => label)
  const domains = domainPatterns.filter(([, pattern]) => pattern.test(jobDescription)).map(([label]) => label)
  const lower = jobDescription.toLowerCase()
  const seniority = lower.includes('staff') || lower.includes('principal')
    ? 'Staff-level'
    : lower.includes('senior') || lower.includes('lead')
      ? 'Senior'
      : lower.includes('junior') || lower.includes('entry')
        ? 'Early-career'
        : 'Mid-level'

  return { stack, work, domains, seniority }
}

export function assertEnoughRoleSignal(signals: Signals) {
  const hasTwoWorkSignals = signals.work.length >= 2
  const hasWorkPlusStackOrDomain = signals.work.length >= 1 && signals.stack.length + signals.domains.length >= 1
  if (!hasTwoWorkSignals && !hasWorkPlusStackOrDomain) {
    throw new EasterHireError(
      'InsufficientRoleSignalError',
      'Not enough role signal: add specific work areas plus stack or domain language.',
    )
  }
}

export function createCandidatePayload(input: BuildInput): PublicCandidatePayload {
  const signals = extractSignals(input.jobDescription)
  assertEnoughRoleSignal(signals)
  const random = seededRandom(`${input.jobDescription}:${input.seed}`)
  const artifacts = selectArtifacts(input.jobDescription, signals, random)
  const payload: PublicCandidatePayload = {
    schemaVersion: 1,
    roleId: makeRoleId(input.company, input.role, input.seed),
    company: input.company.trim() || 'Unlisted Company',
    role: input.role.trim() || 'Software Engineer',
    publicSignals: {
      stack: signals.stack.slice(0, 5),
      work: signals.work.slice(0, 6),
      domains: signals.domains.slice(0, 4),
      seniority: signals.seniority,
    },
    artifacts,
  }
  validatePublicPayload(payload)
  return payload
}

export function validatePublicPayload(payload: PublicCandidatePayload) {
  const serialized = JSON.stringify(payload)
  assertPublicRolePayloadSize(serialized)

  for (const key of forbiddenPublicKeys) {
    if (serialized.includes(key)) {
      throw new EasterHireError('PrivateEvaluationLeakError', `Public payload contains forbidden key: ${key}`)
    }
  }

  if (payload.schemaVersion !== 1 || !/^[a-z0-9-]{3,64}$/u.test(payload.roleId)) {
    throw new EasterHireError('InvalidPublicRouteError', 'Public payload must use schema version 1 and an opaque role id.')
  }

  if (payload.artifacts.length < 2 || payload.artifacts.length > 4) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Candidate payload must expose 2-4 artifacts.')
  }

  payload.artifacts.forEach((artifact) => validateArtifact(artifact, payload.publicSignals))
}

export function validateArtifact(artifact: CandidateArtifact, signals: Signals) {
  assertArtifactPayloadSize(JSON.stringify(artifact))

  if (!allowedArtifactTypes.includes(artifact.artifactType)) {
    throw new EasterHireError('InvalidArtifactProvenanceError', `Unsupported artifact type: ${artifact.artifactType}`)
  }

  if (artifact.provenanceSignals.length < 2) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Artifact needs at least two provenance signals.')
  }

  if (artifact.artifactExcerpt.length < 80 || artifact.artifactExcerpt.length > 240) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Artifact excerpt must be 80-240 characters.')
  }

  if (artifact.roleRelevance.length < 60 || artifact.roleRelevance.length > 180) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Artifact relevance must be 60-180 characters.')
  }

  if (artifact.reviewerSignals.length < 2 || artifact.reviewerSignals.length > 4) {
    throw new EasterHireError('PrivateEvaluationLeakError', 'Public reviewer signals must contain 2-4 items.')
  }

  if (artifact.reviewerSignals.some((signal) => signal.length > 140)) {
    throw new EasterHireError('PrivateEvaluationLeakError', 'Public reviewer signal exceeds 140 characters.')
  }

  const lowerTask = artifact.task.toLowerCase()
  const lowerAcceptance = artifact.acceptanceCriteria.join(' ').toLowerCase()
  const referencesWorkInTask = signals.work.some((signal) => lowerTask.includes(signal.toLowerCase()))
  const referencesWorkInAcceptance = signals.work.some((signal) => lowerAcceptance.includes(signal.toLowerCase()))

  if (!referencesWorkInTask || !referencesWorkInAcceptance) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Artifact must reference a work signal in task and acceptance.')
  }
}

export function validateIntegrityCopy(copy: string) {
  const phraseCount = copy.split(integrityPhrase).length - 1
  const lower = copy.toLowerCase()

  if (phraseCount !== 1 || forbiddenIntegrityTerms.some((term) => lower.includes(term))) {
    throw new EasterHireError('IntegrityCopyError', 'Integrity copy must disclose the exact browser restriction boundary.')
  }

  return copy
}

export function parsePublicRoute(hash: string) {
  if (!hash || hash === '#') return { roleId: demoPayload.roleId, artifactId: undefined }
  if (hash === '#builder') return null
  if (hash.length > 160 || !publicRoutePattern.test(hash)) {
    throw new EasterHireError('InvalidPublicRouteError', 'Invalid role link.')
  }
  const match = hash.match(publicRoutePattern)
  return { roleId: match?.[1] ?? demoPayload.roleId, artifactId: match?.[2] }
}

export function toPublicRoleLink(payload: PublicCandidatePayload, artifactId?: string) {
  const link = `#role=${payload.roleId}${artifactId ? `&artifact=${artifactId}` : ''}`
  if (link.length > 160) {
    throw new EasterHireError('InvalidPublicRouteError', 'Public role link exceeds 160 characters.')
  }
  return link
}

export const demoPayload = createCandidatePayload({
  company: 'Northstar Labs',
  role: 'Developer Experience Engineer',
  jobDescription: defaultJobDescription,
  seed: 4187,
})

function selectArtifacts(jobDescription: string, signals: Signals, random: () => number) {
  const normalizedSignals = new Set([...signals.stack, ...signals.work, ...signals.domains].map((signal) => signal.toLowerCase()))
  const scored = blueprints
    .map((blueprint) => {
      const score = blueprint.matches.reduce((total, match) => {
        const normalized = match.toLowerCase()
        return total + (normalizedSignals.has(normalized) ? 3 : jobDescription.toLowerCase().includes(normalized) ? 1 : 0)
      }, random())
      return { blueprint, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ blueprint }) => {
      const artifact = blueprint.build(signals, random)
      return {
        artifactId: `${blueprint.blueprintId}-${makeShortHash(artifact.artifactTitle + artifact.task)}`,
        ...artifact,
      }
    })

  const validArtifacts = scored.filter((artifact) => {
    try {
      validateArtifact(artifact, signals)
      return true
    } catch {
      return false
    }
  })

  if (validArtifacts.length < 2) {
    throw new EasterHireError('InvalidArtifactProvenanceError', 'Fewer than two valid artifacts remain.')
  }

  return validArtifacts.slice(0, 4)
}

function signalSet(signals: Signals, requested: string[]) {
  const available = new Set([...signals.stack, ...signals.work, ...signals.domains])
  const selected = requested.filter((signal) => available.has(signal))
  const fillers = [...signals.work, ...signals.stack, ...signals.domains].filter((signal) => !selected.includes(signal))
  return Array.from(new Set([...selected, ...fillers])).slice(0, 4)
}

function firstWorkSignal(signals: Signals, preferred: string[]) {
  return preferred.find((signal) => signals.work.includes(signal)) ?? signals.work[0] ?? 'software'
}

function primaryStack(signals: Signals) {
  return signals.stack[0] ?? 'TypeScript'
}

function seniorityDifficulty(signals: Signals) {
  if (signals.seniority === 'Staff-level') return 'Architecture-heavy'
  if (signals.seniority === 'Senior') return 'Senior'
  if (signals.seniority === 'Early-career') return 'Focused'
  return 'Practical'
}

function pick<T>(values: T[], random: () => number): T {
  return values[Math.floor(random() * values.length)] ?? values[0]
}

function makeRoleId(company: string, role: string, seed: number) {
  const slug = `${company}-${role}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 38)
  return `${slug || 'role'}-${makeShortHash(`${company}:${role}:${seed}`)}`.slice(0, 64)
}

function makeShortHash(value: string) {
  let state = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    state ^= value.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }
  return (state >>> 0).toString(36).slice(0, 8)
}

function seededRandom(seedText: string) {
  let state = 2166136261
  for (let index = 0; index < seedText.length; index += 1) {
    state ^= seedText.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }

  return () => {
    state += 0x6d2b79f5
    let result = state
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}
