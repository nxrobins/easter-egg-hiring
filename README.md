# Easter Hire

Candidate-first prototype for software engineering hiring. Easter Hire turns a private job description into public-safe, work-shaped challenge artifacts and presents them as a high-trust role hub.

## Product Shape

- Default route: candidate role hub with visible work artifact cards.
- Builder route: `#builder`, used only to generate a local public-safe role payload.
- Public role route: `#role=<roleId>` with optional `&artifact=<artifactId>`.
- Challenge mode: consent gate first, then a locked editor with local draft autosave, bounded process replay capture, and a mock receipt.
- Review route: `#review`, a private-by-convention local reviewer packet surface for submitted mock attempts.

Public links never serialize raw job descriptions or private scoring data. The prototype stores locally published roles, drafts, replay packets, and review packets in browser storage and keeps submissions local/mock only.

## Run

```bash
npm install
npm run dev
```

Local URL:

```text
http://127.0.0.1:5173
```

Builder URL:

```text
http://127.0.0.1:5173/#builder
```

Local review URL:

```text
http://127.0.0.1:5173/#review
```

## Verify

```bash
npm test
npm run build
```

See [SPEC.md](./SPEC.md) for the hardened candidate-experience constraints and anti-goals.
