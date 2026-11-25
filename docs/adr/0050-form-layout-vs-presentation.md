# ADR-0050: Form layout vs presentation — split the overloaded `FormView.type`

**Status**: Accepted (2026-10-28, letter A′ on #27032, ruling record 6464210455) — cutover card #27155 (spec) + #27159 (renderer); the 2026-10-20 amendment stands · **Amended** (2026-10-20, letter B′ on [#24692](https://github.com/objectstack-ai/objectstack/issues/24692), ruling record [`6281834942`](https://github.com/objectstack-ai/objectstack/issues/24692#issuecomment-6281834942), maintainer 「同意」) — the list add-record open mode is no longer declared on `addRecord`; see the note under Decision 2. · **Amended** (2026-11-24, [#36086](https://github.com/objectstack-ai/objectstack/issues/36086)) — two dated notes under Decision 2: on an object's list `navigation.mode` is deprecated and no longer picks how a record opens ([#35910](https://github.com/objectstack-ai/objectstack/pull/35910)), and the console's record create and edit forms are the object's own, no longer an internal form view ([#36543](https://github.com/objectstack-ai/objectstack/pull/36543)). Decision 2 and its 2026-10-20 note are left as written.
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0014](./0014-record-form-field-type.md) (record form field type), [ADR-0017](./0017-object-has-many-view.md) (object-bound views), [ADR-0049](./0049-no-unenforced-security-properties.md) (declared ≠ enforced discipline)
**Consumers**: `@objectstack/spec` (`ui/view.zod.ts` `FormViewSchema`), `@object-ui/plugin-form` (`ObjectForm` + `TabbedForm`/`WizardForm`/`SplitForm`/`DrawerForm`/`ModalForm`), `@object-ui/app-shell` (`RecordFormPage`, `AppContent`, `useActionModal`), examples + templates form views.
**Surfaced by**: framework #1890 (viewschema liveness audit) → objectui #1762 (full-page form layout fix) → the modelling debt found while browser-verifying it.

---

## TL;DR

`FormViewSchema.type` is a single enum holding **two orthogonal dimensions**:

| value | real meaning | dimension |
|---|---|---|
| `simple` / `tabbed` / `wizard` | the form's internal **layout** | **Layout** |
| `drawer` / `modal` | where the form is **opened** | **Presentation / container** |
| `split` | a list+detail master-detail mode | neither — a *view mode* |

Because it's one field, **"a modal containing a tabbed form" is inexpressible** — `type` can only be `modal` *or* `tabbed`. That's exactly why the real modal create/edit entry points (`AppContent`, `useActionModal`) set `formType:'modal'` and the form inside can only ever be `simple`.

