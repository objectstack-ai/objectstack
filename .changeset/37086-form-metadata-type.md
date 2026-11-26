---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/lint': minor
'@objectstack/metadata': minor
'@objectstack/metadata-core': minor
'@objectstack/objectql': minor
'@objectstack/runtime': minor
'@objectstack/cli': minor
'@objectstack/platform-objects': minor
---

feat(spec)!: `form` is a metadata type of its own — `defineForm`, `*.form.ts` and a stack's `forms:` — and the anonymous form doors read a form over both types (ADR-0159 card ②)

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

ADR-0159 makes a public form a `form` item: `name` (`OBJECT.KEY`, the name it is served under), `object` (its one binding) and a form view's body at the top level, its keys taken from `FormViewSchema` by reference. A stack lists them under `forms:`, one per `*.form.ts` module built with `defineForm`. The three old `view` shapes that carry a form (a container's `form`, a `formViews` entry, a `viewKind: 'form'` item) keep loading and serving exactly as before: one projection reads them as `form` items, under the names they are served as today, and nothing an author wrote stops loading.

`@objectstack/platform-objects` ships the `form` type's display label in its metadata-form bundles, translated in every bundled locale.

<!-- adr-0087: registered form-type-define-form-and-packageless-list-at-form-name -->

**BREAKING** (the protocol is narrowed, and a published export changes meaning):

- **The export.** `defineForm` on `@objectstack/spec` and `@objectstack/spec/ui` builds a `form` item. FROM: (since the previous change) no `defineForm`; before that, the Studio metadata-form helper. TO: `defineForm({ name: 'crm_lead.web_to_lead', object: 'crm_lead', sections, sharing })`. The fix for a Studio form: `defineMetadataForm`, as the rename's own entry says; the compiler names every call (a Studio body is refused by `FormSchema`: it has no `name` and `object`).
- **The refusal.** A package-less `view` write that would store a LIST at a name a read-only package authors as a `form` item is refused with `400 VALIDATION_ERROR`, naming the package — on the save, on the publish of a draft saved before the gate, and on a rollback or revert that restores such a body. Items and container expansions alike. Saves admitted today that it refuses: a list at a name several packages ship; a list at a name whose base has no pair; a re-save of a row the base's pair already holds; a container that overlays the package's own. The door that remains: save the list under another key, or into an app of the environment's own. It bites for a name only from the release in which a package authors it as a `form` item.

What lands with the type:

- `@objectstack/spec`: `FormSchema`, `defineForm`, the registry row (`*.form.ts|yml|json`, overlay-capable, no environment overlay), `form` in the customization package's listed types, the stack's `forms` collection, the `forms` translation family (`forms.NAME` first, the `_views.KEY` title and thank-you tails as the fallback, `_views.KEY.label` never read; a form's own section copy at `forms.NAME.sections.SECTION`, with `objects.OBJECT._sections.SECTION` as its object-level default), the projection `projectViewForms`, the intake layer `formIntakeLayer` / `openFormAt`, and the error code `FORM_ADDRESS_TAKEN`.
- `@objectstack/metadata-protocol`: the effective `form` read resolves a form over both types in the one served-row order (a stored `view` row over a package's form keeps replacing it when the package moves to `forms:`); a `form` save, reset or delete at a package removes, in the same transaction, only that package's old-shape row that carries that same form — named as the `form` read serves it (form content only: a list of the name, and a container member served under another name, are untouched); an undo puts back the rows the publish moved, for the revert of a package commit and for a refused package publish on a runtime that cannot roll back alike, and when one view row a commit edited cannot be put back, every form item of that commit is kept as published and each is listed in `failed[]`; a `form` left open on a public address another form holds is refused with `409 FORM_ADDRESS_TAKEN`, naming both, on the save, on the publish of a draft whose address another form took after it was saved, and on a rollback to a version open on a held address (a switched-off form that keeps its link still holds the address; a write that leaves the form closed is never refused); the override gate accepts a `form` override over a base that ships the form as an old shape; a stored body whose form content cannot be read closes the links it names and is reported once per process, at `error`, the first time the form doors read it, naming the row, the links it closes and the repair save; and after a refused or undone publish the doors and the meta reads answer only committed state.
- `@objectstack/rest`: `GET /forms/:slug` and its submit read candidates from the effective `form` read and judge withdrawal across `form` and `view`, effective and per-package, old shapes projected first — narrowing only, in both directions; a body that cannot be read closes the links it names. `/meta/form/NAME` refuses whom `/meta/view/NAME` refuses. `GET /meta/view` answers as before.
- `@objectstack/lint`: `form-public-address-taken` (gating), `form-consumer-less` (advisory, never for an `overrides` item), `form-object-outside-closure` / `form-object-unknown`; the i18n walk emits `forms.NAME.*` keys and no `_views` tail for a `form` item, a form's section copy at `forms.NAME.sections.SECTION` with `objects.OBJECT._sections.SECTION` as the address it falls back to; the translation reference lint judges a `forms.NAME.sections` key against the form's named sections and their entries. No new advisory for an old shape.
- `@objectstack/metadata`, `@objectstack/metadata-core`, `@objectstack/objectql`, `@objectstack/runtime`, `@objectstack/cli`: the `forms` collection is loaded, typed, registered and counted for i18n coverage like every other; in `@objectstack/cli` a key translated at the address the walk names as its fallback is covered, and `os i18n extract` scaffolds no translated-locale value over one.
