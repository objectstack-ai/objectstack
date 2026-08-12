---
"@objectstack/spec": minor
---

feat(spec): an action may no longer pair `confirmText` with a non-empty `params` (#7428)

**Acceptance narrowing — this refuses metadata that parsed before.** An action
declaring `confirmText` beside a non-empty `params` array shows the user **two
sequential dialogs for one decision**: the console action runner awaits the
confirm, *then* the param prompt, so the first dialog already reads as "the
action ran" while nothing has been sent yet.

The maintainer's 2026-08-10 ruling on #7278 settled the shape: carry the confirm
question in the action's top-level `description` — which the param dialog renders
under its title — and drop `confirmText`. One condition, one wording, one dialog.

Two PRs repaired the sites that shipped this (#7592 for `plugin-approvals`,
#7827 for the fourteen in `platform-objects`). Repairing instances does not stop
the next one being written, which is what this refusal is for. It ships as a
**refusal rather than a warning** because the in-repo `ActionSchema` census is
now **0** — nothing legal breaks — and a warning that fires on every build of an
untouched project is a check nobody reads.

**Migrating.** Move the sentence, do not delete it:

```diff
 defineAction({
   name: 'ban_user',
   label: 'Ban User',
-  confirmText: 'Ban this user? They will be signed out until unbanned.',
+  description: 'Ban this user? They will be signed out until unbanned.',
   params: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
 })
```

Not `ai.description` — that is the LLM-facing tool contract (≥40 chars, required
when `ai.exposed`), and putting the question there arms a tool description while
the dialog falls back to its generic line.

**What is deliberately NOT refused:**

- **`confirmText` on a param-LESS action** stays correct and untouched — there is
  no second dialog to fold the question into, and stripping it would delete the
  only warning the user ever sees.
- **`confirmText` beside an empty `params: []`** — nothing is collected, so no
  second dialog opens.
- **A view's `bulkActionDefs`.** `BulkActionDefSchema` is a separate schema on
  which the pair is *intended*: its params are inputs collected once before the
  run, `confirmText` sits above the affected-record summary, and a `required`
  param blocks that same dialog's Confirm button — one dialog, so there is
  nothing to collapse. The guard lives on `ActionSchema`'s refinement chain and
  is structurally incapable of reaching it; a pinning test asserts the bulk
  pairing still parses, so a future widening of the guard goes red rather than
  landing on correct declarations.
- **Requiring `description` whenever `params` is present.** Forbidding the pair
  is the narrowest guard with measured pull behind it; the wider demand has no
  measured failure behind it and would be its own decision.

`InlineActionSchema` is likewise unaffected — it picks fields from the shared
factory rather than deriving from this refinement chain, and it does not pick
`description`, so the remedy has no slot on that surface yet.