**Decision: split the dimensions.** `FormView.type` becomes **layout only** (`simple` | `tabbed` | `wizard`). Presentation (drawer/modal/inline/page) is already a *caller* concern and already modelled elsewhere — reuse it. `split` is removed (master-detail is already `subforms` + the list's split-detail open mode).

---

## Context — the presentation dimension already exists (3 places)

The audit + the #1762 browser verification established that `ObjectForm` **already implements every variant** (real `TabbedForm`/`WizardForm`/`SplitForm`; `drawer`/`modal` fall through to `DrawerForm`/`ModalForm`). The gap was entry wiring (fixed for the full-page route in #1762).

Crucially, "how a form is opened" is **already** spec'd, independently of `FormView.type`:

- **Detail open mode** — `NavigationModeSchema`: `page` / `drawer` / `modal` / `split` / `popover` (`view.zod.ts`).
- **Add-record mode** — list `addRecord.mode`: `inline` / `form` / `modal` + `formView`.
- **Action open** — action `type:'modal'` + `target`.

So `drawer`/`modal`/`split` *as `FormView.type` values* are **redundant with — and orthogonal to — these**. And they have **zero real business usage**: the only definitions are 5 showcase/template *named* views built to demo variants (`app-showcase task.view` `split`/`quick`; `hotcrm lead.view` `split`/`drawer`/`modal`). No default form view, no business flow depends on them.

## Decision

1. **`FormView.type` = layout only**: `z.enum(['simple','tabbed','wizard'])` (default `simple`).
2. **Remove `drawer` / `modal` from `FormView.type`.** A form is *placed in* a drawer/modal by the **caller** (list `addRecord.mode`, `NavigationMode`, action `type:'modal'`), and the container renders an `ObjectForm` whose `type` is a *layout*. This makes "modal + tabbed" expressible — the whole point.

   > **Note (2026-10-20, ruling record [`6281834942`](https://github.com/objectstack-ai/objectstack/issues/24692#issuecomment-6281834942)):** the list add-record open mode is no longer declared on `addRecord` — `addRecord.mode` and `addRecord.formView` were retired (ADR-0049 enforce-or-remove); the create form is chosen by convention (`formViews.create` when declared, else `form` / `formViews.default`), how it opens stays the renderer's, and a per-list open mode, if ever wanted, is the list's existing `navigation.mode`, never a second enum.

   > **Note (2026-11-24, [#35854](https://github.com/objectstack-ai/objectstack/issues/35854), ruling record [`7039654214`](https://github.com/objectstack-ai/objectstack/issues/35854#issuecomment-7039654214), maintainer 「废弃」; built by [#35910](https://github.com/objectstack-ai/objectstack/pull/35910)):** the note above names the list's `navigation.mode` as where a per-list open mode would live. On an object's list (a list view, an object's `listViews`) that key is now deprecated and no longer picks how a record opens. The console has one rule there for every reader: the record's name opens the full page, and the icon shown beside the name while the row is hovered opens the side panel (`ui/packages/app-shell/src/views/objectViewOpenAsPage.tsx#OpenInSidePanelButton`). On such a list `drawer`, `page` and `new_window` still parse and change nothing. `none` still means the rows open nothing (`preventNavigation: true` is the preferred spelling), and `openNewTab: true` still opens the page in a new tab. A page block that carries `navigation` (a list block, the timeline, an embedded view) still honours every value. The 2026-10-20 note is left as written; read its last clause with this note.

   > **Note (2026-11-24, [#36425](https://github.com/objectstack-ai/objectstack/issues/36425); built by [#36543](https://github.com/objectstack-ai/objectstack/pull/36543)):** the 2026-10-20 note says the create form is chosen by convention from the object's form views. The console no longer chooses one. Its record create and edit forms (the New and Edit dialog, the full-page form, and a create or edit an action opens) are the object's own: they list the object's fields, less a `showOnCreate: false` field on a create (`ui/packages/app-shell/src/utils/recordFormFields.ts#recordFormFieldNames`), laid out by the object's `fieldGroups` and following the rules on its fields. An internal form view (`formViews.create`, `form`, `formViews.default`) still installs and steers nothing there. A form view still decides its own form in two places: a public form (`sharing.enabled: true`), and a named form a `form`-type action opens. The 2026-10-20 note is left as written; read its convention clause with this note.

3. **Remove `split` from `FormView.type`.** Master-detail is already `subforms` (single-record parent/child) + the list's `NavigationMode:'split'` (list+detail). A form-level `split` is a third, redundant spelling.
4. **`ObjectForm` drops its `drawer`/`modal`/`split` branches** (`DrawerForm`/`ModalForm` become caller-supplied containers; `SplitForm` retires in favour of `subforms`). It keeps `simple`/`tabbed`/`wizard`.

## Migration (low cost — breaking spec, tiny blast radius)

- Spec: narrow the `FormViewSchema.type` enum (spec-major: the removed values are a breaking surface change).
- Renderer: remove the 3 retired `ObjectForm` branches.
- The 5 demo named views (showcase `task` split/quick, hotcrm `lead` split/drawer/modal): convert to `tabbed`/`simple` layout demos, and demo the *open modes* via the list's `NavigationMode` / `addRecord.mode` instead. No business metadata changes.
- Reconcile with the deferred entry wiring: modal/drawer create/edit (`AppContent`/`useActionModal`) should forward the form view's *layout* into the container (so a modal can host a tabbed form) — the concrete follow-up this re-model unlocks.

## Consequences

- **Positive.** Authors describe *structure* with `type` (layout) and *placement* with the existing open-mode fields — no overloaded field, and modal/drawer forms can finally be tabbed/wizard. Smaller, honest `FormView` surface; one master-detail spelling.
- **Negative / cost.** Breaking enum narrowing (spec-major). Requires a coordinated spec + `plugin-form` + examples/templates change. Mitigated by the near-zero real usage of the removed values.
- **Sequencing.** This ADR is the design; implementation is a spec-major change (like ADR-0021's cutover) and should land after architect sign-off, ideally bundled with the modal/drawer layout-forwarding follow-up so the "modal + tabbed" capability ships demonstrably.

## Non-goals

- Re-modelling `NavigationMode` / `addRecord.mode` / action `modal` — they already carry presentation; this ADR *reuses* them.
- The viewschema key-drift cleanup (objectui#1763) — separate.
