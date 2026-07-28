# @objectstack/rest

## 17.0.0-rc.0

### Minor Changes

- ad4af62: feat: single-source API-method derivation — the server is the only adjudicator (#3391)

  An object's effective API surface is now resolved from **six primitives**
  (`get/list/create/update/delete/bulk`) by ONE derivation table in
  `@objectstack/spec/data` (`resolveEffectiveApiMethods` / `isApiOperationAllowed`
  / `effectiveOperationsArray` / `API_METHOD_DERIVATION`). Every gate consumes it:
  the REST data surface, the runtime HTTP/MCP dispatcher, and the
  `/me/permissions` annotation. The `apiMethods` whitelist is three-state —
  `undefined` = unrestricted, `[]` = deny-all, a subset = the derived closure — and
  the legacy 8 verbs (`upsert/aggregate/history/search/restore/purge/import/
export`) are DERIVED from the primitives, never declared standalone. (This
  release also ships the enum shrink — see the `#3543` changeset: the authored
  enum IS the six primitives, and a stored legacy value is stripped at parse
  with a warning rather than honored.)

  **Derivation:** `import` ⊆ create∨update (writeMode-precise: insert→create,
  update→update, upsert→create∧update); `export` ⊆ list (reserved user-export slot,
  always on this phase); `aggregate`/`search` ⊆ list (search also needs
  `searchable`); `history` ⊆ get ∧ `trackHistory`; `upsert` ⊆ create∧update;
  bulk sub-ops ⊆ bulk ∧ derived(child). `restore`/`purge` do not derive (the
  `enable.trash` flag was retired, #2377).

  **New response-side contract:** `EffectiveObjectPermissionSchema` extends
  `ObjectPermissionSchema` with an optional `apiOperations` array;
  `GetEffectivePermissionsResponse.objects` uses it, and `/me/permissions` now
  hands down the per-object effective operation set. The authoring
  `ObjectPermissionSchema` is deliberately NOT extended — the frontend consumes
  the effective set the server resolves, never the raw whitelist.

  **Behavior changes (tightening — a `declared ≠ enforced` gap closed):**

  1. `apiMethods: []` + `apiEnabled: true` now denies every operation (405),
     matching the documented three-state contract instead of the prior fail-open
     "no restriction". In-repo impact is zero (every `[]` object also sets
     `apiEnabled: false`, so 404 precedes 405).
  2. The runtime dispatcher / MCP whitelist is now live. It previously read the
     flat shape while `getObject()` returns the flags nested under `.enable`, so
     the gate never fired — a silent dead gate now enforced (nested-first,
     flat-compatible).
  3. `import`/`export` reverse-derive: an object with a plain CRUD whitelist (no
     explicit `import`/`export`) now admits import (⊆ create∨update) and export
     (⊆ list). Row-level FLS is shared with list; the export column header is now
     projected to the FLS-readable set so it can never expose a wider column set
     than list (previously a masked column leaked its name as an empty column).
  4. The bulk surfaces (`createMany`/`updateMany`/`deleteMany`, per-object
     `/batch`, cross-object `/batch`) now require the `bulk` primitive AND the
     child write (`bulk ∧ child`). The four in-repo explicit-whitelist objects
     (`sys_user`, `sys_user_preference`, `sys_business_unit`,
     `sys_business_unit_member`) gained `bulk`; a third-party object with an
     explicit write whitelist that omits `bulk` will now 405 on the Many/batch
     routes.
  5. The 405 body's `allowed` array is now the derived EFFECTIVE operation set
     (enum-ordered), not the raw whitelist.

- 5f9a987: fix(rest): a batch create goes through the same create ingress as a single create (#3835)

  `readonly` meant two different things depending on which create endpoint you
  used. `POST /data/:object` runs the #3043 ingress strip, so a non-system caller
  cannot seed a read-only column — the field is dropped and reported. The
  cross-object transactional batch (`POST /batch`) called `ql.insert` directly and
  skipped that ingress entirely, and the engine's INSERT path is
  static-`readonly`-exempt **by design** (#3413, the strip lives one layer up), so
  nothing enforced it: the same forged `readonly` value that was rejected on one
  route was written through on the other.

  Measured on the showcase (`showcase_contact.lead_score`, `readonly: true`, same
  signed-in non-system user):

  |                               | before                                 | after            |
  | ----------------------------- | -------------------------------------- | ---------------- |
  | `POST /data/showcase_contact` | `lead_score = null`, reported          | unchanged        |
  | `POST /batch` create          | **`lead_score = 999` written, silent** | `null`, reported |

  The fix routes the batch's create ops through the protocol's `createData` rather
  than re-implementing the strip at the REST layer. That keeps **one** create
  ingress: a future change to its policy covers the batch for free, and the
  carve-outs already encoded there stay intact — notably the platform-object
  exemption (a `sys_`/`managedBy` object's own guard must _reject_ a forged value
  with 403, not have it silently swallowed) and the `isSystem` exemption. The
  context passed through is the transaction context, so the insert still joins the
  batch transaction and rolls back with it, and `{ $ref: <opIndex> }` resolution is
  unaffected.

  `createData`'s `droppedFields` are folded into the batch response's per-op
  `droppedFields` list (#3794), so a batch create now reports its strips the same
  way an update does.

  Update ops are untouched: the engine enforces `readonly` and `readonlyWhen` on
  its own update path.

- 5f9a987: fix(rest): report `droppedFields` from the cross-object batch, so a silent strip stops reading as a clean save (#3794)

  The engine strips writes to `readonly` (#2948) and `readonlyWhen`-locked (#3042)
  fields and completes the write without them. Every write path already reported
  which fields it dropped (#3431/#3455) — except the cross-object transactional
  batch, which never wired `onFieldsDropped` at all.

  That path is the Console record form's save for a master-detail record, so it is
  exactly where a _user_ edits a `readonlyWhen` field: they changed it, the form
  said "updated successfully", the value never moved, and nothing anywhere said
  so.

  `POST /batch` responses now carry a top-level `droppedFields` list, each event
  tagged with the `index` of the operation that produced it (`results` entries are
  bare record echoes, with no envelope to hang a per-row list on). Omitted
  entirely when nothing was dropped, so the shape stays backward-compatible; the
  batch still commits either way — a strip is legal semantics, not an error.

  The Console half ships in objectui: the write-warning toast now fires on batch
  saves too.

- 3949a43: fix(metadata-protocol,rest): the data path really 404s unknown objects now (#3770)

  The REST API-exposure gate (`enforceApiAccess`) passes through any object it
  cannot find in metadata, and the comment there justified that with
  `// unknown object → let the data path 404`. That fallback did not exist.

  - `findData` — and every other data entry point except `cloneData` — had **no
    existence check**. The repo's only `OBJECT_NOT_FOUND` throw was in `cloneData`.
  - The engine does not reject unregistered names either: `resolveObjectName`
    falls back to `StorageNameMapping.resolveTableName({ name })`, so the object
    name is used **as the table name**.
  - The 404 was therefore only ever a side effect of the **driver** erroring on a
    missing table, which the REST layer recognised by matching the driver's error
    string.

  So the 404 held only when the table happened not to exist. When a physical table
  with that name **did** exist — out-of-band DDL, a registration that failed after
  `syncObjectSchema` had already run, a registration race — the exposure gate was
  silently skipped and the rows were served, with no layer turning it into a 404.
  (Since #3545 an authenticated caller on a plugin-security deployment is refused
  by the fail-closed posture check; anonymous callers and deployments without
  plugin-security were not.)

  **The gate.** `ObjectStackProtocolImplementation` now runs a shared
  `assertObjectRegistered` before storage is touched, on `findData`, `getData`,
  `createData`, `cloneData`, `updateData`, `deleteData`, `batchData`,
  `createManyData`, `insertManyData`, `updateManyData`, `deleteManyData` and
  `analyticsQuery`. An object absent from the schema registry is rejected with
  `OBJECT_NOT_FOUND` / 404 — an authoritative answer from the registry, raised
  _before_ the name becomes a table name, instead of an inference from driver
  prose. `cloneData`'s open-coded check is now that shared gate; its envelope is
  unchanged.

  It sits at the protocol ingress, the same boundary `apiEnabled` guards: internal
  callers (hooks, flows, migrations, raw ObjectQL) go to the engine directly and
  are unaffected. When the engine exposes no schema registry at all there is
  nothing to consult, so the gate stands down and warns once per process —
  matching the tiering #3545 recorded in `api-exposure.ts` for a whole-registry
  outage.

  **Behaviour change.** A REST data request for an object that is not in the
  schema registry now returns `404 object_not_found` even when a table of that
  name exists. Previously it returned that table's rows. If a deployment depended
  on reading a table with no registered object, register the object (its schema is
  what every other layer — exposure, RBAC/FLS/RLS, field projection — already
  needs in order to enforce anything at all).

  **One wire code.** `mapDataError` maps the protocol's `OBJECT_NOT_FOUND` to the
  canonical `object_not_found` `ApiErrorCode` — byte-identical to the envelope the
  driver-string branch already produced — so a client keying on `code` sees _what
  happened_, not _which layer noticed_. The driver-string branch stays as the
  safety net for the other failure it actually covers: an object that IS registered
  but whose physical table is missing. Callers that were reading `cloneData`'s 404
  as `code: 'OBJECT_NOT_FOUND'` on the wire now get `object_not_found`; the status
  is 404 either way.

  The misleading comment is replaced with what actually closes the hole — this
  gate for existence, plugin-security's `unresolved` posture (#3545) for
  authorization — and a note not to widen the exposure gate on the assumption that
  some other layer 404s.

- 7c7e246: feat(authz): expose the caller's delegable scope — the read half of the
  delegated-administration gate (ADR-0090 D12 / ADR-0105 D8)

  `adminScope` decided writes but could not be READ: `assignablePermissionSets`
  lived only inside `delegated-admin-gate.ts`, so a UI offering "place this
  person in a unit, with these positions" (the D8 scoped-invitation form) had no
  way to narrow its pickers. It would list the whole tree and let the user
  discover the boundary by being refused — which turns an authorization gate into
  a validator and makes the boundary invisible until it bites.

  `ISecurityService.describeDelegableScope(callerContext)` answers it, exposed as
  `GET /api/v1/security/my-delegable-scope` and `client.security.describeDelegableScope()`:

  - `placeableBusinessUnitIds` — union of the subtrees where the caller may place
    people (scopes granting `manageAssignments`);
  - `assignablePositions` — positions whose every distributed permission set the
    caller may hand out (containment check included);
  - `scopes` — the held `adminScope`s with subtrees resolved, for attribution;
  - `isTenantAdmin` — unconstrained, with everything enumerated so a consumer
    renders ONE uniform picker instead of special-casing.

  Computed by the same helpers the write gate enforces with, so an option this
  reports is one `assert()` accepts — a test asserts that agreement directly. It
  NARROWS; the gate still decides.

  Strictly self-scoped: no target-user parameter, so it discloses nothing beyond
  the authority the caller already holds (unlike `explain`, which has one and
  gates it). Fail-closed — unresolvable scopes contribute nothing, a caller with
  no delegated authority gets empty lists, and a deployment without
  `@objectstack/plugin-security` gets 501.

- 9613396: feat(security): ENFORCE the user-level export axis on the server (#3544)

  `allowExport` landed as a spec bit plus a `/me/permissions` annotation, which
  hid the client's Export button — and nothing else. Because `export ⊆ list`, the
  REST export route streams through `findData` and the engine middleware sees an
  ordinary `find` gated by `allowRead`, so no code path ever read the bit: a caller
  holding `allowExport: false` could still `curl
/api/v1/data/:object/export` and drain the whole table. Declared, not enforced.

  - **plugin-security** `PermissionEvaluator.checkObjectPermission('export', …)` is
    now a real decision: `export` = read granted ∧ not explicitly denied.
    `allowExport` stays out of `OPERATION_TO_PERMISSION` on purpose — that map
    means "the bit must be truthy", which would have denied export to every
    permission set authored before the axis existed. The new exported
    `resolveUserExportAllowed()` folds the tri-state across sets (`true` beats
    `false` beats unset) exactly as the `/me/permissions` merge does.
  - **spec** `ISecurityService` gains `canExport(object, context)` — the question a
    bulk-egress door outside the engine middleware has to ask before it reads.
    Fails CLOSED; `isSystem` and an empty set resolution bypass, mirroring the
    middleware.
  - **rest** `GET /data/:object/export` calls it and answers **403
    `EXPORT_NOT_PERMITTED`** before the first chunk is fetched. Distinct from the
    object-level 405 `OBJECT_API_METHOD_NOT_ALLOWED`, which still runs first: 405
    says the object exposes no export, 403 says this caller may not use it. No
    security service (no `plugin-security` ⇒ no permission sets) → allowed, the
    same fail-open posture as every other permission gate in that layer; service
    present but unable to answer → denied.
  - **plugin-hono-server** the `/me/permissions` annotation now falls back to the
    `'*'` entry's export bit when a per-object entry declares none, matching the
    evaluator's own wildcard fallback — so a set that denies export wholesale via
    `'*'` no longer offers a button the server refuses.

  Backward-compatible: `allowExport` is still an opt-out with no default, so an
  unset bit inherits read and existing permission sets behave exactly as before.
  Only a permission set that explicitly sets `allowExport: false` changes — and it
  now changes on the server, which is the point.

  Implementers of `ISecurityService` outside this repo must add `canExport`; the
  interface member is required, matching how `getReadableFields` was added.
  Consumers still feature-detect (`typeof svc.canExport === 'function'`), so a
  partial implementation degrades rather than throwing.

- 2fa4ca1: Dynamic approver routing for approval nodes (#3447 P2) — three new declarative capabilities:

  **`expression` approvers.** A new approver type whose CEL expression resolves WHO approves at node entry, over exactly three roots: `current.*` (the record's live state), `trigger.*` (the submit-time snapshot) and `vars.*` (flow variables, incl. upstream node outputs). `record` and bare field names are rejected before evaluation — on this platform `record` always means "the record at event time", which is ambiguous at an approval node — with error messages that prescribe the correct spelling. The optional `resolveAs: 'user' | 'department' | 'position' | 'team'` re-expands each resolved id through the same graph lookups the static types use; with `behavior: 'per_group'` each intermediate value (e.g. each returned department) forms its own sign-off group. A missing key fails the node loudly; only a present-but-empty result counts as an empty slate.

  **`onEmptyApprovers` policy.** What an empty resolved slate does, node-level, for all approver types: `admin_rescue` (default — request opens for privileged takeover, the #3424 behaviour), `fail` (node fails), or `auto_approve` (skip the request, continue down the `approve` edge with `output.autoApproved = true`). To support auto-approve, the automation engine now honours `NodeExecutionResult.branchLabel` on the synchronous completion path — the field existed but was only ever consumed via resume signals.

  **Decision outputs.** `decide(..., { outputs })` hands structured data from the approver to the flow: the author declares allowed keys on the node (`decisionOutputs`), approvers fill values only, and accepted outputs resume the run as `<nodeId>.<key>` variables — a later approval node's expression can read `vars.<nodeId>.picked_departments`, closing "the previous approver picks the next step's approvers" without a record-field detour. Undeclared keys reject the decision; `decision`/`requestId` are reserved. Multi-approver tallies now always pin to the open-time approver snapshot (previously unanimous re-resolved at each decision against the payload snapshot).

  Also: `collectCelRootIdentifiers` is exported from `@objectstack/formula` (shared by the new `os lint` rules and the runtime pre-check, so they can never drift), resolution inputs are audited on the request snapshot as `__resolvedFrom`, and three new lint rules gate expressions, empty-slate policies and reserved output keys at author time.

- 16adb3c: fix(rest,client)!: reconcile the two REST↔client mismatches the #3587 audit
  ledgered (#3610, #3611)

  **#3610 — `POST /api/v1/packages` publish-vs-install collision.** The REST
  package registrar claimed the bare `POST /packages` for _marketplace publish_
  (`{manifest, metadata}`), while the dispatcher packages domain gives the same
  verb+path _install_ semantics — and REST registers first in the production
  stack (first-match-wins), so every `client.packages.install` call landed on
  the publish handler and 400'd. Marketplace publish moves to
  `POST /api/v1/packages/publish` (breaking for direct callers; a repo-wide and
  objectui-wide sweep found zero). The dispatcher's `POST /packages/:id/publish`
  (ADR-0033 draft publish) is two segments — different shape, no clash. The
  dispatcher already writes both stores on install (`protocol.installPackage`)
  and fully uninstalls on DELETE (`protocol.deletePackage`), so the remaining
  REST GET/GET/DELETE shadows stay — they are compatible.

  **#3611 — UI view dialect split.** `meta.getView` spoke the `?type=` query
  dialect that only the dispatcher `/ui` domain understands; the REST surface
  mounts only the path form `/ui/view/:object/:type`, so the query form 404'd
  wherever REST serves (e.g. project-scoped bases). The client now sends the
  path form both surfaces accept; a URL-pinning test keeps it that way.

  REST route ledger updated: the two `mismatch` rows are resolved (packages
  publish row is `server-only` publisher tooling; the ui row flips to `sdk`).
  The ledger now carries zero mismatches.

- bbd902d: feat(rest): unify request→environment resolution on the host's `kernel-resolver` seam — ADR-0076 D11 step ④ (#2462)

  The REST server kept its own parallel hostname/`X-Environment-Id` resolution
  chain (duplicated inline in three places), while the HTTP dispatcher resolves
  the same question through the host-injected ADR-0006 `kernel-resolver` seam —
  so the same unscoped request could be attributed to different environments
  depending on which HTTP surface served it.

  `RestApiPlugin` now adapts the host's `kernel-resolver` service (registered by
  the cloud runtime next to `env-registry`; no cloud-side change needed) into a
  new `RestRequestEnvResolver` seam, and `resolveRequestEnvironmentId` becomes
  the single entry point every per-environment decision (protocol, i18n,
  exec-ctx) flows through. Where a resolver is wired, its answer — including the
  session-driven fallbacks the REST chain never had — is final; the legacy
  built-in chain remains for OSS single-environment boots (no resolver
  registered) and as the degradation path if the resolver throws.

- 5ac93d4: feat(rest): surface silently-dropped write fields on PATCH/POST /data (#3431)

  #3413 (closes #3407) built the engine-level strip-observability channel
  (`WriteObservabilityOptions.onFieldsDropped`) and wired the flow side
  (`update_record` / `create_record` emit a step warning + `droppedFields`). The
  **REST write path was never wired**, so an external API caller writing N fields
  still got a bare `200 + record` when `readonly` (#2948) / `readonlyWhen` (#3042)
  stripping meant `< N` actually landed — the same silent-success class #3407
  fixed flow-side, just on HTTP. The only way to notice was a per-field diff of
  the returned row (which need not echo every field). This wires the channel
  through the protocol → REST, on both write verbs.

  **Passthrough (metadata-protocol).** `updateData` now registers an
  `onFieldsDropped` collector on `engine.update` and returns the events on the
  response as `droppedFields`. `createData` surfaces the #3043 static-`readonly`
  INGRESS strip too — that strip runs at the protocol ingress
  (`stripReadonlyForInsert`), _before_ the engine, so it is recovered by diffing
  the supplied payload against the stripped one (the engine's `onFieldsDropped` is
  also wired for a future insert-side engine strip). A faulty listener never
  breaks the write — the engine catches and logs.

  **Contract (spec).** `UpdateDataResponseSchema` / `CreateDataResponseSchema`
  gain an **optional** `droppedFields: DroppedFieldsEvent[]` — present only when
  ≥1 field was dropped. Optional + omit-when-empty keeps the response shape
  backward-compatible for clients that only read `record`.

  **REST surface.** PATCH `/data/:object/:id` and POST `/data/:object` echo the
  drops as an `X-ObjectStack-Dropped-Fields` response header
  (`field;reason=<reason>` tokens, comma-joined — e.g.
  `approval_status;reason=readonly`) and keep the structured `droppedFields` on
  the body. **Status/success semantics are unchanged** (200 update / 201 create) —
  a strip is legitimate semantics, not a failure (same principle as #3413). The
  FLS write gate is untouched (it already fails closed with 403).

  Out of scope (issue #3431 D2 open questions, deferred): bulk
  (`updateManyData` / `createManyData` / `batchData`) and GraphQL mutation wiring,
  typed `@objectstack/client` warnings, and adding the header to the Hono CORS
  `exposeHeaders` allow-list for cross-origin browser reads (the body
  `droppedFields` is the cross-origin-safe channel meanwhile).

- d318b24: feat: `security.getReadableFields` query surface for export column projection (#3547, #3391 follow-up)

  The REST export route projected its columns by inferring readability from the
  first chunk of already-masked data rows (#3498). That has two known
  compromises: a readable column whose first-chunk values are all null (and thus
  omitted by the driver) drops out of the header, and an empty result set leaves
  nothing to narrow. This adds the long-term-correct path.

  - **plugin-security** — the `security` service gains
    `getReadableFields(object, context)`. It resolves the caller's permission
    sets and builds the field-permission map with the SAME evaluator +
    `requiredPermissions` fold the read middleware's `FieldMasker` uses (and the
    same on-behalf-of delegator intersection, fail-closed on a dangling
    delegator), then returns every schema field NOT masked non-readable — the
    exact complement of what the mask deletes, so it can never drift from
    data-plane FLS. Computed from schema + context, never from data rows: immune
    to null values and empty result sets. A system context bypasses FLS; an
    unresolvable schema returns `undefined` so callers fall back.
  - **rest** — the `GET /data/:object/export` route asks the environment's
    `security` service for `getReadableFields(object, context)` and projects the
    schema-derived header to that set BEFORE streaming. When no security service
    is reachable (no plugin-security / single-kernel without a provider) it
    degrades to the existing masked-row inference, so there is zero regression.
    Explicit `?fields=` requests are still honored verbatim.

  Contract-neutral: export columns already equal list's readable columns
  (`export ⊆ list`, #3391); this makes the projection authoritative instead of
  inferred.

### Patch Changes

- fa3d0cf: feat(spec): field runtime value-shape contract — ADR-0104 phase 1 (D1)

  `@objectstack/spec/data` now owns the runtime VALUE shape of every field type
  (`field-value.zod.ts`): semantic type classes (`STRING_VALUE_TYPES`,
  `NUMERIC_VALUE_TYPES`, `REFERENCE_VALUE_TYPES`, `FILE_REFERENCE_TYPES`,
  `STRUCTURED_JSON_TYPES`, `MULTI_CAPABLE_TYPES`, …), the shared
  `isMultiValueField`, and `valueSchemaFor(field, 'stored' | 'expanded')`. The
  four consumers that each hand-copied this knowledge (objectql record-validator,
  rest import-coerce, driver-sql column classification, qa conformance) now
  derive from the spec, and the field-zoo round-trip MATRIX is asserted against
  the contract so the two cannot drift.

  **Write-path change (objectql, warn-first):** previously-unvalidated types —
  single `lookup`/`master_detail`/`user`/`tree`, `file`/`image`/`avatar`/
  `video`/`audio`, `location`, `address`, `composite`, `repeater`, `record`,
  `vector` — are now checked against the contract. A violation **logs a warning
  and passes** in this release (legacy rows must not strand their records);
  set `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1` to enforce as a
  `400 VALIDATION_FAILED`. The flip to strict-by-default rides a later minor
  (ADR-0104 R1/R2).

  **Deprecations (removal rides the next spec major), FROM → TO:**

  - `CurrencyValueSchema` (`{value, currency}`) → none. A `currency` field's
    value is a **bare number** everywhere in the runtime (validator, SQL `float`
    column, import coercion, field-zoo oracle); the currency code lives in field
    config. Use `valueSchemaFor({type: 'currency'})`.
  - `LocationCoordinatesSchema` (`{latitude, longitude}`) → `LocationValueSchema`
    (`{lat, lng}`) — the shape the platform actually stores.
  - `AddressSchema` is **adopted** (unchanged) as the enforced `address` value
    contract via `AddressValueSchema`.

  No stored data changes shape; the contract codifies deployed reality
  ("reality wins", ADR-0104 D1).

- 879ea13: ADR-0105 Phase 0 + Phase 1: group tenancy posture; organization scope as a
  first-class authorization dimension.

  > This release carries BREAKING spec removals (see "Enforce-or-remove" below)
  > but is recorded as `minor`: every publishable package is in the Changesets
  > lockstep group, so one `major` would promote the whole monorepo. Breaking
  > changes ship as `minor` during the launch window — the migration notes below
  > are what reach consumers in `CHANGELOG.md`.

  ## Tenancy is now a spectrum (D1)

  `single | group | isolated`, resolved by the `tenancy` service and selected with
  the new `OS_TENANCY_POSTURE` env var. Existing deployments are unchanged:
  `OS_TENANCY_POSTURE` unset derives the posture from `OS_MULTI_ORG_ENABLED`
  (`true` ⇒ `isolated`, else `single`). An unrecognized value throws at boot
  rather than silently landing in a posture with no organization wall.

  - `single` — no wall (unchanged).
  - `group` — **new.** Organizations are membership boundaries over one shared
    dataset; Layer 0 becomes `organization_id IN accessible_org_ids` (union / MOAC
    semantics). Enforced by the OPEN engine.
  - `isolated` — today's `multi`, renamed. Behavior, enterprise `org-scoping`
    probe and degraded-boot handling all unchanged.

  ## Organization scope is a first-class context field (D2)

  `ExecutionContext.accessible_org_ids` — every organization the caller holds a
  currently-valid membership in (ADR-0091 validity windows) — is resolved once by
  `resolveAuthzContext` and carried by every transport. The `group` wall reads it
  directly; RLS policies may reference it as
  `organization_id IN (current_user.accessible_org_ids)`. An empty or absent set
  fails the wall closed.

  Only the Layer 0 PREDICATE widens. Composition is untouched: the wall is still
  computed independently of the RLS compiler, AND-composed outermost, and
  crossable only by a true `PLATFORM_ADMIN` on a posture-permitting object — so
  ADR-0095's W1/W2 invariants hold in every posture.

  ## Two P0 correctness fixes (D3, D4) — behavior changes

  **D3 — app-authored org-scoped RLS policies are no longer silently dropped**
  (finding F1, framework#3539). `collectRLSPolicies` used to strip any policy whose
  `using` contained the substring `current_user.organization_id` when isolation was
  inactive, which swallowed app-authored policies as well as the platform's own.
  Stripping is now decided by PROVENANCE (identity against the shipped
  declaration). **Upgrade impact:** in a deployment with no organization wall, an
  app-authored policy referencing the active organization is now RETAINED and
  fails closed (zero rows) with a one-time warning, where it previously vanished
  and the object read unscoped. `getReadFilter` shared the defect, so analytics and
  raw-SQL consumers were affected too. If a policy was only ever meant for
  multi-org, delete it or install `@objectstack/organizations`.

  **D4 — `viewAllRecords`/`modifyAllRecords` never cross an organization
  boundary** (finding F2, framework#3540). Under a wall-less posture nothing
  bounded the wildcard superuser bits `organization_admin` carries, so a
  deployment that accumulated organizations (personal orgs on signup) made every
  owner/admin an environment-wide superuser. `auto-org-admin-grant` now grants a
  de-VAMA'd `organization_admin_no_bypass` variant when no wall is enforced, and
  revokes the superseded variant whenever the posture changes. **Upgrade impact:**
  in `single` posture an org owner/admin keeps full CRUD but loses the blanket
  ownership/sharing/RLS bypass. Deliberate deployment-wide visibility remains
  available through `admin_full_access` or an explicitly authored permission set —
  it just stops being a side effect of a better-auth membership role.

  ## Engine-owned organization stamping (D5)

  Under any wall-enforcing posture the engine stamps `organization_id` from the
  caller's active organization on an insert that omits it, and validates every
  supplied value against the wall. Idempotent with the enterprise auto-stamp
  (neither overwrites a supplied value). This also closes a real hole: the
  pre-existing post-image check required a non-array payload, so a BULK insert
  could carry a forged `organization_id` per row. One forged row now denies the
  whole write.

  ## Group structure, extension fields and red-line lints (D6, D7)

  - `sys_organization` gains `parent_organization_id` and `sort_order` — a
    **reporting dimension only**.
  - New lint `validateOrgAxisRedLines` (`org-axis-permission-inheritance`,
    `org-axis-cross-org-bu-grant`), wired into `os lint` / `os compile` /
    `os validate`: an RLS policy or sharing rule that walks the org tree is an
    error, as is a business-unit grant on a platform-global object.
  - Extension fields on better-auth-managed objects ride the existing ADR-0092
    whitelist. A new guard derives better-auth's real field surface from
    `getAuthTables()` at the pinned version and fails the build on any name
    collision, so a library upgrade cannot silently take ownership of a column.

  ## Enforce-or-remove (D11) — BREAKING

  Both removals are of surface that had **zero runtime consumers**, so no
  behavior changes; authoring them is now a no-op instead of a lint warning.

  - **`PermissionSet.contextVariables` — REMOVED.** The RLS compiler never read
    it. FROM → TO: a set a policy needs as `field IN (current_user.<key>)` is now
    supplied by a registered membership resolver (below); a constant belongs in
    the policy itself as a literal (`status = 'published'`).
  - **`Territory` / `TerritoryModel` / `TerritoryType` (`security/territory.zod.ts`)
    — REMOVED.** No runtime object, stack field or resolver existed. FROM → TO:
    matrix requirements are served by multi-position × business-unit anchoring; a
    generalized dimension-security module will arrive with its own ADR.
  - **`ExecutionContext.rlsMembership` — PRODUCTIZED.** The bag the compiler has
    merged since ADR-0056 finally has a producer: register an
    `IRlsMembershipResolver` (`@objectstack/spec/contracts`) under the
    `rls-membership-resolver` service, declaring the keys it owns. Fail-closed by
    construction — an unresolved key makes its policies drop out. Kernel-owned
    keys (`accessible_org_ids`, `org_user_ids`, …) are reserved and cannot be
    overwritten from this seam.

  ## Edition boundary (D12)

  The `group` posture's enforcement primitives ship OPEN — the union wall,
  `accessible_org_ids` resolution, D5 stamping/validation, the D3/D4 correctness
  fixes and the D6 lints — because the correctness of a wall is never a paid
  feature (cloud ADR-0016 铁律「强制免费、治理收费」). `isolated` keeps its existing
  enterprise `org-scoping` probe, so the current commercial boundary for
  legal-entity isolation is unchanged by this release.

- 840ee4b: fix(analytics,runtime,types): gate cube auto-inference on object existence; stop the dispatcher boundary returning raw SQL (#3867)

  Two independent defects on the `/analytics` surface, found while verifying #3770
  against a real server. On an authenticated CRM dev server, before this change:

  ```
  POST /api/v1/analytics/query {"cube":"sqlite_master","measures":["count"],"dimensions":["type"]}
  → 200 {"rows":[{"type":"index","count":262},{"type":"table","count":71},{"type":"view","count":1}],
         "sql":"SELECT type AS \"type\", COUNT(*) AS \"count\" FROM \"sqlite_master\" GROUP BY type"}
  ```

  That is SQLite's internal schema table — never a registered object — read
  successfully through the analytics endpoint. Not merely "the name reaches the
  driver and errors": **any table the connection can see was readable.**

  **① The cube name reached the driver as a table name.** `AnalyticsService.ensureCube`
  auto-infers a minimal Cube when none is registered, with `cube.sql = <the queried
name>`. That is the intended "metric over an object" path — an `object-metric` KPI
  widget queries `crm_account` with no authored Cube — but it accepted _any_ string,
  so the endpoint could aggregate over an arbitrary physical table. The
  analytics-side twin of the data-path gap #3770 closed, and it was not covered by
  that fix: #3770 gated the protocol's `analyticsQuery`, which is the _degraded
  fallback_; a deployment with `@objectstack/service-analytics` installed runs the
  real engine instead (`ctx.replaceService`).

  Inference is now gated on the same schema registry the data path consults, via a
  new optional `AnalyticsServiceConfig.isRegisteredObject` that `plugin.ts` wires
  from the `data` engine's `getObject`. Three-way rule: a registered Cube runs
  untouched (its `sql` is whatever it declares); an unregistered name that IS an
  object still auto-infers exactly as before; neither → `CUBE_NOT_FOUND` / 404
  raised before any SQL exists, naming both ways to make the request valid. With no
  probe configured the gate stands down and warns once — the same tiering #3770
  took for a missing registry. `generateSql` (`/analytics/sql`) is gated too.

  **② The dispatcher boundary returned `err.message` verbatim.** `errorResponseBase`
  is the single error exit for _every_ route the dispatcher plugin mounts —
  `/analytics`, `/packages`, `/i18n`, `/storage`, `/automation`, `/auth`,
  `/notifications`, `/mcp`. `@objectstack/rest` has guarded its data routes against
  driver dumps forever (`mapDataError`); this boundary guarded nothing, so any
  driver error on any of those routes shipped its SQL to the client. Unlike ①, this
  half is unconditional — it does not depend on the cube being invalid.

  The leak heuristic moved out of `rest-server.ts` into `@objectstack/types` as
  `looksLikeInternalErrorLeak` (both packages already depend on it) and is now
  applied at both boundaries — one predicate, one place to widen when a new
  dialect's phrasing shows up. `mapDataError`'s behaviour is unchanged. At the
  dispatcher it applies **only to 5xx**: a 4xx message is a deliberate
  business/validation answer and must reach the caller intact. Sanitising costs no
  diagnostics — the untouched error still reaches `errorReporter` through the
  existing `__obsRecordedError` side-channel.

  **Also fixed in the same function:** `errorResponseBase` read only
  `err.statusCode`, while domain errors across this codebase carry `status` (and
  `HttpDispatcher.errorFromThrown` already reads `status` first). Every deliberate
  4xx thrown through a dispatcher route — including #3770's `OBJECT_NOT_FOUND` on
  the analytics fallback path — was rendered as a **500**. It now reads `status`
  then `statusCode`.

  **Behaviour change.** `/analytics/query` and `/analytics/sql` return 404
  `CUBE_NOT_FOUND` for a cube that is neither registered nor a registered object;
  previously the name was passed to the driver. Dashboards and KPI widgets pointed
  at real objects or authored cubes are unaffected. A 5xx on a dispatcher route
  whose message looks like a driver dump now reads `Internal server error` — check
  server logs or your error reporter for the original.

- 1986594: feat(analytics): honour widget `dateGranularity`, `sortBy`/`sortOrder`, and `limit` in the dataset query (#3588)

  Three presentation options were accepted by the metadata layer and then dropped
  by the analytics query builder. They reached no SQL, produced no error, and the
  only way to notice was to read the `sql` a dataset response echoes — so a
  dashboard could declare `dateGranularity: 'month'` and quietly render one bar
  per record.

  - **`dateGranularity` now buckets.** `DatasetSelection` gained an optional
    `dateGranularity`, applied to every selected `date` dimension. Precedence per
    dimension: an explicit `timeDimensions` granularity, then the selection's,
    then the dataset dimension's own default. A widget can bucket a trend by month
    without the dataset committing every other consumer to that granularity.
  - **`order` / `limit` / `offset` now apply on every path.** They are applied to
    the ASSEMBLED grid — after measure-scoped sub-queries merge, after `compareTo`
    columns attach, and after derived measures are computed — so a derived measure
    is a valid sort key and the ObjectQL aggregate path (which has no ordering
    grammar, and which native SQL hands every date-bucketed query to) orders
    identically to native SQL. A single-query selection still pushes the window
    down into the statement. An `order` key that names nothing the selection
    projects is now rejected (400) rather than silently ignored.
  - **`limit` is deterministic.** Without an `order`, a limit orders by the
    selected dimensions first, so it truncates a reproducible window instead of an
    arbitrary subset.
  - **Widget `options` is a contract again.** The four query-affecting keys
    (`dateGranularity`, `sortBy`, `sortOrder`, `limit`) plus `stageOrder` are
    declared on `DashboardWidgetOptionsSchema`, so a typo like `sortDirection` is
    an author-time error. The bag stays open — renderer extras (`icon`, `columns`,
    `striped`, …) pass through untouched.

  Two latent bugs surfaced while fixing the above and are fixed here too:

  - `order`/`limit` were forwarded to EVERY sub-query. A measure-scoped
    supplementary query selects one measure, so an inherited `ORDER BY` named a
    column it never selected, and an inherited `LIMIT` truncated it before the
    merge — dropping rows from the assembled grid. Nothing hit this only because
    nothing passed `order`.
  - The `compareTo` pass built its query by hand and skipped granularity
    resolution, so a month-bucketed primary grid was merged against raw-timestamp
    comparison rows. No dimension key matched and every `<measure>__compare`
    column came back empty.

  `ObjectQLStrategy` now also echoes a representative `sql` (with `date_trunc`,
  `WHERE`, `ORDER BY`, and `LIMIT`; filter values parameterized, never inlined).
  Previously the `sql` field simply vanished from the response whenever a query
  was date-bucketed, leaving an author unable to tell "not implemented" from "this
  strategy doesn't report".

- 3c8cfd1: fix(rest): make the API-exposure gate's metadata fail-open observable (#3545, #3391 follow-up)

  The object API-exposure gate (`apiEnabled` / `apiMethods`) fails OPEN when object
  metadata can't be resolved, so a transient metadata outage doesn't 405 every
  request. #3545 evaluated the residual risk of that path and confirmed it is
  acceptable — the gate is a **surface-area control, not the authorization
  boundary**: every request still passes auth and the ObjectQL security middleware
  (CRUD / FLS / RLS) on the data call regardless of the gate's outcome, so a
  fail-open can never bypass data authorization.

  The one gap was that the fail-open was **silent** — a persistent metadata fault
  (store down / corrupt schema doc), during which the gate allows every operation
  unchecked, looked identical to healthy operation.

  - **rest** `loadObjectItems` now LOGS a _thrown_ metadata read (a real fault)
    while leaving a legitimately-empty registry (a cold-start `[]`) silent — so a
    genuine outage is diagnosable without false alarms during normal startup. The
    behavior is unchanged (still returns `[]` → gate abstains → data path + security
    enforce).
  - **runtime** `api-exposure.ts` records the #3545 tiered decision in its
    contract doc: keep fail-open when the whole metadata service is unavailable
    (failing closed would break the cold-start window for no security gain); the
    narrow "object resolvable but its `enable` policy is present-yet-unreadable"
    widen (unreachable through Zod-validated registration) is deferred to the
    exposure-semantics window (#3543).

  No contract or behavior change to the gate itself — observability + decision
  record only.

- f92096b: fix(approvals): an approval action is recorded against the authenticated caller, never a body field (#3800)

  Every mutating approvals entrypoint takes an `actorId`, and the REST routes
  filled it from `body.actorId ?? body.actor_id ?? context.userId` — so the body
  won. The service then authorized _that value_: `pending_approvers.includes(
input.actorId)` for a decision, `submitter_id === actorId` for a recall. It never
  checked that the value named the caller.

  So any authenticated user could POST `{"actorId": "<someone else>"}` and have
  that person's approval recorded, the request finalized, and the owning flow run
  resumed down the `approve` edge — or name a request's submitter and recall it.
  With `api.requireAuth` unset the anonymous-deny never fires either, so an
  unauthenticated request could do the same.

  #3783 drew this line for the _data-write_ identity and called the audit-row half
  "tolerable". It was not: the same unchecked string was the authorization key, so
  naming someone else was not a mislabelled audit row, it was how you got through
  the door.

  The actor is now resolved server-side (`ApprovalService.resolveActor`) on all
  nine entrypoints — `decide` / `decideNode`, `recall`, `sendBack`, `resubmit`,
  `reassign`, `remind`, `requestInfo`, `comment`.

  **The rule is not "`actorId` must equal `context.userId`."** A slot can
  legitimately be keyed by something else: the approver resolver stores the
  `type:value` literal when a graph lookup finds no holders, and the Console picks
  from the caller's own identity list — user id, email, or `role:<r>`. The rule is
  **"the actor must be an identity the server can prove belongs to the caller"**:

  - A **system** context keeps its explicit actor. The SLA sweep's reserved
    `system:sla` sentinel and the ADR-0043 action link — whose single-use hashed
    token binds exactly one approver — are unchanged. They are the only callers
    holding a trustworthy actor with no session behind them.
  - A caller with **no identity at all** is now refused. This is the anonymous case
    above.
  - **No `actorId`, or one naming the caller**, resolves to the caller. This is the
    common path and what the Console already sends.
  - **Any other value** is accepted only when the server can prove the caller holds
    it — `position:<p>` / `role:<p>` against the positions on the resolved authz
    context, or the caller's own email (one lazy `sys_user` read, taken only when
    nothing cheaper matched). Otherwise `FORBIDDEN`.

  REST still forwards the body value; it is now a _hint_ the service validates,
  which is what keeps the email and `type:value` slot cases working.

  **Upgrade note.** A client that deliberately sent another user's `actorId` now
  gets `403 FORBIDDEN` instead of silently succeeding. Send the action as the
  acting user's own session — the field can be omitted entirely, and the caller is
  used. Server-to-server callers that legitimately act for someone else should
  present a system context, as the SLA sweep and the action link already do.

  This also makes two existing claims true that were previously aspirational: the
  approval object's declared actions say "`actorId` defaults to the caller
  server-side… the service remains the authority on who may act", and
  `attachViewers` documents `can_act` as mirroring "the exact authorization the
  decision methods enforce".

- 1003125: feat(client): close the approvals (6) + record-shares (3) REST gaps (#3587 batch 3/5)

  `client.approvals` gains the full request lifecycle beyond approve/reject:
  `recall` (submitter withdraw), `revise` / `resubmit` (ADR-0044 send-back
  round-trip), and the thread interactions `remind` / `requestInfo` / `comment`.
  New `client.shares` namespace for per-record sharing grants: `list` / `grant` /
  `revoke` (204-safe) under `/data/:object/:id/shares`. REST route-ledger
  ratchet: 26 → 17.

- 6e62a93: feat(client): close the sharing-rules (5) + security-explain (2) + search (1) REST gaps (#3587 batch 4/5)

  New `client.shares.rules` sub-namespace for tenant-wide sharing rules
  (M10.17): `list` / `save` / `get` / `delete` (204-safe, grants cascade) /
  `evaluate` (reconcile). `client.security.explain` speaks the ADR-0090 D6
  access-explanation contract via the POST transport (the GET query form is the
  same `ExplainRequestSchema`). Top-level `client.search` covers global
  cross-object search (M10.5). REST route-ledger ratchet: 17 → 9.

- ecda20c: feat(client): close the 8 reports-family REST gaps (#3587 batch 2/5)

  New `client.reports` namespace speaking the plugin-reports REST surface:
  `list` / `save` / `get` / `delete` (schedules cascade), `run`, `schedule`,
  `listSchedules`, `unschedule`. The two DELETE routes return 204 — the client
  methods return `{ deleted: true }` without attempting to parse an empty body.
  Fixed path (`/api/v1/reports` is not in `ApiRoutesSchema`), matching the
  keys / share-links precedent. REST route-ledger ratchet: 34 → 26.

- 6e62a93: feat(client): close the final 9 REST gaps — ratchet 9 → 0 (#3587 batch 5/5)

  `data.clone` (enable.clone duplication) and `data.export` (streaming
  CSV/JSON/XLSX; returns the raw `Response` — a file stream, not a JSON
  envelope). New `email.send` (IEmailService; branch on the returned `status`).
  `analytics.queryDataset` speaks the ADR-0021 REST dataset-query dialect. New
  `datasources.external.*` federation admin: `listTables` / `draft` / `import` /
  `refreshCatalog` / `validate` (ADR-0015 Addendum, 503-degrading). Every REST
  route is now either SDK-expressed or carries a reviewed non-sdk disposition —
  the #3587 gap ratchet rests at ZERO.

- fc968af: feat(client): close the 9 metadata-family REST gaps the #3587 ledger carried (#3587)

  New `meta` surface: `getDiagnostics` (spec-validation sweep), `getReferences`
  (reverse references), `getBookTree` (ADR-0046 §6 spine resolution), `getAudit`
  (ADR-0010 §3.6 protection trail), `publishItem` / `rollbackItem` / `diffItem`
  (ADR-0033 per-item draft lifecycle). The two compound-name routes
  (`GET|PUT /meta/:type/:section/:name`) turned out to be already expressible —
  `getItem`/`saveItem` pass slashes through unencoded — so they are flipped to
  `sdk` with URL-pinning tests instead of new methods (the audit note claiming
  an encoding barrier was wrong; only `deleteItem` encodes). REST route-ledger
  ratchet: 43 → 34.

- 48c110e: feat(datasource): a datasource that is down is visible, and says why when queried (#3827, #3828)

  #3816 made an explicitly-bound datasource that cannot connect refuse the boot. Two
  gaps survived that fix, both in the cases that still boot — a policy denial, an
  `autoConnect` datasource, or any failure the operator waved through with
  `OS_ALLOW_DRIVER_CONNECT_FAILURE`:

  - **It was invisible.** `DatasourceSummary.status` was the literal `'unvalidated'`
    for every row — the contract declared three states and the implementation only
    ever emitted one — so a dead datasource looked exactly like a healthy-untested
    one. `checkDriversHealth()` could not help either: it iterates registered
    drivers, and a datasource that never connected was never registered, so it is
    _absent_ from the probe rather than unhealthy. The only trace was a warning
    that scrolled past at boot, which made the diagnostic procedure "restart the
    server and re-read the logs".
  - **The query-time error said nothing.** `getDriver()` answered four different
    situations with one sentence, `Datasource 'x' is not registered.`: refused by
    policy, failed to connect under the escape hatch, a misspelled name, and
    `active: false`. Only the third is an authoring bug, so the other three sent
    the reader hunting for a typo that does not exist.

  Both come from the same root: `connect()` already produced a `ConnectResult` for
  every attempt and every caller threw it away.

  - **`DatasourceConnectionService` retains the last verdict per datasource**, with a
    coarse `availability` (`available` / `blocked` / `failed` / `unattempted`) beside
    the raw status. New `getConnectionState(name)` / `listConnectionStates()`.
    `disconnect()` drops it, so a removed pool stops explaining itself.
  - **`DatasourceSummary.status` tells the truth**: `ok` | `error` | `blocked` |
    `unvalidated`, with a new operator-facing `statusReason`. `blocked` is new and
    deliberate — a policy denial is a decision, not a fault, and will not clear on
    its own. Reported in **Setup → Datasources**, `GET /api/v1/datasources`, and the
    summary returned from create/update, so a "Save" whose pool failed to open is no
    longer presented as success.
  - **`ERR_DATASOURCE_UNAVAILABLE` (HTTP 503)**: new `DatasourceUnavailableError`
    from `@objectstack/objectql`, thrown by `getDriver()` when the connection layer
    recorded _why_ a declared datasource has no driver. An undeclared name keeps the
    original message — there is genuinely nothing to add. 503 rather than 500/400:
    nothing about the request is wrong, and the state may clear.
  - **A privileged/public split for the reason.** The error **never** carries the
    underlying cause — connect failures routinely contain hosts, ports and DSNs, and
    a policy's `reason` is written for operators. Those stay in the logs and the
    (admin-gated) datasource list. `DatasourceConnectDecision` gains an opt-in
    `publicReason` for hosts that want to tell tenants something specific
    (e.g. `'External datasources require the Scale plan.'`); it is the only string
    that reaches an end user.
  - **Readiness is deliberately not gated on this.** `/ready` still reflects
    registered-driver health only: an optional datasource being down must not pull an
    otherwise-working replica out of the load balancer.

  Also lands a drift guard for **#3826**, and corrects ADR-0062's status while doing
  it. The ADR claimed D1 ("exactly one definition → live driver path") as
  implemented; only the _construction_ half converged. The `default` driver is still
  registered as a `driver.*` kernel service and connected by `ObjectQLEngine.init()`,
  with its own failure verdict, pool teardown, and no connect policy. What blocks the
  merge is an input-shape mismatch, not ordering: `connect()` takes a datasource
  _definition_ and builds the driver, while `default` arrives pre-built, and routing
  it through the service would make `ObjectQLPlugin`'s boot depend on an optional
  higher-layer service. Until that is designed, `degraded-boot-parity.test.ts` pins
  both paths to the same operator-visible contract (fail-fast by default, identical
  `OS_ALLOW_DRIVER_CONNECT_FAILURE` parsing, `DEGRADED BOOT` on stderr) so a change
  to one that forgets the other fails CI — #3741 → #3758 was exactly that miss, and
  it cost three months and a second bug report.

  **Migration.** Additive. `DatasourceSummary.status` gains a `'blocked'` member: a
  consumer exhaustively switching on it needs a case (the admin UI shows it as a
  distinct state). Nothing that was `'ok'` or `'error'` changes meaning; rows that
  were reported `'unvalidated'` now report their real state. Query-time errors for a
  datasource the connection layer recorded change from a generic `Error` to
  `DatasourceUnavailableError` (503 instead of the previous catch-all status);
  matching on the old `is not registered` text still works for the undeclared-name
  case, which is the only one that was ever accurate.

- ce1f100: fix(rest): export emits the projected header row on an empty result set (#3547)

  `GET /data/:object/export` wrote a zero-byte file whenever the query matched no
  rows — the header was only ever written alongside the first data chunk. With the
  `getReadableFields` column projection the readable column set is derived from
  schema + context, so it is known even when no rows come back: an empty CSV/xlsx
  export now carries the exact readable header, which also makes it a usable
  import template.

  The header is emitted only when the column set is AUTHORITATIVE — the security
  service's readable projection, or an explicit `?fields=` request. When the header
  is schema-derived and the projection was unavailable, the export stays headerless
  as before: the masked-row fallback has no rows to narrow with, and writing the
  full schema header would name FLS-hidden columns. `header=false` still suppresses
  the header in every case.

- 81ce41a: feat(rest): `treatAsHistorical` import also preserves the original audit timeline (#3493)

  Follow-up to #3479/#3483. `treatAsHistorical` solved the FSM half — mid-lifecycle
  rows are no longer rejected by `initialStates` — but the OTHER half of a historical
  migration, preserving the original timeline, still didn't hold: an imported ticket
  that closed in 2021 stored `updated_at` = the import day (and `updated_by` = the
  importer), and a `writeMode: 'upsert'` refresh silently dropped business `readonly`
  fields (`closed_at`, `resolved_by`). Reports, audit, and "recently modified"
  sorting all came out wrong.

  Three layers were force-overwriting the timeline; all three now respect a single
  new opt-in flag, `ExecutionContext.preserveAudit`, which `treatAsHistorical` sets
  alongside `skipStateMachine`:

  - **spec**: `ExecutionContext.preserveAudit` (server-set only, never client-supplied)
    and `DriverOptions.preserveAudit` (threaded to the driver's update stamp).
  - **objectql** — the built-in audit hook (`plugin.ts`) now treats `updated_at` /
    `updated_by` as CLIENT-PREFERRED (`?? now` / `?? userId`) under `preserveAudit`,
    symmetric with how `created_at` / `created_by` already behave on insert; and the
    static-`readonly` write strip (`stripReadonlyFields`) admits a WHITELIST — the
    audit/timestamp family plus author-declared business `readonly` fields — so an
    upsert refresh no longer drops them.
  - **driver-sql** — the SQL `update` path keeps a supplied `updated_at` instead of
    force-advancing it to `now` when `DriverOptions.preserveAudit` is set (fills-only-
    empty, mirroring the insert stamp).
  - **rest** — the import runner sets `preserveAudit` on the write context iff the
    request opts into `treatAsHistorical`.

  Deliberately a WHITELIST, not the blanket `isSystem` exemption: platform-managed
  `system` columns OUTSIDE the audit family (`organization_id` / tenancy, generated
  columns) STAY stripped, so a historical import reinstates established facts without
  becoming a backdoor to forge tenancy. Permissions / RLS / field-level security are
  unaffected — this changes only which audit/readonly values the runtime overwrites,
  never who may write the record. Fully opt-in: a normal write still auto-stamps
  `updated_at`/`updated_by` and strips `readonly` exactly as before. The objectui
  "Import as historical data" checkbox (objectui#2815) now drives both halves — no new
  UI.

- 85e1e4e: feat(rest): `treatAsHistorical` import option — skip the state machine for historical-data migration (#3479)

  Sibling of #3433 (seed exemption), one entry point over. #3165's `initialStates` enforced
  the FSM entry point on every INSERT, so importing established historical facts —
  a batch of already-`closed` tickets, `closed_won` deals, `completed` projects —
  was rejected row-by-row with `invalid_initial_state`, blocking the core
  data-migration path. Unlike the seed case it was visible (per-row errors), but it
  still functionally blocked a legitimate use.

  - **spec**: `ExecutionContext.skipStateMachine` — a general, server-set flag (the
    seed-specific `seedReplay`'s sibling) that skips the `state_machine` rule for a
    write; `ImportRequestSchema.treatAsHistorical` (default `false`) — the user-facing
    import option.
  - **objectql**: the engine now skips the state machine for `seedReplay` OR
    `skipStateMachine` (one helper), covering both seed replay and historical import.
  - **rest**: the import runner sets `skipStateMachine` on the write context iff the
    request opts into `treatAsHistorical`; default off, so a normal import still walks
    the FSM (the strict behavior is the default). Import **undo** now also carries
    `skipStateMachine`, since restoring a prior snapshot re-writes an earlier state
    that need not be a legal transition from where the row is now.
  - **platform-objects**: `sys_import_job.treat_as_historical` audit column (additive).

  Scope is identical to the seed exemption: ONLY the `state_machine` rule is skipped;
  field shape, `format`, `cross_field`, `script` all still run. The objectui import
  wizard checkbox is a separate follow-up.

- 65ac468: fix(import): sanitize row errors — never leak raw SQL, map constraint failures to human wording (#3566)

  A failing import row surfaced the driver's raw error verbatim. When a write hit
  a DB constraint (e.g. `sys_user.phone_number` is `unique`), the query builder
  embeds the entire failing statement in `err.message`, and `toFailedResult`
  handed that straight back — so the importer saw `` insert into `sys_user`
(...) values (...) - UNIQUE constraint failed: sys_user.phone_number ``. That is
  both unreadable and an information disclosure of the schema.

  - `sanitizeRowError()` (import-runner) maps the common constraint failures —
    SQLite / MySQL / Postgres `UNIQUE` and `NOT NULL` — to human wording
    ("A record with this `<column>` already exists.", "`<column>` is required.")
    and, as a backstop, never lets a message that still reads as a SQL statement
    reach the client (it salvages the driver's trailing reason, or falls back to
    a generic message). Already-friendly messages (e.g. better-auth's "User
    already exists") pass through unchanged. Applies to every import path.
  - `isLikelyEmail` now rejects non-ASCII addresses, so an address like
    `x@柴仟.com` fails the import **dry-run** pre-check instead of passing client
    and dry-run validation only to be rejected by better-auth's strict ASCII
    validator at real-import time.

- ef5e72d: fix(rest): undo of a historical import now preserves the audit timeline (#3549)

  A `treatAsHistorical` import writes with `preserveAudit` (#3493), keeping the
  original `updated_at`/`updated_by` and business `readonly` fields instead of
  stamping-now / stripping them. Its undo route, however, restored the captured
  pre-import snapshot with a plain write context — so the audit auto-stamp
  re-wrote `updated_at`/`updated_by` to "now", silently corrupting the very
  timeline the historical import had preserved.

  The undo write context now mirrors the import's own: it carries
  `preserveAudit` iff the job row is flagged `treat_as_historical`, so restoring
  `u.before` re-writes the snapshotted audit/timestamp values verbatim. A normal
  import's undo is unchanged (default stamp/strip).

- 67452d1: feat(spec): resolve page metadata i18n — `page:header` title/subtitle (#3589)

  Custom system pages authored as metadata (Installed Apps, Cloud Connection,
  Connect an Agent) hard-code their `page:header` copy in
  `properties.title` / `properties.subtitle`. Every other metadata type is
  localized at the REST boundary, but `page` was not: the `pages` namespace
  existed only on `AppTranslationBundleSchema` — a schema no runtime reads —
  with no resolver behind it, so those headers stayed English in every locale
  while the matching nav labels translated correctly.

  - `TranslationDataSchema` (the shape the i18n service actually serves) gains a
    `pages` namespace: `pages.<name>.{label,description,title,subtitle}`.
  - New `translatePage` in `@objectstack/spec/system` translates a page's own
    `label` / `description` and overlays `title` / `subtitle` onto every
    `page:header` in the page's regions. Registered in
    `translateMetadataDocument`, so it rides the existing read path.
  - `page` added to the REST boundary's `TRANSLATABLE_META_TYPES`. Locale
    extraction, the locale-keyed ETag, and `Vary: Accept-Language` already
    covered every metadata type — no new plumbing.
  - `objectstack i18n extract` now emits page entries, including the
    `page:header` copy, so the new namespace is not invisible to the tooling.
  - zh-CN / ja-JP / es-ES translations shipped for the three Setup pages, plus
    the missing `nav_cloud_connection` / `nav_connect_agent` nav labels (these
    existed only in zh-CN).

  Header copy is keyed by **page name**, not by component id: `page:header`
  instances carry no stable id. `title` falls back to `pages.<name>.label`, since
  a page's header title and its nav label are normally the same string.

  Authoring is unchanged and English literals stay in metadata as the fallback —
  a page with no `pages` entry renders exactly as before. Consumers of
  `@object-ui` need no change: pages arrive already localized from the server.

- 3d5f726: feat(rest): route audit tranche 2 — the REST surface gets its own ledger +
  conformance guard (#3587, follow-up to #3563)

  The dispatcher tranche closed its 27 gaps and guards them (#3569…#3579), but
  `@objectstack/rest` mounts a second, larger surface the client also reaches —
  89 routes, never audited. `rest-route-ledger.ts` now records a reviewed
  disposition for every one of them (38 sdk, 43 gap, 3 server-only, 3 public,
  2 mismatch), and the guard is real enumeration on both sources: RouteManager
  routes via the `getRoutes()` introspection seam, and the two
  RouteManager-bypassing registrars (`package-routes.ts`,
  `external-datasource-routes.ts`) via captured mock-server registrations — no
  pinned-by-hand list. The client half
  (`rest-route-ledger-coverage.test.ts`) verifies every claimed method exists;
  a 43-gap ratchet is wired into CI. Every guard direction was negative-tested.

  Notable dispositions the audit surfaced: `POST /api/v1/packages` is a
  publish/install shape collision between REST and the dispatcher (REST
  registers first and wins) — ledgered `mismatch`; the REST
  `GET /ui/view/:object/:type` path dialect is unreachable by the SDK's
  query-param dialect — ledgered `mismatch`; `service-storage` /
  `service-i18n` mount a third route surface outside `@objectstack/rest`,
  explicitly out of scope here and tracked under #3587.

  No behavior change — data + tests only, plus a scope-note refresh in the
  runtime ledger pointing at the new REST ledger.

- 1659072: feat(spec): publish `ISecurityService` — the `security` service surface becomes an enforced contract

  The `security` service registers seven cross-package methods (`getReadFilter`,
  `getReadableFields`, `resolvePermissionSetNames`, `explain`, and the three
  audience-binding suggestion calls) but had no contract in
  `@objectstack/spec/contracts`. Consumers duck-typed it, and each one invented its
  own fallback for a missing method or an "empty" answer — with more consumers
  arriving, that is a drift surface.

  `ISecurityService` now documents the surface, and both ends are typed against it
  so it is **enforced rather than declared**: `plugin-security` assigns its
  registration to `ISecurityService` (a renamed, dropped, or re-typed method fails
  that build), and the REST layer resolves the service as a `Partial<ISecurityService>`
  (so call sites must keep feature-detecting instead of assuming the full surface).

  The contract makes explicit the one thing consumers cannot guess — that the
  methods do **not** share a failure convention:

  - `getReadFilter` fails **CLOSED**: a resolution failure yields a deny filter
    matching zero rows, never `undefined`. `undefined` means "no row restriction",
    and nothing else.
  - `getReadableFields` fails **SOFT**: `undefined` means "no answer, use your own
    projection", while `[]` is authoritative and means "no field is readable" —
    opposite instructions that a consumer must not conflate.

  Typing the producer immediately caught one real discrepancy, fixed here:
  `getReadFilter` declared `Promise<Record<string, unknown> | null | undefined>`
  while every return path yields a filter or `undefined` (`filter ?? undefined`
  normalizes the null away). The dead `| null` is removed, so "no restriction" has
  exactly one representation. Type-level only — no runtime behaviour changes.

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
- Updated dependencies [840ee4b]
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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [87aca93]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [32d3800]
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
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [030125b]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0
  - @objectstack/observability@17.0.0-rc.0
  - @objectstack/service-package@17.0.0-rc.0

## 16.1.0

### Patch Changes

- 818e6a3: fix(server-timing): emit the per-request, admin-gated `Server-Timing` header on the standard server (`os serve`/`dev`) (#3361)

  The per-request `Server-Timing` path (#2408) — where an admin sends
  `X-OS-Debug-Timing: 1` (or `json`) and gets phase timings while an ordinary user
  gets nothing — never emitted on the shipped Hono server. The disclosure gate the
  Hono middleware opens is only ever flipped by the runtime dispatcher's
  `timedResolveExecutionContext`, but the data (`/api/v1/data/*`) and metadata
  (`/api/v1/meta/*`) routes on `os serve`/`dev` are served by `@objectstack/rest`'s
  `RestServer` (which shadows the Hono plugin's own CRUD), and its identity
  resolver never opened the gate. Only global mode (`OS_SERVER_TIMING=true`) — which
  discloses to _every_ caller, not just admins — worked.

  - **observability**: the disclosure predicate `isPerfDisclosurePrincipal(ec)` now
    lives here (the home of the gate), the single definition of "who may pull
    per-request timings" shared by every HTTP entry point. `@objectstack/runtime`
    re-exports it for back-compat.
  - **rest**: `RestServer.resolveExecCtx` opens the gate for an admin/service
    principal (via the carried `posture` rung), the REST-server analog of the
    dispatcher — this is the fix that makes `os serve`/`dev` emit.
  - **plugin-hono-server**: the standalone CRUD surface's self-contained
    `resolveCtx` opens the gate too (deriving the rung for the gate decision only,
    never writing it onto the enforcement context). Adds an e2e test that boots the
    Hono app and asserts an admin gets `Server-Timing` while a member/anon does not.

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/observability@16.1.0
  - @objectstack/service-package@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0
  - @objectstack/service-package@16.0.0

## 16.0.0-rc.1

### Minor Changes

- bfa3c3f: **Broadcast a `transactionalBatch` capability bit in discovery so clients negotiate the atomic cross-object batch declaratively, instead of runtime-probing 404/405/501 (#3298).**

  The atomic cross-object batch endpoint (`POST {basePath}/batch`, #1604 / ADR-0034 item 4) and its typed SDK surface (`client.data.batchTransaction`, #3271) already shipped, but discovery never told a client whether a backend actually supports it. Consumers (notably ObjectUI's `ObjectStackAdapter`) had to _probe_: fire a `/batch`, read `404`/`405` (no route) or `501` (no runtime transaction), and only then fall back to non-atomic client-side simulation. That is "find out by calling", not capability negotiation — it cannot be decided at connect time and cannot serve as the "minimum backend supports `/batch`" gate that blocks hard-deleting the non-atomic fallback downstream.

  `WellKnownCapabilitiesSchema` gains a required `transactionalBatch: boolean`, and **every** discovery producer fills it honestly (`declared === enforced`), so it never becomes a declared-but-unpopulated bit:

  - **`@objectstack/metadata-protocol`** (`getDiscovery`) — reports whether the runtime engine can honour a transaction (`typeof engine.transaction === 'function'`). The `/batch` handler runs its ops inside `engine.transaction()`, which degrades to a non-atomic passthrough (or 501) without one.
  - **`@objectstack/rest`** (`/discovery`) — ANDs the engine signal with whether it actually mounts the route (`api.enableBatch`), so a server with batch disabled reports `false` even on a transaction-capable engine (never advertise an endpoint that would 404).
  - **`@objectstack/plugin-hono-server`** (standalone discovery) — reports `false`: this minimal surface registers CRUD only and does not mount `/batch` (that ships with `@objectstack/rest`). Under-reporting is the safe direction — a client keeps its correct-but-slower fallback rather than losing atomicity.
  - **`@objectstack/client`** — already normalizes hierarchical `capabilities` to flat booleans, so `client.capabilities.transactionalBatch` is exposed (and now typed) for declarative consumers.

  The bit follows the existing capability semantics: `true` ⟺ the `/batch` route is mounted **and** the runtime can honour a transaction — the exact condition under which the endpoint returns `200` rather than `404`/`405`/`501`. Additive and behavior-preserving; only the discovery payload gains a field.

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/service-package@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- 22013aa: **Split the overloaded `managedBy: 'system'` bucket into engine-owned vs. admin-writable, and enforce engine-owned writes (ADR-0103, #3220).** The `system` bucket conflated two incompatible write policies: rows a platform service owns end to end (never user-written), and platform-defined schema whose rows are legitimately admin/user-writable. It carried the same all-false affordance row as `better-auth`/`append-only` but, unlike `better-auth`, had no engine enforcement — a wildcard admin could raw-write these rows through the generic data API (ADR-0049 gap).

  Rather than add a new `managedBy` enum value (which would fall through to fully-editable `platform` defaults on already-deployed Console clients), the write policy is now the **resolved affordance** (`resolveCrudAffordances` = bucket default + `userActions`), and _engine-owned_ is defined as a `system`/`append-only` object that grants no write:

  - **Writable set declares `userActions`** — the RBAC link tables (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`), `sys_user_preference`, `sys_approval_delegation`, and the messaging config grids (`sys_notification_preference` / `…_subscription` / `…_template`) now declare `userActions: { create, edit, delete: true }`. The affordance is a declaration only — the `DelegatedAdminGate` / RLS / permission sets remain the authz.
  - **Engine-owned objects locked to reads** — `apiMethods: ['get','list']` added where absent (jobs, notifications, approval request/approver/token/action, `sys_record_share`, `sys_automation_run`, mail/settings/secret audit, the messaging delivery pipeline). `sys_secret` is explicitly read-locked (an empty `apiMethods` array fails open).
  - **`sys_import_job`** stays engine-owned: the REST import route now writes its job rows `isSystem`-elevated (attribution preserved via the explicit `created_by` stamp) and the object is locked to `['get','list']`.
  - **New engine write guard** (`assertEngineOwnedWriteAllowed`, plugin-security) fail-closed rejects user-context generic writes to engine-owned `system`/`append-only` objects, keyed off the resolved affordance; `isSystem` and context-less engine/service writes bypass by construction. Wired into the security middleware alongside the other data-layer gates.
  - **`reconcileManagedApiMethods`** (objectql registry) now runs for **every** managed bucket, not just `better-auth`: any advertised write verb an object's resolved affordances forbid is stripped at registration with a warning (the drift backstop, ADR-0049).
  - **`/me/permissions` clamp** (plugin-hono-server) now clamps `system`/`append-only` as well as `better-auth`, so the client hint reflects `permission ∩ guard`.

  **Potentially breaking:** a downstream/third-party `system` object that advertised generic write verbs relying on today's fail-open behaviour will have those verbs stripped (with a warning) and user-context generic writes to it rejected. Declare `userActions` opening the verbs the object legitimately takes from a user context. `better-auth` keeps plugin-auth's identity write guard unchanged; the row-level `managed_by` provenance vocabulary (ADR-0066) is a different axis and is untouched.

- e057f42: fix: harden the bulk-write path — retries, idempotency, contracts, and summary visibility (#3147–#3152)

  Six reliability fixes to the batched seed/import + `engine.insert(array)` path
  introduced by the #2678 bulk-write rework:

  - **#3151** `bulkWrite` validates that `writeBatch` returns one record per input
    row (a short/long/non-array return is degraded per-row, not backfilled as
    phantom success); `engine.insert(array)` likewise rejects a short driver
    `bulkCreate` return instead of padding afterInsert with `undefined`.
  - **#3150** wraps the two remaining un-retried write points (seed
    `writeRecord`/`resolveDeferredUpdates`, import's no-`createManyData`
    fallback) in `withTransientRetry`; `defaultIsTransientError` short-circuits
    definitive logical errors to non-transient.
  - **#3148** import `resolveRef` flushes pending creates on a same-object miss so
    a later row can reference an earlier same-file CREATE, and no longer
    negatively caches a miss.
  - **#3149** threads an `attempt` counter through `bulkWrite`; seed rechecks by
    `externalId` and import by `matchFields` before re-writing, so a
    commit-then-lost-response retry cannot duplicate a batch.
  - **#3147** `recomputeSummaries` retries transient failures and, on exhaustion,
    surfaces `SummaryRecomputeError` (`ERR_SUMMARY_RECOMPUTE`) instead of a
    silent warn; seed/import recover it to a warning without re-writing.
  - **#3152** autonumbers are assigned after validation, so a batch that dies in
    validation consumes no sequence value (no number-range gaps).

- 43a3efb: fix(rest): gate the cross-object transactional batch by the same per-object API rules as single-record writes (#1604)

  The `POST {basePath}/batch` route (issue #1604 / ADR-0034) wraps N cross-object
  create/update/delete ops in one engine transaction, but it skipped the
  per-object API-exposure gate every single-record route applies — an
  authenticated caller could write to an `apiEnabled: false` object, or run an
  operation outside an object's `apiMethods` whitelist, straight through the batch
  surface (ADR-0049 / #1889 — the same "declared ≠ enforced" hole closed for the
  generic write path in #3220 / #3213).

  The route now:

  - validates the body against a new `CrossObjectBatchRequestSchema`
    (`@objectstack/spec/api`, Zod-First) — a malformed op, an unknown action, or a
    missing `object` is a `400` instead of a `500`;
  - enforces `enable.apiEnabled` / `enable.apiMethods` for **every** op (metadata
    fetched once, each distinct `(object, action)` checked) BEFORE opening the
    transaction — `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`;
  - requires an `id` for `update` / `delete` (`400`);
  - rejects an unresolvable `{ $ref }` with `400 BATCH_UNRESOLVED_REF` instead of
    silently writing a `null` FK;
  - rejects an explicit `atomic: false` (`400 BATCH_NOT_ATOMIC`) rather than
    silently applying atomically — non-atomic per-object batches stay on
    `POST /data/:object/batch`.

  `enforceApiAccess` is refactored to share the pure `apiAccessDenialFromEnable`
  check + a `loadObjectItems` helper with the batch route (single-record behavior
  unchanged). Adds `rest-batch-endpoint.test.ts` — the REST-boundary coverage
  ADR-0034 flagged as missing (commit, `$ref`, rollback surfacing, API-access
  denial, request validation).

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [83e8f7d]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [92f5f19]
- Updated dependencies [32899e6]
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
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0
  - @objectstack/service-package@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/types@15.1.1
- @objectstack/platform-objects@15.1.1
- @objectstack/service-package@15.1.1

## 15.1.0

### Patch Changes

- f531a26: feat(discovery): honest capabilities — standardized stub/fallback marker + realtime route honesty (ADR-0076 D12/A1.5 framework slice, #2462)

  **Spec** — new service self-description marker for honest discovery
  (ADR-0076 D12): `SERVICE_SELF_INFO_KEY` (`__serviceInfo`),
  `ServiceSelfInfoSchema` / `ServiceSelfInfo`, and `readServiceSelfInfo()`,
  which also normalizes plugin-dev's legacy `_dev: true` flag to
  `{ status: 'stub', handlerReady: false }`. A registered service that is a
  stub / dev fake / degraded fallback self-identifies via this marker; a fully
  real service carries no marker.

  **Runtime + metadata-protocol** — both discovery builders
  (`HttpDispatcher.getDiscoveryInfo` and the protocol shim's `getDiscovery`)
  now honor the marker instead of hardcoding `status: 'available',
handlerReady: true` for every registered service. Dev stubs report `stub`,
  the ObjectQL analytics fallback reports `degraded` (it keeps serving — no
  `/analytics` 404), and consumers can finally trust
  `status === 'available'` / `handlerReady === true`.

  **Realtime honesty fix** — discovery no longer advertises a
  `/realtime` route or `websockets: true`: `service-realtime` is an
  in-process pub/sub bus, no dispatcher branch or plugin mounts any
  `/realtime` HTTP surface, so the advertised route always 404'd. The
  registered service now reports `status: 'degraded', handlerReady: false`
  with no route (clients using the SDK are unaffected — it falls back to the
  conventional path, which behaves exactly as before). Also corrects the
  advertised realtime provider from the nonexistent `plugin-realtime` to
  `service-realtime`.

  **REST (A1.5)** — the REST layer's protocol dependency is narrowed from the
  `ObjectStackProtocol` god-union to the new `RestProtocol =
DataProtocol & MetadataProtocol` slice (exported from
  `@objectstack/rest`), per the ADR-0076 D9 incremental narrowing guidance.
  Type-level only; no runtime change.

- f531a26: feat(attachments): sys_file orphan lifecycle + parent-derived attachment access (#2755)

  **Orphan lifecycle (ADR-0057).** Deleting a `sys_attachment` join row used to
  orphan the backing `sys_file` row and its storage bytes forever. `sys_file`
  now declares a lifecycle (`ttl 30d` on a new `deleted_at` tombstone for
  orphans; `retention 7d onlyWhen status=pending` for abandoned uploads), the
  storage plugin's new hooks tombstone a file when its LAST join row is deleted
  (attachments scope only — `Field.file`/`Field.image`/avatar scopes are never
  touched) and un-tombstone on re-attach, and a new LifecycleService **reap
  guard** seam (`registerReapGuard`) re-verifies zero references at sweep time
  and deletes the storage bytes before confirming each row reap. A guarded
  object is never blind-deleted; an erroring guard fails safe (rows retained).

  **Attachment access (ADR-0049, Salesforce parent-derived semantics).**
  `sys_attachment` create now requires caller READ visibility of the parent
  record (403 `ATTACHMENT_PARENT_ACCESS`) and server-stamps `uploaded_by` from
  the session (client value ignored); delete requires uploader-or-parent-editor
  (403 `ATTACHMENT_DELETE_DENIED`). The storage upload routes require an
  authenticated session when an auth service is wired (401 `AUTH_REQUIRED`;
  bare kernels stay open) and stamp `owner_id` on new files.

  **REMOVED — `sys_attachment.share_type` / `sys_attachment.visibility`.**
  Both fields were modeled in v1 with zero runtime consumers (ADR-0049
  parsed-but-unenforced). There is no replacement key: attachment access is
  derived from the parent record by the hooks above. Writers of these fields
  should simply stop sending them (unknown-field validation will reject them);
  existing DB columns are left as unmanaged leftovers, no migration needed.

  `@objectstack/verify` gains `BootOptions.extraPlugins` for booting optional
  service pairs (e.g. storage + audit) in dogfood fixtures.

- f531a26: refactor(security): converge the anonymous-deny decision into one shared function + a source-enumerating ratchet (#2567 Phase 2)

  Phase 1 gated every HTTP surface (REST `/data`, dispatcher `/graphql` + `/meta`,
  raw-hono `/data`) against the secure-by-default `requireAuth` posture, but each
  seam hand-rolled the same `!userId && !isSystem → 401` check. Phase 2 removes
  that duplication and pins the surfaces so a new ungated entry point fails CI.

  - **New `shouldDenyAnonymous` in `@objectstack/core`** (`security/anonymous-deny.ts`)
    — the single anonymous-deny decision + shared 401 body/constants, mirroring the
    `auth-gate.ts` pattern (pure function so the seams can never drift). All five
    seams — REST `enforceAuth`, dispatcher `handleGraphQL` / `handleMetadata` /
    `handleAI`, hono `denyAnonymous` — now delegate to it. **Pure refactor: no
    runtime behavior change** (verified by the unchanged Phase-1 handler + e2e
    proofs). Identity resolution and the dynamic exemptions (public-form grants,
    share-link tokens) are untouched — they run upstream and only ever hand the
    seam an already-resolved context.
  - **A `discover()` ratchet on the authz-conformance matrix** — it statically
    enumerates the data/meta/graphql HTTP entry points from source (curated
    per-file probes, control-plane routes excluded) and asserts each is classified
    by a matrix `covers` key. A new `/data`/`/meta`/`/graphql` route (or a
    removed/stale `covers`) now fails CI as UNCLASSIFIED / STALE, not in review. A
    companion negative test proves the ratchet bites.

  A design trap is guarded: `isAuthGateAllowlisted(undefined)` returns `true`, so a
  body-routed seam (GraphQL, which has no request path) must pass no path — the
  shared function's non-empty-path guard denies anonymous unconditionally there,
  never falling through to the control-plane allowlist.

- f531a26: fix(authz): carry the derived posture rung on ExecutionContext (#2947)

  The ADR-0095 D2 posture ladder (`PLATFORM_ADMIN > TENANT_ADMIN > MEMBER >
EXTERNAL`) is derived once by the shared authz resolver from capability grants,
  but both HTTP/MCP entry points that build the `ExecutionContext` dropped it —
  so any enforcement-side reader of `context.posture` always saw `undefined`
  (the same drop that forced the explain layer to re-derive it, #2949).

  `ExecutionContextSchema` now carries an optional `posture` field, and both
  `rest-server` and the runtime `resolveExecutionContext` plumb the resolver's
  value through. Additive and **behavior-preserving**: no enforcement decision
  consumes `posture` yet — whether the hot path evaluates _by_ posture remains a
  larger ADR-level decision — this only stops the already-computed value from
  being discarded, so enforcement and explain read the same derived rung.

- f531a26: fix(import): make async import-job cancellation actually stop the worker (#2824)

  Cancelling a running async import used to have no effect on a synchronous
  storage driver (better-sqlite3 / wasm fallback): every `await` in the row
  loop resolved as a microtask, so a 50k-row import monopolized the Node event
  loop for minutes — the cancel route's HTTP handler (and every progress poll)
  could never run, so the in-memory flag `shouldCancel` polls was never set.
  The job then finished `succeeded` with all rows written despite the user's
  cancel.

  Three-part fix:

  - **`runImport` yields one macrotask at every progress boundary** (every
    `progressEvery` rows), so pending I/O — the cancel request, progress
    polls, any other traffic — gets serviced during a large import. This is
    the root-cause fix; it also unblocks progress polling for the wizard.
  - **The worker's `shouldCancel` now also reads the durable job row** as a
    fallback: a cancel accepted by another process (or after a restart
    dropped the in-memory flag) still stops the worker.
  - **A late cancel wins the terminal state**: the worker's final patch no
    longer overwrites the cancel route's durable `cancelled` with
    `succeeded`, and a job cancelled while still `pending` doesn't start at
    all. Counts stay truthful — they reflect what was actually written.

- f531a26: fix(rest): split multi-value fields on import so `multiple: true` columns resolve per-token (#3063)

  The bulk-import coercion (`import-coerce.ts`) resolved a reference cell as a
  single value regardless of the field's `multiple` flag: a `multiple: true`
  lookup/user cell like `张焊工;李质检` was passed whole to name resolution and
  always failed with `no <object> matches "张焊工;李质检"`, so every multi-value
  association had to be back-filled by hand in the record UI after import.

  Coercion now mirrors objectql's `isMultiValueField` predicate. A field whose
  stored value is an array — an inherently-multi type (multiselect/checkboxes/tags)
  or a multi-capable type flagged `multiple: true` (per the spec: select, lookup,
  file, image; `radio` shares select's branch and `user` shares lookup's) — has
  its cell split on the export separator (`, ` / `;` / `、` / newline) and each
  token coerced individually:

  - **lookup / user (`multiple: true`)** — resolve each name token to an id, store
    the id array; an unmatched/ambiguous token reports the **specific token**
    (`no sys_user matches "查无此人"`) instead of the whole string.
  - **select / radio (`multiple: true`)** — match each token against the options,
    store the option-value array.
  - **file / image (`multiple: true`)** — split into an id/url array.

  Single-value fields and the non-multi-capable reference types (master_detail /
  reference / tree) are unchanged — a stray `multiple: true` on them stays a
  single resolved value, matching the engine.

- f531a26: fix(security): public-form submissions can no longer forge server-managed anchors (#3022)

  The anonymous public-form surface (ADR-0056 Option A, `POST /forms/:slug/submit`)
  is authorized by the declaration-derived `publicFormGrant`, which short-circuits
  the security middleware BEFORE every write gate (CRUD, FLS, the owner anchor
  guard, the tenant CHECK). The only field-side defense was the route's
  declared-field allow-list — and a FormView with zero declared section fields
  fell back to merging the raw body wholesale, so an unauthenticated visitor
  could `POST owner_id=<victim>` (or `organization_id`, audit columns, `id`) and
  attach the record to another user or tenant — the #3004 insert-forge, with no
  credentials at all.

  Server-managed anchors are now enforced on this surface at BOTH layers, from a
  single shared definition (`PUBLIC_FORM_SERVER_MANAGED_FIELDS`, new in
  `@objectstack/spec/security`):

  - **Data layer (authoritative)** — the `publicFormGrant` branch in
    `@objectstack/plugin-security` strips `id` / `owner_id` / `organization_id` /
    `tenant_id` / audit columns / soft-delete state / `__search` from every row
    of a granted insert (batch included) before admitting the write, so the
    boundary holds no matter what any route lets through. Ownership stays NULL
    for object hooks / the first-admin bootstrap to assign, as for other
    anonymous-seeded rows.
  - **Route layer** — the submit allow-list excludes the same set
    unconditionally: an explicitly declared `owner_id` section field no longer
    passes, and the zero-declared-sections fallback keeps its documented
    all-fields behavior for business columns while refusing the managed set.
    The resolve route (`GET /forms/:slug`) drops the managed fields from the
    rendered sections and the embedded object schema so a form never collects a
    value the submit refuses, and `GET /forms/:slug/lookup/:field` refuses a
    `publicPicker` declared on a managed anchor (which would have opened
    anonymous `sys_user` search through `owner_id`).

  Authenticated writes are unaffected — this is the anonymous-surface rule only;
  `owner_id` transfer semantics for signed-in callers stay governed by the
  transfer grant (#3004 / PR #3018).

- f531a26: fix(rest): mapDataError now honors an explicit 4xx `error.status`/`error.code` carried by domain errors (#2926 ⑦). Record-scope authorization denials from plugin-sharing (status 403, code FORBIDDEN) previously degraded to a bare 400 with no machine-readable code because the generic data routes bypass sendError's status passthrough. Structured 409 envelopes (CONCURRENT_UPDATE, DELETE_RESTRICTED) keep their dedicated branches; 5xx statuses still go through the message-sanitizing heuristics.
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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/service-package@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- a581a65: feat(plugin-security): C2-β — explain 引擎 record 粒度行级归因 (#2920)

  `explain(principal, object, operation, recordId?)` 现支持记录级解释。透传 `recordId` 时，引擎在对象级流水线之上叠加**行级归因**，全部复用 enforcement 同一批函数（explained-by-construction）：

  - **`tenant_isolation` Layer 0**：作为永远最先的层被 prepend；每层打上 `kernelTier`（`layer_0_tenant` vs `layer_1_business`），可区分「租户墙挡的」还是「业务 RLS 挡的」。
  - **每层 `record` 归因**（tenant / owd_baseline / sharing / rls）：`outcome`（admitted/excluded/not_evaluated）、有效 `rowFilter`、`matchesRecord`（用 `@objectstack/formula` 的 `matchesFilterCondition` 对同一条 FilterCondition 求值)、命中的 `rules[]`（tenant_filter/owd_baseline/ownership/record_share/sharing_rule/team/rls_policy，含 grants/via/effect）。
  - **顶层 `record` 判定**：`visible` + `decidedBy` 决定性层。读走复合行过滤匹配，写走 sharing service 的 `canEdit`（均为 enforcement 原语）。
  - **`principal.posture`**：ADR-0095 D2 档位（PLATFORM_ADMIN/TENANT_ADMIN/MEMBER/EXTERNAL）的 B2 stand-in 派生（复用 `resolveAuthzContext` 已投影的 platform_admin / org 角色证据），待 B2 合并后替换。
  - `computeRlsFilter` 重构为 `computeLayeredRlsFilter`（暴露 `{ layer0, layer1 }` 拆分）+ 薄 andCompose 包装，单一代码路径，行级归因不会与执行漂移。
  - REST `security.explain`（GET/POST）接受可选 `recordId`。

  **向后兼容**:无 `recordId` 的对象级请求输出 **byte-identical**——无 `tenant_isolation` 层、无 `kernelTier`、无 `posture`、无 `record`。

- 31d04d4: Fix the data-import automation chain (#2922). Batch `engine.insert` now fires
  `beforeInsert`/`afterInsert` once **per row** with single-record hook contexts,
  so flat-input proxies, declarative hook conditions, audit writers, and
  record-change triggers see real records instead of arrays. A new
  `ExecutionContext.skipAutomations` flag (mirrored into `HookContext.session`)
  lets callers suppress metadata-bound automation hooks and flow dispatch while
  code-registered system hooks (audit, security, sharing) still run — making the
  import wizard's "run automations & triggers" checkbox and import undo actually
  effective. The REST import default flips to running automations unless the
  request explicitly opts out (`runAutomations: false`), matching historical
  behavior.
- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/service-package@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- 607aaf4: 导出文件名本地化 + 系统字段标签内置多语言回退。

  **`@objectstack/rest` — 导出下载文件名**:`GET /data/:object/export` 的 `Content-Disposition` 不再是裸的 `<对象名>.<扩展名>`,改为「对象显示名-时间戳」:ASCII 兜底用 API 名(`filename="contracts-20260714-153045.xlsx"`),本地化标签(如中文)按 RFC 5987/6266 编码进 `filename*=UTF-8''…`(浏览器直接下载得到 `合同-20260714-153045.xlsx`)。新增导出 `exportContentDisposition(objectName, label, ext, now?)`。

  **`@objectstack/spec` — 系统字段标签回退**:ObjectQL 注册表给每个对象注入的系统字段(`owner_id`/`created_at`/`created_by`/`updated_at`/`updated_by`)只带英文标签,自定义对象又没有对应的翻译条目,导致中文界面的列表表头、导出文件、导入模板里漏出 "Owner"/"Created At" 等英文。`translateObject` 现内置这五个字段的 en/zh-CN/ja-JP/es-ES 标签表(措辞与平台生成的翻译包一致),仅当字段仍是注入的英文默认值时套用——作者自定义的标签绝不覆盖;无翻译包时也生效(`translateObject` 不再因缺 bundle 而提前返回,REST 元数据翻译路径同步放宽,缓存 ETag 本就按 locale 分键,无缓存串味风险)。

  **`@objectstack/plugin-reports` — 附件文件名**:定时报表附件的文件名清洗从「非 ASCII 全部替换成 `_`」改为按 Unicode 字母/数字保留(`\p{L}\p{N}`),中文计划名不再变成一串下划线。

  **`@objectstack/rest` — 导入接受翻译后的选项标签(导出 ↔ 导入闭环)**:导出与导入模板写出的是*翻译后*的选项标签(如 `待规划`),但导入强制转换只认作者原始 schema 的标签/值,导致用户把自己刚导出的本地化文件原样导回时 select 字段全部报 `invalid_option`。`prepareImportRequest` 新增 `localizeSchema` 钩子(REST 导入路由传入 `translateMetaItem`),把当前 locale 的翻译标签合并进字段选项作为匹配同义词——作者标签与选项 code 照常匹配,非法值照常报错,翻译失败时降级为仅作者标签匹配。新增导出 `mergeLocalizedOptionSynonyms(metaMap, localizedMetaMap)`。

- e46169c: 面向最终用户的错误消息去掉调试噪音:REST 数据路由(`mapDataError`)对沙箱 hook/action 抛错解包 `SandboxError.innerMessage`(并对丢失实例的情况正则剥离 `hook 'x' threw: Error: ` 包装,保留 `TypeError:` 等非默认错误名);客户端 SDK 的 `error.message` 不再拼 `[ObjectStack] CODE:` 前缀(code 仍在 `error.code` 上可编程读取)。控制台报错 toast 从 `[ObjectStack] hook 'pm_ref_base' threw: Error: 制作基地被…` 变为只显示业务消息本身;完整调试包装仍写入服务端日志。
- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/service-package@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/service-package@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/service-package@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Patch Changes

- 4d9dd7b: fix(rest): validate required fields in import dry-run to match the real insert

  The bulk-import dry run (`POST /data/:object/import`, `dryRun:true`) only ran cell
  coercion and reported every coercible CREATE row as ok — so a row missing a required
  NOT-NULL field with no default was green-lit, then died on the real insert with
  `NOT NULL constraint failed`. The ImportWizard shows the dry-run result, so it
  promised imports that then failed.

  Add a required-field pre-check to the shared import runner (CREATE rows only),
  mirroring the engine's insert-time validation (`objectql/record-validator.ts` +
  `applyFieldDefaults`): a required field is unsatisfied only when it has no value AND
  no default; `system`/`readonly`/`autonumber` and the engine-owned lifecycle columns
  are exempt. `ExportFieldMeta` gains `required`/`system`/`readonly`/`hasDefault`
  (populated by `buildFieldMetaMap`). Applied to both dry-run and real paths so they
  stay identical and a real insert returns a readable `<field> is required` instead of
  a raw driver error; skipped when `runAutomations` is set (a beforeInsert hook may
  populate the field).

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/service-package@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/service-package@14.4.0
  - @objectstack/types@14.4.0

## 14.3.0

### Minor Changes

- 2a71f48: feat(auth): admin direct user management, phone sign-in, and identity bulk import (#2766, re-scoped #2758)

  `sys_user` is managed by better-auth and its generic CRUD is suppressed, so
  until now the only way to add a teammate was the email-dependent invite flow.
  This ships three staged capabilities:

  - **Admin direct user management** — `POST /api/v1/auth/admin/create-user`
    and a wrapped `POST /api/v1/auth/admin/set-user-password` (ADR-0068
    platform-admin gate; better-auth pipeline so credentials are real). Optional
    generated temporary password (returned once, never persisted or logged) and
    a new `sys_user.must_change_password` flag enforced through the ADR-0069
    authGate (`403 PASSWORD_EXPIRED` until the user changes it). New
    `create_user` action and upgraded `set_user_password` action on the Users
    list — pure schema, no frontend changes.
  - **Phone sign-in (opt-in `auth.plugins.phoneNumber`)** — better-auth
    phoneNumber plugin, phone+password only (`POST /sign-in/phone-number`);
    OTP flows stay off until SMS infrastructure exists. Adds
    `sys_user.phone_number` (unique) / `phone_number_verified`. Phone-only
    accounts get an undeliverable placeholder email
    (`u-<random>@placeholder.invalid`, never derived from the phone number);
    all auth mail callbacks refuse placeholder recipients.
  - **Identity bulk import** — `POST /api/v1/auth/admin/import-users` accepts
    the same payloads as the generic import routes (rows/csv/xlsx, dryRun,
    upsert by email or phone) but writes every row through better-auth.
    Password policies: `invite` (reset-link email per created user; requires an
    EmailService) and `temporary` (per-row one-time passwords + forced change).
    Sync only, ≤500 rows per request; no undo; upsert updates touch profile
    fields only and can never reset an existing user's password.
    `prepareImportRequest` and the CSV/xlsx parsers moved from rest-server.ts
    to an exported `import-prepare.ts` module (behavior unchanged).

- 02f6af4: ADR-0090 follow-through wave: enforce book audience at the read layer; finish the D2/D3 cleanup the P1 rename missed.

  - **rest**: `/meta/book`, `/meta/doc`, and `/meta/book/:name/tree` now ENFORCE
    the ADR-0046 §6.7 audience model (ADR-0049 — no unenforced security
    properties): anonymous callers see only `public` books/docs;
    `{ permissionSet }`-gated books require the caller to hold the named set;
    a doc's effective audience is the union over the books that CLAIM it
    (unclaimed docs default to `org`; orphan rendering never inherits `public`).
    Gated evaluation fails CLOSED when holdings cannot be resolved. `doc`/`book`
    single-item reads bypass the shared meta cache (per-caller gate vs shared ETag).
  - **spec**: new pure helpers powering that gate — `audienceAllows`,
    `resolveDocAudiences`, `docAudienceAllows`, `resolveBookClaimedDocs`
    (+ `AudienceCaller`/`AudienceBook` types). BREAKING but ships as a `minor`
    per the launch-window convention (pre-1.0 semantics — breaking changes do
    not burn a major version number while the whole stack is in lockstep):
    `METADATA_FORM_REGISTRY` keys `role`/`profile` are gone — `position` is the
    registered form (the `position` type had LOST its form layout in the P1
    rename); `EnvironmentArtifactMetadataSchema` declares `positions` instead of
    retired `roles`/`profiles`.
  - **plugin-security**: the `security` service exposes
    `resolvePermissionSetNames(ctx)` — the same resolution as data-plane
    enforcement, for the docs gate.
  - **metadata**: artifact ingestion maps `positions → 'position'` (the stale
    `roles → 'role'` mapping matched nothing since the P1 rename, silently
    dropping compiled positions from metadata registration).
  - **lint**: books join the D3 role-word scan (their `audience` is a
    permission-model reference now), and a new advisory rule
    `security-book-audience-unknown-set` flags a `{ permissionSet }` audience
    naming a set the stack does not declare (runtime fails closed — the typo
    cost is "nobody can read the book", so say it at author time).
  - **platform-objects**: metadata-form translations regain `position` (all four
    locales) and drop the retired `role`/`profile` groups, with a vocabulary
    regression test.

- bea4b92: feat(rest): colour select/radio cells in xlsx exports with their option colour

  The data export route (`GET /data/:object/export`) now carries a select /
  radio field's option `color` into the generated Excel workbook as the cell's
  **font colour** (white cell background), so an exported sheet reads like the
  in-app coloured badges instead of plain black text. csv / json output is
  unchanged.

  - `export-format.ts` gains `toArgb()` (hex `#RGB` / `#RRGGBB` → exceljs ARGB
    `FFRRGGBB`, `undefined` for anything not plain hex) and `cellFontColor()`
    (resolves the matched select/radio option's colour for one cell; returns
    `undefined` — i.e. leave it unstyled — for non-option fields, unmatched
    values, colourless options, or invalid hex). `ExportFieldMeta.options` now
    carries the option `color`.
  - `createXlsxStream(res, useStyles)` takes the flag through to exceljs'
    `WorkbookWriter`; the route enables styling and sets `cell.font.color`
    per-cell only for xlsx.

  Styling is heavier than a bare value dump, so it is gated behind a **10 000-row
  cap** (`STYLE_ROW_CAP`): exports whose effective limit exceeds it stream
  without colours (all rows intact) and set `X-Export-Styles: dropped`; coloured
  exports set `X-Export-Styles: applied`. This mirrors the "formatted export has a
  lower ceiling than a raw dump" pattern used by Salesforce / ServiceNow. The
  existing 50 000-row hard cap is unchanged.

  Closes #2757.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/service-package@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/service-package@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/service-package@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Minor Changes

- ac08698: ADR-0090 D6 — the explain engine gets its REST face (#2696).

  **`@objectstack/rest`**: new `GET/POST /api/v1/security/explain`
  (`object`/`operation`/`userId`, validated against the spec's
  `ExplainRequestSchema`) delegating to the `security` service's
  `explain(request, callerContext)` — the same code paths the enforcement
  middleware runs, so the returned `ExplainDecision` is explained by
  construction. The route is authenticated-only (401 even on
  `requireAuth=false` deployments), returns 501 when no security service
  exposes `explain`, and maps the service's `PermissionDeniedError` to 403.
  Registered on scoped (`/environments/:environmentId`) and unscoped base
  paths; the env kernel's own `security` service is preferred, with a new
  host-kernel `securityServiceProvider` fallback wired by the REST plugin.

  **`@objectstack/plugin-security`**: `explainAccessForCaller` now honors
  delegated administration (D12) — explaining ANOTHER user is authorized by
  `manage_users` **or** a delegated `adminScope` whose business-unit subtree
  covers the target user (new `DelegatedAdminGate.scopesCoverUser`, fail-closed
  on unresolvable scopes/memberships). Self-explain still needs neither.

- bd39dc5: ADR-0090 D5/D9 — suggested audience bindings become a queryable, confirmable surface.

  A package permission set declaring `isDefault: true` is an install-time
  SUGGESTION to bind the set to the built-in `everyone` position — never
  auto-bound. Until now the flag was only read at bootstrap as the fallback-set
  name; after an install there was no way to see or act on the suggestion.

  **`@objectstack/plugin-security`**: new `sys_audience_binding_suggestion`
  system object (read-only over the data API; unique per
  package × set × anchor) plus a convergent reconciler
  (`syncAudienceBindingSuggestions`) that reads every declared `isDefault` set —
  boot-declared stack metadata AND installed package manifests, so a runtime
  `POST /api/v1/packages` install is visible immediately — and keeps the table
  honest: undeclared → pending row pruned, bound out-of-band → marked
  `confirmed` (observed). The `security` service gains
  `listAudienceBindingSuggestions` / `confirmAudienceBindingSuggestion` /
  `dismissAudienceBindingSuggestion`, all pre-gated on tenant-level admin
  (ADR-0066 superuser wildcard — anchors stay tenant-level only per D12).
  Confirm writes the `sys_position_permission_set` row **with the caller's
  execution context**, so the D5/D9 audience-anchor gate (no high-privilege
  set on `everyone`/`guest`) and the D12 delegated-admin gate enforce the
  binding; a set not yet materialized (installed this session) is first
  seeded through the same provenance-checked upsert as the boot seeder
  (ADR-0086 D4).

  **`@objectstack/rest`** and **`@objectstack/runtime`**: the HTTP surface,
  registered on both API layers (the RestServer that `objectstack dev`/hono
  serves, and the runtime HttpDispatcher used by the adapters) —
  `GET /api/v1/security/suggested-bindings?status=&packageId=`,
  `POST /api/v1/security/suggested-bindings/:id/confirm`,
  `POST /api/v1/security/suggested-bindings/:id/dismiss` (401 unauthenticated,
  403/404/409 mapped from the service's typed errors, 501/503 without
  plugin-security).

### Patch Changes

- e2fa074: feat(data): make object `enable.feeds`/`enable.activities` real opt-out gates; define the `enable.trackHistory` contract (#2707)

  `ObjectSchema.enable.{files,trackHistory,activities,feeds}` were parsed but
  (mostly) unconsumed — an author setting them got nothing, silently. Per the
  enforce-or-remove doctrine, each flag now has a defined enforcement contract:

  - `enable.activities` — opt-OUT writer gate. Spec default flips
    `false → true`; plugin-audit keeps mirroring CRUD into the `sys_activity`
    timeline unless the object declares an explicit `activities: false`
    (behavior-preserving for every existing stack; the off-switch is the
    per-object lever for activity-row growth, ADR-0057). The compliance
    `sys_audit_log` row is NOT gated.
  - `enable.feeds` — opt-OUT with server-side enforcement. Spec default flips
    `false → true`; an explicit `feeds: false` now rejects `sys_comment`
    creation targeting that object at the engine hook seam
    (403 `FEEDS_DISABLED`, fail-closed like `CLONE_DISABLED`).
  - `enable.trackHistory` — was misclassified `dead` in the liveness ledger:
    the console has gated the record History tab on it since 2026-05.
    Reclassified live with the two-grain contract documented (object flag =
    History-tab master switch; per-field `trackHistory` = diff selector; audit
    _capture_ stays unconditional as a compliance ledger).
  - `enable.files` — stays dead + authorWarn (reserved for the future generic
    Attachments panel; use `Field.file`/`Field.image` meanwhile). Its
    `describe()` now says so instead of advertising a capability that
    doesn't exist.

  The default flips can't be avoided: with `default(false)`, compiled output
  materializes `false` for every object with an `enable` block, making
  "author explicitly opted out" indistinguishable from "schema default" — so
  opt-out semantics require the default to be `true` (same posture as
  `trash`/`mru`/`clone`). Liveness ledger + reference docs regenerated;
  compile-time authorWarn now fires only for `enable.files`.

- 23c8668: feat(data): `enable.files` goes live — opt-in gate for the generic Attachments surface (#2727)

  The last dead ObjectCapabilities flag gets its enforcement contract.
  `enable.files` is opt-IN (spec default stays `false`): the generic record
  Attachments panel is a new surface, not an existing behavior.

  - plugin-audit registers a `sys_attachment` beforeInsert hook: attachment
    join rows may only target objects that explicitly declare
    `enable: { files: true }` — anything else (absent block, absent flag,
    explicit false, unknown object) rejects fail-closed with
    403 `FILES_DISABLED` (CLONE_DISABLED / FEEDS_DISABLED pattern).
  - `mapDataError` maps `FILES_DISABLED` → 403 with the gated target object
    (generic data routes bypass `sendError`'s `.status` passthrough — the
    #2707 lesson, applied at introduction time).
  - `Field.file` / `Field.image` are deliberately independent: they store
    the file URL in the record's own column and never create
    `sys_attachment` rows, so field-level attachments work regardless of
    this flag.
  - Liveness ledger: `enable.files` dead→live, authorWarn dropped —
    ObjectCapabilities is now 100% live. The compile-time
    liveness-dead-property warning no longer fires for it; `describe()` and
    the reference docs state the real contract.

  Companion objectui PR ships `RecordAttachmentsPanel` (upload/list/
  download/delete over the presigned three-step storage flow), rendered on
  record pages when the flag is true.

- 1056c5f: Package uninstall now revokes the package's data-plane permission rows (#2747, ADR-0086 D3 / ADR-0090 D5 "no ghost grants").

  **`@objectstack/metadata-protocol`**: `deletePackage` gains an
  uninstall-cleanup seam — the exact mirror of the publish materializer:
  domain plugins register named cleanups via `registerUninstallCleanup(name,
fn)` and every cleanup runs with the uninstalled package id, its outcome
  reported on the new `cleanups` array of the response (a failed revocation is
  visible, never silent). `deletePackage` also unregisters the package from
  the in-memory SchemaRegistry (best-effort), so the running kernel stops
  serving it without waiting for a restart.

  **`@objectstack/plugin-security`**: registers the
  `security.package-permissions` cleanup — deletes the package's own
  `sys_permission_set` rows (`managed_by: 'package'` + matching `package_id`
  only; env-authored and foreign-package rows are never touched, ADR-0086 D4),
  their `sys_position_permission_set` / `sys_user_permission_set` bindings
  (bindings first, so no dangling grants), and the package's
  `sys_audience_binding_suggestion` rows (a reinstall re-prompts fresh).
  Also fixes the engine-call signature in the suggestion module: `find`/`delete`
  read `context` from their second argument — the previous trailing
  `{ context }` argument was ignored, so deletes ran principal-less.

  **`@objectstack/rest`**: `DELETE /api/v1/packages/:id` (no version pin) now
  goes through `protocol.deletePackage` — one uninstall semantic instead of a
  bare `sys_packages` row delete — removing the package's metadata, durable
  record, registry entry, and running the cleanups; the response carries
  `deletedCount` + `cleanups`. A version-scoped delete keeps the narrow
  durable-registry semantics.

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/service-package@14.0.0
  - @objectstack/types@14.0.0

## 13.0.0

### Major Changes

- 6d83431: ADR-0090 P1 breaking wave — permission model v2 concept convergence.

  Pre-launch one-step renames and secure defaults (no compatibility aliases, per
  ADR-0090 D3/D4 superseding ADR-0057 D5/D7's alias discipline):

  - `sys_role` → `sys_position`, `sys_user_role` → `sys_user_position` (field
    `role` → `position`), `sys_role_permission_set` → `sys_position_permission_set`
    (field `role_id` → `position_id`); `RoleSchema`/`defineRole` →
    `PositionSchema`/`definePosition` with **no `parent`** (positions are flat;
    hierarchy lives on the business-unit tree).
  - `ExecutionContext.roles[]` → `positions[]`; the EvalUser/CEL contract
    `current_user.roles` → `current_user.positions` (formula validators updated);
    stack property `roles:` → `positions:`; metadata kinds `role`/`profile` →
    `position` (profile kind removed).
  - `isProfile` removed from `PermissionSetSchema` (ADR-0090 D2); `isDefault`
    narrows to an install-time suggestion; `appDefaultProfileName` →
    `appDefaultPermissionSetName` (isDefault-only).
  - OWD enum drops legacy aliases `read`/`read_write`/`full`; new optional
    `externalSharingModel` (external dial, `private` default) lands as P1 spec
    shape (ADR-0090 D11).
  - **Secure default (D1)**: a custom object with an owner field and NO
    `sharingModel` now resolves `private` (was: fully public). System objects
    keep their explicit posture. Unrecognised stored values fail closed.
  - ExecutionContext gains the P1 principal-taxonomy shape (D10):
    `principalKind` / `audience` / `onBehalfOf` (optional, semantics phase in
    later).
  - Sharing recipients: `role` → `position` (expanded via `sys_user_position`
    ∪ the better-auth membership transition source); `role_and_subordinates`
    removed — `unit_and_subordinates` now expands the business-unit subtree
    (finishes ADR-0057 D5's re-homing).

### Minor Changes

- 57b89b4: feat(mcp): the MCP surface is now **default-on** — a core platform capability (#2698)

  `/api/v1/mcp` is served (and advertised in `/discovery`) out of the box; the
  OAuth 2.1 authorization track and Dynamic Client Registration follow it, so a
  fresh deployment is connectable by any MCP client with zero configuration.
  Operators opt OUT with `OS_MCP_SERVER_ENABLED=false`.

  - New single decision point `isMcpServerEnabled()` in `@objectstack/types`
    (default on; explicit `false`/`0`/`off`/`no` disables). The runtime
    dispatcher's `/mcp` route gate, the CLI's MCP plugin auto-load, the REST
    `/discovery` advertisement, and the auth service's OAuth/DCR follow-defaults
    all delegate to it — the served route, the advertised route, and the
    authorization track can never disagree.
  - The env var is now effectively tri-state: unset → HTTP surface on;
    explicit `true` → additionally auto-start the long-lived **stdio** transport
    at boot (unchanged, still opt-in — a default must not claim the process's
    stdin/stdout); explicit `false` → everything off, fail-closed (404, no
    metadata, no DCR).
  - The OAuth 2.1 TLS rule is unaffected: on a plain-HTTP non-loopback origin
    the OAuth track stays dark and the default-on surface remains API-key-only.

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [57b89b4]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/platform-objects@13.0.0
  - @objectstack/types@13.0.0
  - @objectstack/service-package@13.0.0

## 12.6.0

### Minor Changes

- 21420d9: Seed loader and data-import now route bulk writes through the engine's array-form `insert()` (one round-trip per batch, with parent-deduplicated summary recompute) instead of one `insert()`/`createData()` call per record, and both retry transient driver errors instead of silently dropping the row (#2678).

  A new shared helper, `bulkWrite` (`@objectstack/core`), batches rows through a caller-supplied batch-write function, retries a whole-batch transient failure (network blip / timeout) with exponential backoff, and degrades to per-row writes (each itself retried) when a batch fails for a non-transient reason — so one bad row can't drop the other N-1. `withTransientRetry` wraps a single write (e.g. an update) with the same retry behavior.

  - `SeedLoaderService.loadDataset()` (`@objectstack/metadata-protocol`) buffers insert-mode records and flushes them in batches of 200 via the engine's array `insert()`. Datasets with a self-referencing field (e.g. `employee.manager_id -> employee`) keep the historical per-record write path, since a later record may need an earlier one's freshly-assigned id.
  - `runImport()` (`@objectstack/rest`) buffers create-resolved rows and flushes them via `protocol.createManyData()` when the protocol supports it, falling back to the original per-row `createData()` call otherwise. `Protocol.createManyData` (`@objectstack/metadata-protocol`) now forwards `context` to `engine.insert()` like `createData` already did, so tenant-scoped bulk creates work correctly.

  Previously, a 1000-row seed or import into an object with a rollup summary issued 1000+ round-trips and up to 1000 summary recomputes; a single transient network error on any one row silently dropped it with no retry (the 2026-07-06 HotCRM first-boot incident). A `bulkCreate`-capable driver now sees roughly `ceil(N/batch)` writes, and a transient error is retried before a row is ever reported as failed.

  **Fix (`@objectstack/driver-sql`):** `SqlDriver.bulkCreate()` never generated a client-side id for a row missing one, unlike `create()` — a latent gap that this change is the first to exercise at scale (a bulk-inserted row without a driver-native id default silently landed with `id: NULL`). `bulkCreate()` now mirrors `create()`'s id/`_id` normalization per row.

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/service-package@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/service-package@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/service-package@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/service-package@12.3.0

## 12.2.0

### Minor Changes

- fce8ff4: feat(rest,spec): named import mappings (#2611) — `POST /data/:object/import` accepts `mappingName`, resolving a registered `defineMapping` artifact (stack `mappings:`) and applying its fieldMapping pipeline (rename + constant/map/split/join; lookup delegates to the built-in reference resolution) as a strict projection before coercion. The artifact's `mode`/`upsertKey` serve as writeMode/matchFields defaults; explicit request values win. Errors are loud and specific: `MAPPING_NOT_FOUND`, `MAPPING_TARGET_MISMATCH`, `MAPPING_FORMAT_MISMATCH`, `CONFLICTING_MAPPING` (mutually exclusive with the inline rename), and `UNSUPPORTED_TRANSFORM` for `javascript` (no server-side sandbox — never silently skipped). `defineStack` cross-reference validation now rejects mappings targeting undefined objects and `javascript` transforms at build time.

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/platform-objects@12.2.0
  - @objectstack/service-package@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/service-package@12.1.0

## 12.0.0

### Major Changes

- 7c09621: feat(security)!: `api.requireAuth` now defaults to `true` — anonymous access to the data API is denied by default (ADR-0056 D2 flip)

  **BREAKING.** The global `requireAuth` default flipped FROM `false` TO `true`
  (`RestApiConfigSchema.requireAuth` in `@objectstack/spec`, mirrored by
  `RestServer.normalizeConfig` in `@objectstack/rest`). Anonymous requests to
  the `/data/*` CRUD + batch endpoints are now rejected with HTTP 401 unless the
  deployment explicitly opts out. (Scope note: this gate covers the REST
  `/data/*` surface — the metadata read/write endpoints and the dispatcher
  GraphQL route have their own pre-existing anonymous posture, tracked
  separately; this flip does not change them.)

  **Migration (one line):** a deployment that intentionally serves data publicly
  (demo / playground / kiosk) sets the flag on the stack config — now a declared
  `ObjectStackDefinitionSchema.api` field, so it survives `defineStack` strict
  parsing (previously an undeclared top-level `api` key was silently stripped):

  ```ts
  export default defineStack({
    // …
    api: { requireAuth: false },
  });
  ```

  The REST plugin logs a boot warning for the explicit opt-out so a fail-open
  posture is always visible. A misplaced `api.requireAuth` at the plugin level
  (one nesting short) is now also called out with a boot warning instead of
  being silently ignored.

  **What keeps working with no action:**

  - **Share links** — validate their token, then read under a system context.
  - **Public forms** — self-authorizing via the declaration-derived
    `publicFormGrant` (create + read-back on the declared target object only);
    no `guest_portal` profile needed.
  - **Control plane** — `/auth`, `/health`, `/discovery` are exempt.
  - **`objectstack serve` with an auth-less stack** — the CLI passes an explicit
    `requireAuth: false` for stacks whose tier set has no `auth` (nothing could
    authenticate against them), with the boot warning.

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/service-package@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/service-package@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/service-package@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/service-package@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/service-package@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/platform-objects@11.6.0
- @objectstack/service-package@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/service-package@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/service-package@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/service-package@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/service-package@11.2.0

## 11.1.0

### Minor Changes

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

### Patch Changes

- 9ccfcd6: perf(core): authenticated requests issued ~16 sequential queries — duplicate authz + repeated localization — now request-scoped memoized

  An authenticated REST request resolves its execution context (identity +
  RBAC/RLS + localization) many times in a single handler — the data operation
  itself, app-nav RBAC filtering, dashboard widget gating, the ADR-0069 auth gate.
  Each `resolveExecCtx` pass is the full `resolveAuthzContext` aggregation plus the
  localization read (~16 sequential queries), and nothing memoized it, so a request
  that resolves twice paid for duplicate authz and repeated localization.

  - **`@objectstack/rest`** — `resolveExecCtx` is now memoized per request, keyed by
    the request object (a `WeakMap`, so the entry is collected with the request — no
    TTL, no cross-request leak) and the input `environmentId`. The in-flight Promise
    is cached so concurrent callers share one resolution. The heavy path moved to
    `computeExecCtx`. Anonymous (`undefined`) resolutions are cached too.
  - **`@objectstack/core`** — within a single `resolveAuthzContext` pass, `sys_user`
    is now read at most once (the email fallback and the `ai_seat` synthesis shared a
    duplicate query on the API-key path); `resolveLocalizationContext`'s direct-read
    fallback batches `timezone`/`locale`/`currency` into one `sys_setting` query
    (`$in` on `key`) instead of three sequential reads.

  No authorization-behavior change — the same roles/permissions/RLS context is
  resolved, just without the redundant reads. The `sys_member` reads (per-user roles
  vs. all-org-members) are intentionally left distinct (different filters/limits).

  Tests: query-counting regressions assert `sys_user` reads once and localization
  reads once; new rest-server tests pin the per-request/per-environment memo contract.

- Updated dependencies [ce0b4f6]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/service-package@11.1.0

## 11.0.0

### Patch Changes

- 359c0aa: fix(objectql,rest): single-item meta reads must revalidate (no `max-age=3600`)

  `GET /api/v1/meta/object/:name` (and the other single-item meta reads served by
  the cached path) sent `Cache-Control: public, max-age, max-age=3600`. Two bugs:

  1. **Stale metadata for up to an hour.** Object metadata is invalidated by
     publish, but a one-hour TTL let browsers (and any CDN/proxy) serve a stale
     schema _without revalidating_ — e.g. the AI-build "New" create form kept
     rendering pre-publish fields until the TTL lapsed. The list endpoint
     `GET /api/v1/meta/object` is uncached, which is why list views updated but
     single-object reads didn't. `getMetaItemCached` now returns
     `directives: ['private', 'no-cache']` with no `maxAge`, so the ETag validator
     (which already changes on publish) gates freshness: a cheap `304` when
     unchanged, fresh fields the instant a publish bumps the ETag. `private` also
     keeps per-tenant metadata out of shared caches.

  2. **Malformed header.** The directives array carried a bare `max-age`
     placeholder _and_ the REST layer appended `max-age=3600` from the `maxAge`
     field, concatenating into `public, max-age, max-age=3600`. The header builder
     now strips the bare `max-age` token before appending the real value, so a
     `maxAge` is emitted once as a well-formed `max-age=N`.

- 9a810f8: fix(rest): register static data-action routes before the greedy `:object/:id` matcher

  The REST router matches first-registered-wins with no specificity sorting, but
  `registerDataActionEndpoints` (which holds `GET /data/:object/export`) ran AFTER
  `registerCrudEndpoints` (which holds the greedy `GET /data/:object/:id`). A
  request to `GET /data/<object>/export` was therefore captured by `:object/:id` —
  `"export"` treated as a record id — returning `404 RECORD_NOT_FOUND` instead of
  streaming the export. The data-action registration now runs first, mirroring the
  existing `/meta/:type/:name/references`-before-`/meta/:type/:name` convention.
  Reordering is safe both ways: `registerDataActionEndpoints` contains no greedy
  2-segment `:object/:id` routes, so it cannot shadow any CRUD literal. A
  regression test asserts the export route registers ahead of the get-by-id route.

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- aa33b02: fix(security): single-source the request authorization resolver — REST no longer drops sys_user_position

  The REST server and the runtime dispatcher each carried their own copy of the request → ExecutionContext identity/role resolver, and they drifted on a security path. The REST copy silently omitted `sys_user_position` (so custom roles granted via the ADR-0057 D4 platform-RBAC path did not apply over REST), `sys_position_permission_set`, the `owner→org_owner` membership normalization, the platform-admin derivation, and the `ai_seat` synthesis — fail-closed (legitimate access denied), not an escalation.

  Both entry points now delegate to a single shared resolver, `resolveAuthzContext` in `@objectstack/core/security` (joining the API-key verifier that already lived there). A contract test locks every authorization source and a lint gate (`check:authz-resolver`) prevents a future duplicate resolver or a dropped delegation.

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
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/spec@11.0.0
  - @objectstack/core@11.0.0
  - @objectstack/service-package@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/service-package@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/service-package@10.2.0

## 10.1.0

### Patch Changes

- 517dad9: Schema drift detection + `os migrate` for non-additive metadata changes (#2186).

  The metadata→DB schema sync was additive-only: it created tables and added
  columns but never altered/dropped existing ones, so relaxing `required`,
  changing a type/length, or dropping a field silently diverged from an existing
  database. The physical column won at write time, surfacing a misleading
  `organization_id is required` 400 even though `/meta` reported the field
  optional.

  - **driver-sql** — the SQL driver now detects managed-schema drift (metadata is
    the source of truth) and categorises each divergence `safe` / `needs_confirm`
    / `destructive`. `initObjects` warns once per divergence with an actionable
    hint. A new opt-in `SqlDriverConfig.autoMigrate: 'safe'` auto-applies the
    _loosening_ subset (relax `NOT NULL`, widen varchar) so an existing dev DB
    self-heals on restart — never destructive, force-disabled under
    `NODE_ENV=production`. New public methods `detectManagedDrift()` /
    `applyMigrationEntries()`. SQLite reconciles via the official table-rebuild
    (copy → swap), preserving data; Postgres/MySQL alter in place.
  - **cli** — new `os migrate plan` (dry-run, categorised diff) and
    `os migrate apply` (`--allow-destructive` for drops/tightenings, confirm gate,
    `--json`). `os dev`/`serve` now pass `autoMigrate: 'safe'` in dev only.
  - **rest** — a `NOT NULL` violation that reaches the driver (metadata validation
    already passed) now carries a drift-aware `hint` pointing at `os migrate`,
    instead of only the misleading "field is required" message. The
    `VALIDATION_FAILED` / `fields` envelope is unchanged for back-compat.

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/service-package@10.1.0

## 10.0.0

### Minor Changes

- 2256e93: Setup nav: gate Organizations/Invitations on multi-org; enforce `requiresService` server-side (ADR-0057 addendum D10).

  `rest-server`'s `filterAppForUser` now honours `NavigationItem.requiresService` — entries
  whose named kernel service isn't registered are dropped from the served app metadata
  (fail-open when the kernel can't be probed; previously the field was a frontend-only hint).
  Applies `requiresService: 'org-scoping'` to the Setup app's Organizations and Invitations
  entries, so they surface only in multi-org (multi-tenant) deployments and disappear in
  single-tenant. Business Units is intentionally left ungated — it is open per the open/paid
  seam + D12 ("pick people by BU"); only the hierarchy rollup capability is enterprise.

- 220ce5b: Resolve the tenant default currency onto ExecutionContext.

  Adds `ExecutionContext.currency` (ISO 4217) and resolves it from the
  `localization.currency` setting alongside `timezone`/`locale` — in both the
  runtime `resolveExecutionContext` and the REST mirror. This is the foundation
  for the documented "applied when a currency field omits its own" fallback: the
  tenant default is now carried on every request context, so analytics enrichment,
  formatters, and renderers can resolve a measure/field currency down to the org
  default instead of hard-coding it. Undefined when no tenant default is
  configured (consumers then render a plain number).

### Patch Changes

- 3754f80: Fix: the Setup-nav capability gate (`requiresService`, ADR-0057 D10) was a no-op on the single-item app-meta path.

  `GET /meta/app/:name` returns a metadata envelope `{ type, name, item: <app>, ... }`, but
  `filterAppForUser` was applied to the envelope — whose `.navigation` is undefined — so it
  returned it untouched, silently bypassing BOTH the `requiredPermissions` gate and the D10
  `requiresService` gate. Organizations/Invitations therefore still appeared in the Setup app
  even in single-tenant deployments. `filterAppForUser` and `resolveRegisteredServices` now
  unwrap the envelope (the list path already passed the raw app). Verified against a live
  `os dev`: single-tenant hides Organizations/Invitations; multi-tenant shows them.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [e16f2a8]
- Updated dependencies [e411a82]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
  - @objectstack/spec@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/service-package@10.0.0

## 9.11.0

### Patch Changes

- e7f6539: feat(rest): warn on fail-open anonymous posture (ADR-0056 D2, warn→enforce)

  Secure-by-default work for the data API. The deny capability already exists
  (`api.requireAuth=true` rejects anonymous via `enforceAuth`, and share-link /
  `guest_portal` / control-plane routes are exempt) — but the **default is fail-open**
  (`requireAuth=false`), so an object with no OWD/RLS is world-readable with no signal.
  This adds a boot-time WARN when running in that posture, making it explicit
  (consistent with D4/D8 honesty). The global default is deliberately NOT flipped here
  — that is a release-gated decision; flipping it would 401 deployments that rely on
  anonymous reads. Proven by the `showcase-anonymous-deny` dogfood test (anonymous
  read+write → 401, authenticated → 200, control-plane open).

- 751f5cf: feat(security): declaration-derived public-form authorization (ADR-0056, Option A)

  Public form submissions are now authorized by the **declaration**, not by a
  deployment-configured `guest_portal` profile. The form-submit route derives a narrow
  `publicFormGrant: { object }` from the matched form's target object; the SecurityPlugin
  honors it as a least-privilege capability — **create + the immediate read-back on THAT
  object only**, with no userId, and crucially NOT the anonymous fall-open. This makes
  public forms work under secure-by-default (`requireAuth`) **without** a hand-configured
  `guest_portal`, scoped to exactly the declared object (the field allow-list is still
  enforced at the route; `guest_portal`/`anonymous` are kept on the context for back-compat
  with guest-detection hooks). It is the prerequisite that unblocks the eventual
  `requireAuth` default flip, and generalizes the platform principle "public access =
  declared + runtime-derived scoped grant" (the same shape share-links already use).
  Proven by `form-self-auth` dogfood (create on target allowed; cross-object + update/delete
  denied). plugin-security 108, rest 121, full dogfood 98 — no regression.

- 2afb612: feat(security): resolve `current_user.email` in RLS owner policies

  RLS `using` predicates can now reference **`current_user.email`** — a unique,
  human-readable, _seedable_ owner anchor (`owner = current_user.email`). Previously
  the RLS compiler resolved only `current_user.id` / `organization_id` / `roles` /
  `org_user_ids`, so any owner-by-name/email predicate silently compiled to the
  deny sentinel (fail-closed → the user saw nothing). Email is sourced for free
  from the auth session (with a bounded `sys_user` fallback for the API-key path)
  and threaded onto the `ExecutionContext` in both identity resolvers — the REST
  data path (`rest-server`) and the dispatcher path (`resolve-execution-context`).

  Display `name` is deliberately **not** exposed to RLS: names collide, and a
  collision on an ownership predicate is an access-control leak. Only unique
  identifiers (`id`, `email`) are resolvable.

  This makes owner-scoped row-level security work with seed data (no per-user ids
  needed) and, combined with `controlled_by_parent` (ADR-0055), lets a master's
  owner scoping flow to its detail records. The example-showcase demonstrates it:
  `showcase_invoice` carries an `owner` email + an owner RLS policy, its lines are
  controlled-by-parent, and invoices/lines are seeded per owner. It also fixes the
  showcase's previously inert owner predicates (they used `==` and `current_user.name`,
  neither of which the compiler accepts) to `= current_user.email`.

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/service-package@9.11.0

## 9.10.0

### Patch Changes

- fd07027: fix(analytics): make organization timezone actually drive date-dimension bucketing (ADR-0053 Phase 2, #1982)

  Date-bucketed analytics silently ignored the reference timezone end-to-end. Three independent seams were broken:

  - **service-analytics** — `NativeSQLStrategy` (priority 10) won every cube/dataset query on a SQL driver, but it groups by the raw column (no `date_trunc`) and ignores `timezone`, so a date dimension never bucketed (one row per raw timestamp) and a non-UTC zone was dropped. It now declines queries that carry a `timeDimensions[].granularity`, handing them to `ObjectQLStrategy` → `engine.aggregate` (native bucketing when UTC-safe, uniform in-memory bucketing when non-UTC).
  - **objectql** — the in-memory `count` aggregation treated the `*` count-all sentinel (the Cube `count` measure / a fieldless dataset `count`, both compiled to `sql: '*'`) as a column name, counting non-null of a non-existent property → `0` for every bucket. The driver's `COUNT(*)` masked it; the in-memory path (non-UTC date buckets, `driver-rest`/`driver-memory`) returned zeros. `*` is now counted as all rows.
  - **rest** — `resolveExecCtx` never resolved the localization timezone/locale, so `/analytics/dataset/query` always ran with `timezone: 'UTC'`. It now resolves them through the `settings` service (honouring the 4-tier cascade incl. the `OS_LOCALIZATION_TIMEZONE` env override), mirroring the dispatcher path.

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/service-package@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/service-package@9.9.1

## 9.9.0

### Minor Changes

- 44c5348: fix: two runtime gaps found by driving the CRM example end-to-end.

  **Delete of a parent with a required-FK child no longer fails with a misleading "<field> is required" error.** `cascadeDeleteRelations` defaulted a `lookup` FK to `set_null`; for a _required_ FK that issued an UPDATE clearing the column, which the child's validator rejected with a `400 "<field> is required"` naming a field that isn't even on the object being deleted (e.g. deleting a `crm_account` with opportunities → `"account is required"`). A required FK can't be nulled, so a _defaulted_ `set_null` now escalates to `restrict`: the delete is refused with a clear `409 DELETE_RESTRICTED` carrying the dependent object + count (`"Cannot delete crm_account (…): 4 dependent crm_opportunity record(s) reference it via account … set deleteBehavior:'cascade'"`). Explicit `cascade`/`restrict` and optional (nullable) lookups are unchanged.

  **Removed the hardcoded `POST /data/lead/:id/convert` endpoint + `convertLead` protocol method.** It hardcoded bare object names (`lead`/`account`/`contact`/`opportunity`) and a fixed Salesforce field mapping into the framework runtime, so it was unreachable by any real (namespaced) app — `/data/crm_lead/:id/convert` 404s, and the literal `lead` object doesn't exist. Lead conversion is an app concern modeled correctly as a flow (the CRM ships a `crm_convert_lead_wizard` screen flow); baking a CRM-specific workflow into the framework was false surface. Untested, undocumented, unused by the example. Removed.

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
  - @objectstack/core@9.9.0
  - @objectstack/service-package@9.9.0

## 9.8.0

### Minor Changes

- 7fe0b91: feat(rest): enforce object-level API exposure (`enable.apiEnabled` / `enable.apiMethods`) on the REST data surface (ADR-0049 #1889). Previously these flags were parsed but unenforced — an object could not be hidden from the automatic API, a false sense of security. Now: `apiEnabled: false` → the object's `/api/v1/data/{object}` routes return 404 (existence not revealed); a non-empty `apiMethods` whitelist → operations outside it return 405. Enforced across list/get/create/query/update/delete/import/export/batch/createMany/updateMany/deleteMany. Default-allow (objects with no `enable` block, or `apiEnabled` unset/true and no `apiMethods`) behave exactly as before — no regression. This is the _external_ API boundary only; internal callers (hooks, flows, objectql) are unaffected.
- 884bf2f: feat: record clone — wire the `object.enable.clone` capability to a real runtime (previously a parsed-but-dead flag).

  - **objectql**: new `protocol.cloneData({ object, id, overrides?, context? })` — reads the source record, drops engine-owned columns (`id` + audit `created_at`/`created_by`/`updated_at`/`updated_by`, plus `system`-flagged, `autonumber`, `formula` and `summary` fields) so the insert path re-derives them, applies caller `overrides` last, and inserts the copy. Shallow by design (duplicates the record's own fields, not its child records). Gated by `schema.enable.clone`: default-on, an explicit `enable.clone === false` throws `403 CLONE_DISABLED`.
  - **rest**: new `POST /api/v1/data/:object/:id/clone` (201 → `{ object, id, sourceId, record }`). Optional body `{ overrides }` (or a bare field map) overrides copied values, e.g. a new `name` or a cleared unique field. Honors the same auth + `enable.apiEnabled`/`apiMethods` gates as the rest of the data surface; `enable.clone === false` → 403.

  Reclassifies `object.enable.clone` `dead → live` in the spec liveness ledger.

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/service-package@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/service-package@9.7.0

## 9.6.0

### Minor Changes

- 71578f2: feat(book): documentation navigation as a `book` element — spine + derived membership (ADR-0046 §6)

  Adds the `book` metadata element: a navigation **spine** (ordered groups + `audience` + identity) whose membership is **derived** by rule (`include` glob/tag) plus optional per-doc `order`/`group`, never a central array. This keeps AI authoring create-and-forget (no central-array read-modify-write) and runtime overlay merge-safe (RFC 7396 treats arrays atomically).

  - `BookSchema` + `resolveBookTree()` derived-membership resolver + `defineBook()` + additive `doc.order`/`doc.group`.
  - Register `book` as a render-time metadata type (`allowOrgOverride: true`); wire it through the runtime type enumerations (PLURAL_TO_SINGULAR, engine registration, artifact field map, type-schema map).
  - REST `GET /meta/book/:name/tree` resolves the tree; read-layer `audience` gating (`public` ≡ anonymous; `org`/`{profile}` require sign-in).

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/service-package@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/service-package@9.5.1

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

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/service-package@9.5.0

## 9.4.0

### Minor Changes

- 0856476: feat(metadata): package-scoped single-item resolution via `?package=` (ADR-0048)

  A single-item metadata GET (`/meta/:type/:name?package=<id>`) now resolves
  package-scoped (prefer-local): when two installed packages ship an item of the
  same `type`/`name`, the requester's own package wins. Previously only the _list_
  endpoint was package-aware; a single-item fetch was context-free, so a
  cross-package collision always resolved to whichever package registered first.

  The fix threads `packageId` end-to-end:

  - `@objectstack/rest` — the cacheable single-item path called `getMetaItemCached`
    (ETag keyed on type+name only) and dropped `?package=`. A `?package=` read now
    bypasses that cache and takes the disambiguating `getMetaItem(type, name,
packageId)` path, so two same-named items never share one cache entry.
  - `@objectstack/objectql` — `protocol.getMetaItem` forwards `packageId` to the
    overlay query (`sys_metadata.package_id`), `MetadataFacade.get`, and
    `registry.getItem`; `MetadataFacade.get` gained an optional `currentPackageId`.
  - `@objectstack/runtime` — the parallel HTTP dispatcher threads `?package=` too.

  This lets the doc viewer (`/apps/:packageId/docs/:name`) resolve one doc scoped
  to its app, so `doc` names no longer need a namespace prefix for uniqueness (the
  prefix becomes a recommended convention, like `page`/`dashboard`/`report`);
  `doc.zod` doc-comments updated accordingly.

### Patch Changes

- 3e675f6: fix(metadata): package-scope the layered (Studio editor) read via `?package=` (ADR-0048)

  The `?layers=true` single-item read (the Studio metadata editor's 3-state
  code/overlay/effective view) ignored `packageId`, so editing one of two
  same-named items from different packages resolved ambiguously (first match).

  - `protocol.getMetaItemLayered` now threads `packageId` into the code layer
    (`metadataService.get` + `lookupArtifactItem` + `registry.getItem`) and the
    `sys_metadata` overlay query (`package_id` prefer-local).
  - `registry.getArtifactItem(type, name, currentPackageId?)` and
    `lookupArtifactItem` gained the optional package-scope hint.
  - `rest-server` threads `?package=` into the layered branch.

  This completes the per-route package-scoped resolution audit: the runtime
  render surface (dashboard/report/page/doc) was already scoped; this closes the
  Studio editor (`/apps/:appName/metadata/:type/:name`). Frontend counterpart
  sends `?package=` from the metadata list row's owning package.

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/service-package@9.4.0

## 9.3.0

### Minor Changes

- 290f631: ADR-0044 flow-level send-back-for-revision (#1744). The approval node gains a third flow movement beyond approve/reject: `sendBack()` finalizes the pending request as `returned` (new `ApprovalStatus`), resumes the run down its `revise` edge to a wait point where the record lock releases, and the submitter's `resubmit()` re-enters the approval node over a declared back-edge, opening the next round's request (fresh approver slate, re-locked, `round` stamped via the config snapshot). Engine: `FlowEdgeSchema.type` gains `'back'` — cycle validation now requires the graph _minus_ back-edges to be a DAG (unmarked cycles still rejected), node re-entry overwrites outputs/appends steps, a 100-re-entry runaway guard backstops misauthored loops, and `cancelRun(runId, reason)` lands as the first run-cancel primitive (recall crossing a revise window cancels the parked run). `maxRevisions` (default 3) on the approval node config auto-rejects send-backs past the budget. REST: `POST /approvals/requests/:id/revise` and `/resubmit`. Audit kinds `revise`/`resubmit` join `ApprovalActionKind` and the `sys_approval_action` enum.
- 50b7b47: Approvals server-side pagination + search pushdown (#1745). `listRequests` accepts `q` / `limit` / `offset` — free-text search pushes into the engine query as an `$or` of `$contains` terms (the `payload_json` snapshot carries record titles, so titles match without a join), and the page window pushes down whenever the filter is fully pushable; approver/status-array filters still post-filter their bounded scan and window in memory (the documented residual until the approver join-table follow-up). New `countRequests` returns the unwindowed total (engine `count` when pushable). REST: `GET /approvals/requests` gains `q`/`limit`/`offset` and returns `{data, total}` when paging.
- f8684ea: Approvals thread interactions — the collaboration layer between submit and decide. `reassign()` hands a pending-approver slot to someone else (audit-first ordering, new approver notified via the optional `messaging` service), `remind()` nudges every pending approver with a 4h per-request throttle (`THROTTLED` → HTTP 429), `requestInfo()` sends a request back to the submitter for more material while it stays pending, and `comment()` adds free-form thread replies. Rows expose `sla_due_at` (`created_at + escalation.timeoutHours`, display-only) and single reads attach `flow_steps` (the owning flow's approval trunk with done/current/upcoming states). REST grows the four matching POST routes; the `sys_approval_action.action` enum gains the new kinds.

### Patch Changes

- b08d08d: ADR-0046: `GET /meta/doc` list responses omit `content` by default (`?include=content` opts back in; `GET /meta/doc/:name` always returns the full body). The runtime dispatcher's `/metadata/doc` route already slims docs (#1789) — this applies the same rule on the REST `/meta/:type` route the console actually reads, keeping unbounded manuals off the list surface.
- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/service-package@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/service-package@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/service-package@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/service-package@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/service-package@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/service-package@8.0.1

## 8.0.0

### Minor Changes

- 345e189: Robust multi-write transactions (ADR-0034). `engine.transaction()` now establishes an ambient transaction (AsyncLocalStorage) so every data operation during the callback — including internal reads performed while a write runs — binds to the active transaction's connection instead of asking the pool for another one and deadlocking on SQLite's single-connection pool. Adds a cross-object transactional batch endpoint (`POST /api/v1/data/batch`) with intra-batch `{ $ref: <opIndex> }` parent references, so a parent and its children can be created atomically in one transaction.

### Patch Changes

- 0a6438e: perf(rest): cache hostname→environment resolution; document cluster pub/sub durability (P1-4, P1-5)

  - **rest (P1-4):** `resolveByHostname()` ran on every unscoped request — a
    control-plane lookup (typically a DB query) in the hot path. `RestServer` now
    caches `hostname → environmentId` in-memory with a 30s TTL across all three
    resolution sites, caching negative results too so unknown hosts don't hammer the
    registry. Registry errors are not cached, so a transient blip self-heals.
  - **service-cluster-redis (P1-5):** recorded the durability contract for
    `metadata.changed` in `pubsub.ts`. Redis pub/sub is at-most-once **by design**;
    the event is a cache-invalidation hint only — the durable source of truth is the
    transactional `sys_metadata` (+ `sys_metadata_history`) write, so a missed event
    causes a stale cache until the next reload, never data loss. No code change to
    the delivery semantics; risk accepted and documented.

- ae7fb3f: fix(rest): advertise `routes.mcp` in /discovery when MCP is enabled (cloud#152)

  The objectui Integrations page reads `discovery.routes.mcp` to show the "Connect
  an AI agent" card, but it stayed absent on live envs even with MCP enabled. Root
  cause (NOT a cache, as first suspected): `@objectstack/rest` serves its OWN
  `/discovery` (`protocol.getDiscovery()`), separate from the dispatcher's
  `getDiscoveryInfo` where the `mcp` field was added — so the REST-served discovery
  never advertised it.

  The REST discovery handler now adds `routes.mcp` (pointing at the unscoped
  `/api/v1/mcp`, since the MCP route is mounted bare) when
  `OS_MCP_SERVER_ENABLED=true`, and omits it otherwise — mirroring the dispatcher
  discovery and the opt-in gate. 2 tests (enabled → advertised, disabled → absent).

- c262301: fix(rest): REST data API honors sys_api_key — one shared verifier with MCP (closes #1633)

  Staging e2e found the MCP surface authenticated a `sys_api_key` but the REST data
  API (`@objectstack/rest`) returned 401 for the same key — its `resolveExecCtx`
  only checked the better-auth session, never the API key.

  Converged both surfaces onto ONE verifier so they can't drift:

  - **`@objectstack/core/security`** now owns the shared `sys_api_key` primitives
    (`hashApiKey`, `generateApiKey`, `extractApiKey`, `parseScopes`, `isExpired`)
    plus a new `resolveApiKeyPrincipal(ql, headers, nowMs?)` that hashes the
    inbound key, looks it up by the indexed at-rest hash, and rejects unknown /
    revoked / expired / owner-less keys (fail-closed). `core` is the natural home:
    both `rest` and `runtime` depend on it, it depends on neither (no cycle), and
    it's server-side (already uses `node:crypto`).
  - **`@objectstack/runtime`** — `security/api-key.ts` re-exports the primitives
    from core (stable import surface) and `resolveExecutionContext` now delegates
    its API-key branch to `resolveApiKeyPrincipal`.
  - **`@objectstack/rest`** — `resolveExecCtx` resolves the data engine once and
    tries `resolveApiKeyPrincipal` (x-api-key / `Authorization: ApiKey`) BEFORE the
    session, so `/api/v1/data` + `/api/v1/meta` now authenticate an API key under
    the key's permissions + RLS, exactly like the dispatcher/MCP path.

  Tests: core `api-key.test.ts` (primitives + verifier: valid / revoked / expired /
  unknown / owner-less / plaintext-not-matched / fail-closed-ql). runtime + rest
  suites green.

- e1478fe: fix(rest): map schema-mismatch & not-null driver errors to structured 4xx

  `mapDataError` collapsed any SQL-looking driver error into a generic
  `500 DATABASE_ERROR`, so a bad write payload to the data API leaked a 500
  instead of a fixable 4xx (e.g. `POST /data/sys_team` with an unknown field,
  or omitting a required column). It now maps unknown-column errors to
  `400 INVALID_FIELD { field }` and not-null violations to
  `400 VALIDATION_FAILED { fields:[{required}] }` across SQLite/Postgres/MySQL
  phrasings, placed before the unknown-object branch so Postgres
  `column … of relation … does not exist` is not mis-mapped to 404. Genuine
  driver faults still return 500; unique violations still return 409.

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/service-package@8.0.0

## 7.9.0

### Patch Changes

- ac1fc4c: feat(metadata): optional storage teardown on delete so "publish to preview" leaves no orphan table

  Object storage was create-only: `publishMetaItem` creates a table (`ensureObjectStorage`) but nothing ever dropped one — `deleteMetaItem` only tombstones the metadata row, leaving the physical table behind. That made the pragmatic "publish an object just to preview it with real data, then discard if wrong" loop leave residue.

  Adds the inverse path, opt-in and guarded:

  - `engine.dropObjectSchema(name)` — inverse of `syncObjectSchema`; resolves the table name + driver and calls the driver's existing `dropTable` (DROP TABLE IF EXISTS / drop collection).
  - `deleteMetaItem({ …, dropStorage })` — when `true`, drops the object's physical table after the metadata is removed. **DESTRUCTIVE**, so it is gated: `object` type only (others have no table), `active` state only (drafts were never materialised), and never a `sys_`-prefixed platform table. Default `false` keeps delete non-destructive to data. Best-effort: a drop failure is logged, not thrown.
  - REST: `DELETE /meta/:type/:name?dropStorage=true` threads the flag.

  This makes "publish to preview → discard" cleanly reversible. Combined with the draft-overlay read mode, it backs the team's chosen approach: lean on publish (into a dev sandbox) for data-level confirmation rather than building a full draft-data preview, and make that publish safely undoable.

  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/service-package@7.9.0

## 7.8.0

### Patch Changes

- a75823a: feat(metadata): expose pending DRAFT metadata (ADR-0033 draft discoverability)

  AI-authored metadata lands as drafts (`sys_metadata` rows with `state='draft'`, bound to an app package), but the only list path — `getMetaItems` — reads the active registry, so drafts were invisible: a just-built app package looked empty and there was no "pending changes" surface.

  - `SysMetadataRepository.listDrafts({type?, packageId?})` lists draft rows (mirrors `list()` but scoped to `state='draft'`, optionally narrowed by package), returning a light header projection (no body) with `packageId`.
  - `protocol.listDrafts({packageId?, type?, organizationId?})` exposes it over the overlay repo.
  - `GET /api/v1/meta/_drafts?packageId=&type=` surfaces it to the console. Registered in the REST server before the greedy `/meta/:type` route (and mirrored in the dispatcher) so `_drafts` is never captured as a metadata type name.

  Read-only; no behavior change to existing list/publish paths. Powers the upcoming Studio "drafts/pending changes" view and draft-aware package contents.

- Updated dependencies [06f2bbb]
- Updated dependencies [4fbb86a]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/service-package@7.8.0
  - @objectstack/core@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/service-package@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/service-package@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/service-package@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/service-package@7.4.1

## 7.4.0

### Minor Changes

- 2faf9f2: External Datasource Federation (ADR-0015) — REST surface.

  Adds `registerExternalDatasourceRoutes`, mounting `/api/v1/datasources/:name/
external/*` — `GET tables`, `POST tables/:remote/draft`, `POST refresh-catalog`,
  `POST validate` — served by the `external-datasource` service and wired into the
  REST API plugin. Routes return `503 external_service_unavailable` when the
  service is not registered, so they are safe to mount unconditionally.

### Patch Changes

- 58b450b: Make metadata labels follow the active UI language without a page refresh (#1319).

  The client now carries the active locale on every request (`Accept-Language`,
  `setLocale`/`getLocale`), the protocol ETag is locale-aware so cached metadata
  no longer collides across languages, and the `client-react` metadata hooks
  refetch when the locale changes. The `apps/account` console wires its router
  locale through so a language switch relabels server-resolved object/field/view
  labels in place instead of leaving the UI half-translated until reload.

- 82eb6cf: Fix system-metadata translations: locale fallback, app/dashboard localization, and coverage gaps.

  Switching the UI language left many surfaces in English. Three root causes
  are addressed:

  - **Locale fallback (server).** The metadata translation resolver
    (`@objectstack/spec` `i18n-resolver`) now resolves a requested locale
    against the locales actually present in the bundle (exact →
    case-insensitive → base-language → variant), so a request for `zh`
    correctly hits the `zh-CN` bundle instead of falling back to English.
    This mirrors `resolveLocale` in `@objectstack/core` and benefits every
    resolver (objects, views, actions, settings, metadata forms).

  - **App & dashboard localization (server).** Added `translateApp` and
    `translateDashboard` resolvers and wired `app`/`dashboard` into the REST
    `/meta` translation path. App labels, sidebar/navigation group labels,
    and dashboard titles/widgets were previously never localized at the API
    boundary even though the translation data existed.

  - **Coverage & quality (data).** Added translations for the previously
    untranslated platform objects `sys_share_link`, `sys_view_definition`,
    and `sys_metadata_audit` (and registered them in the i18n-extract config
    so future extractions keep them). Replaced English placeholder strings
    left in the `zh-CN` / `ja-JP` / `es-ES` object and metadata-form bundles
    (notably action `confirmText` / `successMessage` prompts). Added the
    missing `es-ES` built-in Settings bundle in `@objectstack/service-settings`.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/service-package@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/service-package@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/service-package@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/service-package@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/service-package@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/service-package@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/service-package@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/service-package@6.8.1

## 6.8.0

### Minor Changes

- c8b9f57: Metadata Admin engine — protocol foundations.

  This is the backend half of the unified Metadata Admin shipped in the Setup
  app. The framework now exposes everything the engine needs to render a
  directory tile, schema-driven form, layered diff, references graph, and
  destructive-change confirmation for every registered metadata type.

  - **`GET /api/v1/meta/types`** is now type-rich. Each entry includes
    `{ icon, domain, schema (JSONSchema), allowOrgOverride, allowRuntimeCreate, supportsOverlay, ui? }`
    so the client can render without a second round-trip per type.
  - **`GET /api/v1/meta/:type/:name/references`** scans every registered
    metadata type for pointers to the given item (object fields, view sources,
    flow targets, permission objects, …) and returns the inbound edges so the
    UI can warn before deletes.
  - **`GET /api/v1/meta/:type/:name?layers=code,overlay,effective`** returns
    each layer separately rather than the merged effective document, powering
    the 3-state diff editor (code source / overlay / effective).
  - **Destructive-change detection** on `PUT /api/v1/meta/object/:name` and
    `PUT /api/v1/meta/field/:name`: rejects field type narrowing, required
    toggled on without a default, removed enum values, etc., unless the
    client opts in with `force=true`.
  - **Env-var registry patch:** `OBJECTSTACK_METADATA_WRITABLE=object,field,permission,view,…`
    flips `allowOrgOverride` on for the listed types at boot, enabling
    runtime overlays for production without re-deploying spec.
  - New guide: **[Adding a Metadata Type](../content/docs/guides/adding-a-metadata-type.mdx)**
    walks through registry entry + Zod schema + optional custom editor.

  Setup app navigation now uses the new component-route variant
  (`{ type: 'component', componentRef: 'metadata:directory' }`) — the temporary
  `/dev/meta` route is removed.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/service-package@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/service-package@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/service-package@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/service-package@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/service-package@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/service-package@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/service-package@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/service-package@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/service-package@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/service-package@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/service-package@6.1.0

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
  - @objectstack/core@6.0.0
  - @objectstack/service-package@6.0.0

## 5.2.0

### Patch Changes

- b806f58: Scope `sys_user` visibility to fellow organization members.

  The default RLS policy on `sys_user` was `id = current_user.id`, which meant
  @-mention pickers, owner/assignee lookups, reviewer selectors and the user
  roster all returned just the current user. The RLS compiler doesn't support
  subqueries, so a `id IN (SELECT user_id FROM sys_member ...)` policy isn't
  expressible.

  This change:

  1. Pre-resolves `org_user_ids` (the IDs of all users in the active org) into
     `ExecutionContext` in **all three** REST entry-point resolvers
     (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/plugin-hono-server`).
  2. Adds the field to `ExecutionContextSchema` so it survives Zod parsing.
  3. Adds an `org_user_ids` field to the RLS compiler's user context.
  4. Adds a new `sys_user_org_members` policy (`id IN (current_user.org_user_ids)`)
     to both `member_default` and `viewer_readonly` permission sets, alongside
     the existing `sys_user_self` policy. The RLS compiler OR-combines them, so
     users see themselves AND their org collaborators.

  Capped at 1000 members per request. Large enterprises should plug in a
  directory cache or split per workspace.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/service-package@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/service-package@5.1.0

## 5.0.0

### Minor Changes

- 5cfdc85: PR-10d.4 — REST plumbing for the metadata repository write path.

  - `PUT /api/v1/meta/:type/:name` (and the compound `:type/:section/:name` variant)
    now forwards the `If-Match` header to `saveMetaItem` as `parentVersion`, and
    `X-Actor` (or `req.user.id`) as `actor`. ETag-style quotes are stripped.
  - A failed optimistic-lock check surfaces as HTTP 409 with body
    `{ "error": "...", "code": "metadata_conflict" }` (no protocol changes —
    `sendError` already honoured `error.status` + `error.code`).
  - Added a real-engine integration test for the repository write path
    (`protocol-save-meta-repo-path-real-engine.test.ts`) — addresses the
    PR-10d.3 rubber-duck stub-drift concern by exercising
    `ObjectStackProtocolImplementation.saveMetaItem` through `new ObjectQL()`
    with an inline in-memory driver. Covers insert→update version bump,
    parentVersion conflict, checksum length, and plural→singular normalization.

  Default behaviour unchanged: the repository write path remains opt-in via
  `options.useRepositoryWritePath` / `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`.
  Flag flip and legacy path removal will follow in a separate post-soak PR.

### Patch Changes

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/service-package@5.0.0

## 4.2.0

### Minor Changes

- 2869891: feat: Optimistic Concurrency Control (OCC) via `If-Match`

  Update and Delete requests now accept an optional version token. When supplied,
  the protocol compares it against the record's current `updated_at` (or `version`
  column when available) and rejects with `409 CONCURRENT_UPDATE` on mismatch,
  preventing silent overwrites when two clients edit the same record.

  **Wire formats** (opt-in, all server- and client-backward-compatible):

  - `PATCH /data/{object}/{id}` — supports `If-Match: "<token>"` header
    _or_ `expectedVersion: "<token>"` body field (body wins when both present).
  - `DELETE /data/{object}/{id}` — supports `If-Match` header _or_
    `?expectedVersion=...` query param.
  - Conflict response: `409 { error, code: 'CONCURRENT_UPDATE', currentVersion,
currentRecord }` so the client can offer Reload / Overwrite / Cancel UX.

  **Behaviour**

  - Missing/empty version → no check (legacy callers unaffected).
  - Record not found during the version probe → no check; the downstream write
    produces a normal `404`.
  - Object has no `updated_at` column → no check (explicit opt-out for objects
    without timestamps).
  - Quoted RFC-7232 tokens (`"…"`) are accepted and unquoted before comparison.

  **Client**

  `client.data.update(resource, id, data, { ifMatch })` and
  `client.data.delete(resource, id, { ifMatch })` now forward the token as an
  `If-Match` header.

  Application-level CAS (findOne + compare in protocol.ts) is used in this slice
  to avoid touching every storage driver. A small TOCTOU window remains; for the
  B2B record-editing latencies this protects against, it is more than sufficient.
  Drivers may later be upgraded to atomic `WHERE id=? AND updated_at=?` writes
  for true CAS without changing the public API.

  Tests: 7 new cases in `protocol-data.test.ts` cover opt-in, match, mismatch,
  quote-stripping, no-timestamps, empty-token, and the delete path.

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/service-package@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/service-package@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/service-package@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/service-package@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/core@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/core@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/core@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/core@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/core@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/core@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/core@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/core@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/core@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/core@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/core@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/core@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4
  - @objectstack/core@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/core@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/core@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/core@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/core@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/core@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/core@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/core@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/core@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/core@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.1.1
  - @objectstack/core@1.1.1

## 1.1.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema, MCP Protocol schemas, API versioning, Dispatcher protocol
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` now use `z.unknown()`. Add type narrowing where needed.

  ### Hub schemas relocated

  Barrel imports via `Hub.*` still work. Direct path imports (`hub/license.zod.ts` → `system/license.zod.ts`) need updating.

  ### MetricType renamed

  `MetricType` (analytics) → `AggregationMetricType`, `MetricType` (licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → `createDispatcherPlugin()`
  - `createHonoApp` → `HonoServerPlugin`

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0

## 1.2.0

### Minor Changes

- ## New Features

  - **@objectstack/rest** (new package): Extracted REST server, route management, and `createRestApiPlugin` into a dedicated package
  - **@objectstack/runtime**: Add `createDispatcherPlugin` for structured route management (auth, graphql, analytics, packages, hub, storage, automation)
  - **@objectstack/cli**: Dev mode (`--dev`) now auto-enables Studio UI at `/_studio/` — no need for `--ui` flag; use `--no-ui` to disable
  - **@objectstack/cli**: Root URL `/` redirects to `/_studio/` in dev mode for convenience
  - **@objectstack/cli**: Removed Vite dev server fallback — always serves pre-built dist, no extra port
  - **@objectstack/studio**: Interactive API Console in Object Explorer (request builder, response viewer, history)
  - **@objectstack/spec**: Studio Plugin schema (`Studio.PluginManifest`)
  - **@objectstack/spec**: MCP (Model Context Protocol) schemas for AI tools, resources, prompts, transport
  - **@objectstack/spec**: API versioning schema with multiple strategies
  - **@objectstack/spec**: Dispatcher protocol schema
  - **@objectstack/spec**: Comprehensive `.describe()` annotations across all Zod schemas for JSON Schema generation
  - **@objectstack/core**: Production hot reload and dynamic plugin loading protocol

  ## Migration Guide (from 1.1.0)

  ### RuntimeConfig.api removed

  REST API is now opt-in. If you relied on automatic REST registration:

  ```ts
  // Before (1.1.0) — implicit
  const runtime = new Runtime({ api: { basePath: "/api/v1" } });

  // After (1.2.0) — explicit
  import { createRestApiPlugin } from "@objectstack/rest";
  const runtime = new Runtime();
  runtime.use(createRestApiPlugin({ basePath: "/api/v1" }));
  ```

  ### z.any() → z.unknown() (~30 fields)

  Fields like `metadata`, `defaultValue`, `filters`, `config`, `data` in spec schemas changed from `z.any()` to `z.unknown()`. If you consume inferred types, add type narrowing:

  ```ts
  // Before — worked silently
  const val: string = record.metadata.foo;

  // After — requires narrowing
  const meta = record.metadata as Record<string, string>;
  const val = meta.foo;
  ```

  ### Hub schemas relocated

  - `hub/composer.zod.ts`, `hub/marketplace.zod.ts`, `hub/space.zod.ts`, `hub/hub-federation.zod.ts` — removed
  - `hub/plugin-registry.zod.ts` → `kernel/plugin-registry.zod.ts`
  - `hub/license.zod.ts` → `system/license.zod.ts`
  - `hub/tenant.zod.ts` → `system/tenant.zod.ts`

  Barrel imports via `Hub.*` namespace still work. Direct path imports need updating.

  ### MetricType renamed

  - `MetricType` (data analytics) → `AggregationMetricType`
  - `MetricType` (hub licensing) → `LicenseMetricType`

  ### Deprecations

  - `HttpDispatcher` → use `createDispatcherPlugin()` instead
  - `createHonoApp` → use `HonoServerPlugin` instead

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.0
  - @objectstack/core@2.0.0
