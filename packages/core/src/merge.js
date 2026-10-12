/**
 * merge.js — the arbiter.
 *
 * ArcForge merges are never silent. The arbiter takes approved proposals,
 * consults the overlap report, merges the non-conflicting ones with real
 * `git merge`, and marks conflicting ones for negotiation instead of
 * forcing them through.
 *
 * Every merge commit embeds the full why-chain: task id, agent ids,
 * proposal ids, and a rationale summary — machine-readable, so any agent
 * (or human) can later answer "why does this code exist?" with
 * `git log` alone.
 *
 * Why-chain block format (appended to the commit message):
 *
 *   --- FORGE-WHY-CHAIN ---
 *   {"taskId":"...","agentIds":[...],"proposalIds":[...],
 *    "rationale":"...","mergedAt":"..."}
 *   --- END FORGE-WHY-CHAIN ---
 */

import { execFileSync } from "node:child_process";

const CHAIN_BEGIN = "--- FORGE-WHY-CHAIN ---";
const CHAIN_END = "--- END FORGE-WHY-CHAIN ---";

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Serialize a why-chain to the canonical block string.
 */
export function formatWhyChain({ taskId, agentIds, proposalIds, rationale }) {
  const payload = {
    taskId,
    agentIds: [...new Set(agentIds)],
    proposalIds: [...new Set(proposalIds)],
    rationale: rationale || "",
    mergedAt: new Date().toISOString(),
  };
  return `${CHAIN_BEGIN}\n${JSON.stringify(payload)}\n${CHAIN_END}`;
}

/**
 * Parse a why-chain back out of a commit message. Returns the payload
 * object, or null when the message carries no chain.
 */
export function parseWhyChain(commitMessage) {
  const re = new RegExp(
    `${escapeRe(CHAIN_BEGIN)}\\s*([\\s\\S]*?)\\s*${escapeRe(CHAIN_END)}`
  );
  const m = (commitMessage || "").match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the full commit message for a proposal merge.
 */
export function formatMergeMessage(proposal) {
  const headline = `forge: merge proposal ${proposal.id}`;
  const chain = formatWhyChain({
    taskId: proposal.taskId,
    agentIds: [proposal.agentId],
    proposalIds: [proposal.id],
    rationale: proposal.rationale || "",
  });
  return `${headline}\n\nTask: ${proposal.taskId}\nAgent: ${proposal.agentId}\n\n${chain}\n`;
}

/**
 * Does this proposal have a HIGH-severity overlap conflict with any of the
 * already-merged proposal ids? (Consulted from a computeOverlap() report.)
 */
export function isBlockedByOverlap(proposalId, mergedIds, overlapReport) {
  if (!overlapReport || !Array.isArray(overlapReport.conflicts)) return false;
  return overlapReport.conflicts.some(
    (c) =>
      c.severity === "high" &&
      c.between.includes(proposalId) &&
      c.between.some((id) => mergedIds.includes(id))
  );
}

/**
 * Arbitrate and merge a list of approved proposals into targetBranch.
 *
 * @param {string} repoPath
 * @param {Array<{id, branch, taskId, agentId, rationale}>} proposals
 * @param {{targetBranch?: string, overlapReport?: object}} opts
 * @returns {{
 *   merged: Array<{proposalId, commit}>,
 *   needsNegotiation: Array<{proposalId, reason}>
 * }}
 */
export function mergeProposals(repoPath, proposals, opts = {}) {
  const targetBranch = opts.targetBranch || "main";
  const overlapReport = opts.overlapReport || null;

  const merged = [];
  const needsNegotiation = [];
  const mergedIds = [];

  git(repoPath, "checkout", targetBranch);

  for (const proposal of proposals) {
    // 1. Predicted conflict? Don't even try — send to negotiation.
    if (isBlockedByOverlap(proposal.id, mergedIds, overlapReport)) {
      needsNegotiation.push({
        proposalId: proposal.id,
        reason:
          "predicted high-severity overlap with an already-merged proposal",
      });
      continue;
    }

    // 2. Attempt the real merge.
    try {
      git(
        repoPath,
        "-c",
        "user.name=arcforge-arbiter",
        "-c",
        "user.email=arcforge@local",
        "merge",
        "--no-ff",
        "-m",
        formatMergeMessage(proposal),
        proposal.branch
      );
      const commit = git(repoPath, "rev-parse", "HEAD");
      merged.push({ proposalId: proposal.id, commit });
      mergedIds.push(proposal.id);
    } catch (err) {
      // 3. Merge failed (real conflict): abort cleanly, flag for negotiation.
      try {
        git(repoPath, "merge", "--abort");
      } catch {
        /* already clean or nothing to abort */
      }
      const detail = (err.stderr || err.message || "").split("\n")[0];
      needsNegotiation.push({
        proposalId: proposal.id,
        reason: `git merge failed: ${detail}`,
      });
    }
  }

  return { merged, needsNegotiation };
}

/**
 * Read the why-chain of every forge merge commit on a branch, newest first.
 * Useful for the dashboard's merge log and for audits.
 */
export function readMergeLog(repoPath, branch = "main", limit = 50) {
  const log = git(
    repoPath,
    "log",
    `--max-count=${limit}`,
    "--format=%H%x1f%s%x1f%b%x1e",
    branch
  );
  const entries = [];
  for (const record of log.split("\x1e")) {
    const [hash, subject, body] = record.split("\x1f");
    if (!hash) continue;
    const chain = parseWhyChain(`${subject}\n${body || ""}`);
    if (chain) entries.push({ hash: hash.trim(), subject: (subject || "").trim(), chain });
  }
  return entries;
}
