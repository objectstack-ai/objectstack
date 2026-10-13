---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
'@objectstack/platform-objects': patch
---

feat(spec)!: at most one `isDefault: true` record page per object per deployment — a second is refused at `defineStack` / `os validate`, at package registration and at metadata save, naming both pages (#23015)

Clause-②: yes (narrowing)

<!-- adr-0087: registered page-default-record-page-one-per-object-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for breaking changes.

`PageSchema.isDefault` now states the rule (maintainer ruling A on #23015): at most one `isDefault: true` record page may exist for an object in a deployment. The record view opens that page with no tie-break, so with two defaults for one object the page that opened used to be whichever plugin initialised first — an accident no author wrote. A record page is `type: 'record'` (the default when `type` is left out) bound to an `object`; `isDefault` on any other page is outside the rule.

**What is refused, and where.** Every door that can add a second default refuses it, naming both pages:

- **`defineStack`** (and so `objectstack validate`, `objectstack build` and a source boot) — two default record pages for one object inside one stack, `STACK_CROSS_REFERENCE_INVALID` (422), one finding per object naming the object, every page and its position (`stack.pages[0]`). **`composeStacks`** refuses the pair across the stacks it composes, in the same envelope; under `manifest: 'preserve'` one page name in two stacks is two packages' pages.
- **Package registration** (`@objectstack/objectql`'s `SchemaRegistry`, at `installPackage` ahead of every mutation and at the `registerItem` seam) — a package whose default record page meets another package's default for the same object, an environment's stored default, or a second default in its own manifest, `DEFAULT_RECORD_PAGE_CONFLICT` (422, exported as `DEFAULT_RECORD_PAGE_CONFLICT_CODE`). Two packages' pages under one name are two pages and are refused too. `OS_METADATA_COLLISION=warn` does not soften it.
- **Metadata save** (`@objectstack/metadata-protocol`'s `saveMetaItem`, so `PUT /api/v1/meta/page/:name`) — a page saved as the default record page of an object a stored page or a packaged page already holds, `DEFAULT_RECORD_PAGE_CONFLICT` (422), in draft and publish mode, before anything is written.

**Unchanged.** A save under the existing default's own name is that page (an ADR-0005 overlay by name), not a second default. One default per object, a second record page that is not a default, and two objects with one default each are accepted. The same package registering again — a reload, or an upgrade that moves its default to another of its pages — is one holder. A save under the name of a page a package ships is still answered by the packaged-base refusal (`NOT_OVERRIDABLE`, 403), as before. A stored page reaching the registry from `sys_metadata` (hydration, write-through) is not refused again.

## FROM → TO

| door | FROM | TO |
|:--|:--|:--|
| `defineStack` / `objectstack validate` | `pages: [{ name: 'account_a', type: 'record', object: 'crm_account', isDefault: true }, { name: 'account_b', type: 'record', object: 'crm_account', isDefault: true }]` accepted; the boot kept both and the record view opened whichever registered first | refused, `STACK_CROSS_REFERENCE_INVALID` 422 — set `isDefault: false` on all but one |
| `composeStacks` | two stacks each shipping a default record page for one object composed clean | refused in the cross-reference envelope, naming both stacks' pages |
| package registration | a second package (or a plugin's `manifest.register`) shipping a default record page for an object another package holds registered; init order decided the page | refused, `DEFAULT_RECORD_PAGE_CONFLICT` 422, naming both pages; keep one default, or compose the deployment without the package that ships the other |
| metadata save | `PUT /api/v1/meta/page/my_page` with `isDefault: true` for an object that already has a default record page stored or shipped saved | refused, `DEFAULT_RECORD_PAGE_CONFLICT` 422, naming both pages; save it with `isDefault: false`, or first demote the stored default |

**The one-line fix: keep `isDefault: true` on the one record page per object that should open the record view, and set `isDefault: false` on every other.** To replace a page a package ships, compose the deployment without that package's page; shipping a second default is not an override path.

No D2 conversion rewrites it: which page stays the default is the author's call. Its D3 record is the semantic entry `page-default-record-page-one-per-object-refused` (protocol 18).

**`@objectstack/spec`.** `defaultRecordPageObject(page)` (exported from `@objectstack/spec/ui`) is the one reading of "which object is this page the default record page of" that the three doors share. `PageSchema.isDefault` gains its `.describe()`. `DEFAULT_RECORD_PAGE_CONFLICT` joins the error-code ledger under `@objectstack/objectql` and `@objectstack/metadata-protocol`.

**`@objectstack/objectql`.** The registration refusal, `SchemaRegistry.defaultRecordPageHoldersOf(object)` (every page holding the object's default — the reading the save door meets with the stored pages) and the `DEFAULT_RECORD_PAGE_CONFLICT_CODE` constant.

**`@objectstack/metadata-protocol`.** The save-door refusal.

**`@objectstack/platform-objects`.** The page form's `isDefault` help text, which said "Set as default page for this page type" — a rule nothing enforced — now states the one-default-per-object rule, in all four locales.

**Who is affected, measured.** In this repository every object with a default record page has exactly one: `sys_organization` and `sys_user` (`@objectstack/plugin-auth`), `sys_position` (`@objectstack/plugin-security`), `sys_approval_request` (`@objectstack/plugin-approvals`), and `showcase_project`, `showcase_task` and `showcase_preference` (`examples/app-showcase`). A deployment that also composes a package shipping its own default record page for one of those objects is refused at boot until one of the two pages stops being a default.
