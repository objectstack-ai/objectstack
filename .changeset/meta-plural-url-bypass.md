---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol,spec): the plural `/meta` URL stops walking around the two-tier registry gate (#7894)

`canonicalMetaType` — the ONE canonical spelling of a metadata type at the `/meta`
read/write/delete boundary (#4432) — folded plural to singular through
`PLURAL_TO_SINGULAR`. That map is a MANIFEST-COLLECTION map: its keys are the
properties an author writes in `defineStack()` (`objects: [...]`, `apps: [...]`),
and `kernel/metadata-authoring-lint.ts` iterates it to decide which stack-level
collections exist.

Four registry types are legitimately absent from it, because none of them is a
stack collection: `field` (fields live inside `ObjectSchema.fields`), `seed`,
`external_catalog` and `translation`. At the URL boundary that absence did not
read as "not a collection" — it read as "unknown type", and an unknown type takes
the PLUGIN-REGISTERED path, which every authorization gate is permissive toward by
construction: `isRuntimeCreateAllowed` synthesises `allowRuntimeCreate: true`,
`orgScopedWriteRefusal` returns `null` for anything with no static registry entry,
and `SysMetadataRepository.assertAllowed` returns early.

So, measured on a booted showcase with an admin bearer:

    PUT /api/v1/meta/field/showcase_task.title    403 NOT_OVERRIDABLE
    PUT /api/v1/meta/fields/showcase_task.title   200  "Saved fields '...'"

The plural URL was a door around the singular URL's lock, and the row persisted
under `type='fields'` — a second namespace for the same item, which is the defect
class #4432 was filed about. `field` was exploitable today; `seed` and
`external_catalog` were structurally exposed.

**The fix splits the two roles.** A new `META_URL_TO_SINGULAR` in
`@objectstack/spec/shared` is the URL-spelling contract, DERIVED from
`DEFAULT_METADATA_TYPE_REGISTRY` (Prime Directive #8) and unioned with every
existing manifest spelling, so:

- a newly DECLARED metadata type arrives with its URL spelling already mapped and
  can never again fall through to the plugin path — hand-adding the four missing
  keys would have fixed only today's four;
- no spelling that resolved before resolves differently now, including the six
  that name plugin-registered kinds with no registry entry at all (`themes`,
  `webhooks`, `connectors`, `sharingRules`, `ragPipelines`, `analyticsCubes`) and
  the camelCase forms (`emailTemplates`);
- `external_catalog` and `email_template` become addressable in snake plural
  (`external_catalogs`, `email_templates`) as well as camelCase.

`PLURAL_TO_SINGULAR` is left untouched, so the authoring lint gains no `fields:`
collection — a top-level `fields: [...]` does not exist and would collide
conceptually with `ObjectSchema.fields`.

The boundary also stops forwarding a spelling it cannot honour. An unrecognised
plural of a DECLARED type (`/meta/capabilitys`) is now refused with
`INVALID_REQUEST` / `400`, naming both the offending spelling and the canonical
one, instead of answering 200 and minting a namespace under the typo. The rule is
deliberately static — it fires only when a spelling's singular is a type the
platform itself declares — so a plugin-registered runtime kind can never trip it,
whatever it is named and whenever it registers.

Behaviour change to be aware of when upgrading: `PUT`/`DELETE` against
`/meta/fields/...`, `/meta/seeds/...`, `/meta/translations/...` and
`/meta/external_catalogs/...` are now judged by the singular type's contract —
authorization gates AND its Zod schema. A call that previously succeeded because
the spelling was unknown may now be correctly refused. Rows already written under
a plural `type` are real and are not rewritten on upgrade (reads of data at rest
already try the other spelling).
