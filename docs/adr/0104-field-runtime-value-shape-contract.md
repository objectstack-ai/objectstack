# ADR-0104: Field runtime value-shape as a first-class contract — spec-owned value schemas, typed action handlers, file-as-reference

- **Status**: Accepted (2026-07-22) — implementation staged per D4; phase 1 (D1) tracked on its own PR
- **Date**: 2026-07-22
- **Issue**: design follow-up generalizing #3405 / #3406 (inline lookup param
  silently stripped); relates #3407 (silently dropped writes), #1878 / #1891
  (liveness audit: naming drift, dead file config)
- **Relates to**: ADR-0078 (no silently inert metadata), ADR-0049 /
  Prime Directive #10 (declared ≠ enforced), Prime Directive #12
  (contract-first, one strict contract beats N dialects), ADR-0053 (date vs
  datetime semantics), ADR-0057 (system data lifecycle — `sys_file`
  tombstone/reap), ADR-0087 (protocol upgrade contract)

## Context

`packages/spec` owns the authoring contract for field **definitions**
(`FieldSchema`, 60+ `FieldType` members) but does not own the contract for what
a field's **runtime value** looks like. "What does a `lookup` value look like
on the wire? What does a `file` field store? Is `currency` a number or an
object?" has no spec answer. The knowledge exists — but as **private,
hand-duplicated re-derivations** in every consumer:

- `packages/objectql/src/validation/record-validator.ts` — the write-path
  validator keeps its own `MULTI_CAPABLE_TYPES` set (line 153) and per-type
  branches; every type it doesn't know is an unvalidated "opaque payload"
  (lines 341–344): `lookup` (single), `file`, `image`, `json`, `location`,
  `address`, `composite`, `repeater`, `record`, `vector` get **no shape check
  at all**.
- `packages/rest/src/import-coerce.ts` — re-derives six of its own type sets
  (lines 37–57, including a copy of `MULTI_CAPABLE_TYPES`) and is the only
  place the intended storage shape per type is even written down (header
  comment, lines 6–31).
- `packages/plugins/driver-sql/src/sql-driver.ts` — `JSON_COLUMN_TYPES`
  (line 59) and `NUMERIC_SCALAR_TYPES` (line 81) drive DDL and (de)serialization;
  the file itself warns these must be kept in sync by hand because drift
  already caused a binder crash.
- `packages/verify/src/read-coercion.ts` — the driver conformance probe covers
  exactly 3 of 60+ types (`boolean`, `json`, `integer`).

Adding one multi-capable or JSON-shaped field type today means updating four
lists in three packages, or silently corrupting data.

The spec does export three per-type value schemas — and they make things
worse, not better, because **all three are dead and two contradict reality**:

- `CurrencyValueSchema` (`field.zod.ts:151`) declares `{value, currency}`;
  the validator, the SQL driver, import-coerce, and the field-zoo round-trip
  all treat currency as a **bare number**.
- `LocationCoordinatesSchema` (`field.zod.ts:121`) declares
  `{latitude, longitude}`; the field-zoo oracle stores `{lat, lng}`.
- `AddressSchema` is imported by nothing but its own tests.

A designer (human or AI) who reads the spec is actively misled. This is
ADR-0078's "silently inert metadata" problem, one level down: the *instance
values* have no contract, so drift is invisible until a renderer and a writer
disagree.

Three concrete failure classes motivated this design:

1. **Silently stripped declarations** (#3405): `ActionParamSchema` accepts
   `type: 'lookup'` but had no `reference` key; the author's semantically
   correct `reference: 'sys_user'` was stripped by `.strip` parsing and the
   picker degraded to a paste-a-UUID text box, with zero feedback. #3406 fixed
   that one key; the class remains.
2. **Untyped action handlers**: the declared `params[]` contract (`type`,
   `required`, `multiple`, `accept`, `maxSize`, `options`) informs **only the
   client dialog**. The server passes `reqBody.params` through raw
   (`http-dispatcher.ts:3882`; same on the MCP path, line 1093), the sandbox
   exposes it as `input: unknown` (`script-runner.ts:60`), and handlers are
   registered as `(ctx: any) => any` (`objectql/src/engine.ts:678`). Every
   shipped handler does unchecked casts
   (`(params?.selectedIds ?? []) as string[]`,
   `examples/app-todo/src/actions/task.handlers.ts:63`). `required`,
   option membership, `maxSize` — none of it is enforced where it matters.
3. **File fields bypass the platform's own file primitive.** There are two
   disconnected file worlds. `Field.file` / `image` / `avatar` / `video` /
   `audio` values are inline JSON blobs (`{url, name, size}` — a shape no spec
   schema defines, no validator checks) stored in the record column
   (`sql-driver.ts:59`). Meanwhile `service-storage` already ships a
   first-class file object — `sys_file` with opaque `fileId`, status
   lifecycle, tombstone/reap GC (ADR-0057), and parent-derived download
   authorization — but it is wired **only** to the Attachments panel
   (`sys_attachment`), and `attachment-lifecycle.ts:27-29` explicitly notes
   field values "reference files from record columns the join-row count cannot
   see". Consequences: no reference integrity, no GC (clearing a `Field.image`
   leaks the blob forever), anonymous capability URLs for everything that
   isn't attachments-scoped, no `accept`/`maxSize` anywhere in `FieldSchema`
   (the audit: "no size/type/virus enforcement in write path"), and
   `client.storage.upload()` doesn't even return the `fileId` (the
   `/upload/complete` response omits it, `storage-routes.ts:231-241`).

