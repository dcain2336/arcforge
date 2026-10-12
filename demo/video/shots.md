# ArcForge demo video — shot list

Final file: `arcforge-demo.mp4` — 1280×720, h264 + AAC, **384.72s (6:24.7)**
(within the 5:00–10:00 competition window), 8.6 MB.
Voice: `avocado_v2:chip` (male), 8 separately-synthesized segments, no audio speed-ups.
Slides rendered with PIL (DejaVu Sans/Mono, dark theme); terminal shot is the
real `live-run.log` rendered as scrolling frames @8fps, pauses compressed.

| # | Shot | Time | Dur | Visual | Voiceover segment |
|---|------|------|-----|--------|-------------------|
| 1 | Title | 0.00–11.93 | 11.93s | Title slide: "ArcForge" + "A git-native coordination layer for AI agent swarms" + "Team ArcOmega · Cloudflare · build the next Git platform for AI agents" | SEG1 — title |
| 2 | Problem | 11.93–61.66 | 49.73s | Problem slide: agent-1/2/3 cards (JSON flag / search cmd / due option) → one shared `notes.py` (red collision box) + 4 bullets (silent collisions, no queue/lock/plan, git log says what never why, human review doesn't scale) | SEG2 — the problem |
| 3a | Protocol 1–4 | 61.66–103.16 | 41.50s | Protocol steps 1–4: tasks as branches, visible claims, isolated forks, WHY.md proposals | SEG3a — protocol (split at the step-4/5 silence, 41.5s) |
| 3b | Protocol 5–7 | 103.16–136.71 | 33.55s | Protocol steps 5–7: overlap prediction BEFORE merge, agent-to-agent review, why-chain merges | SEG3b — protocol |
| 4 | Live demo (terminal) | 136.71–266.19 | 129.48s | Real `live-run.log` (30 lines) scrolling @8fps, color-coded by phase (claims green, work blue, overlap yellow/red, review green, merge green, NEGOTIATION red bold). ●REC badge + "pauses compressed" label. Shows: claims → forks/commits → HIGH overlap flag → approvals → 2 merges + negotiation routing. | SEG4 — live demo |
| 5 | Swarm board | 266.19–290.91 | 24.72s | Dashboard board rendered from the real `state-final.json`: Claims / Conflicts [HIGH] / Review thread / Proposals / Merge log / Negotiation queue panels. Labeled "rendered from the real final state file". | SEG5 — board |
| 6 | Why-chain | 290.91–334.35 | 43.44s | Real merge commit `9b303379` (agent-2:notes-search): `$ git log --format=%B` showing the FORGE-WHY-CHAIN JSON block (taskId, agentIds, proposalIds, rationale, mergedAt). | SEG6 — why-chain |
| 7 | Cloudflare story | 334.35–371.02 | 36.67s | Two-panel slide: "Local git backend ● LIVE TODAY" vs "Artifacts backend ◌ CODE-COMPLETE" (project.fork · repo.readFile · scoped tokens). Honest note: Artifacts backend implemented but not live-tested (no paid plan); dashboard deploys to Workers. | SEG7 — Cloudflare |
| 8 | Close | 371.02–384.72 | 13.80s | "git says what. ArcForge says why." + github.com/dcain2336/arcforge + MIT licensed + Team ArcOmega | SEG8 — close |

## Honesty notes
- Terminal shot: every line is the real output of the real 3-agent demo run
  (`demo/video/live-run.log`); only pauses were compressed, labeled on screen.
- Board shot: not a browser screenshot — rendered from the real final state
  JSON, labeled as such on screen.
- Why-chain shot: real merge commit data from `state-final.json` mergeLog.
- Cloudflare slide: one honest line — Artifacts backend is code-complete, not
  live-tested (no paid plan). No disclaimer wall.
- Overlap predictor tests (11/11 pass) stated in narration; output verified by
  running `node --test packages/core/test/overlap.test.js`.
- No secrets anywhere: no API keys on screen or in audio.

## Build notes
- `build_slides.py` renders the 8 PNG slides; `build_terminal.py` renders the
  1035 scrolling terminal frames; `segs/` holds per-shot MP4s; final concat via
  ffmpeg concat demuxer (`-c copy`).
- SEG3 audio split at 41.5s (silence between step 4 and step 5 narration).
- One render fix pass: protocol title un-clipped, "steps 5–7 of 7" footer
  corrected, why-chain commit/chain data made consistent (agent-2).
