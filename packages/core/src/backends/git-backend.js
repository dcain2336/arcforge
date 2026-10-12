/**
 * git-backend.js — RepoBackend implemented with real local git.
 *
 * This is the working backend: every method shells out to the git CLI via
 * node:child_process. Repositories live as bare or working-copy dirs on
 * the local filesystem; "fork" clones. Fully tested by demo/run-demo.js.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { RepoError, assertImplementsBackend } from "./repo-backend.js";

function sh(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const stderr = (err.stderr || "").toString();
    throw new RepoError("backend-error", `git ${args[0]} failed: ${stderr.split("\n")[0]}`, {
      args,
      stderr,
    });
  }
}

function ensureRepo(path) {
  try {
    sh(path, "rev-parse", "--git-dir");
  } catch {
    throw new RepoError("not-found", `not a git repository: ${path}`);
  }
}

const GIT_ENV = {
  "user.name": "arcforge",
  "user.email": "arcforge@local",
};

function gitConfigArgs() {
  return ["-c", `user.name=${GIT_ENV["user.name"]}`, "-c", `user.email=${GIT_ENV["user.email"]}`];
}

export class GitBackend {
  /**
   * @param {string} root — directory under which repos are created.
   */
  constructor(root) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  _path(repoId) {
    return join(this.root, repoId);
  }

  async createRepo(name) {
    const safe = String(name).replace(/[^a-zA-Z0-9-_]/g, "-");
    const repoId = `${safe}-${Date.now().toString(36)}`;
    const path = this._path(repoId);
    mkdirSync(path, { recursive: true });
    sh(path, "init", "-b", "main");
    // An initial empty commit so HEAD exists for worktrees/branches.
    sh(path, ...gitConfigArgs(), "commit", "--allow-empty", "-m", "forge: init");
    return { repoId };
  }

  async fork(repoId, name) {
    ensureRepo(this._path(repoId));
    const safe = String(name).replace(/[^a-zA-Z0-9-_]/g, "-");
    const forkId = `${safe}-fork-${Date.now().toString(36)}`;
    const dest = this._path(forkId);
    execFileSync("git", ["clone", this._path(repoId), dest], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { repoId: forkId };
  }

  async readFile(repoId, { ref, path }) {
    ensureRepo(this._path(repoId));
    try {
      return execFileSync(
        "git",
        ["-C", this._path(repoId), "show", `${ref}:${path}`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }
      );
    } catch (err) {
      throw new RepoError("not-found", `no such file ${path} at ${ref}`, {
        repoId,
        ref,
        path,
      });
    }
  }

  async commitAll(repoId, { ref, message, files }) {
    const path = this._path(repoId);
    ensureRepo(path);
    sh(path, "checkout", "-B", ref);
    for (const [filePath, content] of Object.entries(files || {})) {
      const abs = join(path, filePath);
      if (content === null) {
        try {
          rmSync(abs, { force: true });
        } catch {
          /* already gone */
        }
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    }
    sh(path, "add", "-A");
    const status = sh(path, "status", "--porcelain");
    if (!status) {
      // Nothing changed — return the current HEAD.
      return { commit: sh(path, "rev-parse", "HEAD") };
    }
    sh(path, ...gitConfigArgs(), "commit", "-m", message);
    return { commit: sh(path, "rev-parse", "HEAD") };
  }

  async push(/* repoId, { ref } */) {
    // Local git backend has no canonical remote — no-op by design.
    return;
  }

  async listCommits(repoId, { ref, limit = 50 }) {
    const path = this._path(repoId);
    ensureRepo(path);
    const out = sh(
      path,
      "log",
      `--max-count=${limit}`,
      "--format=%H%x1f%an%x1f%ad%x1f%s%x1e",
      "--date=iso",
      ref
    );
    return out
      .split("\x1e")
      .filter(Boolean)
      .map((rec) => {
        const [sha, author, date, subject] = rec.split("\x1f");
        return { sha, author, date, message: subject };
      });
  }

  async getDiff(repoId, { base, head }) {
    const path = this._path(repoId);
    ensureRepo(path);
    return sh(path, "diff", `${base}...${head}`);
  }

  async merge(repoId, { base, head, message }) {
    const path = this._path(repoId);
    ensureRepo(path);
    sh(path, "checkout", base);
    try {
      execFileSync(
        "git",
        ["-C", path, ...gitConfigArgs(), "merge", "--no-ff", "-m", message, head],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (err) {
      try {
        sh(path, "merge", "--abort");
      } catch {
        /* best effort */
      }
      throw new RepoError("conflict", `merge of ${head} into ${base} conflicted`, {
        base,
        head,
      });
    }
    return { commit: sh(path, "rev-parse", "HEAD") };
  }
}

assertImplementsBackend(GitBackend.prototype, "GitBackend");
