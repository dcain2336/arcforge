# ArcForge demo video — narration script

Voice: `avocado_v2:chip` (male). 8 segments, synthesized separately, no speed-ups.
Spoken form: numbers/URLs spelled out, no markdown. Segment durations are
measured after synthesis; slide timings follow the audio.

---

## SEG1 — Title (~15s)

ArcForge. A git-native coordination layer for A I agent swarms. Built by Team
ArcOmega for the Cloudflare competition to build the next Git platform for
A I agents.

---

## SEG2 — The problem (~45s)

Picture three A I agents working in the same repository. Agent one adds a JSON
flag to the list command. Agent two adds a search subcommand. Agent three adds
a due date option. They all edit the same file, the same function — and none
of them knows the others exist. Their changes collide silently. Nobody knows
who is doing what, and there is no queue, no lock, no plan — just three
writers and one file. And git log tells you what changed, but never why. A
human reviewer can untangle two pull requests. But human review does not scale
to swarms of dozens of agents committing in parallel, around the clock. The
coordination layer is missing. ArcForge is that layer.

---

## SEG3 — The protocol (~75s)

ArcForge turns swarm coordination into a seven step protocol, all inside git.
Step one: tasks become branches. Every unit of work is a named branch, so work
is addressable. Step two: agents stake visible claims on tasks before touching
code, so the whole swarm sees who is doing what. Step three: each agent works
in an isolated fork, a full workspace, so experiments never trample each other.
Step four: every proposal ships with a WHY dot md file — the agent's
reasoning, in its own words, reviewed like code, so intent is never lost.
Step five: before anything merges, ArcForge predicts overlap between proposals
— file level, hunk level, symbol level — and flags conflicts before the merge,
not after. No more surprise merge conflicts at midnight. Step six:
agents review each other's proposals, agent to agent, with approvals recorded.
Step seven: merges carry a why-chain — a machine readable block of reasoning
embedded in the commit message — so git log becomes an audit trail of why
every change exists, forever.

---

## SEG4 — Live demo, terminal (~150s)

This is a real run. Three agents, one repository, no staging. Watch the claims
land first: agent one takes the JSON flag task, agent two takes search, agent
three takes the due date. All three claims are visible to the whole swarm
before a single line of code is written — that visibility is the whole point.
Now the agents fork their workspaces and implement in parallel. Each agent gets
its own full workspace — forge slash agent one, forge slash agent two, forge
slash agent three — so nothing they do can trample the others. Three commits
land, one per agent — nobody waited for anyone else, and nobody stepped on
anyone's files. Now the critical step: overlap prediction, before any merge.
ArcForge compares every pair of proposals statically. Agent one versus agent
two: medium — same file, same symbol, but disjoint hunks. Agent one versus
agent three: HIGH — their hunks touch the same lines of the argument parser
setup in main. That is a real collision, caught while it is still cheap. Agent
two versus agent three: medium. The predictor caught it before the merge, not
after. Next, agent to agent review: all three proposals are approved by their
peers, and every approval is recorded. Then the arbiter merges in claim order.
Agent one's JSON flag merges cleanly. Agent two's search merges cleanly. But
agent three's due date change — the one flagged HIGH — is not merged blind.
It is routed to the negotiation queue, with the reason attached: predicted
high severity overlap with an already merged proposal. A human, or a
negotiator agent, can now resolve it with full context. A silent collision
became a visible decision. Pauses in this recording are compressed; every line
on screen is the real output of the real run.

---

## SEG5 — Dashboard board (~30s)

The swarm board shows the same run as a live dashboard. Three claims, three
proposals with their diffs, the conflict panel with one HIGH and two medium
overlaps, three peer approvals, two merges in the why-chain log — and agent
three's due date proposal sitting in the negotiation queue, exactly where the
predictor put it. This board is rendered from the real final state file of the
run.

---

## SEG6 — The why-chain (~45s)

And here is the payoff. Every merge commit carries a why-chain: a machine
readable JSON block embedded in the commit message, with the task, the agent,
the proposal, and the full rationale in the agent's own words. Months later,
git log doesn't just tell you what changed — it tells you why, who decided
it, and what they were thinking. When the next agent picks up the code, it can
read the reasoning of every agent before it. The overlap predictor's unit tests
pass eleven out of eleven, so its severity calls are pinned by tests, not
vibes. An audit trail of agent reasoning, stored where code already lives: in
git.

---

## SEG7 — Cloudflare story (~40s)

Where does Cloudflare fit? ArcForge's storage is a pluggable repo backend.
Today it runs on local git — zero infrastructure. The Cloudflare Artifacts
backend is code complete: project fork, file reads, and scoped tokens are
implemented, and it activates the moment the binding exists. The dashboard is
a static app that deploys straight to Workers. One honest note: the Artifacts
backend has not been live tested yet — there is no paid plan on this build —
but the interface is real, and the local backend proves the protocol end to
end.

---

## SEG8 — Close (~20s)

ArcForge: git says what. ArcForge says why. The code is M I T licensed at
github dot com slash d cain twenty three thirty six slash arcforge. Team
ArcOmega.
