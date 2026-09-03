# ADR-0104: Field runtime value-shape as a first-class contract — spec-owned value schemas, typed action handlers, file-as-reference

- **Status**: Accepted (2026-07-22) — staged per D4. D1 landed (#3429), D2
  landed (#3432); D3 refined into two waves by the 2026-07-24 addendum below,
  and wave 2's ownership model settled by the 2026-07-27 addendum.
  Strict-default flip of D1/D2 tracked in #3438 — the media half flips per
  deployment (#3681); evidence for the remaining halves decided by the
  2026-07-30 addendum. Wave 2 sequence in #3459. The 2026-08-07 addendum is
  **errata only** — it registers the outside vocabulary (`fieldRuntimeType`,
  `FileRef`, `RecordRef`, "read-time expansion") against this ADR's names so a
  grep for those words lands here, and corrects three membership facts; it
  changes no decision.
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
- `packages/drivers/driver-sql/src/sql-driver.ts` — `JSON_COLUMN_TYPES`
  (line 59) and `NUMERIC_SCALAR_TYPES` (line 81) drive DDL and (de)serialization;
  the file itself warns these must be kept in sync by hand because drift
  already caused a binder crash.
- `packages/verify/src/read-coercion.ts` — the driver conformance probe covers
  exactly 3 of 60+ types (`boolean`, `json`, `integer`).

Adding one multi-capable or JSON-shaped field type today means updating four
lists in three packages, or silently corrupting data.

The spec does export three per-type value schemas — and they make things
worse, not better, because **all three are dead and two contradict reality**:

- `CurrencyValueSchema` (`packages/spec/src/data/field.zod.ts#CurrencyValueSchema`) declares `{value, currency}`;
  the validator, the SQL driver, import-coerce, and the field-zoo round-trip
  all treat currency as a **bare number**.
- `LocationCoordinatesSchema` (`packages/spec/src/data/field.zod.ts#LocationCoordinatesSchema`) declares
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
   (`packages/runtime/src/http-dispatcher.ts`; same on the MCP path, line 1093), the sandbox
   exposes it as `input: unknown` (`packages/runtime/src/sandbox/script-runner.ts`), and handlers are
   registered as `(ctx: any) => any` (`packages/objectql/src/engine.ts`). Every
   shipped handler does unchecked casts
   (`(params?.selectedIds ?? []) as string[]`,
   `examples/app-todo/src/actions/task.handlers.ts`). `required`,
   option membership, `maxSize` — none of it is enforced where it matters.
3. **File fields bypass the platform's own file primitive.** There are two
   disconnected file worlds. `Field.file` / `image` / `avatar` / `video` /
   `audio` values are inline JSON blobs (`{url, name, size}` — a shape no spec
   schema defines, no validator checks) stored in the record column
   (`packages/drivers/driver-sql/src/sql-driver.ts`). Meanwhile `service-storage` already ships a
   first-class file object — `sys_file` with opaque `fileId`, status
   lifecycle, tombstone/reap GC (ADR-0057), and parent-derived download
   authorization — but it is wired **only** to the Attachments panel
   (`sys_attachment`), and `packages/services/service-storage/src/attachment-lifecycle.ts#sys_attachment` explicitly notes
   field values "reference files from record columns the join-row count cannot
   see". Consequences: no reference integrity, no GC (clearing a `Field.image`
   leaks the blob forever), anonymous capability URLs for everything that
   isn't attachments-scoped, no `accept`/`maxSize` anywhere in `FieldSchema`
   (the audit: "no size/type/virus enforcement in write path"), and
   `client.storage.upload()` doesn't even return the `fileId` (the
   `/upload/complete` response omits it, `packages/services/service-storage/src/storage-routes.ts`).

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
     (`packages/objectql/src/engine.ts` overwrites the field in place) instead of leaving
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
   `packages/runtime/src/http-dispatcher.ts`) and `invokeBusinessAction` (MCP, line 1080)
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
  (`packages/runtime/src/http-dispatcher.ts`), and programmatic integrators send loose bags.
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

## Addendum (2026-07-24) — D3 refined into two waves; the enforcement-point principle

D1 (#3429) and D2 (#3432) landed as single-repo, non-breaking (or
breaking-only-for-already-broken) PRs under this ADR's umbrella. D3
(file-as-reference) is different in kind — breaking, cross-repo, protocol-major,
and the only phase carrying **irreversible** risk (R4, GC deleting file bytes).
A review of D3 against the platform's actual trajectory — an enterprise,
Salesforce-shaped metadata platform whose **authoring surface is increasingly
driven by AI**, where the governing goal is *keep the AI author from silently
producing wrong metadata* — sharpened two things: D3's **value went up** (it
closes the last authoring surface where an AI can write a silently-wrong value
and get a success envelope — the ADR-0078 asymmetry, at the file layer), while
its **irreversible-migration risk is unchanged**. So D3 is not deferred, but
**decomposed** and **re-sequenced by what serves authoring correctness first**.

