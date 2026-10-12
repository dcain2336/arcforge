/**
 * overlap.js — THE KEY ALGORITHM: predict merge conflicts before they happen.
 *
 * Given two or more unified diffs, compute structural overlap:
 *   1. same files changed
 *   2. same hunks / line-ranges touched
 *   3. same function/class symbols touched (parsed from `@@` hunk headers)
 *
 * This is a pure function: diff text in, conflict report out. No git, no
 * network, no LLM. The arbiter (merge.js) calls this *before* attempting a
 * merge, so agents can renegotiate instead of discovering conflicts at
 * merge time.
 *
 * Severity model:
 *   high   — two diffs touch overlapping BASE-side line ranges in the same
 *            file, with SUBSTANTIAL overlap (>= 3 lines). Base coordinates
 *            are used because every diff is against the same base commit —
 *            new-side numbers live in different coordinate systems once
 *            earlier hunks shift lines by different amounts. A 1-2 line
 *            graze is usually just shared context lines, not a real
 *            conflict, so it scores medium instead.
 *   medium — same file + same symbol (e.g. both edit `def add_note`), or
 *            a marginal 1-2 line hunk graze, but no substantial overlap
 *            (likely a logical conflict even if git merges cleanly).
 *   low    — same file, different regions and symbols (worth a glance).
 *   none   — no overlap at all.
 */

const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+?)$/;
const MINUS_FILE_RE = /^--- (?:a\/)?(.+)$/;
const PLUS_FILE_RE = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@\s?(.*)$/;

// Heuristic symbol extractors for common languages, applied to the text
// trailing the second `@@` in a hunk header (e.g. `def foo():`).
const SYMBOL_PATTERNS = [
  /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/, // Python
  /^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)/, // Python / JS / Java
  /^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)/, // JS
  /^\s*(?:async\s+)?function\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)/,
  /^\s*(?:export\s+)?(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*[{=>]/, // JS arrow / method-ish
  /^\s*fn\s+([A-Za-z_][A-Za-z0-9_]*)/, // Rust
  /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/, // Go
  /^\s*sub\s+([A-Za-z_][A-Za-z0-9_]*)/, // Perl
  /^\s*(?:public|private|protected|static|\s)+\s+[A-Za-z_<>\[\]]+\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/, // Java/C#
];

/** Extract probable symbol names from a hunk header trailer. */
export function extractSymbols(headerTrailer) {
  const symbols = new Set();
  if (!headerTrailer) return [];
  for (const re of SYMBOL_PATTERNS) {
    const m = headerTrailer.match(re);
    if (m && m[1]) symbols.add(m[1]);
  }
  return [...symbols];
}

/**
 * Parse one unified diff into a structured form:
 *   { files: { [newPath]: { hunks: [{ oldStart, oldLines, newStart, newLines, symbols[] }] } } }
 */
export function parseDiff(diffText) {
  const files = {};
  let current = null;
  let pendingMinus = null;

  const startFile = (path) => {
    current = { path, hunks: [] };
    files[path] = current;
  };

  for (const rawLine of (diffText || "").split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    const dg = line.match(DIFF_GIT_RE);
    if (dg) {
      // b/ path is the new side; /dev/null means deleted (use a/ path).
      const newPath = dg[2] === "/dev/null" ? dg[1] : dg[2];
      startFile(newPath);
      pendingMinus = null;
      continue;
    }

    // Fallback for diffs without the `diff --git` header: pair up the
    // --- / +++ file lines. A --- with no following +++ (or vice versa)
    // is ignored.
    const minus = line.match(MINUS_FILE_RE);
    if (minus && !line.startsWith("--- /dev/null")) {
      pendingMinus = minus[1];
      continue;
    }
    const plus = line.match(PLUS_FILE_RE);
    if (plus) {
      const newPath = plus[1] === "/dev/null" ? pendingMinus : plus[1];
      if (newPath && newPath !== "/dev/null") startFile(newPath);
      pendingMinus = null;
      continue;
    }
    pendingMinus = null;

    const h = line.match(HUNK_RE);
    if (h && current) {
      const [, os, ol, ns, nl, trailer] = h;
      current.hunks.push({
        oldStart: parseInt(os, 10),
        oldLines: ol === undefined ? 1 : parseInt(ol, 10),
        newStart: parseInt(ns, 10),
        newLines: nl === undefined ? 1 : parseInt(nl, 10),
        symbols: extractSymbols(trailer || ""),
      });
    }
  }
  return { files };
}

/** Size of the intersection of two [start, start+lines) ranges. */
function overlapSize(aStart, aLines, bStart, bLines) {
  if (aLines <= 0 || bLines <= 0) return 0;
  return Math.max(
    0,
    Math.min(aStart + aLines, bStart + bLines) - Math.max(aStart, bStart)
  );
}

/**
 * Compute overlap between named diffs.
 *
 * @param {Array<{id: string, diff: string}>} proposals
 * @returns {{
 *   conflicts: Array<{
 *     between: [string, string],
 *     files: string[],
 *     hunks: Array<{file, aHunk, bHunk}>,
 *     symbols: string[],
 *     severity: "high"|"medium"|"low"
 *   }>,
 *   severity: "high"|"medium"|"low"|"none"
 * }}
 */
export function computeOverlap(proposals) {
  const parsed = proposals.map((p) => ({ id: p.id, ...parseDiff(p.diff) }));
  const conflicts = [];

  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const A = parsed[i];
      const B = parsed[j];
      const commonFiles = Object.keys(A.files).filter((f) => f in B.files);
      if (commonFiles.length === 0) continue;

      const overlappingHunks = [];
      const grazingHunks = [];
      const sharedSymbols = new Set();

      for (const file of commonFiles) {
        const aHunks = A.files[file].hunks;
        const bHunks = B.files[file].hunks;

        for (const ah of aHunks) {
          for (const bh of bHunks) {
            // Compare BASE-side (old) ranges: both diffs are against the
            // same base commit, so old coordinates are directly comparable.
            const n = overlapSize(
              ah.oldStart,
              ah.oldLines,
              bh.oldStart,
              bh.oldLines
            );
            if (n >= 3) {
              overlappingHunks.push({ file, aHunk: ah, bHunk: bh });
            } else if (n > 0) {
              grazingHunks.push({ file, aHunk: ah, bHunk: bh });
            }
          }
          for (const s of ah.symbols) {
            if (bHunks.some((bh) => bh.symbols.includes(s))) {
              sharedSymbols.add(s);
            }
          }
        }
      }

      let severity = "low";
      if (sharedSymbols.size > 0 || grazingHunks.length > 0) severity = "medium";
      if (overlappingHunks.length > 0) severity = "high";

      conflicts.push({
        between: [A.id, B.id],
        files: commonFiles,
        hunks: overlappingHunks,
        grazes: grazingHunks,
        symbols: [...sharedSymbols],
        severity,
      });
    }
  }

  const rank = { none: 0, low: 1, medium: 2, high: 3 };
  const severity = conflicts.reduce(
    (max, c) => (rank[c.severity] > rank[max] ? c.severity : max),
    "none"
  );

  return { conflicts, severity };
}