The common root cause: **the runtime value shape of a field is nobody's
contract.** This ADR makes it the spec's.

## Decision

### D1 — Spec owns the value-shape contract: `valueSchemaFor(field)`

A new module `packages/spec/src/data/field-value.zod.ts` (exported via
`@objectstack/spec/data`) becomes the single source of truth for runtime value
shapes. It is pure schemas/constants/derivation — no business logic, per Prime
Directive #2. It exports:

1. **Semantic type classes** — the sets every consumer currently hand-copies,
   as named constants: `STRING_VALUE_TYPES`, `NUMERIC_VALUE_TYPES`,
   `BOOLEAN_VALUE_TYPES`, `OPTION_TYPES`, `MULTI_CAPABLE_TYPES`,
   `REFERENCE_TYPES` (`lookup` / `master_detail` / `user`),
   `FILE_REFERENCE_TYPES` (`file` / `image` / `avatar` / `video` / `audio`),
   `STRUCTURED_JSON_TYPES`, plus the temporal classes (`date` = calendar day,
   `datetime` = UTC instant, `time` = clock time — codifying ADR-0053 into the
   spec instead of driver comments).
2. **`valueSchemaFor(field, form)`** — a pure function from a field definition
   (`type`, `multiple`, `options`, `reference`, …) to a Zod schema for its
   runtime value. `form` names the two canonical shapes a value has:
   - **`'stored'`** — the canonical storage/wire form: what the write path
     accepts after normalization, what drivers persist, what an unexpanded API
     read returns. E.g. `date` → `YYYY-MM-DD` string; `datetime` → ISO-8601
     UTC string; `select` → declared option code (array when `multiple`);
     `lookup` → record-id string (array when `multiple`); `file` → file-id
     string (D3).
   - **`'expanded'`** — the enriched read form produced by `$expand`:
     `lookup` → the related record object; `file` → the spec-owned
     `FileValueSchema` (D3). For types without an expansion, `expanded` ≡
     `stored`. This names the lookup polymorphism that already exists
     (`engine.ts:2092-2098` overwrites the field in place) instead of leaving
     every consumer to branch on `typeof val === 'object'`.
3. **`FieldValue<T>`** — the inferred TS types, so handlers and SDK code can
   speak the same shapes at compile time (D2).

**Reality wins.** Where the de-facto stored shape is coherent, the contract
adopts it — deployed data is a wire contract we don't get to rewrite by
editing Zod. Concretely: `currency` **is a scalar number** —
`CurrencyValueSchema` is deleted (tombstoned in `UNKNOWN_KEY_GUIDANCE` /
changelog with the FROM → TO note); `location` adopts the stored `{lat, lng}`
and `LocationCoordinatesSchema` is rewritten to match; `AddressSchema` is
either adopted by the contract and enforced, or deleted — it does not remain
exported-but-dead. An exported-but-unconsumed value schema is exactly the
inert metadata ADR-0078 forbids.

**Consumers converge on the contract** (each keeps its role, loses its private
type lists):

- `record-validator.ts` delegates per-type shape checks to
  `valueSchemaFor(field, 'stored')`, keeping its error shaping
  (`ValidationError` per-field codes) and its normalization helpers
  (`normalizeMultiValueFields`, `coerceBooleanFields`). The "opaque payload"
  fallback (line 341) shrinks to only the types the contract genuinely leaves
  open (`json`, `code`). Types that today skip validation entirely — single
  `lookup`, `file`, `location`, `address` — get shape checks.
