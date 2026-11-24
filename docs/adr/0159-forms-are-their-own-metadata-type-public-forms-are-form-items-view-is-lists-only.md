# ADR-0159: Forms are their own metadata type — a `form` item is a named form with a consumer, public forms are `form` items, and `view` is lists only

**Status**: Proposed — 2026-11-24, written for objectstack#36868 on the maintainer's ruling of that day (ruling records [`7123091354`](https://github.com/objectstack-ai/objectstack/issues/36444#issuecomment-7123091354) on #36444 and [`7123091586`](https://github.com/objectstack-ai/objectstack/issues/36505#issuecomment-7123091586) on #36505). **The five merge questions are ruled, all option A** (ruling record [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) on #36868, 2026-11-24; [the questions](#the-five-merge-questions-as-ruled)): the record now carries no open default. `docs/adr/**` is Tier H (Prime Directive #14): this record becomes **Accepted** by an authorized approval or the maintainer's merge of the PR that carries it, and is in force from that merge. **This record declares; it implements nothing** — no schema, no code, no changeset; every mechanism below is cut as a card after the merge ([Execution plan](#execution-plan-after-acceptance)). It **amends** [ADR-0017](./0017-object-has-many-view.md) (`viewKind` becomes list-only; the form arm is tombstoned on [D7](#d7)'s schedule) and [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) D2 (`form` joins the overridable types) — each record's Status line carries the dated pointer.

