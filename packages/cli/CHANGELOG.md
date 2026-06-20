# @objectstack/cli

## 9.11.0

### Minor Changes

- c651f38: feat(cli): warn on unrecognized autonumber format tokens

  `objectstack compile` now flags `autonumber` formats whose `{...}` token is not a
  counter (`{0000}`), date (`{YYYY}`/`{MM}`/…) or `{field}` token — an unrecognized
  group (wrong case, spaces, punctuation, or a second sequence slot) renders
  LITERALLY into the record number, which is a silent footgun for AI-authored
  templates. Emitted as an advisory warning (`autonumber-unrecognized-token`),
  alongside the existing `{field}`-reference checks. The `objectstack-data` skill's
  `field-types` rules were also expanded to document the date/`{field}`/per-scope
  tokens and the authoring rules (required interpolated fields, delimited adjacent
  tokens, pad width is a minimum, date tokens are exact).

- 36138c7: feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

  `autonumberFormat` previously only understood a single `{0000}` sequence slot —
  everything else was a fixed literal prefix on one global counter. Real MES/eHR
  record numbers need three more token classes, so the format is now tokenized by a
  shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
  `renderAutonumber`) that the engine fallback and the SQL driver both call, so they
  emit byte-identical numbers (#1603 parity):

  - **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
    day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
    UTC fallback), threaded through the new `DriverOptions.timezone`.
  - **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
    field values into the prefix.
  - **Per-scope counter reset** — the counter's scope is the rendered prefix _before_
    the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
    numbers per group, and `{plan_no}{000}` numbers per parent — all from one
    mechanism, no separate reset config.

  Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
  global counter, so existing sequences are unchanged. The persistent
  `_objectstack_sequences` table is keyed by a `key_hash` (SHA-256 of
  `object, tenant_id, field, scope`) — a single 64-char primary key that keys every
  dialect uniformly, stays within MySQL's utf8mb4 index-length limit (four raw
  columns would not), and lets `scope` be a generous non-indexed column. Deployments
  with an older table (3-column, or an interim `scope` column) are migrated in place
  on first use, carrying existing counters to `scope=''`.

  Guardrails:

  - **Empty interpolated field is a hard error, not a silent mis-number.** A
    `{field}` token whose value is missing at create time would render to an empty
    prefix and collapse the record into the wrong counter scope. Both the SQL driver
    and the engine fallback now refuse to generate and throw a clear error naming the
    empty field (shared `missingFieldValues` helper).
  - **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
    checked against the object's fields: a `{field}` token naming a non-existent
    field (or the autonumber field itself) **fails the build**; a token naming an
    _optional_ field emits an advisory warning to mark it `required: true`.
  - **Migration fails safe.** If a legacy table cannot be migrated to the `key_hash`
    shape, fixed-prefix sequences keep working via the legacy key and a per-scope
    write raises an actionable error instead of corrupting counters.
  - **Long `{field}` scopes are supported** (e.g. a long `{plan_no}`): the non-indexed
    `scope` column and hashed key remove the old varchar/PK length ceiling.

  Notes on inherent semantics (documented, not bugs):

  - The counter scope IS the rendered prefix. When two records' tokens render to the
    same prefix string (e.g. `{a}{b}` for `('AB','C')` and `('A','BC')`) they also
    render the same visible number, so they share one counter to stay unique — the
    remedy for genuinely-distinct groups is an unambiguous format (a delimiter
    literal between variable tokens).
  - The sequence pad width is a MINIMUM; past it the number grows (`{000}` →
    `1000`), it never wraps — matching mainstream autonumber semantics.

- fd2e1a2: Add `@objectstack/verify` — boot any ObjectStack app in-process and verify it through the real HTTP stack: auto-derived CRUD round-trip fidelity (`runCrudVerification`) plus the cross-owner RLS invariant (`runRlsProofs`, "you can't write what you can't read"). Also adds an `objectstack verify` CLI command that runs these proofs against an app config and exits non-zero on real failures.

  Extracted from the internal dogfood regression gate so third-party and template authors can run the same runtime proofs against their own apps. The private `@objectstack/dogfood` package now consumes this library for its golden regression tests.

### Patch Changes

- 5a5a9fe: feat(security): public-form demo (Option A) + app-declared default profile wiring (ADR-0056 D7)

  Wires ADR-0056's app-declarable default profile through the CLI so it actually
  takes effect under `pnpm dev`. `@objectstack/plugin-security` exports a new
  `appDefaultProfileName(permissions)` helper that extracts the first
  `isProfile && isDefault` profile name from a stack; `@objectstack/cli` (`serve.ts`)
  passes it as the SecurityPlugin `fallbackPermissionSet` (undefined → built-in
  `member_default` preserved, so apps that declare no default are unaffected).

  The showcase gains a working web-to-lead **public form** (`showcase_inquiry` +
  an `allowAnonymous` FormView authorized by the declaration-derived
  `publicFormGrant`, no `guest_portal` profile) and an app-declared default
  profile (`showcase_member_default`), each covered by a dogfood proof over the
  real HTTP stack.

- Updated dependencies [e7f6539]
- Updated dependencies [e7f6539]
- Updated dependencies [fa8964d]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [751f5cf]
- Updated dependencies [5a5a9fe]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
- Updated dependencies [a8e4f3b]
- Updated dependencies [fd2e1a2]
  - @objectstack/spec@9.11.0
  - @objectstack/plugin-sharing@9.11.0
  - @objectstack/rest@9.11.0
  - @objectstack/plugin-security@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/driver-sql@9.11.0
  - @objectstack/verify@9.11.0
  - @objectstack/runtime@9.11.0
  - @objectstack/account@9.11.0
  - @objectstack/setup@9.11.0
  - @objectstack/studio@9.11.0
  - @objectstack/client@9.11.0
  - @objectstack/cloud-connection@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/formula@9.11.0
  - @objectstack/mcp@9.11.0
  - @objectstack/observability@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/driver-memory@9.11.0
  - @objectstack/driver-mongodb@9.11.0
  - @objectstack/driver-sqlite-wasm@9.11.0
  - @objectstack/plugin-approvals@9.11.0
  - @objectstack/plugin-audit@9.11.0
  - @objectstack/plugin-auth@9.11.0
  - @objectstack/plugin-email@9.11.0
  - @objectstack/plugin-hono-server@9.11.0
  - @objectstack/plugin-org-scoping@9.11.0
  - @objectstack/plugin-reports@9.11.0
  - @objectstack/plugin-webhooks@9.11.0
  - @objectstack/service-ai@9.11.0
  - @objectstack/service-analytics@9.11.0
  - @objectstack/service-automation@9.11.0
  - @objectstack/service-cache@9.11.0
  - @objectstack/service-datasource@9.11.0
  - @objectstack/service-job@9.11.0
  - @objectstack/service-messaging@9.11.0
  - @objectstack/service-package@9.11.0
  - @objectstack/service-queue@9.11.0
  - @objectstack/service-realtime@9.11.0
  - @objectstack/service-settings@9.11.0
  - @objectstack/service-storage@9.11.0
  - @objectstack/trigger-api@9.11.0
  - @objectstack/trigger-record-change@9.11.0
  - @objectstack/trigger-schedule@9.11.0
  - @objectstack/types@9.11.0
  - @objectstack/console@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [d9508d1]
- Updated dependencies [1d352d3]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [f169558]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/service-analytics@9.10.0
  - @objectstack/driver-sql@9.10.0
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/plugin-org-scoping@9.10.0
  - @objectstack/plugin-security@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/runtime@9.10.0
  - @objectstack/rest@9.10.0
  - @objectstack/driver-sqlite-wasm@9.10.0
  - @objectstack/service-datasource@9.10.0
  - @objectstack/account@9.10.0
  - @objectstack/setup@9.10.0
  - @objectstack/studio@9.10.0
  - @objectstack/client@9.10.0
  - @objectstack/cloud-connection@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/mcp@9.10.0
  - @objectstack/observability@9.10.0
  - @objectstack/driver-memory@9.10.0
  - @objectstack/driver-mongodb@9.10.0
  - @objectstack/plugin-approvals@9.10.0
  - @objectstack/plugin-audit@9.10.0
  - @objectstack/plugin-auth@9.10.0
  - @objectstack/plugin-email@9.10.0
  - @objectstack/plugin-hono-server@9.10.0
  - @objectstack/plugin-reports@9.10.0
  - @objectstack/plugin-sharing@9.10.0
  - @objectstack/plugin-webhooks@9.10.0
  - @objectstack/service-ai@9.10.0
  - @objectstack/service-automation@9.10.0
  - @objectstack/service-cache@9.10.0
  - @objectstack/service-job@9.10.0
  - @objectstack/service-messaging@9.10.0
  - @objectstack/service-package@9.10.0
  - @objectstack/service-queue@9.10.0
  - @objectstack/service-realtime@9.10.0
  - @objectstack/service-settings@9.10.0
  - @objectstack/service-storage@9.10.0
  - @objectstack/trigger-api@9.10.0
  - @objectstack/trigger-record-change@9.10.0
  - @objectstack/trigger-schedule@9.10.0
  - @objectstack/types@9.10.0
  - @objectstack/console@9.10.0

## 9.9.1

### Patch Changes

- Updated dependencies [4f5c9c3]
  - @objectstack/console@9.9.1
  - @objectstack/spec@9.9.1
  - @objectstack/cloud-connection@9.9.1
  - @objectstack/core@9.9.1
  - @objectstack/client@9.9.1
  - @objectstack/types@9.9.1
  - @objectstack/objectql@9.9.1
  - @objectstack/observability@9.9.1
  - @objectstack/formula@9.9.1
  - @objectstack/platform-objects@9.9.1
  - @objectstack/studio@9.9.1
  - @objectstack/setup@9.9.1
  - @objectstack/runtime@9.9.1
  - @objectstack/rest@9.9.1
  - @objectstack/driver-memory@9.9.1
  - @objectstack/driver-sql@9.9.1
  - @objectstack/driver-mongodb@9.9.1
  - @objectstack/driver-sqlite-wasm@9.9.1
  - @objectstack/plugin-approvals@9.9.1
  - @objectstack/plugin-audit@9.9.1
  - @objectstack/plugin-auth@9.9.1
  - @objectstack/plugin-email@9.9.1
  - @objectstack/plugin-hono-server@9.9.1
  - @objectstack/mcp@9.9.1
  - @objectstack/plugin-org-scoping@9.9.1
  - @objectstack/plugin-reports@9.9.1
  - @objectstack/plugin-security@9.9.1
  - @objectstack/plugin-sharing@9.9.1
  - @objectstack/plugin-webhooks@9.9.1
  - @objectstack/trigger-record-change@9.9.1
  - @objectstack/trigger-api@9.9.1
  - @objectstack/trigger-schedule@9.9.1
  - @objectstack/service-ai@9.9.1
  - @objectstack/service-analytics@9.9.1
  - @objectstack/service-automation@9.9.1
  - @objectstack/service-cache@9.9.1
  - @objectstack/service-datasource@9.9.1
  - @objectstack/service-job@9.9.1
  - @objectstack/service-messaging@9.9.1
  - @objectstack/service-package@9.9.1
  - @objectstack/service-queue@9.9.1
  - @objectstack/service-realtime@9.9.1
  - @objectstack/service-settings@9.9.1
  - @objectstack/service-storage@9.9.1
  - @objectstack/account@9.9.1

## 9.9.0

### Minor Changes

- 97ecfdd: feat(cli): lint `metadata` doc embeds (ADR-0051 P1) — validate every `metadata` fence body shape (type ∈ state_machine | flow | permission with did-you-mean, required name, object required for state_machine) and its same-package reference liveness (the referenced object + state_machine rule / flow / permission set must exist in the stack). A dead same-package reference is a build error, matching `docs/broken-link`.
- c102de2: feat(cli): auto-wire marketplace from `@objectstack/cloud-connection` when a cloud URL resolves

  ADR-0006 Phase 4 removed the framework CLI's duplicate marketplace plugins (they lived in `@objectstack/runtime`, duplicating the cloud distribution's copies). ADR-0008 then open-sourced the canonical client into the Apache-2.0 `@objectstack/cloud-connection` package, so the CLI can wire it again without crossing the open-core boundary — there is no longer a cloud-only copy to duplicate.

  `objectstack serve`/`dev`/`start` now mount `MarketplaceProxyPlugin` + `MarketplaceInstallLocalPlugin` + the same-origin cloud-connection surface + `RuntimeConfigPlugin` (single-env, `installLocal: true`) whenever `resolveCloudUrl()` is truthy. `OS_CLOUD_URL=off` (or unset) mounts nothing, preserving the vanilla marketplace-less `objectstack dev`. Skipped in runtime/host-kernel mode (the cloud `objectos-stack` wires its own proxy on the host kernel — detected via `ObjectOSEnvironmentPlugin`, mirroring the existing AuthPlugin guard).

  Fixes `objectstack start` empty-boot, which advertised "boot an empty kernel against your marketplace" but — having no config or artifact to carry the wiring — actually mounted no marketplace at all. The plugins self-register their Setup nav bundles, so Browse Marketplace + Installed Apps reappear automatically.

- 90108e0: feat(cli): liveness author-warning lint — close the spec-liveness loop on the author side.

  The liveness ledgers already classify every authorable property live/experimental/dead with evidence, and the CI gate enforces classification _completeness_ — but that knowledge never reached the person (very often an AI) writing the metadata. The new `compile` lint (`lint-liveness-properties.ts`) reads the ledgers and emits an advisory **warning** when an authored object/field sets a property that is misleading at runtime — e.g. `object.enable.feeds` (no feed runtime; comments live on sys_comment), `object.versioning` (no versioning engine), `field.columnName` (driver ignores it; column == field key), `field.maxRating`/`vectorConfig` (renderer reads a different key) — each with a corrective hint toward the supported alternative. Never fails the build (advisory only), consistent with the existing flow anti-pattern lint.

  Signal-over-noise by design: warnings are **opt-in per ledger entry** via a new `authorWarn`/`authorHint` annotation (plus `experimental` entries warn by default). Booleans warn only when set truthy, and only `default(false)` flags are marked, so schema defaults (`enable.trash`, `enable.searchable`) never trip it. Coverage grows by annotating more ledger entries, not by changing lint code; today it covers `object` (incl. `enable.*`) and `field`.

  - `@objectstack/spec`: ledger entries gain optional `authorWarn`/`authorHint`; `liveness/` is now shipped in the package `files` so the CLI can read it. Seeded annotations on the misleading object capability flags + aspirational blocks and the misleading dead field props. No schema/runtime change.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [0d4e3f3]
- Updated dependencies [8e5a3b5]
- Updated dependencies [44c5348]
- Updated dependencies [796f0d6]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [83fd318]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [b112416]
- Updated dependencies [d42004b]
- Updated dependencies [92d75ca]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/service-settings@9.9.0
  - @objectstack/plugin-auth@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/rest@9.9.0
  - @objectstack/driver-sql@9.9.0
  - @objectstack/runtime@9.9.0
  - @objectstack/service-automation@9.9.0
  - @objectstack/service-analytics@9.9.0
  - @objectstack/console@9.9.0
  - @objectstack/plugin-reports@9.9.0
  - @objectstack/plugin-security@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/plugin-email@9.9.0
  - @objectstack/account@9.9.0
  - @objectstack/setup@9.9.0
  - @objectstack/studio@9.9.0
  - @objectstack/client@9.9.0
  - @objectstack/cloud-connection@9.9.0
  - @objectstack/mcp@9.9.0
  - @objectstack/observability@9.9.0
  - @objectstack/platform-objects@9.9.0
  - @objectstack/driver-memory@9.9.0
  - @objectstack/driver-mongodb@9.9.0
  - @objectstack/driver-sqlite-wasm@9.9.0
  - @objectstack/plugin-approvals@9.9.0
  - @objectstack/plugin-audit@9.9.0
  - @objectstack/plugin-hono-server@9.9.0
  - @objectstack/plugin-org-scoping@9.9.0
  - @objectstack/plugin-sharing@9.9.0
  - @objectstack/plugin-webhooks@9.9.0
  - @objectstack/service-ai@9.9.0
  - @objectstack/service-cache@9.9.0
  - @objectstack/service-datasource@9.9.0
  - @objectstack/service-job@9.9.0
  - @objectstack/service-messaging@9.9.0
  - @objectstack/service-package@9.9.0
  - @objectstack/service-queue@9.9.0
  - @objectstack/service-realtime@9.9.0
  - @objectstack/service-storage@9.9.0
  - @objectstack/trigger-api@9.9.0
  - @objectstack/trigger-record-change@9.9.0
  - @objectstack/trigger-schedule@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Minor Changes

