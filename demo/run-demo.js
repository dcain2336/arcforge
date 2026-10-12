#!/usr/bin/env node
/**
 * run-demo.js — the ArcForge end-to-end demo orchestrator.
 *
 * Three agents extend a tiny Python notes CLI. The full protocol runs:
 *   1. init a task repo (notes.py + TASKSPEC.md per task)
 *   2. agents claim subtasks (git-native claim registry)
 *   3. each agent forks an isolated workspace, implements, commits + WHY.md
 *   4. overlap engine predicts conflicts BEFORE any merge
 *   5. reviewer approves (stub — deterministic, no API key needed)
 *   6. arbiter merges non-conflicting proposals with why-chain commits;
 *      predicted conflicts go to negotiation instead of merging
 *   7. dashboard state.json is rewritten after every phase
 *
 * Run:  node demo/run-demo.js
 * Needs: git on PATH. No API keys (stub agents). Set AF_BASE_URL/AF_API_KEY/
 *        AF_MODEL to use real LLM agents instead of the stubs.
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CORE = join(ROOT, "packages/core/src");
const AGENTS = join(ROOT, "packages/agents/src");

const { loadTaskSpec } = await import(join(CORE, "task-spec.js"));
const { claim, listClaims } = await import(join(CORE, "claims.js"));
const { forkWorkspace, pushBranch } = await import(join(CORE, "workspace.js"));
const { computeOverlap } = await import(join(CORE, "overlap.js"));
const { StubReviewer } = await import(join(CORE, "review.js"));
const {
  mergeProposals,
  readMergeLog,
} = await import(join(CORE, "merge.js"));
const { runAgent, registerStubPatch } = await import(join(AGENTS, "runner.js"));

// ---------------------------------------------------------------------------
// Stub patches: deterministic agent behavior for the keyless demo.
// Each diff is a real unified diff against demo/repo/notes.py, verified to
// apply cleanly with `git apply`. Tasks A and B both touch the argparse
// setup in main() — the engineered overlap.
// ---------------------------------------------------------------------------

const PATCH_A = `--- a/notes.py
+++ b/notes.py
@@ -33,8 +33,11 @@ def cmd_list(args):
     if not notes:
         print("no notes yet")
         return
-    for n in notes:
-        print(f"#{n['id']}: {n['text']}")
+    if args.json:
+        print(json.dumps(notes, indent=2))
+    else:
+        for n in notes:
+            print(f"#{n['id']}: {n['text']}")
 
 
 def cmd_delete(args):
@@ -56,6 +59,7 @@ def main():
     p_add.set_defaults(func=cmd_add)
 
     p_list = sub.add_parser("list", help="list notes")
+    p_list.add_argument("--json", action="store_true", help="output as JSON")
     p_list.set_defaults(func=cmd_list)
 
     p_del = sub.add_parser("delete", help="delete a note")
`;

const WHY_A = `# Why: notes-json-flag

Adds a \`--json\` flag to \`notes list\` so scripts can consume note data
without parsing human-readable lines. The default output is unchanged —
the flag is opt-in. Chose \`json.dumps(notes)\` over a custom serializer
because the store is already JSON. Deliberately did NOT touch \`add\` or
\`delete\`.
`;

const PATCH_B = `--- a/notes.py
+++ b/notes.py
@@ -47,6 +47,16 @@ def cmd_delete(args):
     print(f"deleted note #{args.id}")
 
 
+def cmd_search(args):
+    notes = load()
+    hits = [n for n in notes if args.query.lower() in n["text"].lower()]
+    if not hits:
+        print("no matches")
+        return
+    for n in hits:
+        print(f"#{n['id']}: {n['text']}")
+
+
 def main():
     parser = argparse.ArgumentParser(prog="notes", description="tiny notes CLI")
     sub = parser.add_subparsers(dest="command", required=True)
@@ -55,6 +65,10 @@ def main():
     p_add.add_argument("text", help="note text")
     p_add.set_defaults(func=cmd_add)
 
+    p_search = sub.add_parser("search", help="search notes")
+    p_search.add_argument("query", help="search text")
+    p_search.set_defaults(func=cmd_search)
+
     p_list = sub.add_parser("list", help="list notes")
     p_list.set_defaults(func=cmd_list)
 
`;

const WHY_B = `# Why: notes-search

Adds a \`search\` subcommand with case-insensitive substring matching, since
the #1 request for a notes CLI is finding things again. Reuses \`load()\`
instead of duplicating store access. The new \`cmd_search\` mirrors
\`cmd_list\`'s output format so the two stay consistent. Deliberately did
NOT add regex — substring covers the need and keeps the diff small.
`;

const PATCH_C = `--- a/notes.py
+++ b/notes.py
@@ -25,2 +25,4 @@ def cmd_add(args):
     note = {"id": len(notes) + 1, "text": args.text}
+    if args.due:
+        note["due"] = args.due
     notes.append(note)
@@ -55,2 +57,3 @@ def main():
     p_add.add_argument("text", help="note text")
+    p_add.add_argument("--due", help="due date (YYYY-MM-DD)")
     p_add.set_defaults(func=cmd_add)
`;

const WHY_C = `# Why: notes-due-date

Adds an optional \`--due DATE\` flag to \`notes add\`, stored on the note
object. Optional (not required) so existing \`add\` usage is untouched.
No date validation yet — deliberately deferred to keep this proposal
minimal; a follow-up task can add it.
`;

function stubResponse(diff, whyText) {
  return `--- DIFF ---\n${diff}--- WHY.md ---\n${whyText}--- END ---\n`;
}

registerStubPatch("notes-json-flag", () => ({
  diff: PATCH_A,
  whyText: WHY_A,
}));
registerStubPatch("notes-search", () => ({
  diff: PATCH_B,
  whyText: WHY_B,
}));
registerStubPatch("notes-due-date", () => ({
  diff: PATCH_C,
  whyText: WHY_C,
}));

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const STATE_PATH = join(ROOT, "packages/dashboard/state.json");
function writeState(state) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function log(phase, msg) {
  console.log(`[arcforge:${phase}] ${msg}`);
}

async function main() {
  const scenario = JSON.parse(
    readFileSync(join(HERE, "scenario.json"), "utf8")
  );
  const state = {
    scenario: scenario.description,
    claims: [],
    proposals: [],
    conflicts: [],
    overlapSeverity: "none",
    merges: [],
    needsNegotiation: [],
    mergeLog: [],
  };

  // -- Phase 0: init the task repo -----------------------------------------
  log("init", "creating task repo");
  const repoPath = mkdtempSync(join(tmpdir(), "arcforge-demo-"));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "arcforge");
  git(repoPath, "config", "user.email", "arcforge@local");
  copyFileSync(join(HERE, "repo/notes.py"), join(repoPath, "notes.py"));

  const specs = {};
  for (const t of scenario.tasks) {
    const specMd = [
      "---",
      `id: ${t.id}`,
      `goal: ${t.goal}`,
      "constraints:",
      ...t.constraints.map((c) => `  - ${c}`),
      "acceptance:",
      ...t.acceptance.map((a) => `  - ${a}`),
      "files_hint:",
      ...t.files_hint.map((f) => `  - ${f}`),
      "---",
      "",
      t.goal,
    ].join("\n");
    writeFileSync(join(repoPath, `TASKSPEC-${t.id}.md`), specMd + "\n");
    specs[t.id] = loadTaskSpec(join(repoPath, `TASKSPEC-${t.id}.md`));
  }
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-m", "forge: init demo task repo");
  writeState(state);

  // -- Phase 1: claims --------------------------------------------------------
  log("claims", "agents claiming subtasks");
  await Promise.all(
    scenario.tasks.map((t) => Promise.resolve(claim(repoPath, t.id, t.agent)))
  );
  state.claims = listClaims(repoPath);
  for (const c of state.claims) {
    log("claims", `${c.agentId} -> ${c.taskId}`);
  }
  writeState(state);

  // -- Phase 2: work ----------------------------------------------------------
  log("work", "agents forking workspaces and implementing");
  const proposals = [];
  for (const t of scenario.tasks) {
    const { path: wsPath, branch } = forkWorkspace(repoPath, t.agent, t.id);
    log("work", `${t.agent}: workspace ${branch}`);
    try {
      const { proposal } = await runAgent({
        spec: specs[t.id],
        workspacePath: wsPath,
        branch,
        agentId: t.agent,
      });
      pushBranch(wsPath, branch); // no-op locally (no remote)
      proposals.push(proposal);
      log("work", `${t.agent}: committed ${proposal.commit.slice(0, 8)}`);
    } finally {
      // Keep worktrees for inspection; they don't disturb the main repo.
    }
  }
  state.proposals = proposals.map((p) => ({
    id: p.id,
    taskId: p.taskId,
    agentId: p.agentId,
    branch: p.branch,
    diff: p.diff,
    whyText: p.whyText,
    commit: p.commit,
  }));
  writeState(state);

  // -- Phase 3: overlap prediction --------------------------------------------
  log("overlap", "predicting conflicts before merge");
  const overlapReport = computeOverlap(
    proposals.map((p) => ({ id: p.id, diff: p.diff }))
  );
  state.conflicts = overlapReport.conflicts;
  state.overlapSeverity = overlapReport.severity;
  for (const c of overlapReport.conflicts) {
    log(
      "overlap",
      `${c.between[0]} x ${c.between[1]}: ${c.severity} ` +
        `(files: ${c.files.join(", ")}; symbols: ${c.symbols.join(", ") || "—"})`
    );
  }
  writeState(state);

  // -- Phase 4: review ---------------------------------------------------------
  log("review", "agent-to-agent review");
  const approved = [];
  for (const p of proposals) {
    const verdict = await StubReviewer.review({
      proposalId: p.id,
      diff: p.diff,
      whyText: p.whyText,
      taskSpec: specs[p.taskId],
    });
    const entry = state.proposals.find((s) => s.id === p.id);
    entry.review = verdict;
    log(
      "review",
      `${p.id}: ${verdict.approve ? "APPROVED" : "CHANGES REQUESTED"}`
    );
    if (verdict.approve) approved.push(p);
  }
  writeState(state);

  // -- Phase 5: arbitration + merge --------------------------------------------
  log("merge", "arbiter merging approved proposals");
  // The arbiter's why-chain wants a rationale summary; derive it from the
  // first non-heading line of each proposal's WHY.md.
  const forMerge = approved.map((p) => ({
    ...p,
    rationale: p.whyText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .slice(0, 2)
      .join(" "),
  }));
  const result = mergeProposals(repoPath, forMerge, {
    targetBranch: "main",
    overlapReport,
  });
  state.merges = result.merged;
  state.needsNegotiation = result.needsNegotiation;
  for (const m of result.merged) {
    log("merge", `merged ${m.proposalId} as ${m.commit.slice(0, 8)}`);
  }
  for (const n of result.needsNegotiation) {
    log("merge", `NEGOTIATION: ${n.proposalId} — ${n.reason}`);
  }
  state.mergeLog = readMergeLog(repoPath, "main");
  writeState(state);

  // -- Done --------------------------------------------------------------------
  console.log("");
  console.log("Demo complete.");
  console.log(`  repo:      ${repoPath}`);
  console.log(`  merged:    ${result.merged.map((m) => m.proposalId).join(", ") || "(none)"}`);
  console.log(
    `  negotiate: ${result.needsNegotiation.map((n) => n.proposalId).join(", ") || "(none)"}`
  );
  console.log(`  board:     packages/dashboard/state.json`);
  console.log(`  why-chain: git -C ${repoPath} log --format=%B -n 3`);
}

main().catch((err) => {
  console.error("demo failed:", err.message);
  process.exit(1);
});
