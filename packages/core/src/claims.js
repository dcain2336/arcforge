/**
 * claims.js — claim registry for task allocation.
 *
 * Claims are themselves git-native: agents claim subtasks by committing a
 * JSON record to a `forge-claims` branch (an orphan branch that holds only
 * claims.json). That makes allocation auditable — who took what, when —
 * and mergeable, so two agents racing to claim the same task produce a
 * visible conflict instead of silent double-work.
 *
 * Claims file schema (claims.json):
 *   { "claims": [ { "taskId": "...", "agentId": "...", "claimedAt": "ISO" } ] }
 *
 * API:
 *   claim(repoPath, taskId, agentId) -> claim record (throws if taken)
 *   listClaims(repoPath)             -> array of claim records
 *   release(repoPath, taskId, agentId) -> true (throws if not held)
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const CLAIMS_BRANCH = "forge-claims";
export const CLAIMS_FILE = "claims.json";

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchExists(repoPath, branch) {
  try {
    git(repoPath, "rev-parse", "--verify", `refs/heads/${branch}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the forge-claims branch exists and check it out in a detached,
 * non-destructive way: we stash nothing and always return to the original
 * branch. Implemented via `git worktree`-free approach — we operate on a
 * temporary worktree so the caller's checkout is never disturbed.
 */
function withClaimsWorktree(repoPath, fn) {
  const worktree = `${repoPath}/.forge-claims-worktree`;
  // Clean up any stale worktree from a previous crashed run.
  try {
    git(repoPath, "worktree", "remove", "--force", worktree);
  } catch {
    /* no stale worktree */
  }
  if (!branchExists(repoPath, CLAIMS_BRANCH)) {
    git(repoPath, "worktree", "add", "--orphan", "-b", CLAIMS_BRANCH, worktree);
  } else {
    git(repoPath, "worktree", "add", worktree, CLAIMS_BRANCH);
  }
  try {
    return fn(worktree);
  } finally {
    try {
      git(repoPath, "worktree", "remove", "--force", worktree);
    } catch {
      /* best effort */
    }
  }
}

function readClaimsFile(worktree) {
  try {
    const text = git(worktree, "show", `HEAD:${CLAIMS_FILE}`);
    const data = JSON.parse(text);
    return Array.isArray(data.claims) ? data.claims : [];
  } catch {
    return [];
  }
}

function writeClaimsFile(worktree, claims, message) {
  writeFileSync(
    `${worktree}/${CLAIMS_FILE}`,
    JSON.stringify({ claims }, null, 2) + "\n"
  );
  git(worktree, "add", CLAIMS_FILE);
  // Allow empty commits to be skipped: only commit when something changed.
  const status = git(worktree, "status", "--porcelain");
  if (status) {
    git(
      worktree,
      "-c",
      "user.name=arcforge",
      "-c",
      "user.email=arcforge@local",
      "commit",
      "-m",
      message
    );
  }
}

/**
 * Claim a task for an agent. Throws if the task is already claimed by a
 * *different* agent (idempotent for the same agent — claiming twice is a
 * no-op that returns the existing record).
 */
export function claim(repoPath, taskId, agentId) {
  return withClaimsWorktree(repoPath, (worktree) => {
    const claims = readClaimsFile(worktree);
    const existing = claims.find((c) => c.taskId === taskId);
    if (existing) {
      if (existing.agentId === agentId) return existing;
      throw new Error(
        `Task "${taskId}" is already claimed by agent "${existing.agentId}"`
      );
    }
    const record = {
      taskId,
      agentId,
      claimedAt: new Date().toISOString(),
    };
    claims.push(record);
    writeClaimsFile(
      worktree,
      claims,
      `forge: agent ${agentId} claims task ${taskId}`
    );
    return record;
  });
}

/** List all current claims. */
export function listClaims(repoPath) {
  if (!branchExists(repoPath, CLAIMS_BRANCH)) return [];
  return withClaimsWorktree(repoPath, (worktree) => readClaimsFile(worktree));
}

/**
 * Release a claim. Only the holding agent (or anyone, if the holder is
 * gone — we keep it simple: the holder must match) can release.
 */
export function release(repoPath, taskId, agentId) {
  return withClaimsWorktree(repoPath, (worktree) => {
    const claims = readClaimsFile(worktree);
    const idx = claims.findIndex((c) => c.taskId === taskId);
    if (idx === -1) {
      throw new Error(`Task "${taskId}" is not claimed`);
    }
    if (claims[idx].agentId !== agentId) {
      throw new Error(
        `Task "${taskId}" is claimed by "${claims[idx].agentId}", not "${agentId}"`
      );
    }
    claims.splice(idx, 1);
    writeClaimsFile(
      worktree,
      claims,
      `forge: agent ${agentId} releases task ${taskId}`
    );
    return true;
  });
}
