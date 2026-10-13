---
'@objectstack/spec': minor
'@objectstack/metadata': patch
---

feat(spec)!: `defineStack` refuses two entries of one named collection under one identity, naming the collection, the identity and every index — for 27 collections (#22934)

Clause-②: no (narrowing)

<!-- adr-0087: registered stack-collection-duplicate-entry-refused -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for breaking changes.

The runtime registers the entries of these collections under one identity each, and a stack could author two entries under one identity with nothing refusing it: `defineStack` and `objectstack validate` accepted the pair (exit 0, `valid: true`, no finding naming it). Measured on a source boot (`objectstack serve`, no build) and on `objectstack build` followed by an artifact-backed boot:

- `objects`, `pages`, `dashboards`, `reports`, `datasets`, `flows`, `jobs`, `emailTemplates`, `books`, `positions`, `permissions`, `capabilities`, `sharingRules`, `webhooks`, `mappings`, `analyticsCubes`, `connectors`, `picklists`, `tools`, `skills`, `views`, `apis`, `apps` and `objectExtensions` kept only the LAST entry on both paths, with no notice at the default log level (for `apis`, the first entry's path answered 404);
- `datasources`: the metadata described the last entry while the driver connected with the first one's configuration;
- `hooks`: the metadata listed one hook while both handlers were bound and ran;
- `docs`: `objectstack validate` and `objectstack build` refused the pair (`docs/duplicate-name`), while a source boot kept the last.

**What is refused.** `defineStack`'s cross-reference pass refuses the stack with its existing envelope (`STACK_CROSS_REFERENCE_INVALID`, status 422, `defineStack cross-reference validation failed (N issues):`), one finding per collision, naming the collection, the identity and every index:

```text
✗ Datasource 'crm_external' is declared twice in `datasources`: stack.datasources[0] and stack.datasources[1]. …
```

The identity is what the runtime keys an entry by: its `name`; the `(name, locale)` pair for `emailTemplates` (one name across several locales is an i18n bundle, and an entry with no `locale` counts as `en-US`); the extended object (`extend`) for `objectExtensions`; and for `views` the object a container binds to (`object`, else `list.data.object`, else `form.data.object`, else its `name`). The check runs in an object-less stack too, and every entry counts, byte-identical twins included. `objectstack validate`, `objectstack build` and a source boot all load the config through `defineStack`, so all three refuse it at load. Like every cross-reference check it is skipped under `defineStack(…, { strict: false })`. On an `app` package, two apps under one name now get this refusal, which runs before the single-app count.

**Unchanged.** Distinct identities; an email-template i18n bundle (one name, one entry per locale); the map form under distinct keys (two keys whose entries spell one explicit `name` are one identity, and are refused); the same name reused by another package of a multi-package project (`composeStacks(…, { manifest: 'preserve' })` keeps each package's collections in its own `packages[i]` body, which this check does not read); `plugins` (last-one-wins with a warning is the kernel's declared contract), `agents` (withdrawn for app packages) and `picklistExtensions` (merged by option value); and the existing `actions` and `functions` refusals.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `pages: [{ name: 'home', … }, { name: 'home', … }]` (any of the 24 name-keyed collections) | one entry per name: rename one (`home_admin`) and every reference that meant it, or merge the two into one entry |
| `emailTemplates: [{ name: 'acme.welcome', … }, { name: 'acme.welcome', locale: 'en-US', … }]` | one entry per name and locale: give the second its own `locale` (`zh-CN`), or merge the two |
| `datasources: [{ name: 'ext', config: a }, { name: 'ext', config: b }]` | one datasource per name — the driver used to connect `a` while the metadata described `b` |
| `hooks: [{ name: 'audit', object: 'a', … }, { name: 'audit', object: 'b', … }]` | one hook with `object: ['a', 'b']`, or two hooks with two names |
| `apis: [{ name: 'feed', path: '/api/v1/apps/x/a' }, { name: 'feed', path: '/api/v1/apps/x/b' }]` | give each endpoint its own name |
| `views: [defineView({ object: 'task', list }), defineView({ object: 'task', form })]` | one container per object: `defineView({ object: 'task', list, form })` (named views go in `listViews` / `formViews`) |
| `objectExtensions: [{ extend: 'task', fields: { a } }, { extend: 'task', fields: { b } }]` | one extension per target: `{ extend: 'task', fields: { a, b } }` |

**The one-line fix: give each entry of a collection its own identity, or merge the duplicates into one entry.**

No D2 conversion rewrites it: which entry keeps the identity, and what the other one becomes, is the author's call. Its D3 record is the semantic entry `stack-collection-duplicate-entry-refused` (protocol 18).

**`@objectstack/metadata`.** `deriveViewContainerObject` — the "which object does a `views` container bind to" derivation the registrars file containers by — moved into `@objectstack/spec` (exported from its root and `./ui`), because the stack contract now judges the same slot. `@objectstack/metadata` re-exports that one declaration under the same name, from its root and from `@objectstack/metadata/view-container`; behaviour is unchanged. That subpath used to import nothing and now loads the `@objectstack/spec` root entry, which every in-repo importer of it already loads.

**Who is affected, measured.** The four example apps (`examples/app-crm`, `app-todo`, `app-showcase`, `app-multi-package`) carry no duplicate under these identities. Deployed metadata and other repositories were not measured.