- 37f6bd8: feat(cli): two new flow authoring anti-pattern lints — date-equality filters (#1874) and phantom aggregation (#1870)

  Extends the build-time flow anti-pattern lint (advisory warnings, never fail the build):

  - **flow-date-equality-filter (#1874)**: a get_record/query filter that binds a
    field directly, or via `$eq`/`$in`, to a time-function value
    (`daysFromNow`/`today`/`now`/…). A `Field.date` stores a time component, so an
    exact match against a re-computed timestamp silently returns nothing. Range
    operators (`$gte`/`$lt` day windows) are the correct shape and are exempt.
  - **flow-phantom-aggregation (#1870)**: a node config key naming a capability the
    automation engine does not have (`aggregations`/`aggregate`/`groupBy`/`rollup`/
    `having`). There is no aggregate node, so the key is silently ignored and the
    node computes nothing. Points the author to `Field.summary` / `Field.formula`.

### Patch Changes

- fcd3471: fix(build): collect per-doc `order:` and `group:` frontmatter so book sorting/placement works

  The doc collector (`collectDocsFromSrc`) parsed only `title:`/`description:` from
  each `src/docs/*.md` frontmatter, so the `order` and `group` fields defined on the
  `Doc` schema (ADR-0046 §6) were never populated on the compiled `doc` item. The
  book resolver (`resolveBookTree`) already sorts group members by `doc.order` then
  label and honors explicit `doc.group` placement — but with the collection half
  silently dropping both fields, frontmatter-driven sorting/placement never reached
  the artifact.

  `parseFrontmatter` now also reads `order:` (parsed to a number; ignored when
  non-numeric) and `group:` (string), threading them onto the collected doc when
  present. Absent leaves both undefined so the schema/resolver defaults apply. Also
  corrects the `order` JSDoc in `doc.zod.ts` to match the resolver, which treats an
  absent `order` as `0` (not "after ordered siblings").

- Updated dependencies [c17d2c8]
- Updated dependencies [7fe0b91]
- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/formula@9.8.0
  - @objectstack/rest@9.8.0
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/plugin-approvals@9.8.0
  - @objectstack/runtime@9.8.0
  - @objectstack/service-ai@9.8.0
  - @objectstack/service-automation@9.8.0
  - @objectstack/client@9.8.0
  - @objectstack/plugin-sharing@9.8.0
  - @objectstack/trigger-record-change@9.8.0
  - @objectstack/account@9.8.0
  - @objectstack/setup@9.8.0
  - @objectstack/studio@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/mcp@9.8.0
  - @objectstack/observability@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/driver-memory@9.8.0
  - @objectstack/driver-mongodb@9.8.0
  - @objectstack/driver-sql@9.8.0
  - @objectstack/driver-sqlite-wasm@9.8.0
  - @objectstack/plugin-audit@9.8.0
  - @objectstack/plugin-auth@9.8.0
  - @objectstack/plugin-email@9.8.0
  - @objectstack/plugin-hono-server@9.8.0
  - @objectstack/plugin-org-scoping@9.8.0
  - @objectstack/plugin-reports@9.8.0
  - @objectstack/plugin-security@9.8.0
  - @objectstack/plugin-webhooks@9.8.0
  - @objectstack/service-analytics@9.8.0
  - @objectstack/service-cache@9.8.0
  - @objectstack/service-datasource@9.8.0
  - @objectstack/service-job@9.8.0
  - @objectstack/service-messaging@9.8.0
  - @objectstack/service-package@9.8.0
  - @objectstack/service-queue@9.8.0
  - @objectstack/service-realtime@9.8.0
  - @objectstack/service-settings@9.8.0
  - @objectstack/service-storage@9.8.0
  - @objectstack/trigger-api@9.8.0
  - @objectstack/trigger-schedule@9.8.0
  - @objectstack/types@9.8.0
  - @objectstack/console@9.8.0

## 9.7.0

### Minor Changes

- ff0a87a: feat(validate): flag bare field references in record-scoped CEL sites at build time

  > **Heads-up for downstream:** this adds a NEW build-time error. A `Field.formula`
  > or validation predicate that references a field bare (`amount` instead of
  > `record.amount`) now fails `objectstack compile`. These expressions were already
  > silently broken at runtime (they evaluated to `null` / never fired), so this is a
  > fix that surfaces a latent bug — but a stack carrying one will go from
  > "builds, silently wrong" to "fails the build" on upgrade. The error message
  > states the exact correction (`write record.<field>`).

  A `Field.formula` and an object validation predicate evaluate against the
  `record` namespace only — there is no field flattening — so a bare top-level
  identifier (`amount`, `status`) resolves to nothing and the expression silently
  evaluates to `null` / never fires. This is the silent-at-runtime class behind
  the broken example-crm formulas (#1927) and is exactly what AI authors get wrong.

  `validateExpression` now takes an evaluation `scope` and, for `scope: 'record'`,
  reports a bare reference with the corrective form (`write record.<field>`). The
  check is schema-free and acts only on cel-js's `Unknown variable` fault, so it
  cannot false-positive on arithmetic/comparison/null-guard type overloads. Flow
  and automation conditions keep the default `scope: 'flattened'` — the record's
  fields ARE spread to top-level there (alongside flow variables), so bare refs
  are correct and are NOT flagged. `objectstack compile` wires `record` scope for
  field formulas and validation predicates; flow conditions stay flattened.

### Patch Changes

- 417b6ac: feat(validate): advisory did-you-mean warnings for likely field typos in flow conditions

  Adds a non-blocking warning channel to build-time expression validation (#1928
  tier 3). Flow / automation conditions flatten the record's fields to top-level,
  so a bare `status` is correct — but a bare NON-field identifier is either a flow
  variable or a typo. When it is a near-miss of a known field (edit distance), the
  build now emits a `did you mean \`status\`?`warning instead of staying silent,
WITHOUT failing the build (a genuine flow variable won't be close to a field
name, so it stays quiet).`ExprValidationResult`gains a`warnings`array and`ExprIssue`a`severity`; `objectstack compile` prints warnings and only fails on
  errors. This closes the silent-skip gap for misspelled trigger-condition fields
  (the #1877 family) without the false-positive risk of a hard gate.

- Updated dependencies [82c7438]
- Updated dependencies [417b6ac]
- Updated dependencies [ff0a87a]
  - @objectstack/formula@9.7.0
  - @objectstack/objectql@9.7.0
  - @objectstack/plugin-approvals@9.7.0
  - @objectstack/runtime@9.7.0
  - @objectstack/service-ai@9.7.0
  - @objectstack/service-automation@9.7.0
  - @objectstack/client@9.7.0
  - @objectstack/plugin-sharing@9.7.0
  - @objectstack/trigger-record-change@9.7.0
  - @objectstack/spec@9.7.0
  - @objectstack/console@9.7.0
  - @objectstack/core@9.7.0
  - @objectstack/types@9.7.0
  - @objectstack/observability@9.7.0
  - @objectstack/platform-objects@9.7.0
  - @objectstack/studio@9.7.0
  - @objectstack/setup@9.7.0
  - @objectstack/rest@9.7.0
  - @objectstack/driver-memory@9.7.0
  - @objectstack/driver-sql@9.7.0
  - @objectstack/driver-mongodb@9.7.0
  - @objectstack/driver-sqlite-wasm@9.7.0
  - @objectstack/plugin-audit@9.7.0
  - @objectstack/plugin-auth@9.7.0
  - @objectstack/plugin-email@9.7.0
  - @objectstack/plugin-hono-server@9.7.0
  - @objectstack/mcp@9.7.0
  - @objectstack/plugin-org-scoping@9.7.0
  - @objectstack/plugin-reports@9.7.0
  - @objectstack/plugin-security@9.7.0
  - @objectstack/plugin-webhooks@9.7.0
  - @objectstack/trigger-api@9.7.0
  - @objectstack/trigger-schedule@9.7.0
  - @objectstack/service-analytics@9.7.0
  - @objectstack/service-cache@9.7.0
  - @objectstack/service-datasource@9.7.0
  - @objectstack/service-feed@9.7.0
  - @objectstack/service-job@9.7.0
  - @objectstack/service-messaging@9.7.0
  - @objectstack/service-package@9.7.0
  - @objectstack/service-queue@9.7.0
  - @objectstack/service-realtime@9.7.0
  - @objectstack/service-settings@9.7.0
  - @objectstack/service-storage@9.7.0
  - @objectstack/account@9.7.0

## 9.6.0

### Patch Changes

- 8c7e7e4: fix(cli): keep non-self-contained hook/action handlers out of body-only lowering (#1876)

  A hook/action handler that references a **module-scope identifier** (a helper,
  an import, a top-level const) was lowered to a metadata-only `body` by
  `objectstack build` — but that body ships without the referenced definition, so
  it throws `ReferenceError` at runtime. Build was green; the app didn't boot —
  exactly the build↔runtime parity gap #1876 describes.

  `extractHookBody` now runs a conservative free-identifier analysis (via the
  `ts` AST already available through `ts-morph`): it computes the handler's free
  variables — names referenced but bound neither by the function (params/locals)
  nor by the JS runtime (a generous global allow-list). When any are found,
  extraction is refused, so `lowerCallables` falls back to **bundling** the real
  function (esbuild carries the closure along) — no `ReferenceError`, no build
  break. The analysis is biased to never over-report: a missed case preserves
  today's behavior, and a false positive only causes a self-contained handler to
  be bundled instead of inlined (a size cost, never a correctness or build
  failure).

  Note: the other #1876 repro — legacy `object`/`aggregate` dashboard widgets
  passing build but rejected by the runtime — is already closed on `main` by the
  ADR-0021 single-form cutover (`DashboardWidgetSchema` now requires
  `dataset`/`values`, enforced by the same schema build and runtime both use).

- 266c0f8: feat(cli): build lint warns on wrong flow-value interpolation syntax (double-brace / bare `$ref`) (#1315)

  Extends the flow authoring anti-pattern lint with two advisory WARNINGs for the
  interpolation-syntax mistakes AI/human authors carry over from other dialects:

  - **double-brace** `{{ai_reply}}` in a flow node value — flow node values use
    SINGLE braces (`{var}`); `{{ }}` is the formula/template-field dialect, never
    flow node values (verified: no flow node executor uses `{{ }}`).
  - **bare `$ref.field`** (e.g. `$source.id`) written as a plain value — it's not
    interpolated; the author meant `{source.id}` (or `{$User.Id}`).

  Precise: single-brace interpolation, braced `{$User.Id}`, currency literals
  (`$5.00`), and CEL condition fields are NOT flagged; never fails the build.

- dc8b2de: feat(automation): resolve & validate `script`-node callables; first-class function registration (#1870)

  A flow `script` node that pointed at an unregistered callable (or declared no
  `actionType`/`function` at all) built fine and silently did nothing at runtime.
  Two changes close that gap:

  - **Loud runtime resolution.** The built-in `script` executor now resolves its
    target in order — built-in side-effect (`email`/`slack`) → a registered
    function (`config.function`, or a bare `config.actionType` that matches no
    built-in) → otherwise **fail the step loudly**. The old `(no-op handler)`
    success path is gone, so an unwired callable can no longer quietly skip.
  - **First-class registration path.** `AutomationEngine.setFunctionResolver()` /
    `resolveFunction()` bridge flow nodes to the host function registry. The
    automation plugin wires it to ObjectQL's `resolveFunction` (populated from
    `bundle.functions` / `defineStack({ functions })`), so an authored package can
    register a function and call it from a `script` node:
    `{ type: 'script', config: { function: 'my_fn', inputs: { … } } }`.
  - **Build-time structural check.** `objectstack build` now flags a `script` node
    that declares neither `actionType` nor `function` (the `actionType: undefined`
    repro). Function _existence_ is verified at runtime — functions are code, not
    serialized into the artifact.

- c226e93: feat(cli): build-time lint warns on the record-change date-equality time anti-pattern (#1874)

  `objectstack build` now emits an advisory WARNING when a record-change flow's
  start condition compares a date field for EQUALITY against a time function
  (`end_date == daysFromNow(60)`, `today() != …`). That construct is valid CEL but
  a runtime footgun — it only fires if the record happens to be written on that
  exact day, so unattended "N days before" rules never run. The warning points the
  author to the robust pattern (a daily SCHEDULE trigger + a range query).

  Range comparisons (`>=`/`<=`) and non-time-field equality are NOT flagged, and it
  never fails the build — it guides authors (very often an AI generating templates)
  toward the correct shape without breaking technically-legal metadata.

- b9d0526: fix(cli): drop stale `ownership` key from the `os init` scaffold object template

  The `app` and `plugin` scaffold templates emitted `ownership: 'own'` on the starter object. `ownership` is no longer a valid `ObjectSchema` field (it's not in `ObjectSchemaBase`, and `ObjectSchema.create()` rejects unknown top-level keys per ADR-0032 / #1535), so a user migrating the scaffolded object into `ObjectSchema.create({...})` would hit a validation error. Removed the key from both templates; the rest of the scaffold output is unchanged.

- ab942f2: feat(automation): accept `functionName` alias + `invoke_function` marker on script nodes (#1870 DX)

  AI-authored templates commonly emit `config: { actionType: 'invoke_function', functionName: 'my_fn' }`,
  but the runtime only read `config.function`. Now:

  - `config.functionName` is accepted as an alias for `config.function` (runtime + build).
  - `actionType: 'invoke_function'` is treated as a MARKER ("call the named function") — the
    name comes from `function`/`functionName`, not from actionType itself; it no longer
    tries to resolve a function literally named `invoke_function`.
  - `objectstack build` errors on `actionType: 'invoke_function'` with no `function`/`functionName`
    (it names no callable) instead of letting it fail at runtime.

- Updated dependencies [d1e930a]
- Updated dependencies [1b82b64]
- Updated dependencies [71578f2]
- Updated dependencies [6c82aa0]
- Updated dependencies [dc8b2de]
- Updated dependencies [bb00a50]
- Updated dependencies [5e3a301]
- Updated dependencies [b0df09c]
- Updated dependencies [5db2742]
- Updated dependencies [ab942f2]
- Updated dependencies [1402be0]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/plugin-auth@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/rest@9.6.0
  - @objectstack/runtime@9.6.0
  - @objectstack/service-automation@9.6.0
  - @objectstack/formula@9.6.0
  - @objectstack/trigger-record-change@9.6.0
  - @objectstack/account@9.6.0
  - @objectstack/setup@9.6.0
  - @objectstack/studio@9.6.0
  - @objectstack/client@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/mcp@9.6.0
  - @objectstack/observability@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/driver-memory@9.6.0
  - @objectstack/driver-mongodb@9.6.0
  - @objectstack/driver-sql@9.6.0
  - @objectstack/driver-sqlite-wasm@9.6.0
  - @objectstack/plugin-approvals@9.6.0
  - @objectstack/plugin-audit@9.6.0
  - @objectstack/plugin-email@9.6.0
  - @objectstack/plugin-hono-server@9.6.0
  - @objectstack/plugin-org-scoping@9.6.0
  - @objectstack/plugin-reports@9.6.0
  - @objectstack/plugin-security@9.6.0
  - @objectstack/plugin-sharing@9.6.0
  - @objectstack/plugin-webhooks@9.6.0
  - @objectstack/service-ai@9.6.0
  - @objectstack/service-analytics@9.6.0
  - @objectstack/service-cache@9.6.0
  - @objectstack/service-datasource@9.6.0
  - @objectstack/service-feed@9.6.0
  - @objectstack/service-job@9.6.0
  - @objectstack/service-messaging@9.6.0
  - @objectstack/service-package@9.6.0
  - @objectstack/service-queue@9.6.0
  - @objectstack/service-realtime@9.6.0
  - @objectstack/service-settings@9.6.0
  - @objectstack/service-storage@9.6.0
  - @objectstack/trigger-api@9.6.0
  - @objectstack/trigger-schedule@9.6.0
  - @objectstack/types@9.6.0
  - @objectstack/console@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/account@9.5.1
  - @objectstack/setup@9.5.1
  - @objectstack/studio@9.5.1
  - @objectstack/client@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/formula@9.5.1
  - @objectstack/mcp@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/observability@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/driver-memory@9.5.1
  - @objectstack/driver-mongodb@9.5.1
  - @objectstack/driver-sql@9.5.1
  - @objectstack/driver-sqlite-wasm@9.5.1
  - @objectstack/plugin-approvals@9.5.1
  - @objectstack/plugin-audit@9.5.1
  - @objectstack/plugin-auth@9.5.1
  - @objectstack/plugin-email@9.5.1
  - @objectstack/plugin-hono-server@9.5.1
  - @objectstack/plugin-org-scoping@9.5.1
  - @objectstack/plugin-reports@9.5.1
  - @objectstack/plugin-security@9.5.1
  - @objectstack/plugin-sharing@9.5.1
  - @objectstack/plugin-webhooks@9.5.1
  - @objectstack/rest@9.5.1
  - @objectstack/runtime@9.5.1
  - @objectstack/service-ai@9.5.1
  - @objectstack/service-analytics@9.5.1
  - @objectstack/service-automation@9.5.1
  - @objectstack/service-cache@9.5.1
  - @objectstack/service-datasource@9.5.1
  - @objectstack/service-feed@9.5.1
  - @objectstack/service-job@9.5.1
  - @objectstack/service-messaging@9.5.1
  - @objectstack/service-package@9.5.1
  - @objectstack/service-queue@9.5.1
  - @objectstack/service-realtime@9.5.1
  - @objectstack/service-settings@9.5.1
  - @objectstack/service-storage@9.5.1
  - @objectstack/trigger-api@9.5.1
  - @objectstack/trigger-record-change@9.5.1
  - @objectstack/trigger-schedule@9.5.1
  - @objectstack/types@9.5.1
  - @objectstack/console@9.5.1

## 9.5.0

### Minor Changes

- d08551c: feat(ADR-0046): per-locale documentation content (doc i18n)

  Docs can now ship localized bodies. Authors add sibling locale-variant files
  `src/docs/<name>.<locale>.md` (e.g. `crm_lead_guide.zh.md`, `..pt-BR.md`) next
  to the base `<name>.md`; the base stays the default and the fallback. Flatness is
  preserved — variants are flat siblings, not subdirectories.

  - **spec**: `DocSchema` gains an optional `translations` map
    (`locale → {label?, description?, content}`) plus `resolveDocLocale(doc, locale)`,
    which collapses a doc to the best-matching locale (exact → primary subtag
    `zh-CN`→`zh` → base) with per-field fallback and strips the `translations` map.
  - **cli (collect-docs)**: variant files are folded into the base doc's
    `translations`; orphan/duplicate variants and the v1 MDX/image bans are linted
    on variant content too.
  - **rest**: `/meta/doc` (list + single) resolves the request locale from the
    existing `Accept-Language` / `?locale` negotiation, returns one localized body,
    and never ships the `translations` map. Doc detail bypasses the response cache
    so a language switch can't return a stale-locale body.
  - **setup / studio**: the built-in overview docs now ship `zh` translations
    (TS-first inline `translations`), so a Chinese console renders Chinese docs.

  The console already sends the active UI language as `Accept-Language`, so doc
  content localizes on a language switch with no client change.

### Patch Changes

- f19caef: fix(ADR-0048): rescope the `os lint` `naming/namespace-prefix` rule to intra-package duplicates

  ADR-0048 §3.4 retired the per-item cross-package collision throw — two
  installed packages may legitimately ship the same bare name (e.g. `page/home`),
  stored under distinct composite keys and disambiguated by package-scoped
  resolution. The `naming/namespace-prefix` lint rule was never updated to match,
  so it still:

  - **fired on every bare-named UI/automation item** (apps/pages/dashboards/flows/
    actions/reports/datasets) regardless of whether a duplicate existed — a normal
    single-package app got dozens of false positives (hotcrm: 63), and
  - **claimed the package would "collide on the registry key and fail at install"**,
    which is no longer true.

  The rule now warns **only on a genuine intra-package duplicate `(type, name)`
  pair** within the linted config — the narrow authoring-time hygiene case ADR-0048
  §3.4 explicitly leaves to `os lint` ("an author shipping two `page/home` in one
  package"). A unique bare name produces zero warnings. The message no longer
  claims an install failure; it explains the items shadow each other on the
  registry key and that distinct packages may reuse the same name freely (the
  namespace prefix is an optional convention). Runtime/registry behavior is
  unchanged.

- Updated dependencies [d08551c]
- Updated dependencies [f19caef]
- Updated dependencies [f19caef]
- Updated dependencies [f19caef]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
- Updated dependencies [1a4f079]
- Updated dependencies [110a333]
  - @objectstack/spec@9.5.0
  - @objectstack/rest@9.5.0
  - @objectstack/setup@9.5.0
  - @objectstack/studio@9.5.0
  - @objectstack/service-feed@9.5.0
  - @objectstack/service-realtime@9.5.0
  - @objectstack/service-job@9.5.0
  - @objectstack/service-messaging@9.5.0
  - @objectstack/service-automation@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/account@9.5.0
  - @objectstack/client@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/formula@9.5.0
  - @objectstack/mcp@9.5.0
  - @objectstack/objectql@9.5.0
  - @objectstack/observability@9.5.0
  - @objectstack/driver-memory@9.5.0
  - @objectstack/driver-mongodb@9.5.0
  - @objectstack/driver-sql@9.5.0
  - @objectstack/driver-sqlite-wasm@9.5.0
  - @objectstack/plugin-approvals@9.5.0
  - @objectstack/plugin-audit@9.5.0
  - @objectstack/plugin-auth@9.5.0
  - @objectstack/plugin-email@9.5.0
  - @objectstack/plugin-hono-server@9.5.0
  - @objectstack/plugin-org-scoping@9.5.0
  - @objectstack/plugin-reports@9.5.0
  - @objectstack/plugin-security@9.5.0
  - @objectstack/plugin-sharing@9.5.0
  - @objectstack/plugin-webhooks@9.5.0
  - @objectstack/runtime@9.5.0
  - @objectstack/service-ai@9.5.0
  - @objectstack/service-analytics@9.5.0
  - @objectstack/service-cache@9.5.0
  - @objectstack/service-datasource@9.5.0
  - @objectstack/service-package@9.5.0
  - @objectstack/service-queue@9.5.0
  - @objectstack/service-settings@9.5.0
  - @objectstack/service-storage@9.5.0
  - @objectstack/trigger-api@9.5.0
  - @objectstack/trigger-record-change@9.5.0
  - @objectstack/trigger-schedule@9.5.0
  - @objectstack/types@9.5.0
  - @objectstack/console@9.5.0

## 9.4.0

### Minor Changes

- 060467a: feat(ADR-0046): add optional `description` to package docs

  A doc can now carry a one-line `description` (frontmatter `description:`),
  giving the natural minimal model: title / summary / body. `DocSchema` gains an
  optional `description`; `os build` reads it from frontmatter. It travels in the
  `GET /meta/doc` list response (unlike `content`, which the list omits), so a
  docs portal can show summaries without fetching each body. Example docs
  (app-showcase, app-todo) updated.

  Also records the deferred-to-P3 design for doc **tags** in ADR-0046: tags are
  keys (i18n-resolved, never display strings), with a small protocol core
  vocabulary plus namespace-prefixed package tags — not a field to bolt on early.

- 2511a98: ADR-0048 follow-up: `os lint` now emits a `naming/namespace-prefix` **warning** when a bare-named UI/automation item is not namespace-prefixed. This shifts the cross-package collision detection (ADR-0048, runtime `MetadataCollisionError`) left to authoring time — a soft nudge to prefix `app`/`page`/`dashboard`/`flow`/`action`/`report`/`dataset` names with the package namespace, so a clash with another package is unlikely to ever reach install.

  Warning-only and never fatal (only errors fail the lint). An app named after the namespace (ADR-0019 single-app convention, e.g. `crm`) and `sys_`-reserved names are exempt; objects (already prefix-enforced as an error) and object-derived views are untouched.

### Patch Changes

- 2c8e607: fix(ADR-0046): serve package docs at runtime, not just in the compiled artifact

  Package docs (`src/docs/*.md`) compiled into a bundle were never reaching the
  runtime, so `GET /meta/doc` returned an empty list and the docs were invisible
  even though `os build` produced them.

  Two gaps:

  - **`os dev` / `os serve` (config-load path)** re-derives metadata from
    `defineStack(...)`, which never carries the markdown docs — those are
    collected only at compile time. `serve.ts` now collects `src/docs/*.md` into
    the stack on the config-load path too (collection only — additive, never
    blocks boot), so docs serve in dev exactly as from a built artifact.
  - **The MetadataPlugin artifact loader** (`ARTIFACT_FIELD_TO_TYPE`) omitted the
    `docs` → `doc` mapping, so the bundle's `docs` array was skipped when loading
    through that path. Added the mapping (with a regression test) for parity with
    the ObjectQL engine's `metadataArrayKeys`.

- Updated dependencies [060467a]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [593d43b]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/rest@9.4.0
  - @objectstack/runtime@9.4.0
  - @objectstack/account@9.4.0
  - @objectstack/setup@9.4.0
  - @objectstack/studio@9.4.0
  - @objectstack/driver-sql@9.4.0
  - @objectstack/service-ai@9.4.0
  - @objectstack/client@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/formula@9.4.0
  - @objectstack/mcp@9.4.0
  - @objectstack/observability@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/driver-memory@9.4.0
  - @objectstack/driver-mongodb@9.4.0
  - @objectstack/driver-sqlite-wasm@9.4.0
  - @objectstack/plugin-approvals@9.4.0
  - @objectstack/plugin-audit@9.4.0
  - @objectstack/plugin-auth@9.4.0
  - @objectstack/plugin-email@9.4.0
  - @objectstack/plugin-hono-server@9.4.0
  - @objectstack/plugin-org-scoping@9.4.0
  - @objectstack/plugin-reports@9.4.0
  - @objectstack/plugin-security@9.4.0
  - @objectstack/plugin-sharing@9.4.0
  - @objectstack/plugin-webhooks@9.4.0
  - @objectstack/service-analytics@9.4.0
  - @objectstack/service-automation@9.4.0
  - @objectstack/service-cache@9.4.0
  - @objectstack/service-datasource@9.4.0
  - @objectstack/service-feed@9.4.0
  - @objectstack/service-job@9.4.0
  - @objectstack/service-messaging@9.4.0
  - @objectstack/service-package@9.4.0
  - @objectstack/service-queue@9.4.0
  - @objectstack/service-realtime@9.4.0
  - @objectstack/service-settings@9.4.0
  - @objectstack/service-storage@9.4.0
  - @objectstack/trigger-api@9.4.0
  - @objectstack/trigger-record-change@9.4.0
  - @objectstack/trigger-schedule@9.4.0
  - @objectstack/types@9.4.0
  - @objectstack/console@9.4.0

## 9.3.0

### Minor Changes

- 1ada658: ADR-0046 P1: package documentation as metadata. New `doc` metadata element — flat Markdown files under `src/docs/*.md` compile into `docs: DocSchema[]` on the stack and register like any other metadata.

  - spec: `DocSchema` ({ name, label?, content }) in `system/`, `StackDefinition.docs`, `doc` in `MetadataTypeSchema` + type registry (inert data, runtime-creatable) + canonical schema map, `docs → doc` plural mapping.
  - cli: `os build` collects flat `src/docs/*.md` (frontmatter `title:`/first `#` heading → label) and enforces the ADR lint — flat directory, namespace-prefixed snake_case names, namespace required when docs ship, MDX/image ban, same-package relative-link resolution. Same rules surface in `os lint`.
  - objectql: `docs` joins the generic metadata registration loop (manifest + nested plugins).
  - runtime: docs count as app payload; `GET /metadata/doc` list responses omit `content` by default (`?include=content` opts in) so unbounded manuals stay off hot paths.

- 59c2d32: New `os package install <id|artifact.json>` command — install a package into a RUNNING runtime via its install-local endpoint. Catalog mode resolves from the runtime's configured catalog; passing a compiled artifact file installs inline (air-gapped, no catalog round-trip). Authenticates against the target runtime with --email/--password (better-auth session; Origin header included for the CSRF check).

### Patch Changes

- f15d6f6: ADR-0042 SLA auto-escalation + ADR-0041 mechanical landing. plugin-approvals now owns a jobs-backed escalation scanner (`runEscalations`, interval job `approvals-sla-escalation` + boot catch-up): overdue pending requests escalate **at most once** (the `escalate` audit row is the idempotency marker, written audit-first) executing the node's `escalation.action` — notify / reassign-to-`escalateTo` / auto_approve / auto_reject as the reserved actor `system:sla`. The trigger packages drop their `plugin-` prefix (`@objectstack/trigger-record-change`, `@objectstack/trigger-schedule`) per ADR-0041, and `ActionDescriptor` gains an optional `maturity: 'ga' | 'beta' | 'reserved'` field so designers can grey out contract-ahead-of-runtime surfaces.
- ad4e97f: ADR-0041 Tier 1 complete: `@objectstack/trigger-api` — inbound webhook/HTTP flow trigger. The engine now derives an `api` trigger binding for `type: 'api'` flows (activating the long-reserved enum value); the trigger mounts `POST /api/v1/automation/hooks/:flowName/:hookId` with GitHub/Stripe-style HMAC verification (`x-objectstack-signature`, constant-time compare, identical 404s for unknown flows and wrong hookIds) and queue-backed ingestion — the handler enqueues and ACKs 202, a queue consumer executes the flow with the JSON payload as the trigger record (`$record` / `record.*` / bare references), and `x-idempotency-key` passes through to the queue's dedup window. The CLI's serve preset auto-loads the trigger alongside record-change and schedule.
- Updated dependencies [1ada658]
- Updated dependencies [b08d08d]
- Updated dependencies [6259882]
- Updated dependencies [d100707]
- Updated dependencies [3219191]
- Updated dependencies [f3c1735]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
- Updated dependencies [ad4e97f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/runtime@9.3.0
  - @objectstack/rest@9.3.0
  - @objectstack/service-ai@9.3.0
  - @objectstack/service-settings@9.3.0
  - @objectstack/plugin-approvals@9.3.0
  - @objectstack/service-automation@9.3.0
  - @objectstack/trigger-record-change@9.3.0
  - @objectstack/trigger-schedule@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/service-analytics@9.3.0
  - @objectstack/trigger-api@9.3.0
  - @objectstack/account@9.3.0
  - @objectstack/client@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/formula@9.3.0
  - @objectstack/mcp@9.3.0
  - @objectstack/observability@9.3.0
  - @objectstack/driver-memory@9.3.0
  - @objectstack/driver-mongodb@9.3.0
  - @objectstack/driver-sql@9.3.0
  - @objectstack/driver-sqlite-wasm@9.3.0
  - @objectstack/plugin-audit@9.3.0
  - @objectstack/plugin-auth@9.3.0
  - @objectstack/plugin-email@9.3.0
  - @objectstack/plugin-hono-server@9.3.0
  - @objectstack/plugin-org-scoping@9.3.0
  - @objectstack/plugin-reports@9.3.0
  - @objectstack/plugin-security@9.3.0
  - @objectstack/plugin-sharing@9.3.0
  - @objectstack/plugin-webhooks@9.3.0
  - @objectstack/service-cache@9.3.0
  - @objectstack/service-datasource@9.3.0
  - @objectstack/service-feed@9.3.0
  - @objectstack/service-job@9.3.0
  - @objectstack/service-messaging@9.3.0
  - @objectstack/service-package@9.3.0
  - @objectstack/service-queue@9.3.0
  - @objectstack/service-realtime@9.3.0
  - @objectstack/service-storage@9.3.0
  - @objectstack/types@9.3.0
  - @objectstack/console@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/account@9.2.0
  - @objectstack/client@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/formula@9.2.0
  - @objectstack/mcp@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/observability@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/driver-memory@9.2.0
  - @objectstack/driver-mongodb@9.2.0
  - @objectstack/driver-sql@9.2.0
  - @objectstack/driver-sqlite-wasm@9.2.0
  - @objectstack/plugin-approvals@9.2.0
  - @objectstack/plugin-audit@9.2.0
  - @objectstack/plugin-auth@9.2.0
  - @objectstack/plugin-email@9.2.0
  - @objectstack/plugin-hono-server@9.2.0
  - @objectstack/plugin-org-scoping@9.2.0
  - @objectstack/plugin-reports@9.2.0
  - @objectstack/plugin-security@9.2.0
  - @objectstack/plugin-sharing@9.2.0
  - @objectstack/plugin-trigger-record-change@9.2.0
  - @objectstack/plugin-trigger-schedule@9.2.0
  - @objectstack/plugin-webhooks@9.2.0
  - @objectstack/rest@9.2.0
  - @objectstack/runtime@9.2.0
  - @objectstack/service-ai@9.2.0
  - @objectstack/service-analytics@9.2.0
  - @objectstack/service-automation@9.2.0
  - @objectstack/service-cache@9.2.0
  - @objectstack/service-datasource@9.2.0
  - @objectstack/service-feed@9.2.0
  - @objectstack/service-job@9.2.0
  - @objectstack/service-messaging@9.2.0
  - @objectstack/service-package@9.2.0
  - @objectstack/service-queue@9.2.0
  - @objectstack/service-realtime@9.2.0
  - @objectstack/service-settings@9.2.0
  - @objectstack/service-storage@9.2.0
  - @objectstack/types@9.2.0
  - @objectstack/console@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/account@9.1.0
  - @objectstack/client@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/formula@9.1.0
  - @objectstack/mcp@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/observability@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/driver-memory@9.1.0
  - @objectstack/driver-mongodb@9.1.0
  - @objectstack/driver-sql@9.1.0
  - @objectstack/driver-sqlite-wasm@9.1.0
  - @objectstack/plugin-approvals@9.1.0
  - @objectstack/plugin-audit@9.1.0
  - @objectstack/plugin-auth@9.1.0
  - @objectstack/plugin-email@9.1.0
  - @objectstack/plugin-hono-server@9.1.0
  - @objectstack/plugin-org-scoping@9.1.0
  - @objectstack/plugin-reports@9.1.0
  - @objectstack/plugin-security@9.1.0
  - @objectstack/plugin-sharing@9.1.0
  - @objectstack/plugin-trigger-record-change@9.1.0
  - @objectstack/plugin-trigger-schedule@9.1.0
  - @objectstack/plugin-webhooks@9.1.0
  - @objectstack/rest@9.1.0
  - @objectstack/runtime@9.1.0
  - @objectstack/service-ai@9.1.0
  - @objectstack/service-analytics@9.1.0
  - @objectstack/service-automation@9.1.0
  - @objectstack/service-cache@9.1.0
  - @objectstack/service-datasource@9.1.0
  - @objectstack/service-feed@9.1.0
  - @objectstack/service-job@9.1.0
  - @objectstack/service-messaging@9.1.0
  - @objectstack/service-package@9.1.0
  - @objectstack/service-queue@9.1.0
  - @objectstack/service-realtime@9.1.0
  - @objectstack/service-settings@9.1.0
  - @objectstack/service-storage@9.1.0
  - @objectstack/types@9.1.0
  - @objectstack/console@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/account@9.0.1
  - @objectstack/client@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/formula@9.0.1
  - @objectstack/mcp@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/observability@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/driver-memory@9.0.1
  - @objectstack/driver-mongodb@9.0.1
  - @objectstack/driver-sql@9.0.1
  - @objectstack/driver-sqlite-wasm@9.0.1
  - @objectstack/plugin-approvals@9.0.1
  - @objectstack/plugin-audit@9.0.1
  - @objectstack/plugin-auth@9.0.1
  - @objectstack/plugin-email@9.0.1
  - @objectstack/plugin-hono-server@9.0.1
  - @objectstack/plugin-org-scoping@9.0.1
  - @objectstack/plugin-reports@9.0.1
  - @objectstack/plugin-security@9.0.1
  - @objectstack/plugin-sharing@9.0.1
  - @objectstack/plugin-trigger-record-change@9.0.1
  - @objectstack/plugin-trigger-schedule@9.0.1
  - @objectstack/plugin-webhooks@9.0.1
  - @objectstack/rest@9.0.1
  - @objectstack/runtime@9.0.1
  - @objectstack/service-ai@9.0.1
  - @objectstack/service-analytics@9.0.1
  - @objectstack/service-automation@9.0.1
  - @objectstack/service-cache@9.0.1
  - @objectstack/service-datasource@9.0.1
  - @objectstack/service-feed@9.0.1
  - @objectstack/service-job@9.0.1
  - @objectstack/service-messaging@9.0.1
  - @objectstack/service-package@9.0.1
  - @objectstack/service-queue@9.0.1
  - @objectstack/service-realtime@9.0.1
  - @objectstack/service-settings@9.0.1
  - @objectstack/service-storage@9.0.1
  - @objectstack/types@9.0.1
  - @objectstack/console@9.0.1

## 9.0.0

### Patch Changes

- c66f770: Bundle the `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `@ai-sdk/google` provider
  SDKs as direct CLI dependencies. These were previously only declared as optional
  peer dependencies on `@objectstack/service-ai`, so a globally-installed CLI could
  not resolve them at runtime. Configuring an OpenAI-compatible provider (DeepSeek,
  DashScope, SiliconFlow, OpenRouter, Cloudflare) — all of which normalise to
  `provider=openai` and dynamically import `@ai-sdk/openai` — failed with
  "Could not build adapter for provider=…". The CLI now ships these providers so
  they work out of the box.
- Updated dependencies [4c3f693]
- Updated dependencies [4a0736b]
- Updated dependencies [2c6864f]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/service-analytics@9.0.0
  - @objectstack/service-settings@9.0.0
  - @objectstack/plugin-auth@9.0.0
  - @objectstack/service-ai@9.0.0
  - @objectstack/account@9.0.0
  - @objectstack/client@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/formula@9.0.0
  - @objectstack/mcp@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/observability@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/driver-memory@9.0.0
  - @objectstack/driver-mongodb@9.0.0
  - @objectstack/driver-sql@9.0.0
  - @objectstack/driver-sqlite-wasm@9.0.0
  - @objectstack/plugin-approvals@9.0.0
  - @objectstack/plugin-audit@9.0.0
  - @objectstack/plugin-email@9.0.0
  - @objectstack/plugin-hono-server@9.0.0
  - @objectstack/plugin-org-scoping@9.0.0
  - @objectstack/plugin-reports@9.0.0
  - @objectstack/plugin-security@9.0.0
  - @objectstack/plugin-sharing@9.0.0
  - @objectstack/plugin-trigger-record-change@9.0.0
  - @objectstack/plugin-trigger-schedule@9.0.0
  - @objectstack/plugin-webhooks@9.0.0
  - @objectstack/rest@9.0.0
  - @objectstack/runtime@9.0.0
  - @objectstack/service-automation@9.0.0
  - @objectstack/service-cache@9.0.0
  - @objectstack/service-datasource@9.0.0
  - @objectstack/service-feed@9.0.0
  - @objectstack/service-job@9.0.0
  - @objectstack/service-messaging@9.0.0
  - @objectstack/service-package@9.0.0
  - @objectstack/service-queue@9.0.0
  - @objectstack/service-realtime@9.0.0
  - @objectstack/service-storage@9.0.0
  - @objectstack/types@9.0.0
  - @objectstack/console@9.0.0

## 8.0.1

### Patch Changes

- Updated dependencies [d8c5374]
  - @objectstack/mcp@8.0.1
  - @objectstack/spec@8.0.1
  - @objectstack/console@8.0.1
  - @objectstack/core@8.0.1
  - @objectstack/client@8.0.1
  - @objectstack/types@8.0.1
  - @objectstack/objectql@8.0.1
  - @objectstack/observability@8.0.1
  - @objectstack/formula@8.0.1
  - @objectstack/platform-objects@8.0.1
  - @objectstack/runtime@8.0.1
  - @objectstack/rest@8.0.1
  - @objectstack/driver-memory@8.0.1
  - @objectstack/driver-sql@8.0.1
  - @objectstack/driver-mongodb@8.0.1
  - @objectstack/driver-sqlite-wasm@8.0.1
  - @objectstack/plugin-approvals@8.0.1
  - @objectstack/plugin-audit@8.0.1
  - @objectstack/plugin-auth@8.0.1
  - @objectstack/plugin-email@8.0.1
  - @objectstack/plugin-hono-server@8.0.1
  - @objectstack/plugin-org-scoping@8.0.1
  - @objectstack/plugin-reports@8.0.1
  - @objectstack/plugin-security@8.0.1
  - @objectstack/plugin-sharing@8.0.1
  - @objectstack/plugin-webhooks@8.0.1
  - @objectstack/plugin-trigger-record-change@8.0.1
  - @objectstack/plugin-trigger-schedule@8.0.1
  - @objectstack/service-ai@8.0.1
  - @objectstack/service-analytics@8.0.1
  - @objectstack/service-automation@8.0.1
  - @objectstack/service-cache@8.0.1
  - @objectstack/service-datasource@8.0.1
  - @objectstack/service-feed@8.0.1
  - @objectstack/service-job@8.0.1
  - @objectstack/service-messaging@8.0.1
  - @objectstack/service-package@8.0.1
  - @objectstack/service-queue@8.0.1
  - @objectstack/service-realtime@8.0.1
  - @objectstack/service-settings@8.0.1
  - @objectstack/service-storage@8.0.1
  - @objectstack/account@8.0.1

## 8.0.0

### Patch Changes

- d9f72fe: refactor(mcp)!: rename `@objectstack/plugin-mcp-server` → `@objectstack/mcp` (ADR-0036)

  The outbound MCP-server package drops the legacy `plugin-` prefix and moves to
  the top level (`packages/mcp`), parallel to `@objectstack/rest` — both are "your
  app exposed over a protocol". Inbound MCP (consuming external servers) stays
  `@objectstack/connector-mcp`.

  **Breaking:** the package name changed. Update imports
  `@objectstack/plugin-mcp-server` → `@objectstack/mcp`. The exported API
  (`MCPServerPlugin`, `MCPServerRuntime`, `registerObjectTools`, `McpDataBridge`,
  …) is unchanged. The internal plugin id is now `com.objectstack.mcp`. Pre-launch
  clean break — no compatibility shim (only `@objectstack/cli` depended on it
  internally).

- Updated dependencies [a46c017]
- Updated dependencies [f68be58]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [93f97b2]
- Updated dependencies [87cb13c]
- Updated dependencies [bc0d85b]
- Updated dependencies [2537e28]
- Updated dependencies [0ec7717]
- Updated dependencies [9f311f8]
- Updated dependencies [c70eec1]
- Updated dependencies [e6374b5]
- Updated dependencies [1e8b680]
- Updated dependencies [0a6438e]
- Updated dependencies [3306d2f]
- Updated dependencies [d9f72fe]
- Updated dependencies [ae7fb3f]
- Updated dependencies [c262301]
- Updated dependencies [e1478fe]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/service-ai@8.0.0
  - @objectstack/runtime@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/driver-sql@8.0.0
  - @objectstack/plugin-hono-server@8.0.0
  - @objectstack/mcp@8.0.0
  - @objectstack/service-messaging@8.0.0
  - @objectstack/plugin-auth@8.0.0
  - @objectstack/plugin-security@8.0.0
  - @objectstack/driver-mongodb@8.0.0
  - @objectstack/rest@8.0.0
  - @objectstack/service-automation@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/account@8.0.0
  - @objectstack/client@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/observability@8.0.0
  - @objectstack/platform-objects@8.0.0
  - @objectstack/driver-memory@8.0.0
  - @objectstack/driver-sqlite-wasm@8.0.0
  - @objectstack/plugin-approvals@8.0.0
  - @objectstack/plugin-audit@8.0.0
  - @objectstack/plugin-email@8.0.0
  - @objectstack/plugin-org-scoping@8.0.0
  - @objectstack/plugin-reports@8.0.0
  - @objectstack/plugin-sharing@8.0.0
  - @objectstack/plugin-trigger-record-change@8.0.0
  - @objectstack/plugin-trigger-schedule@8.0.0
  - @objectstack/plugin-webhooks@8.0.0
  - @objectstack/service-analytics@8.0.0
  - @objectstack/service-cache@8.0.0
  - @objectstack/service-datasource@8.0.0
  - @objectstack/service-feed@8.0.0
  - @objectstack/service-job@8.0.0
  - @objectstack/service-package@8.0.0
  - @objectstack/service-queue@8.0.0
  - @objectstack/service-realtime@8.0.0
  - @objectstack/service-settings@8.0.0
  - @objectstack/service-storage@8.0.0
  - @objectstack/types@8.0.0
  - @objectstack/console@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [4705fb8]
  - @objectstack/service-ai@7.9.0
  - @objectstack/objectql@7.9.0
  - @objectstack/rest@7.9.0
  - @objectstack/runtime@7.9.0
  - @objectstack/client@7.9.0
  - @objectstack/plugin-sharing@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/console@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/types@7.9.0
  - @objectstack/observability@7.9.0
  - @objectstack/formula@7.9.0
  - @objectstack/platform-objects@7.9.0
  - @objectstack/driver-memory@7.9.0
  - @objectstack/driver-sql@7.9.0
  - @objectstack/driver-mongodb@7.9.0
  - @objectstack/driver-sqlite-wasm@7.9.0
  - @objectstack/plugin-approvals@7.9.0
  - @objectstack/plugin-audit@7.9.0
  - @objectstack/plugin-auth@7.9.0
  - @objectstack/plugin-email@7.9.0
  - @objectstack/plugin-hono-server@7.9.0
  - @objectstack/plugin-mcp-server@7.9.0
  - @objectstack/plugin-org-scoping@7.9.0
  - @objectstack/plugin-reports@7.9.0
  - @objectstack/plugin-security@7.9.0
  - @objectstack/plugin-webhooks@7.9.0
  - @objectstack/plugin-trigger-record-change@7.9.0
  - @objectstack/plugin-trigger-schedule@7.9.0
  - @objectstack/service-analytics@7.9.0
  - @objectstack/service-automation@7.9.0
  - @objectstack/service-cache@7.9.0
  - @objectstack/service-datasource@7.9.0
  - @objectstack/service-feed@7.9.0
  - @objectstack/service-job@7.9.0
  - @objectstack/service-messaging@7.9.0
  - @objectstack/service-package@7.9.0
  - @objectstack/service-queue@7.9.0
  - @objectstack/service-realtime@7.9.0
  - @objectstack/service-settings@7.9.0
  - @objectstack/service-storage@7.9.0
  - @objectstack/account@7.9.0

## 7.8.0

### Minor Changes

- 6b60068: fix(cli): `objectstack dev` persists data by default (no more `:memory:` wipe on restart)

  `objectstack dev` historically fell back to a `:memory:` SQLite database when no `--database` / `OS_DATABASE_URL` was given, so **every restart silently wiped all data and AI-authored metadata** — you'd build an app, restart, and it would be gone, which makes local app-building unusable.

  `dev` now defaults to a persistent, project-anchored SQLite file at `<cwd>/.objectstack/data/dev.db` (gitignored, per-project). Existing opt-outs are unchanged and take precedence: `--fresh` (ephemeral temp DB), `--database <url>`, `OS_DATABASE_URL`/`DATABASE_URL`, or an explicit in-memory driver (`--database-driver memory` / `OS_DATABASE_DRIVER=memory`). Resolution is extracted into the testable `resolveDefaultDevDbUrl()` helper.

  The **app-showcase** example drops its explicit `:memory:` datasource override (which would otherwise route data back to memory and defeat the new default), so it persists across restarts out of the box.

### Patch Changes

- Updated dependencies [6b82e68]
- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [328a7c4]
- Updated dependencies [f01f9fa]
- Updated dependencies [4888ea2]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/service-ai@7.8.0
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/rest@7.8.0
  - @objectstack/runtime@7.8.0
  - @objectstack/service-package@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/account@7.8.0
  - @objectstack/client@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/observability@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/driver-memory@7.8.0
  - @objectstack/driver-mongodb@7.8.0
  - @objectstack/driver-sql@7.8.0
  - @objectstack/driver-sqlite-wasm@7.8.0
  - @objectstack/plugin-approvals@7.8.0
  - @objectstack/plugin-audit@7.8.0
  - @objectstack/plugin-auth@7.8.0
  - @objectstack/plugin-email@7.8.0
  - @objectstack/plugin-hono-server@7.8.0
  - @objectstack/plugin-mcp-server@7.8.0
  - @objectstack/plugin-org-scoping@7.8.0
  - @objectstack/plugin-reports@7.8.0
  - @objectstack/plugin-security@7.8.0
  - @objectstack/plugin-sharing@7.8.0
  - @objectstack/plugin-trigger-record-change@7.8.0
  - @objectstack/plugin-trigger-schedule@7.8.0
  - @objectstack/plugin-webhooks@7.8.0
  - @objectstack/service-analytics@7.8.0
  - @objectstack/service-automation@7.8.0
  - @objectstack/service-cache@7.8.0
  - @objectstack/service-datasource@7.8.0
  - @objectstack/service-feed@7.8.0
  - @objectstack/service-job@7.8.0
  - @objectstack/service-messaging@7.8.0
  - @objectstack/service-queue@7.8.0
  - @objectstack/service-realtime@7.8.0
  - @objectstack/service-settings@7.8.0
  - @objectstack/service-storage@7.8.0
  - @objectstack/types@7.8.0
  - @objectstack/console@7.8.0

## 7.7.0

### Patch Changes

- 1e0b6d7: fix(cli): honor OS_LOG_LEVEL / --log-level instead of hardcoding the kernel logger to `silent` (#1533)

  `os serve` / `os start` built the runtime kernel with a hardcoded `{ level: 'silent' }` logger, suppressing every plugin `logger.warn` / `logger.error`. A record-change flow whose condition or node faulted (surfaced via `logger.warn` in `plugin-trigger-record-change`) produced zero operator-visible output — the flow simply had no effect — undercutting ADR-0032's "fail loudly" promise when run via the CLI.

  The kernel logger level is now resolved from `--verbose` (→ `debug`) → `--log-level <level>` → `$OS_LOG_LEVEL` / `$LOG_LEVEL` → default `warn`. Defaulting to `warn` surfaces flow/hook execution-failure warnings and automation-engine errors out of the box, while the existing boot-quiet window still suppresses info-level startup chatter. Pass `--log-level silent` (or `OS_LOG_LEVEL=silent`) to restore the previous fully-quiet behavior. `start` and `dev` gain a matching `--log-level` flag and forward it (plus the existing `--verbose`) to the spawned `serve`.

- Updated dependencies [b391955]
- Updated dependencies [984ddff]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/service-ai@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/driver-sql@7.7.0
  - @objectstack/account@7.7.0
  - @objectstack/client@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/observability@7.7.0
  - @objectstack/driver-memory@7.7.0
  - @objectstack/driver-mongodb@7.7.0
  - @objectstack/driver-sqlite-wasm@7.7.0
  - @objectstack/plugin-approvals@7.7.0
  - @objectstack/plugin-audit@7.7.0
  - @objectstack/plugin-auth@7.7.0
  - @objectstack/plugin-email@7.7.0
  - @objectstack/plugin-hono-server@7.7.0
  - @objectstack/plugin-mcp-server@7.7.0
  - @objectstack/plugin-org-scoping@7.7.0
  - @objectstack/plugin-reports@7.7.0
  - @objectstack/plugin-security@7.7.0
  - @objectstack/plugin-sharing@7.7.0
  - @objectstack/plugin-trigger-record-change@7.7.0
  - @objectstack/plugin-trigger-schedule@7.7.0
  - @objectstack/plugin-webhooks@7.7.0
  - @objectstack/rest@7.7.0
  - @objectstack/runtime@7.7.0
  - @objectstack/service-analytics@7.7.0
  - @objectstack/service-automation@7.7.0
  - @objectstack/service-cache@7.7.0
  - @objectstack/service-datasource@7.7.0
  - @objectstack/service-feed@7.7.0
  - @objectstack/service-job@7.7.0
  - @objectstack/service-messaging@7.7.0
  - @objectstack/service-package@7.7.0
  - @objectstack/service-queue@7.7.0
  - @objectstack/service-realtime@7.7.0
  - @objectstack/service-settings@7.7.0
  - @objectstack/service-storage@7.7.0
  - @objectstack/types@7.7.0
  - @objectstack/console@7.7.0

## 7.6.0

### Minor Changes

- c4a4cbd: ADR-0032 (phase 1): validate-by-default expression layer — no silent failure.

  Kills the #1491 class where a malformed predicate (e.g. the `{record.x}`
  template-brace-in-CEL mistake) silently evaluated to `false` and made a flow
  "fire" with no effect:

  - **service-automation**: flow `evaluateCondition` no longer swallows CEL
    failures to `false` — it throws an attributed, corrective error; and
    `registerFlow` now parse-validates every predicate (start/decision/edge
    condition) at registration, failing loudly with the offending location +
    source + the fix.
  - **formula**: new shared validator — `validateExpression(role, src, schema?)`,
    `introspectScope`, `CEL_STDLIB_FUNCTIONS` — with schema-aware field-existence
    - did-you-mean. The `{{ }}` template engine gains a formatter whitelist
      (`currency`/`number`/`percent`/`date`/`datetime`/`truncate`/`upper`/`lower`/
      `default`/…) with defined value→string semantics; arbitrary logic in holes is
      rejected. Plain `{{ path }}` stays back-compatible.
  - **cli**: `objectstack compile` validates every flow / validation-rule /
    field-formula predicate against the resolved object schema and fails the
    build with located, corrective messages.
  - **service-ai**: new agent-callable `validate_expression` tool so authoring
    agents self-correct before committing.
  - **spec**: fix the `FlowSchema` JSDoc example that taught the bad
    `condition: "{amount} < 500"` single-brace form.

### Patch Changes

- 8c01eea: fix(dev): seed the dev admin in-process and fix the port-drift seed failure.

  `os dev` (and `pnpm dev:showcase`) seeded the admin over HTTP against a
  hard-coded `localhost:3000`. In dev, `serve` auto-shifts off a busy port, so
  the seed POST hit the wrong server (or nothing) and the running instance never
  got an admin. A second, divergent seed in `plugin-dev` inserted a
  credential-less `sys_user` row that could not log in.

  Consolidate to a single in-process seed:

  - **`@objectstack/plugin-auth`** — `maybeSeedDevAdmin()` runs on `kernel:ready`
    and creates `admin@objectos.ai` / `admin123` through better-auth's real
    `signUpEmail` pipeline (hashed credential), so the account is loginable;
    `plugin-security` then promotes it to platform admin. Empty-DB only
    (excludes the system service account), idempotent, never overwrites an
    existing account. Hard-gated to `NODE_ENV=development`; opt out with
    `OS_SEED_ADMIN=0`.
  - **`@objectstack/cli`** — removed the HTTP seed; `--seed-admin` now passes
    `OS_SEED_ADMIN[_EMAIL|_PASSWORD]` to the serve child. `serve` publishes its
    actually-bound port over IPC and to a `runtime.<env>.json` state file under
    `OS_HOME`.
  - **`@objectstack/plugin-dev`** — removed the credential-less raw insert;
    `seedAdminUser` maps to the unified `OS_SEED_ADMIN` toggle.

- 3377e38: fix(release): stop the fixed-group major cascade caused by internal `@objectstack/*` peerDependencies.

  These packages declared workspace peerDependencies on other framework packages
  in the changesets `fixed` group. Inside a fixed group, changesets rewrites those
  peer ranges on every release and treats a peer-range change as breaking → major,
  which cascaded to **all 69 packages → 8.0.0** on _any_ minor changeset. Required
  internal peers are now regular `dependencies`; optional ones move to
  `devDependencies` (kept for in-workspace tests, no longer a published peer edge).
  Releases now bump correctly (patch/minor) instead of a spurious major.

- 55866f5: Fail loud instead of silently minting an ephemeral encryption key; ship a persistent env-master-key provider as the default (#1507).

  The default `ICryptoProvider` backs every secret-at-rest in the platform —
  encrypted settings (`sys_setting.value_enc`), ObjectQL `secret` fields, and
  runtime datasource credentials. Its key resolution previously fell back,
  **silently**, to a fresh per-process `randomBytes(32)` key (or auto-minted a
  new on-disk key on every boot) when no stable key was available. In an
  ephemeral-FS container or a multi-node cluster, each restart / each node then
  encrypts under a different key, and every previously-written `sys_secret` value
  becomes undecryptable. The failure was invisible at encrypt and boot time and
  only surfaced later as "all my saved passwords / API keys / DB credentials
  fail to decrypt".

  - **Renamed `InMemoryCryptoProvider` → `LocalCryptoProvider`.** The old name
    implied an ephemeral key when the provider in fact persists one.
    `InMemoryCryptoProvider` stays as a deprecated alias for backward
    compatibility.
  - **Added `OS_SECRET_KEY`** as the canonical production master key (32-byte
    hex or base64), the documented production default. `OS_DEV_CRYPTO_KEY`
    remains the dev convenience key.
  - **Fail-loud in production.** When `NODE_ENV=production` and no stable key
    source (env var or a pre-existing persisted file) is available, the provider
    now throws an actionable error at construction instead of generating a key —
    turning silent data-loss into a config error at boot. It never auto-mints a
    key in production. Development and test keep the ergonomic fallback
    (persisted dev key / ephemeral test key).
  - `serve` surfaces the production-key error verbatim and refuses to wire an
    unstable provider for `secret` fields.

  KMS / Vault providers (managed custody, per-tenant keys, automatic rotation)
  remain future/enterprise plug-ins behind the same `ICryptoProvider` seam;
  "your stored secret is still there after a reboot" stays open-source.

- b7a4f14: fix(dev): surface the seeded dev-admin credentials in the `serve` startup banner.

  When the runtime seeds the dev admin on an empty DB, the confirmation was
  emitted via `ctx.logger` during `runtime.start()` — inside serve's boot-quiet
  window — so it was swallowed and never reached the console. plugin-auth now
  records the seed result on the `auth` service and `serve` prints it in the
  ready banner (after stdout is restored), e.g.:

  ```
    🔑  Dev admin: admin@objectos.ai / admin123
        seeded on empty DB · dev only — do not use in production
  ```

  Shown only when an admin was actually seeded this boot (empty DB) — never on a
  DB that already had a user, so stale credentials are never displayed. Visible
  in both `serve --dev` and `os dev` (the child's stdout is inherited).

- Updated dependencies [955d4c8]
- Updated dependencies [11905fa]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [cf03ef2]
- Updated dependencies [7648242]
- Updated dependencies [bb04824]
- Updated dependencies [8c01eea]
- Updated dependencies [8fa1e7f]
- Updated dependencies [d8aa11d]
- Updated dependencies [3377e38]
- Updated dependencies [be20aa4]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [b7a4f14]
- Updated dependencies [60f9c45]
- Updated dependencies [f06a6a5]
- Updated dependencies [4ee139d]
  - @objectstack/service-messaging@7.6.0
  - @objectstack/service-automation@7.6.0
  - @objectstack/spec@7.6.0
  - @objectstack/plugin-webhooks@7.6.0
  - @objectstack/formula@7.6.0
  - @objectstack/service-ai@7.6.0
  - @objectstack/client@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/service-datasource@7.6.0
  - @objectstack/plugin-auth@7.6.0
  - @objectstack/plugin-email@7.6.0
  - @objectstack/driver-sqlite-wasm@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/service-settings@7.6.0
  - @objectstack/runtime@7.6.0
  - @objectstack/plugin-approvals@7.6.0
  - @objectstack/account@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/observability@7.6.0
  - @objectstack/driver-memory@7.6.0
  - @objectstack/driver-mongodb@7.6.0
  - @objectstack/driver-sql@7.6.0
  - @objectstack/plugin-audit@7.6.0
  - @objectstack/plugin-hono-server@7.6.0
  - @objectstack/plugin-mcp-server@7.6.0
  - @objectstack/plugin-org-scoping@7.6.0
  - @objectstack/plugin-reports@7.6.0
  - @objectstack/plugin-security@7.6.0
  - @objectstack/plugin-sharing@7.6.0
  - @objectstack/plugin-trigger-record-change@7.6.0
  - @objectstack/plugin-trigger-schedule@7.6.0
  - @objectstack/rest@7.6.0
  - @objectstack/service-analytics@7.6.0
  - @objectstack/service-cache@7.6.0
  - @objectstack/service-feed@7.6.0
  - @objectstack/service-job@7.6.0
  - @objectstack/service-package@7.6.0
  - @objectstack/service-queue@7.6.0
  - @objectstack/service-realtime@7.6.0
  - @objectstack/service-storage@7.6.0
  - @objectstack/types@7.6.0
  - @objectstack/console@7.6.0

## 7.5.0

### Patch Changes

- Updated dependencies [1560880]
- Updated dependencies [a2263e6]
  - @objectstack/service-automation@7.5.0
  - @objectstack/plugin-approvals@7.5.0
  - @objectstack/spec@7.5.0
  - @objectstack/console@7.5.0
  - @objectstack/core@7.5.0
  - @objectstack/client@7.5.0
  - @objectstack/types@7.5.0
  - @objectstack/objectql@7.5.0
  - @objectstack/observability@7.5.0
  - @objectstack/platform-objects@7.5.0
  - @objectstack/runtime@7.5.0
  - @objectstack/rest@7.5.0
  - @objectstack/driver-memory@7.5.0
  - @objectstack/driver-sql@7.5.0
  - @objectstack/driver-mongodb@7.5.0
  - @objectstack/driver-sqlite-wasm@7.5.0
  - @objectstack/plugin-audit@7.5.0
  - @objectstack/plugin-auth@7.5.0
  - @objectstack/plugin-email@7.5.0
  - @objectstack/plugin-hono-server@7.5.0
  - @objectstack/plugin-mcp-server@7.5.0
  - @objectstack/plugin-org-scoping@7.5.0
  - @objectstack/plugin-reports@7.5.0
  - @objectstack/plugin-security@7.5.0
  - @objectstack/plugin-sharing@7.5.0
  - @objectstack/plugin-webhooks@7.5.0
  - @objectstack/plugin-trigger-record-change@7.5.0
  - @objectstack/plugin-trigger-schedule@7.5.0
  - @objectstack/service-ai@7.5.0
  - @objectstack/service-analytics@7.5.0
  - @objectstack/service-cache@7.5.0
  - @objectstack/service-external-datasource@7.5.0
  - @objectstack/service-feed@7.5.0
  - @objectstack/service-job@7.5.0
  - @objectstack/service-messaging@7.5.0
  - @objectstack/service-package@7.5.0
  - @objectstack/service-queue@7.5.0
  - @objectstack/service-realtime@7.5.0
  - @objectstack/service-settings@7.5.0
  - @objectstack/service-storage@7.5.0
  - @objectstack/account@7.5.0

## 7.4.1

### Patch Changes

- Updated dependencies [d7f86db]
  - @objectstack/console@7.4.1
  - @objectstack/spec@7.4.1
  - @objectstack/core@7.4.1
  - @objectstack/client@7.4.1
  - @objectstack/types@7.4.1
  - @objectstack/objectql@7.4.1
  - @objectstack/observability@7.4.1
  - @objectstack/platform-objects@7.4.1
  - @objectstack/runtime@7.4.1
  - @objectstack/rest@7.4.1
  - @objectstack/driver-memory@7.4.1
  - @objectstack/driver-sql@7.4.1
  - @objectstack/driver-mongodb@7.4.1
  - @objectstack/driver-sqlite-wasm@7.4.1
  - @objectstack/plugin-approvals@7.4.1
  - @objectstack/plugin-audit@7.4.1
  - @objectstack/plugin-auth@7.4.1
  - @objectstack/plugin-email@7.4.1
  - @objectstack/plugin-hono-server@7.4.1
  - @objectstack/plugin-mcp-server@7.4.1
  - @objectstack/plugin-org-scoping@7.4.1
  - @objectstack/plugin-reports@7.4.1
  - @objectstack/plugin-security@7.4.1
  - @objectstack/plugin-sharing@7.4.1
  - @objectstack/plugin-webhooks@7.4.1
  - @objectstack/plugin-trigger-record-change@7.4.1
  - @objectstack/plugin-trigger-schedule@7.4.1
  - @objectstack/service-ai@7.4.1
  - @objectstack/service-analytics@7.4.1
  - @objectstack/service-automation@7.4.1
  - @objectstack/service-cache@7.4.1
  - @objectstack/service-external-datasource@7.4.1
  - @objectstack/service-feed@7.4.1
  - @objectstack/service-job@7.4.1
  - @objectstack/service-messaging@7.4.1
  - @objectstack/service-package@7.4.1
  - @objectstack/service-queue@7.4.1
  - @objectstack/service-realtime@7.4.1
  - @objectstack/service-settings@7.4.1
  - @objectstack/service-storage@7.4.1
  - @objectstack/account@7.4.1

## 7.4.0

### Minor Changes

- 70b63f2: `objectstack dev` now defaults to SQLite and auto-seeds an admin.

  - **Default driver → SQLite.** With no `OS_DATABASE_URL`/`OS_DATABASE_DRIVER`,
    dev now prefers `SqlDriver(sqlite, :memory:)` over the pure-JS `InMemoryDriver`
    for production-like SQL semantics. It probes by opening a connection (knex
    loads `better-sqlite3` lazily at first query) and falls back to
    `InMemoryDriver` **with a warning** if the native binary is unavailable —
    closing a hole where the surrounding silent catch could leave the kernel with
    no driver.
  - **`--seed-admin` defaults ON in dev.** Idempotent and non-destructive: POSTs
    the public sign-up endpoint, creating `admin@objectos.ai` only on an empty DB
    (then promoted to platform admin) and skipping when the email already exists
    (422/400), so a custom password is never overwritten. Disable with
    `--no-seed-admin`.

- 2faf9f2: External Datasource Federation (ADR-0015) — CLI surface.

  New `os datasource` command group: `list-tables` (list remote tables),
  `introspect` (generate a reviewable `*.object.ts` draft from a remote table),
  and `validate` (validate federated objects against the remote schema; exits
  non-zero on mismatch). Backed by the `/api/v1/datasources/:name/external/*`
  REST routes.

- 394d34f: Messaging + triggers capability tokens, and notify-by-email recipient resolution.

  Make the `notify` flow node and auto-firing flows usable from a plain
  `defineStack({ requires: [...] })` — no hand-wired plugin instances.

  - **CLI / runtime — new capability tokens.** `messaging` →
    `MessagingServicePlugin` (the `notify` node delivers to the inbox channel
    instead of degrading to a logged no-op); `triggers` →
    `RecordChangeTriggerPlugin` + `ScheduleTriggerPlugin` (autolaunched / schedule
    flows actually fire — pair `triggers` with `job` for cron/interval). Wired
    identically in the CLI `CAPABILITY_PROVIDERS` table and the runtime
    `capability-loader`.
  - **Inbox channel — notify-by-email.** Flows commonly address recipients by
    email (e.g. `{record.assignee}`), but `sys_inbox_message` is keyed by user id.
    The inbox channel now resolves an email-shaped recipient to its `sys_user.id`
    (configurable via `InboxChannelOptions.userObject`), with a verbatim fallback
    when the recipient is not email-shaped, no user matches, or the lookup fails —
    so a failed resolution can never drop the row.

### Patch Changes

- 23c7107: ADR-0020 — converge the three "state machine" declaration shapes to one
  **enforced** `state_machine` validation rule.

  Before this change a record state machine could be declared three ways (a
  `workflow` metadata type, an `object.stateMachines` map, or a `state_machine`
  validation rule) and **none of them were enforced at runtime** — a declarative
  guardrail that was pure decoration, and a hallucination trap for AI authors.

  **Enforcement (`@objectstack/objectql`)**

  - New `validation/rule-validator.ts` evaluates the object's `validations` union
    on the write path: `evaluateValidationRules`, `needsPriorRecord`, and the
    `legalNextStates` introspection helper (all exported from the package root).
  - `state_machine` rules reject illegal `field` transitions on update (with the
    rule's `message`); `script` / `cross_field` predicate rules now also fire
    (they were silently broken on PATCH updates because only the patch, not the
    prior record, was available). The engine plumbs the prior record into
    rule evaluation on single-row update; multi-row (`updateMany`) updates log a
    warning and skip rule evaluation rather than enforce on incomplete data.

  **Convergence / retirement (`@objectstack/spec`) — breaking**

  - Retires the `workflow` metadata type (removed from the metadata-type enum,
    the registry, the schema map, the `workflows` collection key, and the
    plural→singular mapping).
  - Removes the `object.stateMachines` map and the `stack.workflows` array. The
    `state_machine` validation rule is the single canonical home.
  - The XState-style `StateMachineSchema` file is **kept** (still used by the
    agent conversation lifecycle and the discovery protocol); only its role as
    the `workflow` metadata-type backing schema was removed. The optional
    `workflow` **RPC service** surface (`CoreServiceName.workflow`,
    `/api/v1/workflow`, `IWorkflowService`) is kept as a documented follow-up.

  **Introspection (`@objectstack/runtime`)**

  - Adds `GET /metadata/objects/:name/state/:field?from=:state`, returning the
    legal next states for a field (`next: null` when no FSM governs the field,
    `[]` for a declared dead-end) so UIs/agents read the transition table instead
    of re-deriving it.

  **Surfaces (`@objectstack/platform-objects`, `@objectstack/cli`)**

  - Studio drops the standalone "Workflow Rules" nav (state machines are edited
    alongside the object's other validation rules).
  - `explain` no longer lists `workflow` as a related metadata type.

  Migration: replace a `workflow` / `StateMachineConfig` declaration with a
  `state_machine` validation rule on the object (`field` + `{ from: [allowedTo] }`
  transition table), and move any side-effecting actions (emails, task creation)
  into a record-triggered or scheduled Flow (ADR-0019). See the migrated
  `examples/app-crm` flows for the pattern.

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

- 08fbbb4: Fix: the first-boot platform-admin promotion no longer gets stolen by the
  `usr_system` seed identity, and the dev seed admin uses fixed, well-known
  credentials.

  **`@objectstack/plugin-security` — `bootstrapPlatformAdmin` skips the system user**

  `5e831dea3` (#1392) added `ensureSeedIdentity` to the runtime SeedLoader,
  which upserts a non-loginable system identity (`usr_system`, role `system`,
  `system@objectstack.local`) to own seeded records — created _before_ the first
  human sign-up. Because `bootstrapPlatformAdmin` promoted the **earliest-created**
  `sys_user`, on any app that ships seed data `usr_system` won the promotion and
  the real admin login stayed at `role: user`. Login succeeded but Setup and
  Studio (gated by `setup.access` / `studio.access` on `admin_full_access`) were
  invisible — a silent, confusing regression.

  `bootstrap-platform-admin.ts` now filters out the system account
  (`id === SystemUserId.SYSTEM || role === 'system'`) when picking the first user
  to promote, and the "an admin already exists" short-circuit ignores any
  `admin_full_access` grant held by `usr_system` — so a database where it was
  wrongly promoted self-heals on the next boot.

  **`@objectstack/cli` — `os dev` seeds `admin@objectos.ai` / `admin123`**

  The `--admin-email` / `--admin-password` defaults changed from
  `admin@dev.local` / `admin12345` to the fixed, well-known
  `admin@objectos.ai` / `admin123`, so tooling and docs never have to guess the
  seeded credentials. Override with `--admin-email` / `--admin-password`.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [a40d010]
- Updated dependencies [f3424fc]
- Updated dependencies [c8753ef]
- Updated dependencies [406fda5]
- Updated dependencies [f115182]
- Updated dependencies [24c9013]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [08fbbb4]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [3a45780]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [03fd7f0]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/runtime@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/plugin-auth@7.4.0
  - @objectstack/plugin-webhooks@7.4.0
  - @objectstack/plugin-approvals@7.4.0
  - @objectstack/plugin-security@7.4.0
  - @objectstack/plugin-sharing@7.4.0
  - @objectstack/service-messaging@7.4.0
  - @objectstack/plugin-audit@7.4.0
  - @objectstack/service-automation@7.4.0
  - @objectstack/driver-sql@7.4.0
  - @objectstack/rest@7.4.0
  - @objectstack/service-external-datasource@7.4.0
  - @objectstack/service-ai@7.4.0
  - @objectstack/client@7.4.0
  - @objectstack/service-settings@7.4.0
  - @objectstack/plugin-trigger-record-change@7.4.0
  - @objectstack/plugin-trigger-schedule@7.4.0
  - @objectstack/account@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/observability@7.4.0
  - @objectstack/driver-memory@7.4.0
  - @objectstack/driver-mongodb@7.4.0
  - @objectstack/driver-sqlite-wasm@7.4.0
  - @objectstack/plugin-email@7.4.0
  - @objectstack/plugin-hono-server@7.4.0
  - @objectstack/plugin-mcp-server@7.4.0
  - @objectstack/plugin-org-scoping@7.4.0
  - @objectstack/plugin-reports@7.4.0
  - @objectstack/service-analytics@7.4.0
  - @objectstack/service-cache@7.4.0
  - @objectstack/service-feed@7.4.0
  - @objectstack/service-job@7.4.0
  - @objectstack/service-package@7.4.0
  - @objectstack/service-queue@7.4.0
  - @objectstack/service-realtime@7.4.0
  - @objectstack/service-storage@7.4.0
  - @objectstack/types@7.4.0
  - @objectstack/console@7.4.0

## 7.3.0

### Patch Changes

- 45259d6: **`os start` no longer silently shifts ports on a conflict.**

  Port resolution is unchanged (`--port` › `$OS_PORT` › `$PORT` › `3000`), but the
  conflict behaviour is now mode-dependent:

  - **Dev** (`os dev`, or `NODE_ENV=development`): still auto-hops to the next free
    port (up to +100) so multiple example apps can run side-by-side. The startup
    banner shows the actual bound port.
  - **Production** (`os start`): if the resolved port is busy, the CLI now fails
    loudly and exits `1` instead of binding a different port. A silently drifted
    port breaks reverse-proxy upstreams, better-auth callback URLs (`OS_AUTH_URL`),
    and CORS trusted-origins (`OS_TRUSTED_ORIGINS`) as opaque 403/502s.

  Also fixed: the `os start` startup banner now prints the real Console URL when
  the port comes from `$PORT`/`$OS_PORT` (previously it always showed the
  `--port`/`3000` value, which could be wrong).

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/account@7.3.0
  - @objectstack/client@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/observability@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/driver-memory@7.3.0
  - @objectstack/driver-mongodb@7.3.0
  - @objectstack/driver-sql@7.3.0
  - @objectstack/driver-sqlite-wasm@7.3.0
  - @objectstack/plugin-approvals@7.3.0
  - @objectstack/plugin-audit@7.3.0
  - @objectstack/plugin-auth@7.3.0
  - @objectstack/plugin-email@7.3.0
  - @objectstack/plugin-hono-server@7.3.0
  - @objectstack/plugin-mcp-server@7.3.0
  - @objectstack/plugin-org-scoping@7.3.0
  - @objectstack/plugin-reports@7.3.0
  - @objectstack/plugin-security@7.3.0
  - @objectstack/plugin-sharing@7.3.0
  - @objectstack/plugin-webhooks@7.3.0
  - @objectstack/rest@7.3.0
  - @objectstack/runtime@7.3.0
  - @objectstack/service-ai@7.3.0
  - @objectstack/service-analytics@7.3.0
  - @objectstack/service-automation@7.3.0
  - @objectstack/service-cache@7.3.0
  - @objectstack/service-feed@7.3.0
  - @objectstack/service-job@7.3.0
  - @objectstack/service-package@7.3.0
  - @objectstack/service-queue@7.3.0
  - @objectstack/service-realtime@7.3.0
  - @objectstack/service-settings@7.3.0
  - @objectstack/service-storage@7.3.0
  - @objectstack/types@7.3.0
  - @objectstack/console@7.3.0

## 7.2.1

### Patch Changes

- 9096dfe: **`OS_` env-var prefix migration** (issue #1382).

  All ObjectStack-owned environment variables now use the `OS_` prefix. Legacy
  names still work for one release and emit a one-shot deprecation warning via
  the new `readEnvWithDeprecation()` helper in `@objectstack/types`.

  **Renamed (with legacy fallback):**

  | New                       | Legacy (deprecated)                                    |
  | :------------------------ | :----------------------------------------------------- |
  | `OS_AUTH_SECRET`          | `AUTH_SECRET`, `BETTER_AUTH_SECRET`                    |
  | `OS_AUTH_URL`             | `AUTH_BASE_URL`, `BETTER_AUTH_URL`, `OS_AUTH_BASE_URL` |
  | `OS_PORT`                 | `PORT`                                                 |
  | `OS_DATABASE_URL`         | `DATABASE_URL`                                         |
  | `OS_ROOT_DOMAIN`          | `ROOT_DOMAIN`                                          |
  | `OS_MULTI_ORG_ENABLED`    | `OS_MULTI_TENANT`                                      |
  | `OS_CORS_ENABLED`         | `CORS_ENABLED`                                         |
  | `OS_CORS_ORIGIN`          | `CORS_ORIGIN`                                          |
  | `OS_CORS_CREDENTIALS`     | `CORS_CREDENTIALS`                                     |
  | `OS_CORS_MAX_AGE`         | `CORS_MAX_AGE`                                         |
  | `OS_AI_MODEL`             | `AI_MODEL`                                             |
  | `OS_MCP_SERVER_ENABLED`   | `MCP_SERVER_ENABLED`                                   |
  | `OS_MCP_SERVER_NAME`      | `MCP_SERVER_NAME`                                      |
  | `OS_MCP_SERVER_TRANSPORT` | `MCP_SERVER_TRANSPORT`                                 |
  | `OS_NODE_ID`              | `OBJECTSTACK_NODE_ID`                                  |
  | `OS_METADATA_WRITABLE`    | `OBJECTSTACK_METADATA_WRITABLE`                        |
  | `OS_DEV_CRYPTO_KEY`       | `OBJECTSTACK_DEV_CRYPTO_KEY`                           |
  | `OS_HOME`                 | `OBJECTSTACK_HOME`                                     |

  **Migration:** rename in your `.env`. Legacy names continue to work this
  release and will be removed in a future major. Industry-standard names
  (`NODE_ENV`, `HOME`, `OPENAI_API_KEY`, `TURSO_*`, OAuth
  `*_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `POSTMARK_TOKEN`,
  `AI_GATEWAY_*`, `SMTP_*`) are NOT renamed.

- Updated dependencies [9096dfe]
  - @objectstack/types@7.2.1
  - @objectstack/runtime@7.2.1
  - @objectstack/objectql@7.2.1
  - @objectstack/plugin-auth@7.2.1
  - @objectstack/plugin-hono-server@7.2.1
  - @objectstack/plugin-mcp-server@7.2.1
  - @objectstack/plugin-webhooks@7.2.1
  - @objectstack/service-ai@7.2.1
  - @objectstack/service-settings@7.2.1
  - @objectstack/client@7.2.1
  - @objectstack/plugin-sharing@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/console@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/observability@7.2.1
  - @objectstack/platform-objects@7.2.1
  - @objectstack/rest@7.2.1
  - @objectstack/driver-memory@7.2.1
  - @objectstack/driver-sql@7.2.1
  - @objectstack/driver-mongodb@7.2.1
  - @objectstack/driver-sqlite-wasm@7.2.1
  - @objectstack/plugin-approvals@7.2.1
  - @objectstack/plugin-audit@7.2.1
  - @objectstack/plugin-email@7.2.1
  - @objectstack/plugin-org-scoping@7.2.1
  - @objectstack/plugin-reports@7.2.1
  - @objectstack/plugin-security@7.2.1
  - @objectstack/service-analytics@7.2.1
  - @objectstack/service-automation@7.2.1
  - @objectstack/service-cache@7.2.1
  - @objectstack/service-feed@7.2.1
  - @objectstack/service-job@7.2.1
  - @objectstack/service-package@7.2.1
  - @objectstack/service-queue@7.2.1
  - @objectstack/service-realtime@7.2.1
  - @objectstack/service-storage@7.2.1
  - @objectstack/account@7.2.1

## 7.2.0

### Patch Changes

- Updated dependencies [d662c01]
  - @objectstack/console@7.2.0
  - @objectstack/spec@7.2.0
  - @objectstack/core@7.2.0
  - @objectstack/client@7.2.0
  - @objectstack/objectql@7.2.0
  - @objectstack/observability@7.2.0
  - @objectstack/platform-objects@7.2.0
  - @objectstack/runtime@7.2.0
  - @objectstack/rest@7.2.0
  - @objectstack/driver-memory@7.2.0
  - @objectstack/driver-sql@7.2.0
  - @objectstack/driver-mongodb@7.2.0
  - @objectstack/driver-sqlite-wasm@7.2.0
  - @objectstack/plugin-approvals@7.2.0
  - @objectstack/plugin-audit@7.2.0
  - @objectstack/plugin-auth@7.2.0
  - @objectstack/plugin-email@7.2.0
  - @objectstack/plugin-hono-server@7.2.0
  - @objectstack/plugin-mcp-server@7.2.0
  - @objectstack/plugin-org-scoping@7.2.0
  - @objectstack/plugin-reports@7.2.0
  - @objectstack/plugin-security@7.2.0
  - @objectstack/plugin-sharing@7.2.0
  - @objectstack/plugin-webhooks@7.2.0
  - @objectstack/service-ai@7.2.0
  - @objectstack/service-analytics@7.2.0
  - @objectstack/service-automation@7.2.0
  - @objectstack/service-cache@7.2.0
  - @objectstack/service-feed@7.2.0
  - @objectstack/service-job@7.2.0
  - @objectstack/service-package@7.2.0
  - @objectstack/service-queue@7.2.0
  - @objectstack/service-realtime@7.2.0
  - @objectstack/service-settings@7.2.0
  - @objectstack/service-storage@7.2.0
  - @objectstack/account@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [89771d4]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/account@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/runtime@7.1.0
  - @objectstack/plugin-approvals@7.1.0
  - @objectstack/plugin-audit@7.1.0
  - @objectstack/plugin-auth@7.1.0
  - @objectstack/plugin-email@7.1.0
  - @objectstack/plugin-org-scoping@7.1.0
  - @objectstack/plugin-reports@7.1.0
  - @objectstack/plugin-security@7.1.0
  - @objectstack/plugin-sharing@7.1.0
  - @objectstack/plugin-webhooks@7.1.0
  - @objectstack/service-ai@7.1.0
  - @objectstack/service-job@7.1.0
  - @objectstack/service-queue@7.1.0
  - @objectstack/service-realtime@7.1.0
  - @objectstack/service-settings@7.1.0
  - @objectstack/client@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/observability@7.1.0
  - @objectstack/driver-memory@7.1.0
  - @objectstack/driver-mongodb@7.1.0
  - @objectstack/driver-sql@7.1.0
  - @objectstack/driver-sqlite-wasm@7.1.0
  - @objectstack/plugin-hono-server@7.1.0
  - @objectstack/plugin-mcp-server@7.1.0
  - @objectstack/rest@7.1.0
  - @objectstack/service-analytics@7.1.0
  - @objectstack/service-automation@7.1.0
  - @objectstack/service-cache@7.1.0
  - @objectstack/service-feed@7.1.0
  - @objectstack/service-package@7.1.0
  - @objectstack/service-storage@7.1.0
  - @objectstack/console@7.1.0

## 7.0.0

### Major Changes

- dc72172: **Breaking:** Removed `@objectstack/driver-turso` and `@objectstack/knowledge-turso` from the open-core framework.

  The Turso/libSQL driver and its native-vector knowledge adapter now ship exclusively with the **ObjectStack Cloud** distribution (`objectstack-ai/cloud`). Rationale: Turso is used only for cloud/edge multi-tenant deployments — local development uses better-sqlite3 (faster), and the Turso integration is part of ObjectStack's commercial offering.

  ### What moved out

  - `@objectstack/driver-turso` → `objectstack-ai/cloud/packages/driver-turso`
  - `@objectstack/knowledge-turso` → `objectstack-ai/cloud/packages/knowledge-turso`
  - `ITursoPlatformService` contract (spec/contracts/turso-platform.ts) — removed entirely
  - `TursoConfigSchema`, `TursoDriverSpec`, `TursoMultiTenantConfigSchema`, `TenantResolverStrategySchema`, etc. — moved into `@objectstack/driver-turso` (re-exported from cloud)

  ### Framework-side changes

  - `packages/runtime/src/standalone-stack.ts`: `databaseDriver` enum no longer accepts `'turso'`; `libsql://`/`https://` URL detection removed. Cloud builds register the Turso driver via their own stack composition.
  - `packages/runtime/src/cloud/artifact-environment-registry.ts`: dropped `case 'libsql'/'turso'`. Cloud has its own `ArtifactEnvironmentRegistry` that handles Turso.
  - `packages/cli/src/commands/serve.ts`: removed `driverType === 'turso' | 'libsql'` branch.
  - `packages/runtime/package.json`, `packages/cli/package.json`: removed optional peerDep on `@objectstack/driver-turso`.
  - `packages/runtime/tsup.config.ts`: removed `@objectstack/driver-turso` from `external`.
  - `packages/spec/src/contracts/index.ts`: stopped re-exporting `turso-platform.js`.
  - `packages/spec/src/data/index.ts`: stopped re-exporting `driver/turso-multi-tenant.zod`.

  ### Migration for open-source users

  If you used `libsql://` URLs or `@objectstack/driver-turso` directly, either:

  1. Switch to `file:` URLs (better-sqlite3 via `@objectstack/driver-sql`) for local/self-hosted deployments, **or**
  2. Use ObjectStack Cloud, which ships the Turso driver as part of the commercial distribution.

### Patch Changes

- 3a630b6: **Split organization-scoping from `@objectstack/plugin-security` into a new `@objectstack/plugin-org-scoping` package.**

  Per ADR-0002, "tenant" in ObjectStack means _physical_ isolation (one Environment = one database, handled by `@objectstack/driver-turso`'s multi-tenant router). The row-level `organization_id` scoping that previously lived inside SecurityPlugin is a different concept — _logical_ scoping inside a single DB — and now ships as its own plugin.

  ### Breaking changes — `@objectstack/plugin-security`

  - Removed the `multiTenant` constructor option. SecurityPlugin no longer touches `organization_id` on insert and no longer registers the `sys_organization` post-create seed pipeline.
  - Wildcard `current_user.organization_id` RLS policies in the default permission sets are now stripped UNLESS the new `org-scoping` service is registered (i.e. unless `OrgScopingPlugin` is also installed).
  - Removed export `cloneTenantSeedData` (now exposed as `cloneOrgSeedData` from `@objectstack/plugin-org-scoping`).
  - `bootstrapPlatformAdmin()` no longer accepts a `multiTenant` flag and no longer auto-creates a default organization — that behavior moved to `ensureDefaultOrganization()` in the new plugin.

  ### Migration

  Single-tenant deployments — no action required.

  Multi-tenant deployments (previously `new SecurityPlugin({ multiTenant: true })`):

  ```diff
  + import { OrgScopingPlugin } from '@objectstack/plugin-org-scoping';
    import { SecurityPlugin } from '@objectstack/plugin-security';

  + await kernel.use(new OrgScopingPlugin());     // MUST be BEFORE SecurityPlugin
  - await kernel.use(new SecurityPlugin({ multiTenant: true }));
  + await kernel.use(new SecurityPlugin());
  ```

  The runtime's `OS_MULTI_TENANT` env switch — read by `@objectstack/runtime/cloud/ArtifactKernelFactory`, `@objectstack/plugin-dev`, and the `objectstack` CLI's `serve` / `dev` / `start` commands — automatically registers `OrgScopingPlugin` when set to `true`, so projects driven by the CLI need no code changes.

- 9496b5b: Vendor `@object-ui/console` as `@objectstack/console`, a new dist-only
  package shipped at the framework version. A single `pnpm add
@objectstack/framework` now installs a version-matched Console SPA — no
  second npm dep to keep in sync.

  The Console source-of-truth remains [`@object-ui/console`](https://github.com/objectstack-ai/objectui).
  The framework pins it by SHA in `.objectui-sha`; CI's release workflow
  clones objectui at that SHA, builds the SPA, and publishes the dist as
  `@objectstack/console`.

  The CLI's `resolveConsolePath()` now prefers `@objectstack/console` and
  falls back to `@object-ui/console`, so cloud's Docker overlay flow and
  advanced users who pin `@object-ui/console` directly still take
  precedence. `@object-ui/console` has been demoted from CLI runtime
  dependency to dev fallback.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [39a23c5]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
- Updated dependencies [9496b5b]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/plugin-auth@7.0.0
  - @objectstack/account@7.0.0
  - @objectstack/runtime@7.0.0
  - @objectstack/plugin-security@7.0.0
  - @objectstack/plugin-org-scoping@7.0.0
  - @objectstack/console@7.0.0
  - @objectstack/client@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0
  - @objectstack/observability@7.0.0
  - @objectstack/driver-memory@7.0.0
  - @objectstack/driver-mongodb@7.0.0
  - @objectstack/driver-sql@7.0.0
  - @objectstack/driver-sqlite-wasm@7.0.0
  - @objectstack/plugin-approvals@7.0.0
  - @objectstack/plugin-audit@7.0.0
  - @objectstack/plugin-email@7.0.0
  - @objectstack/plugin-hono-server@7.0.0
  - @objectstack/plugin-mcp-server@7.0.0
  - @objectstack/plugin-reports@7.0.0
  - @objectstack/plugin-sharing@7.0.0
  - @objectstack/plugin-webhooks@7.0.0
  - @objectstack/rest@7.0.0
  - @objectstack/service-ai@7.0.0
  - @objectstack/service-analytics@7.0.0
  - @objectstack/service-automation@7.0.0
  - @objectstack/service-cache@7.0.0
  - @objectstack/service-feed@7.0.0
  - @objectstack/service-job@7.0.0
  - @objectstack/service-package@7.0.0
  - @objectstack/service-queue@7.0.0
  - @objectstack/service-realtime@7.0.0
  - @objectstack/service-settings@7.0.0
  - @objectstack/service-storage@7.0.0

## 6.9.0

### Patch Changes

- Updated dependencies [bac7ae5]
- Updated dependencies [e9bacda]
  - @objectstack/runtime@6.9.0
  - @objectstack/service-ai@6.9.0
  - @objectstack/service-settings@6.9.0
  - @objectstack/client@6.9.0
  - @objectstack/spec@6.9.0
  - @objectstack/core@6.9.0
  - @objectstack/objectql@6.9.0
  - @objectstack/observability@6.9.0
  - @objectstack/rest@6.9.0
  - @objectstack/driver-memory@6.9.0
  - @objectstack/driver-sql@6.9.0
  - @objectstack/driver-mongodb@6.9.0
  - @objectstack/driver-sqlite-wasm@6.9.0
  - @objectstack/plugin-approvals@6.9.0
  - @objectstack/plugin-audit@6.9.0
  - @objectstack/plugin-auth@6.9.0
  - @objectstack/plugin-email@6.9.0
  - @objectstack/plugin-hono-server@6.9.0
  - @objectstack/plugin-mcp-server@6.9.0
  - @objectstack/plugin-reports@6.9.0
  - @objectstack/plugin-security@6.9.0
  - @objectstack/plugin-sharing@6.9.0
  - @objectstack/plugin-webhooks@6.9.0
  - @objectstack/service-analytics@6.9.0
  - @objectstack/service-automation@6.9.0
  - @objectstack/service-cache@6.9.0
  - @objectstack/service-feed@6.9.0
  - @objectstack/service-job@6.9.0
  - @objectstack/service-package@6.9.0
  - @objectstack/service-queue@6.9.0
  - @objectstack/service-realtime@6.9.0
  - @objectstack/service-storage@6.9.0
  - @objectstack/account@6.9.0

## 6.8.1

### Patch Changes

- bca0ee5: `os dev` and `os start` now load `.env` files via dotenv-flow, matching
  the existing `os serve` behavior. Previously only `serve` honored
  `.env` / `.env.development` / `.env.production` / `.env.local`, which
  made env-based configuration (e.g. `OS_DATABASE_URL`) silently inert
  for the two most commonly used commands and surprised users who set up
  the conventional `.env.*` layout.

  Loading order (later wins): `.env`, `.env.${NODE_ENV}`, `.env.local`,
  `.env.${NODE_ENV}.local`. `os dev` pins NODE_ENV to `development`; `os
start` defaults to `production`. Process env still wins over file
  values, so CLI flags and shell exports remain authoritative.

  - @objectstack/spec@6.8.1
  - @objectstack/core@6.8.1
  - @objectstack/client@6.8.1
  - @objectstack/objectql@6.8.1
  - @objectstack/observability@6.8.1
  - @objectstack/runtime@6.8.1
  - @objectstack/rest@6.8.1
  - @objectstack/driver-memory@6.8.1
  - @objectstack/driver-sql@6.8.1
  - @objectstack/driver-mongodb@6.8.1
  - @objectstack/driver-sqlite-wasm@6.8.1
  - @objectstack/plugin-approvals@6.8.1
  - @objectstack/plugin-audit@6.8.1
  - @objectstack/plugin-auth@6.8.1
  - @objectstack/plugin-email@6.8.1
  - @objectstack/plugin-hono-server@6.8.1
  - @objectstack/plugin-mcp-server@6.8.1
  - @objectstack/plugin-reports@6.8.1
  - @objectstack/plugin-security@6.8.1
  - @objectstack/plugin-sharing@6.8.1
  - @objectstack/plugin-webhooks@6.8.1
  - @objectstack/service-ai@6.8.1
  - @objectstack/service-analytics@6.8.1
  - @objectstack/service-automation@6.8.1
  - @objectstack/service-cache@6.8.1
  - @objectstack/service-feed@6.8.1
  - @objectstack/service-job@6.8.1
  - @objectstack/service-package@6.8.1
  - @objectstack/service-queue@6.8.1
  - @objectstack/service-realtime@6.8.1
  - @objectstack/service-settings@6.8.1
  - @objectstack/service-storage@6.8.1
  - @objectstack/account@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [99866d8]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
- Updated dependencies [0a40bd1]
  - @objectstack/service-ai@6.8.0
  - @objectstack/spec@6.8.0
  - @objectstack/account@6.8.0
  - @objectstack/rest@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/runtime@6.8.0
  - @objectstack/service-settings@6.8.0
  - @objectstack/client@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/observability@6.8.0
  - @objectstack/driver-memory@6.8.0
  - @objectstack/driver-mongodb@6.8.0
  - @objectstack/driver-sql@6.8.0
  - @objectstack/driver-sqlite-wasm@6.8.0
  - @objectstack/plugin-approvals@6.8.0
  - @objectstack/plugin-audit@6.8.0
  - @objectstack/plugin-auth@6.8.0
  - @objectstack/plugin-email@6.8.0
  - @objectstack/plugin-hono-server@6.8.0
  - @objectstack/plugin-mcp-server@6.8.0
  - @objectstack/plugin-reports@6.8.0
  - @objectstack/plugin-security@6.8.0
  - @objectstack/plugin-sharing@6.8.0
  - @objectstack/plugin-webhooks@6.8.0
  - @objectstack/service-analytics@6.8.0
  - @objectstack/service-automation@6.8.0
  - @objectstack/service-cache@6.8.0
  - @objectstack/service-feed@6.8.0
  - @objectstack/service-job@6.8.0
  - @objectstack/service-package@6.8.0
  - @objectstack/service-queue@6.8.0
  - @objectstack/service-realtime@6.8.0
  - @objectstack/service-storage@6.8.0

## 6.7.1

### Patch Changes

- 3b2a1da: Add `@objectstack/account` as a direct dependency of `@objectstack/cli`.

  **Bug**: `npx @objectstack/cli start` started the server successfully but visiting `http://localhost:3000/` produced a raw `{"error":"Not found"}` JSON response. Root cause: the Console SPA redirects unauthenticated users to `/_account/login` (hardcoded in the published Console bundle), but the `@objectstack/account` package was never declared as a CLI dependency. The start log even printed `⚠ @objectstack/account not found — skipping Account UI`, yet the Console kept pointing browsers at the missing mount.

  **Fix**: declare `@objectstack/account` in `packages/cli/package.json` so `npm install @objectstack/cli` pulls the account portal automatically. Verified end-to-end in a clean `/tmp/test-670-patched` install:

  - `npm ls @objectstack/account` → installed
  - `/_account/login` → 200 (was 404)
  - Navigating to `/` correctly routes through Console → Account `/setup` (the first-run owner-account wizard) instead of dead-ending in the API catch-all.

  No change to `@libsql/client` posture — it remains absent from default installs.

- Updated dependencies [87c4d19]
  - @objectstack/account@6.7.1
  - @objectstack/spec@6.7.1
  - @objectstack/core@6.7.1
  - @objectstack/client@6.7.1
  - @objectstack/objectql@6.7.1
  - @objectstack/observability@6.7.1
  - @objectstack/runtime@6.7.1
  - @objectstack/rest@6.7.1
  - @objectstack/driver-memory@6.7.1
  - @objectstack/driver-sql@6.7.1
  - @objectstack/driver-mongodb@6.7.1
  - @objectstack/driver-sqlite-wasm@6.7.1
  - @objectstack/plugin-approvals@6.7.1
  - @objectstack/plugin-audit@6.7.1
  - @objectstack/plugin-auth@6.7.1
  - @objectstack/plugin-email@6.7.1
  - @objectstack/plugin-hono-server@6.7.1
  - @objectstack/plugin-mcp-server@6.7.1
  - @objectstack/plugin-reports@6.7.1
  - @objectstack/plugin-security@6.7.1
  - @objectstack/plugin-sharing@6.7.1
  - @objectstack/plugin-webhooks@6.7.1
  - @objectstack/service-ai@6.7.1
  - @objectstack/service-analytics@6.7.1
  - @objectstack/service-automation@6.7.1
  - @objectstack/service-cache@6.7.1
  - @objectstack/service-feed@6.7.1
  - @objectstack/service-job@6.7.1
  - @objectstack/service-package@6.7.1
  - @objectstack/service-queue@6.7.1
  - @objectstack/service-realtime@6.7.1
  - @objectstack/service-settings@6.7.1
  - @objectstack/service-storage@6.7.1

## 6.7.0

### Patch Changes

- c5efe15: Remove residual coupling to the (already-extracted) `@objectstack/service-cloud` package.

  The cloud distribution was migrated to a separate repo a while back, but the open-core CLI still carried:

  - A dynamic `import('@objectstack/service-cloud')` in the boot-mode dispatch for `cloud` / `runtime` modes.
  - A dev-mode auto-mount that tried to load `createSingleEnvironmentPlugin` from the cloud package (now fully covered by the built-in `RuntimeConfigPlugin`).
  - An ambient `.d.ts` stub for `@objectstack/service-cloud`.
  - A leftover empty `packages/services/service-cloud/` directory (only stale `dist/` + `node_modules/`).
  - Several doc-comment references.

  All gone. The open-core CLI now supports `bootMode: 'standalone'` only — non-standalone modes throw a clear error pointing users to the cloud distribution. No runtime behavior change for standalone users.

- 4944f3a: Fix `npx @objectstack/cli start` crashing with `Cannot find package
'@objectstack/metadata'` (and friends).

  `@objectstack/runtime` dynamically `import()`s `@objectstack/metadata`,
  `@objectstack/objectql`, and the storage drivers (`driver-memory`,
  `driver-sql`, `driver-sqlite-wasm`, `driver-turso`) from
  `createStandaloneStack` / `createDefaultHostConfig`, but they were only
  listed in `devDependencies` — so when the package was installed from npm
  (rather than the workspace) these imports failed at boot.

  They are now declared as real `dependencies`. `@objectstack/driver-mongodb`
  remains an `optionalDependency` because the standalone stack only loads
  it when the user passes a `mongodb://` URL (the failure path already has
  a friendly error message).

  Also adds a small quick-start CLI command (`objectstack start`) that
  auto-creates `~/.objectstack/{data,dist,auth-secret}`, boots an empty
  kernel with Studio + marketplace mounted, and lets users install apps at
  runtime — no `objectstack.config.ts` required.

- e0c593f: Make `@objectstack/driver-turso` an **optional peer dependency** so default `npx @objectstack/cli start` no longer installs `@libsql/client` (~5MB + native binaries) nor `libsql` native modules.

  Rationale: `objectstack start` defaults to `file:` URLs which route to `better-sqlite3` via `driver-sql` (10–15× faster than libsql for OLTP, see benchmarks). For RAG / vector workloads, `sqlite-vec` (~600KB) is the recommended local backend. Turso / libsql is only useful when the user explicitly opts in via `libsql://` / `https://` / `--database-driver turso`.

  Changes:

  - `packages/cli/package.json`: moved `@objectstack/driver-turso` from `dependencies` to optional `peerDependencies` (`peerDependenciesMeta.optional = true`). npm 7+ does **not** auto-install optional peers; `optionalDependencies` would have still installed it.
  - `packages/runtime/package.json`: same.
  - All three dynamic-import sites for `driver-turso` (`runtime/src/standalone-stack.ts`, `runtime/src/cloud/artifact-environment-registry.ts`, `cli/src/commands/serve.ts`) now wrap the `import()` in try/catch with an actionable error message pointing users to `npm install @objectstack/driver-turso`.

  Verified in `/tmp/os-sim`: fresh `npm install @objectstack/cli` no longer contains `node_modules/@libsql`, `node_modules/libsql`, or `node_modules/@objectstack/driver-turso`. `objectstack start` boots cleanly with better-sqlite3; `--database libsql://…` produces the friendly error.

- Updated dependencies [4944f3a]
- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [4f9e9d4]
- Updated dependencies [e0c593f]
  - @objectstack/driver-sql@6.7.0
  - @objectstack/spec@6.7.0
  - @objectstack/service-ai@6.7.0
  - @objectstack/runtime@6.7.0
  - @objectstack/service-settings@6.7.0
  - @objectstack/driver-sqlite-wasm@6.7.0
  - @objectstack/client@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/objectql@6.7.0
  - @objectstack/observability@6.7.0
  - @objectstack/driver-memory@6.7.0
  - @objectstack/driver-mongodb@6.7.0
  - @objectstack/plugin-approvals@6.7.0
  - @objectstack/plugin-audit@6.7.0
  - @objectstack/plugin-auth@6.7.0
  - @objectstack/plugin-email@6.7.0
  - @objectstack/plugin-hono-server@6.7.0
  - @objectstack/plugin-mcp-server@6.7.0
  - @objectstack/plugin-reports@6.7.0
  - @objectstack/plugin-security@6.7.0
  - @objectstack/plugin-sharing@6.7.0
  - @objectstack/plugin-webhooks@6.7.0
  - @objectstack/rest@6.7.0
  - @objectstack/service-analytics@6.7.0
  - @objectstack/service-automation@6.7.0
  - @objectstack/service-cache@6.7.0
  - @objectstack/service-feed@6.7.0
  - @objectstack/service-job@6.7.0
  - @objectstack/service-package@6.7.0
  - @objectstack/service-queue@6.7.0
  - @objectstack/service-realtime@6.7.0
  - @objectstack/service-storage@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/client@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/observability@6.6.0
  - @objectstack/driver-memory@6.6.0
  - @objectstack/driver-mongodb@6.6.0
  - @objectstack/driver-sql@6.6.0
  - @objectstack/driver-sqlite-wasm@6.6.0
  - @objectstack/driver-turso@6.6.0
  - @objectstack/plugin-approvals@6.6.0
  - @objectstack/plugin-audit@6.6.0
  - @objectstack/plugin-auth@6.6.0
  - @objectstack/plugin-email@6.6.0
  - @objectstack/plugin-hono-server@6.6.0
  - @objectstack/plugin-mcp-server@6.6.0
  - @objectstack/plugin-reports@6.6.0
  - @objectstack/plugin-security@6.6.0
  - @objectstack/plugin-sharing@6.6.0
  - @objectstack/plugin-webhooks@6.6.0
  - @objectstack/rest@6.6.0
  - @objectstack/runtime@6.6.0
  - @objectstack/service-ai@6.6.0
  - @objectstack/service-analytics@6.6.0
  - @objectstack/service-automation@6.6.0
  - @objectstack/service-cache@6.6.0
  - @objectstack/service-feed@6.6.0
  - @objectstack/service-job@6.6.0
  - @objectstack/service-package@6.6.0
  - @objectstack/service-queue@6.6.0
  - @objectstack/service-realtime@6.6.0
  - @objectstack/service-settings@6.6.0
  - @objectstack/service-storage@6.6.0

## 6.5.1

### Patch Changes

- Updated dependencies [de239ef]
  - @objectstack/plugin-auth@6.5.1
  - @objectstack/runtime@6.5.1
  - @objectstack/client@6.5.1
  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/objectql@6.5.1
  - @objectstack/observability@6.5.1
  - @objectstack/rest@6.5.1
  - @objectstack/driver-memory@6.5.1
  - @objectstack/driver-sql@6.5.1
  - @objectstack/driver-turso@6.5.1
  - @objectstack/driver-mongodb@6.5.1
  - @objectstack/driver-sqlite-wasm@6.5.1
  - @objectstack/plugin-approvals@6.5.1
  - @objectstack/plugin-audit@6.5.1
  - @objectstack/plugin-email@6.5.1
  - @objectstack/plugin-hono-server@6.5.1
  - @objectstack/plugin-mcp-server@6.5.1
  - @objectstack/plugin-reports@6.5.1
  - @objectstack/plugin-security@6.5.1
  - @objectstack/plugin-sharing@6.5.1
  - @objectstack/plugin-webhooks@6.5.1
  - @objectstack/service-ai@6.5.1
  - @objectstack/service-analytics@6.5.1
  - @objectstack/service-automation@6.5.1
  - @objectstack/service-cache@6.5.1
  - @objectstack/service-feed@6.5.1
  - @objectstack/service-job@6.5.1
  - @objectstack/service-package@6.5.1
  - @objectstack/service-queue@6.5.1
  - @objectstack/service-realtime@6.5.1
  - @objectstack/service-settings@6.5.1
  - @objectstack/service-storage@6.5.1

## 6.5.0

### Minor Changes

- 777afbf: Include `ai` in the `default` tier preset so `AIServicePlugin` is auto-registered for every stack that opts into the default tier (i.e. any `defineStack` that doesn't override `requires`). Previously AI routes (`/api/v1/ai/*`) only mounted when a stack explicitly listed `'ai'` in `requires` or ran the `full` preset; now they're on by default, matching `i18n`/`ui`/`auth`. The auto-registration block already fails silently if `@objectstack/service-ai` isn't installed, so apps without the package are unaffected.

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/client@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/observability@6.5.0
- @objectstack/runtime@6.5.0
- @objectstack/rest@6.5.0
- @objectstack/driver-memory@6.5.0
- @objectstack/driver-sql@6.5.0
- @objectstack/driver-turso@6.5.0
- @objectstack/driver-mongodb@6.5.0
- @objectstack/driver-sqlite-wasm@6.5.0
- @objectstack/plugin-approvals@6.5.0
- @objectstack/plugin-audit@6.5.0
- @objectstack/plugin-auth@6.5.0
- @objectstack/plugin-email@6.5.0
- @objectstack/plugin-hono-server@6.5.0
- @objectstack/plugin-mcp-server@6.5.0
- @objectstack/plugin-reports@6.5.0
- @objectstack/plugin-security@6.5.0
- @objectstack/plugin-sharing@6.5.0
- @objectstack/plugin-webhooks@6.5.0
- @objectstack/service-ai@6.5.0
- @objectstack/service-analytics@6.5.0
- @objectstack/service-automation@6.5.0
- @objectstack/service-cache@6.5.0
- @objectstack/service-feed@6.5.0
- @objectstack/service-job@6.5.0
- @objectstack/service-package@6.5.0
- @objectstack/service-queue@6.5.0
- @objectstack/service-realtime@6.5.0
- @objectstack/service-settings@6.5.0
- @objectstack/service-storage@6.5.0

## 6.4.0

### Minor Changes

- 15fc484: Upgrade `@object-ui/*` packages to **v6.0**.

  - `@objectstack/cli`: `@object-ui/console` and `@object-ui/studio` from `^5.4.2` → `^6.0.0` — bundled Studio + Console assets now ship the v6 UI shell (new design language, refreshed sidebar, redesigned record header).
  - `@objectstack/account`: `@object-ui/i18n` from `^5.4.2` → `^6.0.0` — i18n runtime now matches the v6 console/studio API.
  - Root devDependency `@object-ui/console` from `^5.4.2` → `^6.0.0` so workspace scripts and the docs build pick up v6.
  - `create-objectstack`: `tar` from `^7.4.3` → `^7.5.15` (security + perf fixes when unpacking remote templates).

  **Heads-up for consumers:** `@object-ui/*` v6 is a major release of the bundled UI; pages rendered through the CLI's `studio` / `console` mounts may look different from v5. The protocol surface is unchanged.

### Patch Changes

- Updated dependencies [a981d57]
- Updated dependencies [b486666]
- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
- Updated dependencies [0bf6f9a]
  - @objectstack/service-ai@6.4.0
  - @objectstack/spec@6.4.0
  - @objectstack/plugin-auth@6.4.0
  - @objectstack/client@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/observability@6.4.0
  - @objectstack/driver-memory@6.4.0
  - @objectstack/driver-mongodb@6.4.0
  - @objectstack/driver-sql@6.4.0
  - @objectstack/driver-sqlite-wasm@6.4.0
  - @objectstack/driver-turso@6.4.0
  - @objectstack/plugin-approvals@6.4.0
  - @objectstack/plugin-audit@6.4.0
  - @objectstack/plugin-email@6.4.0
  - @objectstack/plugin-hono-server@6.4.0
  - @objectstack/plugin-mcp-server@6.4.0
  - @objectstack/plugin-reports@6.4.0
  - @objectstack/plugin-security@6.4.0
  - @objectstack/plugin-sharing@6.4.0
  - @objectstack/plugin-webhooks@6.4.0
  - @objectstack/rest@6.4.0
  - @objectstack/runtime@6.4.0
  - @objectstack/service-analytics@6.4.0
  - @objectstack/service-automation@6.4.0
  - @objectstack/service-cache@6.4.0
  - @objectstack/service-feed@6.4.0
  - @objectstack/service-job@6.4.0
  - @objectstack/service-package@6.4.0
  - @objectstack/service-queue@6.4.0
  - @objectstack/service-realtime@6.4.0
  - @objectstack/service-settings@6.4.0
  - @objectstack/service-storage@6.4.0

## 6.3.0

### Patch Changes

- Updated dependencies [97efe3b]
  - @objectstack/service-settings@6.3.0
  - @objectstack/spec@6.3.0
  - @objectstack/core@6.3.0
  - @objectstack/client@6.3.0
  - @objectstack/objectql@6.3.0
  - @objectstack/observability@6.3.0
  - @objectstack/runtime@6.3.0
  - @objectstack/rest@6.3.0
  - @objectstack/driver-memory@6.3.0
  - @objectstack/driver-sql@6.3.0
  - @objectstack/driver-turso@6.3.0
  - @objectstack/driver-mongodb@6.3.0
  - @objectstack/driver-sqlite-wasm@6.3.0
  - @objectstack/plugin-approvals@6.3.0
  - @objectstack/plugin-audit@6.3.0
  - @objectstack/plugin-auth@6.3.0
  - @objectstack/plugin-email@6.3.0
  - @objectstack/plugin-hono-server@6.3.0
  - @objectstack/plugin-mcp-server@6.3.0
  - @objectstack/plugin-reports@6.3.0
  - @objectstack/plugin-security@6.3.0
  - @objectstack/plugin-sharing@6.3.0
  - @objectstack/plugin-webhooks@6.3.0
  - @objectstack/service-ai@6.3.0
  - @objectstack/service-analytics@6.3.0
  - @objectstack/service-automation@6.3.0
  - @objectstack/service-cache@6.3.0
  - @objectstack/service-feed@6.3.0
  - @objectstack/service-job@6.3.0
  - @objectstack/service-package@6.3.0
  - @objectstack/service-queue@6.3.0
  - @objectstack/service-realtime@6.3.0
  - @objectstack/service-storage@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
- Updated dependencies [13a4f38]
- Updated dependencies [b4c74a9]
- Updated dependencies [bce47a0]
- Updated dependencies [bce47a0]
- Updated dependencies [449e35d]
- Updated dependencies [dbb54e1]
  - @objectstack/plugin-auth@6.2.0
  - @objectstack/service-ai@6.2.0
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0
  - @objectstack/client@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/observability@6.2.0
  - @objectstack/driver-memory@6.2.0
  - @objectstack/driver-mongodb@6.2.0
  - @objectstack/driver-sql@6.2.0
  - @objectstack/driver-sqlite-wasm@6.2.0
  - @objectstack/driver-turso@6.2.0
  - @objectstack/plugin-approvals@6.2.0
  - @objectstack/plugin-audit@6.2.0
  - @objectstack/plugin-email@6.2.0
  - @objectstack/plugin-hono-server@6.2.0
  - @objectstack/plugin-mcp-server@6.2.0
  - @objectstack/plugin-reports@6.2.0
  - @objectstack/plugin-security@6.2.0
  - @objectstack/plugin-sharing@6.2.0
  - @objectstack/plugin-webhooks@6.2.0
  - @objectstack/rest@6.2.0
  - @objectstack/service-analytics@6.2.0
  - @objectstack/service-automation@6.2.0
  - @objectstack/service-cache@6.2.0
  - @objectstack/service-feed@6.2.0
  - @objectstack/service-job@6.2.0
  - @objectstack/service-package@6.2.0
  - @objectstack/service-queue@6.2.0
  - @objectstack/service-realtime@6.2.0
  - @objectstack/service-settings@6.2.0
  - @objectstack/service-storage@6.2.0

## 6.1.1

### Patch Changes

- Updated dependencies [084ee2f]
  - @objectstack/driver-sqlite-wasm@6.1.1
  - @objectstack/runtime@6.1.1
  - @objectstack/spec@6.1.1
  - @objectstack/core@6.1.1
  - @objectstack/client@6.1.1
  - @objectstack/objectql@6.1.1
  - @objectstack/observability@6.1.1
  - @objectstack/rest@6.1.1
  - @objectstack/driver-memory@6.1.1
  - @objectstack/driver-sql@6.1.1
  - @objectstack/driver-turso@6.1.1
  - @objectstack/driver-mongodb@6.1.1
  - @objectstack/plugin-approvals@6.1.1
  - @objectstack/plugin-audit@6.1.1
  - @objectstack/plugin-auth@6.1.1
  - @objectstack/plugin-email@6.1.1
  - @objectstack/plugin-hono-server@6.1.1
  - @objectstack/plugin-mcp-server@6.1.1
  - @objectstack/plugin-reports@6.1.1
  - @objectstack/plugin-security@6.1.1
  - @objectstack/plugin-sharing@6.1.1
  - @objectstack/plugin-webhooks@6.1.1
  - @objectstack/service-ai@6.1.1
  - @objectstack/service-analytics@6.1.1
  - @objectstack/service-automation@6.1.1
  - @objectstack/service-cache@6.1.1
  - @objectstack/service-feed@6.1.1
  - @objectstack/service-job@6.1.1
  - @objectstack/service-package@6.1.1
  - @objectstack/service-queue@6.1.1
  - @objectstack/service-realtime@6.1.1
  - @objectstack/service-settings@6.1.1
  - @objectstack/service-storage@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/service-ai@6.1.0
  - @objectstack/spec@6.1.0
  - @objectstack/client@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/observability@6.1.0
  - @objectstack/driver-memory@6.1.0
  - @objectstack/driver-mongodb@6.1.0
  - @objectstack/driver-sql@6.1.0
  - @objectstack/driver-sqlite-wasm@5.2.2
  - @objectstack/driver-turso@6.1.0
  - @objectstack/plugin-approvals@6.1.0
  - @objectstack/plugin-audit@6.1.0
  - @objectstack/plugin-auth@6.1.0
  - @objectstack/plugin-email@6.1.0
  - @objectstack/plugin-hono-server@6.1.0
  - @objectstack/plugin-mcp-server@6.1.0
  - @objectstack/plugin-reports@6.1.0
  - @objectstack/plugin-security@6.1.0
  - @objectstack/plugin-sharing@6.1.0
  - @objectstack/plugin-webhooks@6.1.0
  - @objectstack/rest@6.1.0
  - @objectstack/runtime@6.1.0
  - @objectstack/service-analytics@6.1.0
  - @objectstack/service-automation@6.1.0
  - @objectstack/service-cache@6.1.0
  - @objectstack/service-feed@6.1.0
  - @objectstack/service-job@6.1.0
  - @objectstack/service-package@6.1.0
  - @objectstack/service-queue@6.1.0
  - @objectstack/service-realtime@6.1.0
  - @objectstack/service-settings@6.1.0
  - @objectstack/service-storage@6.1.0

## 6.0.0

### Major Changes

- 944f187: # v5.0 — `project` → `environment` hard rename

  The runtime concept previously called **"project"** (per-tenant business
  workspace; Org → **Project** → Branch hierarchy; per-project ObjectKernel,
  per-project DB, per-project artifact) is now uniformly called
  **"environment"**.

  This is a **hard rename with no aliases, deprecation shims, or compatibility
  layer**. Upgrade requires a coordinated update of CLI, runtime, server, and any
  clients calling the REST API.

  > Note: "project" in the npm / monorepo sense (the framework itself, `package.json`,
  > tsconfig project references, vitest `projects` config) is **unchanged**.

  ## Breaking changes

  ### CLI

  - Flags renamed:
    - `--project` / `-p` → `--environment` / `-e` (`os publish`, `os rollback`)
    - `--project-id` → `--environment-id` (`os dev`)
  - Default local env id: `proj_local` → `env_local`.
  - Env var: `OS_PROJECT_ID` → `OS_ENVIRONMENT_ID`.
  - Command group renamed: `os projects ...` → `os environments ...`
    (`bind`, `create`, `list`, `show`, `switch`).
  - Persisted auth-config key: `activeProjectId` → `activeEnvironmentId`.

  ### HTTP / REST

  - Scoped routes: `/api/v1/projects/:projectId/...` → `/api/v1/environments/:environmentId/...`.
  - Cloud control-plane routes: `/api/v1/cloud/projects/...` → `/api/v1/cloud/environments/...`
    (including `/cloud/environments/:id/artifact`, `/cloud/environments/:id/metadata`,
    `/cloud/environments/:id/credentials/rotate`, etc.).
  - Header: `X-Project-Id` (and lowercase `x-project-id`) → `X-Environment-Id`
    (`x-environment-id`).
  - Route param name in handlers: `req.params.projectId` → `req.params.environmentId`.
  - Hostname-routing and tenant-resolution code-paths use `environmentId` end-to-end.

  ### Runtime / spec

  - Exported symbols (no aliases):
    - `createSystemProjectPlugin` → `createSystemEnvironmentPlugin`
    - `SYSTEM_PROJECT_ID` → `SYSTEM_ENVIRONMENT_ID`
    - `ProjectArtifactSchema` → `EnvironmentArtifactSchema`
    - `PROJECT_ARTIFACT_SCHEMA_VERSION` → `ENVIRONMENT_ARTIFACT_SCHEMA_VERSION`
    - `ObjectOSProjectPlugin` → `ObjectOSEnvironmentPlugin`
    - `createSingleProjectPlugin` → `createSingleEnvironmentPlugin`
  - Plugin identifier strings:
    - `com.objectstack.runtime.objectos-project` → `objectos-environment`
    - `com.objectstack.studio.single-project` → `single-environment`
    - `com.objectstack.multi-project` → `multi-environment`
    - `com.objectstack.runtime.system-project` → `system-environment`
  - Provisioning hook: `provisionSystemProject` → `provisionSystemEnvironment`.

  ### Database / schemas

  - Column renames on `sys_metadata` and `sys_metadata_history`:
    `project_id` → `environment_id`.
  - Column renames on `sys_activity`: `project_id` → `environment_id` (plus index).
  - Object renames in platform-objects metadata: `sys_project` → `sys_environment`
    (lookup targets), `sys_project_member` → `sys_environment_member`,
    `sys_project_credential` → `sys_environment_credential`.
  - Auth-context field: `active_project_id` → `active_environment_id`.
  - JSON schemas under `packages/spec/json-schema/system/`:
    `ProjectArtifact*.json` → `EnvironmentArtifact*.json` (regenerated at build).

  ### Automatic forward migration

  A new migration `migrateProjectIdToEnvironmentId`
  (`packages/metadata/src/migrations/migrate-project-id-to-environment-id.ts`)
  auto-runs from `DatabaseLoader.ensureSchema()` on bootstrap and rewrites any
  existing `project_id` column on `sys_metadata` / `sys_metadata_history` to
  `environment_id` (idempotent, best-effort). Existing rows are preserved.

  The legacy reverse migration `migrateEnvIdToProjectId` is retained verbatim
  for historical / disaster-recovery use; it is **not** auto-run.

  ## Migration guide

  ```diff
  -os publish --project proj_xyz
  +os publish --environment env_xyz

  -curl -H "X-Project-Id: env_xyz" https://api.example.com/api/v1/data/customer
  +curl -H "X-Environment-Id: env_xyz" https://api.example.com/api/v1/data/customer

  -OS_PROJECT_ID=env_xyz os dev
  +OS_ENVIRONMENT_ID=env_xyz os dev

  -import { createSystemProjectPlugin, SYSTEM_PROJECT_ID } from "@objectstack/runtime";
  +import { createSystemEnvironmentPlugin, SYSTEM_ENVIRONMENT_ID } from "@objectstack/runtime";

  -import { ProjectArtifactSchema } from "@objectstack/spec";
  +import { EnvironmentArtifactSchema } from "@objectstack/spec";
  ```

  If you maintain a Cloud control-plane deployment, the `cloud` repository must
  be updated in lockstep to pick up the new plugin identifier strings
  (`single-environment`, `multi-environment`, `objectos-environment`).

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/service-ai@6.0.0
  - @objectstack/runtime@6.0.0
  - @objectstack/rest@6.0.0
  - @objectstack/client@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0
  - @objectstack/observability@6.0.0
  - @objectstack/driver-memory@6.0.0
  - @objectstack/driver-mongodb@6.0.0
  - @objectstack/driver-sql@6.0.0
  - @objectstack/driver-sqlite-wasm@5.2.1
  - @objectstack/driver-turso@6.0.0
  - @objectstack/plugin-approvals@6.0.0
  - @objectstack/plugin-audit@6.0.0
  - @objectstack/plugin-auth@6.0.0
  - @objectstack/plugin-email@6.0.0
  - @objectstack/plugin-hono-server@6.0.0
  - @objectstack/plugin-mcp-server@6.0.0
  - @objectstack/plugin-reports@6.0.0
  - @objectstack/plugin-security@6.0.0
  - @objectstack/plugin-sharing@6.0.0
  - @objectstack/plugin-webhooks@6.0.0
  - @objectstack/service-analytics@6.0.0
  - @objectstack/service-automation@6.0.0
  - @objectstack/service-cache@6.0.0
  - @objectstack/service-feed@6.0.0
  - @objectstack/service-job@6.0.0
  - @objectstack/service-package@6.0.0
  - @objectstack/service-queue@6.0.0
  - @objectstack/service-realtime@6.0.0
  - @objectstack/service-settings@6.0.0
  - @objectstack/service-storage@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/plugin-approvals@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/plugin-security@5.2.0
  - @objectstack/plugin-hono-server@5.2.0
  - @objectstack/rest@5.2.0
  - @objectstack/plugin-audit@5.2.0
  - @objectstack/plugin-auth@5.2.0
  - @objectstack/plugin-email@5.2.0
  - @objectstack/plugin-reports@5.2.0
  - @objectstack/plugin-sharing@5.2.0
  - @objectstack/plugin-webhooks@5.2.0
  - @objectstack/service-ai@5.2.0
  - @objectstack/service-job@5.2.0
  - @objectstack/service-queue@5.2.0
  - @objectstack/service-realtime@5.2.0
  - @objectstack/service-settings@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/objectql@5.2.0
  - @objectstack/observability@5.2.0
  - @objectstack/driver-memory@5.2.0
  - @objectstack/driver-mongodb@5.2.0
  - @objectstack/driver-sql@5.2.0
  - @objectstack/driver-turso@5.2.0
  - @objectstack/plugin-mcp-server@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0
  - @objectstack/service-cache@5.2.0
  - @objectstack/service-feed@5.2.0
  - @objectstack/service-package@5.2.0
  - @objectstack/service-storage@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/driver-memory@5.1.0
  - @objectstack/driver-mongodb@5.1.0
  - @objectstack/driver-sql@5.1.0
  - @objectstack/driver-turso@5.1.0
  - @objectstack/plugin-approvals@5.1.0
  - @objectstack/plugin-audit@5.1.0
  - @objectstack/plugin-auth@5.1.0
  - @objectstack/plugin-email@5.1.0
  - @objectstack/plugin-hono-server@5.1.0
  - @objectstack/plugin-mcp-server@5.1.0
  - @objectstack/plugin-reports@5.1.0
  - @objectstack/plugin-security@5.1.0
  - @objectstack/plugin-sharing@5.1.0
  - @objectstack/rest@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-ai@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0
  - @objectstack/service-cache@5.1.0
  - @objectstack/service-feed@5.1.0
  - @objectstack/service-job@5.1.0
  - @objectstack/service-package@5.1.0
  - @objectstack/service-queue@5.1.0
  - @objectstack/service-realtime@5.1.0
  - @objectstack/service-settings@5.1.0
  - @objectstack/service-storage@5.1.0

## 5.0.0

### Patch Changes

- 9e51868: Server-side artifact-file watcher; CLI no longer posts to the HMR
  endpoint on recompile (ADR-0008 M0 PR-8).

  `MetadataPlugin.start()` now attaches a chokidar watcher on the
  `artifactSource.path` when running in local-file mode with `watch !==
false`. On every artifact change it re-invokes `_loadFromLocalFile`
  and broadcasts a `reload` event through the HMR hub. This replaces
  the previous arrangement where `os dev`'s watch-recompile loop POSTed
  `/api/v1/dev/metadata-events` to trigger a reload — the server is now
  autonomous.

  The CLI `dev` command's recompile loop drops the POST call; the
  `/api/v1/dev/metadata-events` route remains available for external
  trigger sources (cloud webhooks, git hooks, ad-hoc curl).

  `MetadataPlugin.stop()` closes the artifact watcher cleanly.

- Updated dependencies [5e9dcb4]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/rest@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/plugin-sharing@5.0.0
  - @objectstack/plugin-approvals@5.0.0
  - @objectstack/plugin-audit@5.0.0
  - @objectstack/plugin-auth@5.0.0
  - @objectstack/plugin-email@5.0.0
  - @objectstack/plugin-reports@5.0.0
  - @objectstack/plugin-security@5.0.0
  - @objectstack/service-ai@5.0.0
  - @objectstack/service-job@5.0.0
  - @objectstack/service-queue@5.0.0
  - @objectstack/service-realtime@5.0.0
  - @objectstack/service-settings@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/driver-mongodb@5.0.0
  - @objectstack/driver-sql@5.0.0
  - @objectstack/driver-turso@5.0.0
  - @objectstack/plugin-hono-server@5.0.0
  - @objectstack/plugin-mcp-server@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0
  - @objectstack/service-cache@5.0.0
  - @objectstack/service-feed@5.0.0
  - @objectstack/service-package@5.0.0
  - @objectstack/service-storage@5.0.0

## 4.2.0

### Patch Changes

- 3a99239: Metadata HMR via SSE — close the agent-edits → preview-refresh loop.

  - `@objectstack/metadata`: register `/api/v1/dev/metadata-events` SSE endpoint unconditionally;
    add `POST` trigger that reloads the artifact and broadcasts a `reload` event to all listeners.
  - `@objectstack/cli` (`os dev`): chokidar-based watch on `objectstack.config.ts` and `src/`;
    debounced recompile + `POST` to the HMR endpoint so the server reloads without restart.
  - `@objectstack/studio`: `useMetadataHmr` provider opens an `EventSource`, exposes a version
    counter; previews include it in their query deps, and a top-bar badge surfaces connection
    state and event counts for diagnostics.

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/rest@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/driver-memory@4.2.0
  - @objectstack/driver-mongodb@4.2.0
  - @objectstack/driver-sql@4.2.0
  - @objectstack/driver-turso@4.2.0
  - @objectstack/plugin-approvals@4.2.0
  - @objectstack/plugin-audit@4.2.0
  - @objectstack/plugin-auth@4.2.0
  - @objectstack/plugin-email@4.2.0
  - @objectstack/plugin-hono-server@4.2.0
  - @objectstack/plugin-mcp-server@4.2.0
  - @objectstack/plugin-reports@4.2.0
  - @objectstack/plugin-security@4.2.0
  - @objectstack/plugin-sharing@4.2.0
  - @objectstack/service-ai@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0
  - @objectstack/service-cache@4.2.0
  - @objectstack/service-feed@4.2.0
  - @objectstack/service-job@4.2.0
  - @objectstack/service-package@4.2.0
  - @objectstack/service-queue@4.2.0
  - @objectstack/service-realtime@4.2.0
  - @objectstack/service-settings@4.2.0
  - @objectstack/service-storage@4.2.0

## 4.1.1

### Patch Changes

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/spec@4.1.1
  - @objectstack/core@4.1.1
  - @objectstack/objectql@4.1.1
  - @objectstack/runtime@4.1.1
  - @objectstack/rest@4.1.1
  - @objectstack/driver-memory@4.1.1
  - @objectstack/driver-sql@4.1.1
  - @objectstack/driver-turso@4.1.1
  - @objectstack/driver-mongodb@4.1.1
  - @objectstack/plugin-approvals@4.1.1
  - @objectstack/plugin-audit@4.1.1
  - @objectstack/plugin-auth@4.1.1
  - @objectstack/plugin-email@4.1.1
  - @objectstack/plugin-hono-server@4.1.1
  - @objectstack/plugin-mcp-server@4.1.1
  - @objectstack/plugin-reports@4.1.1
  - @objectstack/plugin-security@4.1.1
  - @objectstack/plugin-sharing@4.1.1
  - @objectstack/service-ai@4.1.1
  - @objectstack/service-analytics@4.1.1
  - @objectstack/service-automation@4.1.1
  - @objectstack/service-cache@4.1.1
  - @objectstack/service-feed@4.1.1
  - @objectstack/service-job@4.1.1
  - @objectstack/service-package@4.1.1
  - @objectstack/service-queue@4.1.1
  - @objectstack/service-realtime@4.1.1
  - @objectstack/service-settings@4.1.1
  - @objectstack/service-storage@4.1.1

## 4.1.0

### Minor Changes

- 96fb108: Artifact-first boot: `objectstack start` (and `objectstack serve`) now boot directly from a compiled `dist/objectstack.json` when no `objectstack.config.ts` is present.

  - `@objectstack/runtime` exports `createDefaultHostConfig()` and `resolveDefaultArtifactPath()` — a standalone-only default host that wraps `createStandaloneStack()` and surfaces the artifact's `requires` / `objects` / `manifest`. No dependency on `@objectstack/service-cloud`.
  - `objectstack start` accepts `OS_ARTIFACT_PATH` as a file path **or** an `http(s)://` URL. New flags `--artifact`, `--database`, `--database-driver`, `--database-auth-token`, `--auth-secret`, `--project-id`, `--port` let you specify all runtime conditions on the command line (each overrides the matching env var).
  - `objectstack dev` accepts the same runtime-override flags. When `--artifact` is supplied, the auto-compile step is skipped and the dev server boots the supplied artifact directly — no `objectstack.config.ts` required in cwd.
  - `objectstack start` no longer mounts Studio / Account / Console by default — those are dev/admin surfaces. Pass `--ui` to opt back in.
  - `objectstack serve` falls back to the default host config when the config file is missing but an artifact is resolvable.
  - `apps/objectos` (cloud / multi-project) is unchanged.

- 8cbc768: CLI no longer hard-depends on `@objectstack/service-cloud`. The control plane
  (`apps/cloud` + `@objectstack/service-cloud`) and tenant runtime (`apps/objectos`)
  have been split into a private companion repo `objectstack-ai/cloud`. Framework
  remains pure open-core.

  User impact:

  - `os serve --mode=cloud` keeps working in cloud-aware distributions — the CLI
    loads `@objectstack/service-cloud` via dynamic `import()` with try/catch and
    surfaces a clear "install the cloud distribution" hint when absent.
  - Root `pnpm dev` / `pnpm start` / `pnpm doctor` scripts in this repo are
    removed (they were thin filters of `@objectstack/objectos`, which no longer
    lives here). For a runnable local stack, use one of the examples
    (`pnpm --filter @example/app-crm dev`).

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
- Updated dependencies [d3b455f]
- Updated dependencies [0cc0374]
- Updated dependencies [5b878d9]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/driver-sql@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/driver-memory@4.1.0
  - @objectstack/driver-mongodb@4.1.0
  - @objectstack/driver-turso@4.1.0
  - @objectstack/plugin-approvals@4.0.1
  - @objectstack/plugin-audit@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/plugin-email@4.0.1
  - @objectstack/plugin-hono-server@4.1.0
  - @objectstack/plugin-mcp-server@4.1.0
  - @objectstack/plugin-reports@4.0.1
  - @objectstack/plugin-sharing@4.0.1
  - @objectstack/rest@4.1.0
  - @objectstack/service-ai@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0
  - @objectstack/service-cache@4.1.0
  - @objectstack/service-feed@4.1.0
  - @objectstack/service-job@4.1.0
  - @objectstack/service-package@4.1.0
  - @objectstack/service-queue@4.1.0
  - @objectstack/service-realtime@4.1.0
  - @objectstack/service-settings@0.1.1
  - @objectstack/service-storage@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/objectql@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/rest@4.0.5
  - @objectstack/driver-memory@4.0.5
  - @objectstack/driver-sql@4.0.5
  - @objectstack/driver-turso@4.0.5
  - @objectstack/driver-mongodb@4.0.5
  - @objectstack/plugin-audit@4.0.5
  - @objectstack/plugin-auth@4.0.5
  - @objectstack/plugin-hono-server@4.0.5
  - @objectstack/plugin-security@4.0.5
  - @objectstack/plugin-mcp-server@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5
  - @objectstack/service-cache@4.0.5
  - @objectstack/service-feed@4.0.5
  - @objectstack/service-job@4.0.5
  - @objectstack/service-queue@4.0.5
  - @objectstack/service-realtime@4.0.5
  - @objectstack/service-ai@4.0.5
  - @objectstack/service-storage@4.0.5
  - @objectstack/service-cloud@4.0.5
  - @objectstack/service-package@4.0.5

## Unreleased

### Patch Changes

- `createStudioStaticPlugin` simplified now that the Studio is always built with
  `base: '/_studio/'`: asset URLs in `index.html` are already absolute and
  correct, so the HTML is served verbatim (no `href="/..."` rewriting, no
  runtime basepath script injection). Single source of truth for the mount
  path: Vite `base`.

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/client@4.0.4
  - @objectstack/core@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/plugin-hono-server@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/rest@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-ai@4.0.4

## 4.0.3

### Patch Changes

- Updated dependencies [ee39bff]
  - @objectstack/service-ai@4.0.3
  - @objectstack/spec@4.0.3
  - @objectstack/core@4.0.3
  - @objectstack/client@4.0.3
  - @objectstack/objectql@4.0.3
  - @objectstack/runtime@4.0.3
  - @objectstack/rest@4.0.3
  - @objectstack/driver-memory@4.0.3
  - @objectstack/plugin-hono-server@4.0.3
  - @objectstack/plugin-setup@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/plugin-hono-server@4.0.2
  - @objectstack/driver-memory@4.0.2
  - @objectstack/service-ai@4.0.2
  - @objectstack/client@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/rest@4.0.2
  - @objectstack/runtime@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/core@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/plugin-hono-server@4.0.0
  - @objectstack/rest@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1
- @objectstack/objectql@3.3.1
- @objectstack/runtime@3.3.1
- @objectstack/rest@3.3.1
- @objectstack/driver-memory@3.3.1
- @objectstack/plugin-hono-server@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0
- @objectstack/objectql@3.3.0
- @objectstack/runtime@3.3.0
- @objectstack/rest@3.3.0
- @objectstack/driver-memory@3.3.0
- @objectstack/plugin-hono-server@3.3.0

## 3.2.9

### Patch Changes

- Updated dependencies [0bc7b0c]
- Updated dependencies [c3065dd]
  - @objectstack/plugin-hono-server@3.2.9
  - @objectstack/objectql@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/core@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/rest@3.2.9
  - @objectstack/driver-memory@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8
- @objectstack/objectql@3.2.8
- @objectstack/runtime@3.2.8
- @objectstack/rest@3.2.8
- @objectstack/driver-memory@3.2.8
- @objectstack/plugin-hono-server@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7
- @objectstack/objectql@3.2.7
- @objectstack/runtime@3.2.7
- @objectstack/rest@3.2.7
- @objectstack/driver-memory@3.2.7
- @objectstack/plugin-hono-server@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6
- @objectstack/objectql@3.2.6
- @objectstack/runtime@3.2.6
- @objectstack/rest@3.2.6
- @objectstack/driver-memory@3.2.6
- @objectstack/plugin-hono-server@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5
- @objectstack/objectql@3.2.5
- @objectstack/runtime@3.2.5
- @objectstack/rest@3.2.5
- @objectstack/driver-memory@3.2.5
- @objectstack/plugin-hono-server@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4
- @objectstack/objectql@3.2.4
- @objectstack/runtime@3.2.4
- @objectstack/rest@3.2.4
- @objectstack/driver-memory@3.2.4
- @objectstack/plugin-hono-server@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3
- @objectstack/objectql@3.2.3
- @objectstack/runtime@3.2.3
- @objectstack/rest@3.2.3
- @objectstack/driver-memory@3.2.3
- @objectstack/plugin-hono-server@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/core@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-hono-server@3.2.2
  - @objectstack/rest@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-hono-server@3.2.1
  - @objectstack/rest@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-hono-server@3.2.0
  - @objectstack/rest@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-hono-server@3.1.1
  - @objectstack/rest@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-hono-server@3.1.0
  - @objectstack/rest@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-hono-server@3.0.11
  - @objectstack/rest@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-hono-server@3.0.10
  - @objectstack/rest@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-hono-server@3.0.9
  - @objectstack/rest@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-hono-server@3.0.8
  - @objectstack/rest@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-hono-server@3.0.7
  - @objectstack/rest@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-hono-server@3.0.6
  - @objectstack/rest@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-hono-server@3.0.5
  - @objectstack/rest@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/core@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-hono-server@3.0.4
  - @objectstack/rest@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/rest@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-hono-server@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-hono-server@3.0.2
  - @objectstack/rest@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-hono-server@3.0.1
  - @objectstack/rest@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/rest@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-hono-server@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-hono-server@2.0.7
  - @objectstack/rest@2.0.7
  - @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6
  - @objectstack/objectql@2.0.6
  - @objectstack/runtime@2.0.6
  - @objectstack/rest@2.0.6
  - @objectstack/driver-memory@2.0.6
  - @objectstack/plugin-hono-server@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5
  - @objectstack/objectql@2.0.5
  - @objectstack/driver-memory@2.0.5
  - @objectstack/plugin-hono-server@2.0.5
  - @objectstack/rest@2.0.5
  - @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4
  - @objectstack/objectql@2.0.4
  - @objectstack/runtime@2.0.4
  - @objectstack/rest@2.0.4
  - @objectstack/driver-memory@2.0.4
  - @objectstack/plugin-hono-server@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3
  - @objectstack/objectql@2.0.3
  - @objectstack/runtime@2.0.3
  - @objectstack/rest@2.0.3
  - @objectstack/driver-memory@2.0.3
  - @objectstack/plugin-hono-server@2.0.3

## 2.0.2

### Patch Changes

- 1db8559: chore: exclude generated json-schema from git tracking

  - Add `packages/spec/json-schema/` to `.gitignore` (1277 generated files, 5MB)
  - JSON schema files are still generated during `pnpm build` and included in npm publish via `files` field
  - Fix studio module resolution logic for better compatibility

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2
  - @objectstack/objectql@2.0.2
  - @objectstack/driver-memory@2.0.2
  - @objectstack/plugin-hono-server@2.0.2
  - @objectstack/rest@2.0.2
  - @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1
  - @objectstack/objectql@2.0.1
  - @objectstack/runtime@2.0.1
  - @objectstack/rest@2.0.1
  - @objectstack/driver-memory@2.0.1
  - @objectstack/plugin-hono-server@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
  - @objectstack/objectql@2.0.0
  - @objectstack/driver-memory@2.0.0
  - @objectstack/plugin-hono-server@2.0.0
  - @objectstack/rest@2.0.0
  - @objectstack/runtime@2.0.0

## 1.0.12

### Patch Changes

- chore: add Vercel deployment configs, simplify console runtime configuration
- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/core@1.0.12
  - @objectstack/runtime@1.0.12
  - @objectstack/objectql@1.0.12
  - @objectstack/driver-memory@1.0.12
  - @objectstack/plugin-hono-server@1.0.12

## 1.0.11

### Patch Changes

- @objectstack/spec@1.0.11
- @objectstack/core@1.0.11
- @objectstack/objectql@1.0.11
- @objectstack/runtime@1.0.11
- @objectstack/driver-memory@1.0.11
- @objectstack/plugin-hono-server@1.0.11

## 1.0.10

### Patch Changes

- Updated dependencies [10f52e1]
  - @objectstack/core@1.0.10
  - @objectstack/objectql@1.0.10
  - @objectstack/driver-memory@1.0.10
  - @objectstack/plugin-hono-server@1.0.10
  - @objectstack/runtime@1.0.10
  - @objectstack/spec@1.0.10

## 1.0.9

### Patch Changes

- Updated dependencies [b9f8c68]
  - @objectstack/objectql@1.0.9
  - @objectstack/spec@1.0.9
  - @objectstack/core@1.0.9
  - @objectstack/runtime@1.0.9
  - @objectstack/driver-memory@1.0.9
  - @objectstack/plugin-hono-server@1.0.9

## 1.0.8

### Patch Changes

- Updated dependencies [8f2a3a2]
  - @objectstack/plugin-hono-server@1.0.8
  - @objectstack/spec@1.0.8
  - @objectstack/core@1.0.8
  - @objectstack/objectql@1.0.8
  - @objectstack/runtime@1.0.8
  - @objectstack/driver-memory@1.0.8

## 1.0.7

### Patch Changes

- Updated dependencies [ebdf787]
  - @objectstack/runtime@1.0.7
  - @objectstack/plugin-hono-server@1.0.7
  - @objectstack/spec@1.0.7
  - @objectstack/core@1.0.7
  - @objectstack/objectql@1.0.7
  - @objectstack/driver-memory@1.0.7

## 1.0.6

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6
  - @objectstack/core@1.0.6
  - @objectstack/objectql@1.0.6
  - @objectstack/driver-memory@1.0.6
  - @objectstack/plugin-hono-server@1.0.6
  - @objectstack/runtime@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [b1d24bd]
- Updated dependencies [877b864]
  - @objectstack/core@1.0.5
  - @objectstack/objectql@1.0.5
  - @objectstack/runtime@1.0.5
  - @objectstack/plugin-hono-server@1.0.5
  - @objectstack/driver-memory@1.0.5
  - @objectstack/spec@1.0.5

## 1.0.4

### Patch Changes

- 5d13533: refactor: fix service registration compatibility and improve logging
  - plugin-hono-server: register 'http.server' service alias to match core requirements
  - plugin-hono-server: fix console log to show the actual bound port instead of configured port
  - plugin-hono-server: reduce log verbosity (moved non-essential logs to debug level)
  - objectql: automatically register 'metadata', 'data', 'and 'auth' services during initialization to satisfy kernel contracts
  - cli: fix race condition in `serve` command by awaiting plugin registration calls (`kernel.use`)
- Updated dependencies [5d13533]
  - @objectstack/plugin-hono-server@1.0.4
  - @objectstack/objectql@1.0.4
  - @objectstack/spec@1.0.4
  - @objectstack/core@1.0.4
  - @objectstack/runtime@1.0.4
  - @objectstack/driver-memory@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [fb2eabd]
- Updated dependencies [22a48f0]
  - @objectstack/core@1.0.3
  - @objectstack/runtime@1.0.3
  - @objectstack/plugin-hono-server@1.0.3
  - @objectstack/objectql@1.0.3
  - @objectstack/driver-memory@1.0.3
  - @objectstack/spec@1.0.3

## 1.0.2

### Patch Changes

- a0a6c85: Infrastructure and development tooling improvements

  - Add changeset configuration for automated version management
  - Add comprehensive GitHub Actions workflows (CI, CodeQL, linting, releases)
  - Add development configuration files (.cursorrules, .github/prompts)
  - Add documentation files (ARCHITECTURE.md, CONTRIBUTING.md, workflows docs)
  - Update test script configuration in package.json
  - Add @objectstack/cli to devDependencies for better development experience

- 109fc5b: Unified patch release to align all package versions.
- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2
  - @objectstack/core@1.0.2
  - @objectstack/objectql@1.0.2
  - @objectstack/runtime@1.0.2
  - @objectstack/driver-memory@1.0.2
  - @objectstack/plugin-hono-server@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/runtime@1.0.1
  - @objectstack/spec@1.0.1
  - @objectstack/core@1.0.1
  - @objectstack/objectql@1.0.1
  - @objectstack/driver-memory@1.0.1
  - @objectstack/plugin-hono-server@1.0.1

## 1.0.0

### Major Changes

- Major version release for ObjectStack Protocol v1.0.
  - Stabilized Protocol Definitions
  - Enhanced Runtime Plugin Support
  - Fixed Type Compliance across Monorepo

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/runtime@1.0.0
  - @objectstack/objectql@1.0.0
  - @objectstack/driver-memory@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2
  - @objectstack/core@0.9.2
  - @objectstack/objectql@0.9.2
  - @objectstack/driver-memory@0.9.2
  - @objectstack/plugin-hono-server@0.9.2
  - @objectstack/runtime@0.9.2

## 0.9.1

### Patch Changes

- Patch release for maintenance and stability improvements. All packages updated with unified versioning.
- Updated dependencies
  - @objectstack/spec@0.9.1
  - @objectstack/core@0.9.1
  - @objectstack/objectql@0.9.1
  - @objectstack/runtime@0.9.1
  - @objectstack/driver-memory@0.9.1
  - @objectstack/plugin-hono-server@0.9.1

## 0.8.2

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2
  - @objectstack/core@0.8.2
  - @objectstack/plugin-hono-server@0.8.2

## 0.8.1

### Patch Changes

- 254f290: fix: serve command now detects available ports to avoid conflicts
  refactor: update to use Core v0.8.0 API (kernel.use/bootstrap)
  - @objectstack/spec@0.8.1
  - @objectstack/core@0.8.1
  - @objectstack/plugin-hono-server@0.8.1

## 1.0.0

### Minor Changes

- # Upgrade to Zod v4 and Protocol Improvements

  This release includes a major upgrade to the core validation engine (Zod v4) and aligns all protocol definitions with stricter type safety.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0
  - @objectstack/core@1.0.0
  - @objectstack/plugin-hono-server@1.0.0

## 0.7.2

### Patch Changes

- fb41cc0: Patch release: Updated documentation and JSON schemas
- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2
  - @objectstack/core@0.7.2
  - @objectstack/plugin-hono-server@0.7.2

## 0.7.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 0.4.2

### Patch Changes

- Unify all package versions to 0.4.2
- Updated dependencies
  - @objectstack/spec@0.4.2

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1

## 0.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.0
