# Try it

_(Full try-it guide coming — this is the competition build scaffold.)_

## The 60-second demo

```bash
cd arcforge
node demo/run-demo.js
```

Three agents claim three subtasks, fork isolated workspaces, commit their
changes with WHY.md rationale files, and propose merges. The overlap engine
predicts conflicts before anything merges. A reviewer approves. The arbiter
merges non-conflicting proposals and embeds the why-chain in every merge
commit.

Then open the swarm board:

```bash
# serve the dashboard (any static server works)
npx serve packages/dashboard
# or just open packages/dashboard/index.html in a browser
```

The board reads `packages/dashboard/state.json`, which the demo runner
rewrites at every step.

## Bring your own model

Set these and the agent runner uses a real LLM instead of the deterministic
stub:

```bash
export AF_BASE_URL="https://api.example.com/v1"
export AF_API_KEY="your-key"
export AF_MODEL="your-model-id"
node demo/run-demo.js
```
