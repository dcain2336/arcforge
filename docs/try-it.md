# Try ArcForge

## The 60-second demo

```bash
git clone https://github.com/dcain2336/arcforge.git
cd arcforge
node demo/run-demo.js
```

No API keys needed — the demo runs with deterministic stub agents and completes in seconds. You'll see three agents claim tasks, fork workspaces, commit, propose changes, get overlap-predicted, reviewed, and merged — all real git.

Then replay it visually:

```bash
npx serve packages/dashboard   # or: python3 -m http.server --directory packages/dashboard
```

Open the served `index.html` — the swarm board reads `packages/dashboard/state.json`, rewritten at every phase of the run.

## The live demo (real agents, $0)

Any OpenAI-compatible endpoint works. Free example with TokenHarbor:

```bash
AF_BASE_URL="https://tokenharbor.ai/v1" \
AF_API_KEY="thk_..." \
AF_MODEL="claude-haiku-5.5:free" \
node demo/run-demo.js
```

Three live agents implement three features on the demo repo (`demo/repo/notes.py`, a tiny Python CLI) **concurrently**. Watch for:

1. **Claims** — each agent's claim lands as a signed commit on the `forge-claims` branch.
2. **The collision** — two agents edit the same function. The overlap engine flags it HIGH *before* any merge.
3. **Negotiation** — the conflicting proposal is routed aside, not force-merged.
4. **Review** — a reviewer agent approves each proposal (stub by default; plug any OpenAI-compatible model into `makeLlmReviewer`).
5. **The why-chain** — `git log` on the merged repo shows `FORGE-WHY-CHAIN` JSON in every merge commit: task, agents, rationale, timestamp.

Verify the merged code actually works:

```bash
cd /tmp/arcforge-demo-*
python3 notes.py add "hello" && python3 notes.py list --json
```

## Inspect the protocol

```bash
# Overlap engine unit tests (11/11)
node --test packages/core/test/overlap.test.js

# Why-chain of the last merges
git -C /tmp/arcforge-demo-* log --format=%B -n 3 | grep -A8 FORGE-WHY-CHAIN
```

## Cloudflare Artifacts backend

`packages/core/src/backends/artifacts-backend.js` implements the full `RepoBackend` interface against a Cloudflare Artifacts binding (`env.ARTIFACTS`): `project.fork()`, `repo.readFile({ref, path})`, repo-scoped `remote`/`token` issuance. It's code-complete and documented, but **not live-tested** — Artifacts requires a Workers Paid plan and this project is free-tier only. Swap `git-backend` for `artifacts-backend` where the binding exists and the whole protocol runs on it unchanged.

## Requirements

- Node.js 18+
- git
- (Optional) any OpenAI-compatible API key for live agents
