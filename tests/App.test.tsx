import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App'
import {
  EasterHireError,
  createCandidatePayload,
  defaultJobDescription,
  demoPayload,
  toPublicRoleLink,
  validateArtifact,
} from '../src/candidateData'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('candidate payload constraints', () => {
  it('rejects weak role descriptions instead of inventing specificity', () => {
    expect(() =>
      createCandidatePayload({
        company: 'Thin JD Inc',
        role: 'Engineer',
        jobDescription: 'We need a smart engineer who works hard.',
        seed: 1,
      }),
    ).toThrow(EasterHireError)
  })

  it('serializes only public-safe candidate data', () => {
    const payload = createCandidatePayload({
      company: 'Northstar Labs',
      role: 'Developer Experience Engineer',
      jobDescription: defaultJobDescription,
      seed: 4187,
    })
    const serialized = JSON.stringify(payload)

    expect(toPublicRoleLink(payload).length).toBeLessThanOrEqual(160)
    expect(serialized).not.toContain('jobDescription')
    expect(serialized).not.toContain('privateRubric')
    expect(serialized).not.toContain('solution')
    expect(serialized).not.toContain('hiddenTests')
    expect(serialized).not.toContain('answerKey')
    expect(serialized).not.toContain(defaultJobDescription)
  })

  it('enforces artifact shape, provenance, and public reviewer bounds', () => {
    const artifact = demoPayload.artifacts[0]

    expect(() => validateArtifact({ ...artifact, provenanceSignals: [] }, demoPayload.publicSignals)).toThrow(
      EasterHireError,
    )
    expect(() => validateArtifact({ ...artifact, artifactExcerpt: 'short' }, demoPayload.publicSignals)).toThrow(
      EasterHireError,
    )
    expect(() => validateArtifact({ ...artifact, roleRelevance: 'short' }, demoPayload.publicSignals)).toThrow(
      EasterHireError,
    )
    expect(() =>
      validateArtifact(
        {
          ...artifact,
          reviewerSignals: ['x'.repeat(141), 'Keeps the workflow reviewable.'],
        },
        demoPayload.publicSignals,
      ),
    ).toThrow(EasterHireError)
  })
})

