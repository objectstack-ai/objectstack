# @objectstack/metadata-core

## 17.0.0

### Major Changes

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- c7e7900: fix(metadata-core,metadata-fs): hash the serialized form, so `put().version` identifies the bytes actually stored (#7856)

  `hashSpec` canonicalised a `Date` to `{}`, because `canonicalize` walked a
  value's own enumerable keys and a `Date` has none. `JSON.stringify` — what every
  repository actually writes — turns the same `Date` into an ISO string. So the
  hash of the in-memory spec and the hash of the bytes on disk were **different
  hashes for the same item**, and the version handed back to a caller did not
  identify what had been stored.

  Measured on `main`, one spec carrying one `Date`:

  ```
  canonicalize(in-memory) : {"createdAt":{},"label":"Home"}
  JSON.stringify (bytes)  : {"label":"Home","createdAt":"2024-01-01T00:00:00.000Z"}
  ```

  `canonicalize` now honours `toJSON` exactly as `JSON.stringify` does —
  consulted once per position, its result serialised as-is and never
  re-consulted — which makes a new guarantee true by construction:

  ```
  canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
  ```

  **Both repository implementations were wrong, in different places**, which is
  why the fix is one function rather than two patches. `FileSystemRepository`
  broke `put().version === get().hash`: it hashed the spec it was handed, wrote
  `JSON.stringify` of it, and re-hashed the parse on the way back out.
  `InMemoryRepository` broke the repository contract's invariant 4
  (`item.hash === hashSpec(item.body)`): it stores `body` already serialised
  (`clonePlain`) while hashing the in-memory spec, so the item it returns
  disagreed with its own hash. `SysMetadataRepository` inherits the fix through
  the same function.

  Downstream, an incoherent version meant a repository could report an
  `{op:'update', actor:'fs'}` for a file nothing outside the process had touched:
  the head index held a hash the disk could never reproduce, so re-reading one's
  own write looked like somebody else's edit. That surfaces without any watcher —
  a restart rebuilds the index from disk and the version the caller was handed no
  longer matches it.

  **Ordinary specs hash exactly as before, and this is not a migration.** The new
  path diverges only at a position carrying a callable `toJSON`; a graph without
  one is byte-identical through `canonicalize`. Verified against this repository's
  entire checked-in JSON corpus — 1973 files hashed under both the old and the new
  implementation, **0 hashes changed** — and the `hashSpec({})` regression guard
  in `metadata-core` is unmoved. Stored versions for ordinary specs keep their
  meaning. Versions for `toJSON`-carrying specs do change, and those are exactly
  the versions that never identified their stored bytes in the first place.

  Also supported as a consequence: a class instance with a `toJSON` now hashes as
  whatever it serialises to, rather than as its private fields. One without a
  `toJSON` still hashes as its own enumerable keys — which is what
  `JSON.stringify` writes for it.

  The pin is table-driven and lives in the shared repository contract suite, so
  every `MetadataRepository` implementation is held to it: `Date` at a key, `Date`
  under an array index, a class whose `toJSON` yields a string, an object literal
  carrying its own `toJSON`, a nested case, and a plain-JSON control row that
  proves the fix did not simply change every hash.

- 3670cf9: feat(metadata-core, objectql): machine-readable provenance for injected system columns — one authoritative answer to "is this column actually provisioned by the platform?" (#7865)

  `applySystemFields` injects the platform anchors (`organization_id`,
  `owner_id`, `owning_business_unit_id`, the audit family) into every object that
  has not opted out — **including federated ones** (ADR-0015 `external`), for
  which the platform provisions no storage: `Engine.syncObjectSchema` returns
  early and issues no DDL. On such an object those anchors exist in the
  registered schema and nowhere else, and a predicate over one degrades silently
  on SQLite (unresolvable identifier → string literal → constant-false: HTTP 200,
  zero rows, no error). Three consumers had independently re-derived that fact
  (engine `DriverOptions.tenantId` withholding, plugin-security's Layer-0 phantom
  guard, plugin-sharing's proposed `owner_id` twin).

  Per the 2026-08-12 maintainer ruling (direction B), the injection keeps running
  and the injected anchors now carry a machine-readable provenance marker, spelled
  as an exported derivation in `@objectstack/metadata-core` (re-exported by
  `@objectstack/objectql`, the injecting registry):

  - `platformProvisionsStorage(def)` — `false` exactly for ADR-0015 `external`
    objects (the same predicate `syncObjectSchema` routes by, exported once).
  - `resolveInjectedColumnProvenance(def, column)` —
    `'author' | 'injected-provisioned' | 'injected-unprovisioned' | 'absent'`;
    `'injected-unprovisioned'` is the marker: the platform's own injected anchor
    with no storage behind it.
  - `unprovisionedInjectedColumns(def)` — the enumerable form.

  The marker is deliberately **not** a `provisioned: false` key on the field
  definitions: `FieldSchema` is strict (an undeclared key would stamp
  `_diagnostics: { valid: false }` on every served federated object, and
  declaring it would hand authors a forgeable switch over their own tenant wall),
  and the anchor definitions are read by exact identity in the #4326 round-trip
  strip and plugin-security's Layer-0 guard — a data key would flip both. No
  document byte changes anywhere: registered, served (`/meta`), or stored. The
  existing consumer guards are unchanged and converge on this API opportunistically
  as they are next touched, per the ruling.

  An author-declared column of the same name — including a real remote
  `organization_id` on a federated object — answers `'author'`, never the marker,
  so a consumer acting on the marker can never suppress a tenant wall the author
  deliberately made real. Any inexact match fails toward `'author'`: toward
  enforcement, never exposure.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- a954634: feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

  The data plane has enforced field-level security everywhere it matters for
  several releases — list reads mask values, exports project columns, and the
  write path 403s forbidden fields. The **metadata** plane did not: any
  authenticated caller who asked `GET /meta/object/:name` received the full object
  schema, including fields they have no read access to at all.

  That is more than a list of names. A field carries its label, type, **picklist
  option values** (often a sensitive operational taxonomy), its **formula**
  expression (pricing and scoring IP), its `visibleWhen` predicate, its
  `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
  names guarding it. For a customer running a dealer, supplier or patient portal
  on ObjectStack, the only remediation available in their own tier was modelling
  discipline: keep sensitive fields off portal-visible objects, or split one
  business entity into an internal object and a portal object and synchronize
  them. This is a platform-side fix, so every deployment inherits it.

  **What changes.** Serving an object schema now projects `fields` onto the set
  the caller may read, and a field outside that set is removed **whole** — no
  name, no label, no options, no formula, no `requiredPermissions`. Partial
  redaction was rejected: keeping the name still leaks existence and invites
  clients to render ghost columns. Masking keys on the `readable` bit only; a
  readable-but-not-editable field stays in the schema, because the UI must render
  it and the `editable` affordance is already served per caller by
  `/auth/me/permissions`.

  Every outlet that serves an object schema goes through one shared projection,
  so coverage is not a per-route promise:

  - `GET /meta/object/:name` — the cached branch (the default) **and** the
    uncached branch, which is what `?state=draft`, `?preview=draft` and
    `?package=` take;
  - `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
    of `code` / `overlay` / `effective`;
  - `GET /meta/:type/:section/:name` — the compound-name read;
  - `GET /meta/object` — the list read, each item projected independently;
  - the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
    last-ditch single reads, the `/metadata/objects` list (protocol and registry),
    and the legacy one-segment `/metadata/:objectName` spelling.

  **Caching is unchanged in cost and correct per cohort.** The shared metadata
  cache still stores one full schema per (type, name, locale, environment) — no
  caller dimension in the key — and the mask runs after retrieval. What varies
  per caller is the validator: a stable hash of the caller's _denied_ field set is
  folded into the ETag. A caller who can read everything denies nothing, so their
  fingerprint is empty and both their ETag and their response body are
  **byte-identical** to previous releases. Callers in one permission cohort share
  `304`s; a permission change moves the fingerprint and self-invalidates the stale
  `304`, so nothing needs purging after a permission-set edit.

  **Exemptions** are a property of the caller, not of the route: `isSystem` and
  platform-admin callers (holders of `studio.access` / `setup.access`, the same
  judgement the app filter uses) receive the full schema on any route, because
  Studio and Setup authoring cannot work against a projected schema.

  **Failure posture is explicit and three-tiered.** With no `security` service
  registered the schema is served unmasked — that deployment has no FLS posture at
  all and tightening only the metadata plane would be theater. When field
  visibility cannot be _determined_ (a registry-hydration window), the schema is
  served unmasked but loudly: a structured warning, a new
  `objectstack_meta_field_visibility_undetermined_total` counter, and a response
  downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
  closed there would brick every render of the object for every user and can
  deadlock console bootstrap, since permission sets are themselves metadata. When
  permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
  a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
  and cacheable poison.

  **Guest and public deployments** get a deliberate posture rather than an
  accidental one: `@objectstack/plugin-security` gains
  `getMetadataReadableFields`, which resolves the configured fallback permission
  set (`security.fallbackPermissionSet`, default `member_default`) for a caller
  who resolves to zero sets, exactly as `/auth/me/permissions` does.
  `getReadableFields` is unchanged — on the data plane, mirroring the engine
  middleware's fall-open is what keeps it drift-free.

  **Escape hatch.** Masking is the platform default. A deployment that explicitly
  wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
  `metadata.maskObjectFields: false` on the REST server. Toggling it changes
  disclosure only: the console reads every field affordance from
  `/auth/me/permissions`, so UI correctness is unaffected either way.

  Operators fronting the runtime with a CDN or reverse proxy should read the new
  "CDN / reverse-proxy caching of `/meta` object schemas" section in the
  production-readiness guide before tuning anything — in particular, do not
  configure a proxy to ignore `Cache-Control: private`, and do not strip or
  rewrite `ETag` on these routes.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- db0d53c: `resolveEngineDeleteDispatch` 末尾改真值测试:假值标量 `where.id` 不再答 `by-id`

  `engine-delete-dispatch.ts` 的自我描述是「what does `ObjectQLEngine.delete` do with this call」的**唯一**答案,其测试文件头把赌注写得很明白:一份漂移的共享判定比没有判定更糟——每个钉在它上面的假引擎都会自信地、一致地错,而门禁照样报绿。这条性质此前在**假值标量 id** 上不成立,实测(origin/main,记录型 driver 驱动真实引擎):

  | 调用                                 | 真实 `ObjectQL.delete` | 判定(修改前) |
  | :----------------------------------- | :--------------------- | :----------- |
  | `{ where: { id: 0 } }`               | `reject`               | `by-id`      |
  | `{ where: { id: '' } }`              | `reject`               | `by-id`      |
  | `{ where: { id: 0 }, multi: true }`  | `multi`                | `by-id`      |
  | `{ where: { id: '' }, multi: true }` | `multi`                | `by-id`      |

  原因是两侧问了不同的问题:判定读 `scalarDeleteId(...) !== undefined`,而 `engine.ts` 把判定结果落进 `id` 之后按 `if (hookContext.input.id)` 分支——**真值**测试,`0` / `''` 落到 multi/reject 阶梯。于是按 `assertEngineDeleteDispatch(options)` 钉死的替身会**接受** `delete(o, { where: { id: '' } })`,而真服务器抛 `Delete requires an ID or options.multi=true`:pinned 替身在这一个输入上仍比生产者宽松,正是本模块存在的理由(#4434 形状)。`id: ''`(路径段为空 / 表单字段未填直传 `where.id`)是可达形状,不是猎奇。

  本次改的是**判定,不是引擎**。`resolveEngineDeleteDispatch` 是对 `ObjectQL.delete` 的描述,错的是描述:`delete(o, { where: { id: 0 } })` 改动前抛错,改动后照样抛错,**生产者行为零变化**,`engine.ts` 一字未动。反向做法(让 `{ id: 0 }` 变成真的按 id 删)是改生产者行为,已作为 #5747 的 B 方案明确不取。

  同时给 `ENGINE_DELETE_DISPATCH_CASES` 补上 `{ id: 0 }` / `{ id: '' }` 的有/无 `multi` 四例——此前这套逐例对照**结构上够不到**这个输入(#4868 家族:一次逐例跑不可能反驳一个没人列出来的输入),这才是判定能悄悄漂移一年的原因。`scalarDeleteId` 保持值忠实(`{ where: { id: 0 } }` 仍返回 `0`),真值测试只加在判定这一层,与 update 侧孪生模块 `scalarUpdateId` 的分法一致。

- 72c3c86: refactor(spec)!: retire `indexes[].type` and `indexes[].partial` — two authorable index keys no driver ever read (#5248, #4943)

  `IndexSchema` declared five keys; only three of them ever reached a `CREATE
INDEX`. `SqlDriver.syncDeclaredIndexes` builds every declared index through
  knex's `table.index(fields, name)` / `table.unique(fields, { indexName })`, and
  the drift differ's `DeclaredIndexInput` carries `name` / `fields` / `unique` /
  `nullSafeColumns`. So:

  - **`partial`** — documented as _"Partial index condition (SQL WHERE clause)"_ —
    produced a **full** index with the predicate silently discarded. This was the
    damaging half, because it reads as a correctness control: the platform's own
    `sys_metadata` declared `partial: "state = 'active'"` for overlay uniqueness,
    and what the declaration alone materialized was an _unrestricted_ unique index.
  - **`type`** additionally carried `.default('btree')`, so it appeared in **every**
    parse output of **every** index — an access-method knob that had never
    influenced a single statement, rendered as live configuration. (It was pinned
    as such in a `sys_presence` test, on an object that never declared it.)

  Both are the ADR-0078 no-silently-inert / ADR-0049 enforce-or-remove shape.
  Remove was chosen over enforce: enforcing needs per-dialect algorithm mapping
  (`gin`/`gist` Postgres-only, `fulltext` MySQL-family), raw-SQL `CREATE INDEX …
WHERE` on the dialects that have partial indexes at all (MySQL does not), and a
  redesign of how `isSyncReproducibleIndex` excludes partial indexes from
  incremental sync — design cost for a capability with no demand. If a real need
  appears it returns enforce-first.

  ## Migration

  | FROM                                                      | TO                                                                                              |
  | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
  | `indexes: [{ fields: […], type: 'gin' }]`                 | `indexes: [{ fields: […] }]` — create the specialised index from a database-layer migration     |
  | `indexes: [{ fields: […], partial: "state = 'active'" }]` | `indexes: [{ fields: […] }]` — issue `CREATE [UNIQUE] INDEX … WHERE …` from a runtime migration |

  **One-line fix: delete the key.** Neither removal changes any DDL, because no
  DDL ever depended on them — verified byte-for-byte against the `CREATE INDEX`
  statements SQLite actually stores
  (`packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`).

  Both capabilities remain available where they are implementable. The index
  method is the driver/dialect's choice. A partial index is issued as raw SQL from
  a runtime migration — exactly what `metadata-protocol`'s `ensureOverlayIndex`
  already does for `sys_metadata`, and what actually delivers that table's
  active-row-scoped uniqueness today.

  ⚠️ **Not affected:** driver-sql's own `partial` flag (`parseIndexDdl` /
  `introspectIndexes` / `isSyncReproducibleIndex`). That is a boolean parsed back
  out of the _database's own_ DDL for drift detection — the opposite direction —
  so migration-created partial indexes stay recognized and exempt from incremental
  sync, unchanged.

  ## The retirement kit

  - `retiredKey()` tombstones at `IndexSchema` (the shape is deliberately
    `.strip()`, so a plain delete would swap one silent no-op for another): writing
    either key is now a `tsc` error and a parse error carrying the prescription.
    They sit at the bottom of the shape per the #5606 renderer note.
  - **ADR-0087 D2 conversion + D3 chain step** (`object-index-type-partial-removed`,
    `toMajor: 17`, wired into the existing step-17 chain): strips both keys from
    `objects[]` and `objectExtensions[]`; `os migrate meta --from 16` rewrites sources
    mechanically. A pure lossless delete — there was no effect to lose.
  - **Producers flipped:** `sys_metadata` (`idx_sys_metadata_overlay_active`, the
    case #4943 named) and `sys_view_definition` (`idx_sys_view_def_active`), both
    with their comments corrected to say what is actually materialized.
  - Published skill (`objectstack-data`), `content/docs/data-modeling/objects.mdx`,
    liveness ledger note and generated baselines updated.

- 2d8dba3: Author-time warning for unprovisioned injected anchors on external objects (#8116). The injected-system-column definition tables and the #7865 provenance derivation (`platformProvisionsStorage`, `resolveInjectedColumnProvenance`, `unprovisionedInjectedColumns`, plus the newly exported identity predicate `isInjectedColumnDefinition`) moved from `@objectstack/metadata-core` into `@objectstack/spec/data`; `@objectstack/metadata-core` re-exports every previously-public name unchanged, so no downstream import changes. Built on the spec export, `@objectstack/lint` now warns when an expression, field conditional rule, formula, `stageField` or `highlightFields` entry references an injected system column (`owner_id`, `organization_id`, the audit family, `owning_business_unit_id`) on an ADR-0015 `external` object: the platform registers the anchor but provisions no storage behind it, so the reference silently degrades at query time (on SQLite: constant-false, HTTP 200, zero rows, no error). New advisory rule id `semantic-role-field-unprovisioned`; the expression finding is warning-severity and never fails the build. An author-declared column of the same name is treated as the author's real remote column and never warned.
- 7372d46: fix(metadata-protocol): keep every i18n bundle member through the `/meta` list merge (#7774)

  #7730 taught the `SchemaRegistry` that an `email_template`'s identity is
  `(name, locale)`, so `listItems('email_template')` returns every member of a
  declared i18n bundle. `GET /meta/<type>` then merges that listing with two
  higher layers, and both merges keyed by `(package, name)` with no
  discriminator — so the bundle survived registration only to collapse one layer
  later, and the list served a single locale.

  **Both merges now key on the pair.** `metaItemKey` takes an optional third
  component and `mergePackageAwareOverlay` buckets per slot rather than per name;
  both derive the value from the shared discriminator table, and both are
  byte-identical for a type that declares no discriminator — which is every type
  except `email_template` today.

  - **The MetadataService merge** is the path the issue named: with a `metadata`
    service installed and answering non-empty for the type, the second member's
    `Map.set` overwrote the first.
  - **The `sys_metadata` overlay merge** was predicted to need no change, on the
    ground that overlay rows are unique on `type+name+organization_id+package_id`
    and carry no locale column. That is true of the rows and beside the point:
    the base of that merge is the registry's bundle, so bucketing by bare name
    dropped a locale as soon as a single overlay row existed for the type — and
    the row that survived was the overlay body, whichever member it customizes.
    An overlay (or a draft preview) now lands on its own locale member and the
    rest of the bundle is served untouched. Across the env-wide and org tiers,
    rows that customize different members are likewise two slots instead of one;
    org-over-env precedence is unchanged within a member.

  **The discriminator table moved to `@objectstack/metadata-core`.**
  `ITEM_KEY_DISCRIMINATORS` was declared in `@objectstack/objectql`'s
  `registry.ts`, and `@objectstack/objectql` depends on
  `@objectstack/metadata-protocol`, so the protocol package could not import it
  without closing a dependency cycle. metadata-core is the package both already
  depend on and depends on neither — the same criterion that sank the engine
  write-verb dispatch predicates (#5619) and the audit-field governance table
  (#4513) there. **No public surface changes:** `registry.ts` re-exports
  `ITEM_KEY_DISCRIMINATORS` under its original name from its original module, so
  every existing import keeps working; `@objectstack/metadata-core` gains it plus
  `readDiscriminatorValue` / `itemDiscriminator` as additive exports. The
  registry's storage-key _format_ (`name@<locale>` composite keys and their
  parser) deliberately did not move — it encodes the registry's own Map keys,
  which no other package reads.

  For an app this is Studio's metadata list and `GET /meta/email_template`
  showing both the en-US and the zh-CN copy of a template instead of whichever
  one the merge happened to keep.

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- fda61e4: fix(metadata-protocol): `publishPackageDrafts` now writes the audit rows a batch publish always owed

  Studio's "publish whole app" (`POST /packages/:id/publish-drafts`) promoted every
  draft in a package and wrote **no `sys_metadata_audit` rows at all** — neither the
  allowed-outcome `publish` rows nor a `denied` row for a refusal. The route calls
  `promoteDraftForPublish` directly rather than `publishMetaItem`, so the row added
  for the single-item routes never ran for it: a batch that published twenty
  artifacts left the compliance trail exactly as empty as a batch nobody ran.

  Both outcomes are now recorded, and **where** they are recorded is the fix:

  - **allowed** — one `publish` / `allowed` row per promoted item, written in Phase 2
    off `promoted[]`, with `source: 'protocol.publishPackageDrafts'` so the trail
    distinguishes "publish whole app" from a single-item publish. The row is keyed on
    the scope the draft was promoted in, not the request's active org, because
    env-wide drafts are promoted env-wide.
  - **denied** — one `publish` / `denied` row with `code: 'batch_aborted'` when the
    batch rolls back, written from the rollback handler, **outside** the
    `engine.transaction()`. Written inside it, the refusal's own row would roll back
    with the batch it records — leaving nothing behind about a refused publish, which
    is the defect the single-item audit rows exist to close.

  The causal reason rides in `note`, which is served by `GET /api/v1/meta/:type/:name/audit`
  and therefore carries the client-facing text rather than raw driver output.

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

- 51a587d: 两个写动词的派发判定下沉到 `@objectstack/metadata-core` —— 公共 API 零变化,一次关闭 26 条 engine-double 基线条目

  `ObjectQL.delete` / `ObjectQL.update` 的三分支派发判定(`engine-delete-dispatch.ts` #4550、
  `engine-update-dispatch.ts` #5480)从 `packages/objectql/src/` **原样搬到**
  `packages/metadata-core/src/`。这是一次搬移,不是重构:两个模块本来就零 import、纯自包含,
  判定逻辑一个字未改。

  **为什么搬。** `@objectstack/objectql` 的 `dependencies` 含 `@objectstack/metadata-protocol`,
  所以那个包里 13 个假引擎结构性地无法 import 这两个谓词 —— 反向 devDependency 即成环,
  turbo 2.10.7 直接拒绝任务图。判据来自门禁台账里
  `packages/spec/src/contracts/data-engine.test.ts` 那条 EXEMPT:反向 import 不可行时,唯一
  出路是下沉到**两边都已依赖**的包。`@objectstack/metadata-core` 正是这个包
  (`objectql -> metadata-core` 与 `metadata-protocol -> metadata-core` 都是既有边),而它自己
  的 `dependencies` 只有 `{ @objectstack/spec, zod }`,不含 objectql,故不引入新环。

  **公共 API 与既有调用点零变化。** `packages/objectql/src/engine-delete-dispatch.ts` /
  `engine-update-dispatch.ts` 保留在原路径,改为 re-export shim,因此
  `@objectstack/objectql` 仍然导出
  `resolveEngineDeleteDispatch` / `assertEngineDeleteDispatch` / `scalarDeleteId` /
  `ENGINE_DELETE_REJECT_MESSAGE` / `ENGINE_DELETE_DISPATCH_CASES` 及 update 侧的五个同名对应物
  (与全部类型),`engine.ts` 与 37 个既有 pinned 调用点一行未动。同一批符号现在也从
  `@objectstack/metadata-core` 导出。

  搭配的门禁改动:`scripts/check-engine-double-contract.mjs` 的两个 slice 现在同时接受
  `@objectstack/metadata-core` 与 `@objectstack/objectql` 两种拼写(它们指向同一个函数),
  失败提示也改为在「objectql 依赖该包」时优先建议 metadata-core。

- c073b8c: refactor(metadata-core): drop `sys_view_definition`'s all-six `apiMethods` whitelist (#3026)

  #3745 completed this object's boilerplate CRUD-five whitelist to all six
  primitives so its batch routes stopped 405-ing. A whitelist naming all six is
  equivalent to no whitelist — except it stops tracking primitives the enum grows
  later — so the #3543 audit rule applies and the declaration is removed.

  No behaviour change: `undefined` resolves to `unrestricted`, whose effective
  operation set is identical to `restricted` holding all six.

  Removing it is safe HERE specifically because the object has no `managedBy`:
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so for a managed object an absent whitelist would take the
  managed-write backstop with it. That is why the RBAC objects reclaimed by #3745
  keep their explicit arrays and this one does not.

- 946a131: fix(metadata-core,objectql): `ObjectQL.update` 的 `data.id` 同过标量测试,不再把载荷里的算子对象当主键 (#5748)

  `ObjectQL.update(object, data, options)` 用两处取主键,而这两处此前用的是**两套规则**:

  - `options.where.id` 走**标量测试** —— `{ id: { $in: [...] } }` / `{ id: [...] }` /
    `{ id: null }` 是多行谓词,不算 id(#4434 / #4550);
  - `data.id` **不做任何测试**,只要为真就原样当主键,并且先于 `where`、也先于
    `options.multi`。

  于是同一个算子对象,写在 `where.id` 里被正确识别为谓词,写在 `data.id` 里却被
  当成主键绑进 `driver.update(object, id, …)` 的主键位置,**显式声明的
  `multi: true` 被无声忽略**。后果不是数据被覆盖,而是静默失灵或难读的驱动错误:
  SQLite 侧报参数绑定错误,别的驱动可能只匹配零行 —— 两种都不会告诉调用方
  「你的 `multi` 被忽略了」。这是 declared ≠ enforced 的一种,#5393 刚给 flow 的
  `update_record` 补上的 `multi` 批量意图键正是被这条更早的规则盖掉的。

  现在 `data.id` 与 `where.id` **共用同一个标量测试**(判定在
  `packages/metadata-core/src/engine-update-dispatch.ts` 定义一次,`engine.ts` 与
  全部 fake engine 经 `resolveEngineUpdateDispatch` /
  `assertEngineUpdateDispatch` 复用同一份)。非标量 `data.id` 不算 id,因此不再
  盖住任何东西:判定按 `where.id` → `multi` → `reject` 的原有阶梯继续往下走。

  **行为矩阵(FROM → TO)。标量 `data.id` 的按 id 写法完全不受影响。**

  | 调用                                                                | FROM                       | TO                                                                |
  | :------------------------------------------------------------------ | :------------------------- | :---------------------------------------------------------------- |
  | `update(o, { id: 'rec_1', …f })`                                    | by-id `'rec_1'`            | **不变**                                                          |
  | `update(o, { id: 'rec_1', …f }, { multi: true })`                   | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `multi`)                           |
  | `update(o, { id: 'rec_1', …f }, { where: { id: 'rec_2' } })`        | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `where`)                           |
  | `update(o, { id: 0, …f }, { multi: true })`                         | multi                      | **不变**(真值判定,`0` 不标识行)                                   |
  | `update(o, { id: { $in: [...] }, …f }, { multi: true })`            | by-id,算子对象被绑进主键位 | **multi** —— 声明的批量意图被执行                                 |
  | `update(o, { id: ['a','b'], …f }, { multi: true })`                 | by-id,数组被绑进主键位     | **multi**                                                         |
  | `update(o, { id: { $in: [...] }, …f })`(**无** `multi`)             | by-id,算子对象被绑进主键位 | **reject**,消息不变:`Update requires an ID or options.multi=true` |
  | `update(o, { id: { $in: [...] }, …f }, { multi: false })`           | 同上                       | **reject**                                                        |
  | `update(o, { id: { $in: [...] }, …f }, { where: { id: 'rec_1' } })` | by-id,绑的是**算子对象**   | by-id,绑的是 **`'rec_1'`**                                        |

  最后一格是这次修复里唯一「判定不变、绑定值变了」的一格 —— 前后都是 `by-id`,
  变的是哪一个 id 源胜出。`ENGINE_UPDATE_DISPATCH_CASES` 因此新增可选的
  `expectId`,把落进主键位的值本身也钉住,避免用例因为「什么都没产出」而绿。

  **「无 `multi` 的非标量 `data.id`」被明确定成响亮拒绝**,不会静默升级成一次真的
  批量写 —— 这是裁决(维护者 2026-08-06)对方案 B 那条顾虑的处置:把算子对象写进
  载荷大概率是写错了位置,那就报错,而不是替作者决定他想批量写。

  无 API 变更:导出符号、类型与 `ENGINE_UPDATE_REJECT_MESSAGE` 的文案均不变。

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [6a67d7a]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [d127ff0]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [97b6658]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [60b672e]
- Updated dependencies [6b441a8]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- 5e247fd: fix(metadata-protocol): a `/meta` object read serves the effective runtime schema, whichever layer answered (#6562)

  `GET /api/v1/meta/object/:name` answered a **different set of fields** depending
  on which link of its resolution chain produced the answer, for the same object:

  - **registry-backed** → the schema AFTER `applySystemFields`, so it carried the
    injected system columns — `created_at`, `created_by`, `updated_at`,
    `updated_by`, `organization_id`, `owner_id`, `owning_business_unit_id` — even
    when the author declared none of them;
  - **overlay-backed** (a `sys_metadata` customization row, or a MetadataService
    body) → the stored document VERBATIM, so every one of those columns was simply
    absent.

  Whether an object carries an overlay is invisible to the caller, so the same
  request reported the platform's own columns or not, and nothing in the response
  said which had happened. `/meta` is the machine-readable contract clients and AI
  authors code against: an author reading an overlay-backed object saw no
  `created_at` / `owner_id` / `organization_id` and reasonably concluded the
  columns do not exist — while every one of them is real in the database,
  filterable, orderable, and enforced read-only on write.

  **Every `/meta` object read exit now serves the effective schema.** The
  single-item read, the list, the cached/ETag branch, both draft reads and the
  layered read's `effective` layer all report the injected columns, with the same
  `readonly` / `system` markers the engine enforces (`owner_id` stays
  `readonly: false` — ownership is transferable). This is the presence half of the
  seam #4513 closed the value half of.

  Three things deliberately did **not** change:

  - **`?layers=1`'s `overlay` layer stays byte-verbatim.** Injection happens at the
    read exits only, so Studio's "what you customised" diff never shows a column
    nobody wrote. Only `effective` is injected.
  - **A `GET` → `PUT` round-trip still persists a byte-identical body** (#4326).
    The write path gained the strip counterpart: a field byte-identical to the
    platform's own definition is removed again on save, so a served document handed
    straight back stores exactly what it stored before — same checksum, same
    history diff. A declared `owner_id` carrying the author's own label is _not_
    the platform's definition and survives untouched.
  - **A declared system column stays the author's.** Injection only ever adds a
    column nobody declared; it never rewrites one that was.

  Which columns an object carries is `resolveInjectedSystemColumns`
  (`@objectstack/spec/data`, #5378) — the same derivation `applySystemFields`
  consumes — so every opt-out (`systemFields: false`, `managedBy: 'better-auth'`,
  `systemFields.audit`/`.tenant`, `tenancy.enabled: false`, the per-tier
  `ownership` table, the `sys_*` namespace) is answered in one place and re-derived
  in none. **What** each column looks like moves to `@objectstack/metadata-core`
  (`AUDIT_FIELD_DEFS` and the three tenancy/ownership anchors, re-exported from
  `@objectstack/objectql` so the symbols still resolve there) — the same relocation,
  for the same dependency cycle, as the audit-governance table in #4513:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the read
  path could not import the definitions from the registry that provisions them.
  One table now feeds the injection pass and the read exits, so they cannot drift.

  One key is deliberately not carried onto a served document: `organization_id`'s
  `indexed`. It is not a `FieldSchema` key — removed in the 16.x line (#2377,
  ADR-0049) and rejected by name by the strict schema — and its only consumer is
  `driver-mongodb`'s schema builder, which reads the registered schema and never a
  served document. It stays at the injection site; that the registry-backed read
  answers `_diagnostics: { valid: false }` because of it is filed as #6810.

- a954634: feat(meta): object schemas served by `/meta` and `/metadata` are masked per caller (ADR-0106, #3682)

  The data plane has enforced field-level security everywhere it matters for
  several releases — list reads mask values, exports project columns, and the
  write path 403s forbidden fields. The **metadata** plane did not: any
  authenticated caller who asked `GET /meta/object/:name` received the full object
  schema, including fields they have no read access to at all.

  That is more than a list of names. A field carries its label, type, **picklist
  option values** (often a sensitive operational taxonomy), its **formula**
  expression (pricing and scoring IP), its `visibleWhen` predicate, its
  `defaultValue`, and — via ADR-0066 D3 — the `requiredPermissions` capability
  names guarding it. For a customer running a dealer, supplier or patient portal
  on ObjectStack, the only remediation available in their own tier was modelling
  discipline: keep sensitive fields off portal-visible objects, or split one
  business entity into an internal object and a portal object and synchronize
  them. This is a platform-side fix, so every deployment inherits it.

  **What changes.** Serving an object schema now projects `fields` onto the set
  the caller may read, and a field outside that set is removed **whole** — no
  name, no label, no options, no formula, no `requiredPermissions`. Partial
  redaction was rejected: keeping the name still leaks existence and invites
  clients to render ghost columns. Masking keys on the `readable` bit only; a
  readable-but-not-editable field stays in the schema, because the UI must render
  it and the `editable` affordance is already served per caller by
  `/auth/me/permissions`.

  Every outlet that serves an object schema goes through one shared projection,
  so coverage is not a per-route promise:

  - `GET /meta/object/:name` — the cached branch (the default) **and** the
    uncached branch, which is what `?state=draft`, `?preview=draft` and
    `?package=` take;
  - `GET /meta/object/:name?layers=true` — the layered diagnostic view, all three
    of `code` / `overlay` / `effective`;
  - `GET /meta/:type/:section/:name` — the compound-name read;
  - `GET /meta/object` — the list read, each item projected independently;
  - the runtime `/metadata` catch-all — the protocol-backed, registry-backed and
    last-ditch single reads, the `/metadata/objects` list (protocol and registry),
    and the legacy one-segment `/metadata/:objectName` spelling.

  **Caching is unchanged in cost and correct per cohort.** The shared metadata
  cache still stores one full schema per (type, name, locale, environment) — no
  caller dimension in the key — and the mask runs after retrieval. What varies
  per caller is the validator: a stable hash of the caller's _denied_ field set is
  folded into the ETag. A caller who can read everything denies nothing, so their
  fingerprint is empty and both their ETag and their response body are
  **byte-identical** to previous releases. Callers in one permission cohort share
  `304`s; a permission change moves the fingerprint and self-invalidates the stale
  `304`, so nothing needs purging after a permission-set edit.

  **Exemptions** are a property of the caller, not of the route: `isSystem` and
  platform-admin callers (holders of `studio.access` / `setup.access`, the same
  judgement the app filter uses) receive the full schema on any route, because
  Studio and Setup authoring cannot work against a projected schema.

  **Failure posture is explicit and three-tiered.** With no `security` service
  registered the schema is served unmasked — that deployment has no FLS posture at
  all and tightening only the metadata plane would be theater. When field
  visibility cannot be _determined_ (a registry-hydration window), the schema is
  served unmasked but loudly: a structured warning, a new
  `objectstack_meta_field_visibility_undetermined_total` counter, and a response
  downgraded to `Cache-Control: private, no-store` with no shared ETag. Failing
  closed there would brick every render of the object for every user and can
  deadlock console bootstrap, since permission sets are themselves metadata. When
  permission evaluation **throws**, the request fails with `503
FIELD_VISIBILITY_UNRESOLVED` — an unhealthy security service must not auto-open
  a disclosure hole, and an empty-fields `200` would be both a silently wrong UI
  and cacheable poison.

  **Guest and public deployments** get a deliberate posture rather than an
  accidental one: `@objectstack/plugin-security` gains
  `getMetadataReadableFields`, which resolves the configured fallback permission
  set (`security.fallbackPermissionSet`, default `member_default`) for a caller
  who resolves to zero sets, exactly as `/auth/me/permissions` does.
  `getReadableFields` is unchanged — on the data plane, mirroring the engine
  middleware's fall-open is what keeps it drift-free.

  **Escape hatch.** Masking is the platform default. A deployment that explicitly
  wants an unmasked metadata plane sets `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`, or
  `metadata.maskObjectFields: false` on the REST server. Toggling it changes
  disclosure only: the console reads every field affordance from
  `/auth/me/permissions`, so UI correctness is unaffected either way.

  Operators fronting the runtime with a CDN or reverse proxy should read the new
  "CDN / reverse-proxy caching of `/meta` object schemas" section in the
  production-readiness guide before tuning anything — in particular, do not
  configure a proxy to ignore `Cache-Control: private`, and do not strip or
  rewrite `ETag` on these routes.

### Patch Changes

- 1a53a02: fix(meta): `/meta` object reads stop reporting `readonly: false` on fields the write path refuses (#4513)

  `#4447` made the audit-provenance family (`created_at`, `created_by`,
  `updated_at`, `updated_by`) engine-owned on the **write** path: the registry's
  `applySystemFields` forces `{ readonly: true, system: true }` over a _declared_
  audit field, and `ObjectQL.update` strips a non-system caller's write to it.

  The **read** path never learned it. A `/meta` object read resolves through
  `sys_metadata` overlay → MetadataService → SchemaRegistry, and only the last of
  those three has been through `applySystemFields` — so an object whose built
  artifact ships a materialized `created_at` carrying FieldSchema defaults
  (`readonly: false`) reported that value to every client while writes to that
  same field were being refused. Measured before the fix, all of the read exits
  agreed with each other and disagreed with the engine:

  ```
  single  read: {"type":"datetime","label":"Created At","readonly":false}
  list    read: {"type":"datetime","label":"Created At","readonly":false}
  cached  read: {"type":"datetime","label":"Created At","readonly":false}
  layered read: {"type":"datetime","label":"Created At","readonly":false}
  ```

  One field, two answers — and the machine-readable one, the only face a client
  or an AI author writing code off `/meta` can see, was the wrong one.

  **What changes.** Every `/meta` object read exit now reports the audit family
  the way the engine enforces it. That covers the single-item read (both the
  singular and plural type spelling), the list read, the cached/ETag branch, the
  `?preview=draft` and `?state=draft` reads, and the layered read's `effective`
  layer. `GET` bodies for objects that declare an audit field will show
  `readonly: true, system: true` where they previously showed `readonly: false`
  or omitted the keys; nothing else about the document changes, and the ETag for
  such an object changes once.

  **What deliberately does not change.**

  - The layered read's `code` and `overlay` layers stay raw — showing the
    package's declaration beside the governed `effective` value is the
    diagnostic's whole point.
  - `sys_metadata` still stores exactly what the author saved; the correction is
    applied on the way out, so no phantom customization appears in the diff.
  - An object that opts out of the audit family (`systemFields: false`,
    `systemFields.audit: false`, `managedBy: 'better-auth'`) is untouched — the
    engine enforces nothing there, so a read that claimed otherwise would be the
    same lie pointing the other way.
  - Only `readonly` and `system` are forced. Every other key an author writes —
    `label`, `description`, `hidden`, `group`, and `type` for an external object
    mapping a differently-typed remote column — stays theirs.

  The governance table moved from `packages/objectql/src/registry.ts` to
  `@objectstack/metadata-core` (`AUDIT_FIELD_GOVERNANCE`, plus the
  `applyAuditFieldGovernance` normalizer the read path applies), by the same
  criterion and for the same cycle as the `#5619` engine-dispatch predicates:
  `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
  read path cannot import the table from the registry that enforces it, and a
  second copy would agree only until someone edited one side. `objectql`
  re-exports the symbol from its original path, so its public API is unchanged.

- 3d4c545: fix(metadata): `sys_view_definition` 的「活跃行唯一」真正生效——归档视图不再占用 (name, organization_id, owner) 名额

  `sys_view_definition` 的 `idx_sys_view_def_active` 索引注释一直承诺「among active rows」，但这个语义从未在任何一层交付：声明面的 `partial: "state = 'active'"` 没有任何 driver 消费者（`syncDeclaredIndexes` 走 knex 的 `table.unique()`，无法表达 `WHERE`），该键已随 #5248 / #4943 退役；而与 `sys_metadata` 不同，这张表背后**没有**任何等价的运行时迁移。结果是建出来的一直是无谓词的全量 UNIQUE 索引——用户归档（或软删、重置）一个视图后，**无法再新建同名视图**，被一条自己刚扔掉的记录挡住。

  现在补上运行时迁移 `ensureViewDefinitionActiveIndex`（照 `metadata-protocol` 既有的 `ensureOverlayIndex` 范式），在 `kernel:ready` 用 raw SQL 发 `CREATE UNIQUE INDEX idx_sys_view_def_active … WHERE state = 'active'`：

  - **名额可回收**——归档视图不再占用名额，同名视图可以重建；
  - **唯一性不放宽**——两条 `state='active'` 的同名同域行仍然被拒；
  - **复用声明的索引名**——`syncDeclaredIndexes` 按名跳过，后续每次启动都不会把全量 UNIQUE 索引重新加回来；
  - **降级只会退回今天的行为，不会更低**——迁移先用一个临时探针索引验证当前方言与数据确实能建出部分索引，成功后才替换既有索引。因此 MySQL / MariaDB（无部分索引）上原有的全量 UNIQUE 索引原样保留（归档行在该方言上仍占名额，以 `info` 记录），不会出现「旧索引已删、新索引没建成」的无约束窗口。

  `metadata-core` 侧只更新了 `sys-view-definition.object.ts` 的注释：该声明现在被明确记为**降级形态**（供无部分索引的方言与不跑该迁移的宿主使用），不应删除。

  已知未涵盖：`owner` 为 NULL 的共享视图与 `organization_id` 为 NULL 的环境级视图，因 SQL UNIQUE 的 NULL-distinct 语义本来就不受该索引约束。这是早于本次修复的既有缺口，本迁移只改变**行范围**（`WHERE state = 'active'`）而不动键的拼写——这也正是它严格弱于被替换的索引、因而不可能在存量数据上建失败的原因。该缺口已另单记录。

- bb7cb41: fix(metadata): two same-name active SHARED views can no longer coexist — `sys_view_definition`'s active-row index gets a NULL-safe key (#6417)

  #5839 / PR #6415 delivered "unique among ACTIVE rows" for `sys_view_definition`
  as a runtime partial UNIQUE index, and deliberately changed only the index's
  **row scope** — that is what made it strictly weaker than the index it replaced
  and therefore incapable of failing on existing data. It also left the other
  half of the same index broken, and pinned that gap honestly rather than closing
  it.

  SQL UNIQUE treats NULLs as mutually **distinct**. `owner` is NULL for SHARED
  views and `organization_id` is NULL for environment-level ones, so
  `(name, organization_id, owner)` constrained **personal views only**. Measured
  on real SQLite over the driver's own DDL:

  ```text
  two ACTIVE personal views, same (name, org, owner) : REJECTED
  two ACTIVE shared views    (owner NULL)            : OK   ← unconstrained
  two ACTIVE env-level views (organization_id NULL)  : OK   ← unconstrained
  ```

  Two same-name shared views inside one tenant were therefore reachable, while
  `name` is declared as the globally unique qualified view id (`object.viewKey`)
  — so the view switcher, which aggregates and de-duplicates by `name`, and every
  read path that locates a view by name, had no defined answer about which row
  they got.

  **What changes.** Per the maintainer ruling of 2026-08-08 this is now forbidden.
  The same runtime migration materializes the key NULL-safe, folding each nullable
  part's NULLs into one bucket that is unique among itself:

  ```sql
  CREATE UNIQUE INDEX idx_sys_view_def_active ON sys_view_definition
    (name, COALESCE(organization_id, '__global__'), COALESCE(owner, ''))
    WHERE state = 'active'
  ```

  Both spellings are copied from an existing in-repo precedent rather than
  invented: `'__global__'` is ADR-0120 D3's reserved sentinel for the tenant
  column (the driver's `GLOBAL_TENANT`), and `COALESCE(owner, '')` is
  `ensureOverlayIndex`'s `COALESCE(package_id, '')` form for a non-tenant nullable
  discriminator. Neither can collide with real data — an organization id may never
  equal `'__global__'`, and an owner is a user id, never the empty string.
  **Storage is untouched**: rows keep their NULLs, only the index folds them, so
  `WHERE owner = ''` still matches nothing.

  Unchanged: archived rows stay exempt (#5839's active-only scoping survives, on
  shared views too), a shared view and a personal view may still share a name, and
  so may two tenants' or two environments' rows.

  **This is a tightening, so it can fail to build.** Unlike #5839, rows that
  violate the new key exist in the wild today, precisely because nothing rejected
  them. The migration probes before it replaces anything, and on a conflict takes
  ADR-0120 D4's disposition: the previous index is left in place (the table is
  never left unconstrained), the report names the key that is not enforced, ships
  the exact `GROUP BY … HAVING COUNT(*) > 1` query that lists the offending rows,
  points at `os migrate plan` — and the boot continues. Resolve the duplicate
  active shared views, restart, and the tightening applies itself.

  Dialects with no partial indexes (MySQL/MariaDB) keep the declared bare
  composite, which is ADR-0120 D3's own degradation. That report is **raised from
  `info` to `error`**: under #5839 alone the dialect lost slot recycling, a
  functional degradation the next user hits immediately, but it now loses an
  integrity guarantee the platform states it enforces while continuing to look
  healthy — AGENTS.md's durability arm. The line names both gaps that stay open
  there and the duplicate-listing query. The unclassifiable-failure arm is raised
  with it, so the failure nobody can name is never reported more quietly than the
  one that has a name.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5

## 17.0.0-rc.4

### Patch Changes

- db0d53c: `resolveEngineDeleteDispatch` 末尾改真值测试:假值标量 `where.id` 不再答 `by-id`

  `engine-delete-dispatch.ts` 的自我描述是「what does `ObjectQLEngine.delete` do with this call」的**唯一**答案,其测试文件头把赌注写得很明白:一份漂移的共享判定比没有判定更糟——每个钉在它上面的假引擎都会自信地、一致地错,而门禁照样报绿。这条性质此前在**假值标量 id** 上不成立,实测(origin/main,记录型 driver 驱动真实引擎):

  | 调用                                 | 真实 `ObjectQL.delete` | 判定(修改前) |
  | :----------------------------------- | :--------------------- | :----------- |
  | `{ where: { id: 0 } }`               | `reject`               | `by-id`      |
  | `{ where: { id: '' } }`              | `reject`               | `by-id`      |
  | `{ where: { id: 0 }, multi: true }`  | `multi`                | `by-id`      |
  | `{ where: { id: '' }, multi: true }` | `multi`                | `by-id`      |

  原因是两侧问了不同的问题:判定读 `scalarDeleteId(...) !== undefined`,而 `engine.ts` 把判定结果落进 `id` 之后按 `if (hookContext.input.id)` 分支——**真值**测试,`0` / `''` 落到 multi/reject 阶梯。于是按 `assertEngineDeleteDispatch(options)` 钉死的替身会**接受** `delete(o, { where: { id: '' } })`,而真服务器抛 `Delete requires an ID or options.multi=true`:pinned 替身在这一个输入上仍比生产者宽松,正是本模块存在的理由(#4434 形状)。`id: ''`(路径段为空 / 表单字段未填直传 `where.id`)是可达形状,不是猎奇。

  本次改的是**判定,不是引擎**。`resolveEngineDeleteDispatch` 是对 `ObjectQL.delete` 的描述,错的是描述:`delete(o, { where: { id: 0 } })` 改动前抛错,改动后照样抛错,**生产者行为零变化**,`engine.ts` 一字未动。反向做法(让 `{ id: 0 }` 变成真的按 id 删)是改生产者行为,已作为 #5747 的 B 方案明确不取。

  同时给 `ENGINE_DELETE_DISPATCH_CASES` 补上 `{ id: 0 }` / `{ id: '' }` 的有/无 `multi` 四例——此前这套逐例对照**结构上够不到**这个输入(#4868 家族:一次逐例跑不可能反驳一个没人列出来的输入),这才是判定能悄悄漂移一年的原因。`scalarDeleteId` 保持值忠实(`{ where: { id: 0 } }` 仍返回 `0`),真值测试只加在判定这一层,与 update 侧孪生模块 `scalarUpdateId` 的分法一致。

- 72c3c86: refactor(spec)!: retire `indexes[].type` and `indexes[].partial` — two authorable index keys no driver ever read (#5248, #4943)

  `IndexSchema` declared five keys; only three of them ever reached a `CREATE
INDEX`. `SqlDriver.syncDeclaredIndexes` builds every declared index through
  knex's `table.index(fields, name)` / `table.unique(fields, { indexName })`, and
  the drift differ's `DeclaredIndexInput` carries `name` / `fields` / `unique` /
  `nullSafeColumns`. So:

  - **`partial`** — documented as _"Partial index condition (SQL WHERE clause)"_ —
    produced a **full** index with the predicate silently discarded. This was the
    damaging half, because it reads as a correctness control: the platform's own
    `sys_metadata` declared `partial: "state = 'active'"` for overlay uniqueness,
    and what the declaration alone materialized was an _unrestricted_ unique index.
  - **`type`** additionally carried `.default('btree')`, so it appeared in **every**
    parse output of **every** index — an access-method knob that had never
    influenced a single statement, rendered as live configuration. (It was pinned
    as such in a `sys_presence` test, on an object that never declared it.)

  Both are the ADR-0078 no-silently-inert / ADR-0049 enforce-or-remove shape.
  Remove was chosen over enforce: enforcing needs per-dialect algorithm mapping
  (`gin`/`gist` Postgres-only, `fulltext` MySQL-family), raw-SQL `CREATE INDEX …
WHERE` on the dialects that have partial indexes at all (MySQL does not), and a
  redesign of how `isSyncReproducibleIndex` excludes partial indexes from
  incremental sync — design cost for a capability with no demand. If a real need
  appears it returns enforce-first.

  ## Migration

  | FROM                                                      | TO                                                                                              |
  | :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
  | `indexes: [{ fields: […], type: 'gin' }]`                 | `indexes: [{ fields: […] }]` — create the specialised index from a database-layer migration     |
  | `indexes: [{ fields: […], partial: "state = 'active'" }]` | `indexes: [{ fields: […] }]` — issue `CREATE [UNIQUE] INDEX … WHERE …` from a runtime migration |

  **One-line fix: delete the key.** Neither removal changes any DDL, because no
  DDL ever depended on them — verified byte-for-byte against the `CREATE INDEX`
  statements SQLite actually stores
  (`packages/drivers/driver-sql/src/declared-index-retired-keys.test.ts`).

  Both capabilities remain available where they are implementable. The index
  method is the driver/dialect's choice. A partial index is issued as raw SQL from
  a runtime migration — exactly what `metadata-protocol`'s `ensureOverlayIndex`
  already does for `sys_metadata`, and what actually delivers that table's
  active-row-scoped uniqueness today.

  ⚠️ **Not affected:** driver-sql's own `partial` flag (`parseIndexDdl` /
  `introspectIndexes` / `isSyncReproducibleIndex`). That is a boolean parsed back
  out of the _database's own_ DDL for drift detection — the opposite direction —
  so migration-created partial indexes stay recognized and exempt from incremental
  sync, unchanged.

  ## The retirement kit

  - `retiredKey()` tombstones at `IndexSchema` (the shape is deliberately
    `.strip()`, so a plain delete would swap one silent no-op for another): writing
    either key is now a `tsc` error and a parse error carrying the prescription.
    They sit at the bottom of the shape per the #5606 renderer note.
  - **ADR-0087 D2 conversion + D3 chain step** (`object-index-type-partial-removed`,
    `toMajor: 17`, wired into the existing step-17 chain): strips both keys from
    `objects[]` and `objectExtensions[]`; `os migrate meta --from 16` rewrites sources
    mechanically. A pure lossless delete — there was no effect to lose.
  - **Producers flipped:** `sys_metadata` (`idx_sys_metadata_overlay_active`, the
    case #4943 named) and `sys_view_definition` (`idx_sys_view_def_active`), both
    with their comments corrected to say what is actually materialized.
  - Published skill (`objectstack-data`), `content/docs/data-modeling/objects.mdx`,
    liveness ledger note and generated baselines updated.

- 51a587d: 两个写动词的派发判定下沉到 `@objectstack/metadata-core` —— 公共 API 零变化,一次关闭 26 条 engine-double 基线条目

  `ObjectQL.delete` / `ObjectQL.update` 的三分支派发判定(`engine-delete-dispatch.ts` #4550、
  `engine-update-dispatch.ts` #5480)从 `packages/objectql/src/` **原样搬到**
  `packages/metadata-core/src/`。这是一次搬移,不是重构:两个模块本来就零 import、纯自包含,
  判定逻辑一个字未改。

  **为什么搬。** `@objectstack/objectql` 的 `dependencies` 含 `@objectstack/metadata-protocol`,
  所以那个包里 13 个假引擎结构性地无法 import 这两个谓词 —— 反向 devDependency 即成环,
  turbo 2.10.7 直接拒绝任务图。判据来自门禁台账里
  `packages/spec/src/contracts/data-engine.test.ts` 那条 EXEMPT:反向 import 不可行时,唯一
  出路是下沉到**两边都已依赖**的包。`@objectstack/metadata-core` 正是这个包
  (`objectql -> metadata-core` 与 `metadata-protocol -> metadata-core` 都是既有边),而它自己
  的 `dependencies` 只有 `{ @objectstack/spec, zod }`,不含 objectql,故不引入新环。

  **公共 API 与既有调用点零变化。** `packages/objectql/src/engine-delete-dispatch.ts` /
  `engine-update-dispatch.ts` 保留在原路径,改为 re-export shim,因此
  `@objectstack/objectql` 仍然导出
  `resolveEngineDeleteDispatch` / `assertEngineDeleteDispatch` / `scalarDeleteId` /
  `ENGINE_DELETE_REJECT_MESSAGE` / `ENGINE_DELETE_DISPATCH_CASES` 及 update 侧的五个同名对应物
  (与全部类型),`engine.ts` 与 37 个既有 pinned 调用点一行未动。同一批符号现在也从
  `@objectstack/metadata-core` 导出。

  搭配的门禁改动:`scripts/check-engine-double-contract.mjs` 的两个 slice 现在同时接受
  `@objectstack/metadata-core` 与 `@objectstack/objectql` 两种拼写(它们指向同一个函数),
  失败提示也改为在「objectql 依赖该包」时优先建议 metadata-core。

- 946a131: fix(metadata-core,objectql): `ObjectQL.update` 的 `data.id` 同过标量测试,不再把载荷里的算子对象当主键 (#5748)

  `ObjectQL.update(object, data, options)` 用两处取主键,而这两处此前用的是**两套规则**:

  - `options.where.id` 走**标量测试** —— `{ id: { $in: [...] } }` / `{ id: [...] }` /
    `{ id: null }` 是多行谓词,不算 id(#4434 / #4550);
  - `data.id` **不做任何测试**,只要为真就原样当主键,并且先于 `where`、也先于
    `options.multi`。

  于是同一个算子对象,写在 `where.id` 里被正确识别为谓词,写在 `data.id` 里却被
  当成主键绑进 `driver.update(object, id, …)` 的主键位置,**显式声明的
  `multi: true` 被无声忽略**。后果不是数据被覆盖,而是静默失灵或难读的驱动错误:
  SQLite 侧报参数绑定错误,别的驱动可能只匹配零行 —— 两种都不会告诉调用方
  「你的 `multi` 被忽略了」。这是 declared ≠ enforced 的一种,#5393 刚给 flow 的
  `update_record` 补上的 `multi` 批量意图键正是被这条更早的规则盖掉的。

  现在 `data.id` 与 `where.id` **共用同一个标量测试**(判定在
  `packages/metadata-core/src/engine-update-dispatch.ts` 定义一次,`engine.ts` 与
  全部 fake engine 经 `resolveEngineUpdateDispatch` /
  `assertEngineUpdateDispatch` 复用同一份)。非标量 `data.id` 不算 id,因此不再
  盖住任何东西:判定按 `where.id` → `multi` → `reject` 的原有阶梯继续往下走。

  **行为矩阵(FROM → TO)。标量 `data.id` 的按 id 写法完全不受影响。**

  | 调用                                                                | FROM                       | TO                                                                |
  | :------------------------------------------------------------------ | :------------------------- | :---------------------------------------------------------------- |
  | `update(o, { id: 'rec_1', …f })`                                    | by-id `'rec_1'`            | **不变**                                                          |
  | `update(o, { id: 'rec_1', …f }, { multi: true })`                   | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `multi`)                           |
  | `update(o, { id: 'rec_1', …f }, { where: { id: 'rec_2' } })`        | by-id `'rec_1'`            | **不变**(标量 `data.id` 仍先于 `where`)                           |
  | `update(o, { id: 0, …f }, { multi: true })`                         | multi                      | **不变**(真值判定,`0` 不标识行)                                   |
  | `update(o, { id: { $in: [...] }, …f }, { multi: true })`            | by-id,算子对象被绑进主键位 | **multi** —— 声明的批量意图被执行                                 |
  | `update(o, { id: ['a','b'], …f }, { multi: true })`                 | by-id,数组被绑进主键位     | **multi**                                                         |
  | `update(o, { id: { $in: [...] }, …f })`(**无** `multi`)             | by-id,算子对象被绑进主键位 | **reject**,消息不变:`Update requires an ID or options.multi=true` |
  | `update(o, { id: { $in: [...] }, …f }, { multi: false })`           | 同上                       | **reject**                                                        |
  | `update(o, { id: { $in: [...] }, …f }, { where: { id: 'rec_1' } })` | by-id,绑的是**算子对象**   | by-id,绑的是 **`'rec_1'`**                                        |

  最后一格是这次修复里唯一「判定不变、绑定值变了」的一格 —— 前后都是 `by-id`,
  变的是哪一个 id 源胜出。`ENGINE_UPDATE_DISPATCH_CASES` 因此新增可选的
  `expectId`,把落进主键位的值本身也钉住,避免用例因为「什么都没产出」而绿。

  **「无 `multi` 的非标量 `data.id`」被明确定成响亮拒绝**,不会静默升级成一次真的
  批量写 —— 这是裁决(维护者 2026-08-06)对方案 B 那条顾虑的处置:把算子对象写进
  载荷大概率是写错了位置,那就报错,而不是替作者决定他想批量写。

  无 API 变更:导出符号、类型与 `ENGINE_UPDATE_REJECT_MESSAGE` 的文案均不变。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4

## 17.0.0-rc.2

### Major Changes

- 65f184b: fix(metadata)!: `sys_metadata_history.recorded_by` stores NULL, not the sentinel string `'system'` (#4556)

  `recorded_by` is declared `Field.lookup('sys_user', { readonly: true })` — a
  foreign key. The write path filled it with `actor ?? 'system'`, so every
  metadata write without a caller actor (boot sync, migration, an internal call)
  stored the **string** `'system'` in a column whose declared type says "the id
  of a `sys_user` row". No such row exists, and `SystemUserId.SYSTEM`
  (`'usr_system'`) is not auto-provisioned on the current runtime either, so the
  value resolved to nothing under any reading. Any consumer that read the field
  by its declaration — `expand`, an owner column in a report, an audit timeline
  showing "who changed this" — got an id that could not be dereferenced.

  It had already cost twice. #4441 had to exempt every `readonly` field from the
  write-path referential-integrity check, because otherwise ordinary metadata
  authoring (package create / publish / clone) was rejected. #4551's
  dangling-reference audit had to skip the same set for the same reason. The
  field ended up the platform's only reference column that is neither enforced
  nor audited.

  **The fix is on the write path, not the declaration.** `recorded_by` stays a
  `lookup('sys_user')`; an actor-less write now stores `NULL`, and `NULL` means
  "system-initiated (boot sync, migration, scheduled job)" — the standard
  expression of "no link", and already what this column's `set_null` delete
  behaviour means. No magic system-user account (a row that can never sign in yet
  holds an identity is a new security surface), and no `actor_kind` companion
  column.

  **Breaking — the repository contract is now explicitly nullable.**

  | Surface                                   | Before   | After                                 |
  | :---------------------------------------- | :------- | :------------------------------------ |
  | `PutOptions.actor`, `DeleteOptions.actor` | `string` | `string \| null` (still **required**) |
  | `MetadataEvent.actor`                     | `string` | `string \| null`                      |
  | `MetadataItem.authoredBy`                 | `string` | `string \| null`                      |

  `actor` stays required rather than becoming optional on purpose: every call
  site must state which of the two it is, so a forgotten actor cannot silently
  become a fake foreign key. Migrating a caller:

  - **Writers** — passing a real identity: unchanged. Passing `'system'`, `''`,
    or a label to satisfy the type: pass `null` instead.
  - **Readers** — `event.actor` and `item.authoredBy` can be `null`. Handle it at
    the point of display (`actor ?? 'System'` in a UI string is fine — the fix is
    that the _stored_ value no longer lies, not that no label may ever be shown).

  Two read paths also stopped inventing a value: `SysMetadataRepository.history()`
  and `getByHash()` rendered an absent actor as the string `'unknown'`, which is
  indistinguishable from a real user id to anything that resolves the field. They
  now surface `null`.

  **Existing rows: `os migrate recorded-by`.** The stored `'system'` values are
  rewritten to `NULL` by a new command, which runs the conversion through the
  ADR-0119 D2 migration journal (chunk-atomic, resumable via `os migrate resume`).
  It is a dry run by default and safe to re-run — it selects only rows still
  holding the sentinel, so a second `--apply` converts nothing.

  The rewrite is **semantically equivalent, not a reinterpretation**: this column
  has only ever held that one sentinel, written by exactly one expression
  (`actor ?? 'system'`), and both spellings mean "no actor" — only `NULL` is
  expressible in the declared type.

  Deliberately unchanged: `sys_metadata_audit.actor` is a `text` column whose
  declaration already says "user id, system id, or `'system'`", so its `'system'`
  default is honest and stays. The #4441 `readonly` narrowing and the #4551 audit
  skip also stay — see the PR for why they are still correct.

- ce92674: feat(spec)!: retire the standalone `validation` metadata kind (#4509, ADR-0088)

  A validation rule authored as its own artifact bound to nothing and gated no
  write. `ValidationRuleSchema` carries **no object-binding key** — no `object`,
  no `objectName` — and all six variants are `strictObject`, so an author could
  not supply one either. No merge step existed. The only code that expected such a
  key was a reference-tracker row scanning a field the schema would have stripped.
  Meanwhile the engine evaluates exactly one shape: the object's own
  `validations[]` array, on insert and on every matched update row.

  So a rule created through the standalone door — a `*.validation.ts` file, or
  Studio's Validations list — parsed, saved, reported success, and intercepted
  nothing. Including a `state_machine` rule, which ADR-0020 routes through this
  same vocabulary: an author could believe they had locked down record state
  transitions and have changed nothing at all.

  Under ADR-0088 the kind fails the admission test on its first clause: a rule has
  no independent lifecycle, because it only means something against an object. And
  unlike the sibling disconnects closed in this batch, it could not be bridged into
  one — the shape has nowhere to name its object.

  **The rule vocabulary is untouched.** `ValidationRuleSchema` and all six
  variants are unchanged and fully live; the engine's evaluation path is not
  modified by this change. It is the _kind_ that was inert, not the schema. The
  liveness ledger keeps governing it through the gate's `SPEC_ONLY_SCHEMAS`
  override (alongside `webhook` and `query`), because an ungoverned live schema is
  exactly how the next drift would hide.

  **Migration.** Move the rule into the owning object's `validations:` array — the
  rule body is identical, same schema, same six variants:

  ```ts
  // before — a standalone *.validation.ts, which never ran
  export default defineValidation({ name: 'amount_positive', type: 'script', … })

  // after — on the object, where rules are evaluated
  ObjectSchema.create({
    name: 'invoice',
    validations: [{ name: 'amount_positive', type: 'script', … }],
  })
  ```

  Removed: the registry entry (and its `*.validation.ts` / `*.validation.yml`
  patterns), the `MetadataTypeSchema` member, the metadata-core lockstep enum
  member, the schema-map entry, the create seed, Studio's Validations nav item and
  its hand-crafted form, and the dangling reference-tracker row. Standalone rows
  already in `sys_metadata` are left alone — they were never evaluated, so nothing
  changes behaviorally.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- f5a4ef0: refactor!: ADR-0112 batch 2 — sweep the lowercase error-code emitters (#4003)

  Continues #3841 per ADR-0112. Batch 1 (#3988) settled the vocabulary and closed
  the set; this batch moves the emitters that still spoke lowercase `snake_case`
  onto it.

  **Wire-visible change.** Error codes on these surfaces change spelling. Generic
  conditions collapse onto the standard catalog rather than keeping a synonym:
  `unauthorized`/`unauthenticated` → `UNAUTHENTICATED`, `forbidden` →
  `PERMISSION_DENIED`, `not_found` → `RESOURCE_NOT_FOUND`, `internal` →
  `INTERNAL_ERROR`, `unavailable` → `SERVICE_UNAVAILABLE`, `not_supported` →
  `NOT_IMPLEMENTED`, `bad_request` → `INVALID_REQUEST`. Domain conditions get codes
  registered in `ERROR_CODE_LEDGER` (`MARKETPLACE_STORAGE_FAILED`,
  `PLUGIN_MANIFEST_INVALID`, `ITEM_LOCKED`, `DELIVERY_NOT_ELIGIBLE`, …). Swept:
  `cloud-connection`, `plugin-auth`, `hono`, `metadata-protocol`, `rest`,
  `service-messaging`, `service-automation`, `trigger-api`.

  Branch on `error.code` values rather than pattern-matching their case: the
  console's fix for the same rename (objectui#2977) reads codes case-insensitively
  for exactly this reason, and that is the pattern to copy in your own consumers if
  you support servers on both sides of the change.

  **Four routes stop putting a code in the message slot.** The webhook redeliver
  route, the API-trigger webhook, and two `rest` routes answered
  `{ success: false, error: '<code>', message }` — the code occupying `error`, the
  declared object envelope nowhere. They now emit `error: { code, message }`, and
  three API-trigger branches gained a message they never had. Clients reading
  `body.error` as a string on those routes must read `body.error.code`.

  **`ConnectorErrorCategory` / `ConnectorRetryStrategy`** (ADR-0112 D9a):
  `@objectstack/spec` exported two mutually incompatible `ErrorCategory` types and
  two `RetryStrategy` types. The connector-side pair is renamed; importers of the
  `integration` subpath update the name. Side effect: the api-side `ErrorCategory`
  and `RetryStrategy` now appear in the generated API reference at all — the name
  collision had been silently dropping them.

  **`OAUTH_REGISTER_FAILED` replaces an unbounded code source.** The OAuth client
  registration route put better-auth's arbitrary `body.error` string straight into
  `error.code`. The code is now ours and the upstream discriminator moved to
  `details.upstreamError`.

  **Not swept, deliberately.** `sys_metadata_audit.code` keeps its lowercase values
  (ADR-0112 D6b): it is persisted audit history, and the same column holds
  non-error outcomes (`ok`, `lock_override`). Diagnostics records that ship inside a
  200 keep theirs (D6c), as do field-level codes (D6, #3977) and the CLI's
  `--json` output contract.

  A `check:error-code-casing` CI guard now fails on a new lowercase literal in a
  code position, since the ledger's casing rule can only police codes that someone
  registers.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- db48ad5: fix(security,approvals,metadata-core): restore batch routes on the eight objects the #3391 P1 companion fix missed (#3026)

  The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`: a batch
  request is admitted only when the object grants the `bulk` **primitive** and the
  batched child operation is itself allowed. Before that, the `*Many` routes
  checked only the child verb, so a boilerplate CRUD-five whitelist
  (`['get','list','create','update','delete']`) batched fine.

  The companion fix — adding the `bulk` primitive wherever an explicit whitelist
  survived — was applied only inside `platform-objects`. Eight objects carrying
  the same boilerplate live in other packages and kept the gap, so `/batch`,
  `createMany`, `updateMany` and `deleteMany` answered `405
OBJECT_API_METHOD_NOT_ALLOWED` on objects whose single-record create/update/
  delete were wide open. `data-objectstack` rethrows that 405 without falling back
  to per-row writes, which surfaced as a hard error on multi-select delete in the
  Setup grids.

  Objects reclaimed (whitelist now `['get','list','create','update','delete','bulk']`):
  `sys_capability`, `sys_permission_set`, `sys_position`,
  `sys_position_permission_set`, `sys_user_permission_set`, `sys_user_position`
  (plugin-security); `sys_approval_delegation` (plugin-approvals);
  `sys_view_definition` (metadata-core).

  No new authority is granted: `bulk` only permits batching verbs each object
  already exposes one record at a time, and every batched row still passes the
  same row- and field-level permission checks. The whitelists stay explicit rather
  than being deleted — seven of the eight are `managedBy`, and
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so dropping the line would silently disable the managed-write
  backstop.

- c073b8c: refactor(metadata-core): drop `sys_view_definition`'s all-six `apiMethods` whitelist (#3026)

  #3745 completed this object's boilerplate CRUD-five whitelist to all six
  primitives so its batch routes stopped 405-ing. A whitelist naming all six is
  equivalent to no whitelist — except it stops tracking primitives the enum grows
  later — so the #3543 audit rule applies and the declaration is removed.

  No behaviour change: `undefined` resolves to `unrestricted`, whose effective
  operation set is identical to `restricted` holding all six.

  Removing it is safe HERE specifically because the object has no `managedBy`:
  `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
  `apiMethods`, so for a managed object an absent whitelist would take the
  managed-write backstop with it. That is why the RBAC objects reclaimed by #3745
  keep their explicit arrays and this one does not.

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0

## 16.0.0

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- 06cb319: fix(identity): close the generic-write apiMethods hole on sys_presence and sys_metadata (#3220)

  Follow-through on #1591/#3213 (better-auth apiMethods reconciliation) for two
  non-better-auth managed objects that shipped the same contradiction: their
  `enable.apiMethods` advertised generic `create`/`update`/`delete` while their
  `managedBy` bucket forbids user-context writes, leaving the generic `/data`
  route open to a write the bucket does not permit.

  - `sys_presence` (`managedBy: 'append-only'`) advertised `create`/`update`/`delete`
    (update/delete on an append-only object at that) but is written only over the
    realtime websocket/in-memory path, never through ObjectQL. Narrowed to
    `['get', 'list']`.
  - `sys_metadata` (`managedBy: 'system'`) advertised full CRUD but customization
    overlays are authored only through the metadata-protocol RPC (engine writes
    carry a transaction context, not a user session); neither the framework nor
    the Console (objectui) POSTs `/data/sys_metadata`. Narrowed to `['get', 'list']`.

  Reads stay open. The metadata-protocol / realtime write paths are engine-level
  and bypass the HTTP exposure gate, so they are unaffected — verified by the
  metadata-authoring dogfood and the objectql overlay tests.

  A blast-radius audit confirmed the broader `system`/`append-only` buckets are NOT
  safe to guard wholesale: several `system` objects (`sys_user_position`,
  `sys_user_permission_set`, `sys_position_permission_set`, `sys_user_preference`,
  `sys_import_job`) are legitimately user-writable by design (delegated
  administration, user preferences, imports). Generalizing the engine write guard
  to those buckets is intentionally NOT done here — see #3220 for the bucket-taxonomy
  root cause.

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0

## 16.0.0-rc.1

### Patch Changes

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 06cb319: fix(identity): close the generic-write apiMethods hole on sys_presence and sys_metadata (#3220)

  Follow-through on #1591/#3213 (better-auth apiMethods reconciliation) for two
  non-better-auth managed objects that shipped the same contradiction: their
  `enable.apiMethods` advertised generic `create`/`update`/`delete` while their
  `managedBy` bucket forbids user-context writes, leaving the generic `/data`
  route open to a write the bucket does not permit.

  - `sys_presence` (`managedBy: 'append-only'`) advertised `create`/`update`/`delete`
    (update/delete on an append-only object at that) but is written only over the
    realtime websocket/in-memory path, never through ObjectQL. Narrowed to
    `['get', 'list']`.
  - `sys_metadata` (`managedBy: 'system'`) advertised full CRUD but customization
    overlays are authored only through the metadata-protocol RPC (engine writes
    carry a transaction context, not a user session); neither the framework nor
    the Console (objectui) POSTs `/data/sys_metadata`. Narrowed to `['get', 'list']`.

  Reads stay open. The metadata-protocol / realtime write paths are engine-level
  and bypass the HTTP exposure gate, so they are unaffected — verified by the
  metadata-authoring dogfood and the objectql overlay tests.

  A blast-radius audit confirmed the broader `system`/`append-only` buckets are NOT
  safe to guard wholesale: several `system` objects (`sys_user_position`,
  `sys_user_permission_set`, `sys_position_permission_set`, `sys_user_preference`,
  `sys_import_job`) are legitimately user-writable by design (delegated
  administration, user preferences, imports). Generalizing the engine write guard
  to those buckets is intentionally NOT done here — see #3220 for the bucket-taxonomy
  root cause.

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0

## 14.4.0

### Minor Changes

- 7953832: ADR-0057 data lifecycle P1–P4 (#2786): platform-generated data is now bounded by construction.

  - **P1 — contract**: new `lifecycle` object property (`class: record | audit | telemetry | transient | event` + `retention` / `ttl` / `storage(rotation)` / `archive` / `reclaim`), enforced by the platform-owned **LifecycleService** registered by `ObjectQLPlugin` (default-on; disable via `OS_LIFECYCLE_DISABLED=1` or plugin `lifecycle.enabled=false`). The Reaper batch-deletes rows past `retention.maxAge` / `ttl` under a system context and reclaims space (`SqlDriver.reclaimSpace()` → SQLite `PRAGMA incremental_vacuum`). Non-`record` classes must declare a bounding policy (parse-time invariant + spec-liveness gate + dogfood storage-growth gate).
  - **P2 — rotation**: `storage: { strategy: 'rotation', shards, unit }` physically time-shards the table on SQLite — writes land in the current shard, reads go through a UNION-ALL view under the base name, expiry is an O(1) `DROP` of shards past the window. A legacy table is adopted as the first shard on upgrade. Other dialects fall back to an equivalent age-based reap.
  - **P3 — separation + Archiver**: registering a datasource named `telemetry` routes telemetry/event/audit objects to it (opt-in by existence; `transient` deliberately stays on the primary). Audit objects with `archive` declared get retain → archive → delete once the archive datasource exists; without it rows are retained, never dropped unarchived.
  - **P4 — governance**: new `lifecycle` settings namespace — runtime enable switch, per-object retention overrides (tenant-scoped: regulated tenants set years, dev sets days), per-object/per-class row quotas and growth alerts (observe-and-alert only).

  **Behavior change**: 11 platform objects now carry lifecycle declarations and their telemetry is bounded by default — `sys_activity` 14d (rotated), `sys_audit_log` 90d hot → archive (retained forever until an `archive` datasource is registered), `sys_metadata_audit` 365d → archive, `sys_job_run` / `sys_automation_run` / `sys_http_delivery` 30d, notification pipeline (`sys_notification`, delivery, receipt, inbox) 90d, `sys_device_code` expires_at + 1d. Extend windows per environment/tenant via the `lifecycle.retention_overrides` setting.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0

## 13.0.0

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0

## 12.4.0

### Minor Changes

- 60dc3ba: ADR-0087 P0 — enforce the protocol version handshake (make `engines.protocol` real).

  `PluginEnginesSchema.protocol` (ADR-0025 §3.2, protocol-first per §3.10 #3) was declared, documented, and checked by no loader or installer — an ADR-0078 "declarable-but-inert" violation. A package built against an incompatible protocol major failed deep in a schema `.parse()` or a renderer contract instead of at the boundary.

  - **`@objectstack/spec`**: exports `PROTOCOL_VERSION` / `PROTOCOL_MAJOR` (`kernel`) — the single source of truth the handshake checks against. A drift test keeps it in lockstep with the package major.
  - **`@objectstack/metadata-core`**: adds `checkProtocolCompat()` (pure, major-grained range check), `assertProtocolCompat()`, and the structured `ProtocolIncompatibleError` (`OS_PROTOCOL_INCOMPATIBLE`, carrying both versions and the `objectstack migrate meta --from N` command). It refuses only on a _positive_ mismatch determination; absent ranges are grandfathered (warn) and unrecognized ranges never cause a false rejection.
  - **`@objectstack/metadata-protocol`**: `installPackage` runs the handshake before writing to the registry — an incompatible package is refused with a machine-actionable diagnostic instead of crashing later.

  Additive and backward compatible: packages that declare no `engines.protocol` range keep loading (with a warning). Part of the ADR-0087 epic (#2643); resolves #2644.

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0

## 12.2.0

### Minor Changes

- da807f7: feat(spec)!: retire the placeholder metadata kinds `trigger`, `router`, `function`, `service` (ADR-0088).

  The registry is the contract authors — human and AI — read to learn what can be authored, and these four kinds had no authoring surface, no loader, no schema, and no (or a dead) consumer. `MetadataTypeSchema` + `DEFAULT_METADATA_TYPE_REGISTRY` shrink 30 → 26; `OPS_FILE_SUFFIX_REGEX` drops the four suffixes; the dormant objectql load path that registered QL functions from `type: 'function'` metadata items is removed (`defineStack({ functions })` / plugin `contributes.functions` remain the delivered forms); the metadata-core lockstep enum follows. `external_catalog` stays and is now annotated RUNTIME-CREATED (ADR-0062): its lack of an authoring surface is correct design. The delivered replacements: `hook` / `record_change` flows (trigger), plugin `contributes.routes` + declarative `apis:` (router), `defineStack({ functions })` (function), the plugin/service registry (service). Persisted `sys_metadata` rows are unaffected — no production read path re-parses stored `type` values through the enum.

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0

## 11.8.0

### Patch Changes

- @objectstack/spec@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0

## 11.0.0

### Minor Changes

- 4d99a5c: Package-scoped commit history & rollback for AI authoring (ADR-0067)

  Each authoring apply now lands as one revertible **commit** on a package timeline, on top of `sys_metadata_history`:

  - New `sys_metadata_commit` object groups a turn's metadata changes (by `event_seq` range).
  - `publishPackageDrafts` records each publish as one commit (best-effort) with a per-artifact revert plan and an optional `message` / `aiModel`.
  - New protocol methods `listCommits`, `revertCommit`, `rollbackToPackageCommit` (reusing `restoreVersion` + delete; a revert is itself an append-only commit).
  - New REST routes: `GET /packages/:id/commits`, `POST /packages/:id/commits/:commitId/revert`, `POST /packages/:id/rollback`.

### Patch Changes

- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0

## 9.4.0

### Minor Changes

- fef38ec: feat(metadata): package-scoped customization overlays (ADR-0048 #1824)

  A `sys_metadata` customization overlay is now keyed by `(type, name,
organization_id, package_id)`, so two installed packages shipping an item of the
  same `type`/`name` can each carry their **own** overlay. Previously the overlay
  uniqueness key was `(type, name, organization_id)` — physically one row per
  name — so customizing one package's item shadowed both, and a package-scoped
  read fell back to whichever row existed.

  - **Index**: `idx_sys_metadata_overlay_active` / `…_draft` now include
    `package_id`. The runtime migration (`ensureOverlayIndex`) uses
    `COALESCE(package_id, '')` so package-less (global) overlays stay unique among
    themselves (a plain unique index treats NULLs as distinct). DROP-then-CREATE,
    idempotent; existing rows migrate safely (the old key already guaranteed one
    row per `(type, name, org)`).
  - **Write**: `SysMetadataRepository.whereFor`/`put`/`get` scope the upsert to the
    requested package, so a save bound to package B no longer finds and overwrites
    package A's same-name overlay. A package-less save (`packageId` null) targets
    the global row.
  - **Read**: `getMetaItem` / `getMetaItemLayered` overlay lookups already prefer
    the package-scoped row; the fallback now resolves only the **global**
    (`package_id IS NULL`) overlay, never a _different_ package's row. Package-less
    readers are unchanged (match-any, back-compat).

  Verified live against a real collision (two packages each shipping
  `page/showcase_task_workbench`): two overlay rows coexist, and `?package=` single
  reads + the `?layers=true` Studio editor view each return that package's own
  overlay; the unique index migrated in place.

  Known follow-up: the _unscoped list_ (`GET /meta/:type` with no `?package=`)
  still dedupes by bare name, so when two packages both carry an overlay on the
  same name the list collapses them — the per-package single-item and editor paths
  are unaffected. Tracked for the list-dedup-by-name work.

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0

## 7.7.0

### Patch Changes

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0

## 7.6.0

## 7.5.0

## 7.4.1

## 7.4.0

## 7.3.0

## 7.2.1

## 7.2.0

## 7.1.0

## 7.0.0

## 6.9.0

## 6.8.1

## 6.8.0

## 6.7.1

## 6.7.0

## 6.6.0

## 6.5.1

## 6.5.0

## 6.4.0

## 6.3.0

## 6.2.0

## 6.1.1

## 6.1.0

## 6.0.0

## 5.2.0

### Patch Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

## 5.1.0

### Minor Changes

- 75f4ee6: feat(metadata): introduce `executionPinned` capability for runtime version pinning (ADR-0009)

  Adds a new capability flag on the metadata type registry so that types whose runtime
  transaction rows reference a specific historical version (flow, workflow, approval)
  get unified pinning behavior — instead of every business table re-implementing its
  own snapshot column.

  - `MetadataTypeRegistryEntrySchema` gains `executionPinned: boolean`, enforced
    invariant `executionPinned ⇒ supportsVersioning`.
  - `flow`, `workflow`, `approval` flipped to `executionPinned: true`. `approval`
    also corrected to `supportsVersioning: true` (it was wrongly `false`).
  - `MetadataRepository.getByHash(ref, hash)` added to the interface. Production
    implementation in `SysMetadataRepository` resolves historical bodies through
    `sys_metadata_history` keyed by `(organization_id, type, name, checksum)`.
    In-memory and FS repositories serve HEAD-only matches.
  - `sys_metadata_history` gains an index on `(organization_id, type, name, checksum)`
    to keep hash lookups O(log n).
  - `HistoryCleanupManager` skips pinned types entirely (both age-based and
    count-based retention) — pinned-type history must never be GC'd.

  See `docs/adr/0009-execution-pinned-metadata.md` for full rationale and the
  list of rejected alternatives (no shared snapshot table, no inlined snapshot column).

## 5.0.0

### Minor Changes

- 5e9dcb4: **BREAKING — metadata: remove `project` and `branch` from `MetaRef`**

  The metadata layer no longer models project or branch. Customisation is now
  scoped purely to **organisation**. Project remains exclusively as an artifact
  packaging concept (the `objectstack.json` bundle envelope); branching is left
  to Git.

  What changed:

  - `MetaRef` is now `{ org, type, name, version? }` (was
    `{ org, project, branch, type, name, version? }`). `refKey()` is the two
    segment string `${org}/${type}/${name}` (was five segments).
  - `MetadataItem.seq` is monotonic **per org** (was per branch).
  - `BranchRef`, `MergeStrategy`, `MergeResult` types and the optional
    `fork`/`merge` methods on `MetadataRepository` are removed.
  - `ListFilter` / `WatchFilter` / `HistoryOptions` no longer accept `project`
    or `branch`.
  - `FileSystemRepository` disk layout simplified to
    `<root>/<type>/<name>.json` (was `<root>/<project>/<branch>/<type>/<name>.json`);
    change-log path is now `.objectstack/.log/main.jsonl` regardless of any
    branch concept. Constructor no longer accepts `project` / `branch`.
  - `SysMetadataRepository`: removed `projectLabel` / `branchLabel` options;
    the `sys_metadata` schema's `project_id` / `branch` columns (if present)
    are ignored. A future major release will `DROP` them.
  - `MetadataManager.setRepository(repo, opts)` no longer takes an opts object
    with `branch`.

  Migration:

  ```diff
  -const ref = { org: 'acme', project: 'crm', branch: 'main', type: 'view', name: 'home' };
  +const ref = { org: 'acme', type: 'view', name: 'home' };

  -new FileSystemRepository({ root, org: 'acme', project: 'crm', branch: 'main' });
  +new FileSystemRepository({ root, org: 'acme' });
  ```

  Existing `sys_metadata` rows continue to load; the deprecated columns are
  ignored at read time.

- 4150fe4: Add `MetadataCache` — bounded, event-invalidated LRU sitting in front of
  any `MetadataRepository`. Features:

  - Bounded by `maxEntries` and `maxBytes` (default 1024 / 8 MiB).
  - LRU eviction with touch-on-read.
  - Lazy fill on read miss; negative caching for known-absent items.
  - Subscribes to `repo.watch(filter)` and invalidates affected entries
    (including rename: both old and new keys).
  - Coalesces concurrent reads for the same key onto a single backend
    fetch (thundering-herd safe).
  - Generation counter discards in-flight fetches that race an
    invalidation, preventing stale-cache poisoning.
  - Diagnostics via `getStats()` (entries, bytes, hits, misses,
    invalidations, coalesced).

  Includes a property-based test that verifies cache→repo convergence
  under randomly-generated update sequences.

  See ADR-0008 §10 PR-3.

- 8337cdb: Add `InMemoryRepository` (reference implementation) and a parameterised
  Repository contract test suite. The contract suite, exposed at
  `@objectstack/metadata-core/testing`, verifies the seven invariants every
  backend must satisfy (atomic put, monotonic seq per branch, optimistic
  locking, canonical hashing, event ordering, watch resumability,
  tombstones).

  Includes implementation-specific tests covering the injected clock,
  canonical-hash insertion-order independence, and deep-copy isolation
  between caller and store.

  See ADR-0008 §10 PR-2.

- 58835a6: Add `LayeredRepository` — composes N `MetadataRepository`s into a
  read-through stack. Reads walk top-to-bottom; writes route to the
  topmost writable layer; `list()` deduplicates by `refKey` preferring
  the top; `history()` and `watch()` merge events from all layers,
  tagging each event's `source` with `<layer>:<original-source>`. The
  multiplexed `watch()` correctly cancels all child iterators when the
  consumer calls `return()`.

  Enables the canonical "system built-ins under user overlay" pattern
  described in ADR-0008.

  See ADR-0008 §10 PR-5.

- 8cc30b4: New package: Repository contracts for the metadata lifecycle (ADR-0008).

  Definitions only — no I/O. Exports Zod schemas, the
  `MetadataRepository` interface, canonical-form helpers
  (`canonicalize`, `hashSpec`), and typed errors (`ConflictError`,
  `NotFoundError`, `SchemaValidationError`).

  This is M0 PR-1 of the four-layer metadata refactor. Subsequent PRs
  add `InMemoryRepository`, `MetadataCache`, `FileSystemRepository`
  and migrate the existing `MetadataManager` / HMR plumbing onto the
  new contracts.

### Patch Changes

- 32ce912: Add `@objectstack/metadata-fs` — Node-only `FileSystemRepository`
  implementation of the M0 Repository contract.

  Layout:

  ```
  <root>/
    <type>/<name>.json          # canonical body (atomic rename writes)
    .objectstack/.log/<branch>.jsonl   # append-only change log
  ```

  Features:

  - All 17 contract tests pass (`singleBranch: true`).
  - Per-key serialization via `KeyedMutex`.
  - Atomic writes via tmpfile + rename.
  - Heads and `seq` recovered from the JSONL log on `start()` — survives
    process restart.
  - chokidar watcher translates external edits (e.g. VSCode saves) into
    `MetadataEvent`s with `source: 'fs'`.
  - Self-write suppression: 200ms window prevents the watcher from
    re-emitting events for files we wrote ourselves.
  - Manual `AsyncIterator` for `watch()` to mirror the in-memory pattern.

  Also (`metadata-core`):

  - Add `singleBranch` option to `runRepositoryContractTests` so
    single-branch backends (like the FS one) skip the cross-branch test.
  - Switch tsup `splitting: true` so `index.js` and `testing.js` share a
    single `ConflictError` class identity (was double-bundled before).

  See ADR-0008 §10 PR-4.
