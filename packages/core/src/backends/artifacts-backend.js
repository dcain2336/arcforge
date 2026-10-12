/**
 * artifacts-backend.js — RepoBackend implemented against the Cloudflare
 * Artifacts binding (`env.ARTIFACTS`).
 *
 * Maps the RepoBackend interface onto Artifacts primitives, per
 * https://blog.cloudflare.com/next-git-platform-on-cloudflare/ :
 *
 *   const project   = await env.ARTIFACTS.get("my-project");
 *   const { defaultBranch } = await project.info();
 *   const workspace = await project.fork(`task-${crypto.randomUUID()}`);
 *                     // -> { name, remote, token }  (repo-scoped Git creds)
 *   const repo      = await env.ARTIFACTS.get(workspace.name);
 *   const file      = await repo.readFile({ ref: defaultBranch, path: "AGENTS.md" });
 *   const text      = file ? await file.text() : null;
 *
 * The fork's `remote` + `token` are repo-scoped Git credentials: an agent
 * clones `remote` with the token, works, and pushes — the same flow as
 * local git, but the object store is Cloudflare's. Push events
 * (`cf.artifacts.repo.pushed`) can then trigger review workflows.
 *
 * STATUS — HONEST: this backend is interface-complete and code-reviewed,
 * but NOT live-tested. Artifacts is in open beta for Workers Paid plans
 * and we run free-only, so no live binding was available during the
 * competition build. Every method documents the exact Artifacts call it
 * maps to; the first live run should be treated as an integration test.
 * To activate: construct with an `env` carrying the ARTIFACTS binding and
 * a project name, then use it anywhere a RepoBackend is accepted.
 *
 * NOTE on `commitAll`: Artifacts exposes file reads and Git remotes, not a
 * "write N files + commit" primitive. This backend therefore performs
 * commitAll by cloning the repo-scoped remote into a temp dir, applying
 * the file changes, committing, and pushing — real git over the Artifacts
 * remote. That keeps the interface contract ("commit on ref, return SHA")
 * without inventing API surface Cloudflare doesn't document.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { RepoError, assertImplementsBackend } from "./repo-backend.js";

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };
}

function sh(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (err) {
    throw new RepoError(
      "backend-error",
      `git ${args[0]} failed against Artifacts remote: ${String(err.stderr || err.message).split("\n")[0]}`
    );
  }
}

export class ArtifactsBackend {
  /**
   * @param {object} env — Worker env (or a shim) carrying `env.ARTIFACTS`.
   * @param {string} projectName — the Artifacts project (namespace repo)
   *   that acts as the canonical upstream for this backend instance.
   */
  constructor(env, projectName) {
    if (!env || !env.ARTIFACTS) {
      throw new RepoError(
        "auth",
        "ArtifactsBackend requires env.ARTIFACTS (the Artifacts binding)"
      );
    }
    if (!projectName) {
      throw new RepoError("backend-error", "ArtifactsBackend requires a projectName");
    }
    this.artifacts = env.ARTIFACTS;
    this.projectName = projectName;
    // repoId -> { name } for forks created through this instance.
    this.forks = new Map();
  }

  async _project() {
    // env.ARTIFACTS.get(name) -> project handle; project.info() -> { defaultBranch }
    return this.artifacts.get(this.projectName);
  }

  _repoName(repoId) {
    if (repoId === this.projectName) return this.projectName;
    const fork = this.forks.get(repoId);
    if (!fork) throw new RepoError("not-found", `unknown repoId: ${repoId}`);
    return fork.name;
  }

  async createRepo(name) {
    // Artifacts has no bare "create empty repo" in the documented binding
    // surface; the supported path is fork-from-project. We model createRepo
    // as fork(projectName, name) — the new repo starts as a copy of the
    // canonical project. Documented deviation from the interface.
    return this.fork(this.projectName, name);
  }

  async fork(repoId, name) {
    // project.fork(name) -> workspace { name, remote, token }
    const project = await this.artifacts.get(this._repoName(repoId));
    const workspace = await project.fork(name);
    const repoIdOut = `artifacts:${workspace.name}`;
    this.forks.set(repoIdOut, {
      name: workspace.name,
      remote: workspace.remote,
      token: workspace.token,
    });
    return { repoId: repoIdOut, url: workspace.remote };
  }

  _authedRemote(repoId) {
    const fork = this.forks.get(repoId);
    if (!fork || !fork.remote) {
      throw new RepoError("auth", `no repo-scoped credentials for ${repoId}`);
    }
    // Embed the repo-scoped token in the remote URL for git CLI auth.
    const url = new URL(fork.remote);
    url.username = "arcforge";
    url.password = fork.token;
    return url.toString();
  }

  async readFile(repoId, { ref, path }) {
    // repo.readFile({ ref, path }) -> File-ish with .text(), or null
    const repo = await this.artifacts.get(this._repoName(repoId));
    const file = await repo.readFile({ ref, path });
    if (!file) {
      throw new RepoError("not-found", `no such file ${path} at ${ref}`, {
        repoId,
        ref,
        path,
      });
    }
    return typeof file.text === "function" ? await file.text() : String(file);
  }

  async commitAll(repoId, { ref, message, files }) {
    // No bulk-write primitive: clone via the repo-scoped remote, apply
    // the change set, commit, push. Returns the new SHA.
    const remote = this._authedRemote(repoId);
    const dir = mkdtempSync(join(tmpdir(), "arcforge-artifacts-"));
    try {
      execFileSync("git", ["clone", "--branch", ref, remote, dir], {
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnv(),
      });
    } catch {
      // Branch may not exist yet — clone default and create it.
      execFileSync("git", ["clone", remote, dir], {
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnv(),
      });
      sh(dir, "checkout", "-B", ref);
    }
    sh(dir, "config", "user.name", "arcforge");
    sh(dir, "config", "user.email", "arcforge@local");
    for (const [filePath, content] of Object.entries(files || {})) {
      const abs = join(dir, filePath);
      if (content === null) {
        rmSync(abs, { force: true });
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
    }
    sh(dir, "add", "-A");
    if (!sh(dir, "status", "--porcelain")) {
      return { commit: sh(dir, "rev-parse", "HEAD") };
    }
    sh(dir, "commit", "-m", message);
    sh(dir, "push", "origin", ref);
    return { commit: sh(dir, "rev-parse", "HEAD") };
  }

  async push(repoId, { ref }) {
    // With repo-scoped tokens, push is just `git push` on a clone.
    // commitAll already pushes; a standalone push needs a local clone to
    // push from, so this is a documented no-op: callers push via commitAll.
    // We validate the repo exists so misconfigurations surface early.
    await this.artifacts.get(this._repoName(repoId));
  }

  async listCommits(repoId, { ref, limit = 50 }) {
    // Artifacts documents file/commit inspection via the binding; where a
    // commit list isn't exposed, fall back to a shallow clone + git log.
    const remote = this._authedRemote(repoId);
    const dir = mkdtempSync(join(tmpdir(), "arcforge-artifacts-log-"));
    try {
      execFileSync(
        "git",
        ["clone", "--depth", String(limit), "--branch", ref, remote, dir],
        { stdio: ["ignore", "pipe", "pipe"], env: gitEnv() }
      );
      const out = sh(
        dir,
        "log",
        `--max-count=${limit}`,
        "--format=%H%x1f%an%x1f%ad%x1f%s%x1e",
        "--date=iso"
      );
      return out
        .split("\x1e")
        .filter(Boolean)
        .map((rec) => {
          const [sha, author, date, subject] = rec.split("\x1f");
          return { sha, author, date, message: subject };
        });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async getDiff(repoId, { base, head }) {
    const remote = this._authedRemote(repoId);
    const dir = mkdtempSync(join(tmpdir(), "arcforge-artifacts-diff-"));
    try {
      execFileSync("git", ["clone", remote, dir], {
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnv(),
      });
      sh(dir, "fetch", "origin", base, head);
      return sh(dir, "diff", `${base}...${head}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async merge(repoId, { base, head, message }) {
    const remote = this._authedRemote(repoId);
    const dir = mkdtempSync(join(tmpdir(), "arcforge-artifacts-merge-"));
    try {
      execFileSync("git", ["clone", remote, dir], {
        stdio: ["ignore", "pipe", "pipe"],
        env: gitEnv(),
      });
      sh(dir, "config", "user.name", "arcforge-arbiter");
      sh(dir, "config", "user.email", "arcforge@local");
      sh(dir, "checkout", base);
      try {
        sh(dir, "merge", "--no-ff", "-m", message, head);
      } catch {
        throw new RepoError("conflict", `merge of ${head} into ${base} conflicted`, {
          base,
          head,
        });
      }
      sh(dir, "push", "origin", base);
      return { commit: sh(dir, "rev-parse", "HEAD") };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

assertImplementsBackend(ArtifactsBackend.prototype, "ArtifactsBackend");
