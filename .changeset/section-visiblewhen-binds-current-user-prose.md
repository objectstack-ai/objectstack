---
'@objectstack/lint': patch
---

Retire the "no `current_user` at section level" claim from the three prose sites the
re-measurement left unswept

A form-view **section** `visibleWhen` binds `current_user` today. That was measured and
landed for the schema text and the field-rule lint message, but three hand-written sites
still taught the retired claim, so an author reading the docs or hitting the gate was told
the opposite of what the platform does. Text only — no schema, no verdict and no runtime
behaviour moves.

Re-verified at source in `objectui` before trimming anything, because a prose trim applied
to a claim someone had since fixed would silently regress their work:

- `apps/console/src/components/FormPage.tsx` threads the host shell's scope into
  `isSectionVisible`, which forwards it to `evalFieldPredicate` (objectui#6110).
- `packages/plugin-form/src/ObjectForm.tsx` copies an authored section `visibleWhen` onto
  the `section-divider` pseudo-field the renderer evaluates with that scope bound
  (objectui#6111); `SplitForm` / `ModalForm` / `DrawerForm` carry the same line.

The three sites:

- `content/docs/ui/views.mdx` listed *"section-level predicates (objectui#6111)"* as a
  surface that still evaluates the predicate unbound — naming as evidence the very PR that
  bound it. The same sentence also listed `/forms/:name` as unbound; that route renders
  inside `InternalFormRoute`, which publishes the session principal and binds normally, so
  the public `/f/:slug` route is now the only unbound surface named.
- `content/docs/protocol/objectui/layout-dsl.mdx` carried the claim four times — a code
  comment, the binding-root table row, the paragraph under it, and the "two limits" prose —
  where the card recorded three. All four are re-measured together.
- `packages/lint/scripts/check-doc-formula-expressions.mjs`'s field-rule epilogue still said
  a faulting field-level `visibleWhen` is simply fail-OPEN. Under a host that publishes a
  scope the predicate RESOLVES instead: the control is hidden in that one form while no
  server-side gate evaluates a field-level `visibleWhen` at all, so every other reader still
  returns the value — a silent enforcement gap, and the worse of the two outcomes. The
  fault-open leg is kept rather than replaced, because it is still what happens wherever no
  host publishes a scope. The verdict is untouched and the message says why it is now *more*
  justified.

Both replacement texts carry the two qualifications the retired claim's correction needs, so
"sections bind `current_user`" cannot be read as an authorization primitive: the binding is
**client-side only** (nothing on the write path evaluates a form-view field or section
`visibleWhen` — it evaluates field `readonlyWhen` / `requiredWhen` and per-option
`visibleWhen`, and that is the whole list), and **the scope belongs to the host**, so it is
empty on the public `/f/:slug` route and the predicate faults open there.

The epilogue is a plain string nobody else read — deleting the re-measured clause broke no
assertion and turned no gate red, which is exactly how the stale claim outlived its sibling.
It is now pinned by a `--self-test` case that scopes itself to the real epilogue (so it
cannot satisfy itself from its own literal) and asserts both outcomes plus the surviving
fault-open leg. Proven capable of failing by ablation: reverting the clause on disk turns
the self-test red, and restoring returns it to green.
