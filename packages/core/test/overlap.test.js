/**
 * overlap.test.js — tests for the conflict-prediction engine.
 * Run: node --test packages/core/test/overlap.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiff,
  extractSymbols,
  computeOverlap,
} from "../src/overlap.js";

const DIFF_A = `--- a/notes.py
+++ b/notes.py
@@ -31,7 +31,10 @@ def cmd_list(args):
 def cmd_list(args):
     notes = load()
-    for n in notes:
-        print(n)
+    if args.json:
+        print(json.dumps(notes))
+    else:
+        for n in notes:
+            print(n)
@@ -56,5 +59,6 @@ def main():
     p_add.set_defaults(func=cmd_add)
 
     p_list = sub.add_parser("list")
+    p_list.add_argument("--json", action="store_true")
     p_list.set_defaults(func=cmd_list)
`;

// Touches the same argparse region as DIFF_A with SUBSTANTIAL overlap
// (old lines 56-61 vs DIFF_A's 58-59 = 4+ lines shared -> HIGH).
const DIFF_B_OVERLAPPING = `--- a/notes.py
+++ b/notes.py
@@ -47,4 +47,14 @@ def cmd_delete(args):
     print("gone")
 
 
+def cmd_search(args):
+    print("searching")
+
+
 def main():
@@ -54,8 +64,12 @@ def main():
     p_add = sub.add_parser("add")
     p_add.set_defaults(func=cmd_add)
 
+    p_search = sub.add_parser("search")
+    p_search.add_argument("query")
+    p_search.set_defaults(func=cmd_search)
+
     p_list = sub.add_parser("list")
+    p_list.add_argument("--debug", action="store_true")
     p_list.set_defaults(func=cmd_list)
`;

// Touches a disjoint region (cmd_add) — same file, different area.
const DIFF_C_DISJOINT = `--- a/notes.py
+++ b/notes.py
@@ -25,3 +25,5 @@ def cmd_add(args):
     note = {"text": args.text}
+    if args.due:
+        note["due"] = args.due
     notes.append(note)
`;

// A completely different file.
const DIFF_D_OTHER_FILE = `--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 # Notes
+More docs here.
 Bye
`;

describe("extractSymbols", () => {
  it("extracts Python def/class names", () => {
    assert.deepEqual(extractSymbols("def cmd_list(args):"), ["cmd_list"]);
    assert.deepEqual(extractSymbols("class Foo(Bar):"), ["Foo"]);
  });
  it("extracts JS function names", () => {
    assert.deepEqual(extractSymbols("function review(req) {"), ["review"]);
  });
  it("returns [] for empty trailer", () => {
    assert.deepEqual(extractSymbols(""), []);
    assert.deepEqual(extractSymbols(undefined), []);
  });
});

describe("parseDiff", () => {
  it("parses files, hunks, and symbols", () => {
    const { files } = parseDiff(DIFF_A);
    assert.ok(files["notes.py"]);
    assert.equal(files["notes.py"].hunks.length, 2);
    const [h1, h2] = files["notes.py"].hunks;
    assert.equal(h1.oldStart, 31);
    assert.equal(h1.oldLines, 7);
    assert.deepEqual(h1.symbols, ["cmd_list"]);
    assert.equal(h2.oldStart, 56);
    assert.deepEqual(h2.symbols, ["main"]);
  });
  it("handles /dev/null (new file) paths", () => {
    const { files } = parseDiff(
      "diff --git a/dev/null b/new.py\n@@ -0,0 +1,2 @@\n+x=1\n"
    );
    // Falls back to the a/ path when b/ is /dev/null.
    assert.ok(files["dev/null"] || files["new.py"]);
  });
  it("returns empty files for empty diff", () => {
    assert.deepEqual(parseDiff(""), { files: {} });
  });
});

describe("computeOverlap", () => {
  it("flags HIGH when base line ranges intersect", () => {
    const r = computeOverlap([
      { id: "A", diff: DIFF_A },
      { id: "B", diff: DIFF_B_OVERLAPPING },
    ]);
    assert.equal(r.severity, "high");
    assert.equal(r.conflicts.length, 1);
    const c = r.conflicts[0];
    assert.deepEqual(c.between, ["A", "B"]);
    assert.deepEqual(c.files, ["notes.py"]);
    assert.ok(c.hunks.length > 0);
    assert.equal(c.severity, "high");
  });

  it("flags LOW for same file, disjoint regions and symbols", () => {
    // DIFF_A symbols: cmd_list, main. DIFF_C: cmd_add. Share "main"? No —
    // DIFF_C's only hunk trailer is "def cmd_add(args):". So LOW.
    const r = computeOverlap([
      { id: "A", diff: DIFF_A },
      { id: "C", diff: DIFF_C_DISJOINT },
    ]);
    // A and C share the file; A's hunks carry "main", C's carry "cmd_add".
    // They share no symbol and no hunk -> but both touch notes.py.
    // Actually "main" appears only in A's parser hunk; C has no main hunk.
    assert.equal(r.severity, "low");
    assert.equal(r.conflicts[0].severity, "low");
  });

  it("flags MEDIUM for same file + same symbol, disjoint ranges", () => {
    const d1 = `--- a/x.py\n+++ b/x.py\n@@ -10,3 +10,4 @@ def main():\n a\n+b\n c\n`;
    const d2 = `--- a/x.py\n+++ b/x.py\n@@ -40,3 +40,4 @@ def main():\n x\n+y\n z\n`;
    const r = computeOverlap([
      { id: "P", diff: d1 },
      { id: "Q", diff: d2 },
    ]);
    assert.equal(r.severity, "medium");
    assert.deepEqual(r.conflicts[0].symbols, ["main"]);
  });

  it("reports NONE when files are disjoint", () => {
    const r = computeOverlap([
      { id: "A", diff: DIFF_A },
      { id: "D", diff: DIFF_D_OTHER_FILE },
    ]);
    assert.equal(r.severity, "none");
    assert.equal(r.conflicts.length, 0);
  });

  it("handles three proposals pairwise", () => {
    const r = computeOverlap([
      { id: "A", diff: DIFF_A },
      { id: "B", diff: DIFF_B_OVERLAPPING },
      { id: "C", diff: DIFF_C_DISJOINT },
    ]);
    assert.equal(r.conflicts.length, 3); // A×B, A×C, B×C
    assert.equal(r.severity, "high"); // A×B dominates
  });
});