- `import-coerce.ts` derives its six sets from the spec classes; its header
  comment stops being the only written record of the storage contract.
- `driver-sql` derives `JSON_COLUMN_TYPES` / `NUMERIC_SCALAR_TYPES` membership
  from the spec classes (DDL column choice remains the driver's decision; the
  *classification* moves to the spec).
- `packages/verify/read-coercion.ts` grows from a 3-type probe to asserting
  the full matrix: for every field type, a stored-form write round-trips to a
  stored-form read on every driver.

**The conformance oracle is wired to the contract.** The field-zoo round-trip
(`packages/qa/dogfood/test/field-zoo-roundtrip.dogfood.test.ts`) already
encodes the intended wire shapes as a hand-written MATRIX; it gains an
assertion that every MATRIX entry `parse`s under `valueSchemaFor` — so the
contract and the executable oracle cannot drift apart, and a contract change
that would break the wire fails a test instead of shipping silently.

### D2 — Typed action handlers: declared params become the enforced, typed handler input

Action params are already fields-lite (`ActionParamSchema` mirrors `FieldType`,
`multiple`, `options`, `accept`, `maxSize`). D1 gives them value schemas for
free. Three changes:

1. **Server-side enforcement at dispatch.** `handleActions` (REST,
   `http-dispatcher.ts:3797`) and `invokeBusinessAction` (MCP, line 1080)
   resolve the invoked action's declared `params[]` (field-backed params
   resolve through the referenced object field, as the dialog already does)
   and validate `reqBody.params` against a Zod object built from
   `valueSchemaFor(param, 'stored')` per param: `required` enforced, option
   membership enforced, `multiple` arrays enforced, reference values must be
   id-shaped, **unknown param keys are a validation error** — the #3405
   lesson: strip-and-continue manufactures false success; loud beats lenient
   on an internal contract (Prime Directive #12). Failures return the standard
   `400 VALIDATION_FAILED` per-field envelope *before* the handler runs.
   Actions declaring no `params` keep today's pass-through (there is nothing
   to check against), so existing param-less actions are untouched.
2. **Typed handler surface.** `defineAction` today validates config only. It
   gains a typed companion so registered handlers stop being
   `(ctx: any) => any`: `ctx.params` is typed by mapping each declared param
   through `FieldValue<T>` (a type-level `ParamValue<typeof action.params>`),
   and `registerAction` accepts `ActionHandler<A>` instead of `any`. Inline
   L2 `body` scripts can't get static types (they're strings), but their
   sandbox `input` is the *same validated object*, so the runtime guarantee
   holds on both handler forms; `ScriptContext.input`'s doc comment states the
   contract instead of `unknown`-with-a-shrug.
3. **File/image params get a real path.** Today a file param arrives as
   "whatever the dialog put there" and there is no upload wiring at all. With
   D3, a file param's value is a `fileId`: the client uploads through
   `client.storage` first, submits the id, and dispatch validates the id
   refers to a committed `sys_file` row the caller may read, enforcing the
   declared `accept` / `maxSize` against the stored file's metadata —
   server-side, where it was never enforced before.

### D3 — File-as-reference: field values point into `sys_file`

`FILE_REFERENCE_TYPES` field values become **references, not blobs**:

- **Stored form**: an opaque `fileId` string (array when `multiple`) into
  `sys_file` — the same shape discipline as `lookup`. The inline
  `{url, name, size}` blob is retired from the write path.
- **Expanded form**: a spec-owned `FileValueSchema`
  `{ id, name, size, mimeType, url }`, produced at read/expand time from the
  `sys_file` row. `url` is **derived, never stored** — the stable resolver
  `GET /api/v1/storage/files/:fileId` (302 to bytes) already exists precisely
  for `<img src>` embedding.
- **Reference integrity + GC**: on record write, the engine maintains
  reference rows (the `sys_attachment` pattern generalized: parent object +
  record id + field name + file id) so the ADR-0057 tombstone/reap machinery
  — which today cannot see field columns — counts field references the same
  way it counts attachment join rows. Clearing or overwriting a file field
  decrements visibly; orphaned blobs get the existing tombstone → TTL → reap →
  reclaim path instead of leaking forever. (Scanning JSON columns for ids was
  rejected: unindexable and driver-specific.)
