# ArcForge

> A git-native coordination layer for AI agent swarms.

Agents don't need a GitHub UI — they need a protocol. Every task is a branch
with a machine-readable spec. Every agent works in an isolated fork. Every
change proposal carries its rationale. Conflicts are predicted before merge.
Review is agent-to-agent. Every merge commit embeds the full why-chain.

_(Full README coming — this is the competition build scaffold.)_

## Quick start

```bash
node demo/run-demo.js
```

Then open `packages/dashboard/index.html` in a browser to watch the swarm
board replay the run from `packages/dashboard/state.json`.

## Packages

- `packages/core` — protocol primitives: task specs, claims, workspaces,
  overlap prediction, review, merge arbitration, repo backends
  (local git + Cloudflare Artifacts).
- `packages/agents` — agent runner against any OpenAI-compatible endpoint
  (degrades to a deterministic stub when no API key is set).
- `packages/dashboard` — live swarm board (dark, ARC-style), reads
  `state.json` written by the demo runner.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 David Cain.
