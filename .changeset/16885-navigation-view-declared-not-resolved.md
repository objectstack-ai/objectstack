---
'@objectstack/spec': patch
---

`ListViewSchema.navigation.view`'s description stops promising view selection the stack never performs

`NavigationConfigSchema.view` described itself as *"Name of the form view to use
for details (e.g. `summary_view`, `edit_form`)"*. Measured against
`@objectstack/spec` source and the `objectui` checkout this repo pins in
`.objectui-sha`, no reader resolves an authored view name:

- The key's **only** read is `useNavigationOverlay`
  (`packages/react/src/hooks/useNavigationOverlay.ts`). It binds
  `const view = navigation?.view` and then passes that string as the **second
  argument of `onNavigate`** — the slot whose other producers are navigation
  **mode** tokens (`'new_window'`, and the `'view'` literal the `??` supplies).
- The hook also re-exports it on `NavigationOverlayState.view`, and **no
  consumer reads that member** — while its siblings on the same returned object
  (`width`, `isOverlay`, `mode`, `selectedRecord`) are read at roughly twenty
  sites, which is the lit control that makes the zero a reading.
- Every `formViews` read in that tree is `formViews?.default`. None is keyed by
  an authored view name, so no resolution path exists for this key to reach.
- One shipped consumer types that second argument `'view' | 'edit'` and
  branches on both with **no fallback arm**, so an authored name there matches
  neither branch and the row click does nothing.

The key is therefore worse than ignored: the value travels, and it lands in a
slot that means something else. The description now says that, carries the
repo's existing `[EXPERIMENTAL — not enforced]` marker, and tells authors to
leave the key unset.

⛔ **No accept set moves.** `view` is still `z.string().optional()`; every
document that parsed before parses now, with identical issues and identical
output. Nothing is retired, renamed, constrained, or newly resolved — the
enforce-or-remove decision (ADR-0049) is still open on #16885, and this change
deliberately does not take it.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` ships both `dist`
and `src/**/*.zod.ts`. Measured on the rebuilt artifact: the corrected sentence
is present in 22 built bundles and in the published source file, the old
sentence is absent from all of them, a sibling `describe()` that ships
(`Disable standard navigation entirely`) lit the same probe at 22 as the
positive control, and a test-only `it()` title lit `src` but not `dist` as the
negative control.
