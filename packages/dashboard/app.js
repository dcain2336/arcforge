/**
 * app.js — ArcForge swarm board.
 *
 * Polls state.json (rewritten by demo/run-demo.js after every phase) and
 * renders the Claims / Conflicts / Proposals / Review / Merge log /
 * Negotiation panels. No backend — the file IS the backend for v1.
 */

const STATE_URL = "state.json";
const POLL_MS = 3000;

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sevBadge(sev) {
  const label = { high: "HIGH", medium: "MED", low: "LOW", none: "NONE" }[sev] || sev;
  return `<span class="badge ${esc(sev)}">${esc(label)}</span>`;
}

function highlightDiff(diff) {
  return esc(diff)
    .split("\n")
    .map((line) => {
      let cls = "";
      if (line.startsWith("+") && !line.startsWith("+++")) cls = "add";
      else if (line.startsWith("-") && !line.startsWith("---")) cls = "del";
      else if (line.startsWith("@@")) cls = "hunk";
      return cls ? `<span class="${cls}">${line || " "}</span>` : (line || " ");
    })
    .join("\n");
}

function renderClaims(state) {
  const el = $("claims");
  if (!state.claims || state.claims.length === 0) {
    el.innerHTML = `<p class="empty">waiting for run…</p>`;
    return;
  }
  el.innerHTML = state.claims
    .map(
      (c) => `<div class="card"><div class="row"><b>${esc(c.agentId)}</b>` +
        `<span class="dim mono">${esc(c.taskId)}</span></div>` +
        `<div class="dim small">claimed ${esc(c.claimedAt || "")}</div></div>`
    )
    .join("");
}

function renderConflicts(state) {
  const el = $("conflicts");
  $("sev-badge").innerHTML = state.overlapSeverity
    ? sevBadge(state.overlapSeverity)
    : "";
  if (!state.conflicts || state.conflicts.length === 0) {
    el.innerHTML = `<p class="empty">${
      state.overlapSeverity && state.overlapSeverity !== "none"
        ? "analysis complete — no pairwise conflicts"
        : "no overlap analysis yet"
    }</p>`;
    return;
  }
  el.innerHTML = state.conflicts
    .map((c) => {
      const hunks = (c.hunks || [])
        .map(
          (h) =>
            `<div class="mono small dim">${esc(h.file)}: ` +
            `A[${h.aHunk.oldStart}+${h.aHunk.oldLines}] × ` +
            `B[${h.bHunk.oldStart}+${h.bHunk.oldLines}]</div>`
        )
        .join("");
      return `<div class="card"><div class="row"><b class="mono">${esc(c.between[0])}</b>` +
        `<span class="dim">×</span><b class="mono">${esc(c.between[1])}</b>` +
        `${sevBadge(c.severity)}</div>` +
        `<div class="dim small">files: ${esc((c.files || []).join(", "))}</div>` +
        (c.symbols && c.symbols.length
          ? `<div class="dim small">symbols: ${esc(c.symbols.join(", "))}</div>`
          : "") +
        hunks +
        `</div>`;
    })
    .join("");
}

function renderProposals(state) {
  const el = $("proposals");
  if (!state.proposals || state.proposals.length === 0) {
    el.innerHTML = `<p class="empty">no proposals yet</p>`;
    return;
  }
  el.innerHTML = state.proposals
    .map((p) => {
      const rev = p.review
        ? p.review.approve
          ? `<span class="badge ok">approved</span>`
          : `<span class="badge high">changes requested</span>`
        : `<span class="badge none">pending review</span>`;
      return `<div class="card"><div class="row"><b class="mono">${esc(p.id)}</b>${rev}</div>` +
        `<div class="dim small">branch <span class="mono">${esc(p.branch || "")}</span>` +
        (p.commit ? ` · <span class="mono">${esc(p.commit.slice(0, 8))}</span>` : "") +
        `</div>` +
        `<pre class="diff">${highlightDiff(p.diff || "")}</pre>` +
        `<details class="why"><summary>WHY.md</summary>` +
        `<div class="why-body">${esc(p.whyText || "")}</div></details>` +
        `</div>`;
    })
    .join("");
}

function renderReview(state) {
  const el = $("review");
  const items = (state.proposals || []).filter((p) => p.review);
  if (items.length === 0) {
    el.innerHTML = `<p class="empty">no reviews yet</p>`;
    return;
  }
  el.innerHTML = items
    .map((p) => {
      const comments = (p.review.comments || [])
        .map((c) => `<div class="dim small">• ${esc(c)}</div>`)
        .join("");
      return `<div class="card"><div class="row"><b class="mono">${esc(p.id)}</b>` +
        (p.review.approve
          ? `<span class="badge ok">approve</span>`
          : `<span class="badge high">request changes</span>`) +
        `</div>${comments || `<div class="dim small">no comments</div>`}</div>`;
    })
    .join("");
}

function renderMerges(state) {
  const el = $("merges");
  const log = state.mergeLog || [];
  if (log.length === 0) {
    el.innerHTML = `<p class="empty">nothing merged yet</p>`;
    return;
  }
  el.innerHTML = log
    .map((e) => {
      const ch = e.chain || {};
      return `<div class="card"><div class="row"><b class="mono">${esc((e.hash || "").slice(0, 8))}</b>` +
        `<span class="dim small">${esc(e.subject || "")}</span></div>` +
        `<div class="chain">task: ${esc(ch.taskId || "—")}<br>` +
        `agents: ${esc((ch.agentIds || []).join(", ") || "—")}<br>` +
        `proposals: ${esc((ch.proposalIds || []).join(", ") || "—")}<br>` +
        `rationale: ${esc((ch.rationale || "").slice(0, 120))}</div></div>`;
    })
    .join("");
}

function renderNegotiation(state) {
  const el = $("negotiation");
  const q = state.needsNegotiation || [];
  if (q.length === 0) {
    el.innerHTML = `<p class="empty">queue empty — no conflicts</p>`;
    return;
  }
  el.innerHTML = q
    .map(
      (n) => `<div class="card"><div class="row"><b class="mono">${esc(n.proposalId)}</b>` +
        `<span class="badge high">negotiate</span></div>` +
        `<div class="dim small">${esc(n.reason || "")}</div></div>`
    )
    .join("");
}

function render(state) {
  renderClaims(state);
  renderConflicts(state);
  renderProposals(state);
  renderReview(state);
  renderMerges(state);
  renderNegotiation(state);
  if (state.updatedAt) {
    $("updated").textContent =
      "updated " + new Date(state.updatedAt).toLocaleTimeString();
  }
}

async function poll() {
  try {
    const res = await fetch(STATE_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();
    $("live-dot").className = "dot dot-ok";
    render(state);
  } catch (err) {
    $("live-dot").className = "dot dot-bad";
    // Keep last rendered state; the dot tells the story.
  }
}

poll();
setInterval(poll, POLL_MS);
