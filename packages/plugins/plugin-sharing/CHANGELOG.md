# @objectstack/plugin-sharing

## 17.0.0-rc.1

### Minor Changes

- 1ea6bce: feat(sharing): hierarchy managers may manage shares within their write DEPTH (ADR-0111 D1 DEPTH)

  `canManageShares` gains its named DEPTH extension: a caller whose effective
  WRITE scope on the object is a hierarchy scope (`unit` / `unit_and_below` /
  `own_and_reports`) may now manage shares on a record whose owner falls within
  that scope's owner set — the same set the write filter and `canEdit` already
  honour, resolved by the enterprise `hierarchy-scope-resolver`. This lets a
  manager grant/revoke/list shares on a subordinate's record, matching
  Salesforce (roles above the owner) and Dataverse (the `Share` privilege's BU
  depth), without expanding the MVP owner + Modify-All authority.

  - New `ISecurityService.resolveWriteScope(object, context)` — the effective
    write scope, resolved by the same evaluator the CRUD middleware uses; fails
    closed to `own`. Mirrored on the sharing plugin's structural probe.
  - The gate honours only the three hierarchy scopes. `org` from the probe is
    deliberately ignored: it means both a genuine Modify-All holder (already
    granted via `hasWriteBypass`) AND the fail-OPEN "no permission set mentions
    this object" default, so honouring it here would reopen the hole
    `hasWriteBypass` was chosen to avoid.
  - Fails closed with no security service or no enterprise resolver — the open
    edition stays owner + Modify-All, exactly as before.

- e5e8b10: feat(sharing): a record's share-manager may revoke any share-link on that record (ADR-0111 D8)

  `ShareLinkService.revokeLink` was creator-or-system only, so a record's owner or
  a Modify-All admin could not kill a link someone else minted on their record —
  their record's exposure, but not their link to revoke. Revoke authority now
  also admits a record **share-manager**, probed via the sharing service's
  late-bound `canManageShares` (owner / `modifyAllRecords`). The probe fails
  closed: a deployment without it (or a throwing probe) keeps the pre-D8
  creator-only behaviour. Mint authority is unchanged and now documented as the
  D8 decision it always enforced — the object's `publicSharing` opt-in AND the
  caller's visibility of the record.

- c1dcacd: fix(sharing)!: the share-management surface gains the authorization layer it never had (ADR-0111 P0, #3902)

  Record sharing shipped as a data layer with no authorization of its own: every
  `/data/:object/:id/shares` and `/sharing/rules` route authenticated the caller
  and then ran the service under `SYSTEM_CTX` — any signed-in user could revoke
  anyone's share, enumerate who-can-see-what, write self-grants, and define /
  evaluate org-wide sharing rules. ADR-0111's P0 rulings land here:

  - **D1/D2** — `ISharingService.canManageShares(object, recordId, context)`:
    system, the record's owner, or a holder of Modify All Data (probed via the
    new fail-closed `ISecurityService.hasWriteBypass`). Enforced in the SERVICE,
    so every caller is covered; without plugin-security it fails closed to
    owner-only.
  - **D4** — `revoke` is symmetric with grant, validates the share belongs to the
    URL's record (`NOT_FOUND` on mismatch), and refuses non-`manual` rows
    (`CONFLICT` — a rule-materialised grant would be resurrected by the next
    reconcile).
  - **D5** — `listShares` is management-gated (invisible record → `NOT_FOUND`,
    visible-but-not-manager → `PERMISSION_DENIED`), and the open
    `/data/sys_record_share` read surface is self-scoped: non-admin callers see
    only rows naming them as recipient or grantor.
  - **D6** — the whole `/sharing/rules` surface (list/create/get/delete/evaluate)
    requires the new **`manage_sharing`** capability (D9; seeded into
    `admin_full_access`, `manage_platform_settings` honoured as the legacy
    equivalent), enforced in `SharingRuleService`.
  - **D7** — no inert grants: `recipientType` is narrowed to `user` (the only
    type any gate enforces), grants on objects the sharing gates never consult
    (public model, no `owner_id`, bypass, `controlled_by_parent`) fail with
    `SHARING_NOT_ENABLED` (422), and the manual upsert keys on
    `(object, record, recipient, source)` so manual and rule rows coexist.

  **Breaking** for callers that relied on the missing gate: unauthorized share
  management now fails with 403/404/409/422 instead of silently succeeding, and
  `ISharingService.revoke` gained an optional `scope` parameter. The verb
  boundary (edit ≠ delete, ADR-0111 D3) is NOT in this change — it lands as the
  separate P1.

- ad303ed: fix(sharing)!: an edit-level share no longer grants delete (ADR-0111 D3, the verb boundary)

  `update` and `delete` shared one `canEdit` gate, and `canEdit` accepts an
  `edit`-level share — so one "edit" grant silently conferred delete, the
  opposite error from the retired `full` level. A share widens _which rows_ a
  principal reaches, never _which verbs_ they may use (Salesforce Read/Write
  cannot delete; Dataverse `Delete` is a distinct privilege; Odoo splits
  `write`/`unlink`).

  - `ISharingService.canDelete(object, recordId, context)` — ownership (widened
    by write DEPTH) or the `modifyAllRecords` super-user bypass ONLY; an `edit`
    or legacy `full` share does not confer it. `canEdit` is unchanged (the
    update gate, share included).
  - `SharingService.buildWriteFilter` takes a `verb` parameter: a bulk
    `delete({multi:true})` scopes to the owner/DEPTH set alone (no share
    widening), while a bulk `update` keeps it.
  - The sharing middleware routes `delete` through `canDelete` and logs a
    specific fail-closed reason on denial (ADR-0111 D10).
  - `/security/explain` consults `canDelete` for a `delete` operation, so the
    record-level explanation matches enforcement.

  **Breaking**: a caller who could delete a record _only_ through an edit-level
  share (and holds object-level delete CRUD) can no longer delete it — delete now
  requires ownership, write depth, or Modify All Data. No new delete access level
  is introduced; a future per-record delete grant would be a capability mask
  AND-ed with object CRUD, not a fourth share level.

