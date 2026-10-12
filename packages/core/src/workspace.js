/**
 * workspace.js — isolated workspaces for agents, built on real git.
 *
 * Each agent gets its own `git worktree`: a separate working directory
 * backed by the same object store, checked out on a dedicated branch
 * `forge/<agentId>/<taskId>`. Agents never see each other's uncommitted
 * work; everything they produce is a commit on their own branch, ready
 * for the overlap engine and the arbiter.
 *
 * API:
 *   forkWorkspace(repoPath, agentId, taskId, { base }) -> { path, branch }
 *   pushBranch(workspacePath, branch)                  -> void (no-op if no remote)
 *   cleanupWorkspace(repoPath, workspacePath)          -> void
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function git(repoPath, ...args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function workspaceBranch(agentId, taskId) {
  const safe = (s) => s.replace(/[^a-zA-Z0-9-_]/g, "-");
  return `forge/${safe(agentId)}/${safe(taskId)}`;
}

/**
 * Create an isolated workspace for an agent working on a task.
 * Returns { path, branch }. The workspace is a fresh worktree branched
 * from `base` (default: HEAD of repoPath).
 */
export function forkWorkspace(repoPath, agentId, taskId, opts = {}) {
  const base = opts.base || "HEAD";
  const branch = workspaceBranch(agentId, taskId);
  const path = mkdtempSync(join(tmpdir(), `arcforge-${agentId}-`));

  // Remove the (empty) temp dir; git worktree wants to create it.
  rmSync(path, { recursive: true, force: true });

  // If the branch already exists (re-run), check it out instead of
  // creating it — idempotent.
  let branchExists = true;
  try {
    git(repoPath, "rev-parse", "--verify", `refs/heads/${branch}`);
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    git(repoPath, "worktree", "add", path, branch);
  } else {
    git(repoPath, "worktree", "add", "-b", branch, path, base);
  }

  // Stamp the workspace so agents (and humans) know what this is.
  git(path, "config", "user.name", `arcforge-agent-${agentId}`);
  git(path, "config", "user.email", `${agentId}@arcforge.local`);

  return { path, branch };
}

/**
 * Push the agent's branch to the repo's origin remote, if one exists.
 * No-op when there is no remote (local-only demo runs).
 */
export function pushBranch(workspacePath, branch) {
  let remote = "";
  try {
    remote = git(workspacePath, "remote", "get-url", "origin");
  } catch {
    remote = "";
  }
  if (!remote) return { pushed: false, reason: "no origin remote" };
  git(workspacePath, "push", "-u", "origin", branch);
  return { pushed: true, branch };
}

/**
 * Remove a workspace worktree and prune git's worktree metadata.
 */
export function cleanupWorkspace(repoPath, workspacePath) {
  try {
    git(repoPath, "worktree", "remove", "--force", workspacePath);
  } catch {
    // Fall back to a plain recursive delete if git disagrees.
    try {
      rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    try {
      git(repoPath, "worktree", "prune");
    } catch {
      /* best effort */
    }
  }
}