### The enforcement-point principle (applies to D1, D2, and D3)

For an AI author, the check that prevents a mistake is the one that fires at
**build/validate time** (`os validate` / `os build` rejects, the way #3406
rejects a targetless inline lookup param) — a build failure the AI must fix, not
a runtime warning it never sees. The runtime **warn-first** posture (D1's
`OS_DATA_VALUE_SHAPE_STRICT_ENABLED`, D2's `OS_ACTION_PARAMS_STRICT_ENABLED`)
exists only to protect **already-deployed data** from stranding — it is not the
authoring gate. *(D2's variable no longer exists: the 2026-07-30 addendum flips
that half strict-by-default in 17.0, leaving only the `OS_ALLOW_LAX_ACTION_PARAMS`
opt-out. The sentence's own logic is why — action params strand no deployed
data, so the posture it justifies never applied to them.)*

Therefore the target end-state is **two enforcement points, each with one job**:

- **Build/validate time → hard reject.** Net-new metadata (the AI's output)
  must fail loudly at authoring. This is the primary defence against AI error.
- **Runtime → warn-first, then flip.** Deployed data keeps working through the
  warn window; the flip to strict-by-default (tracked in #3438) closes it.
  *(Amended by the second 2026-07-27 addendum: "once telemetry is quiet" was
  our telemetry deciding for their deployments. The **media** half now flips
  per deployment, when that deployment's own file-as-reference migration has
  verified. The reference and structured-JSON halves still await an evidence
  source of their own — the file migration does not vouch for them.)*

This refines D2 (today runtime-only) and reshapes the #3438 flip: the priority
is adding the **build-time** rejection for value shapes and action params, not
just flipping the runtime default.

### The class this covers — the whole media family, not just `file`

`file` is shorthand throughout D3 for the entire `FILE_REFERENCE_TYPES` class
D1 already defined — **`file`, `image`, `avatar`, `video`, `audio`**. All five
store the same inline blob today, all five bypass `sys_file`, and all five move
to the reference model together. There is no separate story for `image`; the
contract is one class.

### D3 wave 1 — the value-shape contract (low-risk, no migration)

Directly serves "keep the AI author correct." Ships independently of the
protocol major, single-repo, no irreversible risk:

- Give the media class a **declared `FileValueSchema`** — the inline form the
  platform stores today (`{ url, name?, size?, mimeType?, alt?, duration? }`,
  `url` required) — replacing D1's loose transitional union. `valueSchemaFor`
  for the class returns the transitional union of *this declared object* and
  the opaque id/url string (still accepted for import-compat), so a malformed
  file value (a number, an empty object, garbage) is now caught instead of
  waved through. Exported so wave 2 and `objectui` consume the one shape.
- Per the enforcement-point principle, this shape should reject at
  **build/validate time** for net-new (AI-authored) metadata while staying
  warn-first at runtime for deployed data — the same posture D1 established for
  every other value type.

Wave 1 is effectively a "D2.5": no `sys_file` rewiring, no migration, no
protocol bump. Note what wave 1 deliberately does **not** do: it does not add
`accept` / `maxSize` to `FieldSchema`. Those govern an actual upload, so
enforcing them authoritatively needs the server to know the real bytes — i.e.
the `sys_file` model. Adding them before that would ship exactly the inert knob
ADR-0078 forbids, so they belong to wave 2.

### D3 wave 2 — the storage-model migration (protocol major, full safeguards)

The reference model + governance, sequenced after wave 1 and carrying the
irreversible risk. Ride a planned breaking window (as ADR-0103's enum split
rode v16/v17) to amortise the migration cost:

- File field value becomes an opaque `sys_file` id; the expanded read form is
  the spec-owned `FileValueSchema` (`url` derived via `/files/:fileId`, never
  stored) — D1/D2 §D3 as written.
- Field references join the ADR-0057 tombstone/reap GC (leak + GDPR-erasure
  fix); governed download reuses the attachments `authorizeFileRead`, with the
  anonymous capability URL demoted to an **opt-in** `acl: 'public_read'`.
- `accept` / `maxSize` land on `FieldSchema` here — not in wave 1 — because now
  the server owns the file (`sys_file` metadata), so it can enforce declared
  MIME/size at upload admission and re-check at record write authoritatively,
  rather than trusting a client-supplied blob.
- Non-negotiable acceptance gates (from Risks): **R4** GC frozen during the
  migration window until reference-row counting is verified; **R5** a reviewed
  public-posture inventory; **R6** a static scan for sub-key reads
  (`record.file.url` in formulas/templates/hooks/flows).
- External-URL usage of `type: 'file'` is retired toward a `url` field (R7) —
  under AI authoring this is *desirable*: it disambiguates "managed file" from
  "external link" so the AI cannot conflate them.

## Addendum (2026-07-27) — wave 2's ownership model: field references are exclusive

The 2026-07-24 addendum left one thing open, and it turned out to be the
decision the rest of wave 2 hangs off: **when a field holds a `sys_file` id,
what is the relationship between file and record?** Implementing the reference
rows forced the answer.

### Two lineages, and why we take one of each

Enterprise platforms solve file lifecycle two ways:

- **Junction-for-everything** (Salesforce `ContentDocumentLink`, SAP GOS): every
  reference is a row in one polymorphic link table; a file is shared, and dies
  when the last link does. Sharing is the feature.
- **Column-as-reference** (Dataverse File/Image columns): the column *is* the
  reference; lifecycle follows the row; no sharing.

ObjectStack already runs the first for its attachments surface (`sys_attachment`
+ the ADR-0057 tombstone/reap), and that is right — attaching one document to
several records is exactly what that surface is for, and the user performs the
attach explicitly.

**Field references take the second model.** A `product.image` is a *property of
that product*, and properties are copied, not shared. Concretely: at most one
`(object, record, field)` slot owns a given `sys_file`; the owner is recorded on
`sys_file.ref_object` / `ref_id` / `ref_field`; writing an already-owned id into
a second slot **copies the bytes into a fresh `sys_file`** rather than sharing
the row.

### Why exclusivity, decided on failure modes rather than elegance

Sharing is more storage-efficient and matches the better-known lineage. We take
exclusivity anyway, because under AI-authored metadata the two models fail
differently and the difference is not symmetric.

The naive generated clone — `insert({...src, id: undefined})` — spreads a file
id into a second record. Every model must let that code *work*; rejecting it
would force AI authors to learn a bespoke file API, which is precisely the kind
of special case that produces mistakes. So the real question is what happens
*after* it works:

| | worst case | recoverable? |
|---|---|---|
| Shared + reference-counted | file's readable-by set becomes the **union of every referrer's** — copying a private record's id into a world-readable record silently widens access; and a single miscount authorises an **irreversible byte delete** | no |
| Exclusive + copy-on-claim | duplicated bytes | yes — it costs money, not data |

Read authorisation for attachment files already derives from the parent record.
Under sharing, "the parent record" is ambiguous, and the safe reading of an
ambiguous ACL is the union — which means generated code can leak data while
containing no visible error. Exclusivity removes the ambiguity by construction:
one file, one parent, one ACL.

The storage cost this concedes belongs at a different layer anyway: **dedup the
bytes, not the rows.** Content-hash dedup behind the storage adapter (`etag` is
already carried on `sys_file`) recovers the savings while leaving every row its
own owner and its own ACL — the lifecycle never has to reason about sharing.
A genuinely shared library asset should be modelled as its own object with a
lookup, or attached through the attachments surface; steering AI authors there
is the correct outcome, not a limitation.

### The safety principle this buys: observed transition, never inferred absence

> A file becomes collectable only because the platform **observed its one owner
> let go** — never because a scan **inferred** that nobody references it.

The existing attachment path already obeys this (the tombstone is set by the
hook that watched the join row die, not by a sweep that found none). Exclusive
ownership extends the same discipline to fields, and eliminates counting
entirely: with no count, no miscount can authorise a delete. It also defuses the
cold-start hazard a new ledger would otherwise carry — a freshly-built reference
table knows nothing of references that predate it, so trusting its zeroes would
mass-delete history.

### Consequent resequencing of wave 2

The 2026-07-24 plan packaged the write cutover and the GC enable together, and
placed the backfill after. That order is wrong: **a ledger may not authorise
deletion until it has been backfilled and reconciled.** Wave 2 therefore
sequences as:

1. **Ownership bookkeeping** — `ref_*` columns, claim/release on the write path,
   copy-on-claim. Records ownership; deletes nothing. Dormant until a field
   actually holds an id, so it lands safely ahead of the cutover.
2. **Governed download** — read authorisation derived from the one owning
   record; anonymous capability URL demoted to opt-in `acl: 'public_read'`.
3. **Backfill** — converts legacy inline blobs and own-resolver URLs to
   `sys_file` references, which the claim hooks then own; external URLs are
   reported, never re-hosted. Dry-run by default, idempotent.
4. **Write cutover** (protocol major) — stored form narrows to an id;
   `accept` / `maxSize` enforced. Still deletes nothing.
5. **Reconciliation soak** — `verify-references` compares what records actually
   hold against recorded ownership, and splits disagreements by whether they can
   cause data loss: *blocking* (a held file nothing owns; a file held by a slot
   that does not own it; one file held by two slots) versus *advisory* (owned
   but no longer held — fails toward retention; unreferenced committed files —
   storage cost only).
6. **GC enable** — *gated, irreversible*. Relaxing the `scope === 'attachments'`
   tombstone guardrail and extending the `sys_file` reap guard's sweep-time
   re-verify to the ownership columns **must ship in the same change**. Half of
   it is worse than none: tombstoning released files while the guard still
   re-verifies only `sys_attachment` — always empty for a field file — turns
   every release into a guaranteed byte delete rather than a risky one.

Backfill precedes the cutover for the same reason it precedes collection, one
step further back: narrowing the accepted stored form while records still hold
legacy values would reject any update that rewrites such a field, breaking
working apps until the backfill catches up. Backfilling first leaves the cutover
nothing legacy to reject.

R4's acceptance gate is now executable rather than aspirational: step 5's
reconciliation must report **zero blocking discrepancies** before step 6 may
act. (The original wording — "for ≥7 consecutive days on real tenant data" —
assumed a tenant we operate and observe; see the 2026-07-27 platform-form
addendum below, which relocates the same evidence requirement to the one place
that can satisfy it.) R5 (public-posture inventory) and R6 (sub-key read scan)
stand.

Steps 4 and 6 are the two that can break something. Step 4 is a declared
protocol major and breaks *loudly* — a rejected write, recoverable. Step 6
breaks *silently and permanently* — deleted bytes. They are therefore held to
different standards: step 4 rides the planned v17 window paired with the client
adoption that consumes the new form, while step 6 additionally requires the
reconciliation evidence above, and neither the enable nor the migration run
should be performed without an explicit human decision.

## Addendum (2026-07-27, later) — the evidence gate is per deployment, not per release

The gate above was written as an operations runbook: *run the backfill on the
tenant, watch `verifyFileReferences` stay clean for a week, then flip the
switch.* Every clause of that sentence assumes **we** run the tenant, **we**
observe it, and **we** flip.

ObjectStack is a development platform. Third-party developers build metadata
apps on it and ship versions onward; each deployment decides for itself when to
upgrade, and its data is not visible to us — nor should it be. **There is no
observation window of ours that anyone else's data can wait inside.** A gate
phrased as one is not strict, merely unlocatable: it can be satisfied by no
deployment at all, including the deployments whose bytes are at stake.

### What survives, and what moves

R4's substance is unchanged: **a ledger may not be given the power to delete
bytes until it has been shown to agree with reality.** What changes is *who
produces the evidence* — from us, once, to each deployment, for itself.

That rules out a one-shot script (a script whose output nobody must read is not
a gate) and rules in a **data-migration step with a self-check, whose passing
result is recorded on the deployment**:

```
os migrate files-to-references
  1. backfill                 (dry run by default; --apply writes)
  2. verifyFileReferences     (reconcile the ledger against what records hold)
  3. zero blocking findings →  record sys_migration { id: 'adr-0104-file-references',
                                 verified_at, blocking: 0 }
  4. collection + strict enforcement read THAT ROW, never the version number
```

### The properties this buys

- **Upgrading does not start deleting.** Installing a new version is not
  consent; running the migration and passing its self-check is.
- **A third-party developer need not understand R4.** They run one command.
  Green means done; red names the record holding a file nobody owns.
- **Not run, or not passed → files live forever.** Wasted storage, zero data
  loss: "fail toward retention" holds on the *deployment* axis too. The same
  rule applies to a regression — a later failing run clears `verified_at`, so a
  deployment whose data has drifted closes its own gate.
- **Each deployment gets its own 30-day tombstone window.** Nobody waits inside
  anyone else's soak. The irreversible moment is day 30 after *that* deployment
  enabled collection, not release day.
- **A dry run changes nothing** — not the data, and not the flag either, even
  when the self-check would pass. `--apply` is the only writing mode, so
  "did this run change my posture" never depends on what the run found.

### D1/D2 carry the identical error, and the identical fix

The strict-by-default flip for value-shape and action-param validation (#3438)
was scheduled as "flip in a later minor once telemetry is quiet" — again
*our* telemetry, deciding for *their* deployments. A deployment that has not
finished backfilling would have every media-field update rejected the moment it
upgraded: a working app broken by a decision made on its behalf.

Both therefore read the **same** flag. Strict enforcement becomes effective for
a deployment when that deployment has completed and verified its migration —
not when a version number arrives. One flag, not two gates that can disagree:
they are gating on the same fact.

**Amendment while implementing this (2026-07-27, later still).** "#3438 reads
the flag" was too broad: #3438 is three things, and the flag only covers one.
The flag asserts *this deployment's file-field values have been migrated and
reconciled*. That is evidence about **media** value shapes and nothing else —
it says nothing about whether a `lookup` id or a `location` payload is well
formed, and nothing at all about D2's action parameters. Gating those on it
would be borrowing evidence for a fact it does not cover, which is the same
error one layer down: an authority answering a question it was not asked.

So the split is:

| | evidence | status |
|---|---|---|
| D1 media (`file`/`image`/`avatar`/`video`/`audio`) | the `adr-0104-file-references` flag | flips per deployment |
| D1 references + structured JSON | none yet — needs its own | stays warn-first |
| D2 action params | unrelated to any data migration | stays warn-first |

The last two are not blocked on the mechanism — it exists and works. They are
blocked on someone deciding what would constitute evidence that a deployment's
`location` values are sound, which is a different question from the one this
addendum answers.

### What cannot be automated, and does not block

Whether an **external URL** (`https://cdn…`) should become an explicit `url`
field is a modelling decision only the app's author can make (R7). It also
cannot block: an external URL is not a `sys_file` and can never enter
collection. It is reported as advisory, never as a gate failure.

### Why this stays inside ADR-0104 rather than a new ADR

D3 is already this ADR's third phase; the two-wave split and the
enforcement-point principle are a **refinement of the D4 rollout**, not a new
decision, so they live here. Wave 2's migration mechanics (dual-read window,
`os migrate` backfill, the R4/R5/R6 gates) are specified in §D3 above and need
no separate record. Wave 2's implementation did surface two genuinely new
decisions — the exclusive-ownership model, and relocating the evidence gate to
the deployment — and both are recorded as 2026-07-27 addenda above rather than
separate ADRs, because each settles *how* D3's already-accepted "field values
point into `sys_file`" reaches production rather than revisiting whether to do
it. A future choice that stands on its own (say, a chunked-migration protocol,
or byte-layer content dedup) would earn its own ADR.

## Addendum (2026-07-30) — evidence for the remaining flips: a scan gate for references / structured JSON; the action-param default flips in 17.0

The 2026-07-27 amendment split #3438 into three and settled only the first:
media value shapes flip per deployment, on the `adr-0104-file-references` flag
(#3681). The other two were left "blocked on someone deciding what would
constitute evidence." This addendum decides — differently for the two, because
their facts have different epistemic reach — and lands both on the v17 major.

One timeline fact frames the choice: **warn-first itself first reaches stable
deployments in 17.0.** D1 and D2 ride the v17 train (their changesets sit in
the same pre-mode window as this addendum), so no stable deployment has served
a single day of the warn window yet. That does *not* settle the question, and
an earlier draft of this addendum wrongly treated it as if it did. It bounds
one option only: no deployment can have *already* produced warn-window
evidence, so a gate that requires such evidence must either produce it fresh
(D1, below) or be declined on the merits (D2, below). It is not an argument
for postponement — a break served later is not a break served gently.

The governing consideration is the one D4 already stated and the 2026-07-24
addendum repeated: **ride a planned breaking window to amortise the migration
cost.** Every deployment on 16.x must perform a substantial, tested 16→17
upgrade regardless. Spreading this ADR's own breaking changes across two
majors charges that ceremony twice, and the second charge buys something only
where it buys real safety. So the question is asked per half — *what does
withholding the version-wide flip actually protect here?* — and the answers
differ.

### D1 references + structured JSON: the evidence can exist, so build it

The fact strict enforcement needs is: *no stored value of the covered classes
fails `valueSchemaFor(field, 'stored')`.* The covered classes are exactly the
validator's own non-media branch — `REFERENCE_VALUE_TYPES` (single-value
`lookup` / `master_detail` / `user` / `tree`) and `STRUCTURED_JSON_TYPES`
(`location` / `address` / `composite` / `repeater` / `record` / `vector`;
`json`'s derived schema is deliberately `z.unknown()`, so it can yield no
findings). Unlike caller behaviour, data at rest is enumerable: a scan that
walks every row is **complete** evidence, with the same epistemic standing the
file reconciliation has.

What the per-deployment gate protects here — the amortisation question from
the preamble — is **records, not callers**. The failure mode of a wrong flip
is read-modify-write: an application reads a record, edits one field, writes
the whole thing back, and the malformed `location` payload it never touched
rides along — so the application's own *correct* code starts failing, above
data possibly written years ago, at a scale ("which of my million rows?") the
operator cannot even enumerate without the scanner. And one slice of that
data is **our fault**: the spec exported `LocationCoordinatesSchema`
declaring `{latitude, longitude}` while reality stored `{lat, lng}` (this
ADR's own Context section) — an app written faithfully against our published
contract holds exactly the values a version-wide flip would reject.
Punishing spec-faithful authors for having believed the spec is not a
migration; it is a breach. That is what the gate buys, and it is worth
buying.

The cost, meanwhile, rounds to zero for the deployments that are clean —
which is most of them: the scan runs inside the same 16→17 upgrade ceremony
as `os migrate files-to-references`, and a clean deployment that runs it is
strict *immediately*, one upgrade, done — indistinguishable from a
version-wide flip. The gate's only observable difference is on dirty data,
where it converts a stream of production failures into a report with row
ids. So the gate takes the #3617 shape, minus the backfill:

```
os migrate value-shapes
  1. scan every object's covered fields against valueSchemaFor(field, 'stored')
  2. report violations per (object, field, type): count, sample record ids,
     first parse issue — the per-deployment form of R1's stored-data audit
  3. zero blocking findings + --apply → record sys_migration
       { id: 'adr-0104-value-shapes', verified_at, blocking: 0 }
  4. strict enforcement of the covered classes reads THAT row, never the
     version number
```

- **There is nothing to convert.** A malformed `location` payload, or an
  expanded object stored where an id belongs, is an application-data fix only
  its owner can make: the command reports and prescribes; the operator fixes
  and re-runs until green. (A mechanical normaliser — say, collapsing a stored
  expanded-lookup object to its `id` — is deliberately *not* built until real
  reports show the shape common enough to justify one; a normaliser that
  guesses is how silently-wrong values got here.) With no conversions,
  `--apply`'s only write is the flag row — which keeps the #3617 invariant
  intact: a dry run changes nothing, and whether a run changed the
  deployment's posture never depends on what the run found.
- **The scanner and the validator share one predicate.** Same class sets,
  same cached `valueSchemaFor`, same skip rules (`system` / `readonly` /
  lifecycle columns are never validated, so they are never scanned): the scan
  must count exactly what strict mode would reject on that record's next
  rewrite, and nothing else. Imported, not re-derived — hand-copied value
  knowledge is the disease this ADR exists to cure.
- **Gate consumption mirrors the media half verbatim**: the engine reads the
  flag once per process (memoized), an object declaring no covered field never
  consults it, `ValidateRecordOptions` gains the parallel option beside
  `mediaValueShapeStrict`, and a later failing run clears `verified_at` — a
  regression closes its own gate.
- **Precedence, and the one new env var**: `OS_ALLOW_LAX_VALUE_SHAPES` (an
  `OS_ALLOW_*` escape hatch per Prime Directive #9, scoped to these classes —
  media keeps its own `OS_ALLOW_LAX_MEDIA_VALUES`) beats
  `OS_DATA_VALUE_SHAPE_STRICT_ENABLED` (unchanged: still the all-class
  opt-in) beats the flag. Same contradictory-config rule as
  `mediaStrictEffective`, for the same reason: wrongly lax costs a warning,
  wrongly strict stops a working app.
- **The upgrade path advertises the scan, so "one upgrade, done" is the
  default experience rather than a discovery.** `os migrate meta --from 16` —
  the command every 16→17 upgrade already runs — ends by naming the two data
  migrations (`files-to-references`, `value-shapes`) with their gate status,
  and a deployment booting ≥17 with covered fields and no
  `adr-0104-value-shapes` row logs one line at startup saying warn-mode is in
  effect and which command ends it. A gate nobody is told about is served by
  nobody. *(Amended as implemented, #4253/#4284: `meta` names the migrations
  **without** gate status. The status half was a category error this ADR had
  already corrected — per the 2026-07-27 addendum the gate is per
  **deployment**, and `meta` acts on **source**, which deploys to zero-or-N of
  them, so "its" status has no referent at meta time. Status is reported where
  a datastore is actually open: each migration command reports before it
  writes, and the boot line carries the live verdict — after #4284, only where
  that line is true: counting only fields a write would check, silent when an
  env switch already settled the posture.)*

### Fresh datastores attest at creation — both flags

Today nothing records a flag except a migration run, which leaves a gap at
the other end of a deployment's life: a deployment born on ≥17 starts **lax**
and stays lax until its operator thinks to run a migration that is, for them,
a no-op. The warn regime would never die out — every new deployment re-enters
it.

So the bootstrap that creates an empty datastore records both rows
(`adr-0104-file-references`, `adr-0104-value-shapes`) at creation time. This
is not version-gating in disguise: the fact recorded — *no legacy value
exists here* — is **observed** (the store is empty by construction at the
moment of creation), the same observed-transition discipline the GC gate runs
on. An existing database upgrading to 17 is non-empty at boot, gets no
attestation, and keeps producing its evidence by scan. A later legacy import
into a born-strict deployment is rejected loudly at the write path — the
correct outcome; an operator who must temporarily admit such data has the
escape hatch, and re-verifies by re-running the scan. The exact seam is the
implementing PR's decision (candidates: the system seed that first creates
`sys_migration`, or the engine's schema bootstrap), with one hard
requirement: it fires only for a store it is itself creating from empty,
never for one it found.

**Seam, as implemented.** Neither candidate survived contact: *"`sys_migration`
is absent"* is precisely the 16→17 trap — an upgrading database lacks that
table too — and the schema bootstrap runs identically on both. Nothing in the
platform recorded datastore newness at all; the drivers knew it for one
statement (`hasTable` → `createTable`) and discarded it. So the observation is
now kept: each driver counts the tables it **created** against those it
**found** since connect (`IDataDriver.getSchemaSyncStats`), and a store is
attested only when the whole engine reports *created > 0 and existing = 0*.
Every uncertainty resolves to "no" — a driver that cannot report, a deferred or
skipped sync, a second datasource that was already there. Being strict here is
cheap in the only direction that matters: a wrongly-withheld attestation costs
a command someone can still run, a wrongly-granted one asserts a store's
history on no evidence. The write lands at `kernel:ready` from the service that
owns `sys_migration`, and never overwrites an existing row: a store with flag
rows is by definition not one being created.

Born-strict deployments also make the platform's own dogfood the standing
canary for R2 (a codified shape stricter than some legitimate client's
writes): showcase/CRM boots are fresh datastores, so they enforce from birth,
and a false rejection fails our suites before any customer sees it. Since
#3459 that canary covers the collection path too — a born-attested dogfood run
exercises release-time tombstoning and the reap guard's re-verify on every
boot, so an over-eager delete fails our suites rather than a customer's data.

### D2 action params: the evidence cannot exist, so strict is the 17.0 default

What per-deployment evidence would have to prove is: *no caller of this
deployment still depends on the lax contract.* Callers are not enumerable —
an integration that fires monthly, a script in a cron nobody remembers, an AI
agent constructing each call fresh. Data at rest can be scanned to
completion; future calls cannot. A "quiet for N days" flag would assert a
completeness it cannot have — the unlocatable-gate error of the 2026-07-27
addendum, reproduced one layer down. A gate must not claim evidence that
cannot exist, and we decline to build the theatre of one.

With a per-deployment gate ruled out, the choice is the release vehicle, and
the amortisation question answers it. What would parking the flip on a later
major protect? Not records — no data is at stake, and the D1 read-modify-write
hazard has no analogue here. Not end users — a strict rejection is **loud**
(a 400 naming the offending param and the declared list), **caller-facing**
(a developer or an AI mid-integration, who reads errors for a living), and
**reversible** (the escape hatch below). The R3 hazard that once justified a
long lax window is, in its dangerous half, already closed: dispatch's own
injected keys (`recordId` / `objectName`) ride the `ACTION_PARAM_BUILTIN_KEYS`
allowlist, so what strict rejects now is a bag that is genuinely wrong
against its declaration. And v17 itself sets the severity bar: it flips
unset-`allowExport` from allowed to **denied** and refuses undeclared action
handlers with **no opt-out at all**, both with zero warn window. Holding D2 —
gentler than either — to a stricter standard than the release it ships in is
not caution, it is incoherence. So: **`actionParamsStrict()` defaults to true
in 17.0.** A 16.x deployment meets the contract and its enforcement in one
planned, tested upgrade; the alternative served nobody a gentler break — it
scheduled a second one.

One windfall confirms the timing. The `OS_ACTION_PARAMS_STRICT_ENABLED`
opt-in has only ever existed inside the 17.0 RC window — no stable release
carries it — so flipping in 17.0 means the variable is **deleted before it
ever reaches `latest`**: no redundant knob at GA, no deprecation debt, no
`readEnvWithDeprecation` shim. Parking the flip on 18.0 would have shipped
the knob stable and then carried it. Mechanics: the opt-in is removed (RC
consumers get one release-note line); the new `OS_ALLOW_LAX_ACTION_PARAMS`
escape hatch (Prime Directive #9 `OS_ALLOW_*` shape) is the single switch and
restores warn-first verbatim for an operator mid-diagnosis; the dogfood
contract suite (`action-params-contract.dogfood.test.ts`) flips its duals so
the *default* path is the strict one and the escape hatch is the
explicitly-set case; the v17 release notes carry the migration section (what
a rejected bag looks like, how to fix the caller, the escape hatch's name).

Actions declaring no `params` keep their pass-through — that boundary is
unchanged from D2's landing. And the asymmetry with D1 stays load-bearing in
both directions: a version flip is wrong where complete per-deployment
evidence is *possible* (D1's data), and right where it is impossible in
principle and the failure mode is a self-describing 400 to the party who can
fix it.

### What rides where

| vehicle | change |
|---|---|
| 17.0 | D2 strict by default (`OS_ACTION_PARAMS_STRICT_ENABLED` deleted, `OS_ALLOW_LAX_ACTION_PARAMS` added, dogfood duals flipped). `os migrate value-shapes` + the `adr-0104-value-shapes` gate wiring. Fresh-datastore attestation of both flags. `os migrate meta` / boot-log advertisement of the scan. D1 non-media stays warn-first until the deployment's own gate opens. |
| each deployment, ≥17.0 | runs `os migrate value-shapes --apply` (or is born attested) → its own D1 non-media classes flip to strict. Clean data ⇒ one upgrade, done. |

#3438 then tracks two work items instead of an open question, both on the
17.0 train: the D2 default flip (validator default + env-var swap + dogfood
duals + release notes), and the scan migration (command, engine wiring,
creation-time attestation, upgrade-path advertisement).

## Addendum (2026-08-07) — vocabulary aliases and three membership facts (errata; no decision changes)

This addendum decides **nothing**. It exists because decisions recorded above
were re-proposed as if they had never been made, and the sole cause was
vocabulary. #5867 asked for a *new* ADR to settle four things — a spec-owned
`fieldRuntimeType`, named `FileRef` / `RecordRef` reference types, read-time
expansion, and a typed action handler — every one of which D1, D2 and D3
settled on 2026-07-22 and shipped as code. The proposal was searched for
duplicates before it was filed. A repo-wide grep for `fieldRuntimeType`,
`FileRef` and `RecordRef` returned **zero** hits on the day it was filed — in
`docs/adr/` and everywhere else, and it is this addendum that changed that —
because this ADR spells the same contract `valueSchemaFor` /
`FileReferenceIdValueSchema` / `ReferenceIdValueSchema` / `ValueForm`. One
failed search produced a phantom design card and spent a maintainer approval
before the premise check caught it (#5867, closed as already satisfied by this
ADR; the errata card is #6189).

The lesson is narrow and mechanical. Prime Directive #13 sends every author to
**grep the ADRs** before changing behaviour under them, so an accepted ADR is
binding only as far as it is findable — and a grep can only hit words that are
present. The outside vocabulary is therefore registered here, inside the record
the search is meant to land in. Nothing below alters D1–D4 or any earlier
addendum; where a fact and this ADR's own prose disagree, the disagreement is
named rather than edited away.

### Alias registry — outside or colloquial name → the name this ADR uses

| said elsewhere | this ADR / the shipped contract | defined in |
|---|---|---|
| `fieldRuntimeType(type, { multiple })` | **`valueSchemaFor(def, form)`** (D1.2) — the pure derivation from a field definition to its value schema. Note the shape difference: `multiple` is not an option argument, it is read off the definition by `isMultiValueField(def)`. | `packages/spec/src/data/field-value.zod.ts` |
| `FileRef` | **`FileReferenceIdValueSchema`**, over the `FILE_REFERENCE_TYPES` class (D1.1, D3) | same file |
| `RecordRef` | **`ReferenceIdValueSchema`**, over the `REFERENCE_VALUE_TYPES` class (D1.1) | same file |
| "read-time expansion" (读时展开) | **`ValueForm`**, whose two members are `'stored'` and `'expanded'` (D1.2); `valueSchemaFor(def, form)` dispatches on it, and `expanded` ≡ `stored` for types with no expansion | same file |
| `defineActionHandler` / "typed action handler" | **`ActionHandler`** and `ActionHandlerContext` plus `validateActionParams()` / `ACTION_PARAM_BUILTIN_KEYS` (D2) | `packages/spec/src/ui/action-params.zod.ts` |

Add a row here whenever an outside proposal turns out to be asking for
something D1–D4 already decided. An unregistered alias costs a duplicate ADR,
and a duplicate ADR over a live contract is a *second source of truth* for the
very thing this ADR's Context section opens by counting four of.

### Three membership facts, as shipped

#5867's framing carried three errors about the type classes it was naming.
They are recorded here because an alias table is worse than useless if a reader
carries the aliased vocabulary's *coverage* across with its names.

1. **`owner` is not a `FieldType`.** The declared members are enumerated in
   `packages/spec/src/data/field.zod.ts`, and `owner` is not among them; lines
   52–53 say why: `user` is "NOT a separate storage primitive … Ownership stays
   the existing `owner_id` convention (plugin-security); a declarative `owner`
   is a possible future flag." So ownership is not part of the reference class
   this ADR contracts over, and `RecordRef` coverage that lists `owner` is
   describing a type that does not exist.
2. **`REFERENCE_VALUE_TYPES` includes `tree`.** The shipped class is `lookup`,
   `master_detail`, `user`, `tree` — `tree` is a hierarchical reference and
   stores a record id like the rest, so `referenceTargetOf()` and every
   consumer of the class already cover it. Two errata in one fact: D1.1 above
   names this constant `REFERENCE_TYPES` and lists three members; the shipped
   constant is **`REFERENCE_VALUE_TYPES`** and has four. The shipped set is the
   contract — this sentence corrects the record of it, and changes no decision.
3. **`FILE_REFERENCE_TYPES` includes `avatar`.** The class is `image`, `file`,
   `avatar`, `video`, `audio` — as D1.1 already lists it, and as the whole
   media family D3's 2026-07-24 addendum insists on covering together. A
   `FileRef` scoped to `file`/`image`/`video`/`audio` would leave `avatar` on
   the legacy inline shape, which is precisely the per-type carve-out that
   addendum rejected.
