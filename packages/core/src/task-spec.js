/**
 * task-spec.js — parse and validate TASKSPEC.md files.
 *
 * A TASKSPEC.md is a Markdown document whose body is a human/agent-readable
 * task description, headed by YAML frontmatter carrying the machine-readable
 * contract:
 *
 *   ---
 *   id: notes-json-flag
 *   goal: Add a --json output flag to the notes CLI
 *   constraints:
 *     - do not change existing default output
 *     - keep the change under 40 lines
 *   acceptance:
 *     - notes list --json emits valid JSON
 *     - existing tests still pass
 *   files_hint:
 *     - notes.py
 *   ---
 *   ...free-form spec body...
 *
 * Required frontmatter keys: id, goal.
 * Optional: constraints[], acceptance[], files_hint[].
 *
 * The parser is intentionally dependency-free (no js-yaml): it handles the
 * small subset of YAML this protocol needs — scalars and simple lists.
 */

import { readFileSync } from "node:fs";

const REQUIRED_KEYS = ["id", "goal"];
const LIST_KEYS = ["constraints", "acceptance", "files_hint"];

/**
 * Parse the YAML frontmatter block out of a markdown string.
 * Returns { frontmatter: object, body: string }.
 * Handles scalars (key: value) and simple dash lists:
 *   key:
 *     - item one
 *     - item two
 */
export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  const [, raw, body] = match;
  const frontmatter = {};
  let currentListKey = null;
  let lastScalarKey = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && currentListKey) {
      frontmatter[currentListKey].push(unquote(listItem[1].trim()));
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      if (value === "") {
        // Start of a block list; the items follow on indented lines.
        frontmatter[key] = [];
        currentListKey = key;
        lastScalarKey = null;
      } else {
        frontmatter[key] = unquote(value.trim());
        currentListKey = null;
        lastScalarKey = key;
      }
      continue;
    }

    // Continuation of a scalar on the next line — append with a space.
    if (lastScalarKey !== null) {
      frontmatter[lastScalarKey] += " " + line.trim();
    }
  }

  // Coerce known list keys: a lone scalar becomes a one-item list.
  for (const k of LIST_KEYS) {
    if (k in frontmatter && !Array.isArray(frontmatter[k])) {
      frontmatter[k] = [frontmatter[k]];
    }
  }
  return { frontmatter, body: body.trim() };
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Validate a parsed frontmatter object against the TASKSPEC contract.
 * Returns { ok: true, spec } or { ok: false, errors: [...] }.
 */
export function validateSpec(frontmatter) {
  const errors = [];

  for (const key of REQUIRED_KEYS) {
    if (
      !(key in frontmatter) ||
      typeof frontmatter[key] !== "string" ||
      !frontmatter[key].trim()
    ) {
      errors.push(`missing or empty required key: ${key}`);
    }
  }
  for (const key of LIST_KEYS) {
    if (key in frontmatter && !Array.isArray(frontmatter[key])) {
      errors.push(`key "${key}" must be a list`);
    }
  }
  if ("id" in frontmatter && !/^[a-z0-9][a-z0-9-_]*$/.test(frontmatter.id || "")) {
    errors.push('id must be lowercase alphanumeric with dashes/underscores');
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    spec: {
      id: frontmatter.id,
      goal: frontmatter.goal,
      constraints: frontmatter.constraints ?? [],
      acceptance: frontmatter.acceptance ?? [],
      files_hint: frontmatter.files_hint ?? [],
    },
  };
}

/**
 * Load + parse + validate a TASKSPEC.md from disk.
 * Throws on invalid spec.
 */
export function loadTaskSpec(path) {
  const text = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(text);
  const result = validateSpec(frontmatter);
  if (!result.ok) {
    throw new Error(
      `Invalid TASKSPEC.md at ${path}:\n - ${result.errors.join("\n - ")}`
    );
  }
  return { ...result.spec, body };
}