describe('candidate-facing experience', () => {
  it('renders the candidate role hub by default without builder controls', () => {
    render(<App />)

    expect(screen.getByText('Choose a work artifact')).toBeTruthy()
    expect(screen.getByText(demoPayload.role)).toBeTruthy()
    expect(screen.queryByLabelText('Job description')).toBeNull()
    expect(screen.queryByLabelText('Random seed')).toBeNull()
    expect(screen.queryByText('Publish local role')).toBeNull()
    expect(screen.queryByText('Local reviewer packet')).toBeNull()
    expect(screen.queryByText('Clear local review packets')).toBeNull()
    expect(document.querySelectorAll('.artifact-card')).toHaveLength(demoPayload.artifacts.length)
  })

  it('rejects invalid public route payloads instead of loading demo content', () => {
    window.history.replaceState(null, '', '/#role=eyJqb2JEZXNjcmlwdGlvbiI')

    render(<App />)

    expect(screen.getByText('Invalid role link')).toBeTruthy()
    expect(screen.queryByText(demoPayload.role)).toBeNull()
  })

  it('blocks the editor until consent is accepted', () => {
    render(<App />)

    expect(screen.queryByLabelText('Protected candidate code editor')).toBeNull()
    expect(screen.getByText('Start with clear rules')).toBeTruthy()
    expect(screen.getByText(/best-effort browser restriction/u)).toBeTruthy()
    expect(screen.getByText('Activity replay')).toBeTruthy()
    expect(screen.getByText(/local code changes and named challenge events/u)).toBeTruthy()

    fireEvent.click(screen.getByText('Start challenge mode'))

    expect(screen.getByLabelText('Protected candidate code editor')).toBeTruthy()
  })

  it('blocks copy, paste, right-click, drop, and clipboard shortcuts in the code editor', () => {
    render(<App />)
    fireEvent.click(screen.getByText('Start challenge mode'))

    const editor = screen.getByLabelText('Protected candidate code editor')

    expect(fireEvent.copy(editor)).toBe(false)
    expect(screen.getByText('Copy blocked in protected editor')).toBeTruthy()

    expect(fireEvent.cut(editor)).toBe(false)
    expect(screen.getByText('Cut blocked in protected editor')).toBeTruthy()

    expect(fireEvent.paste(editor)).toBe(false)
    expect(screen.getByText('Paste blocked in protected editor')).toBeTruthy()

    expect(fireEvent.contextMenu(editor)).toBe(false)
    expect(screen.getByText('Right-click menu blocked in protected editor')).toBeTruthy()

    expect(fireEvent.drop(editor)).toBe(false)
    expect(screen.getByText('Drop blocked in protected editor')).toBeTruthy()

    expect(fireEvent.keyDown(editor, { key: 'c', ctrlKey: true })).toBe(false)
    expect(screen.getByText('Shortcut c blocked in protected editor')).toBeTruthy()

    expect(fireEvent.keyDown(editor, { key: 'v', metaKey: true })).toBe(false)
    expect(screen.getByText('Shortcut v blocked in protected editor')).toBeTruthy()
  })

  it('creates a local-only mock receipt without making network calls', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<App />)
    fireEvent.click(screen.getByText('Start challenge mode'))

    fireEvent.click(screen.getByText('Submit mock answer'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Prototype only: not sent to a hiring team.')).toBeTruthy()
  })

  it('blocks artifact switching when a dirty draft would be discarded', () => {
    render(<App />)
    const firstArtifactTitle = demoPayload.artifacts[0].artifactTitle
    const secondArtifact = demoPayload.artifacts[1]

    fireEvent.click(screen.getByText('Start challenge mode'))
    fireEvent.change(screen.getByLabelText('Protected candidate code editor'), {
      target: { value: `${demoPayload.artifacts[0].starterCode}\n// candidate change` },
    })
    fireEvent.click(screen.getByText(secondArtifact.artifactTitle))

    expect(screen.getByText('DraftConflictError')).toBeTruthy()
    expect(screen.getByRole('heading', { name: firstArtifactTitle })).toBeTruthy()
  })

  it('persists a local review packet and renders the private review route', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<App />)
    fireEvent.click(screen.getByText('Start challenge mode'))

    const editor = screen.getByLabelText('Protected candidate code editor')
    const finalCode = `${demoPayload.artifacts[0].starterCode}\n// reviewer packet change`
    fireEvent.change(editor, { target: { value: finalCode } })
    fireEvent.copy(editor)
    fireEvent.click(screen.getByText('Submit mock answer'))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByText('Mock receipt created')).toBeTruthy()

    window.history.replaceState(null, '', '/#review')
    window.dispatchEvent(new Event('hashchange'))

    expect(await screen.findByText('Local reviewer packet')).toBeTruthy()
    expect(screen.getByText('Starter diff')).toBeTruthy()
    expect(screen.getByText('Replay scrubber')).toBeTruthy()
    expect(screen.getByText('Semantic event timeline')).toBeTruthy()
    expect(screen.getByText('Clear local review packets')).toBeTruthy()
    expect(screen.getByText('editor_change')).toBeTruthy()
    expect(screen.getByText('clipboard_blocked')).toBeTruthy()
    expect(screen.getAllByText(/reviewer packet change/u).length).toBeGreaterThan(0)
  })

  it('blocks receipt creation when local review packet persistence fails and preserves the draft', () => {
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
      if (String(key).startsWith('easter-hire:review-packet:')) {
        throw new Error('quota exceeded')
      }
      return originalSetItem.call(this, key, value)
    })

    render(<App />)
    fireEvent.click(screen.getByText('Start challenge mode'))

    const editor = screen.getByLabelText('Protected candidate code editor') as HTMLTextAreaElement
    const finalCode = `${demoPayload.artifacts[0].starterCode}\n// preserved after failed packet save`
    fireEvent.change(editor, { target: { value: finalCode } })
    fireEvent.click(screen.getByText('Submit mock answer'))

    expect(screen.getByText(/ReplayPersistenceError/u)).toBeTruthy()
    expect(screen.queryByText('Mock receipt created')).toBeNull()
    expect(editor.value).toBe(finalCode)
  })
})
