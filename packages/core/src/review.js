/**
 * review.js — agent-to-agent review protocol.
 *
 * In ArcForge, review is not a human clicking "Approve" — it's a protocol
 * between agents. A proposal (a diff + its WHY.md rationale) is sent as a
 * ReviewRequest; a reviewer agent returns a ReviewVerdict.
 *
 * Types (plain objects, JSON-serializable — they travel over the wire):
 *
 *   ReviewRequest = {
 *     proposalId: string,   // e.g. "agent-1:notes-json-flag"
 *     diff: string,         // unified diff under review
 *     whyText: string,      // contents of the proposal's WHY.md
 *     taskSpec: object,     // the TASKSPEC the proposal claims to satisfy
 *   }
 *
 *   ReviewVerdict = {
 *     approve: boolean,
 *     comments: string[],   // human/agent-readable notes; empty when clean
 *   }
 *
 * Reviewer interface: any object (or function) with
 *   review(request: ReviewRequest) -> Promise<ReviewVerdict> | ReviewVerdict
 *
 * This module ships two implementations:
 *   - StubReviewer: approves unless the diff is empty. Deterministic, so
 *     the demo pipeline is testable with no API keys.
 *   - makeLlmReviewer({ baseUrl, apiKey, model, systemPrompt }): plugs a
 *     real OpenAI-compatible model behind the same interface. The model is
 *     asked for a strict JSON verdict.
 */

export function validateReviewRequest(req) {
  const errors = [];
  if (!req || typeof req !== "object") return ["request must be an object"];
  if (!req.proposalId || typeof req.proposalId !== "string")
    errors.push("proposalId is required");
  if (typeof req.diff !== "string") errors.push("diff must be a string");
  if (typeof req.whyText !== "string")
    errors.push("whyText must be a string");
  return errors;
}

/** Deterministic stub reviewer: approves anything with a non-empty diff. */
export const StubReviewer = {
  name: "stub-reviewer",
  review(request) {
    const errors = validateReviewRequest(request);
    if (errors.length > 0) {
      return { approve: false, comments: errors.map((e) => `invalid request: ${e}`) };
    }
    if (!request.diff.trim()) {
      return {
        approve: false,
        comments: ["diff is empty — nothing to review"],
      };
    }
    const comments = [];
    if (!request.whyText.trim()) {
      comments.push("warning: proposal carries no WHY.md rationale");
    }
    return { approve: true, comments };
  },
};

/**
 * Build a reviewer backed by any OpenAI-compatible chat completions API.
 * The model must return strict JSON: {"approve": bool, "comments": [...]}.
 */
export function makeLlmReviewer({ baseUrl, apiKey, model, systemPrompt }) {
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      "makeLlmReviewer requires baseUrl, apiKey, and model"
    );
  }
  return {
    name: `llm-reviewer:${model}`,
    async review(request) {
      const errors = validateReviewRequest(request);
      if (errors.length > 0) {
        return {
          approve: false,
          comments: errors.map((e) => `invalid request: ${e}`),
        };
      }
      const user = [
        `PROPOSAL ${request.proposalId}`,
        `TASK GOAL: ${request.taskSpec?.goal ?? "(unknown)"}`,
        `ACCEPTANCE: ${(request.taskSpec?.acceptance ?? []).join("; ") || "(none)"}`,
        "",
        "--- DIFF ---",
        request.diff.slice(0, 12000),
        "",
        "--- WHY.md ---",
        request.whyText.slice(0, 4000),
      ].join("\n");

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 800,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`reviewer LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content ?? "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          approve: false,
          comments: ["reviewer returned non-JSON output; treating as request-changes"],
        };
      }
      const verdict = JSON.parse(jsonMatch[0]);
      return {
        approve: verdict.approve === true,
        comments: Array.isArray(verdict.comments) ? verdict.comments.map(String) : [],
      };
    },
  };
}