- ccd9397: fix(security)!: a sharing rule with no criteria now shares NOTHING instead of every record (#3896)

  `SharingRuleSchema` has always required `condition`, and its doc is explicit
  that a predicate the compiler cannot lower is _"skipped and logged — never
  seeded as a permissive match-all (ADR-0049)"_. The declared/seed path honoured
  that. The two other ways to create a rule did not:

  - **`POST {basePath}/sharing/rules`** plucks its body field-by-field into
    `SharingRuleService.defineRule`, which validated `name` / `label` / `object` /
    `recipientType` / `recipientId` — and not `criteria`. A missing, `null`, or
    **misspelled** key (`criterias`) was stored as `criteria_json: null`, answered
    `201` with no warning, and evaluated as
    `find(object, { filter: {}, context: SYSTEM_CTX })`: every record of the
    object, up to 5000, granted to the recipient. Triggering it took a typo, not
    an attacker.
  - **Authoring a rule in Setup** is a direct `sys_sharing_rule` insert, which
    never reaches `defineRule` at all.

  Empty criteria is now rejected everywhere a rule can be written, and — because
  rules created before this gate are already in the table — the evaluator refuses
  to act on one regardless of how it got there.

  - **`defineRule` rejects a match-all criteria** with
    `VALIDATION_FAILED: criteria is required …`, alongside its other required
    fields. Covers the REST endpoint, programmatic callers, and the seeder.
    Rejected shapes: missing / `null` / `''` / `{}` / `[]` / `{ $and: [] }` /
    unparsable JSON (e.g. a CEL source typed into the Criteria box).
  - **The evaluator matches nothing** for such a rule and logs why, so a row
    stored before this release under-shares instead of over-sharing: the next
    reconcile _revokes_ the grants it had materialised. Both evaluation paths are
    covered — the bulk `evaluateRule` and the per-record write-hook path.
  - **`bindRuleCriteriaGuard`** fails `sys_sharing_rule` inserts with no
    criteria as a field-level `VALIDATION_FAILED` (a 400 naming `criteria_json`),
    so the Setup path reports the problem instead of saving an inert rule
    (ADR-0078). Updates are checked only when the patch supplies
    `criteria_json` — switching an over-broad legacy rule off must not require
    inventing a criteria for it first.
  - **The seed bootstrap's "empty condition = match-all" branch is gone**: a
    missing or empty `condition` is now skipped and logged like any other
    non-lowerable one.
  - `POST {basePath}/sharing/rules` also accepts `criteria_json` as an alias for
    `criteria`, matching the snake_case aliases the endpoint already takes for
    `object_name` / `recipient_type` / `access_level`.

  **Migration.** There is no "share every record" sharing rule, and there never
  usefully was one — the shape existed only as a failure mode. A rule that
  relied on it must state its predicate (`criteria: { stage: 'won' }`), or, if
  the object really should be readable by everyone, use the object's
  organization-wide default (`sharingModel`) instead. Rules already stored with
  a null `criteria_json` need no data migration: they stop granting on the next
  evaluation and their existing grants are revoked.

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

- 7df7c64: feat(sharing): `sys_sharing_rule.criteria_json` is declaratively required (ADR-0113 P2)

  The field the ADR was written for: `required: true` as the write contract —
  insert must provide, update may not null out, legacy null rows rest, an admin
  can still `active: false` an over-broad legacy rule. Deliberately NO
  `storage.notNull`: deployed tenants' legacy nulls are the case the split
  exists for. The Setup form's required marker and client validation now derive
  from the declaration.

  Not breaking: a rule without criteria was already rejected by the #3929 hook
  guard; the guard narrows to the non-null match-all shapes `required` cannot
  express ('{}', vacuous $and/$or, unparsable JSON), `defineRule` keeps the API
  seam, and the evaluator stays fail-closed (ADR-0049).

- b5f9397: fix(sharing,runtime): a `sort` passed straight to the engine never ordered anything; migrate every in-repo engine call to canonical QueryAST keys (#4346)

  Two changes with different weights, from one sweep of every in-repo engine
  call site that still speaks a deprecated alias.

  **The bug — three dropped sorts.** #4346 made the engine fold `filter`→`where`
  and `top`→`limit` on all six methods. The other four pairs in
  `RPC_QUERY_ALIAS_SLOTS` (`select`, `sort`, `skip`, `populate`) are folded at
  the RPC/wire layer only — their values need shape lowering that belongs to
  those layers — and a **direct `engine.find()` never crosses that layer**. Three
  call sites passed `sort` there, so it rode onto the AST untouched, every
  driver's `Array.isArray(query.orderBy)` guard declined to emit an ORDER BY, and
  the query returned an ordinary-looking, arbitrarily-ordered result:

  | call site                           | asked for                                         | actually got                |
  | ----------------------------------- | ------------------------------------------------- | --------------------------- |
  | `share-link-routes.ts`              | shared AI conversation messages, `created_at asc` | messages in arbitrary order |
  | `runtime/domains/share-links.ts`    | same route, runtime-domain copy                   | same                        |
  | `share-link-service.ts` `listLinks` | the 200 most recent share links                   | an arbitrary 200            |

  All three combine the dropped sort with a `limit` — the "latest N" shape whose
  failure #4226 spelled out: an unapplied sort returns rows in arbitrary order,
  which `limit` then slices into an arbitrary page. #4226 fixed that in the wire
  normalizer; these calls sit one layer below it. `listLinks` had no test at all,
  which is why it went unnoticed. Now pinned — on the option bag the engine
  receives, not on row order, because the failure is that the key never becomes
  `orderBy` and a fake engine honouring either spelling would pass either way.

  **The cleanup — 27 no-op renames.** Every remaining in-repo engine call passing
  `filter` now passes `where` (approvals 5, auth 2, reports 6, sharing 11,
  webhooks 2, plus the one `filters` in a spec doc example). These are strict
  no-ops since #4346 folds the alias — the point is that the framework stops
  depending on a spelling it asks users to migrate off, which is a prerequisite
  for ever retiring the aliases. Service-level `filter` PARAMETERS (each
  service's own public API, e.g. `listRequests(filter)`) are deliberately
  untouched — those are not engine option bags.

  Two of the renamed calls were live victims of the #4346 bug rather than
  cosmetic: `auth-manager`'s `stampIdentitySource` read the table's first row via
  `findOne({filter})` and counted the whole table via `count({filter})`, so a
  federated sign-in never stamped `source: 'idp_provisioned'`. #4346 already
  corrected the behaviour; this makes the call say what it means.

- 71af9f5: fix(sharing): the criteria-less-rule warn is once per rule per process, plus one boot aggregate (#3929 follow-up)

  Pre-dedup the fail-closed evaluator warned on EVERY pass — per evaluation and
  per reconciled write — so one legacy criteria-less rule could dominate a
  deployment's log. Enforcement is unchanged (such a rule still matches
  nothing and its grants are revoked on reconcile); the warn now fires once
  per rule per process, and the boot backfill emits a single operator-facing
  aggregate (count + rule names + the fix: repair the criteria or set
  active: false).

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 4580597: fix(plugin-sharing)!: the share-link routes emit the declared envelope, and the last ratchet retires (#3983)

  The fifth and final drifting route module. Unlike the four in #3843, this one was
  not found by reading — `scripts/check-route-envelope.mjs` surfaced it the moment
  that scan went repo-wide, which is the whole argument for a repo-wide guard over
  per-package copies. It also turned out to be the one where the drift had actually
  **broken shipped SDK methods**, not merely mis-shaped a body.

  ## Two SDK methods did not work on this surface

  Three of these routes are `disposition: 'sdk'` in `runtime/src/route-ledger.ts`,
  and `ObjectStackClient.unwrapResponse` decides a body is an envelope by finding a
  boolean `success`. With no flag it hands back the body verbatim:

  | method                | documented / typed as          | actually returned                           |
  | --------------------- | ------------------------------ | ------------------------------------------- |
  | `shareLinks.create()` | "the link row (incl. `token`)" | `{ link: … }` — so `.token` was `undefined` |
  | `shareLinks.list()`   | `Promise<any[]>`               | `{ links: [] }` — so `.map()` threw         |

  `packages/client/src/admin-surfaces.test.ts` mocks all three as
  `{ success: true, data: <payload> }`. The SDK was written and tested against the
  **dispatcher's** shape and only ever worked there.

  ## This is a convergence, not a redesign

  `runtime/src/domains/share-links.ts` serves the same five paths, and for cloud's
  per-environment kernels it is the _designed primary_ surface
  (`registerShareLinkRoutes: false`). It has always answered in the declared
  envelope. The plugin now answers identically:

  | route                            | was                              | now                                     |
  | -------------------------------- | -------------------------------- | --------------------------------------- |
  | `POST /share-links`              | `{ link }`                       | `{ success: true, data: link }`         |
  | `GET /share-links`               | `{ links }`                      | `{ success: true, data: link[] }`       |
  | `DELETE /share-links/:idOrToken` | `{ ok: true }`                   | `{ success: true, data: { ok: true } }` |
  | `GET /:token/resolve`            | `{ record, link, redactFields }` | `{ success: true, data: { … } }`        |
  | `GET /:token/messages`           | `{ data: rows }`                 | `{ success: true, data: rows }`         |
  | errors                           | `{ error: { code, message } }`   | `{ success: false, error: { … } }`      |

  `data` carries each payload **directly** — `data: links`, not `data: { links }`.
  That is what makes `unwrapResponse` return the same value on both surfaces, and
  it is what the SDK already expected.

  ## Breaking: raw `fetch` callers add one hop

  SDK callers get the fix for free (two of them go from broken to working). Direct
  body readers add `.data`:

  ```diff
  - const { links } = await (await fetch('/api/v1/share-links')).json();
  + const { data: links } = await (await fetch('/api/v1/share-links')).json();
  ```

  `{ ok: true }` on revoke survives, but as the payload rather than as the body: at
  the top level it was a second word for `success`, which #3689 retired from
  storage; under `data` it is what the dispatcher already returned.

  The `error` half was already nested `{ code, message }` — #3675's changeset cited
  this module as the good example of that — so only the `success` flag is new there.
  All eleven codes were already SCREAMING_SNAKE and registered, so ADR-0112 needs
  nothing.

  ## Consumers

  Swept, and the result is smaller than #3983 assumed. The framework has **zero**
  consumers of these routes. In objectui, `ShareDialog` was already dual-shape
  tolerant on all three routes it calls (`body.links ?? body.data`,
  `created.link ?? created.data`, and revoke never reads the body) — it needs no
  change, and it carried that tolerance precisely _because_ both shapes existed in
  the fleet.

  `SharedRecordPage` did need one fix, and it is the kind a shape-swap would have
  missed: it renamed the wire's `redactFields` to `redactedFields` only on the
  _bare_ branch, so on the already-enveloped dispatcher path the "fields are hidden
  by the owner" notice never rendered. Converting this surface would have spread
  that to every share page. Fixed in objectui#2980, which merges first.

  ## Guard

  **7 conformant / 0 ratcheted / 1 exempt**, from 6 / 1 / 1. The ratchet mechanism
  stays for the next module that needs it.

  `privateOk` also got narrowed to what its own doc always claimed — a literal `ok`
  at the **top** of a body, where it competes with `success`. The same literal
  inside `data` is payload, which is what a conformant revoke returns. Four
  self-test assertions pin both readings.

- d5749d7: refactor(types,rest,services,plugin-sharing): one shared writer for the response envelope, and `error.code` is enforced at compile time (#3973)

  `BaseResponseSchema` declares one envelope for every REST body the platform
  emits. It declared it once; the code that _wrote_ it was copied per route
  module. After #3843 and #3983 converted the last drifting one, seven modules
  each carried their own two-line `sendOk` / `sendError` pair — so the envelope's
  shape lived in fourteen places rather than one.

  `pnpm check:route-envelope` proved those seven copies agreed, which is why this
  is a cleanup rather than a bug fix. But a guard proves agreement; it does not
  create it. An eighth module starts by copying the pair again — not
  hypothetically: `share-link-routes.ts` was found already drifting by the
  repo-wide scan, and its drift had broken `client.shareLinks.create()` and
  `.list()` through `unwrapResponse` (#3983).

  ## What moved

  `sendOk` / `sendError` now live once, in `@objectstack/types`
  (`response-envelope.ts`), and all seven modules import them:

  | Module                                |
  | ------------------------------------- |
  | `service-storage/storage-routes.ts`   |
  | `service-settings/settings-routes.ts` |
  | `service-datasource/admin-routes.ts`  |
  | `rest/external-datasource-routes.ts`  |
  | `rest/package-routes.ts`              |
  | `service-i18n/i18n-service-plugin.ts` |
  | `plugin-sharing/share-link-routes.ts` |

  Placement was the open question in #3973, not design. `packages/spec` is
  schemas-only (Prime Directive #2), and the callers span `rest`, four
  `services/*` and one `plugins/*`, which rules out anything depending on them.
  `@objectstack/types` depends on nothing but `@objectstack/spec`, so every caller
  can reach it, and it is already where the repo puts a helper the HTTP boundaries
  share — `looksLikeInternalErrorLeak` (#3867) sits one file over and made the
  same argument first.

  The builders take a structural `{ status(n), json(body) }`, so the package
  imports no HTTP contract at all: `IHttpResponse` satisfies it, and so does the
  `any`-typed `res` the older modules carry.

  ## `error.code` is now checked by the compiler

  All seven copies typed the parameter `code: string`. ADR-0112 (#3841) closed the
  vocabulary — `ErrorCode` is `StandardErrorCode ∪ ERROR_CODE_LEDGER` — but an
  invented code was still caught only at runtime, by a conformance suite parsing a
  driven body, i.e. only on routes some test happened to drive.

  The shared `sendError` types `code` as `ErrorCode`, so an unregistered code now
  fails to compile, at every call site at once:

  ```ts
  sendError(res, 400, "NOT_A_REGISTERED_CODE", "invented");
  // Argument of type '"NOT_A_REGISTERED_CODE"' is not assignable to parameter of type 'ErrorCode'.
  ```

  This cost no call-site churn: every code the seven modules emit was already
  registered.

  ## `extra` is closed at the same place

  `sendError`'s last parameter is `Pick<ApiError, 'category' | 'httpStatus' |
'details' | 'requestId'>` — exactly what `ApiErrorSchema` declares beside `code`
  and `message`.

  It was `Record<string, unknown>` while `settings-routes` still hung `namespace` /
  `key` / `reason` / `fields` beside `code`. Those bodies passed every gate anyway:
  `ApiErrorSchema` is a plain `z.object`, so unknown keys were STRIPPED rather than
  rejected, and `envelopeViolations` inspects only the body's top level —
  conformant _by stripping_ rather than by declaration. #4224 moved that module
  onto `details`, which is what lets the parameter close here. Closing it at the
  shared builder is the part that lasts: an undeclared sibling is now a compile
  error in every module at once, rather than a key that quietly evaporates in
  whichever module reintroduces it.

  ## Nothing changes on the wire

  The seven pairs were identical modulo the optional `status` and `extra`
  parameters this one unions, and each module's driven conformance suite still
  parses its real bodies against the real spec schemas. One internal call site was
  rewritten: `package-routes` passed `details` positionally and now passes
  `{ details }`, producing the same `error.details` it always did.

  ## The guard got stronger

  `scripts/check-route-envelope.mjs` counts response write sites per module. A
  module that routes everything through the shared pair builds **none** itself, so
  the seven now declare `0 / 0 / 0` where they used to declare `2 / 1 / 1`, and the
  shared pair is pinned separately at `2 / 1 / 1` so the invariant stays total for
  the surface rather than per-module. What the count asserts is no longer "your two
  builders are the enveloped ones" but "you have no builders" — and a new route
  that hand-rolls a body still moves it off zero and fails.

- Updated dependencies [6a67d7a]
- Updated dependencies [48fcf70]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [3ec8186]
- Updated dependencies [b1863a5]
- Updated dependencies [270650f]
- Updated dependencies [956e7f9]
- Updated dependencies [3aef718]
- Updated dependencies [ffb003c]
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
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [2a37694]
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
- Updated dependencies [c39d713]
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
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [9881074]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [39eb01b]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [55bbefc]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
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
- Updated dependencies [bf478e1]
- Updated dependencies [ec796d5]
- Updated dependencies [77fadbf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [5c13368]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [d5749d7]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
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
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/objectql@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

## 17.0.0-rc.0

### Minor Changes

- f00d8d4: fix(sharing): remove the `full` access level — it promised delete/transfer/share and granted `edit` (#3865)

  `sys_sharing_rule.access_level` / `sys_record_share.access_level` offered three
  levels, the third documented as **Full Access (Transfer, Share, Delete)**. No
  code path granted transfer, re-share, or delete because of it: both enforcement
  sites matched `access_level in ('edit','full')`, so `full` was byte-equivalent
  to `edit`. An admin picking "Full Access" in Setup was told they had granted
  delete rights and had not — declared-but-unenforced metadata (ADR-0078,
  ADR-0049), the same defect that retired the `queue` recipient before it.

  Measured on showcase, a `full` recipient got `read: allowed`, `update: allowed`,
  `delete: DENIED` — and the denial came from `decidedBy=object_crud`, i.e. the
  object-level CRUD gate rejected the delete _before_ sharing was consulted at
  all. That is not an oversight to patch around; it is the model working. Record
  sharing widens **which rows** a principal reaches, never **which verbs** they
  may use — the same split Salesforce enforces (its sharing rules stop at
  Read-Only / Read-Write; Full Access is owner / hierarchy / Modify All only,
  never grantable by a rule) and Dataverse enforces by AND-ing every shared access
  right against the security role's own privilege. Delete and transfer belong to
  ownership, the ADR-0057 DEPTH scopes, and admin scope.

  **What changed**

  - `SharingLevel` (spec/security) and `ShareAccessLevel` (spec/contracts) are now
    `read | edit`. The `Field.select` on both objects offers the same two, so the
    Setup dropdown no longer shows the misleading option.
  - `SharingService.grant()` and `SharingRuleService.defineRule()` gained the
    access-level validation they never had: `full` normalises to `edit`, and an
    unrecognised level is a `VALIDATION_FAILED` (HTTP 400) instead of being
    persisted verbatim as a grant no gate would ever match.
  - Enforcement stays deliberately wider than authoring — the read/write gates
    still match `edit`/`full` — so a row written before this release keeps
    working. Narrowing them would silently _revoke_ access.
  - A boot backfill normalises stored `full` rows on both tables, and the
    `sharing-rule-access-level-full-to-edit` conversion rewrites declarative
    stacks at load, so nothing needs consumer action.

  **Migration.** None. `full` and `edit` were already behaviourally identical, so
  rewriting one to the other cannot change an access decision — unlike the OWD
  `sharingModel: 'full'` alias retired in ADR-0090 D4, which changed posture and
  had to be delegated to the author. A stack that still authors `accessLevel:
'full'` converts at load with a deprecation notice; stored rows normalise at
  next boot. Code that pinned the `ShareAccessLevel` type to `'full'` no longer
  compiles — use `'edit'`.

  Reviving a real per-record delete grant is a separate design (a capability mask
  AND-ed with object CRUD, plus the share-administration model that would have to
  authorise re-sharing), not a fourth enum member.

- 503be86: feat(security)!: reconcile the SharingRule authoring surface with the enforced runtime — rename `group` → `team`, add `business_unit`, prune `guest` + owner-type rules (#1878)

  The authoring `ShareRecipientType` enum had drifted behind the ADR-0090 D3
  rename and the enforced runtime: the runtime expands `team` (via
  `sys_team`/`sys_team_member`) and `business_unit`, but the authoring enum
  still offered the pre-rename `group` (silently skipped at seed time) and
  omitted the two live recipients. After this change **every authorable
  recipient and rule type is enforced** — nothing on the SharingRule surface
  validates and then silently does nothing (ADR-0078).

  - **`sharedWith.type: 'group'` → `'team'`** (wire-rename): the enum member is
    renamed to match the runtime vocabulary and now maps through the seed
    bootstrap to the live `TeamGraphService` expansion. Flat `sys_team`
    membership; enforced.
  - **`business_unit` added** to the authoring enum — exactly one business
    unit's members (no subtree; use `unit_and_subordinates` for the subtree).
    The runtime + bootstrap already enforced it; only the enum omitted it.
  - **`guest` removed** — it had no runtime recipient mapping. Anonymous access
    is served by the public-form grant and share links, not sharing rules.
  - **Owner-type rules removed** (`type: 'owner'`, `ownedBy`,
    `OwnerSharingRuleSchema` + its type export): they depend on live
    team/position membership, which the static materialiser cannot track, so
    they validated but never materialised a share. They return as an enforced
    form if membership-reactive re-materialisation is designed.
    `SharingRuleSchema` is now the criteria form; the `queue` recipient stays
    runtime-reserved (no `sys_queue` yet) and deliberately non-authorable.

  **Migration** (stale definitions now fail parse with the valid options listed):

  - `sharedWith: { type: 'group', … }` → `sharedWith: { type: 'team', … }`.
  - `sharedWith: { type: 'guest', … }` → delete the rule; expose the records
    via a public form or share link instead.
  - `type: 'owner'` rules → rewrite as a `type: 'criteria'` rule scoping the
    rows by field values (see the migrated examples:
    `share_open_tasks_with_manager` in app-showcase,
    `share_active_leads_with_manager` in app-crm), or use a scope-depth grant.

### Patch Changes

- aff9e56: fix(i18n): translate the platform packages' declared surface, and gate all nine bundles instead of one (#3762)

  Only `platform-objects` was wired into a translation-drift check. The other
  **eight** packages shipped a `scripts/i18n-extract.config.ts` that nothing ever
  ran — and four of them had already drifted out of sync with the schema, exactly
  the rot `pnpm check:i18n` exists to catch, one directory over.

  **Translated.** `plugin-security` (45 strings per locale), `plugin-webhooks`
  (15), `plugin-audit` (8), `plugin-sharing` (7) and `service-storage` (7) are now
  at **zero** untranslated declared strings in zh-CN / ja-JP / es-ES — 246
  translations. Most were newly _visible_ rather than newly missing: #3753 taught
  the coverage detector to walk action `params`, `resultDialog`, `listViews` and
  the rest of the declared surface, and these are what it found.

  Wording was harvested from the repo's own bundles wherever a string was already
  translated somewhere (1382 unambiguous source strings), so `Created At` reads
  `创建时间` here because that is what it reads everywhere else, rather than a
  fresh invention. Protocol tokens are deliberately left identical across locales:
  `GET` / `POST` / `PUT` / `PATCH` / `DELETE`, `ETag`, `ACL`, `URL`.

  **Gated.** `scripts/check-i18n-bundles.mjs` replaces the single-package
  `pnpm check:i18n` and checks all nine. It does not restate each package's
  command — it parses the one already documented in that config's own docstring
  and runs it, so the documented regenerate command and the gate cannot diverge.
  The coverage ratchet grows the same way, from `examples/*` to twelve configs;
  eight of them sit at zero, which makes it the strict gate there.

  **Fixed a real truncation bug it exposed.** `os lint --json` on a large config
  came out of a pipe cut off at exactly 65536 bytes — `console.log(big)` followed
  by `process.exit(1)` tears the process down before an async pipe write drains,
  while an interactive run (stdout is a TTY, written synchronously) looks perfect.
  Every scripted consumer silently got invalid JSON. `emitJson` in
  `packages/cli/src/utils/format.ts` waits for the write to drain and sets
  `process.exitCode` instead; `lint`, `i18n check` and `i18n extract` use it.
  Roughly 30 other CLI commands share the pattern and are not touched here.

  The nine documented regenerate commands also gain `--no-metadata-forms` (added
  in #3768), since the Studio metadata-form baseline belongs to `platform-objects`
  alone, not to a copy in every plugin.

  Not fixed here: `platform-objects`' own 77-per-locale gap is `apps.*` /
  `dashboards.*` navigation and widget labels, which live outside the `objects`
  subtree and cannot be scaffolded while the package extracts with
  `--objects-only`. That needs an emit decision first — tracked in #3762.

- 647ec8b: fix(driver-sql,sharing): an unsortable query loses its ORDER BY, not its rows (#3821)

  `SqlDriver.find()` already recovered from a SELECT projection naming a column
  the table lacks (retry with `select('*')`, the unknown field is simply absent
  from each row). The identical failure one clause over — an **ORDER BY** column
  the table lacks — fell through to `return []`. Because `count()` is a separate
  statement, the list endpoint answered `HTTP 200` with `records: []` and
  `total: 3`: the rows are there, none are shown, nothing is logged. Same family
  as the `$`-param footgun closed by #2926.

  It surfaced through the Console's sharing-rule **recipient picker**, which
  never listed a single candidate. The client mangled `'name asc'` into
  `0 n,1 a,2 m,…` (fixed separately in objectui) and the driver turned that into
  "no users exist", so no sharing rule could be authored from the UI at all.

  Rows now outrank their order: the retry ladder drops the projection first (the
  likelier culprit and the cheaper thing to lose), then the sort, then gives up.
  A query that cannot be sorted comes back **unordered instead of empty**. Errors
  that are not about an unknown column still propagate untouched.

  **A rule authored in Setup now actually applies — and switching it off actually
  withdraws access.** Writing a `sys_sharing_rule` rebound the per-record hooks,
  which only makes the rule reach records written FROM THEN ON. So an admin who
  created a rule and enabled it saw nothing happen: the recipient's list stayed
  empty until somebody happened to touch each record. The reverse was worse —
  switching a rule OFF, or deleting it, left every grant it had already issued in
  place, and boot backfill only reconciles ACTIVE rules, so those grants outlived
  restarts while the UI displayed the rule as disabled. The reconcile was reachable
  only through `POST /sharing/rules/:id/evaluate`, which the Console never calls.

  Each non-system write to `sys_sharing_rule` now also reconciles that rule's
  grants, chained behind the existing rebind: insert/update run the same
  diff-based `evaluateRule` the REST endpoint runs (it purges when the rule is
  inactive), and delete purges directly via the new
  `SharingRuleService.revokeRuleGrants` — `evaluateRule` can't help there because
  the row is already gone (`RULE_NOT_FOUND`), which is also why a rule deleted
  through the plain data API used to orphan its grants. Seeding and package
  bootstrap write with `isSystem` and are skipped; `kernel:bootstrapped` already
  backfills those. Reconciliation is best-effort and never fails the write.

  **The dialog's help text was engineering notes, shown to tenant admins.** The
  field descriptions on `sys_sharing_rule` render under each input in Setup, and
  they cited ADR numbers, table and column names (`parent_business_unit_id`,
  `sys_business_unit`), enum machine values the dropdown never shows
  (`business_unit`, `team`), a third-party library (better-auth), and engine
  vocabulary ("evaluation", "lifecycle"). Several were also stale: they still told
  admins to type an id or hand-write a `FilterCondition` after those inputs became
  a record picker and a visual builder. Rewritten for the reader who actually sees
  them — the implementation detail was already in the object's doc comment, which
  is where it stays. `criteria_json`'s LABEL loses its "(FilterCondition JSON)"
  suffix for the same reason, and `active` can finally say what it now does:
  turning it off withdraws the access.

  Also refreshes the `sys_sharing_rule` help text in the zh-CN / ja-JP / es-ES
  translation bundles, which still described `recipient_type` in terms of
  `department` (the enum value is `business_unit`) and told admins to enter a
  queue name for `recipient_id` (`queue` was removed in ADR-0078). The es-ES
  option labels for `position` / `unit_and_subordinates` were translated as
  "rol" — corrected to "Puesto" / "Unidad de negocio y subordinados".

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [6169615]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [a749273]
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
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [48c110e]
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
- Updated dependencies [5d4de37]
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
- Updated dependencies [e1fa8d5]
- Updated dependencies [402f534]
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
- Updated dependencies [8e08bc3]
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
- Updated dependencies [5f0852f]
- Updated dependencies [cde1975]
- Updated dependencies [20cb232]
- Updated dependencies [e231abb]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [54f479a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/objectql@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0
  - @objectstack/objectql@16.1.0

## 16.0.0

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

- 62a2117: **Split the overloaded `managedBy: 'system'` bucket with an explicit `engine-owned` value (ADR-0103 addendum, #3343).** ADR-0103 deferred the enum split ("revisitable later as a rename") because a new `managedBy` value would fall through to the fully-editable `platform` default on deployed Console clients. Both reasons against it are now retired — the server-side write guard / `apiMethods` reconciliation / `/me/permissions` clamp make that fallthrough cosmetic (the write is rejected regardless of what the client renders), and objectui#2712 closed the UI union — so v16 lands it, **additively**.

  - **New enum value `engine-owned`** with the same all-locked default affordance row as `system` (`create/import/edit/delete: false`, `exportCsv: true`). It joins `ENGINE_OWNED_BUCKETS` (the engine write guard) and `GUARDED_WRITE_BUCKETS` (the `/me/permissions` clamp); the guard, `reconcileManagedApiMethods`, and the clamp mechanisms are unchanged — `engine-owned` is an explicit member of the set they already covered by resolved affordance.
  - **20 objects relabelled `system → engine-owned`** — the ones the engine owns end to end and that declared no write-opening `userActions` (the metadata store, jobs, approval runtime rows, sharing rows, `sys_automation_run`, the messaging delivery/receipt pipeline, `sys_secret`, settings). One-line, behaviour-identical per object.
  - **8 admin/user-writable objects keep `managedBy: 'system'`** (the RBAC link tables, `sys_user_preference`, `sys_approval_delegation`, the messaging config grids) — `system` now reads as "engine-managed schema, writable via `userActions`".

  Behaviour-, enforcement- and wire-identical: resolved affordances, the guard verdict, the 405 `apiMethods` reconciliation, and the permissions clamp are the same before and after — this is a self-documenting relabel, not a policy change. No data migration (`managedBy` is schema metadata) and no code branches on the `'system'` literal. Retiring the overloaded `system` entirely (moving the 8 writable objects to a dedicated bucket) is a breaking rename deferred to v17.

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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [fdc244e]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [674457a]
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
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/objectql@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0

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
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [674457a]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/objectql@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

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
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [fdc244e]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [2ea08ee]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
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
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/objectql@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/objectql@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Minor Changes

- f531a26: feat(plugin-sharing): sys_sharing_rule provenance + seed-not-clobber (#2909 P0/T1). The object gains readonly `managed_by` (unified A4 tri-state platform/package/admin) and `customized` columns; declared rules seed with `managed_by: 'package'`. defineRule in seed mode adopts pristine/legacy rows (package upgrades stay deliverable) but never overwrites admin-authored or customized rows — an admin's `active: false` on an over-sharing rule now survives redeploys instead of being resurrected at boot. A beforeUpdate hook stamps `customized` on any non-system edit of a seeded rule. Deliberately NO write gate: sharing rules remain a first-class admin authoring surface (ADR-0094 addendum tradeoff).

### Patch Changes

- f531a26: feat(kernel): add `kernel:bootstrapped` lifecycle anchor — the phase that fires after every `kernel:ready` handler has settled but before `kernel:listening` (HTTP socket open). `kernel:ready` handlers run sequentially in plugin-registration order, so a handler that consumes data produced by a later-starting plugin (e.g. the security bootstrap seeds `sys_position`; the app plugin's seed loader inserts records) would race the very rows it needs. `kernel:bootstrapped` is the correct anchor for reconcile/backfill work: every producer's ready handler has finished by the time it fires. Both `ObjectKernel` and `LiteKernel` trigger it. The sharing-rule boot backfill moves from `kernel:listening` to `kernel:bootstrapped` (semantics-only; behaviour unchanged).
- f531a26: fix(security): guard the `owner_id` ownership anchor and scope bulk writes to owner-visible rows (#3004, #2982)

  Two write-path holes on the row-ownership anchor (`owner_id`), the column OWD
  row-level scoping keys off to decide who may update/delete a record.

  - **#3004 — client-writable, unguarded `owner_id`.** The anchor is deliberately
    not `readonly` (ownership is transferable), so the static-readonly strip never
    covered it and FLS doesn't gate it by default. A non-privileged writer could
    therefore `insert` a record under someone else's name (forge) or `update` one
    to a new owner (transfer / disown), evading the owner gate that governs
    update/delete. The security middleware (plugin-security step 3.5) now treats
    `owner_id` as system-managed for non-privileged writers: on insert an empty
    value is auto-stamped to the acting user (batch rows too — previously only the
    single-record path stamped, leaving bulk-inserted rows NULL-owned and
    invisible to their creator), and a supplied foreign owner is denied; on update
    a supplied `owner_id` is a transfer/disown and is denied — the unchanged no-op
    echo of a form save is tolerated via a pre-image compare, and a bulk
    change-set carrying `owner_id` fails closed. A non-scalar `owner_id`
    (array/object) is rejected outright rather than string-coerced, and the
    change-set membership test uses own-property semantics so a polluted
    prototype cannot spoof an ownership write. Both require the transfer grant
    (`allowTransfer`, or `modifyAllRecords` which implies it) to proceed. System
    context (`ctx.isSystem`) stays fully exempt (OAuth provisioning / cron
    snapshots / seed claims / migrations), and under delegation both principals
    must hold the grant (ADR-0090 D10 intersection). Note a REST **import** runs
    under the importer's own context (not `isSystem`), so a non-privileged user
    importing a CSV whose `owner_id` column names other users is correctly denied
    unless they hold the transfer grant — administrators (who carry
    `modifyAllRecords`) are unaffected.

  - **#2982 — bulk writes skipped owner scoping on OWD-`private` objects.** A
    `update({ multi: true })` / bulk delete rebuilt the driver AST from
    `options.where` AFTER the middleware chain, discarding the owner/RLS write
    filter that plugin-sharing (`buildWriteFilter`) and plugin-security compose
    onto `opCtx.ast` — so a member's bulk write hit every matching row, including
    peers'. The engine now seeds `opCtx.ast` from the caller's predicate BEFORE the
    chain (the same seam reads use) and hands the middleware-composed AST to
    `driver.updateMany` / `driver.deleteMany`, so bulk writes are constrained to the
    rows the caller may edit — matching single-id write behavior. `delete` now
    applies the same scalar-`id` guard `update` already had, so an id-list bulk
    delete (`where: { id: { $in: […] } }, multi: true`) is owner-scoped too, and
    both multi branches fail CLOSED (throw) rather than silently rebuilding an
    unscoped predicate if the row-scoping AST is ever absent.

    Consequences of routing bulk writes through the AST: the anti-oracle
    predicate guard now also applies to bulk `update`/`delete` (a bulk write
    filtering on an FLS-unreadable field is rejected, as reads already are), and a
    principal-less (no-`userId`, non-system) bulk write on an owner-scoped object
    now correctly affects zero rows instead of all of them.

  Proven end-to-end on the real showcase app
  (`packages/qa/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts`) and pinned
  in the ADR-0096 authz-conformance ledger (`ownership-anchor-guard`,
  `bulk-write-owner-scoping`).

- f531a26: fix(security): close three execution-surface authz holes surfaced by the #2849 class sweep (#2980, #2981, #2982)

  Three independent, confirmed-exploitable defects where an execution surface
  ignored the caller's identity or fell open on a missing one. Each is fixed at
  its own enforcement point; none change behaviour for correctly-scoped callers.

  - **#2980 — reports IDOR + scheduled-report RLS bypass.** `ReportService`
    discarded the caller's context and read/wrote `sys_saved_report` with a system
    context, so any authenticated user could read, delete, or overwrite any saved
    report by id (cross-owner / cross-tenant), and `listReports` enumerated all
    owners. `getReport`/`deleteReport`/`saveReport`/`listReports` are now
    owner-scoped (system read of the protection-locked metadata object, but
    authorization enforced by owner match); create/overwrite can no longer spoof
    ownership. Scheduled dispatch no longer runs `isSystem` (which emailed the
    target object's entire table past the owner's RLS): it resolves the owner to a
    real RLS-bearing context via a new `resolveOwnerContext` seam and **fails
    closed** (skips + marks the schedule failed) when the owner can't be resolved,
    rather than running elevated. Wiring that resolver is the reports-surface
    consumer of ADR-0073's user-less identity resolution.

  - **#2981 — knowledge/RAG retrieval fall-open.** `applyPermissionFilter` returned
    every hit when the context was missing _or_ system. A missing identity is no
    longer treated as a grant: object-backed hits fail closed (dropped, keeping
    ACL-less file/http hits), and only an **explicit** system context passes
    through. Closes the agent path where an omitted `ToolExecutionContext.actor`
    yielded unfiltered semantic search over the whole corpus.

  - **#2982 — bulk-write OWD gap.** `update({multi:true})` / `deleteMany` had no
    single id to `canEdit`-gate, so owner scoping was skipped on private (and
    public_read) objects. A new `SharingService.buildWriteFilter` (the edit-set
    analogue of `buildReadFilter`) is AND-ed into the write AST for multi writes,
    constraining them to rows the caller may edit — including the on-behalf-of
    delegator intersection.

  Tracked as the motivating evidence of ADR-0096 (execution-surface identity
  admission); the mechanism that would prevent the class structurally is separate.

- f531a26: fix(plugin-sharing): reconcile every active sharing rule once at boot (#2926 ③). Rule grants are materialized by write hooks, which deliberately skip `isSystem` writes — so seed-loader records never produced `sys_record_share` rows and demo data shipping with matching sharing rules was broken out of the box until each record was touched at runtime. The boot backfill runs on `kernel:listening` — the phase the kernel fires only after every `kernel:ready` handler has settled, including the AppPlugin seed loader — so the reconcile sees the seeded rows rather than racing them. It is idempotent (diff-based reconcile) and best-effort per rule so one broken rule cannot block startup.
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
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [d75c7ac]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/objectql@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/formula@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/objectql@15.0.0
  - @objectstack/formula@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0
  - @objectstack/objectql@14.8.0

## 14.7.0

### Minor Changes

- d6a72eb: Field metadata gains a `widget` override (`FieldSchema.widget`) — names a
  registered form component (resolved as `field:<widget>`) to render a field with,
  overriding the default widget derived from `type` and degrading back to it when
  unregistered. The generic object form already honored this hint (objectui
  `ObjectForm`/`form.tsx` resolve `widget || type`); this promotes it to a
  first-class, liveness-classified authoring property so any config object can ask
  for a picker instead of a raw input.

  `sys_sharing_rule` uses it so the Setup **New Sharing Rule** form is
  pick-not-type instead of asking admins to hand-enter machine data:

  - `object_name` → `object-ref` (choose a registered object by name)
  - `criteria_json` → `filter-condition` (visual criteria builder scoped to the
    chosen object's fields; `dependsOn: object_name`)
  - `recipient_id` → `recipient-picker` (record picker whose target follows
    `recipient_type`; `dependsOn: recipient_type`)

  Also removes the `queue` recipient type: it is declared-but-unenforced (the
  evaluator expands no users for it), so offering it authored a silently-inert rule
  (ADR-0078). i18n bundles regenerated. Requires the matching objectui widgets; the
  fields degrade to their `type` renderer where those aren't loaded.

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/objectql@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
- Updated dependencies [8f4a261]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/objectql@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0

## 14.5.0

### Minor Changes

- f70eb2c: ADR-0090 D10 — agent/service intersection runtime. When a request's principal acts `onBehalfOf` a user (an AI agent or a service acting for a person), the effective permission is now the INTERSECTION of the principal's own grants and the delegator's grants — never the union. Confused-deputy prevention: an over-privileged agent may never see or touch anything the user it stands in for could not, and vice-versa. Previously `principalKind:'agent'` / `onBehalfOf` was a P1 context shape the evaluator did not read.

  The intersection is applied at EVERY axis, gated on the presence of the delegation link so the ordinary (non-delegated) path is byte-identical:

  - **plugin-security** middleware — the delegator's effective permission sets are reconstructed once (fail-CLOSED if the delegator no longer exists — a dangling link is denied, not resolved to the additive baseline) and AND-composed into: the required-capability gate, object CRUD, field-level security (read mask + write forbid + predicate-oracle guard), the row-level `using` pre-image on by-id writes, the `check` post-image, and the RLS read-filter injection. View/Modify-All only survives when BOTH principals hold it.
  - **plugin-sharing** middleware — the OWD/record-sharing owner-match is IDENTITY-scoped, so it re-runs the visibility filter (and `canEdit`) under the delegator's own identity + depth and AND-s it in. An agent with View-All acting on behalf of a plain member therefore sees exactly that member's own rows — not everyone's, and not nothing.
  - **explain engine** — every layer reports the narrower verdict when `onBehalfOf` is set, so the D6 access explanation stays truthful for delegated principals; a dangling delegator is reported as a fail-closed deny.

  First-cut scope (documented in code + covered by tests): one delegation hop (the `onBehalfOf` shape carries a single delegator, and any single-hop intersection is a safe lower bound on a true multi-hop chain); tenant-scoped substitution bags (`tenantId`, `org_user_ids`, `email`) are inherited from the live principal, while person-specific membership bags left unresolved narrow rather than widen. The agent grant-ceiling lint (D10 rule 2) is a follow-up — the runtime intersection already caps the agent regardless of what its own sets carry, and a lint needs an agent-set designation convention that does not yet exist.

- 01274eb: **Security fix (#2851): the share-link HTTP routes no longer trust spoofable identity headers, and the service enforces ownership.**

  The raw-app share-link routes (`POST/GET/DELETE /api/v1/share-links`, registered by `SharingServicePlugin`) derived the caller from `x-user-id` / `x-tenant-id` request headers, and the service ignored the caller context on revoke. So a client could forge link attribution, enumerate another user's link tokens (`GET ?createdBy=<victim>` → tokens that resolve records under a system context, bypassing RLS), and revoke arbitrary users' links.

  Fixes:

  - **Verified identity.** `SharingServicePlugin` now derives the caller (and their positions/permissions) from the platform's verified resolution (`resolveAuthzContext` — session / API key / OAuth), never from headers. The route default is SECURE (anonymous). Create / list / revoke require a signed-in principal (401 otherwise); the public `/:token/resolve` route stays public (the token is the authorization) but keys its `audience: 'signed_in'` check off the verified session rather than a spoofable `x-user-id`.
  - **List scoping.** `GET /api/v1/share-links` is forced to the caller's own links — a client can no longer pass `?createdBy=<victim>` to enumerate others' tokens.
  - **Revoke ownership.** `revokeLink` now requires the caller to be the link's creator (system/internal callers bypass). Previously the caller context was ignored, so anyone could revoke any link (sharing DoS).
  - **Create access check.** `createLink` verifies the record is visible to the caller (read under the caller's own RLS) before minting a link — you can only share a record you can actually see. Internal (system) callers are unchanged.

  `ShareLinkExecutionContext` gains optional `positions` / `permissions` so the record-access check evaluates the real principal.

  Found by an adversarial security review of the request→ExecutionContext trust boundary (companion to the settings-routes fix, #2848).

### Patch Changes

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
  - @objectstack/objectql@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0

## 14.4.0

### Minor Changes

- 82e745e: ADR-0091 L1 — grant validity windows: effective-dated assignments, resolution-time filtering, explain expired state, authoring lint.

  - **plugin-security (objects)**: `sys_user_position` and `sys_user_permission_set` gain the D1 lifecycle columns — `valid_from`, `valid_until` (half-open `[from, until)`, UTC; null = unbounded, existing rows unchanged), `reason`, `delegated_from`, `last_certified_at`, `certified_by`.
  - **core**: new shared predicate `isGrantActive` / `isGrantExpired` (`@objectstack/core`), and `resolveAuthzContext` now filters BOTH grant tables through it (D2, fail-closed — an expired unscoped `admin_full_access` grant no longer derives `platform_admin`). Present-but-unparseable bounds fail closed.
  - **plugin-security (explain)**: `buildContextForUser` applies the same filter and returns `expiredGrants`; the principal layer reports the dedicated "held until … — expired" contributor state so "why did access disappear" is self-answering. Spec `ExplainLayerSchema` contributors gain an optional `state: 'active' | 'expired'`.
  - **plugin-sharing**: `PositionGraphService.expandPositionUsers` filters expired holders — sharing-rule recipients stop including them at resolution time.
  - **lint (D7)**: two new error rules over seed data — `security-grant-expired-at-authoring` (a `valid_until` in the past, or unparseable, is a grant that can never resolve) and `security-delegation-missing-reason` (a `delegated_from` row without `reason` breaks the D3 dual audit). Also re-exported the missing `SECURITY_MASTER_DETAIL_UNGRANTED` constant.

  No background job is involved anywhere — per ADR-0049, an expired grant simply stops resolving, in every edition.

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/objectql@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [ff648ad]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/objectql@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0
  - @objectstack/objectql@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/objectql@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Patch Changes

- 0a8e685: ADR-0090 permission-model zoo + docs alignment.

  **Showcase (`@objectstack/example-showcase`)** now exercises the full Permission
  Model v2 authoring surface and is guarded by a new runtime dogfood test
  (`showcase-permission-zoo.dogfood.test.ts`): typed `definePosition`/
  `definePermissionSet`/`defineSharingRule` factories; six flat positions (the
  stale pre-D3 `parent` fields are gone); permission sets covering CRUD+FLS+RLS,
  org-depth read/write asymmetry (`readScope: 'org'` / `writeScope: 'own'`),
  View-All (auditor) and Modify-All (ops) bypasses, `systemPermissions`
  (`setup.access`), the `isDefault` everyone-suggestion (incl. personal-data
  grants on the `private`-OWD note object), a guest-safe set for the `guest`
  anchor (D9), and a delegated-administration `adminScope` bounded to a seeded
  `sys_business_unit` subtree (D12). Objects gain `externalSharingModel` dials
  (D11). A committed `access-matrix.json` opts the showcase into the D6 snapshot
  gate. Hierarchy depths (`own_and_reports`/`unit`/`unit_and_below`) are
  deliberately NOT authored — they are enterprise (`hierarchy-security`) and the
  open runtime fails closed; BU-shaped visibility is demonstrated via the
  enforced `unit_and_subordinates` sharing-rule recipient instead.

  **`@objectstack/spec`**: `defineStack` strict cross-reference validation no
  longer rejects permission grants or seed datasets that target platform-provided
  objects (`sys_`/`cloud_`/`ai_` prefixes) — a delegated-admin set carrying CRUD
  on the RBAC link tables (ADR-0090 D12) and an app seeding the business-unit
  tree are legitimate shapes; the typo net stays intact for the stack's own
  objects. Stale pre-ADR-0090 vocabulary in zod docstrings (rls/territory/
  sharing/tool/agent) is rewritten; the auto-generated references (including the
  previously missing `security/explain.mdx`) are regenerated.

  **Docs**: `protocol/objectql/security.mdx` rewritten to the v2 model (no
  profiles, positions, canonical OWD four + D1 private default +
  `externalSharingModel`, position-scoped RLS, enforced sharing recipients);
  `isProfile` scrubbed from every authoring example; the dead
  `/docs/references/identity/role` link fixed; implementation-status and
  plugin READMEs aligned. Remaining rename misses are tracked in #2722
  (RLSUserContext.role), #2723 (portal `profiles`), #2724 (sys_record_share
  `role` enum).

- afa8115: ADR-0090 vocabulary leftovers (#2722, #2723, #2724) — the last "role"/"profile"
  surfaces are renamed one-step, no aliases (launch-window discipline).

  **`PortalSchema.profiles` → `positions`** (#2723, D2 removal miss). FROM → TO:
  `profiles: ['client_portal_user']` → `positions: ['client_portal_user']` —
  portal admission is now position-scoped; use the built-in `guest` position
  for anonymous-only portals. The removed `profiles` key is a loud tombstone:
  authoring it fails with the prescription instead of silently stripping. The
  showcase Client Portal is migrated and now admits a real declared position
  (`client_portal_user`).

  **`RLSUserContextSchema.role` → `positions`** (#2722, D3 rename miss). FROM →
  TO: `role: string | string[]` → `positions: string[]` — matches the runtime
  shape the RLS compiler resolves as `current_user.positions`. No runtime
  consumer read the old field (the compiler has its own context type); public
  export names are unchanged.

  **`sys_record_share.recipient_type` `'role'` → `'position'`** (#2724, D3).
  The record-share enum and the `ShareRecipientType` contract type now match
  the already-migrated spec zod enum. No stored-data migration is required:
  no reader expands non-`user` record-share rows (rules materialize per-user
  grants), so legacy `'role'` rows were inert. The plugin-sharing translation
  bundles are regenerated — fixing the pre-stale `sys_sharing_rule` options
  block too — with zh-CN/ja-JP labels patched per the generated-file contract
  (业务单元及下级 / ビジネスユニットと下位階層).

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [afa8115]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/objectql@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0

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

### Patch Changes

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [a1766fe]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/objectql@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/objectql@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/objectql@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
- Updated dependencies [1dd5dfd]
  - @objectstack/spec@12.4.0
  - @objectstack/objectql@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [5a0da03]
- Updated dependencies [e7eceec]
  - @objectstack/objectql@12.3.0
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- 4f5b791: Wire three more Studio-authored metadata surfaces at runtime (#2605 — the
  "declared but never wired" family, following the #2596 hooks template).

  **Authored actions now execute (#2605 item 1).** `engine.executeAction`'s map
  was only ever populated from the app bundle at boot, so a published `action`
  row (standalone or embedded in an authored object's `actions[]`) was stored
  and listed but never executable — before OR after a restart. Now:

  - `AppPlugin` installs a QuickJS-sandboxed default action runner at boot
    (`engine.setDefaultActionRunner`), the action-path twin of the #2596 hook
    body runner. Opt out with `OS_DISABLE_AUTHORED_ACTIONS=1`.
  - `ObjectQLPlugin` re-registers runtime-authored actions from their
    `sys_metadata` rows under `packageId: 'metadata-service'` at
    `kernel:ready`, on `metadata:reloaded`, and on `action`/`object` protocol
    mutations — saves, publishes, edits, and deletes take effect live.
    Package-artifact actions are excluded (AppPlugin owns those; re-registering
    would clobber their handlers).

  **Authored translations reach the i18n runtime (#2591).** `translation`
  metadata items (single-locale `AppTranslationBundle` payloads; locale from
  `_meta.locale`, a top-level `locale`, or a BCP-47-shaped item name) now load
  into the i18n service as a separate authored layer that overlays static
  bundles. Both adapters carry the layer — service-i18n's `FileI18nAdapter`
  AND the kernel's in-memory fallback (`createMemoryI18n`), which is what dev
  and standalone stacks actually run. The shared sync
  (`wireAuthoredTranslationSync`, exported from `@objectstack/core`, wired by
  the runtime's AppPlugin and by I18nServicePlugin with single-owner
  semantics) runs at `kernel:ready`, on `metadata:reloaded`, and on
  `translation` protocol mutations, with clear-then-reload semantics so
  deleted items/keys stop resolving instead of lingering in the deep-merged
  map.

  **Sharing rules created at runtime bind without a restart (#2592).**
  `bindRuleHooks` was boot-only, so the first rule authored at runtime for an
  object with no boot-time rule silently never evaluated (rule authoring is a
  data insert — `metadata:reloaded` never fires). The sharing plugin now binds
  afterInsert/afterUpdate/afterDelete triggers on `sys_sharing_rule` that
  unbind + re-bind the rule-hook package from a fresh `listRules()`, serialized
  so overlapping writes can't leave a stale snapshot bound, and fail-safe so a
  rebind failure never fails the rule write.

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/objectql@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/objectql@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [2d567cb]
- Updated dependencies [24b62ee]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [c2fdbf9]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/objectql@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0

## 11.10.0

### Patch Changes

- 6a9397e: Retire the deprecated `compactLayout` alias for `highlightFields` (framework#2536, closes the ADR-0085 deprecation window).

  - `ObjectSchema` no longer declares `compactLayout`: `create()` rejects it like any unknown key; lenient `parse()` strips it (no silent aliasing).
  - The parse-time alias AND the `highlightFields → compactLayout` back-fill transition mirror are removed from `normalizeSemanticRoleAliases`. Served metadata now carries the canonical key only.
  - All remaining first-party authors (27 system objects across plugin-audit / approvals / security / sharing / webhooks / service-storage / automation / messaging / realtime — missed by the #2521 sweep, caught by the type gate) renamed to `highlightFields`.
  - The downstream smoke pin moves to hotcrm v1.2.2 (hotcrm#424: same rename + deps ^11.7.0).
  - Consumers were switched in objectui#2168 and shipped via the console pin bump (#2526); this closes the window scheduled there. The dogfood mirror assertion (#2528) flips to `compactLayout: undefined` in this same change, per the plan it carried.

  Version note: minor, not major — the key was deprecated-with-alias for a full release window, all first-party consumers/authors are migrated, and the spec api-surface gate reports no export changes (same documented-exception path as the ADR-0085 removals in 11.7.0). External metadata still authoring `compactLayout` will now fail `create()` loudly with the standard unknown-key error naming the key.

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/objectql@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/objectql@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/objectql@11.8.0
  - @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0
  - @objectstack/objectql@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/objectql@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/objectql@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/objectql@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/objectql@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/objectql@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [13dbcf2]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/objectql@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [4d99a5c]
- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [61d441f]
- Updated dependencies [c224e18]
- Updated dependencies [d616e1d]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [359c0aa]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/objectql@11.0.0
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- Updated dependencies [211425e]
  - @objectstack/objectql@10.3.0
  - @objectstack/spec@10.3.0
  - @objectstack/core@10.3.0
  - @objectstack/formula@10.3.0
  - @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/objectql@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/objectql@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Major Changes

- e16f2a8: **BREAKING:** the system object `sys_department` is renamed to `sys_business_unit`
  — object + member table (`sys_department_member` → `sys_business_unit_member`),
  fields, and i18n — with **no compatibility alias**. Any deployment holding
  `sys_department` rows, or metadata that references the object by name (lookups,
  list views, queries, sharing/approval scopes), must migrate to `sys_business_unit`.
  A renamed shipped system object is a breaking change to the platform's public
  data surface, so this lands as a **major**. Verified per ADR-0059's pre-publish
  hotcrm gate: no published downstream consumer references the old name.

  ADR-0057 — ERP authorization core. Adds permission-grant access DEPTH
  (`own`/`own_and_reports`/`unit`/`unit_and_below`/`org`), renames `sys_department`
  → `sys_business_unit` (no aliases — see BREAKING above), introduces the platform-owned
  `sys_user_position` assignment, and seeds stack-declared `roles`/`sharingRules` into
  `sys_position`/`sys_sharing_rule` at boot (closes #2077). Hierarchy-relative scopes are
  delegated to a pluggable `IHierarchyScopeResolver` (open edition fails closed to
  owner-only; `defineStack` errors without `requires: ['hierarchy-security']`). Also
  fixes a latent over-grant where `engine.find({ filter })` was ignored (driver reads
  `where`) — normalized `filter`→`where` in the engine.

### Minor Changes

- 30c0313: Add `sys_user.primary_business_unit_id` projection (ADR-0057 addendum D12).

  Adds a denormalised `primary_business_unit_id` lookup to `sys_user`, maintained
  by plugin-sharing as a projection of `sys_business_unit_member.is_primary`
  (insert/update/delete hooks + a boot-time backfill). This makes "pick people by
  business unit" — the Dataverse _filtered lookup_ / ServiceNow _reference
  qualifier_ interaction — expressible as a plain `where: { primary_business_unit_id: X }`
  (and thus as a `lookupFilters` picker filter) with **zero** query-engine change,
  without traversing the membership junction. `sys_business_unit_member` remains
  the effective-dated, matrix-friendly source of truth; the new column is a
  maintained projection, not a second source. Home is plugin-sharing (always
  loaded, owns the BU graph) rather than plugin-org-scoping, so the projection
  works in single-tenant deployments too. Picker filtering by BU is therefore an
  **open** (non-enterprise) capability — only hierarchy _rollup_ stays paid.

- cfd86ce: ADR-0058 — expression & predicate surface unification. Adds the canonical
  CEL→FilterCondition pushdown compiler in `@objectstack/formula`
  (`compileCelToFilter`, `isPushdownableCel`, `lowerCelAst`) plus an in-memory
  `matchesFilterCondition` backend (one AST, three backends). `plugin-security`
  (RLS `using`, via a SQL bridge) and `plugin-sharing` (`celToFilter`) cut over to
  it, retiring the bespoke regex/field-equality front-ends. Compound sharing
  conditions now compile and enforce end-to-end (closes #1887). The RLS `check`
  clause is now enforced on the write post-image (insert/by-id update), fail-closed.
  Non-pushdownable predicates (arithmetic, functions, subqueries, cross-object) are
  an authoring compile error, never silently dropped (ADR-0049/0055).

### Patch Changes

- ce13bb8: Single-tenant audit follow-ups (ADR-0057):

  - **`sys_member` / `sys_invitation`**: make `organization_id` optional (same class as the
    sys_business_unit/sys_team fix #2178). Single-tenant has no org row and no auto-stamp;
    multi-tenant still auto-stamps via OrgScopingPlugin with null-org rows hidden by
    tenant-isolation RLS (fail-closed). Completes the org-scoped identity graph's
    single-tenant consistency.
  - **`BusinessUnitGraphService.headOf()`**: add the missing `orgScope()` org filter (it
    queries under SYSTEM_CTX, bypassing RLS, so the scope is the only isolation). Previously
    `headOf(buId)` read a business unit's `manager_user_id` by id alone — a cross-organization
    leak in multi-tenant. Now consistent with `descendants()`. +regression test.

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/objectql@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Minor Changes

- 2365d07: feat(sharing): configurable role-hierarchy widening — `unit_and_subordinates` recipient (ADR-0056 D6)

  Role-hierarchy access widening ("a manager sees records shared with their team") is now
  **implemented and configurable per sharing rule**, not a hardcoded no-op. The
  `unit_and_subordinates` recipient (declarable on `sys_sharing_rule.recipient_type`) expands,
  at evaluation time, to the named role **plus every subordinate role** by walking the
  `sys_position.parent` hierarchy via a new `PositionGraphService` (mirroring the department/team
  graphs; cycle-safe). Previously `Role.parent` was declared but never consumed — a silent
  no-op flagged by the ADR-0056 audit. This is the Salesforce "grant access using hierarchies"
  model expressed declaratively: each rule chooses whether to roll up the hierarchy. Unit-proven
  (role-graph traversal, subordinate-user expansion, cycle safety); the recipient is added to
  the authoring select + the `SharingRuleRecipientType` contract.

### Patch Changes

- e7f6539: feat(spec,sharing): canonical OWD vocabulary on `object.sharingModel` (ADR-0056 D1)

  Reconciles the Org-Wide-Default naming so authors use ONE vocabulary. `object.sharingModel`
  now accepts the canonical OWD names — `private` | `public_read` | `public_read_write` |
  `controlled_by_parent` — alongside the legacy `read` / `read_write` / `full` aliases (kept,
  non-breaking). The sharing runtime maps them onto the three enforced behaviours
  (`public_read` ≡ legacy `read` = everyone reads / owner writes; `public_read_write` =
  unscoped). Unknown values remain rejected by the enum (authoring-time, fail-closed). The
  showcase announcement now declares the canonical `public_read`, exercised end-to-end by the
  public-read dogfood proof.

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/objectql@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
- Updated dependencies [e2b5324]
- Updated dependencies [fd07027]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/objectql@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/objectql@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [44c5348]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [bfa3102]
- Updated dependencies [134043a]
- Updated dependencies [67c29ee]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/objectql@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [76ac582]
- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
- Updated dependencies [884bf2f]
  - @objectstack/objectql@9.8.0
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/objectql@9.7.0
- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
- Updated dependencies [b04b7e3]
- Updated dependencies [d13df3f]
  - @objectstack/spec@9.6.0
  - @objectstack/objectql@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/objectql@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0
  - @objectstack/objectql@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [c1dfe34]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [3e675f6]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/objectql@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [6259882]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
- Updated dependencies [b10aa78]
- Updated dependencies [2796a1f]
  - @objectstack/spec@9.3.0
  - @objectstack/objectql@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/objectql@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/objectql@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/objectql@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/objectql@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/objectql@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [e6374b5]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
- Updated dependencies [345e189]
  - @objectstack/spec@8.0.0
  - @objectstack/objectql@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
- Updated dependencies [ac1fc4c]
  - @objectstack/objectql@7.9.0
  - @objectstack/spec@7.9.0
  - @objectstack/core@7.9.0
  - @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [a75823a]
- Updated dependencies [4fbb86a]
- Updated dependencies [e631f1e]
- Updated dependencies [6fc2678]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/objectql@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/objectql@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/objectql@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/objectql@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/objectql@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- e478e0c: ADR-0029 K2 — security domain ownership (RBAC + sharing) + Setup nav contributions.

  Moves the security objects out of the `@objectstack/platform-objects` monolith
  into the two capability plugins that already register and operate them, split by
  concern (the two are orthogonal — sharing objects never reference RBAC objects):

  - **`@objectstack/plugin-security`** (RBAC) gains `sys_position`,
    `sys_permission_set`, `sys_user_permission_set`, `sys_position_permission_set`,
    and the `defaultPermissionSets` seed (which its `bootstrap-platform-admin`
    already consumes). The RBAC + default-permission-set tests move with them.
  - **`@objectstack/plugin-sharing`** gains `sys_record_share`,
    `sys_sharing_rule`, `sys_share_link`.
  - `@objectstack/platform-objects` no longer defines/exports any security
    objects; the `/security` subpath is now an empty barrel. Runtime is unchanged
    (both plugins already registered these objects at runtime).

  **D7 navigation** — the Setup app's `group_access_control` is now assembled from
  three sources: `plugin-security` contributes Roles / Permission Sets (priority
  100), `plugin-sharing` contributes Sharing Rules / Record Shares (priority 200),
  and `platform-objects` keeps only API Keys (`sys_api_key`, an identity object,
  priority 300) — preserving the original menu order.

  **i18n (D8)** — the objects are removed from the `platform-objects` i18n extract
  config; existing generated bundles keep working at runtime (object-name keyed).
  Migrating the i18n extraction to the owning plugins remains the tracked
  follow-up.

### Patch Changes

- 4404572: ADR-0029 D8 — migrate i18n ownership for the moved domains to their plugins.

  The object translations for the domains decomposed in K2.a/K2.b/K2 previously
  lived in the `@objectstack/platform-objects` generated bundles even though the
  objects now live in their capability plugins. This moves each domain's i18n
  extraction + bundles to the owning plugin, preserving every hand-translated
  string (zh-CN / ja-JP / es-ES):

  - Each plugin gains a build-time `scripts/i18n-extract.config.ts` and a
    `src/translations/` bundle (`{locale}.objects.generated.ts` + an `index.ts`
    barrel), generated with `os i18n extract` and self-baselined so re-runs
    preserve translations.
  - Each plugin loads its bundle at runtime on `kernel:ready` via
    `i18n.loadTranslations` (the i18n service is optional — load is best-effort).
    - `plugin-webhooks` ← `sys_webhook`, `sys_webhook_delivery`
    - `plugin-approvals` ← `sys_approval_request`, `sys_approval_action`
    - `plugin-security` ← `sys_position`, `sys_permission_set`,
      `sys_user_permission_set`, `sys_position_permission_set`
    - `plugin-sharing` ← `sys_record_share`, `sys_sharing_rule`, `sys_share_link`
  - `@objectstack/platform-objects` translation bundles are regenerated to drop
    those objects' keys (its extract config already excluded them); all other
    objects' translations and the metadata-form bundles are preserved.

  Net runtime effect is unchanged (same translations load, now contributed by the
  package that owns each object) — closing the D8 follow-up tracked since K2.a.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [a6d4cbb]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/objectql@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/objectql@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/objectql@7.2.1
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/objectql@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/objectql@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/objectql@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/objectql@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/objectql@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/objectql@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/objectql@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/objectql@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/objectql@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/objectql@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/objectql@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/objectql@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/objectql@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/objectql@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/objectql@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/objectql@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/objectql@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/objectql@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

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
- Updated dependencies [2f9073a]
  - @objectstack/objectql@5.0.0
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/objectql@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
- Updated dependencies [5683206]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
