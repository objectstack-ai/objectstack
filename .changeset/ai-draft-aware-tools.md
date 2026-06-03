---
'@objectstack/service-ai': patch
---

fix(ai): authoring tools can see their own drafts; blueprint surfaces the package to bind to

Two gaps that broke the multi-step "build app → author a flow for it" path (found while verifying the new solution_design guardrail):

1. **The agent couldn't discover its own draft objects.** `list_objects` / `list_metadata` read `getMetaItems` **active-only**, so a brand-new object the agent had just drafted (never published) was reported as "not found" when it then tried to author an approval flow against it. They now pass `previewDrafts: true`, overlaying pending drafts on the active list (older runtimes ignore the flag → stay active-only). `describe_metadata` was already draft-first.

2. **The auto-authored flow had no package to bind to.** `apply_blueprint` already homes its artifacts in an app package, but its result only nested the id under `package`. It now also surfaces a top-level `packageId` and a `bindingHint` telling the agent to pass that `packageId` to `create_metadata` when it drafts follow-up automation (e.g. the approval flow) — so the flow lands in the app package instead of becoming an orphan draft.

Together with the solution_design process guardrail, this makes the "model the data, then proactively draft the approval flow bound to the app" flow actually executable end-to-end.
