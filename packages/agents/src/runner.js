/**
 * runner.js — the ArcForge agent loop.
 *
 * Given a task spec and a workspace path, the agent:
 *   1. reads the spec,
 *   2. asks the model (or the deterministic stub) for a diff + WHY.md,
 *   3. applies the diff to the workspace,
 *   4. commits with the why-chain summary,
 *   5. writes WHY.md into the workspace and commits it too.
 *
 * One shot, not multi-turn — robustness over cleverness. The model's job
 * is a small surgical change; the protocol (claims, overlap, review,
 * arbitration) handles everything else.
 *
 * Configuration via environment:
 *   AF_BASE_URL — OpenAI-compatible base URL, e.g. https://api.example.com/v1
 *   AF_API_KEY  — API key
 *   AF_MODEL    — model id
 *
 * When any of the three is missing, the runner degrades to a deterministic
 * STUB agent: it applies a canned, spec-appropriate patch (registered in
 * STUB_PATCHES by task id) so the whole pipeline is testable with no keys
 * and no network. The real LLM run happens later with keys set.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { WORKER_SYSTEM_PROMPT } from "./prompts.js";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Deterministic stub patches, keyed by task id. Each returns
 * { diff, whyText }. Used when no AF_* env is set — and as the demo's
 * guaranteed-reproducible agent behavior.
 *
 * The demo registers its three patches via registerStubPatch(); the two
 * below are built-in examples.
 */
const STUB_PATCHES = new Map();

export function registerStubPatch(taskId, fn) {
  STUB_PATCHES.set(taskId, fn);
}

function stubPatch(spec) {
  const fn = STUB_PATCHES.get(spec.id);
  if (!fn) {
    throw new Error(
      `no AF_API_KEY set and no stub patch registered for task "${spec.id}"`
    );
  }
  return fn(spec);
}

/**
 * Parse the model's (or stub's) response into { diff, whyText }.
 * Expects the --- DIFF --- / --- WHY.md --- / --- END --- framing.
 */
export function parseAgentResponse(text) {
  // New protocol: model returns complete file contents per FILE block.
  // (Unified diffs proved too fragile for small models to generate.)
  const files = {};
  const fileRe = /--- FILE:\s*([^\s]+)\s*---\s*\n([\s\S]*?)\n--- END FILE ---/g;
  let m;
  while ((m = fileRe.exec(text)) !== null) {
    files[m[1].trim()] = m[2].replace(/\n$/, "") + "\n";
  }
  const whyMatch = text.match(/--- WHY\.md ---\s*([\s\S]*?)\s*--- END ---/);
  if (Object.keys(files).length === 0 || !whyMatch) {
    throw new Error(
      "agent response did not contain --- FILE: path --- / --- WHY.md --- framing"
    );
  }
  return { files, whyText: whyMatch[1].trim() + "\n" };
}

async function llmPatch(spec, workspacePath) {
  const baseUrl = process.env.AF_BASE_URL;
  const apiKey = process.env.AF_API_KEY;
  const model = process.env.AF_MODEL;

  const specText = [
    `TASK ID: ${spec.id}`,
    `GOAL: ${spec.goal}`,
    `CONSTRAINTS: ${(spec.constraints || []).join("; ")}`,
    `ACCEPTANCE: ${(spec.acceptance || []).join("; ")}`,
    `FILES: ${(spec.files_hint || []).join(", ")}`,
    "",
    "SPEC BODY:",
    spec.body || "(none)",
  ].join("\n");

  // Give the model the current file contents for context (small repos only).
  let context = "";
  for (const f of spec.files_hint || []) {
    try {
      const content = readFileSync(join(workspacePath, f), "utf8");
      context += `\n===== ${f} =====\n${content.slice(0, 8000)}\n`;
    } catch {
      /* file may not exist yet */
    }
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: WORKER_SYSTEM_PROMPT },
        { role: "user", content: specText + "\n\nCURRENT FILES:" + context },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    throw new Error(`agent LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseAgentResponse(content);
}

/** Apply a unified diff to the workspace with `git apply`. */
export function applyDiff(workspacePath, diff) {
  const tmp = join(workspacePath, ".arcforge.patch");
  writeFileSync(tmp, diff);
  try {
    git(workspacePath, "apply", "--check", tmp);
    git(workspacePath, "apply", tmp);
  } finally {
    try {
      execFileSync("rm", ["-f", tmp]);
    } catch {
      /* best effort */
    }
  }
}

/**
 * Run one agent against one task spec in one workspace.
 *
 * @returns { proposal: { id, branch, taskId, agentId, diff, whyText, commit } }
 */
export async function runAgent({ spec, workspacePath, branch, agentId }) {
  const hasLlm =
    process.env.AF_BASE_URL && process.env.AF_API_KEY && process.env.AF_MODEL;

  let diff, whyText;
  if (hasLlm) {
    // Live model: writes complete files, diff is derived from git.
    const { files, whyText: wt } = await llmPatch(spec, workspacePath);
    whyText = wt;
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(workspacePath, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    diff = git(workspacePath, "diff", "--no-color");
  } else {
    // Deterministic stub: applies a pre-generated patch.
    const stub = stubPatch(spec);
    whyText = stub.whyText;
    applyDiff(workspacePath, stub.diff);
    diff = git(workspacePath, "diff", "--no-color");
  }

  if (!diff.trim()) {
    throw new Error(`agent ${agentId} produced an empty diff for ${spec.id}`);
  }

  git(workspacePath, "add", "-A");
  git(
    workspacePath,
    "commit",
    "-m",
    `forge: agent ${agentId} implements ${spec.id}\n\n${whyText.split("\n")[0]}`
  );

  // Write WHY.md as a first-class artifact of the proposal. Named per-task
  // so multiple agents' rationale files never collide at merge time.
  const whyFilename = `WHY-${spec.id}.md`;
  writeFileSync(join(workspacePath, whyFilename), whyText);
  git(workspacePath, "add", whyFilename);
  git(workspacePath, "commit", "-m", `forge: agent ${agentId} adds ${whyFilename} for ${spec.id}`);

  const commit = git(workspacePath, "rev-parse", "HEAD");

  return {
    proposal: {
      id: `${agentId}:${spec.id}`,
      branch,
      taskId: spec.id,
      agentId,
      diff,
      whyText,
      commit,
    },
  };
}