- **Date**: 2026-11-24
- **Decided by**: the maintainer, 2026-11-24, verbatim and untranslated, as the card and the two ruling records carry them:
  - 05:21Z: 「是否建议表单从 view 中更直接拆分出来，比如叫form元数据？」
  - 05:22Z: 「如果分拆的话，对外表单的功能就不用单独开发了，就合并到这个元数据类型中。」
  - 05:23Z: 「现在对外表单开发的任务先暂停」 (pause record [`7122924165`](https://github.com/objectstack-ai/objectstack/issues/36444#issuecomment-7122924165)).
  - 05:33Z, on the decision card 「表单要不要从 view 拆成独立的 form 元数据类型？」, option picked: **「拆成 form 类型，对外表单并入」**. Not taken: keep forms in `view` and retire only the container shape; keep everything as is.
  - On this record's five merge questions, put to the maintainer with the four-axis options of dev report [`7129798720`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7129798720), each with recommendation A: 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」 (ruling record [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242), recorded 2026-11-24T12:31Z). All five are option A.
- **The ruling, as the card records it** (this record executes it; ⛔ none of it is re-opened here):
  1. A new metadata type **`form`**, addressed by name, bound to one object (it carries `object` itself), body = today's form view schema. Its content is named forms that have a consumer: **public forms** (the main content, `sharing` included) and forms an action of `type: 'form'` opens.
  2. **Public forms are not a separate feature**: they are `form` items. Their list, detail and edit come from the `form` type, not from a separate Studio page.
  3. `view` becomes **lists only**. The record create and edit form stays on the object's `fieldGroups` and does not become a `form` item.
- **Rulings it replaces**: items 1 and 2 of ruling record [`7118881549`](https://github.com/objectstack-ai/objectstack/issues/36444#issuecomment-7118881549) (the 2026-11-24T01:08Z option 「Studio 单独一页，存储不变」) and the "Definition (unchanged shape)" paragraph of ruling record [`7100386248`](https://github.com/objectstack-ai/objectstack/issues/36444#issuecomment-7100386248). The rest of 7100386248 stands and is carried here: Studio designs and Setup operates (its items 2 to 10), and a switched-off form answers `404 FORM_NOT_FOUND` like a form that does not exist (its F3 = A).
- **Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce or remove), [ADR-0050](./0050-form-layout-vs-presentation.md) (a form declares layout, the caller chooses where it opens), [ADR-0084](./0084-application-builder-information-architecture.md) (the Interface pillar already lists `form` beside `view`; no change there), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (conversions, the migration chain, stored rows), [ADR-0088](./0088-metadata-kind-admission-and-retirement.md) (the kind admission test), [ADR-0138](./0138-guest-model-anonymous-principal-doors-grants-and-organization.md) D2 (the public form doors' admission condition and grant, unchanged), [ADR-0146](./0146-studio-designs-setup-administers-one-editor-per-item-paired-customize-package.md) (declared overrides in the paired `.custom`), [ADR-0150](./0150-behavioural-metadata-addressed-by-package-objects-keep-the-literal-prefix.md) D1 (object-derived names keep the literal prefix).
- **Inputs**: the card's read-only analysis, taken at `main` `14f4d8f8`. Every reading below was taken again for this record on `objectstack-ai/objectstack` `main` at `62692b7f8b`; where a position moved, [Readings](#readings-re-taken-at-62692b7f8b) says so.

---

## TL;DR

1. **`form` is a metadata type.** A `form` item is `name` + `object` + the form body. Its name is `OBJECT.KEY`, the name the form is served under today, so no served name changes ([D2](#d2), [D3](#d3)).
2. **It passes ADR-0088's admission test on three consumers that exist today**: the anonymous form doors, an action of `type: 'form'`, and Setup's public-forms list. A record create or edit form is not `form` content ([D1](#d1)).
3. **Adding the type is additive.** From the release that adds it until the next protocol major, the loader projects the three old shapes into `form` items, `view` reads are unchanged, and nothing an author wrote stops loading ([D5](#d5)).
4. **The anonymous doors and the withdrawal judgement read both types through one projection.** A form switched off in either type is closed in both; a stored body the projection cannot read closes the slugs it names ([D6](#d6)).
5. **The old shapes are tombstoned only in the next protocol major**, with an ADR-0087 conversion for sources and a ceremony for stored rows, `.custom` overrides included ([D7](#d7)).
6. **`form` is overridable by declaration** in the paired `.custom`, like `page` ([D4](#d4)).
7. **Translations get a `forms` family**; the form tails under `objects.OBJECT._views` are read as a fallback until the major ([D8](#d8)).
8. **Shipped work is kept and re-pointed**: Setup's page reads `form`, the paused designer becomes the `form` editor, the Studio Developer page and the Form-tab switch retire ([D9](#d9)).
9. **Five cards, in order**; ②, ③ and ④ are additive, ⑤ is the major ([Execution plan](#execution-plan-after-acceptance)).
10. **Five points the first ruling is silent on were put to the maintainer and are ruled, all option A**: `defineForm` is the type's factory, the name stays `OBJECT.KEY`, a taken public address is refused, the reader of old withdrawals is exempt from the age-out, and the body is at the top level ([The five merge questions, as ruled](#the-five-merge-questions-as-ruled)). **Two points go past the ruling's words and are marked where they stand**: the `*.form.ts` file suffix follows the factory name by the owning seat's routing ([D2](#d2)), and this record keeps the withdrawal reader through major 19 although the ruling would let it leave there ([question 4](#q4)).

---

## Context

### What `view` carries today

One type carries two unrelated things. `packages/spec/src/ui/view.zod.ts` declares:

- the form body, `packages/spec/src/ui/view.zod.ts#FormViewSchema` (`type`: `simple`, `tabbed`, `wizard`; `sections`; `sharing`; `submitBehavior`);
- the container, `packages/spec/src/ui/view.zod.ts#ViewSchema`, with four members: `list`, `form`, `listViews`, `formViews`;
- the ADR-0017 item, `packages/spec/src/ui/view.zod.ts#ViewItemSchema`: `{ name, object, viewKind: 'list' | 'form', config }`, one arm per kind, and its wire twin `packages/spec/src/ui/view.zod.ts#ViewItemWireSchema`.

So a form reaches the platform in **three shapes**: the container's `form`, a `formViews` entry, and a `viewKind: 'form'` item. `form` is not a member of `packages/spec/src/kernel/metadata-plugin.zod.ts#MetadataTypeSchema`.

### No record form reads a form view

Since #36425 the console's create dialog, full-page create, action-opened create and edit lay out by the object's `fieldGroups` and the rules on its fields. The docblock of `ui/packages/app-shell/src/utils/recordFormNavigation.ts#FormViewDefinition` says it in these words: "No record create or edit reads one". `addRecord.formView` is a tombstone in `packages/spec/src/ui/view.zod.ts`. The lint rule `form-view-internal-not-loaded` (`packages/lint/src/validate-internal-form-views.ts`) reports an internal create or edit form as steering nothing. No per-role or per-position form assignment exists.

### Named forms have three consumers

1. **Public forms.** `GET` and `POST` under `/api/v1/forms/:slug` (`packages/rest/src/form-routes.ts#registerFormEndpoints`), rendered by the console at `/f/:slug`.
2. **A form an action opens.** `packages/spec/src/ui/action.zod.ts#ActionType` has the member `form`; its `target` is the form's name, routed to `/forms/:name`, where `ui/apps/console/src/components/FormPage.tsx` reads `GET /api/v1/meta/view/:name`.
3. **Administration and design surfaces**: Setup → Configuration → Public forms (#36697, merged as `c45dd80ff9`), the Studio Developer → Public Forms page, and previews.

Nothing on the list side reads a form: the view switcher takes list items only (`ui/packages/app-shell/src/providers/MetadataProvider.tsx` routes `viewKind: 'form'` items away from `listViews`), and an app navigation entry's `viewName` targets a list (`packages/spec/src/ui/app.zod.ts`).

### The anonymous doors and the withdrawal judgement

Both doors read the form through one resolution inside `packages/rest/src/form-routes.ts#registerFormEndpoints`: it lists type `view` (the effective read, beside the per-package layer), and offers a form only when `packages/spec/src/ui/anonymous-form-intake.ts#anonymousFormIntakeCandidates` yields it. That function scans the three shapes in a fixed order. A form is open when its `sharing` declares `enabled: true`, `allowAnonymous: true` and a `publicLink`; ADR-0138 D2 row 1 names exactly this as the doors' admission condition.

`packages/spec/src/ui/anonymous-form-intake.ts#anonymousFormIntakeWithdrawnIn` is the kill switch: a body of the same name that keeps the link and sets a switch to `false` closes the form, matched by slot or by slug, and layering may only narrow. Identity is the item **name**. The object a form submits into is resolved by `packages/spec/src/ui/anonymous-form-intake.ts#anonymousFormObjectName` over four rungs, one of which is the container's `list.data.object` — a form reading its binding off a list.

Two write-time judgements read the same candidates: the tenancy intake advisory in `packages/metadata-protocol/src/runtime-authoring-gate.ts` (it returns nothing for a type other than `view`), and the container name-collision refusal in `packages/metadata-protocol/src/protocol-save.ts`.

**No door refuses a second form on a slug another form already publishes.** The resolver takes the first candidate in list order; the header of `packages/spec/src/ui/anonymous-form-intake.ts` says "Another row that publishes or withdraws the same slug is a different form and closes nothing". The only clash refusal is client-side, in the paused designer.

### Loading, overriding, translating

- The loader expands a container into items: `packages/spec/src/ui/view.zod.ts#expandViewContainer`, called from `packages/metadata/src/plugin.ts`, `packages/objectql/src/engine-registration.ts` and, for stored rows, `packages/metadata/src/view-container-expansion.ts#expandRuntimeViewContainer`.
- `view` is `listed` in `packages/spec/src/kernel/customization-package.ts#OVERRIDE_TYPE_CLASSIFICATION`. Setup's switch saves a `view` override in the app's paired `.custom` (`ui/packages/app-shell/src/views/setup/publicForms.ts#switchPublicForm`), a body that holds the switch and nothing else of its own.
- Form copy is translated at `objects.OBJECT._views.KEY.title` and `.submitBehavior.title` / `.message`, and section copy at `objects.OBJECT._sections.SECTION` (`packages/spec/src/system/translation.zod.ts#ObjectTranslationDataSchema`; emitted by `packages/lint/src/i18n-walk.ts`).
- The stored-row conversion pass wraps one row in **its own type's** stack collection and reads that collection back (`packages/spec/src/conversions/stored.ts#applyConversionsToStoredItem`). It cannot move a row from one type to another.

### Size

Measured on `62692b7f8b` with `git grep -lE "formViews|viewKind: 'form'|viewKind === 'form'" -- packages ui`: 256 files, of which 158 are tests. Among the non-test source files: `packages/spec` 33, `packages/lint` 15, `ui/packages` 11, `packages/cli` 4, `packages/metadata-protocol` 4, `packages/rest` 3, `packages/metadata-core` 2, and one each in `packages/metadata`, `packages/objectql` and `ui/apps`. The card's own count at `14f4d8f8` was 81 non-test and 166 test files with a pattern it does not record; the two are the same order. In this repository's examples the shapes are authored in `examples/app-crm/src/views/lead.view.ts` and three showcase view files. The card reads two HotCRM source files (`lead.view.ts`, `case.view.ts`) and seven tests; HotCRM was not re-read for this record.

### One name already taken

`packages/spec/src/ui/view.zod.ts#defineForm` is a published export, and it is **not** this type's factory: it builds a schema-bound form for Studio's metadata editors (`data.provider: 'schema'`), used by 17 `*.form.ts` modules under `packages/spec/src`. The obvious factory name and the obvious file suffix for the new type both collide with it in meaning. [Ruled question 1](#q1) settles the name: it goes to the new type and the Studio helper is renamed. The suffix follows the name ([D2](#d2)); that step is the owning seat's routing on question 1's logic and is not in the ruling's words.

---

## Decision

### D1 — `form` is admitted as a metadata kind, on consumers that exist {#d1}

ADR-0088's three clauses, each on a fact measured above:

1. **Independent lifecycle.** A form is created, published, switched off, overridden and deleted under its own name. The public address and the action target each name one form. Nothing reads it as a facet of a list: the switcher and the app navigation take lists only, and a form shares with its object's lists only the `OBJECT.` prefix.
2. **Declarative governability.** It ships as a standalone document from a package, is authored at runtime through Studio and the metadata API (`allowRuntimeCreate`), is versioned, and takes a declared override ([D4](#d4)).
3. **A real consumer.** The anonymous form doors serve it; an action of `type: 'form'` opens it; Setup switches it. All three exist before this record.

**What is `form` content, and what is not.** A `form` item is a named form that something opens: a public form (it declares a `sharing.publicLink`), or a form an action of `type: 'form'` targets. A "custom create form" or a "wizard" is `form` content only when an action opens it. The object's record create and edit form is **not** a `form` item (ruling item 3): it is the object's `fieldGroups`, and the type has no `isDefault`, no `create` or `edit` role and no key that binds a form to a record page, a role or a position. A request for a per-role record form is a new decision, not a reading of this one.

**A `form` item with no consumer is reported, not refused.** `os validate` and the lint report an item that declares no `sharing.publicLink` and that no `type: 'form'` action in the stack targets, as a warning — the successor of `form-view-internal-not-loaded`, by the same matching rule (the target must equal the name the form is served under). It is a warning because a form is legitimately consumer-less for a moment while it is being built: the form is saved first and the action that opens it second.

### D2 — The shape: `name`, `object`, and the form body at the top level {#d2}

```ts
// forms: [ … ] in a stack; one document per form
{
  name: 'crm_lead.web_to_lead',   // OBJECT.KEY — D3
  object: 'crm_lead',             // the one binding
  label: 'Web to lead',           // optional; the row's name in lists
  type: 'simple',
  title: 'Contact us',
  sections: [ /* … */ ],
  sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' },
  submitBehavior: { kind: 'thank-you', title: 'Thank you' },
}
```

- **One Zod source** (Prime Directive 7): a `FormSchema` in `packages/spec/src/ui/`, derived **by reference** from `FormViewSchema`'s shape, never transcribed. `FormViewSchema` stays as the body schema; the schema-bound Studio forms and the React form block keep using it.
- **The body is at the top level.** There is no `viewKind` and no `config` wrapper: the type is the discriminator, and "body = today's form view schema" is read literally. Ruled so ([question 5](#q5), which keeps the wrapped alternative as the option not taken).
- **Identity keys**: `name` and `object` required; `label` optional (the display name in lists and in Setup; when absent a surface shows `title`, then the name). The item carries the envelope every standalone item carries: `protection`, the ADR-0010 fields, and ADR-0146's `overrides` declaration.
- **Not carried over from the view item**: `viewKind`, `config`, `isDefault` (a record-form role, ruling item 3), `order` (the switcher's order) and `scope` (the registry's provenance already says package or runtime).
- **The object binding has one rung.** A `form` item's object is its `object`. The body's `data` key is not authored on a `form` item: the schema refuses it by name with the prescription "bind the form with `object`". A form bound to a JSON Schema (`data.provider: 'schema'`) is not a `form` item — it has no consumer among the three. The four-rung resolution of `anonymousFormObjectName` survives only inside the projection of the old shapes ([D5](#d5)) and leaves with them.
- **`object` must name an object** the package can reference, judged where a view's object is judged today (`os validate`, publish). It is not editable after the form is created: the name carries it ([D3](#d3)).
- **Stack collection** `forms`; file patterns `**/*.form.ts`, `**/*.form.yml`, `**/*.form.json`; items are served at `/api/v1/meta/form`, as every type's are.
- **The `*.form.ts` suffix goes to the new type, and the Studio modules take `*.metadata-form.ts`, in card ②.** Today the suffix means a Studio metadata-form module: 17 files carry it, all under `packages/spec/src`, and `scripts/i18n-bundle-surface.mjs#isMetadataFormModulePath` classifies by it on the file's base name anywhere in the repository. Left as it is, an example's `lead.form.ts` would be read as a Studio module by the two readers of that predicate (the gate derivation in `scripts/pm/dispatch-gates.mjs` and the landing reading in `scripts/pm/landing-k.mjs`). So the 17 modules are renamed to `*.metadata-form.ts` — the name of their helper (`defineMetadataForm`) and of their translation family (`metadataForms`) — and `scripts/i18n-bundle-surface.mjs#METADATA_FORM_MODULE_SUFFIX` becomes `.metadata-form.ts`.
  - **This follows question 1 by the seat's routing, not by the ruling's words.** Ruling record 7131569242 settles the factory name. It does not mention the suffix. The owning seat routed the suffix to follow the name by the same logic (the obvious spelling goes to the new type, the Studio one moves), in seat record [`7132202077`](https://github.com/objectstack-ai/objectstack/pull/36957#issuecomment-7132202077) on PR #36957. It is written here so the approver reads it as the seat's routing and can strike it; the alternative not taken is to keep the 17 file names and narrow the predicate to `packages/spec`.
  - **Who reads the suffix, measured at `689e5695b98`** (card ② counts again at its own head):
    - the one matcher, `scripts/i18n-bundle-surface.mjs` (the constant and the predicate), and the files that spell the suffix beside it: two cases in `scripts/pm/dispatch-gates.self-test.mjs`, the kind text in `scripts/pm/dispatch-gates.data.mjs`, a fixture path in `scripts/pm/landing-k.mjs`. `scripts/pm/dispatch-gates.mjs`, a Tier H file, imports the predicate and spells no suffix, so the rename does not edit it;
    - import specifiers: 31 files under `packages/spec/src` import a module as `./NAME.form` — the seven domain barrels, `packages/spec/src/system/metadata-form-registry.ts` and 23 tests;
    - generated outputs that print the module paths (`packages/spec/export-origins/`, seven files): regenerated, never edited by hand;
    - path citations in hand-written ledgers, checklists and comments (`packages/spec/liveness/`, `docs/qa/platform-checklist/areas/`, comments under `packages/lint/src`, `packages/cli/src` and `ui/packages/app-shell/src/views/metadata-admin/`): re-pointed where they name a live file. Released text is not rewritten: a `CHANGELOG.md`, a released changeset, a migration entry of a past major;
    - no loader or build step matches the suffix: the 17 modules are reached by import, through the barrels and the registry.
- **Registry row**: `supportsOverlay: true`, `allowEnvironmentOverlay: false`, `allowRuntimeCreate: true`, `supportsVersioning: true`, `executionPinned: false`, `loadOrder: 50`, `domain: 'ui'` — `page`'s row. `allowEnvironmentOverlay` is `false` because a new type takes ADR-0005's default and ADR-0146 D11 retires that tier as a write door; a customization is a declared override ([D4](#d4)).

### D3 — The name space: `OBJECT.KEY`, the served name, unchanged {#d3}

- **Grammar.** A `form` name is the dot-required qualified name the view item uses today (`packages/spec/src/ui/view.zod.ts#ViewItemNameSchema`). The part before the last segment **must equal `object`**; a mismatch is refused at parse. The view item never enforced that equality; the new type does from its first release.
- **Why this name.** It is the name every form is served under today — a stored item's own `name`, and for a container's form the name `expandViewContainer` gives it. An action's `target`, a `/forms/:name` link, a `.custom` override's key and the withdrawal judgement's identity are all this string. Keeping it means the migration renames nothing, and a withdrawal recorded against a name keeps closing that name ([D6](#d6)). Under ADR-0150 D1 it is an object-derived literal name, the bucket `view` is in; `form` takes the same bucket and no (package, name) resolution.
- **Separate from lists.** After the split a list `crm_lead.all` and a form `crm_lead.all` are items of two types and do not collide. Until the old shapes are tombstoned they still share the `view` type's name space wherever the old shapes are stored, and the container name-collision refusal keeps judging them there.
- **One form per name per package.** Inside a base's dependency closure ADR-0146 D2's rule applies unchanged: an undeclared same-name item of a dependent is refused at publish.
- **The public address (slug) is a second identity**, declared in `sharing.publicLink`. Two different forms on one slug are not refused today. By [ruled question 3](#q3) the `form` write door, `os validate` and publish refuse it.

The name is ruled ([question 2](#q2)); the alternative not taken is a short name addressed by package.

### D4 — Overrides: `form` joins ADR-0146 D2's list {#d4}

`form` is overridable by declaration: an item of the base's paired `.custom` that carries the base form's name and `overrides: { package, basedOn }` replaces the base's form whole (ADR-0146 D2, D8). This is what Setup's on/off switch writes and what the designer writes when it edits an installed app's form.

- **The classification row** is `form: listed` in `OVERRIDE_TYPE_CLASSIFICATION`, basis `adr_0146_d2_listed`, no conditions. `packages/spec/src/kernel/customization-package.test.ts` fails when a registry type has no row there and when a row names no registry type, so the row lands in the **same change** as the registry row — card ②. This record changes no code.
- **Whole-document replace stands.** The switch-only override Setup writes is the base's whole document with one key changed; `ui/packages/app-shell/src/views/setup/publicForms.ts#overrideHoldsOnlySwitch` is how the page tells such an override from a redesign.
- **`form` is not a security-catalog type** (ADR-0146 D6): the anonymous grant is derived from the resolved form's object at the door (ADR-0138 D2), not held by name in the security catalog. What an override may do to anonymous intake is bounded by [D6](#d6), not by excluding the type.

### D5 — Adding the type is additive: one projection reads the three old shapes {#d5}

From the release that adds the type until the next protocol major:

- **The projection.** One pure function in `packages/spec` — beside `expandViewContainer`, built on it — turns a `view` body into the `form` items it carries: the container's `form`, each `formViews` entry, and a `viewKind: 'form'` item's `config`. Each projected item takes the name it is served under today, `object` from the old four-rung resolution, and the body unchanged. It is the **only** reader of the old shapes for form content: the loader, the stored-row read, the anonymous doors, the withdrawal judgement and the lint all call it, and none re-reads `formViews` by hand.
- **`form` reads serve authored items and projected ones.** A projected item is marked as such in its read envelope so a surface can say "defined in a view" and offer the move.
- **An authored `form` item shadows a projected one of the same name in the same package.** It never shadows a withdrawal ([D6](#d6)).
- **`view` reads are unchanged** until the major: `GET /api/v1/meta/view` keeps listing `viewKind: 'form'` items, and `GET /api/v1/meta/view/:name` keeps answering a form's name. They are frozen: they serve the old shapes only and are not the picture of an environment's forms once a `form` item exists. Every platform reader moves to `form` — the anonymous doors in card ②, the console in card ③.
- **Old-shape writes still save** until the major. A new `view` save that carries a form is stored as a `view` row and projected.
- **A `form` write acts on the form whichever type stores it.** A save, reset or delete of a `form` at `(package, name)` also removes the old-shape row that carries the same form at the same address, in the same transaction: an item-shaped `view` row is deleted, a stored container is re-saved without that form. One address holds one definition of a form; the Setup switch written before the re-point (a `view` override) is found and cleared by the re-pointed switch. ⛔ It removes form content only. A list item of type `view` that holds the same `OBJECT.KEY` name is another item of another type and is left untouched: the two types share one name grammar ([D3](#d3)), which makes this the one destructive edge of the rule, and card ② pins it (a `form` save, reset and delete at a name a list holds each leave the list row byte-equal).
- **No conversion notice and no new warning for an old shape before the major.** The existing `form-view-internal-not-loaded` warning is the only advisory. Skills and docs teach the new shape from card ④.

### D6 — The anonymous doors and the withdrawal judgement read both types {#d6}

This is the security-sensitive part. ADR-0138 D2 row 1 is unchanged: the admission condition is still the form's own `sharing` declaration, and the grant is still insert and read-back on the form's one object. What changes is where the declaration is read from. The rules:

1. **One resolution.** Every anonymous door keeps reading the form through the one resolution in `registerFormEndpoints`. No door gets its own copy of "is this form public".
2. **One candidate rule.** `anonymousFormIntakeCandidates` gains the `form` item as a fourth shape (the item itself is the form). The three-part open test does not change.
3. **Candidates come from the effective `form` read** — authored items and projections ([D5](#d5)).
4. **The withdrawal layer is both types, every layer.** A candidate named `N` is served only when no body that carries `N` explicitly withdraws it, across: the effective list of `form`, the effective list of `view`, and the per-package layer of each. Old-shape bodies are passed through the projection first, so a container's `formViews` entry is judged under the name it is served as.
5. **Narrowing only, in both directions.** A `form` item cannot re-open a form an old-shape body withdraws, and an old-shape body cannot re-open a form a `form` item withdraws. The shadowing of [D5](#d5) selects which body is *served*; it never removes a body from the withdrawal layer.
6. **Identity is the served name, and inside one name the whole item.** A body named `N` that explicitly withdraws a form closes `N`. For a `form` body the item is the slot, and after rule 4 an old-shape body is judged as the items it projects, one form each. The match does not ask the slug: a withdrawn form does not escape by pointing its link at a new slug, because the body of its name still withdraws it. A definition under **another name** is a different form and a withdrawal of the first name does not close it. That is today's rule, in the module's header: the doors "judge by the served item name", and "Another row that publishes or withdraws the same slug is a different form and closes nothing". This record does not widen identity to the slug across names. What keeps a second form off a switched-off form's address is [ruled question 3](#q3)'s refusal at the write door, where a switched-off form that keeps its link still holds it. The known limit recorded in the header (a withdrawal of a name closes that name in every package) is kept, because it fails closed.
   - **The slug match of `anonymousFormIntakeWithdrawnIn` decides no case in this layer, and no pin is asked for it.** It decides exactly one case: two bodies of one name whose forms sit under different members, which only a container handed over as stored can be. Rule 4 leaves no such body in the doors' layer, and a container the projection cannot turn into items is closed whole by rule 7. The function keeps the match for its callers outside this layer, which may be handed a container body as stored (the major-18 ceremony in `packages/cli/src/utils/organization-ownership-apply.ts`, and Setup's judgement of an app's own document until card ③ re-points it); it leaves with the old shapes.
7. **A body that cannot be read closes what it names.** A stored `view` body that carries form content the projection cannot turn into items is not skipped: every public link it names is treated as withdrawn, and the boot says so once at `error`, naming the row and the ceremony of [D7](#d7).
8. **A switched-off form answers `404 FORM_NOT_FOUND`**, as a form that does not exist (ruling record 7100386248, F3 = A). The tenancy intake rule is unchanged and runs after the match.
9. **Write-time judgements cover `form`.** The tenancy intake advisory and the organization-scoped refusal of a save that would leave a withdrawn form open judge a `form` write as they judge a `view` write, over the same two-type layer.
10. **The reader of old-shape withdrawals outlives the old shapes.** See [D7](#d7) and [ruled question 4](#q4).

**Pins card ② owes, each with an ablation** (remove the named read, watch the pin turn red, restore):

- a form withdrawn by a `view` override in `.custom`, with an authored `form` item of the same name open: both doors answer `404` (ablate: the `view` half of the layer);
- the mirror: withdrawn by a `form` override, open as an old-shape item in the base (ablate: the `form` half);
- withdrawn in a container's `formViews` entry, open as a `form` item named for the expansion (ablate: the projection step of the layer);
- withdrawn in a body of the same name whose link names another slug than the open definition's: both doors answer `404` at the open definition's address (ablate: the whole-item match of rule 6 — make it require an equal slug);
- a per-package-layer withdrawal in either type (ablate: `getMetaItemsPerPackage` for that type);
- an unreadable old-shape body closes its links (ablate: rule 7);
- the submit door refuses where the resolve door does, on each case above.

Each pin asserts the refusal's status and `code` and that no record was written, not a bare status.

### D7 — The old shapes retire in the next protocol major, with their migration {#d7}

**Schedule.** The protocol is at major 18 (`packages/spec/src/kernel/protocol-version.ts#PROTOCOL_VERSION`). The three old shapes are tombstoned in **major 19** and not before: `ViewSchema.form`, `ViewSchema.formViews`, and the `form` member of `packages/spec/src/ui/view.zod.ts#ViewKindSchema` with the `form` arm of `ViewItemSchema` and `ViewItemWireSchema`. Each tombstone carries its prescription ("a form is a `form` item: move it to `forms:` …") as `retiredKey()` and `enumWithRetiredValues` do today. `Metadata-protocol: narrowed`. From that release `view` reads serve lists only.

**Sources — an ADR-0087 conversion and `os migrate meta`.**

- One D2 conversion, `toMajor: 19`, on the stack: it moves each named form out of `views[]` into `forms[]` under the projection's name, lifts the binding to `object`, and leaves the lists where they are. A container left with no member is removed. It is lossless for every form it moves.
- It is the first conversion that moves an item between two stack collections; its fixture pairs cover the three shapes, a container holding both lists and forms, and a form whose `data.object` disagrees with its container (left in place, with a structured TODO).
- **Internal record forms are not moved** (ruling item 3). An internal record form is a form in a record-form slot — the container's default `form`, `formViews.default`, `formViews.create`, an item with `isDefault: true` or named `OBJECT.create` — that declares **no `sharing.publicLink`** and that no `type: 'form'` action in the stack targets. The slots are the ones `form-view-internal-not-loaded` names. The test for "public" is [D1](#d1)'s and ⛔ not that rule's: the rule asks `sharing.enabled === true` (`isPublicForm` in `packages/lint/src/validate-internal-form-views.ts`), which is right for its warning and wrong here, because it reads a switched-off public form as internal. The conversion deletes the internal ones and says so per form; their layout belongs to the object's `fieldGroups` (HotCRM's own are objectstack-ai/hotcrm#2739's).
- **A form that declares a `sharing.publicLink` is never internal — switched on or off, in whatever slot.** It is moved with its `sharing` block as written, the switch included, by the conversion and by the ceremony alike. So is a form an action opens. The reason is the kill switch: a body that keeps its link with a switch set to `false` is an explicit withdrawal (`anonymousFormExplicitWithdrawals`), and it is what Setup's switch-off writes for a default-slot form too (the base's whole document with one key changed, `isDefault` included). Deleting such a body deletes the withdrawal. In a package's source the per-package layer would stop closing the form and an open override of the same name would be served; in a stored row the app's own open form would re-open. [Ruled question 4](#q4) forbids that direction, and ADR-0087 D2 admits only a lossless conversion. A form moved out of a record-form slot loses only its record-form role (`isDefault` is not a `form` key, [D2](#d2)), which no surface has read since #36425.
- The translation tails move with them ([D8](#d8)), by a second conversion on `translations`.
- A D3 chain entry for major 19 carries the semantic half; `os migrate meta --from 18` lists the edits and `--write` applies the ones it can prove.

**Stored rows — a ceremony, because the stored pass cannot change a row's type.** `applyConversionsToStoredItem` reads back the collection of the row's own type, so the move from a `view` row to a `form` row is a migration of rows, in the shape ADR-0131 D10 and ADR-0146 D11 set: a CLI ceremony the administrator runs, read-only by default, `--apply` to write, idempotent, reporting per package what it moved and what it could not.

- A stored `view` item with `viewKind: 'form'` becomes a `form` row at the same `(package, name)`; a stored container is split — its lists stay a `view` row, each form becomes a `form` row.
- A **`.custom` override** of a form keeps its package, its name and its `overrides` declaration, `basedOn` unchanged: it is the same override in the type its base now has. This covers every switch Setup has written.
- A **package-less overlay row** over a packaged form (ADR-0146 D11's unmigrated class) is moved to the destination D11 gives it: a declared `form` override in the base's pair, with its switch.
- **Where the pair cannot be ensured, the row is not moved, and it holds the upgrade to major 19 until it is.** The ceremony writes nothing for it. It stays a `view` row, still read by rule 4 and rule 7 of [D6](#d6), so a withdrawal it holds keeps closing. ⛔ It is not moved to a package-less `form` row: `form` takes no environment-overlay tier ([D2](#d2)), and the read path honours an unmigrated package-less row only for a type that has one (ADR-0146 D11). The ceremony's report and the upgrade precheck both name the row (type, name, base) and repeat the ensure door's own refusal (`packages/metadata-protocol/src/protocol-customization-package.ts#customizationPairEnsureRefusal`), with the administrator's action for its cause:
  - **A cause the administrator can remove**: the App declares no usable namespace, a package installed under the pair's id is not the pair, the App's version is not SemVer, or another package owns the pair's namespace. The door's text names the fix. The administrator makes it and runs the ceremony with `--apply` again; the row moves to the pair with its switch.
  - **A base that has no pair in this version**: a kernel package, until the kernel whitelist of ADR-0146 D3 admits it. Measured at `689e5695b98`, this case is empty: no package that ships metadata to a deployment authors a form in any of the three shapes (`git grep -lE "formViews|viewKind: 'form'|viewKind === 'form'" -- packages/platform-objects packages/plugins packages/services packages/triggers packages/drivers packages/connectors packages/apps` finds one `CHANGELOG.md` and no source), so no package-less row overlays a kernel package's form. Card ⑤ takes the reading again before it is cut. If a kernel package ships a named form by then, this record has no way out for the row without a new mechanism, and the case goes to the maintainer as a decision before major 19 opens.
  - ⛔ In neither case does the precheck offer deletion for a row that declares a `sharing.publicLink`, and card ⑤ does not let such a row through: deleting a switched-off form's row is switching the form back on.
- History rows stay verbatim under the type they were written as (ADR-0087: the version layer is not converted); the new row's history starts with the move.
- Internal record forms in stored rows (the set defined above: no `sharing.publicLink`, no action target) are reported and left for the administrator to remove: an item-shaped row is deleted, a container that also holds lists is re-saved without that member. The ceremony deletes nothing it did not move. Removing one is safe: it steers nothing and, having no link, holds no switch. The precheck counts them like any other old-shape form row and names them with that action.
- The ceremony can be run from the release that adds the type. It **must** be run before a deployment moves to major 19: that release's upgrade refuses to proceed while a stored old-shape form row exists — one the ceremony can still move, an internal record form, or a row whose pair cannot be ensured — naming the ceremony, each row, and the action for its class.

**Security pins card ⑤ owes, each with an ablation** (status, `code` and "no record was written" on both doors, as for [D6](#d6)'s):

- **the switched-off form in a record-form slot**: a public form in the container's default `form` slot, link kept and `enabled: false`, whose name is open in another layer. After the source conversion, and after the ceremony on the stored twin (Setup's switch-off override of that form), it is a `form` item with its switch, the internal-forms report does not list it, and both doors still answer `404` (ablate: the `publicLink` test of the internal set — judge "public" by `sharing.enabled === true` — and the form is deleted or left behind with its withdrawal);
- **the ceremony keeps a withdrawal closed**: a form withdrawn before the ceremony — by a `.custom` switch-only override, and by a member of a stored container — answers `404` after it (ablate: the carry of the `sharing` block in the move);
- **the precheck refuses**: a deployment that holds a stored old-shape form row of each class (movable, internal, pair not ensurable) does not reach major 19, and the refusal names the row and its action (ablate: the precheck's read of each class in turn);
- **the kept reader still closes after the tombstone**: on a major-19 build, a stored old-shape body that withdraws a form still closes it (ablate: the exempt reader);
- **the row whose pair cannot be ensured** still closes its form before the upgrade and is never deleted or moved package-less by `--apply` (ablate: the pair-refusal branch of the ceremony).

**The withdrawal reader is exempt from the kit age-out** ([ruled question 4](#q4)). ADR-0087, as amended on 2026-10-26, lets a retired conversion and its tombstone leave the tree one major after they retire. The reader that finds a withdrawal in a stored old-shape body does not follow that clock: it stays as long as such a row can exist, and it is removed only by a release whose upgrade precheck has refused every deployment that still holds one. A withdrawal nobody reads would re-open a form, and that direction is never taken by a clean-up. **This record's own choice, stricter than the ruling:** major 19's upgrade carries such a precheck, so the ruling's words would let the reader leave in major 19. This record keeps it through major 19 — card ⑤ does not remove it — and leaves its removal to a later release with its own precheck ([question 4](#q4) marks the same choice, outside the ruled block).

**After the major**: `ViewSchema` is lists (`list`, `listViews`), `ViewKindSchema` is `list` alone, and `anonymousFormObjectName`'s list rung is gone. The projection serves no content: no `form` read and no `view` read gets an item from it. Its other half stays in the tree with the exempt reader ([D6](#d6) rule 10): the read that finds a withdrawal in a stored old-shape body, and rule 7's closing of a body it cannot read.

### D8 — Translations: a `forms` family, the old form tails as fallback {#d8}

- **The family.** `forms` is a top-level family of the translation bundle, a record keyed by the form's full name, beside `pages` and `dashboards`:
  - `forms.NAME.label`, `.title`, `.description`;
  - `forms.NAME.submitBehavior.title` and `.message`;
  - `forms.NAME.sections.SECTION.label`, `.description`, and `.fields.FIELD.label` / `.placeholder` / `.helpText`.
- **Section copy keeps its object-level default.** A section that has no key under `forms.NAME.sections` reads `objects.OBJECT._sections.SECTION`, as today. That is not a legacy fallback: field groups and forms of one object share section names on purpose, and `_sections` stays live for field groups.
- **The form tails under `_views` are the fallback.** `objects.OBJECT._views.KEY.title` and `.submitBehavior.*` are read when `forms.NAME` has no value for the key, until major 19. `title` and `submitBehavior` are form-only tails, so the conversion that moves them needs no other signal. At the major the two tails are tombstoned on the `_views` shape with the prescription naming `forms.NAME`.
- **`label` and `description` under `_views.KEY` are not form tails, and are neither moved nor read as a fallback.** `ObjectTranslationDataSchema` declares the two keys for any view, a list included, and the extractor emits only `title` and `submitBehavior` for a form. A hand-written `objects.OBJECT._views.KEY.label` of a form therefore stays where it is: the conversion cannot tell it from a list's label by the key alone, and the two keys stay live for lists. `forms.NAME.label` and `.description` are authored under the new family. `os migrate meta` lists such a key as an edit for the author when `KEY` names a form the stack conversion moved, and card ④ re-keys the first-party ones.
- The fallback is one declared read in the translator, not a reader-side `??`: it is the translation half of [D5](#d5)'s projection and retires with it.
- The extractor and the translation lint emit and accept the new family from card ② and stop emitting the old tails for an authored `form` item.

### D9 — Shipped and paused work: kept, re-pointed, or retired {#d9}

| Work | State on `62692b7f8b` | Disposition |
|:--|:--|:--|
| Setup → Configuration → Public forms (#36697) | merged; reads and writes type `view` | **Kept, re-pointed to `form`.** The list read in the page and the six type arguments in `ui/packages/app-shell/src/views/setup/publicForms.ts` (`layered` twice, the two save paths, `reset`, the override save) name `form`; `ui/packages/app-shell/src/views/setup/publicForms.ts#publicFormRowOf` reads the item itself and drops the `viewKind` filter and the `config` hop. Behaviour is unchanged: list every public form, switch, copy address, preview. |
| The designer of PR #36784 (the `publicFormDesign` module and its tests, the `PublicFormsDesigner` component) | open draft, paused at `1f9f234303` | **Kept, re-hosted as the `form` type's editor.** Its rules stay: fillable fields only, an object-required field cannot be removed, the address clash refusal, draft then publish, an installed app's form saved as a declared override. Its input and output move from a view item's `config` to the `form` item. |
| The Form-tab switch PR #36784 adds to `StudioDesignSurface.tsx` | in that PR only; not on `main` | **Not landed.** The object page's field-layout tab stays field groups only (#36505, merged). |
| Studio Developer → Public Forms (`ui/apps/console/src/pages/developer/PublicFormsPage.tsx`, `nav_public_forms` in `packages/platform-objects/src/apps/studio.app.ts`) | on `main` | **Retired** with the card that lands the editor; its route redirects to the `form` list. |
| The lint rules over form views (15 source files under `packages/lint/src`) | on `main` | **Kept**; their walker (`packages/lint/src/view-walk.ts#formViewSites`) reads `form` items and, until the major, the projection. |

**What the generic metadata surface covers, and what stays dedicated.**

- **Generic** (Studio's metadata list and item page, as for every type): the list of an app's forms with its columns row (name, label, object, public address, on or off — the row #36860's list-columns work owes this type), create, delete, Source, layered view, history and rollback, draft and publish, the "customization" and "overrides" marks.
- **Dedicated editor** (the `form` type's one editor, ADR-0146 D1): the designer above with its live preview. A form is not edited through the schema-derived form; the designer is the item's editor.
- **Dedicated, in Setup** (operations, administrators only): the environment-wide list, the on/off switch as a switch-only override, copy address, preview, and switched-off forms staying listed. No field editing, no create, no delete (ruling record 7100386248 items 6 to 10).
- **On the server, for both**: the tenancy intake advisory, the address rules, and `404` for a switched-off form.

### D10 — What this record does to other records {#d10}

- **ADR-0017** is amended: `viewKind` is list-only from major 19 and a form is a `form` item from this record's acceptance. Its container, its item identity and its switcher query are untouched for lists. The dated pointer is on its Status line, with a note at the bullet it governs.
- **ADR-0146 D2** is amended: `form` is in "Which types".
- **ADR-0084** needs no change: its Interface pillar row already reads "app · page · view · form · dashboard · report".
- **ADR-0138** is not changed: D2 row 1's condition and grant stand; [D6](#d6) changes only which metadata type carries the `sharing` declaration.
- **ADR-0150** D1's table has no `form` row. This record places `form` with `view` ([D3](#d3)); [question 2](#q2) is ruled as written, so after this record merges the landing seat adds the row to the open "ADR revisions" card, as for any record a later change makes incomplete.
- **ADR-0088** is applied, not amended ([D1](#d1)).

---

## Execution plan (after acceptance)

Five cards, in this order. ⛔ None lands before this record is accepted. The dev agent that wrote this record files none of them; the owning seat files them from the texts in the card's report.

| # | Card | Lane | `Metadata-protocol:` | Blocked by |
|:--|:--|:--|:--|:--|
| ① | This record (#36868) | `domain:spec`, contract tier | `none` | — |
| ② | Spec and server: the `form` type, its registry and override rows, the `forms` collection and translation family, the projection, `form` reads and writes, the doors and the withdrawal judgement over both types | `domain:spec` with `domain:server` | `added` | ① |
| ③ | Console: re-point Setup's page, land the designer as the `form` editor, re-point `FormPage`, retire the Studio Developer page (closes #36444) | `domain:ui` | `none` | ② |
| ④ | Sources and teaching: move this repository's examples and HotCRM's forms to `forms:`, their translation keys, the skills and docs | `domain:spec` (examples, skills, docs) and HotCRM's lane | `none` | ② and ③ |
| ⑤ | Major 19: tombstone the three old shapes, the two conversions and the chain entry, the stored-row ceremony and the upgrade precheck, `view` reads lists only | `domain:spec` with `domain:server` | `narrowed` | ③ and ④ |

- **② carries four of the five rulings as requirements** ([the questions](#the-five-merge-questions-as-ruled)): the `defineForm` factory with the Studio helper renamed `defineMetadataForm`, after measuring outside use of today's `defineForm` (question 1); the public-address clash refusal at the `form` write door, `os validate` and publish (question 3); the reader of old-shape withdrawals built as exempt from the kit age-out and anchored as such (question 4); the top-level document shape (question 5). Question 2 asks ② for no change: the name is the one served today. ⑤ carries question 4's other half, the upgrade precheck of major 19.
- **② is one releasable change.** It adds and removes nothing an author wrote: `view` reads, old-shape writes and the shipped console behave as before. It owes [D6](#d6)'s pins and ablations, [D5](#d5)'s pin that a `form` write leaves a list row of the same name untouched, the showcase's `examples/app-showcase/src/coverage.ts#KIND_COVERAGE` row (its coverage test holds exact registry membership), and the same-change override row of [D4](#d4). The showcase's one authored `form` item is a new form, not a move of one the console opens today: moving one waits for ③, for the reason in the ④ bullet below.
- **③ carries PR #36784's work.** #36444 stays paused until ③ is filed and then carries `Blocked-by:` ③. #36505 is closed (merged as `5c2d5cf2c4`); the public-forms part of its item 4 is superseded by this record and needs no card.
- **④ runs after ③, not beside it.** [D5](#d5) freezes `view` reads to the old shapes, and until ③ lands the shipped console reads forms from `view`: `ui/apps/console/src/components/FormPage.tsx` reads `GET /api/v1/meta/view/:name`, and Setup's page lists type `view`. A first-party form moved to `forms:` before ③ would answer not found when its action opens it and would drop out of Setup's list, which takes its switch out of the administrator's reach. So ④ carries `Blocked-by:` ③ as well as ②, in both of its halves (HotCRM's waits for a release that carries both). After ④ no first-party source authors an old shape, which is what lets ⑤ measure "zero first-party" before it tombstones.
- **⑤ is cut only when the maintainer opens major 19.** It is the one card with a breaking banner, an ADR-0087 disposition and a migration in its changeset.

---

## The five merge questions, as ruled

The ruling this record executes is silent on five points. This record decided each with a default and put it to the maintainer, analysed on the four fixed axes: the real business need, long-term soundness, how hard it is for an AI author to get wrong, and not spreading scope at this stage.

**Ruled, all five, on 2026-11-24: option A on each.** The maintainer's words, verbatim: 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」. Ruling record [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) on #36868 records them against the presentation of the five questions in dev report [`7129798720`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7129798720). Each section below keeps its options and its four-axis table as the record of what was weighed, and ends with its ruling, what the ruling asks of the cards, and its `Ruling-ref:`. ⛔ None of the five is open any more: changing one is a new decision (Prime Directive 13), not an objection at merge.

### 1. The factory name: `defineForm` is taken {#q1}

`defineForm` is a published export that builds a schema-bound Studio metadata form. The new type needs a factory, and `define` + the type name is the pattern every type follows (`defineView`, `defineFlow`, `defineApp`).

- **A — `defineForm` becomes the `form` type's factory; the Studio one is renamed `defineMetadataForm`, both in card ②** (ruled). A published export changes meaning: a compiler-carried break (ADR-0087 D9's category), declared in card ②'s changeset.
- **B — the new factory takes a new name (`defineFormItem`); `defineForm` is untouched.** No break.
- **C — no factory in card ②**; authors write `forms: [{ … }]` entries typed by the schema, and the name is decided later.

| Axis | A | B | C |
|:--|:--|:--|:--|
| Business need | App authors need one obvious way to declare a public form. Measured users of today's `defineForm`: 17 modules in `packages/spec/src` and one file under `ui/`; use outside this repository was not measured | Same need met under a second-best name | Need met without a typed helper |
| Long-term soundness | `define` + type name holds for every type; the Studio helper's new name matches its translation family, `metadataForms` | The obvious name permanently builds something else | Defers the collision; it returns with the first helper |
| AI-author error | An AI that guesses `defineForm({ name, object, … })` is right. An old caller fails to compile and fails to parse: loud | The guess fails loudly (`schemaId` is required), then the AI must find the other name | No wrong name to guess; no compile-time help either |
| Scope now | One rename across 18 files plus a declared export change | Smallest | Smallest |

**Correction to the table as put** (counted at `689e5695b98`; the table stays as the record of what the maintainer was shown). "One file under `ui/`" is a test that names the helper in a comment and does not call it. "One rename across 18 files" undercounts: 41 code files name `defineForm`, listed under "For the cards" below. The premise the ruling rests on does not move: all 41 are first-party uses, and use outside this repository is still card ②'s to measure first.

Recommendation, as put: **A**. The long-term name leads; its cost is a loud, one-time, compiler-carried break in a helper measured as platform-internal.

**Ruled: A.** `defineForm` is the `form` type's factory. The existing Studio schema-bound metadata-form helper is renamed `defineMetadataForm`. Both land in card ②, as a declared compiler-carried export break.

- **For the cards.** Card ② owns the factory and the rename, and its changeset declares the export change with the FROM and TO mapping. Its scope is counted from the tree, not taken from the table above. At `689e5695b98`, `git grep -lw defineForm` names 60 files, 41 of them code (`.ts`, `.tsx`, `.mjs`):
  - 17 `*.form.ts` modules under `packages/spec/src` that import and call it. They also take the new suffix ([D2](#d2));
  - 3 that declare, export or build around it: `packages/spec/src/ui/view.zod.ts`, `packages/spec/src/index.ts`, and `packages/spec/tsup.config.ts`, whose pure-constructor set names it (the renamed helper joins that set);
  - 4 tests: 3 under `packages/spec` that call it, and 1 under `packages/lint` that names it in a test title;
  - 17 that name it only in a comment: 10 tests (9 under `packages/spec` and `packages/lint`, 1 under `ui/`) and 7 sources (3 under `packages/lint/src`, 2 under `packages/spec/src/system`, `packages/cli/src/utils/config.ts`, `scripts/i18n-bundle-surface.mjs`);
  - the other 19 are not code: 6 generated outputs card ② regenerates (the `packages/spec` API-surface and export-origin snapshots, the generated reference page), 9 released or historical texts it does not edit (seven `CHANGELOG.md`, a released notes page, an audit), and 4 hand-written (two `packages/spec/liveness/` files, one internal skill under `.claude/`, which is a governed path, and this record).
  - Card ② counts again at its own head and reports the count in its PR.
- **The premise, measured before card ② lands.** The ruling rests on outside use of today's `defineForm` being platform-internal. Card ② measures it first. If outside use is found, card ② falls back to a new factory name and ⛔ never to a dual-meaning overload, and **that fallback returns to the maintainer for a word** before it is built: it is not the dev's or the seat's to take.

Ruling-ref: [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) — the maintainer, 2026-11-24, 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」

### 2. The name: `OBJECT.KEY`, or a short name addressed by package {#q2}

- **A — keep `OBJECT.KEY`, ADR-0150 bucket 1 with `view`** (ruled, [D3](#d3)).
- **B — a short name (`web_to_lead`) addressed by (package, name), ADR-0150 bucket 2 with `page`.**

| Axis | A | B |
|:--|:--|:--|
| Business need | Every served name, action target, deep link and stored override keeps working; measured consumers address forms by this string today | No consumer asks for a short name |
| Long-term soundness | A form is bound to one object for life; the prefix states it, as for a view. One more object-derived type in bucket 1 | Matches the presentation tier's direction, but needs the bucket-2 resolver, an address grammar for `/forms/…` and a package column on action targets |
| AI-author error | The prefix-equals-`object` check refuses a mismatch at parse | A bare short name is ambiguous across packages until resolved |
| Scope now | No rename, no reference rewrite; the withdrawal identity carries over untouched | Renames every form and rewrites every reference inside a security-sensitive migration |

Recommendation, as put: **A**. B's one advantage has no measured pull, and B moves the identity the kill switch matches on.

**Ruled: A.** A `form` item keeps the `OBJECT.KEY` name, in ADR-0150 bucket 1 with `view`. There is no rename: action targets, deep links, stored overrides and the withdrawal identity keep working.

- **For the cards.** No card renames a form or rewrites a reference to one. Card ② enforces the prefix-equals-`object` check of [D3](#d3); the migration of card ⑤ moves each form under the name it is served as today. The ADR-0150 D1 row for `form` is the landing seat's entry on the open "ADR revisions" card ([D10](#d10)).

Ruling-ref: [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) — the maintainer, 2026-11-24, 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」

### 3. Two forms on one public address {#q3}

Today nothing server-side refuses it; the first candidate in list order is served.

- **A — the `form` write door, `os validate` and publish refuse a `form` whose open `publicLink` slug another form in the environment already holds** (ruled). A new refusal, on the new type only; old-shape writes keep today's behaviour until they retire.
- **B — keep first-match; the designer's client-side check is the only guard.**

| Axis | A | B |
|:--|:--|:--|
| Business need | Ruling record 7100386248 asks for "the public address (unique, refused with a clear message on a clash)"; today only a UI enforces it | Leaves the API, the CLI and an AI author unguarded |
| Long-term soundness | The address is a public identity; an identity is unique at the door that stores it | Which form answers an address depends on list order |
| AI-author error | A clash is refused with both names | A second form on a taken slug saves clean and is silently never served, or silently takes over |
| Scope now | One check at one door, and one lint rule | None |

Recommendation, as put: **A**. It is a refusal on a new type, so it narrows nothing an author has today.

**Ruled: A.** The `form` write door, `os validate` and publish refuse a form whose open slug another form already holds. It is a refusal on the new type only; nothing an author has today narrows.

- **For the cards.** Card ② builds the refusal at all three places, naming both forms. Old-shape writes keep today's first-match behaviour until card ⑤ retires them; the designer's client-side check (card ③) stays as the early message and is no longer the only guard.
- **What "holds" means** (this record's reading, the fail-closed one; the ruling's words do not spell it). A form holds an address while its `sharing.publicLink` names it, switched on or off. A switched-off form that keeps its link still holds its address, so another form cannot be saved open on it; a form gives an address up by clearing or changing its link. The refusal is judged at every `form` save that leaves the form open, Setup's switch included, and it names both forms, so the way out is always in the message. Card ② pins the switched-off holder (a `form` saved open on the address of a switched-off form is refused; ablate: the switched-off half of the holder read).

Ruling-ref: [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) — the maintainer, 2026-11-24, 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」

### 4. The withdrawal reader is exempt from the retirement-kit age-out {#q4}

ADR-0087 (amended 2026-10-26) removes a retired conversion one major after it retires. Applied here without exception, a stored old-shape body that withdraws a form would stop being read two majors on, and the form would re-open.

- **A — the reader of old-shape withdrawals is exempt: it leaves only by a release whose upgrade precheck refuses a deployment that still holds an old-shape form row** (ruled, [D7](#d7)); and major 19's own upgrade carries that precheck.
- **B — no exemption: the ceremony is documented as required, and the reader ages out on ADR-0087's clock.**

| Axis | A | B |
|:--|:--|:--|
| Business need | An administrator who switched a public form off expects it to stay off across upgrades | Relies on every operator having run a ceremony |
| Long-term soundness | A security kill switch is never removed by a clean-up schedule; the precheck makes the removal provable | One uniform rule, at the price of a fail-open path |
| AI-author error | Not an authoring surface | Not an authoring surface |
| Scope now | One precheck and a reader kept longer | None |

Recommendation, as put: **A**. This is a permission boundary, so it is put to the maintainer by name and not left as a reading of ADR-0087.

**Ruled: A** — a permission boundary, ruled by the maintainer by name. The reader of old-shape withdrawals is **exempt from ADR-0087's kit age-out**. It leaves only by a release whose upgrade precheck refuses a deployment still holding an old-shape form row; protocol major 19's upgrade carries that precheck. No withdrawn public form may re-open.

- **For the cards.** Card ② builds the reader inside the two-type withdrawal layer ([D6](#d6)) and marks it exempt where it lives: this record's id in the code and an anchor in `scripts/adr-anchors/`, so a later kit clean-up finds the exemption before it finds the reader. The anchor is this record's mechanism for the cards, not the ruling's words. Card ⑤ carries major 19's upgrade precheck with its security pins ([D7](#d7)).
- **Scope of the exemption.** It is this one reader. ADR-0087's age-out stands as amended for every other retired conversion and tombstone, the rest of this record's kit included.

Ruling-ref: [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) — the maintainer, 2026-11-24, 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」

**This record's own narrowing on question 4, not the ruling's words.** The ruling lets the reader leave "by a release whose upgrade precheck refuses a deployment still holding an old-shape form row", and major 19 is such a release: by the ruling alone, card ⑤ could remove the reader. This record does not take that leave ([D7](#d7)). Card ⑤ keeps the reader when it tombstones the old shapes, and removing it is neither card's work: it is a later release with its own precheck, and a new decision. The choice only narrows — the reader stays longer and nothing is licensed. It stands outside the ruled block so it is read as this record's, which the maintainer accepts with the record or strikes.

### 5. The document shape: body at the top level, or under `config` {#q5}

- **A — `name`, `object` and the body keys at the top level** (ruled, [D2](#d2)).
- **B — `{ name, object, config: FormView }`, the view item's shape without `viewKind`.**

| Axis | A | B |
|:--|:--|:--|
| Business need | The ruling says body = today's form view schema | Same content |
| Long-term soundness | The type is the discriminator, so the wrapper has no job left; one level for authors, overrides and diffs | Keeps a wrapper whose reason (two kinds in one type) is gone |
| AI-author error | No `config` to forget or misspell; an unknown top-level key is refused by name. The view item's history records `confg` parsing clean before it was closed | One more nesting level to get wrong |
| Scope now | The projection and the designer's read and write adapt once | The designer's code is closer to as written |

Recommendation, as put: **A**.

**Ruled: A.** The `form` document carries `name`, `object` and the form body keys at the top level. There is no `config` wrapper.

- **For the cards.** Card ② declares `FormSchema` in that shape ([D2](#d2)) and the projection of [D5](#d5) lifts an old-shape `config` to the top level; card ③'s designer reads and writes the item itself; card ⑤'s conversion and ceremony write the same shape.

Ruling-ref: [`7131569242`](https://github.com/objectstack-ai/objectstack/issues/36868#issuecomment-7131569242) — the maintainer, 2026-11-24, 「表单拆成独立 form 元数据类型的 5 个合并问题 都同意」

---

## Consequences

- **Authors and AI authors** get one place for a form (`forms:`) and one for lists (`views:`). A public form no longer hides inside a list container, and its object is a key on the form.
- **`view` gets simpler in major 19**: one kind, two container members.
- **Until major 19 there are two readers of form content** (the type and the projection). The cost is bounded by the rule that the projection is the only reader of the old shapes.
- **The anonymous doors read two types for at least one major.** [D6](#d6)'s pins are the price; a withdrawal is honoured in both.
- **A deployment must run a ceremony before major 19**, and that upgrade refuses without it. A stored row whose customization pair cannot be ensured holds the upgrade until the administrator removes the cause the precheck names ([D7](#d7)).
- **`defineForm` changes meaning** in card ② ([ruled question 1](#q1)): a declared, compiler-carried export break, on the premise that its outside use is platform-internal. The 17 Studio form modules change file suffix in the same card ([D2](#d2), the seat's routing).
- **First-party work**: about 100 non-test source files and about 160 test files name the old shapes; they move in ②, ③ and ④ and the remainder falls to ⑤.

## Alternatives considered

- **Keep forms in `view` and retire only the container shape.** On the decision card; not taken by the maintainer.
- **Keep everything as is.** On the decision card; not taken.
- **A separate `public_form` type, leaving action-opened forms in `view`.** Not taken: two types for one schema, and ruling item 1 names both consumers as `form` content.
- **Tombstone the old shapes in a minor.** Not taken: the card fixes the tombstone to a major, and HotCRM and stored rows carry the shapes today.
- **Migrate stored rows through the read-seam conversion pass.** Not possible: that pass cannot change a row's type ([Context](#loading-overriding-translating)).
- **Make the record create and edit form a `form` item with a default role.** Refused by ruling item 3.

## Readings, re-taken at `62692b7f8b`

The card cites positions read at `14f4d8f8`. Each was read again. The numbers below are a dated reading for the card, not anchors; the decision text above cites symbols.

| The card's citation | On `62692b7f8b` |
|:--|:--|
| `view.zod.ts` `FormViewSchema` near 5329 | moved: declared at line 5411 |
| `view.zod.ts` container `ViewSchema` near 5889 | moved: 5971 |
| `view.zod.ts` item and overlay arms, 6368 to 6900 | moved: `ViewKindSchema` 6168, the arm shape 6324, `ViewItemSchema` 6450, `ViewItemWireSchema` 6650 |
| `view.zod.ts` lines 2186 to 2194, `addRecord.formView` retired | moved: the tombstone text at 2191, the key at 2224 |
| `recordFormNavigation.ts` lines 141 to 150 | holds |
| `action.zod.ts` lines 693 and 719 | holds |
| `form-routes.ts` lines 236 to 260, the slug resolution | holds at 236; it now runs to 271 |
| `anonymous-form-intake.ts` lines 103 to 121, the candidates | moved slightly: 101 to 121 |
| `protocol.ts` line 2169, the intake posture note | moved: 2171 |
| `protocol-save.ts` lines 175 to 195, the container collision judgement | moved: the function starts at 205; its docblock covers the cited lines |
| `customization-package.ts` line 319, `view: listed` | holds |
| `MetadataProvider.tsx` lines 654 and 655 | holds (655) |
| `app.zod.ts` line 502, `viewName` | holds |
| `packages/metadata-core/src/anonymous-form-intake.ts` as the home of the candidates rule | moved before the card: the rule lives in `packages/spec/src/ui/anonymous-form-intake.ts`; `metadata-core` re-exports it |
| "about 10 call sites in `publicForms.ts`" | counted: six type arguments in that module and one list read in the page |
| "the Form-tab switch in `StudioDesignSurface.tsx`" | not on `main`: it exists only in PR #36784 |
| #36505 "items 1–3 + 5 continue" | #36505 is closed, merged as `5c2d5cf2c4` |
| "~15 form-view rule files" | 15 non-test files under `packages/lint/src` name the shapes |

## Refs

- Card: [#36868](https://github.com/objectstack-ai/objectstack/issues/36868). Paused work: [#36444](https://github.com/objectstack-ai/objectstack/issues/36444), PR [#36784](https://github.com/objectstack-ai/objectstack/pull/36784). Merged: PR [#36697](https://github.com/objectstack-ai/objectstack/pull/36697), [#36505](https://github.com/objectstack-ai/objectstack/issues/36505), [#36425](https://github.com/objectstack-ai/objectstack/issues/36425).
- Ruling records: `7123091354`, `7123091586`, `7122924165`, `7118881549`, `7100386248`; on #36868, `7131569242` (the five merge questions, all option A).
- Review records on PR #36957 at head `352579004f9`, both folded by one patch round: contract review [`7132189584`](https://github.com/objectstack-ai/objectstack/pull/36957#issuecomment-7132189584) and seat record [`7132202077`](https://github.com/objectstack-ai/objectstack/pull/36957#issuecomment-7132202077).
- Touching cards named by #36868: #36797 and #36798 (Studio rail and docs on named default and create forms — re-read against [D1](#d1)), #36860 (the metadata list columns row, [D9](#d9)).