- **Authorization**: field-referenced files get parent-derived read checks,
  reusing the attachments `authorizeFileRead` verdict model — possession of a
  URL stops being possession of the bytes. The anonymous capability-URL
  carve-out remains only where the field/file explicitly declares a public
  posture (`acl: 'public_read'` — avatars, logos), an *opt-in* instead of the
  default for every non-attachment file.
- **Upload contract fixes**: `/upload/complete` returns the `fileId` (today it
  is dropped, so the simple `client.storage.upload()` helper cannot even
  implement this design); `FieldSchema` gains `accept` / `maxSize` for file
  types (currently declarable only on action params — the field side has
  nothing), enforced at upload admission and re-checked at record write from
  `sys_file` metadata.

**Migration** (this is the breaking piece; per ADR-0087 it rides a protocol
major):

- *Dual-read window*: readers normalize a legacy inline blob to the expanded
  form on the fly (`{url,...}` → `FileValueSchema` with `id: null`), so
  deployed records keep rendering.
- *Write-path cutover*: new writes accept only references. A write presenting
  an inline blob fails validation with a tombstone-style message carrying the
  FROM → TO prescription (upload → submit the id).
- *Backfill*: `os migrate` ingests platform-hosted legacy blobs into
  `sys_file` rows and rewrites the column to the id. Externally-hosted URLs
  (CDN links the platform never stored) cannot be ingested; they remain
  legacy-read-only values surfaced by a migration report, not silently
  dropped (#3407 discipline).

### D4 — Rollout order

Each phase is independently shippable and independently valuable:

1. **Contract + convergence** (non-breaking): land `field-value.zod.ts`,
   converge the four consumers' type lists, extend the verify probe, wire the
   field-zoo oracle assertion, delete/fix the three dead value schemas
   (breaking only for the dead exports — changeset carries the tombstones).
2. **Typed action handlers** (breaking only for already-broken inputs):
   dispatch-time param validation + typed `defineAction`/`registerAction`.
   Same posture as #3406: params that fail were silently wrong before; now
   they are loudly wrong. Release note calls it out.
3. **File-as-reference** (protocol major, cross-repo): storage-route +
   `FieldSchema` + write-path + GC + authz changes here; widget changes
   (submit `fileId`, render expanded form) in `objectui`; sequenced like the
   ADR-0103 v16 enum split — server first (old clients' inline writes are
   rejected with the prescriptive error), console re-pinned before GA.

## Alternatives considered

- **Keep per-consumer knowledge, add lint/tests to sync the lists.** Rejected:
  a sync-checker for four hand-copies is a workaround (Prime Directive #5);
  the lists exist because the contract has no home — give it one.
- **Own the value shapes in `objectql` (runtime) instead of `spec`.** Rejected:
  the shapes are consumed by non-runtime parties — import tooling, drivers,
  the external UI repo, MCP/AI tool schemas, docs generation. The spec is the
  one package all of them already import, and value shapes are contract, not
  logic.
- **A `{ id, name }` shallow form for lookups instead of the stored/expanded
  pair.** Rejected for now: it introduces a third wire form and breaks the
  "reality wins" rule (nothing stores or emits it today). The stored/expanded
  distinction merely *names* the two forms that already exist. Revisitable as
  an additive expansion profile later.
- **File values as inline objects with a validated schema** (keep
  `{url, name, size}` but make the spec bless it). Rejected: it legitimizes
  the world with no reference integrity, no GC, and capability-URL security —
  hardening a blob is strictly worse than referencing the file object the
  platform already ships. The attachments world proves the reference model
  works end to end.
- **Enforce action params only in the client dialog** (server stays lenient).
  Rejected: the dialog is one of three callers (REST, MCP/AI tools, scripts);
  AI-driven invocation is precisely the caller most likely to send a
  plausible-but-wrong bag, and ADR-0049 discipline says the check belongs at
  the enforcement point, not the courtesy surface.

## Risks and migration hazards

Named here so the phase PRs inherit them as acceptance items, not
rediscoveries.

- **R1 — validation from none to some strands legacy rows.** Types that were
  "opaque payloads" get shape checks; a malformed value written under the lax
  regime would block the *next* edit of its record on an unrelated field.
  Phase 1 must validate **only fields present in the write** (the current
  validator's posture, kept deliberately) and ship a stored-data audit report,
  not retroactive rejection.
- **R2 — the codified shape may be stricter than deployed reality.** The
  field-zoo oracle covers the intended path, not every historical variant
  (e.g. SQLite `datetime` columns mixing INTEGER epoch and TEXT ISO, repaired
  only at read). For types gaining their first-ever check, phase 1 lands the
  contract warn-first, flipped to error in the following minor once telemetry
  is quiet.
- **R3 — unknown-param-key rejection will hit real callers.** Dispatch itself
  merges `recordId` / `objectName` into `params`
  (`http-dispatcher.ts:3944`), and programmatic integrators send loose bags.
  D2 needs a built-in-key allowlist and the same warn-then-error window;
  "unknown key" errors must name the key and the declared param list.
- **R4 — GC mis-deletion is irreversible data loss.** During the D3 migration
  window (records still carrying inline blobs invisible to reference
  counting), file reaping is **frozen**; the reap guard's delete-time
  re-verification must count field-reference rows before any reap resumes.
  Hard gate, not a nice-to-have.
- **R5 — tightening anonymous URLs breaks live embeds.** Avatars in emails,
  shared images, org logos rely on capability URLs today. The migration must
  produce an explicit public-posture inventory (which existing files stay
  `public_read`) as a reviewed deliverable; guessing defaults here is a
  visible-outage generator.
- **R6 — sub-key reads break silently.** Formulas, templates, hooks, and
  flows reading `record.attachment.url` get an id string after D3. These
  usages are metadata, so a best-effort static scan plus the migration report
  must surface them; the changeset carries the FROM → TO rewrite.
- **R7 — external-URL usage of file fields is retired.** Apps using
  `Field.file` to hold links to externally-hosted files must migrate those to
  `url` fields; legacy values stay read-only. Migration guide item, not a
  silent drop (#3407 discipline).
- **R8 — cross-repo sequencing.** Protocol major + objectui + console re-pin
  is the #3340 / #2726 failure surface; the lockstep guard
  (`protocol-version.test.ts`) covers the version bump, the ADR-0103 v16
  sequencing pattern covers the rollout order.
- **R9 — spec purity.** `valueSchemaFor` is derivation, and must stay pure
  schema derivation (Prime Directive #2); runtime concerns (caching, driver
  choices) live in consumers.

## Performance budget

Complexity-class estimates, to be confirmed by benchmarks that ship as phase
acceptance criteria (wired to the #2408 Server-Timing surface where useful):

- **D1/D2 are CPU-microsecond noise *if and only if* validators are cached.**
  Zod `parse` on scalar values is ~µs; `z.object()` *construction* is an
  order of magnitude worse. `valueSchemaFor` results are built at metadata
  registration and cached per (object, field) / per action — a test guards
  against per-write construction. Budgets: bulk import (10k rows × 20 fields)
  validation overhead < 10% vs. baseline; action dispatch p95 + < 1 ms.
  Hooks are unaffected (sandbox execution is ms-scale; nested engine writes
  pay the same µs-scale validation).
- **D3 is the only structural cost.** Write side: reference-row maintenance
  adds 1–2 row writes per *changed* file value, same transaction, zero cost
  when no file field changes; bulk imports of file-bearing rows see measurable
  write amplification. Read side: resolving fileIds goes from 0 to exactly
  **one batched IN query per request** — an N+1 regression test is mandatory;
  `sys_file` rows are near-immutable after commit and cache well. Downloads:
  authorization happens at URL issuance (attachments already pay this);
  the 302 resolver and browser caching absorb repeat fetches. Budget: 100-row
  list including file fields, p95 increase bounded by one batched query;
  benchmark before/after in the phase-3 PR. Reference-row GC accounting runs
  in the existing ADR-0057 sweep, off the request path.

## Consequences

- The spec becomes the single answer to "what does this field's value look
  like" — for the validator, drivers, import, verify, the UI repo, AI tool
  schemas, and docs generation. Adding a field type means writing its value
  schema once, and the type is born validated, importable, driver-classified,
  and conformance-tested.
- Action handlers move from `params: any` + defensive casts to a validated,
  typed input with a 400 envelope for bad requests. Existing metadata whose
  params were silently mis-shaped starts failing loudly — intended (ADR-0078).
- File fields gain integrity, GC, and authorization by joining the existing
  `sys_file` machinery; the platform stops shipping two file worlds. The cost
  is a protocol-major migration with a dual-read window and an explicit
  backfill report for non-ingestable external URLs.
- Cross-repo obligations: `objectui` must adopt the expanded `FileValueSchema`
  rendering and fileId submission (phase 3), and can delete its own value-shape
  guesswork by importing the contract.
- The three dead value-schema exports stop lying to readers — deleted or made
  true. Per the ADR-0078 discipline, "exported by the spec" once again implies
  "enforced somewhere".
