/**
 * repo-backend.js — the RepoBackend interface.
 *
 * A RepoBackend is ArcForge's portability seam: everything above this layer
 * (claims, workspaces, overlap, review, merge) speaks to repos through this
 * interface, never to git or to Cloudflare directly. Two implementations
 * ship with ArcForge:
 *
 *   - git-backend.js         — real local git (fully working, tested)
 *   - artifacts-backend.js   — Cloudflare Artifacts binding (interface-
 *                              complete; NOT live-tested — we have no paid
 *                              plan, and Artifacts requires one)
 *
 * All methods are async and return promises. Paths are repo-relative
 * POSIX paths ("notes.py", "src/main.js"). Refs are branch names, tags,
 * or commit SHAs.
 *
 * Method contracts:
 *
 *   createRepo(name) -> { repoId, url? }
 *     Create a new empty repository.
 *
 *   fork(repoId, name) -> { repoId, url? }
 *     Fork an existing repository into an isolated copy for one agent.
 *
 *   readFile(repoId, { ref, path }) -> string
 *     Read a file's contents at a ref. Throws RepoError("not-found") when
 *     the path doesn't exist at that ref.
 *
 *   commitAll(repoId, { ref, message, files: { [path]: content|null } }) -> { commit }
 *     Write files (null deletes), stage everything, commit on ref.
 *     Returns the new commit SHA.
 *
 *   push(repoId, { ref }) -> void
 *     Push ref to the canonical remote, if the backend has one.
 *     No-op for backends without remotes.
 *
 *   listCommits(repoId, { ref, limit? }) -> [{ sha, message, author, date }]
 *     Newest first.
 *
 *   getDiff(repoId, { base, head }) -> string
 *     Unified diff between two refs.
 *
 *   merge(repoId, { base, head, message }) -> { commit } | throws RepoError("conflict")
 *     Merge head into base with the given commit message. On conflict the
 *     backend must leave the repo clean and throw RepoError with
 *     code === "conflict".
 *
 * Errors: backends throw RepoError (below) with a machine-readable `code`:
 *   "not-found" | "conflict" | "auth" | "not-implemented" | "backend-error"
 */

export class RepoError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RepoError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Assert that an object implements the full RepoBackend surface.
 * Throws a descriptive Error listing any missing methods.
 */
export function assertImplementsBackend(impl, label = "backend") {
  const required = [
    "createRepo",
    "fork",
    "readFile",
    "commitAll",
    "push",
    "listCommits",
    "getDiff",
    "merge",
  ];
  const missing = required.filter((m) => typeof impl[m] !== "function");
  if (missing.length > 0) {
    throw new Error(
      `${label} is missing RepoBackend methods: ${missing.join(", ")}`
    );
  }
  return true;
}
