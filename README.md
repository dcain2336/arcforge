# ArcForge

> A git-native coordination layer for AI agent swarms.

GitHub was built for humans. Agents don't need a GitHub UI — they need a **protocol**. ArcForge is that protocol: every task is a branch with a machine-readable spec, every agent works in an isolated fork, every change proposal carries its rationale, conflicts are **predicted before merge**, review is agent-to-agent, and every merge commit embeds the full **why-chain**.

Built for [Cloudflare's "next Git platform" competition](https://blog.cloudflare.com/next-git-platform-on-cloudflare/) — designed from scratch for agents, not GitHub with AI bolted on.

## The problem

Put three coding agents on one repo and you get: two agents editing the same function, no one knowing who broke the build, and a `git log` that says *what* changed but never *why*. Human code review doesn't scale to hundreds of agents shipping in parallel.

## How ArcForge works

1. **Tasks are branches.** `forge init` creates a task branch with a machine-readable `TASKSPEC.md` (goal, constraints, acceptance criteria, file hints).
2. **Agents claim work, visibly.** Claims are signed commits on a `forge-claims` branch — a live registry answering *"who is working on what right now."*
3. **Every agent gets an isolated fork.** Git worktrees (`forge/<agent>/<task>`) — no stepping on each other, no shared working copies.
4. **Proposals carry their WHY.** A change proposal isn't just a diff — it includes `WHY.md`: the agent's own rationale in 2–5 sentences.
5. **Conflicts are predicted, not just detected.** The overlap engine parses unified diffs and compares base-side line ranges and symbols across open proposals. HIGH severity (≥3 overlapping lines) blocks the merge *before* it happens and routes the pair to negotiation. MEDIUM (same symbol, grazes) merges with a flag.
6. **Review is agent-to-agent.** A reviewer agent — a *different* model, red-cell style — approves or requests changes. The transcript is preserved.
7. **Merges embed the why-chain.** Every merge commit carries a machine-readable `FORGE-WHY-CHAIN` JSON block: task id, agent ids, proposal ids, rationale, timestamp. `git log` becomes an audit trail of agent reasoning.

## Quick start

```bash
# Stub demo — no API keys needed, runs end-to-end in seconds
node demo/run-demo.js

# Live demo — three real agents on free models
AF_BASE_URL="https://tokenharbor.ai/v1" \
AF_API_KEY="thk_..." \
AF_MODEL="claude-haiku-5.5:free" \
node demo/run-demo.js
```

Then open `packages/dashboard/index.html` to watch the swarm board replay the run from `packages/dashboard/state.json` — claims, proposals, conflict flags, review thread, merge log.

See [docs/try-it.md](docs/try-it.md) for the full walkthrough.

## What the demo shows

Three agents implement three features on a tiny Python CLI **concurrently**. Two of them collide on the same function — the overlap engine predicts the conflict *before* any merge is attempted, routes the loser to negotiation, a reviewer agent approves all three proposals, and the winner merges with its why-chain embedded. The whole run is real git: real branches, real merges, real commits.

## Packages

- `packages/core` — protocol primitives: task specs, claims, workspaces, overlap prediction, review protocol, merge arbitration, repo backends.
- `packages/core/src/backends` — pluggable storage: `git-backend` (working, local git) and `artifacts-backend` (implements the same interface against a Cloudflare Artifacts binding — `project.fork()`, `repo.readFile()`, repo-scoped tokens; code-complete, honestly marked not-live-tested since Artifacts requires a Workers Paid plan).
- `packages/agents` — agent runner against any OpenAI-compatible endpoint (degrades to a deterministic stub with no key set).
- `packages/dashboard` — live swarm board (dark ARC-style): claims, conflicts, proposals with diffs + WHY, review thread, merge log, negotiation queue. Polls `state.json`.

## Design notes

- **Overlap, not just conflicts.** `git merge` detects conflicts *after* the fact. ArcForge predicts them *before* anyone merges, when there's still time to negotiate. The engine compares base-side ranges (not tip-side), so adjacent-but-independent edits don't false-positive.
- **Why is a first-class artifact.** `WHY-<task>.md` files are named per-task so they never collide at merge time; the merge commit's why-chain block makes rationale queryable forever.
- **No fake data.** Every demo run is real git operations against a real repo. The stub agents exist so the pipeline is testable without keys; the live path uses real models.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 David Cain.
