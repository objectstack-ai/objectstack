# @objectstack/rest

## 17.1.0

### Minor Changes

- 66dbec4: fix(rest): the flat error responder narrows a thrown `code` to the declared ADR-0112 vocabulary, demoting an unregistered spelling to `declaredCode` (#9232)
  
  **If you read `error.code` off a `packages/rest` flat error body today, read this.**
  
  `packages/rest` answers errors in the flat dialect — `{ error: 'message', code: 'X' }`,
  with `code` at the body's top level. Until now, when that body came from a *caught*
  error, whatever string the producer had put on `.code` was copied to the wire verbatim,
  including spellings that are not members of the ADR-0112 error vocabulary
  (`StandardErrorCode` plus the registered ledger). Every other HTTP door in the platform
  had already stopped doing that.
  
  It stops here too. A thrown `code` is now resolved exactly as the dispatcher door
  resolves it, by the same shared `resolveThrownHttpError` / `demotedDeclaredCode` pair:
  
  - **A registered code is unchanged.** It still arrives in `code`, verbatim, with nothing
    added beside it. If your branches read registered codes — and every consumer branch
    measured in this repo, the SDK and the console does — nothing about your code changes.
  - **An unregistered code is demoted.** `code` now carries the vocabulary member the HTTP
    status derives (a 403 gives `PERMISSION_DENIED`, a 409 `RESOURCE_CONFLICT`, and so on),
    and the producer's own spelling moves, unchanged, to a new top-level `declaredCode`
    field beside it. Nothing is lost — but a branch written against an *unregistered*
    spelling in `code` will stop matching, and must read `declaredCode` instead.
    Presence of `declaredCode` means demotion: it is absent whenever the producer's code
    was recognised.
  - **A throw that declared no code still carries none.** Narrowing the vocabulary does not
    start inventing codes for bodies that had none.
  - **A non-string `code` no longer reaches the body at all.** A numeric driver errno could
    previously land in `code`; it was never a legal value there and is now treated as
    context, as it already was at every other door.
  
  The observable case in this repo: the object-posture gate's `403 owd_widening_forbidden`
  now answers `{ code: 'PERMISSION_DENIED', declaredCode: 'owd_widening_forbidden' }`. That
  body could not previously satisfy the schema it claimed to satisfy.
  
  The error body's **position** is unchanged — this dialect still puts `code` at the top
  level rather than in `error.code`. Converging the position is a separate, still-open line
  held by the `check:route-envelope` ratchet, and was explicitly not a precondition here.
- b537855: fix(rest): `POST /meta/:type/:name/publish` and `.../rollback` require the `manage_metadata` capability (#8919)
  
  <!-- adr-0087: not-required (no-migration-prescription) Two route handlers gain
  the capability gate their four sibling doors already carry, plus one new test
  file. No authorable property is added, renamed, retired or tombstoned, so there
  is no conversion to register. The behavioural change is that two metadata write
  doors stop accepting callers who hold no authoring capability. -->
  
  **BREAKING for any integration that publishes or rolls back metadata with a
  principal holding no authoring capability.** Landing after the v17.0.0 cut, so
  it ships as `minor` under the lockstep launch-window convention.
  
  `packages/rest` gates four metadata-authoring doors on ADR-0066 D1's
  `manage_metadata` capability — `POST /meta/_migrate-stored`, `PUT /meta/:type/:name`
  (#6603), `PUT /meta/:type/:section/:name` and `DELETE /meta/:type/:name` (#7019).
  The two **promotion** verbs did not, and promotion is what decides which body is
  live: `publishMetaItem` flips the `sys_metadata` row `state: 'draft'` to
  `'active'` (ADR-0027 (E)(5) defines sealing a publish as exactly that flip), and
  `rollbackMetaItem` restores a caller-supplied `toVersion` as the new live row.
  
  **Measured through a composed host, down to the protocol layer, before the fix:**
  
  | principal | publish | rollback |
  |:--|:--|:--|
  | anonymous | 401, protocol not reached | 401, protocol not reached |
  | authenticated, **no** `manage_metadata` | **200, protocol reached** | **200, protocol reached** |
  | authenticated, `manage_metadata` | 200, protocol reached | 200, protocol reached |
  
  So the reachable cohort was every authenticated principal holding no authoring
  capability at all: it could take a draft somebody else authored and make it
  live, or restore any historical version over the live row. Anonymous callers
  were already refused by the `/meta` umbrella (`registerMetadataEndpoints`), so
  what these gates add is precisely the authenticated-but-uncapable cohort.
  
  **`rollback` is the sharper of the two.** The caller supplies `toVersion`, which
  makes it a mechanism for reverting security hardening — a permission set as it
  stood before it was tightened, a validation rule from before it existed, a
  layout from before field-level security. It is also the door with the least
  behind it: publish at least re-runs `assertRuntimeAuthoringRules` on the
  promoted draft (#4463 D1), while rollback runs no content gate at all. Neither
  of those reads the caller in any case — D1 answers "is this metadata valid", not
  "may you press this button" — so nothing downstream was ever doing this job.
  Audit rows are still written either way, so the action remains traceable after
  the fact.
  
  **No legitimate caller loses anything, and that is measured rather than
  assumed.** The Studio designer's save-then-publish loop saves `?mode=draft` and
  then POSTs `/publish`, and its **first** step already demanded
  `manage_metadata` — so every principal that can author a draft already clears
  the new gate. The shipped sets bear this out: `admin_full_access` (the only set
  carrying `studio.access`) carries `manage_metadata` too, while
  `organization_admin` and `member_default` are refused at the save door **today**.
  The only callers the gap benefited were exactly the ones already refused the
  authoring door — able to promote a draft they could not have written.
  
  **Migration — grant `manage_metadata` to any service principal that publishes.**
  An integration that promotes metadata on its own schedule (a CI job sealing a
  release, an AI authoring agent) needs the capability explicitly; there is no
  automatic replacement, deliberately. `isSystem` contexts bypass, as on every
  other capability gate on the platform, so in-process callers are unaffected.
  
  The gate is the sibling doors' four lines verbatim, deliberately not a second
  way of demanding the same capability, and it fires **before** the protocol is
  resolved so 403-vs-501 leaks no kernel capability and nothing is promoted before
  the refusal.
  
  ⚠️ **An author/publisher capability split is NOT introduced here.** Separating
  "may write a draft" from "may make it live" is a defensible design, but it needs
  a *different* declared capability and is a product decision; both defensible
  designs require a gate, and the state this fixes was neither.
  
  Ships with an **enumeration pin** rather than two assertions. The defect was not
  that two handlers forgot a gate — it was that the gate was a convention held by
  repetition and nothing else, so the next metadata write door had a one-in-three
  chance of copying an ungated neighbour with no test going red. The new suite
  derives the write doors from the composed server's own route table and compares
  them against a declared list, so a new mutating `/meta` route fails the build
  until it is enumerated and its refusal asserted.
- 4dc8a61: **Audit attribution change — the recorded actor on `/meta` writes is now the authenticated identity, and `X-Actor` is ignored.** All five `/meta` write sites (save, delete/reset, publish, rollback, compound save) stamp `sys_metadata_audit.actor` and `sys_metadata_history.recorded_by` with the identity the request was actually authorized as. A request that sends `X-Actor` is recorded against its own authenticated caller, not the header's value. Maintainer ruling 2026-08-12 on #7941, re-confirmed 2026-08-15.
  
  Why: the header used to outrank the authenticated identity. That ordering was inert for as long as the other limb produced nothing — `req.user` / `req.userId` are never set on this transport — so nothing depended on it. Fixing that producer (#7749) made the precedence load-bearing for the first time, and what it then meant was that any caller already holding `manage_metadata` could sign somebody else's name to a metadata write: the compliance trail answered "who *claimed* to change this" rather than "who changed this", which is the question #7749 was filed to make answerable. Attribution now cannot drift from authorization, because both read the same `resolveExecCtx` the route's own capability gate reads.
  
  The header limb is **removed rather than reordered**. The ruling permitted keeping it for genuine machine/system callers with no authenticated user, but only if a consumer census showed that shape exists — it does not, so a caller cannot choose the recorded name in any shape, including on the machine-write path where there is no identity for the header to lose to.
  
  Deliberately unchanged:
  
  - **Real impersonation still attributes correctly.** The platform's impersonation is session-level (better-auth admin plugin, `sys_session.impersonated_by`), so `resolveExecCtx` already resolves to the impersonated user and their metadata writes are recorded against them. Nothing in that path went through `X-Actor`.
  - **Machine and anonymous writes.** No resolved principal still means no actor, so the protocol's own `'system'` / `NULL` defaults apply exactly as before — a machine write is never stamped with a real user.
  - **Sending `X-Actor` is not an error.** It is ignored, not rejected; no request that succeeds today starts failing.
  
  Who is affected: any caller that relied on `X-Actor` to attribute a `/meta` write to somebody other than itself. The census over `objectstack` and `objectui` found no such caller — `objectui`'s `MetadataClient` can send the header through an optional `options.actor`, but nothing in that repo ever passes one, leaving that option inert against this server.

### Patch Changes

- e7bccaa: fix(rest): anchor `looksLikeMissingRelation` on the driver's quoted template (#8264)
  
  `mapDataError`'s Postgres limb read `relation` and `does not exist` anywhere in
  the message, not necessarily the same sentence — so ordinary business prose
  using both words (`This relation does not exist in the diagram`) matched.
  `does not exist` is ordinary business English; #8132 already anchored the
  shared `@objectstack/types` leak predicate on the driver's own quoted
  template for exactly this reason, and pinned the identical string as a
  negative case. This file's copy of the same question was not covered by that
  change (different package, different call site) and kept the loose reading.
  
  Anchored the same way here — a quoted identifier required between `relation`
  and `does not exist` — as a locally-owned pattern rather than a call into the
  shared leak predicate: that
  predicate answers a different question ("may this be withheld from the
  client"), and its other limbs (`sqlite_`, `unique constraint`, `foreign key`,
  a bare SQL statement) have nothing to do with this file's question (is this
  specifically an unknown-relation condition, for the 404-vs-500 split
  `looksLikeMissingRelation` feeds). `relation-sub-object.ts` documents "two
  widths, on purpose" for a neighbouring pair of consumers that ask genuinely
  different questions; that does not extend to the two USES inside this file,
  which both ask the same question and share one predicate correctly.
  
  **Both of the predicate's two call sites are covered, not just the reported
  one:** the `DATA_STORE_FAULT` (500) gate the issue named, and the
  `looksLikeUnknownObject` (404) limb the issue's own text did not measure. A
  business message no longer gets mislabelled a `DATABASE_ERROR`, and a
  crafted unquoted-but-attributable message no longer gets silently answered
  `OBJECT_NOT_FOUND` — both now fall through to the generic, still-sanitised
  terminal fault, which is the direction the branch's own #5462 comment already
  argues for ("the safe way to be wrong is loud").
  
  No reachable production path producing the unanchored shape was found at this
  call site — this is consistency/invariant restoration between two spellings
  of one question, not a fix for a demonstrated live misclassification.
- 5047cb8: fix(metadata-protocol): scope the metadata audit read to the caller's organization (#8747)
  
  `ObjectStackProtocolImplementation.auditMetaItem` declared
  `organizationId?: string | null` and never read it. The comment directly above
  its query described the filter it would have built — "include rows for the
  specific org AND env-wide (`organization_id IS NULL`) rows" — while the `where`
  was exactly `{ type, name }`. The parameter was dead on the caller side too:
  `GET /api/v1/meta/:type/:name/audit` never passed one.
  
  The consequence was a cross-tenant disclosure, measured rather than inferred:
  three saves of one view name under two organizations and env-wide, then one
  `auditMetaItem({ type, name })` read, returned all three organizations' rows —
  and with each row its `actor`, `note`, `lock_state`, `code`, `operation`,
  `source` and `request_id`. Nothing compensated lower down. The driver's tenant
  wall never engaged, because it is armed only from an execution context this
  read did not pass; the security plugin's Layer 0 never engaged, because the
  middleware short-circuits on a principal-less call long before the field gate
  that would have carried it; and no tenancy posture would have supplied the
  scope either. The route carries no capability gate — unlike its `PUT` twin,
  which gates on `manage_metadata` — so the reachable cohort was any
  authenticated principal of any tenant, on the published `meta.getAudit` SDK
  surface.
  
  The query now builds the described filter: rows for the caller's organization
  plus env-wide (`organization_id IS NULL`) rows, and nothing else. The env-wide
  limb is load-bearing rather than defensive — the REST `PUT /meta/:type/:name`
  door passes no organization, so every row it writes is stamped
  `organization_id: null`, and an equality-only filter would have blanked the
  audit tab on those deployments instead of scoping it. A read that resolves no
  organization is fail-closed onto the env-wide rows, symmetric with what an
  org-less write produces, so omitting the parameter is no longer a skeleton key.
  
  The REST route supplies the organization from the execution context it already
  resolves for 40-plus handlers, adding no new organization-resolution plumbing
  to `packages/rest`. The same call also stopped passing `environmentId`, which
  the request type never declared and the method body never read; environment
  scoping is unaffected, since it comes from which protocol instance is resolved
  rather than from the request payload.
  
  Behaviour change worth stating plainly: a caller that previously saw another
  tenant's metadata audit rows for a same-named item no longer sees them. Own-org
  and env-wide rows are unchanged.
- ed4ca59: fix(rest): a missing `auditMetaItem` capability is refused, not answered as "this item has no audit trail" (#9426)
  
  `GET /api/v1/meta/:type/:name/audit` feature-detects `auditMetaItem` on the
  resolved protocol. When the method was absent the route answered
  `200 { events: [] }` — so a **capability gap** reached the wire as the statement
  **"the audit trail was read and this item has no entries"**.
  
  Per ADR-0110 D3 those are different facts, and this one is a **compliance**
  surface. The route's own comment says it exists so Studio's 审计日志 / Audit log
  tab can show "who tried what and whether a lock blocked it". An empty answer
  there reads as *nobody touched this item* — precisely the claim a compliance
  reader must not be given on false pretenses.
  
  The branch now refuses:
  
  ```
  501  { error: { code: 'NOT_IMPLEMENTED',
                  message: 'protocol.auditMetaItem() is not available in this kernel' } }
  ```
  
  — the ADR-0112 nested envelope the sibling `/meta` 501 refusals converged on
  (#7035), so `body.error.code` is readable by the same one line of consumer code
  that already reads the others. This is the last limb in `rest-server.ts` that
  answered a capability gap with a well-formed empty collection; #9326 / PR #9425
  fixed the `findReferencesToMeta` twin, and five siblings already refused.
  
  **The unprovisioned-table answer is unchanged, and the two were never the same
  path.** The route's header comment promises "Empty array on environments where
  the table is not yet provisioned" — that condition is handled one layer down, in
  `ObjectStackProtocolImplementation.auditMetaItem`, whose `catch` returns
  `{ events: [] }` after a `console.warn`. That path requires the method to exist
  and to be called; this branch returns before the call. Separate frames, separate
  packages.
  
  **Does any caller's observed response change? Yes, on one deployment shape, and
  only there.** A protocol that *has* the method is untouched: an empty trail and a
  populated one both still pass through verbatim as `200`. What changes is the
  answer given when the protocol has no such method — previously `200` with an
  empty list, now `501`. No assembly in this repo produces such a protocol today:
  `ObjectStackProtocolImplementation` is the only implementation registered under
  the `protocol` service and it defines the method unconditionally. The branch is
  reachable rather than dead because `auditMetaItem` is **not** a member of
  `RestProtocol` (`= DataProtocol & MetadataProtocol`) and is not declared in
  `@objectstack/spec` at all — it is an ADR-0076 D9 server-only extension reached
  through a runtime cast. A host that implements the declared contract exactly, or
  that points `protocolServiceName` at its own service, is a *conforming*
  deployment that lands on this branch with no type error.
  
  Refusing at the route rather than asserting at assembly is deliberate: a
  boot-time assertion would promote an undeclared optional extension into a
  required one, which is a contract decision for `@objectstack/spec` rather than a
  route one, and it would reject the partial protocol doubles that legitimately
  exist today.
- c766ec3: refactor(metadata-protocol,rest,runtime): one declared shape for the `protocol.deletePackage` seam, imported by both doors (#9960)
  
  `deletePackage` had **three** independent statements of its own contract, and
  they did not agree:
  
  | site | what it said |
  |---|---|
  | `packages/metadata-protocol/src/protocol.ts` (the producer) | an inline structural type on the method — `packageId`, `organizationId?`, `allTenants?`, `actor?`, `keepData?` |
  | `packages/rest/src/package-routes.ts` (direct-mount option) | `{ packageId; actor?; allTenants? }` — named **neither** `organizationId` **nor** `keepData`, and its response omitted `deleted` |
  | `packages/runtime/src/domains/packages.ts` (dispatcher twin) | nothing at all — it reached the verb through `(protocol as any)` |
  
  The twin routinely sent exactly the two keys the REST option's type could not
  express, and the only reason that was not a compile error was the cast.
  
  `organizationId` is the member that makes this load-bearing rather than
  cosmetic: the protocol refuses a call naming neither it nor `allTenants`
  (`TENANT_SCOPE_REQUIRED`, 400), so it is precisely the key whose presence
  decides an uninstall's blast radius — and it was the key one of the two doors
  had no word for.
  
  **What changes:** `DeletePackageRequest` and `DeletePackageResponse` are
  declared once at the producer and exported from `@objectstack/metadata-protocol`
  (the only user-visible half of this change — two additive type exports); both
  consumers import them, and the `as any` seam is gone. `@objectstack/rest` also
  gains three compile-time pins over its option, in compiled source rather than a
  test file, so a later hand-rolled restatement fails `tsc` instead of drifting
  green.
  
  **What does not change:** nothing about what the verb accepts or returns. The
  members are identical to the ones the implementation already had, the live call
  sites send the same keys, and the emitted JavaScript of both consumers is
  unchanged. The member stays optional at both seams and the runtime's
  `typeof … === 'function'` capability probe stays — the `protocol` service slot
  is deliberately uncontracted, the spec's `PackageProtocol` does not declare this
  verb, and registrants carrying no `deletePackage` are real.
  
  No `packages/spec` declaration: minting protocol surface for a verb with zero
  external consumers is a spec-seat decision nobody has asked for.
- 51a46a4: fix(rest): `/discovery` describes the request's environment, not the control plane (#9292)
  
  `registerDiscoveryEndpoints`' handler opened with `this.protocol.getDiscovery()` — the
  **control-plane** protocol captured at construction — while roughly thirty sibling
  handlers in the same file obtain theirs from `resolveProtocol(environmentId, req)`.
  Everything else in the handler composes over that one document, so the entire body
  followed the host's kernel. `/discovery` is the surface SDKs, codegen and AI clients read
  to decide what a deployment can do.
  
  **Yes, an observed document changes** — on multi-environment and single-environment
  deployments. On a control-plane-only boot nothing changes at all.
  
  The sharper half is the **scoped** route. `registerRoutes` registers the same closure for
  the unscoped base and for `.../environments/:environmentId`, so
  `GET /api/v1/environments/abc/discovery` — a request naming its environment in the URL —
  still received the control plane's document.
  
  **Measured on a two-kernel host before the fix**, with real `getDiscovery()` producers
  per environment: two environments with genuinely different kernels received
  **byte-identical** `capabilities`, `services` and `locale`, and both received the
  *host's* answers rather than either environment's. For the richer of the two tenants that
  meant all 13 capability keys wrong (`transactionalBatch`, `automation`, `cron`, `export`,
  `comments`, `analytics`, `ai`, `i18n` each reported `false` while the environment
  delivered them), its whole `services` map wrong, its `locale` wrong (`en` reported for an
  environment serving `zh-CN`), four of its real route keys missing, and a phantom
  `routes.notifications` advertised that no tenant could serve.
  
  That is wider than a two-capability defect because the builder derives the whole document
  from its own kernel: the `services` map and the optional `routes` keys come from that
  kernel's service registry, `locale` from its `i18n` occupant, and the capabilities from
  its engine and registry.
  
  The unscoped route reaches the same shared resolution
  (`resolveRequestEnvironmentId`, ADR-0076 D11 step ④) rather than getting a special case,
  and keeps the control-plane answer exactly where that is the correct one: with no
  environment in scope the chain returns `undefined` and `resolveProtocol` falls through to
  the captured control-plane protocol. A single-environment boot resolves through step 3
  (the default provider) and now describes the kernel that actually serves its data; a
  hostname-routed multi-tenant host follows the same authority the HTTP dispatcher uses, so
  `/discovery` and the data routes beside it describe one kernel.
  
  Two halves of the handler were already correct and are unchanged: the `realBase` route-
  string substitution and the trailing `scoping` block already read
  `req.params.environmentId`. The `version` field is overwritten from server config on
  every request and never followed the wrong protocol either.
- 3ab2488: fix(rest): stamp the export download's filename in the business timezone (#8484)
  
  `exportContentDisposition` built the `-YYYYMMDD-HHMMSS` half of the suggested
  filename from process-local getters (`now.getFullYear()` / `getHours()` / …),
  which read the deployment host's `TZ` — a hosting fact, not the caller's
  business timezone. The route had already resolved that timezone one frame up
  (`ExecutionContext.timezone`, the platform-default → global → tenant cascade)
  and simply never passed it here.
  
  After #8373 moved the export's **contents** onto the business timezone, the
  filename was the last export surface still on the host clock, so the two
  disagreed exactly when `TZ` was not the business zone: a container at `TZ=UTC`
  serving an Asia/Shanghai tenant downloaded `orders-20260731-220000.csv` whose
  first row read `2026-08-01 06:00:00` — off by a day, and at a month boundary by
  a month. The name and the rows inside it now read one clock.
  
  **The no-timezone fallback stays PROCESS-LOCAL, deliberately not UTC.** This is
  the opposite of the cell path's UTC fallback, and the asymmetry is the point:
  each fallback preserves the historical output of the surface it serves. The
  cells were hardcoded to UTC before #8373; this filename has always used the
  process clock. Defaulting it to UTC would look safer while silently re-timing
  the filename of every deployment that sets a host `TZ` but resolves no business
  timezone — a user-visible rename for zero correctness gain. An explicitly
  resolved `'UTC'` is a *resolved* zone, not a missing one, and does produce a UTC
  stamp regardless of the host.
  
  The shared clock helper is split rather than parameterised with a default:
  `zonedWallClock` now returns `null` when no usable zone resolves, and each of
  the two callers supplies its own fallback at the call site where it can be read
  and pinned. Baking either fallback into the shared helper would silently
  re-time the other surface.
  
  Filename **naming** is untouched — label selection, sanitization and the RFC
  5987/6266 `filename*` encoding all behave exactly as before, and the export's
  contents are not touched at all.
- 185c7bd: fix(security): the external-datasource federation HTTP family requires an authenticated caller, on every route (#9686)
  
  <!-- adr-0087: not-required (no-migration-prescription) The change is an
  authentication floor on five mounted HTTP routes plus the composition edge that
  feeds it the caller's identity. No authorable metadata key is added, renamed,
  retired or tombstoned, and no stored shape changes, so there is no conversion to
  register. The behavioural change is that `/api/v1/datasources/:name/external/*`
  now answers `401 UNAUTHENTICATED` to a caller with no resolvable identity, where
  it previously served every route — including the two that write. -->
  
  `registerExternalDatasourceRoutes` mounts the five federation routes
  (`GET .../external/tables`, `POST .../external/tables/:remote/draft`,
  `POST .../external/tables/:remote/import`, `POST .../external/refresh-catalog`,
  `POST .../external/validate`) straight onto `IHttpServer`, so they pass through
  none of the seams that produce the platform's 401s: `RestServer.enforceAuth` is
  a private method invoked inside that server's own handlers — not middleware a
  direct mount is routed through — and the dispatcher domains' floor runs inside
  the dispatcher. Being composed by `RestServer` was not itself a guard.
  
  **The missing piece was an edge in the composition, not a line in a handler.**
  `mountAndRecordDirectRoutes` resolves the `RestServer`'s execution-context
  resolver and handed it to ONE of the two registrars it mounts:
  `registerPackageRoutes` got the identity and applied the shared anonymous floor,
  `registerExternalDatasourceRoutes` got nothing and checked nothing. The resolver
  now reaches both, and the federation registrar applies the same floor:
  
  - the **decision** is `shouldDenyAnonymous` (`@objectstack/core`), the one
    function every HTTP seam on the platform shares — `isSystem` is not settable
    from the wire and a CORS `OPTIONS` preflight passes, both by its construction;
  - the **identity** is the `RestServer`'s own resolver, which admits every
    credential kind the platform admits — a better-auth session *and* a
    `sys_api_key`. This family is SDK-expressed (`datasources.external.*` on
    `ObjectStackClient`), so a floor that read only a session would have refused
    callers the rest of the surface accepts;
  - it **fails closed**: anything that throws, and anything resolving to no
    identity, is refused. No configuration, posture or absent service opens it;
  - the check runs **before** the service lookup, so an anonymous caller cannot
    learn from a `503` which services a deployment has wired — and, on the two
    routes that change state, the refusal provably precedes the write;
  - the 401 is written through this surface's shared `sendError`, so the status,
    code and message are the platform's while the envelope stays this family's.
  
  **A pinned equivalence is restored, not merely an exposure closed.**
  `GET .../external/tables` and `GET /api/v1/datasources/:name/remote-tables` reach
  the same `listRemoteTables`; `POST .../external/tables/:remote/draft` and
  `POST /api/v1/datasources/:name/object-draft` reach the same
  `generateObjectDraft`. #4249 gave those two spellings one failure contract and
  #7955 one request shape. After the datasource-admin family grew its own floor
  (#9391), one operation answered 401 at one spelling and served anonymously at
  the other. `remote-tables-twin.equivalence.test.ts` now compares the two on the
  admission axis as well, so a guard added to one spelling and not the other fails
  whichever side it is added to.
  
  Authentication and nothing more: whether these routes should further require a
  capability is the separately-ruled question #9593 asks of the admin family, and
  is deliberately not folded in here.
- 45862a5: refactor(rest): the non-door `getMetaItems` request literals are compiled against the declared contract (#9805)
  
  Nine `getMetaItems` call sites in `packages/rest/src/rest-server.ts` outside the
  four meta-read doors still passed their request through `as any` (or through a
  `p: any` parameter), so the compiler checked nothing about them. Every member
  they thread has been expressible in declared types since #9741 landed
  `previewDrafts` on `GetMetaItemsRequest` and the `TransportScopedMetaRequest`
  envelope for the transport-level `environmentId` — the casts were pure
  blindness, and an un-typed request literal is exactly the class that lets a
  future key drift silently.
  
  Each literal is now a named const typed
  `TransportScopedMetaRequest<GetMetaItemsRequest>` (or plain
  `GetMetaItemsRequest` where the site threads no `environmentId`), the same shape
  #9741 gave the doors: the object-metadata read behind the API-exposure gate, the
  audience book fetch, the book-tree book and doc listings, the doc corpus behind
  the audience resolver, the public-form view lookup, the public-form object
  schema, the public-lookup reference resolution, and the dataset listing.
  
  **No behaviour change of any kind, and nothing about the wire moves.** The
  outgoing payloads are byte-identical (same keys, same conditional spreads); the
  edit hoists each literal into a const and drops a type-level cast. Two spellings
  at these sites deliberately SURVIVE, because retiring either would change
  behaviour rather than typing, and both are now documented on the envelope alias:
  
  - the optional call (`getMetaItems?.(…)`) and the `typeof … === 'function'`
    guards — `getMetaItems` is a required `MetadataProtocol` member, so these are
    not feature detection in the type sense, but a host may occupy the protocol
    slot with an object that does not implement the whole surface (the reason
    `metaTypeIsLive` documents the same spelling for `getMetaTypes`). Retiring one
    turns a tolerated absence into a `TypeError`;
  - the result handling — the verb is declared to return `{ type, items }` while
    these sites also tolerate the bare-array shape older hosts and stubs return,
    so the response stays runtime-shaped on purpose.
  
  Genuinely feature-detected server-only verbs (`getMetaDiagnostics`,
  `listDrafts`, `migrateStoredMetadata`, …) are untouched — runtime casts are the
  documented convention there, and tightening one would turn optional capability
  detection into a hard dependency.
- 79c46da: feat(contract): a hook refusal can mark its message user-facing — `userMessage`, the producer-side opt-in channel (#9934, producer half of objectui#5210)
  
  <!-- adr-0087: not-required (no-migration-prescription) Purely additive: one
  new OPTIONAL field on the two error-envelope schemas, a new shared reader in
  @objectstack/types, and passthrough plumbing at the boundaries. Nothing
  authorable is renamed, retired, aliased or tombstoned, so there is no
  conversion to register. Unmarked errors produce byte-identical wire bodies. -->
  
  The console form deliberately discards the server `message` on 403 and
  substitutes a generic string — the recorded #3821 fix for platform diagnostics
  leaking to end users. That substitution also suppressed every deliberate,
  localized refusal an application hook author wrote (11 real hook guards in the
  objectui#5210 report), and incentivized misusing 400 for permission refusals.
  The maintainer-accepted ruling (2026-08-19, option 1): give the AUTHOR a
  producer-side way to mark a refusal message user-facing, once, at the contract
  level — status-agnostic, with #3821 preserved by construction for everything
  unmarked.
  
  **The marking**: set `userMessage` (non-empty string) on the thrown error at
  throw time. It is a text-carrying field, not a boolean beside `message` — the
  mark and the marked text are one value, so no boundary that rewraps or
  substitutes `message` can promote platform prose into the marked channel, and
  platform/driver code never sets it.
  
  - `@objectstack/spec`: `ApiErrorSchema.userMessage` and
    `EnhancedApiErrorSchema.userMessage` (optional, additive).
  - `@objectstack/types`: `declaredUserMessage(error)` — the ONE "is this
    marked?" read (non-empty string, nothing invented) — and
    `ThrownHttpError.userMessage` on `resolveThrownHttpError`.
  - `@objectstack/rest`: `mapDataError` / `resolveErrorResponse` ride a declared
    marking onto whatever envelope classification chose (flat body top-level
    `userMessage`, truncated at the same #5423 bound as the 4xx message).
  - `@objectstack/runtime`: the QuickJS side-channel carries `userMessage`
    across the sandbox boundary (both directions, joining `code`/`fields`/
    `status`), and the dispatcher door emits it as a declared sibling in the
    nested envelope.
  - `@objectstack/client`: the SDK attaches `err.userMessage` from both wire
    dialects, so a UI renders it verbatim when present and keeps its generic
    substitution when absent.
  
  The consumer half — the console form rendering a marked message instead of the
  generic `form.noPermissionToSave` — is objectui#5210.
- 24173e9: fix(rest): read an offset-free import cell in the business timezone, not the host `TZ` (#8485)
  
  `parseDateCell` ended in `new Date(s)`. A spreadsheet cell like
  `2026-08-01 06:00:00` carries no offset, so ECMAScript resolves it against the
  **process** timezone, and the instant bulk import stored became a property of
  the deployment host:
  
  ```
  TZ=Asia/Shanghai → 2026-07-31T22:00:00.000Z
  TZ=UTC           → 2026-08-01T06:00:00.000Z
  ```
  
  Same file, same tenant, same cell — eight hours apart, decided by a setting
  nobody authoring the spreadsheet can see, and never consulting the business
  timezone the route had already resolved one frame up
  (`ExecutionContext.timezone`, the platform-default → global → tenant cascade).
  
  Since the export renders `datetime` cells in that business timezone (#8373), the
  advertised export → edit in a spreadsheet → re-import round trip was lossless
  only where the host `TZ` happened to equal the business zone. `import-coerce.ts`
  opens by calling itself "the inverse of `export-format.ts`"; it now is one, and
  the regression proof asserts inverse-ness on the **pair** — every fixture under
  a host `TZ` deliberately different from the business timezone, because a test
  that runs only under a matching `TZ` cannot fail.
  
  **An offset-free datetime cell is now read in the caller's business timezone**,
  through `@objectstack/core`'s new `zonedWallClockToUtcMs` — the DST-safe wall
  clock → instant primitive that `zonedDateStartToUtcMs` (the date-bucket drill
  path) is now the midnight special case of. One implementation of zone
  arithmetic, `Intl` offsets from the platform tz database, never hand-rolled;
  generalising the existing one rather than hand-rolling a second in `rest` is
  what keeps the export and import halves of this seam from drifting apart again.
  Two wall clocks are not a bijection with instants, and both degenerate DST
  readings resolve to the earlier candidate instant — a gap reading lands just
  before the gap, an ambiguous reading on its first occurrence (pinned, measured).
  
  Three things deliberately do **not** move:
  
  - **A cell that carries an explicit offset** (`…Z`, `…+08:00`) already names one
    instant and is honoured exactly as written. This change affects naive cells
    only.
  - **The date-only fast path stays UTC.** `YYYY-MM-DD` is UTC per ECMAScript and
    a `date` is a timezone-naive calendar day (ADR-0053); sweeping it into the
    zoned handling to make the code look uniform would silently re-time every
    date-only import to fix nothing.
  - **No timezone resolved ⇒ UTC**, never the process clock. That is the fallback
    the export's cell path takes in the same case, so the round trip stays exact
    for deployments that configure no zone — and a process-`TZ` fallback would
    preserve the defect for exactly the deployments that cannot see it. This is
    the one **behaviour change for existing deployments**: a host with a non-UTC
    `TZ` and no resolved business timezone previously read naive cells in the host
    clock and now reads them as UTC. An explicitly resolved `'UTC'` is a resolved
    zone, not a missing one.
  
  Two adjacent legs of the same defect, both on the naive-cell path:
  
  - **A naive cell landing in a `date` or `time` field** now takes the typed
    components verbatim (`2026-08-01 06:00:00` → `2026-08-01` / `06:00:00`).
    Those branches also read the process clock, so a host east of the cell stored
    the *previous calendar day* for a `date` column.
  - **An xlsx date cell.** An Excel serial date carries no timezone; ExcelJS
    materialises it as a `Date` whose UTC components are the sheet's wall clock,
    and `import-prepare.ts` rendered it with `toISOString()` — stamping a `Z` the
    file never had. That fabricated offset then outranked the business timezone by
    the very carve-out above, so every real date cell in a user-authored workbook
    imported as UTC whatever the tenant's zone. It now flattens to the same
    offset-free `YYYY-MM-DD HH:mm:ss` a CSV export writes, which is what that
    function's contract already claimed to produce.
- 6cb88d9: fix(rest): `GET /api/v1/meta/:type` refuses a type name that names nothing, instead of serving it as an empty collection (#9488)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  renamed, retired or tombstoned, and no `packages/spec` declaration moves. This
  narrows the accept-set of one READ route over type-name segments that were
  already refused by the WRITE door for the same name, so there is no stored
  configuration for a migration to prescribe a rewrite of. -->
  
  ```
  GET /api/v1/meta/totally_invented_type   →  200 {"type":"totally_invented_type","items":[]}
  PUT /api/v1/meta/totally_invented_type/x →  400 "'totally_invented_type' is not a metadata type"
  ```
  
  The two doors disagreed about which type names exist. A
  200-with-an-empty-collection is **indistinguishable from "this type exists and
  holds nothing"**, so a typo'd or renamed type name read as an empty surface
  rather than as a mistake — the same trap `GET /meta/app?id=<unknown>` was
  already filed for, where the answer read to a runner as "the app metadata is
  gone".
  
  The list door now answers **`400` / `INVALID_REQUEST`**, naming the type: the
  same status and the same code the write door has emitted since `PUT /meta//x`
  was closed, so one condition has one answer on both doors. `INVALID_REQUEST` is
  already registered to `@objectstack/rest` in the ADR-0112 `ERROR_CODE_LEDGER`;
  no code is minted. The refusal is thrown rather than hand-built, so its wire
  body is byte-identical to the write door's for the same condition.
  
  **What still answers `200` with an empty collection**, because a type that
  exists and has no items is the legitimate case the defect was indistinguishable
  from — breaking it would be worse than the bug:
  
  - every member of the static spelling contract (`sharing_rule`, `theme`,
    `objects`, `api`, …), whether or not the deployment holds one item of it;
  - the live-only keys an ordinary `registerApp` produces — `data`, `kind`,
    `package`, `policy` — which sit outside the static contract but are
    enumerated by `GET /api/v1/meta/types`;
  - a plugin's own type, which enters the live set as a side effect of
    registering items of it.
  
  That is why the rule is the **union** of the two authorities the platform
  already has — the static predicate the write door consults, and the live
  listing `GET /meta/types` serves — rather than the static predicate alone.
  Refusing on the static half alone would answer `400` for types this same
  service advertises, which is the objection recorded when the write-side verdict
  landed and was deliberately not raised on the read entries then. Neither list
  is restated here; both are read from their producers.
  
  The static verdict runs first and is silent for every accepted spelling, so an
  ordinary list request pays nothing; the live listing is consulted only by a
  request already headed for a refusal. If that listing cannot be read — no
  `getMetaTypes` on the host's protocol, or a rejecting call — the route **fails
  open** and keeps its prior answer: "no such type" is an existence claim, and
  stating it while the authority that would know is unreachable is the mistake
  the write door's own store probe avoids.
  
  **Scope.** The list door only. The compound arity `/meta/lead/views/all_leads`
  carries an *object* name in the `:type` segment, which no static contract can
  enumerate, and is untouched. The single-item doors already refuse
  distinguishably (`404 RESOURCE_NOT_FOUND`, or `501 NOT_IMPLEMENTED` on the
  `/references`, `/layers`, `/history`, `/audit`, `/diff`, `/published` limbs), so
  none of them carried this defect.
- b6c7690: fix(rest): org-overridable metadata is served back by every `/meta` read door, not just persisted (#9454)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable key is
  added, renamed, retired or tombstoned. One new exported predicate in
  `metadata-core` (`organizationIdForMetaRead`), one widened optional request
  member on an existing protocol method (`getMetaItemCached`'s `organizationId`),
  and caller-side threading in `packages/rest`. The accept/reject behaviour of
  every write door is unchanged — this card is read-side only. -->
  
  A runtime `PUT` of an org-overridable metadata type — `view`, `dashboard`,
  `report`, `translation`, `email_template` — answered **200** with a receipt
  reporting `state: 'active'` plus a version and sequence number, **persisted the
  row with its `organization_id`**, and was then served back by **nothing**: the
  direct `GET` answered 404, the scoped listing was unchanged, the unfiltered
  listing was missing it, and the browser rendered an empty view or "Dashboard Not
  Found". The platform reported success in the same breath as not delivering the
  work, which is declared ≠ enforced in the direction hardest for an author to
  notice — the write path says everything worked.
  
  **The write door was correct as-is.** The row really is persisted, so the
  receipt is truthful; this was persisted-but-not-served, never a silent write
  no-op. **The overlay-resolution layer was correct too**, and type-agnostic:
  `getMetaItem` resolves `(orgId ? findOverlay(orgId) : undefined) ??
  findOverlay(null)`, `getMetaItems` unions both scopes under org-wins precedence,
  and `getMetaItemLayered` even reports `overlayScope`. The defect was that the
  REST read doors **never stated the scope**, so every one of them asked for the
  env-wide partition and the org partition was never consulted.
  
  **The repair is one registry-derived predicate, threaded at the read doors.**
  `organizationIdForMetaRead` joins `organizationIdForMetaWrite` in
  `metadata-core`, deriving from the same `allowOrgOverride` registry flag, so
  read scope and write scope cannot drift and a registry entry flipping the flag
  moves both doors together. It is threaded through the **already-memoised**
  `resolveExecCtx`, so no new per-request organization resolution is introduced.
  
  ⛔ **Not a bare `ctx?.tenantId` at each site**, and the reason is measurable
  rather than stylistic: deployments predating the #6190 ruling hold **phantom
  org-scoped rows for types the registry declares non-overridable** (the runtime
  used to stamp `organization_id` on every type). Boot hydration deliberately
  walks past those rows, so they are dead. A read door naming the org for *every*
  type would resolve them again — serving, on the read side, a document that
  vanishes at the next restart.
  
  **`getMetaItemCached` gains an `organizationId` member** — it was the only meta
  read verb that could not express one, having hard-coded a two-key delegation to
  `getMetaItem`. The organization is also folded into its **ETag**. The mechanism
  differs from `locale` and the difference is stated rather than glossed: `locale`
  is invisible to the hash (the body is translated after the validator runs), so
  folding it in was the only way it could vary the validator at all, whereas the
  org-resolved document *is* the thing hashed. No cache leak is claimed — the
  directive is `private, no-cache` and there is no server-side cache entry keyed by
  type+name. It is folded in because that makes scope a **declared** property of
  the validator instead of an emergent property of the body.
  
  **Both REST branches are fixed, which is the half-fix this card could easily
  have shipped instead.** `view` and `dashboard` share one mechanism but reach it
  through two different arms: `view` takes the cached arm (`getMetaItemCached`),
  while `dashboard` bypasses the cache via `isDashboardType` and takes the
  uncached arm. Both omitted the org, so a fix applied to one arm would have
  fixed exactly one type while the receipt kept claiming success for the other.
  The scope is now resolved **above** the fork, so the two arms cannot disagree.
  
  The regression proof drives real REST routes against a real protocol over a stub
  engine — write-then-read agreement on **one boot**, for all five types, through
  both arms. Its most important assertions are the ones that do **not** merely
  check the item comes back: an org-less caller and a **second organization** must
  each be refused it. An org-blind overlay fallback would satisfy every other
  assertion in the file while matching an arbitrary tenant's row.
- e6e1de4: fix(rest): `DELETE /api/v1/packages/:id` answers a driver fault as a 5xx, and stops swallowing coded refusals (#8275)
  
  `packageService.delete` swallowed every throw and reported failure by returning
  a bare `{ success: false }`, so the door answered
  `400 PACKAGE_DELETE_FAILED`. The statement behind it is
  `DELETE FROM sys_packages WHERE id = ? [AND version = ?]`, so a missing table, a
  lock timeout or a foreign-key restriction — a **server** fault — was answered as
  a client error: it invited the caller to fix a request that was never the
  problem, and it hid a real fault from every dashboard that buckets by status.
  
  This is the sibling of what #8016 fixed on the throw path and #8131 fixed for
  `publish`. `service-package` had been left **partially converted** by #8131 —
  the same service answering two different classifications for the same kind of
  fault — and this closes that.
  
  **Two changes, both small:**
  
  - `delete`'s catch re-throws a throw that **declares its own status**, so a
    coded refusal reachable from this call path keeps the producer's status and
    code through the door's #8016 mapping (a `409 DESTRUCTIVE_CHANGE` stays a
    409) instead of being flattened into one 400. It reuses the existing
    `declaresHttpAnswer` predicate rather than declaring a second one.
  - an undeclared throw stays a returned failure, and the door answers it **500**.
  
  ⛔ The discriminant is the **status** channel, never `.code`. Every SQL driver
  populates a string `code` on its errors (`ERR_SQLITE_ERROR`, `SQLITE_ERROR`, the
  SQLSTATE `42P01`, `ER_NO_SUCH_TABLE`), so a `.code`-reading predicate re-throws
  genuine driver faults as if they were refusals — resolving them to a `500
  INTERNAL_ERROR` that carries the driver's own message. Pinned per dialect in
  `delete-driver-fault.test.ts`, on this seam rather than inherited from
  `publish`'s suite by analogy.
  
  **4xx is not swept**, which is the other half of the fix: the
  repeated-`?version=` refusal is checked before `delete` is called at all,
  `PACKAGE_DELETE_PARTIAL` keeps its 400 (per-item uninstall failures are a
  different outcome), a declared 4xx thrown from below keeps its own status and
  code, and a declared 5xx keeps its own too.
  
  **No message changed, and that is deliberate.** Unlike `publish`, this path
  never disclosed anything: the door builds its sentence from the request's own
  `:id` and `?version=`, and the producer returns a bare flag with **no message
  channel at all**. Mirroring `publish`'s `driverFault` message here for symmetry
  would have *created* a channel to the wire that nothing filters — the 5xx
  withhold (#8086) lives in `sendThrownError`, which a returned failure never
  reaches at any status. The new suites pin that absence from both sides: the
  producer's returned shape has exactly one key, and the door answers its own
  sentence even when handed a producer that grows a message.
  
  Verified against a real `node:sqlite` database running the real statements from
  `index.ts` — including a genuine foreign-key restriction, the fault family only
  `DELETE` can have.
- 6a12e5e: refactor(rest): `package-routes`' `protocol.getMetaItems` option reads the spec's declared request/response instead of a hand-rolled local shape (#9846)
  
  `PackageRoutesOptions.protocol` declared its meta-read verb as a local
  structural type — `getMetaItems?(req: { type: string }): Promise<{ items: any[] }>`
  — rather than naming the shapes `packages/spec` already declares. Nothing was
  broken by it: both call sites send exactly `{ type: 'package' }`, which is a
  valid `GetMetaItemsRequest`, and both read `result?.items` defensively.
  
  What it was, is the same blindness class one level up from the sibling
  meta-read doors: a request type *re-stated locally* rather than *read from the
  spec* lets the contract move underneath this module — a narrowed `type`
  vocabulary, a newly required member, a renamed key — while the file keeps
  compiling green against a shape the protocol no longer has.
  
  Both are now sourced from `@objectstack/spec/api`:
  
  ```ts
  getMetaItems?(req: GetMetaItemsRequest): Promise<GetMetaItemsResponse>;
  ```
  
  **The optionality and the runtime feature-detection are deliberately kept.**
  `MetadataProtocol` declares `getMetaItems` as a **required** member, while this
  option is optional and both call sites guard with
  `typeof … === 'function'`. Adopting `MetadataProtocol` whole would change what
  the seam tolerates — a behaviour question, deliberately not answered here.
  
  Naming the declared response surfaced one thing the local `any[]` had been
  hiding: the spec types `items` as `unknown[]`, because it says nothing about
  what a metadata item *contains*. The registry-specific keys this module reads
  off each entry (`manifest.id`) are not spec-declared, so the **element** read
  stays runtime-shaped on purpose — the same disposition the sibling doors take
  via `metaItemsArray`. The seam is typed; the element read is coerced at the
  read and unchanged in behaviour.
  
  A compile-time pin holds the coupling: an exact type-equality assertion that
  the option's request/response types are still the spec's, so re-hand-rolling
  the local shape fails the build rather than passing unnoticed. It lives in
  compiled source rather than a test file, because this package's `tsconfig.json`
  excludes its test files and no sibling gate type-checks them — a type-level
  assertion written there would be compiled by nothing.
  
  `deletePackage`'s local structural type is untouched: no declared spec shape
  exists for that verb, and minting one is a contract act rather than a typing
  cleanup.
  
  Internal typing only — `PackageRoutesOptions` is not exported from the
  package's entrypoint, so no public surface changes and no route changes what it
  accepts or rejects.
- 2a29caa: Declare the draft-visibility switches on the meta-read request schemas, exactly where the implementation enforces them (#9741, maintainer ruling 2026-08-18): `GetMetaItemsRequestSchema` gains `previewDrafts?: boolean`, and `GetMetaItemRequestSchema` gains `state?: 'active' | 'draft'` plus `previewDrafts?: boolean`. Both members are draft-visibility switches only — declaration ≠ authorization: ADR-0106 masking is unaffected, and draft access stays admin-gated upstream. The cached and layered read requests deliberately declare neither (their implementations enforce neither). `environmentId` stays OUT of the protocol request shape by explicit ruling — it is the transport-level multi-kernel routing key, recorded schema-side as a decision rather than an omission. The REST meta-read doors (list, cached and uncached single-item, layered) drop their `as any` request casts: each request literal now compiles against the declared spec shape, with the transport-level `environmentId` carried by a typed transport envelope (`TransportScopedMetaRequest`) instead of a cast. Accept-set widening catch-up on the declared surface; zero runtime behaviour change.
- 9e2e682: fix(rest): `/discovery`'s `mcp` advertisement follows the request's environment — `probeMcpServeable` routes through the shared resolution entry point (#9120)
  
  `RestServer.resolveRequestEnvironmentId` calls itself, in its own doc-comment,
  "THE single entry point for every unscoped-route environment decision (protocol,
  i18n, exec-ctx, analytics, …) so they can never disagree about which kernel a
  request belongs to." Eight consumers go through it. `probeMcpServeable` — the
  ninth site that needs the request's environment, and the one whose answer decides
  whether `/discovery` advertises `routes.mcp` — re-derived its own:
  
  ```ts
  let environmentId: string | undefined = req?.params?.environmentId;
  if ((!environmentId || environmentId === ':environmentId') && this.defaultEnvironmentIdProvider) {
      try { environmentId = this.defaultEnvironmentIdProvider() || undefined; } catch { /* ignore */ }
  }
  ```
  
  That is the shared chain minus its first and middle steps: the host's ADR-0006
  `kernel-resolver` seam (wired through `RestRequestEnvResolver`), and the legacy
  hostname / `X-Environment-Id` chain beneath it.
  
  **Single-environment boots were correct throughout** — there
  `defaultEnvironmentIdProvider` is registered, and it is also step 3 of the shared
  chain, so both spellings agreed. The defect is multi-tenant-only: on a
  hostname-routed host an unscoped `/discovery` request carries no
  `params.environmentId`, and no default provider is registered (that is
  `createSingleEnvironmentPlugin`'s wiring). Neither input the probe read was
  present, so it fell through to `serviceExistsProvider` — which answers for the
  **host** kernel, not the request's environment. Both misadvertisement directions
  were reachable, and are now pinned as regression tests:
  
  - the host kernel has `mcp` and the request's environment does not ⇒ `/discovery`
    advertised `routes.mcp` for an environment whose `/mcp` answers 501 — the
    `declared ≠ enforced` shape the probe was added to close;
  - the host kernel lacks it and the environment has it ⇒ the route was withheld
    from an environment that would have served it (`mcpServeable !== false` fails
    open only for a `null` probe, never for a confident `false` computed against
    the wrong kernel).
  
  The probe now calls `resolveRequestEnvironmentId` like its eight siblings. The
  `'platform'` guard and the `serviceExistsProvider` fallback are unchanged, and
  the unsubstituted `':environmentId'` route pattern is normalised to "no id"
  before the call — the entry point short-circuits on any truthy explicit value,
  so passing the pattern through would have sent it to `getOrCreate`. This also
  makes good the parity the probe's doc-comment already claimed with
  `resolveRegisteredServices`, whose kernel arrives as `ctx.__kernel` — set
  downstream of the same entry point.
- 499f55e: fix(rest): a missing `findReferencesToMeta` capability is refused, not answered as "nothing depends on this item" (#9326)
  
  `GET /api/v1/meta/:type/:name/references` feature-detects `findReferencesToMeta`
  on the resolved protocol. When the method was absent the route answered
  `200 { references: [] }` — so a **capability gap** reached the wire as the
  statement **"nothing depends on this item"**.
  
  Per ADR-0110 D3 those are different facts, and here they have opposite
  consequences. The consumer is the admin "Used by" panel, whose empty state reads,
  verbatim from `objectui`'s `metadata-admin/i18n.ts`:
  
  ```
  'engine.edit.refsEmptyDesc': 'Nothing in the metadata graph points at this item. Safe to delete.'
  ```
  
  An operator about to delete something was shown that sentence on a deployment
  where the question had never actually been asked.
  
  The branch now refuses:
  
  ```
  501  { error: { code: 'NOT_IMPLEMENTED',
                  message: 'protocol.findReferencesToMeta() is not available in this kernel' } }
  ```
  
  — the ADR-0112 nested envelope the sibling `/meta` 501 refusals converged on
  (#7035), so `body.error.code` is readable by the same one line of consumer code
  that already reads the others.
  
  **Does any caller's observed response change? Yes, on one deployment shape, and
  only there.** A protocol that *has* the method is untouched: both an empty and a
  non-empty result still pass through verbatim as `200`. What changes is the
  answer given when the protocol has no such method — previously `200` with an
  empty list, now `501`. No assembly in this repo produces such a protocol today:
  `ObjectStackProtocolImplementation` is the only implementation registered under
  the `protocol` service and it defines the method unconditionally. The branch is
  reachable rather than dead because `findReferencesToMeta` is **not** a member of
  `RestProtocol` (`= DataProtocol & MetadataProtocol`) and is not declared in
  `@objectstack/spec` at all — it is an ADR-0076 D9 server-only extension reached
  through a runtime cast. A host that implements the declared contract exactly, or
  that points `protocolServiceName` at its own service, is a *conforming*
  deployment that lands on this branch with no type error.
  
  Refusing at the route rather than asserting at assembly is deliberate: a
  boot-time assertion would promote an undeclared optional extension into a
  required one, which is a contract decision for `@objectstack/spec` rather than a
  route one, and it would reject the partial protocol doubles that legitimately
  exist today.
- 7fc01db: REST `/meta` write doors now carry the caller's organization, so audit rows are no longer stamped environment-wide
  
  `PUT /meta/:type/:name` (both arities), `DELETE /meta/:type/:name`,
  `POST /meta/:type/:name/publish` and `POST /meta/:type/:name/rollback` passed no
  organization, so every `sys_metadata_audit` row a REST-authored metadata write produced was
  stamped `organization_id: null`. Composed with the scoped audit read shipped alongside it —
  which returns own-org rows **plus** environment-wide ones, a limb that is required rather
  than optional — that left every REST-authored audit row readable by every tenant, carrying
  its `actor`, `note`, `lock_state` and `request_id`. The read side could not close this: the
  rows were genuinely unscoped, so no filter could separate them.
  
  The organization is taken from the execution context these doors already resolve, and is
  threaded through `organizationIdForMetaWrite` — the same registry-derived predicate the
  runtime `/metadata` dispatcher uses. Types the registry declares `allowOrgOverride: true`
  (`view`, `dashboard`, `report`, `translation`, `email_template`) now scope both the overlay
  row and its audit row to the caller's organization; every other type continues to write
  environment-wide, because its write genuinely is environment-wide and the protocol refuses
  an org-scoped write for it. `null` is now reserved for writes that really are
  environment-wide.
  
  Two behaviour changes ride along, both required for the fix to be usable rather than
  separate improvements: `publish` and `rollback` resolve their row through the organization,
  so scoping the save without scoping them would have broken the draft → publish loop; and
  `GET /meta/:type/:name/published` is now organization-scoped (organization-first, then
  environment-wide), without which it would answer 404 for an item the same caller had just
  published through the same transport.
  
  `organizationIdForMetaWrite` / `declaresOrgOverride` moved from `@objectstack/runtime` into
  `@objectstack/metadata-core` so both doors share one implementation — `@objectstack/rest`
  cannot import from `runtime`, which depends on it. Runtime behaviour is unchanged.
- 8f266f1: A sandboxed hook/action body that declares its own HTTP status (`e.status = 403; throw e`) is now served with that status on the `/api/v1/data` routes, instead of an unconditional 400 — the same #7867 declared-status rule the custom-action route already applies. The unwrapped business message stays the body text for a declared 4xx; a declared 5xx keeps the status and takes the standard sanitised server-fault envelope. Undeclared body throws (verbatim-message 400) and body crashes (sanitised 500) are unchanged.
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
- Updated dependencies [899052a]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [2d0af57]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [a38408a]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [5f5e234]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
- Updated dependencies [27a567d]
- Updated dependencies [42b05af]
- Updated dependencies [2b292ce]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [79c46da]
- Updated dependencies [1e050a5]
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [24173e9]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
- Updated dependencies [f8eb736]
- Updated dependencies [11b779e]
- Updated dependencies [739fe5b]
- Updated dependencies [4bfe1a5]
- Updated dependencies [2065e31]
- Updated dependencies [b69d0f5]
- Updated dependencies [4d47afe]
- Updated dependencies [e4e5c6e]
- Updated dependencies [9a56784]
- Updated dependencies [d00d2f6]
- Updated dependencies [df0c12d]
- Updated dependencies [d31785f]
- Updated dependencies [c308a4f]
- Updated dependencies [e2899f6]
- Updated dependencies [b6c7690]
- Updated dependencies [e6e1de4]
- Updated dependencies [3851f87]
- Updated dependencies [845e164]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [890b38f]
- Updated dependencies [8bee54b]
- Updated dependencies [04f8fdb]
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [6158146]
- Updated dependencies [84cb121]
- Updated dependencies [ca19ee8]
- Updated dependencies [a675b4d]
- Updated dependencies [b887013]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [402c125]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [b3f9831]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [bbbfcfc]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/platform-objects@17.1.0
  - @objectstack/types@17.1.0
  - @objectstack/core@17.1.0
  - @objectstack/observability@17.1.0
  - @objectstack/metadata-core@17.1.0
  - @objectstack/service-package@17.1.0

## 17.0.0

### Major Changes

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

- 9b9b70f: refactor(rest)!: 按 ADR-0049 退役 `ExportFieldMeta` 的八个约束键 —— 唯一的读者已随导入 dry run 的镜像一起退役 (#6536)

  **BREAKING.** `@objectstack/rest` 导出的 `ExportFieldMeta` 不再声明
  `required` / `system` / `readonly` / `hasDefault` / `min` / `max` /
  `minLength` / `maxLength`，`buildFieldMetaMap` 也不再计算它们。
  `ExportFieldMeta` 本身、以及全部展示类键（`name` / `type` / `label` /
  `options` / `reference` / `displayField` / `multiple`）原样保留。

  这是一次**休眠代码清扫，不是缺陷修复** —— 今天没有任何用户会撞上它。

  ## 为什么这八个键留不住

  它们只为一个消费者存在：导入 dry run 手抄的前置校验镜像
  （`firstMissingRequiredField` / `firstConstraintViolation`，framework#3956）。
  #4633 ruling D 已经退役了那份镜像（PR #6532）—— dry run 改为通过
  `DataProtocol.validateData` 向引擎要判决，而引擎读的是对象自己的 schema。
  于是 `buildFieldMetaMap` 每次导入照算不误、却**没有任何代码再读**，正是
  ADR-0049 enforce-or-remove 针对的「已声明、无人读」形状。PR #6532 当时重写了
  注释、把键留在原地，并写明退役是一次独立的清扫 —— 本 PR 就是它承诺的那次。

  关键在于：这八个键**从来不是事实来源**。`buildFieldMetaMap(schema)` 是从调用方
  自己传进来的那个 `schema` 上**派生**出它们的，所以这张表只是把调用方手里已有的
  事实抄了第二份。约束词表旁边没有执行者，却和展示词表并排站着 —— 这恰恰是
  AI 生成的消费端最容易误当成契约的形状。

  ## 迁移：FROM → TO

  只有一类代码受影响：直接调用 `buildFieldMetaMap`（或通过
  `prepareImportRequest` 拿到 `PreparedImport.metaMap`）并读取这八个键的外部消费者。
  仓内、以及 `objectui` 同级仓，逐键逐类型核查后**读者为零**。

  ```ts
  // FROM
  const meta = buildFieldMetaMap(schema).get("amount");
  if (meta?.required && !meta.hasDefault) reject();
  if (meta?.max != null && value > meta.max) reject();

  // TO —— 从你本来就持有的那个 schema 上读，也就是引擎读的同一份
  const field = schema.fields["amount"];
  if (field?.required && field.defaultValue == null) reject();
  if (field?.max != null && value > field.max) reject();
  ```

  一行版：**把读取点从派生副本移回 `schema.fields[name]`。**

  `hasDefault` 没有一对一的替代键 —— 它本身就是派生谓词
  `defaultValue != null`，镜像的是引擎 `applyFieldDefaults` 的判断
  （`packages/objectql/src/engine.ts`，`if (f.defaultValue == null) continue;`）。
  那条事实仍然成立，只是它的权威出处一直在引擎里，不在这份副本里；所以请读
  `field.defaultValue` 并自己套用同一个 `!= null` 判断。

  ⚠️ **请对着一次真实运行验证，而不是只看 tsc 变绿**：这八个是**可选**键，挂在一个
  本身继续存在的接口上，所以 JS 消费者（或任何 `any` 类型的读取）升级后读到的是
  `undefined`，编译期一个字都不会说。TypeScript 消费者才会在读取处收到编译错误。

  字段定义上的 `required` / `min` / `maxLength` 等**照旧完全可写、且照旧由引擎强制** ——
  本次没有任何可编写或已存储的元数据形状发生变化。

  <!-- adr-0087: registered export-field-meta-constraints-retired -->

- d9cac60: **BREAKING** — `GET /meta/:type/:name` now answers exactly one body shape: the
  `GetMetaItemResponseSchema` envelope `{ type, name, item, … }` that
  `packages/spec` has always declared for it. On the default configuration this
  endpoint used to answer the **bare metadata document** instead (#5563).

  ### What changed, and why it is breaking

  The route had two mutually exclusive branches with different response
  structures. The cached branch — reached whenever `metadata.enableCache` is on,
  which is the **default** (`enableCache: z.boolean().default(true)`) — served
  `getMetaItemCached`'s `result.data`, and that value has the envelope already
  stripped. The uncached branch served `getMetaItem`'s envelope. So the one shape
  the spec declared was the one a default deployment could not obtain, and the
  envelope surfaced only when the cache was off or when the read structurally
  bypassed it (`app`, `doc`, `book`, `?state=draft`, `?preview=draft`,
  `?package=`). Consumers had no correct static type — they sniffed at runtime or
  reached for `as any` (#5545 was blocked on exactly this).

  The dispatcher's `/meta` domain had the same split one layer down: the protocol
  resolver answered the envelope while the ObjectQL-registry and MetadataService
  fallbacks answered bare documents. Both fallbacks now wrap what they found,
  taking `type`/`name` from the request.

  ### Migration

  `GET /api/v1/meta/object/customer`, default configuration:

  ```jsonc
  // before — the bare document
  { "name": "customer", "label": "Customer", "fields": { /* … */ } }

  // after — the declared envelope; the document is verbatim under `item`
  {
    "type": "object",
    "name": "customer",
    "item": { "name": "customer", "label": "Customer", "fields": { /* … */ } }
  }
  ```

  - **Reading the body directly** (`fetch`, `client.meta.getItem`,
    `client.meta.getCached().data`): read the document at `.item`. Nothing inside
    it changed. `type` is the canonical singular metadata type name, so
    `/meta/objects/customer` and `/meta/object/customer` answer the same `type`.
  - **`useObject` / `useFields` (`@objectstack/client-react`)**: `useObject().data`
    is now the envelope — `data.item.label`, `data.item.fields`, where it used to
    be `data.label` / `data.fields`. `useFields()` is unchanged (it already
    returns the flattened field list) and is the shorter path when fields are all
    you need.
  - **`isMetaEnvelope`, exported from `@objectstack/rest`, is REMOVED.** It
    existed only to tell the two shapes apart. There is one shape now, so the
    replacement for `isMetaEnvelope(r) ? r.item : r` is `r.item`.
  - **Not converged, deliberately**: `?layers=true` still answers the layered
    diagnostic projection `{ type, name, code, overlay, overlayScope, effective,
validation }`. Collapsing three layers into one `item` would delete the
    diagnostic. Unaffected unless you pass that flag.

### Minor Changes

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

- 7d7521f: feat(spec,rest,objectql)!: a closed field-level error catalog, and Zod stops leaking onto the wire (#3977)

  Settles the vocabulary ADR-0112 D6 deferred, per [ADR-0114](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0114-field-level-error-code-catalog.md).

  **`FieldErrorCode` — a closed, lowercase catalog.** 27 members covering what the
  six emitters already emit. `FieldErrorSchema.code` tightens from `z.string()` to
  this enum, so a validation body's per-field codes are validated for the first time.
  `FieldValidationError.code` (objectql) and `FieldCoerceError.code` (rest) stop
  being a hand-listed union and a bare `string` respectively and reference the
  catalog, so the three cannot drift apart.

  Lowercase is deliberate, not an oversight against ADR-0112's SCREAMING_SNAKE: a
  top-level code names the condition the _request_ hit, while a field-level code
  names the _constraint_ the value violated — and constraints are declared in the
  metadata's own snake_case, so `max_length` the code and `max_length: 50` the
  property are the same word on purpose.

  **Zod issue codes no longer reach the wire (wire-visible).** Routes that validate
  with Zod passed its vocabulary straight through, so `fields[]` spoke a different
  language depending on which route served it, and `too_small` was ambiguous between
  a short string, a small number and a short array. `zodIssuesToFields` now maps
  using Zod's `origin`/`format`:

  | Was                                               | Now                                                |
  | :------------------------------------------------ | :------------------------------------------------- |
  | `too_small`                                       | `min_length` / `min_value` / `min_items`           |
  | `too_big`                                         | `max_length` / `max_value` / `max_items`           |
  | `invalid_format`                                  | `invalid_email` / `invalid_url` / `invalid_format` |
  | `invalid_value`                                   | `invalid_option`                                   |
  | `unrecognized_keys`                               | `unknown_field`                                    |
  | `invalid_union`, `invalid_element`, `invalid_key` | `invalid_shape`                                    |

  **A missing required property now reports `required`, not `invalid_type`.** Zod
  spells "absent" as a type mismatch against `undefined`, so passing it through made
  a form mark a _missing_ input as the wrong _type_. The two are indistinguishable on
  the issue alone, so the mapper takes the parsed input as an optional argument and
  walks the issue path; a caller that cannot supply it keeps `invalid_type` rather
  than guessing.

  **`unknown_param` → `unknown_field`.** `ActionParamIssue.code` references the
  catalog instead of its own literal union; the `param` key beside it already says
  what was addressed.

  **Not changed:** `EnhancedApiErrorSchema.fieldErrors` keeps its name even though
  every producer emits `fields`. Retiring an authorable key needs a tombstone plus a
  migration (ADR-0104's contract guard), so it lands on its own — the property now
  carries a banner saying which name the wire uses.

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

- 97b0798: fix(spec,rest,runtime)!: the ADR-0045 publish gate gets its own machine-managed key — `app.hidden` goes back to meaning navigation, and the built-in Account app stops 404ing for every normal user (#4829)

  <!-- adr-0087: registered app-hidden-to-unpublished -->

  **FROM → TO:** nothing to rewrite by hand. `app.hidden` keeps its spelling and its
  authoring contract; the publish gate moves to a new machine-managed key,
  `app._unpublished`, which no author writes. Stored `sys_metadata` app rows carrying
  `hidden: true` are rewritten to `_unpublished: true` by the ADR-0087 conversion
  `app-hidden-to-unpublished` — automatically on every stored-row read, and in place via
  `os migrate meta --stored --apply`.

  ## The defect

  `filterAppForUser` (`@objectstack/rest`) treated `app.hidden` as an access gate:

  ```ts
  if (
    item.hidden === true &&
    !sysPerms.has("studio.access") &&
    !sysPerms.has("setup.access")
  )
    return null;
  ```

  `hidden` does not mean that. Its contract, written in `app.zod.ts` the day the key was
  born alongside the built-in Account app, is navigation presentation: _"Hidden apps stay
  fully routable and permission-checked"_ — keep it out of the App Switcher, surface it from
  the avatar menu, which is exactly how personal-settings apps behave in GitHub Settings,
  the Google account chip and Salesforce Personal Settings.

  So the platform's own `account` app — authored `hidden: true` on purpose — was erased from
  `GET /api/v1/meta/app` for every user without `studio.access` / `setup.access`. Clicking
  the avatar → Profile landed on _"App not available — it may still be publishing"_, and
  password changes, avatar, linked accounts, active sessions and the inbox were all
  unreachable. Any admin saw a completely healthy system, which is why it survived a release
  candidate and shipped a downstream workaround.

  The two contracts arrived from different places. ADR-0045 §3 did not introduce `hidden`; it
  **borrowed** it, citing an "ADR-0019 launcher contract (`hidden`, `active`)" as an existing
  read side. That contract does not exist — **ADR-0019 contains no `hidden`** and never
  discussed launchers, the avatar menu or the Account app. The reference was dangling from
  the day it was written, which is why nothing caught the collision it created: one boolean,
  two contracts, disagreeing on the only question that matters — _may a normal user reach
  this app?_

  ## What changed

  - **`AppSchema` declares `_unpublished`** — the ADR-0045 §3 publish gate. `true` means the
    app is unpublished: externally unobservable, not merely unlisted. It is written by the AI
    additive-materialization path and cleared by `POST /packages/:id/publish-drafts`, and its
    `_` prefix is this repo's existing marker for the channel tooling stamps onto artifacts
    (ADR-0010's `_lock` / `_provenance` envelope; the prefix `lintAuthoredRecordKeys` already
    skips). It is _declared_ rather than omitted because the write path validates against
    this very schema (`saveMetaItem` → 422; `Registry.validate('app', …)` → `AppSchema.parse`),
    so an undeclared key would make the platform's own flip unwritable. The strict door
    answers the author-shaped spellings — `unpublished`, `published`, `draft` — with a
    prescription that says _publish state is not authorable_, rather than routing them onto
    the key.
  - **`app.hidden` is navigation only**, and its docblock now says so with the incident
    attached. Authoring `hidden: true` affects the App Switcher and nothing else.
  - **The REST gate judges `_unpublished`.** A hidden app is served to everyone, with its
    `hidden` flag intact so the shell can place it; an unpublished app still 404s externally
    and still reaches builders for direct-URL preview, and `requiredPermissions` still applies
    to both.
  - **`publish-drafts` clears `_unpublished`** instead of un-hiding. It writes `false` rather
    than deleting the key, because ADR-0045 §3 makes publish/unpublish symmetric, and it
    copies `hidden` through untouched — publishing no longer rewrites a presentation choice
    as a side effect. The response fields keep their `unhiddenApps` / `unhideError` spelling:
    they are a wire contract read by the objectui Publish button, and renaming them from a
    repo that cannot update that consumer would be a silent break of exactly the kind this
    change is about.
  - **ADR-0045 is amended**, its dangling ADR-0019 reference corrected, and both
    implementation sites (`rest-server.ts`, `runtime/domains/packages.ts`) are now anchored in
    `scripts/adr-anchors.json` — neither carried an anchor before, which is why an author
    could change ADR-0045's §3 without knowing they were changing a decision.

  ## Why a new key rather than deleting the gate

  Taking `hidden` out of the access decision was proposed first and refused. The gate is §3 of
  an **Accepted** ADR with pin tests and a live implementation behind it, so removing it in a
  patch would reverse a recorded decision by side effect. It is also the worse failure
  direction: a gate that fails **open** exposes a half-built app to real users, silently.

  ## Migration reach

  The conversion is `retiredFromLoadPath: true`, and here that flag is load-bearing rather
  than bookkeeping — it confines the rewrite to **stored rows**. `hidden` is not retired as an
  authorable key, so a conversion running on the load path would rewrite
  `defineApp({ hidden: true })`, and the Account app itself, into unpublished apps and
  reproduce the defect through the conversion layer. Excluded from the load path, it replays
  only where the old meaning is the only meaning: the stored-row rehydration seams and
  `os migrate meta`. Stored `hidden: true` was unambiguous under the old regime — that value
  _was_ the gate, so nobody stored it to mean "keep me out of the switcher"; code-declared
  apps like `ACCOUNT_APP` never enter `sys_metadata`, and the Studio app form has no `hidden`
  control.

  ## Follow-ups (other repos, filed separately)

  - **cloud** — the AI materialization write point must stamp `_unpublished: true` where it
    stamps `hidden: true` today.
  - **objectui** — the Unpublished banner and the Publish button must read/clear
    `_unpublished`; the App Switcher keeps reading `hidden`, which now means only what it says.
  - **os-project-titanwind-ehr** — PLAT-DEF-040's startup `{hidden:false}` overlay can be
    deleted once this ships.

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

- 789ad63: fix(spec,rest): the batch-size cap is enforced now, and each bulk endpoint has one Zod source (#3939)

  `max 200` was declared in four places and enforced in one.

  `batch.zod.ts` put `.min(1).max(200)` on `BatchUpdateRequestSchema`,
  `UpdateManyRequestSchema` and `DeleteManyRequestSchema`, and the docs repeated
  it — but no per-object bulk route validated against those schemas, so
  `createMany` / `updateMany` / `deleteMany` / `/data/:object/batch` all accepted
  an unbounded list. The only route that capped anything was the cross-object
  `/batch`, and it checked the _configured_ `maxBatchSize` rather than the
  hardcoded 200 — so even the one enforcement point disagreed with the schema.

  That stopped being cosmetic with #3897, which made `deleteMany` delete per id by
  primary key (so `deleteBehavior` cascades run and every row gets its own
  result). A 10k-id body is now 10k sequential engine round-trips inside a single
  request, where before it was one statement that mostly failed anyway.

  **The cap moved to the routes, and the schemas gave it up.** Batch size is
  deployment policy — `RestServerConfig.batch.maxBatchSize`, 1..1000, default 200
  — so a hardcoded bound in the spec could only ever be a second, wrong answer
  (a deployment raising the limit to 500 would still have been refused at 200).
  All five bulk routes now call one `enforceBatchSize` helper with the configured
  value and answer with one envelope:

  ```json
  {
    "error": "Batch too large: 500 records (max 200)",
    "code": "BATCH_TOO_LARGE",
    "count": 500,
    "max": 200,
    "object": "account"
  }
  ```

  The cross-object route is included: it used to answer with a bare `error` string
  and no `code` for a client to key on.

  **One Zod source per bulk endpoint (Prime Directive #7).** Each of these
  endpoints had _two_ schemas, and they had already drifted into disagreeing about
  more than counts: `UpdateManyRequestSchema` described its rows with
  `BatchRecordSchema`, whose `id` and `data` are optional because the generic
  `/batch` route serves create (no id) and delete (no data) through the same
  shape — so the declared contract accepted `{}` rows that `updateManyData`, which
  reads `record.id` and `record.data` unconditionally, could never process. The
  enforced shape lived in the _other_ copy, in `protocol.zod.ts`.

  The wire body is now the single source (`UpdateManyRequestSchema` /
  `DeleteManyRequestSchema`, with the new `UpdateManyRecordSchema` for a row), and
  the protocol schemas are that plus the `object` the route takes from the URL
  path (#3933) — `UpdateManyRequestSchema.extend({ object })`. The derivation runs
  that direction because `protocol.zod` already imports `batch.zod`; the reverse
  would be a cycle.

  **Behaviour changes.**

  - A bulk request over the configured cap is `400 BATCH_TOO_LARGE` instead of
    being executed. Deployments that were quietly relying on unbounded batches
    should raise `batch.maxBatchSize` (up to 1000) rather than discover the cap in
    production.
  - `.min(1)` is gone with `.max(200)`: an empty batch is a no-op returning
    `total: 0`, which is what these routes already did, rather than a validation
    error the schema claimed but nothing raised.
  - `UpdateManyRequest` now types (and validates) `records` as
    `{ id: string; data: Record<string, unknown> }[]`. Callers already had to send
    that — the route has validated the strict shape since #3933 — but the declared
    type was looser.
  - New export: `UpdateManyRecordSchema` / `UpdateManyRecord`.

- fccec22: fix(rest): bulk writes bind to the object in the path, not the one in the body (#3933)

  `POST /data/:object/updateMany` spread the request body over the value it had
  just taken from the URL:

  ```js
  const result = await p.updateManyData!({
      object: req.params.object,   // trusted, written first
      ...req.body,                 // …and spread over it
      ...
  });
  ```

  The gate on the line above reads the PATH object — `enforceApiAccess` starts
  with `const objectName = req?.params?.object` — so `enable.apiEnabled` /
  `enable.apiMethods` (ADR-0049 / #1889) was enforced on the object in the URL
  while the object named in the body got written. Measured on a stock CRM dev
  deployment: `POST /data/crm_account/updateMany` with
  `{"object":"crm_contact", "records":[…]}` returned `succeeded: 1` and changed
  the `crm_contact` row. Point the URL at any exposed object, name a hidden one in
  the body, and the gate clears the wrong object every time.

  This is not a row-authorization bypass — the engine middleware still evaluates
  RLS/FLS against the object actually written, and `assertObjectRegistered` (#3770)
  still resolves it. What it defeats is the object-level exposure policy, the layer
  ADR-0049 exists to make enforceable rather than advisory.

  The path object is now written LAST, after the body, so the object the gate
  cleared is the object that gets written — a property of the code rather than of
  the caller declining to send that key. The body is parsed against
  `UpdateManyDataRequestSchema` first, which (Zod strips unknown keys) also stops a
  body `context` from becoming the execution context on a deployment where none
  resolves — `requireAuth: false` plus an anonymous caller, the one case where the
  trailing `...(context ? { context } : {})` has nothing to overwrite it with.

  `deleteMany` gets the same ordering: #3897 moved it behind a schema parse, but
  fed that parse `{ object: req.params.object, ...req.body }` — still body-wins.
  `createMany` (`records: req.body || []`) and `batch` (`request: req.body`) never
  splatted the body at the top level and are unaffected.

  **Behaviour change.** A malformed `updateMany` body is now `400
VALIDATION_FAILED` naming the offending path, instead of reaching the protocol
  and failing further in. A body `object` key is ignored rather than honoured.

- 3f86a57: feat(rest): closed query-parameter sets become REST ingress policy, starting with the first tier of data read routes (#7606)

  **BREAKING** for tolerated traffic, and deliberately so — see the last section.

  ## The condition

  `rest-server.ts` handlers read the query keys they know and ignore the
  remainder, so a misspelled, renamed or invented parameter is **silently
  dropped** and the caller gets a plausible-looking `200`. The failure is
  undetectable from the response in both directions:

  - it **silently widens** — a dropped `?objects=` fans a search across every
    object; a dropped `?fields=` returns the whole record. An unfiltered result
    is shaped exactly like a genuinely broad match.
  - it **silently narrows** — a dropped key inside a filter answers `200` with
    zero rows, which is shaped exactly like an object that really is empty.

  There is no status, header or field that distinguishes either from a real
  answer, which is what makes it worth a policy rather than a bug per endpoint.
  An AI caller can detect neither direction at all.

  ## The policy

  A REST route **declares its closed query-parameter set on the day it lands**,
  refusing an unrecognised name with a located `400` instead of dropping it.
  Adoption is incremental and per lane — data READ routes first — never a
  one-shot sweep. The rule, its three measuring constraints and the exclusions
  are written up in `packages/rest/src/query-allowlist.ts` and in AGENTS.md's
  "Route & surface ownership" section, so it is enforceable at review time.

  ## The first tier

  Three routes, each set **measured from the handler's own read points**:

  | route                      | closed set                                                                                             |
  | :------------------------- | :----------------------------------------------------------------------------------------------------- |
  | `GET /data/:object/:id`    | `select`, `expand`                                                                                     |
  | `GET /data/:object/export` | `format`, `header`, `limit`, `page`, `filter`, `search`, `searchFields`, `orderby`, `fields`, `locale` |
  | `GET /search`              | `q`, `query`, `objects`, `limit`, `perObject`                                                          |

  The refusal is `400` with the ADR-0112 nested body
  `{ error: { code: 'VALIDATION_ERROR', message } }` — the same envelope these
  routes' existing multiplicity refusals answer, so no route gains a second
  dialect. The message names the parameters that were not understood **and lists
  the ones that are**, so a caller can fix the request from the response alone.

  ## What is deliberately NOT closed

  `GET /data/:object` (the record list) keeps accepting any name. Its handler
  passes the whole query to the normalizer, which lowers every leftover key into
  an implicit field-equality predicate — `?status=open` _is_ the filter — so the
  valid names are the object's own fields and vary per object. That route is
  already guarded one layer down and against the right authority: an unknown
  **field** is refused there with `400 INVALID_FIELD`. Closing it here would
  break every implicit filter.

  Its repeated-`?filter=` refusal (`400 INVALID_FILTER`) is untouched, and since
  the recognition gate never runs on that route the two guards never meet on one
  request.

  ## Breaking tolerated traffic is the point, and v17 is the window

  A caller sending one of these routes a parameter we ignore today starts getting
  a `400`. That is not a side effect — it is the change. This is **not a pure bug
  fix**: the blast radius cannot be measured from our side, precisely because we
  have been dropping the traffic silently, so it was decided rather than
  measured (maintainer ruling, 2026-08-12). v17 is the intended window; the
  longer it waits the more tolerated traffic there is to break.

  Two callers most likely to notice, both on `GET /data/:object/:id`: `?fields=`
  and `?populate=` are refused. They are the spec's canonical/alias spellings for
  slots this route reads as `select` and `expand`, and it folds no aliases — so
  they were being dropped, silently returning the full record. They are left
  outside the closed set rather than implemented, because adding them would
  advertise a capability the handler does not have; the refusal message names
  `select` and `expand` as what the route does accept.

  <!-- adr-0087: not-required (no-migration-prescription) HTTP query-string ingress, not stored metadata — the ADR-0087 ledger drives `objectstack migrate meta`, and no metadata migration can rewrite a caller's URL. No authorable spec key, export or config field is removed or renamed by this change. -->

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

- f4d7f1d: fix(metadata-protocol,rest): the id list is the only thing deleteMany can select on (#3897)

  `deleteManyData` built the predicate its endpoint is named after and then spread
  the caller's `options` **over** it:

  ```js
  return this.engine.delete(request.object, {
    where: { id: { $in: request.ids } },
    ...request.options, // ← lands after `where`, so it can replace it
  });
  ```

  `request.options` is caller-supplied — `POST /data/:object/deleteMany` splatted
  the whole request body into the protocol request (`{ object, ...req.body }`) —
  so one body key rewrote the operation:

  ```json
  { "ids": ["a"], "options": { "multi": true, "where": {} } }
  ```

  reached `engine.delete` as an unscoped bulk delete. The engine's write
  middleware still composes RLS/sharing predicates onto the AST, so the blast
  radius is not automatically the whole table: it is **everything the caller is
  allowed to delete**. For an ordinary user with delete permission that is the
  difference between the 3 records they asked for and every record they can see;
  measured on a stock CRM dev deployment, that payload against one id removed all
  8 rows in the object and returned the raw driver count (`8`). The same spread
  also accepted `context`, i.e. a forged principal wherever the route is reachable
  without auth.

  **The id set is now authoritative, structurally.** The engine options are built
  from the validated id list and nothing else — caller `options` is a
  `BatchOptions` bag (`atomic` / `returnRecords` / `continueOnError` /
  `validateOnly`) that carries nothing `engine.delete` consumes, so merging it
  could only ever smuggle in engine keys. Ids must be scalars, so an operator
  object (`{"ids":[{"$ne":null}]}`) cannot reach `where.id` either; a malformed
  list is a `400 VALIDATION_FAILED` instead of a wider delete. The REST route
  parses the body against `DeleteManyDataRequestSchema` first, one hop earlier —
  Zod object schemas strip unknown keys, so `options.where`, top-level `where` and
  a body `context` no longer survive the ingress at all.

  **The endpoint also works now.** `deleteManyData` never set `multi`, so a
  correctly-formed `{"ids":[…]}` hit the engine's
  `'Delete requires an ID or options.multi=true'` throw — only the requests that
  triggered the override above ever completed. Deletes now go one id at a time by
  primary key, the same shape `batchData`'s `delete` case uses, which closes two
  gaps behind that: the bulk branch skips `cascadeDeleteRelations`, so
  `deleteBehavior` (`cascade` / `set_null` / `restrict`) was not honoured for the
  rows it removed; and the declared `BatchUpdateResponse` contract (per-record
  `results`, `atomic`, `continueOnError`) was unimplementable from a bulk row
  count. Both are delivered rather than declared.

  **Behaviour change.** The endpoint returns a `BatchUpdateResponse`
  (`{ success, operation, total, succeeded, failed, results }`) where it
  previously returned the driver's raw delete count — on the paths where it
  returned anything at all. The caller's execution context is threaded to every
  delete, so RLS/FLS now run under the caller here as they do on the single-record
  route.

- 2ef1807: fix(objectql,rest,spec): the `DELETE_RESTRICTED` 409 stops handing a business user a developer instruction

  Deleting a record that other records reference is correctly refused with
  `409 DELETE_RESTRICTED`. The transport was never the problem — `status` is set
  and the structured fields survive the mapper. What reached the end user was:
  `error.message` is shipped verbatim as `body.error` by `mapDataError`, and
  Console renders that as-is in a toast. So an operator deleting a 部门 in a fully
  Chinese app read

  ```
  Cannot delete sys_business_unit (): 1 dependent os_tianshun_ehr_sporadic_application
  record(s) reference it via apply_dept (apply_dept is required, so it cannot be
  cleared). Delete or reassign them first, or set deleteBehavior:'cascade' on
  os_tianshun_ehr_sporadic_application.apply_dept.
  ```

  — an English sentence in a zh-CN UI, naming two tables and a column they have
  never seen (they know them as 「零星申请」 and 「申报部门」), ending in a
  metadata-authoring instruction a business user cannot act on and will open a
  support ticket about.

  **The error now carries two messages, because it has two audiences.**

  - `message` is the **user's** half: rendered in the caller's locale
    (`ExecutionContext.locale`) from a new built-in catalog, against resolved
    **labels** for the object, the dependent object and the referencing field —
    translation bundle → declared `label` → API name, so the API name is where the
    ladder ends rather than where it starts. The actionable half of the old advice
    ("delete or reassign them first") stays; `deleteBehavior` does not appear in
    any locale.
  - `developerMessage` is the **developer's** half, and is the previous sentence
    byte for byte: English, API names, and the `deleteBehavior:'cascade'` remedy.
    The guidance is correct and useful — it is moved to a channel that reaches
    developers, not deleted. `@objectstack/rest` ships it as a sibling field of the
    409 body (it discloses nothing the envelope did not already carry: `object` and
    `dependentObject` are API names on the same body), and the engine's delete
    error log now carries it too, so a zh-CN deployment's server log does not lose
    its operator detail to the localized sentence.

  `code`, `status`, `object`, `dependentObject` and `dependentCount` are
  unchanged, and the wire code does **not** split — one `DELETE_RESTRICTED`
  (ADR-0112), two sentences, exactly as the field catalog splits a message key
  without splitting `FieldErrorCode`.

  **New in `@objectstack/spec/system`** (`operation-message.ts`): the operation
  message catalog — `renderOperationMessage`, `BUILTIN_OPERATION_MESSAGES`
  (`en` / `zh-CN` / `ja-JP` / `es-ES`), `operationMessageTranslationKey`, plus
  `objectLabelKey` in `i18n-resolver`. A deployment overrides any sentence with a
  `translation` item under `errors.<messageKey>`. It is a **separate** catalog from
  `validation-message.ts` deliberately: that one is addressed `validation.field.*`
  because every entry names a field and the constraint it broke, and a
  `DELETE_RESTRICTED` names neither — the offending field is on a different object
  from the one the caller acted on, and there is no `fields[]` entry to hang it
  off. Filing it there would give deployments an override key that lies about what
  it overrides.

  `minor`, not `major`: nothing breaks. The structured fields clients match on are
  untouched, no test or doc ever pinned the message text, and both new fields are
  additive. `check-changeset-no-major.mjs` is the second reason — every publishable
  package is in the Changesets `fixed` group, so one `major` promotes all ~70
  packages, and the launch-window convention ships even genuinely breaking changes
  as `minor`.

  This is #3957's fix reached from the operation side: same defect (platform copy
  composed in English with API names concatenated in), same machinery, one layer
  up.

- fec7848: fix(rest): 设置了 `api.apiPath` 时,9 条 direct-mount 路由跟随同一个 API base(#6306)

  `RestServer.getApiBasePath()` 回答 `api.apiPath ?? `${basePath}/${version}``,
而 `rest-api-plugin.ts` 为两个 direct-mount registrar(`packages._`×4、`datasources/:name/external/_`×5)自行重算了一次`${basePath}/${version}`,
从不读取 `apiPath`。两个表达式只在 `apiPath`未设时相等——于是设置了`apiPath` 的部署同时出现两个 API 前缀。实测(`apiPath: '/backend/api/v9'`,
真实 `createRestApiPlugin(...).start()`组合、记录型 host server 枚举全部
挂载):**92 条路由中 83 条迁到`{apiPath}`,恰好 9 条滞留 `/api/v1`**;
`{apiPath}/openapi.json`的`isUnderBase` 过滤把这 9 条排除在文档之外
(**71 paths**);`/discovery` 也如实通告了滞留位置
(`routes.packages: '/api/v1/packages'`)——通告没有说谎,是挂载本身分裂了。

  按 maintainer 裁定(Option 1,单一真相源):registrar 现在直接消费
  `restServer.getApiBasePath()` 的返回值——共享同一个值,而不是把 `??`
  表达式复制到第二处(复制正是这个缺陷的成因)。`getApiBasePath()` 因此
  从 `private` 变为 public,职责写入其 doc comment。

  **行为变化,仅限设置了 `api.apiPath` 的部署**:这 9 条路由的 URL 从
  `/api/v1/...` 移到 `{apiPath}/...`,旧前缀不再服务(无兼容双挂载)。
  修复后实测 92 条全部挂在 `{apiPath}` 下,`{apiPath}/openapi.json`
  完整列出这 9 条(**71 → 79 paths**),`/discovery` 通告 `{apiPath}/packages`
  与 `{apiPath}/datasources`。

  需要动手的只有**基础设施配置**:若反向代理、健康检查或外部监控里硬编码了
  `/api/v1/packages` 或 `/api/v1/datasources/*/external/*`,改成 `{apiPath}/…`。
  **SDK 与应用代码无需改动**:`@objectstack/client` 自 #6633 / PR #6712 起从
  `/discovery` 通告的 base 派生这两个面,而通告是已录制挂载的投影,因此客户端
  按构造跟随本次移动。该键也没有 authoring 路径可达
  (`defineStack({server:{api:…}})` 被 strict 块 loud 拒绝,`api:{apiPath}` 被
  静默 strip,`os serve` 只转发两个 scoping 键),只有程序化组合
  `createRestApiPlugin` 的 embedder 能设到它。

  **默认配置(未设 `apiPath`)逐字节不变**:两个表达式在该情形下同值;实测
  修复前后默认挂载表(92 条)、`{base}/openapi.json`(79 paths)与
  `/discovery` 通告完全一致,逐行 diff 无差异。

  另修复同一来源的第二处分歧:插件旧表达式用 `||` 兜底(空串 `basePath`
  ⇒ `/api`),`RestServer` 规范化用 `??`(空串保留)——`basePath: ''` 时
  route-manager 面挂 `/v1` 而 9 条挂 `/api/v1`,同样的分裂不需要 `apiPath`
  也会出现(实测 83/9)。读同一个值后该分歧不复存在。

  Bump 判定为 `minor` 而非 `patch` / `major`。不是 `patch`:除了修缺陷,它
  改变了一个真实配置键下可观测的 URL 表面,并且新增了公共 API 面
  (`RestServer.getApiBasePath()` 由 `private` 转 public,是这次单一真相源的
  承载物)。不是 `major`:没有任何可授权(authorable)的键被移除或重命名,
  没有需要作者迁移的元数据(因而 ADR-0087 无可登记项),默认部署逐字节不变,
  受影响部署的客户端按构造跟随;唯一的 FROM → TO 落在部署方自己的代理配置上,
  而这些部署今天本就是 split-brain——本次是让 `apiPath` 被完整遵守,不是收回
  一个曾被兑现的承诺。

- 11066f6: feat(spec,metadata-protocol,rest,client): the direct-mount surfaces (`packages`, `datasources/:name/external/*`) become discoverable, and the SDK follows the advertised base (#6633)

  The rest surface's `/discovery` never advertised `routes.packages` — routes
  mounted but not advertised, the unstated half of ADR-0076 D12 — so the SDK's
  `packages.*` always fell back to the hard-coded `/api/v1/packages`; and the
  SDK's `datasources.external.*` had no discovery mechanism at all, hard-coding
  `/api/v1/datasources/...` in each of its five methods. On any deployment with a
  non-default API base, both families built wrong URLs (measured in #6633).
  Maintainer ruling 2026-08-08 (route B, prerequisite for #6306):

  - **spec** (minor, additive): `ApiRoutesSchema` declares a `datasources` key —
    the base of the federation-admin family. Optional like `mcp`: absent = not
    mounted.
  - **metadata-protocol** (minor, additive): `getDiscovery()` advertises
    `routes.packages: '/api/v1/packages'` iff the `package` service is
    registered (`serviceToRouteKey` gains the mapping; the route flows through a
    non-slot table because `package` is not a `CoreServiceName`). `datasources`
    is deliberately NOT advertised by this builder — the mount belongs to the
    REST host it cannot see (same disposition as `mcp`).
  - **rest** (minor): `/discovery` advertises `routes.packages` and
    `routes.datasources` as projections of the RECORDED direct mounts (#5822) —
    advertisement and mounting derive from one fact, so #6306's later mount-base
    move carries the advertisement along by construction. Not mounted ⇒ not
    advertised. An end-to-end parity pin (`discovery-advertised-direct-mounts.
parity.test.ts`) drives the composed surface and goes red on any change that
    moves only one side.
  - **client** (patch, behavior fix): the five `datasources.external.*` methods
    derive their base via `getRoute('datasources')` — connected clients follow
    the advertised base; unconnected clients (or servers that advertise no
    `datasources` key) keep building byte-identical `/api/v1/...` URLs.

  No key is removed and no wire shape changes for existing deployments: servers
  gain two advertised keys, and the SDK changes URLs only when a server
  advertises the new keys with a non-default base.

- 916af17: feat(spec,rest,client): the email surface becomes discoverable and the SDK follows the advertised base; the scoped client derives its prefix from discovery (#6714)

  `@objectstack/client` 的 `email.send` 硬编码 `${baseUrl}/api/v1/email/send`,而服务端
  `registerEmailEndpoints` 挂在 `getApiBasePath()` 下、**已经跟随 `apiPath`** —— 设了
  `apiPath` 的部署上这是**现活 404**,不是潜伏项。实测(`apiPath: '/backend/api/v9'`
  启动,录制挂载表):email 面只有 `POST /backend/api/v9/email/send` 一条,
  `POST /api/v1/email/send` 在表中**不存在**。`ScopedProjectClient.scope()` 同样硬编码
  `/api/v1/environments/...`,scoped 面全部 `meta` / `data` / `batch` / `packages` /
  `automation` URL 由它拼出;同一启动下 83 条 scoped 路由全在
  `/backend/api/v9/environments/:environmentId/...`,`/api/v1/environments/` 前缀零挂载。

  按维护者裁定(2026-08-08)复刻 #6633 / PR #6712 的四车道模式:

  - **spec**(minor,纯增量):`ApiRoutesSchema` 声明 `email` 键 —— `POST {email}/send`
    的挂载 base。`optional` 同 `datasources`:缺席 = 未挂载。
  - **rest**(minor):`/discovery` 把 `routes.email` 作为**已录制挂载**的投影通告
    (RouteManager 表中 `registerEmailEndpoints` 写入的那一行,mounted ⇒ advertised,
    不二次计算)—— 挂载随 `apiPath` 移动时,通告按构造随行。未挂载 ⇒ 不通告。
    奇偶钉(`discovery-advertised-direct-mounts.parity.test.ts`)扩展覆盖 email:
    通告值 + `/send` 必须在同一张挂载表里解析得到,单侧移动即红。
  - **client**(patch,行为修复):`email.send` 走 `getRoute('email')`;
    `ScopedProjectClient.scope()` 从通告的 `routes.data` base 推导 scoped 前缀。
    未连接、或服务端未通告 / 不可推导时,回退 URL 与旧硬编码**逐字节一致**。

  面 3 为何用 `routes.data` 而不是 `scoping` 块:实测 discovery 的 `scoping` 只有
  `enabled` / `resolution` / `scoped` / `environmentId` 四个键,**全是姿态、无路径**,
  无法推导 base;`routes.data` 由 rest 通告为 `{realBase}{crud.dataPrefix}`,是唯一可
  推导的来源。`dataPrefix` 被改成非 `/data` 时推导主动放弃、回退惯例(不做宽松再解析)。

  `cloud.environments.*` 面(约 30 处)经测量**未改**:本仓无任何宿主挂载 `/cloud/*` ——
  `@objectstack/rest` 的路由台账(`rest-route-ledger.ts`,由双向 conformance 门禁保证
  穷尽)cloud 行数为 **0**;runtime dispatcher 无 cloud domain(无 `handleCloud`、无
  `domains/cloud.ts`),且显式把 `/cloud` 列为他宿主的控制面(`skipPaths`)。而 `apiPath`
  是 `@objectstack/rest` 独有配置项 —— 该面不随 `apiPath` 移动,按裁定「不随则不收敛」
  保持原样。

- 96d3d4d: The two machine-readable endpoint surfaces announce only the declarations the runtime actually serves

  `GET {basePath}/meta/api` and `GET {basePath}/openapi.json` enumerated declared `api` items
  through the metadata protocol (ObjectQL SchemaRegistry + `sys_metadata`). Whether a declared
  route is SERVED is decided by a different reader — `IMetadataService.matchEndpoint` and the
  endpoint matcher behind it, which sees the metadata manager's registry and its registered
  loaders. A real boot measured the two disagreeing: an `api` row written through
  `PUT /meta/api/{name}` was enumerated by both surfaces — the OpenAPI document publishing it as
  a path with `security: []`, i.e. as needing no credentials — while every request to it answered 404.

  Both surfaces now ask the matcher, per declaration, and announce only what comes back. An
  `/openapi.json` is what SDKs, codegen and AI clients generate from, so an endpoint advertised
  there that does not exist propagates into everything built on top of it.

  **What changes for you:** an `api` declaration that this runtime will not serve disappears from
  both surfaces. That covers a row created by a runtime/Studio metadata write rather than
  published from a stack artifact, and one excluded at load by the ADR-0121 publish gates (for
  example `authRequired: false` with no armed `rateLimit`). If a declaration you expected has
  vanished, it was already answering 404 — the surface has stopped mis-reporting it, and the
  server log now names each omitted declaration, its route, and why. Publish it through a gated
  path (a stack artifact, or `publishPackage` with the package's `manifest.namespace`) to make it
  real. Endpoints declared in a stack artifact are unaffected: they are served, so they are still
  listed and still documented in full.

  Two surfaces deliberately keep their previous behaviour: `GET /meta/api?preview=draft` answers
  "what is pending", which is by construction not the served set, and the single-item
  `GET|PUT|DELETE /meta/api/{name}` routes stay reachable so an unserved declaration can still be
  inspected and removed.

  Hosts that embed `RestServer` directly get a new optional final constructor argument,
  `metadataServiceProvider`, resolving the `metadata` service. `rest-api-plugin` wires it; a host
  that does not pass it keeps the old enumerate-everything behaviour and logs, once, that the
  surfaces can no longer promise they describe only served routes.

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

- 05d8a54: fix(rest)!: 服务端权威闸门现在也过滤 `areas[].navigation` —— area 内导航项的权限/能力闸门不再只是渲染层的礼貌 (#4722)

  `filterAppForUser` 是 `/meta` 上 app 元数据的**服务端权威可见性闸门**,但它此前只走 app
  的顶层 `navigation` 树:读到 `item.navigation` 不存在就原样返回,`item.areas` 从头到尾没被
  读过。后果是,写在 **area 内部**导航项上的 `requiredPermissions` / `requiresService`
  只有客户端 `NavigationRenderer` 会执行 —— 该条目连同它的 `objectName` / `pageName` /
  `componentRef` 指向,照常出现在 `/meta` 响应体里。改一次前端状态、或者直接读 `/meta` 的
  JSON,就能看到本该被 gate 掉的条目。对 areas 型 app 而言,导航项级闸门此前**不是**服务端强制。

  **现在**:同一个 `filterNav` 被复用到每一棵 `areas[].navigation` 上 —— 不是第二份实现,
  所以两棵树对同一个键的语义不可能漂移。列表 `GET /meta/apps` 与单项 `GET /meta/apps/:name`
  两条路径都覆盖(两者都经过这个函数;单项读对 app 类型本就绕过缓存)。

  **响应形状收紧(可能影响消费方)**:无权限用户拿到的 app 元数据里,被 gate 掉的 area 内
  导航项**不再出现**。被闸门滤空的 area 整个剥离 —— 与顶层树对「被滤空的 group」的既有处理
  同形(空壳标签没有消费价值);作者本就写成空的 area 原样返回(过滤只报告调用方看不到什么,
  不负责整理元数据)。任何依赖「服务端会把 area 内条目全量下发、由客户端自己藏」的消费方需要
  改为信任服务端已过滤后的树 —— 这正是本次收紧的目的。

  同一提交修正了 `resolveRegisteredServices` 的探测面:它此前每个节点只取第一个命中的子数组
  (`navigation` / `children` / `widgets` 三选一),不会下钻 `areas`。若不改,只在 area 内被
  引用的服务名不会被探测,而未探测的名字在闸门看来等同于「服务不存在」,会把一个本该存活的
  条目误剥离 —— 探测面必须与过滤面完全一致。

  **明确不做**:`visible`(CEL)在任何层级仍然只在客户端求值 —— 服务端求值需要绑定 `user`
  上下文,不是这个读路径现有的能力,另立单处理。这个不对称写进了代码注释、`packages/spec/liveness/app.json`
  的账本 note,以及 `rest.test.ts` 的 characterisation pin。必须永不到达浏览器的东西,写
  `requiredPermissions`,不要写 `visible`。#4651 退役的 **area 级**键(`areas[].visible` /
  `areas[].requiredPermissions`)未被复活:本次强制的是 area **里面**的项级闸门。

- 465c5fc: REST 的 9 条 direct-mount 路由现在对 `RestServer` 可枚举,并随之进入 `GET {apiPath}/openapi.json`

  `package-routes.ts`(4 条 `packages.*`)与 `external-datasource-routes.ts`(5 条
  `datasources/:name/external/*`)一直绕过 `RouteManager`、直接挂在宿主 `IHttpServer` 上,
  `RestServer` 因此不持有「这 9 条本次 boot 是否挂载」的事实。#5588(PR #5821)把
  `/openapi.json` 的 built-in 段改成服务器自身路由表的投影之后,这 9 条(其中 8 条在
  `rest-route-ledger.ts` 里是 `disposition: 'sdk'` 的真实能力)就不在生成的文档里 ——
  用 `/openapi.json` 生成客户端的 consumer 拿不到它们,任何基于 `getRoutes()` 的自省也看不见。

  现在两个 registrar 各自把「实际挂载的那一个数组」原样返回,由组合步骤
  (`mountAndRecordDirectRoutes`,`rest-api-plugin.ts` 调用)登记到 `RestServer` 上:

  - `RestServer.getRoutes()` 返回本次 boot 的**全部**已挂载路由,每条带 `source`
    (`'route-manager' | 'direct-mount'`),类型为新导出的 `MountedRoute`;
  - `/openapi.json` 的 built-in 段随之覆盖这 9 条,带各自的 summary / tags / 路径参数;
  - 描述与挂载**同源**:返回的数组就是用来挂载的那个数组,不存在第二份手工清单。

  诚实性两个方向都保持不变:某次 boot 没有 `package` 服务 ⇒ `packages.*` 既没挂载、
  也不出现在 `getRoutes()` 与文档里;federation 那 5 条无条件挂载(服务缺席时按请求答 503),
  所以它们始终出现 —— 文档说的仍然只是「什么被挂载了」。

  对使用者的影响:`getRoutes()` 的返回值多了 9 条(服务在场时)以及每条上的 `source`
  字段;既有的 `method` / `path` / `handler` / `metadata` 读法不变。

- 507b92a: fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

  The write path built every built-in validation message by concatenating the **API
  field name** into a **hardcoded English** template. Those strings are what the
  Console toast, the CSV-import row report, the CLI and any custom client display
  verbatim, so a Chinese-locale user importing a bad row read:

  ```
  第 1 行:penalty_amount must be ≥ 0
  ```

  …for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
  form layer localized the _same_ constraint correctly (the browser's native
  `min`), so the language flipped depending on which layer caught the value.

  **Three things changed.**

  1. **The message is rendered in the caller's locale** from a built-in catalog
     (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
     `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
     The locale comes from `ExecutionContext.locale`, whose contract already read
     "Drives message catalogs"; this is the consumer that makes that true. Both
     HTTP entries (REST server, runtime dispatcher) now resolve it from the
     request's `Accept-Language` / `?locale` first, falling back to the workspace
     `localization.locale` — so a rejection message and the field labels around it
     can no longer disagree.

  2. **The field is named by its label, never the API name**: translation bundle
     (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
     resort. `FieldValidationError.field` still carries the API name so a form can
     focus the right input.

  3. **The constraint is exposed as data**, so a client can format its own text
     instead of parsing the sentence:
     `{ field, code, message, label, constraint: { min: 0 } }`. This rides
     ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
     (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
     than adding a parallel payload — `label` is the only new field. The bag
     carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
     message templates interpolate from exactly those keys.

  Covered end-to-end, not only in the validator: single and batch insert,
  single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
  rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
  state-machine fallbacks), and the importer's cell-coercion, required pre-check
  and #3956 bound pre-check messages — all of which land in the same row report.

  **What this changes for consumers.**

  - `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
    match on. Message keys are finer-grained than codes — `invalid_datetime`,
    `invalid_option_value`, `required_cleared` are rendering detail and never reach
    the wire — so localization never splits the client-facing vocabulary.
  - `message` **text changes**: it is localized, and it names the field by label
    even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
    asserting on the old English string should match `code` (and now
    `constraint`) instead.
  - An author-written validation-rule `message` is never touched — it is already
    in the language its author chose.
  - A deployment can override any built-in message with a `translation` item
    defining `validation.field.<messageKey>` (e.g.
    `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
  - The importer's reference-failure message no longer names the target object's
    API name (`no sys_user matches "…"`): naming internal identifiers is the
    defect being fixed, and the column plus the offending value are what an
    importer can act on.

- 8aacf94: feat(rest,runtime,client): `POST /meta/_migrate-stored` — run the stored-metadata migration without a shell (#4327)

  `os migrate meta --stored` (#4327) gave ADR-0087's stored-metadata chain a finish
  line, but only for someone who can reach the deployment's database from a
  terminal. A hosted operator cannot, so on a managed deployment the chain had no
  finish line at all — just the per-read conversion, running forever, with no way
  to assert what protocol the rows are on.

  The same pass is now reachable over HTTP:

  ```ts
  const preview = await client.meta.migrateStored(); // writes nothing
  const result = await client.meta.migrateStored({ apply: true });
  const flows = await client.meta.migrateStored({ types: ["flow"] });
  ```

  It returns the same `StoredMigrationReport` the CLI renders, and takes the same
  posture:

  - **Preview by default.** `apply` must be literally `true`; an empty body, a
    missing body, and `"apply": "yes"` all preview. Nothing is inferred.
  - **Gated on `manage_metadata`.** Unlike the single-item `PUT /meta/:type/:name`
    next door, this rewrites every eligible row in the deployment, so it demands
    the ADR-0066 D1 authoring capability rather than just a session, and answers
    `403` otherwise. The gate runs before the protocol is probed, so an
    unauthorized caller cannot use `403`-vs-`501` to learn which kernels can be
    migrated. `/meta`'s anonymous-deny umbrella still closes it to anonymous
    callers first.
  - **Attributed to the caller.** The `actor` recorded on the history and audit
    rows names the user who fired it — that is the question those rows exist to
    answer.

  **Flows need no extra setup on this path.** The CLI has to boot an inert
  automation engine to hold the executor registry ADR-0078's conflict guard needs;
  a server already has a live one, and the protocol resolves it from the services
  registry itself (#4498), so this route covers flow rows by simply running in the
  process that owns them.

  Registered on both the REST server and the runtime dispatcher's `/meta` domain,
  ledgered in both route ledgers, and mounted before `/:type` so the
  leading-underscore segment is never captured as a metadata type name.

- 623d008: feat(rest): `PUT /api/v1/meta/:type/:name` 要求 `manage_metadata` 能力 (#6603)

  **这是一次访问面收紧,线上可见。** 保存单个元数据项的这条路由此前只有
  `enforceAuth` —— 任何已认证会话都能写任意元数据项。现在它与隔壁的
  `POST /api/v1/meta/_migrate-stored` 用同一道门、同一套机制:调用方必须持有
  ADR-0066 D1 的 `manage_metadata` 能力,`isSystem` 照例放行。

  ## 谁开始吃 403,需要什么

  **任何不持 `manage_metadata` 的已认证调用方**,对这条路由的 `PUT` 一律
  403 `FORBIDDEN`(匿名调用方仍先吃 `/meta` 伞下的 401,门是第二层)。
  平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
  Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是
  自建集成、自建权限集,以及只持 `setup.access` 的 `organization_admin`。

  **要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
  Permission Sets → `systemPermissions`),而不是绕过这条路由。

  ## 为什么必须收紧

  ADR-0106 D1 会把调用方不可读的字段**整个**从服务出的对象 schema 里摘掉,
  而这条路由原样持久化收到的 body。于是一次最普通的
  GET → 改个 label → PUT,就把调用方**从来没被允许看见的字段删掉了**,
  整个交互过程中没有任何东西提示。GET-改-PUT 正是 AI agent 编写元数据的
  标准动作,原先这个动作会静默销毁它看不见的字段;现在它在写入时得到一个
  **响亮的 403**。

  同时这也关掉一个与掩码无关、更早就存在的洞:任何已认证会话都能覆写
  任意 schema。

  ## 尚未关闭的部分

  本次只收紧这一条路由。同形的 `PUT /meta/:type/:section/:name`(复合名)
  与运行时 dispatcher 自己的 `/meta` PUT 仍无能力门,同一次往返丢失仍可经
  它们复现 —— 已另立 #7019 跟踪,不在本次范围内。

- 73648ba: feat(rest,runtime): 元数据写入的其余三扇门同样要求 `manage_metadata` 能力 (#7019)

  **这是一次访问面收紧,线上可见。** #6603 只给 `PUT /api/v1/meta/:type/:name`
  一条路由落了 `manage_metadata` 门,而同一个写操作还有另外三扇门没有门。本次
  把它们补齐,用的是**同一道门、同一套机制**(各自照抄所在文件的既有先例):

  - `PUT /api/v1/meta/:type/:section/:name` —— 复合名保存(`@objectstack/rest`);
  - `DELETE /api/v1/meta/:type/:name` —— 重置为构件默认值(`@objectstack/rest`);
  - 运行时 dispatcher 自己的 `/meta` PUT —— 同一操作的**第二条传输**(`@objectstack/runtime`)。

  ## 谁开始吃 403,需要什么

  **任何不持 `manage_metadata` 的已认证调用方**,对上述三条路径的写入一律 403
  (匿名调用方仍先吃 `/meta` 伞下的 401,能力门是第二层)。`isSystem`(引擎自调)
  照例放行。平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
  Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是自建集成、
  自建权限集,以及只持 `setup.access` 的 `organization_admin`。

  **要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
  Permission Sets → `systemPermissions`),而不是绕过这些路由。

  ## 为什么必须收紧

  两条**各自独立成立**的理由:

  1. **ADR-0106 的读写不对称。** D1 会把调用方不可读的字段**整个**从服务出的对象
     schema 里摘掉,而这些路由原样持久化收到的 body。#6603 落地后**实测**:同一次
     GET → 改个 label → PUT 的字段丢失,经复合名这扇门可原样复现 —— 缺陷没有被修复,
     只是换了一扇门。本次复测的前后对照:

     ```
     加门前: compound PUT status : 200 | saveMetaItem calls : 1 | STORE after PUT : id, name
     加门后: compound PUT status : 403 | saveMetaItem calls : 0 | STORE after PUT : bonus_formula, id, name, salary_grade
     ```

  2. **一个与掩码无关、更早就存在的洞:** 任何已认证会话都能覆写(或重置)任意
     元数据项。`DELETE` 这条尤其是这个理由而**不是**掩码理由 —— 它不往返、不掩码,
     只是把定制覆盖层整个丢掉,`?dropStorage=true` 还会连对象的物理表一起拆掉。

  三处门都落在解析 protocol **之前**,所以未授权调用方无法用 501-vs-200 指纹探测
  内核能力,且拒绝时**什么都没写、什么都没删**。

  ## 不在本次范围

  只收紧写入面;读路径的姿态(ADR-0106 掩码)不变。#7020 记录的「门要求的能力集
  与 D4 掩码豁免集不是同一个集合」仍然成立,本次不替维护者选对齐方向。

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

- 75f82f3: **`/openapi.json` 的 built-in 路由段改由 rest 按自身路由事实产出(#5588,维护者裁定 C 第一棒)**

  发布出去的 `GET {apiPath}/openapi.json` 里,built-in 路由那一段**一条都不存在**:真实 boot 逐条探测,7 条 path / 10 个 operation **0/10 命中**。段落由 `packages/spec/scripts/build-openapi.ts` 按字面量 `basePath = '/api'` 手写,于是路径全部缺 `/v1`(CRUD 还缺 `/data`);`PUT {object}/{id}` 写错动词,服务器对 `PUT` 明确回 405;`/api/meta/types` 全仓无此路由;`/api/.well-known/objectstack` 是 runtime dispatcher 的路由、服务在**根路径**上而非 API base 下。照这份文档生成客户端,每一个数据调用都 404。

  这个座位上也不可能写对:`apiPath` 是部署级配置(`api.apiPath ?? api.basePath + '/' + api.version`),随包发布的静态 JSON 无法为所有部署拼对前缀。

  **改法**:built-in 段的属主是**挂载这些路由的包**(ADR-0076 一路由一属主;本文档的属主由 #5078 的真实 boot 坐实为 `packages/rest`)。serve 期流水线现在从 `routeManager.getAll()`——路由器自己用来匹配请求的那张表,请求时读取——产出该段,并**丢弃**静态产物里带来的 `paths` 而不是与之合并(合并等于把错误的段再发布一次;spec 侧的生成要到第二棒 #5744 才摘除)。同一张表既决定「谁被服务」又决定「谁被描述」,幽灵行因此在结构上不可能存在:四条 bulk 路由只在 protocol 实现了 `batchData` / `createManyData` 时注册,于是也只在那时被描述。

  - 路径前缀跟随实际配置的 `apiPath`,project-scoped 镜像有自己的文档(不再把每条路径写两遍);
  - 动词是注册时的动词(`PATCH` 就是 `PATCH`);
  - 覆盖面:该 base 下经本服务器 `RouteManager` 挂载的**全部**路由(默认 boot 78 条,对比旧段的 10 个 operation),`rest-route-ledger.ts` 中 `source: 'route-manager'` 的各 family 全含,不按 `disposition` 裁剪——`server-only` / `public` 也是被服务的 HTTP 面。**不含**两个 `direct-mount` registrar(`package-routes.ts` / `external-datasource-routes.ts`,9 行):它们绕过 `RouteManager` 直接注册且受服务开关约束,本服务器**不持有**它们本次 boot 是否挂载的事实,而凭空补上正是本单要修的那类缺陷;也不含其它包挂载的路由(dispatcher 根路由、`service-storage`、`service-i18n`);
  - 不编造:请求/响应 schema、状态码、query 参数一律不生成(旧段的 `CreateRequest` / `UpdateRequest` `$ref` 除了挂在 404 的路径上,连线上形状都是错的——`{ data }` 信封 vs 裸记录体,spec 自己的路由目录 `plugin-rest-api.zod.ts` 里已记录这一点)。每个 operation 只写从注册读出的 `summary` / `tags`、从路径机械推导的 `operationId` 与 path 参数,响应写 `default`(成功状态是逐 handler 的事实,写 `200` 对 201/204 的路由就是错的);
  - 逐 operation 的 `security` 只在注册带 `public` 标签时写 `[]`(匿名表单),其余继承文档级要求——对 `/discovery`、`/openapi.json` 这类实际匿名的路由属于**故意少说**:注册没有携带鉴权事实,而「不需要凭据」是写错会漏数据的那个方向。

  `{object}` 展开与声明式端点合并两步原样保留,只是展开的模板终于是真实存在的路由(`/api/v1/data/{object}` 及其同族)。`components.schemas` / `info` / `securitySchemes` 仍来自 `@objectstack/spec` 并原样保留——那是它真正拥有的部分。

- 1203bb2: **声明式端点进 OpenAPI 文档;`/openapi.json` 的影子属主摘除(#5040 E6,并入 #5078)**

  `GET {basePath}/openapi.json` 只有一个属主,而且实测坐实是 `packages/rest`(#5078:真实 boot 拿到 355KB 的 OpenAPI 3.1 文档,`servers[0]` 按 Host 注入、`{object}` 展开出 199 条 paths、两条 `x-template` —— 三个指纹全部是 rest-server 的行为)。因此 `apis:` 端点的文档面加入 **rest-server 既有的 enrichment 管线**(与 `{object}` 展开同根、同一次请求、同样 best-effort),而**不是**在某个 metadata service 上实现 `generateOpenApi` —— 那会造出 ADR-0076 第 1 条明令禁止的第二属主。E1 的契约成员因此已剔除。

  每条声明贡献一个 path 条目:`path` 原样、`method` 小写作为 Operation 键、`operationId` = `name`,以及词表**真正带有**的两个文档字段 `summary` / `description`(缺省即缺省,不生成替身)。除此之外只写「执行器会怎么对待这条声明」的事实,逐条注明出处:`object_operation` 的 `get`/`update`/`delete` 记录 id 取 `query.id`(词表无路径模板语法)、`create` 答 201 其余 200、`script` / `proxy` 与缺 `objectParams` 的 `object_operation` 答 **501**。不编造任何 request/response schema —— 出厂文档的 `components.schemas` 是空的,凭空写 `$ref` 只会得到悬空引用。

  `authRequired` 由 schema parse 物化(缺省即 `true`),为 true 的条目引用**从文档自身读出**的 security 方案(不在 rest 里硬写方案名,否则就是第二处需要保持正确的地方),为 false 的条目写显式 `security: []` —— 这是 review 时一眼能看见的那个形状。不满足 `ApiEndpointSchema` 的存量条目**响亮跳过**并点名(与端点匹配器的装载门同一姿态);同 `method+path` 撞车时按「`name` 字典序在前者胜」裁决,与匹配器**同一条规则**,否则文档会指认一个运行时并不执行的端点;撞上内建路径时内建保留,声明被略过并报错。

  同时摘除 `http-dispatcher.ts` 里的 `generateOpenApi` 探测死分支:该方法在本仓与两个兄弟仓**零实现**,且 boot 实测**没有任何路由**把 `/openapi.json` 送进 `dispatch()` —— 双重死。`route-ledger.ts` 里对应的行与 `LEGACY_CHAIN_PREFIXES` 条目一并移除(原注记「falls through when metadata service lacks a generator」把「从来没有」写成了「有时没有」,正是 #5078 立单的失准点;把 prefix 留在一张自述为「if-chain 分支」的清单里,会在同一个 PR 里再造一次同样的谎)。该路由的唯一台账行在 `packages/rest/src/rest-route-ledger.ts`,一直是准的。

  **现网行为零变更**:publish / validate 对非空 `apis:` 仍然硬拒(E7 前不撤),所以今天枚举出的是空集,enrichment 原样返回同一个文档对象 —— 服务出去的字节与本次改动前逐字节相同,并有测试钉住。

- 2934761: fix(rest): a repeated `?version=` on `/packages/:id` is refused, not silently resolved (#6307)

  `IHttpRequest.query` is declared `Record<string, string | string[]>` — a repeated
  query parameter arrives as an **array**. Both `/api/v1/packages/:id` handlers read
  it as a string and passed it straight to `PackageService.get/delete`, whose
  parameter is `version?: string`. Measured on `main` before the fix:

  ```
  GET    /packages/com.acme.crm?version=1.0.0&version=2.0.0
         → packageService.get('com.acme.crm', ['1.0.0','2.0.0'])
  DELETE /packages/com.acme.crm?version=1.0.0&version=2.0.0
         → packageService.delete('com.acme.crm', ['1.0.0','2.0.0'])
         → 200 { message: 'Deleted com.acme.crm@1.0.0,2.0.0' }
  ```

  The `DELETE` line is the sharp one. `if (!version && protocol.deletePackage)` is
  what gates the **full uninstall** (#2747: the package's metadata rows, the durable
  `sys_packages` record, and the registered data-plane cleanups — plugin-security
  revoking its permission sets and bindings). Any truthy `version` skips it, so a
  repeated parameter silently narrowed the _scope of the operation_ on a destructive
  verb and still reported success.

  **Both verbs now refuse the ambiguity** with `400 VALIDATION_ERROR`
  (`The "version" query parameter was supplied 2 times. Supply it at most once — this
endpoint will not choose between conflicting values.`). `?version=a&version=b` is a
  well-formed request carrying two conflicting intents; picking one silently is a
  wrong answer delivered as a `200`. The rule is identical on both verbs — one
  parameter, one answer — and the code comes from ADR-0112's **standard** catalog
  rather than a newly registered synonym, because "this request contradicts itself"
  is a generic validation condition.

  The rule is about **multiplicity, not shape**: the parameter may be supplied at
  most once. A one-element array is one occurrence encoded differently by an adapter
  and is accepted; an empty array is no occurrence. Two identical values are still
  two occurrences and are still refused — "at most one _distinct_ value" would be a
  de-duplication rule no client can predict, while "supply it at most once" is
  checkable client-side.

  **Not tolerance for off-spec input.** The contract already declared the array; the
  consumer simply never handled a shape it was told to expect.

  **Nothing that works today changes.** A single `?version=1.0.0`, no `version` at
  all, and an empty `?version=` all behave exactly as before — including the full
  uninstall still being reached when no version is supplied. No in-repo caller,
  documented example or SDK path repeats the parameter (`client.packages.get` builds
  `?version=` from a single `version?: string`), so the new 400 is unreachable from
  any supported client. It is `minor` rather than `patch` only because a request
  shape that used to answer `200` now answers `400`.

  Adapter note, measured over a real socket: the `node:http` adapter
  (`NodeHttpServer`) hands `['1.0.0','2.0.0']` to the handler as the contract
  declares, while the Hono adapter collapses a repeat to the first value before any
  handler sees it. Both are contract-legal (the union permits either), which is
  exactly why the consumer must handle the declared shape rather than depend on
  which server booted.

- b295e4b: feat(runtime,rest): `/packages` 域补齐授权门 —— 写/破坏性路由要求 `manage_metadata`,读路由要求 D4 读集,全域匿名门 (#7033) (#7023)

  `/packages` 是最后一个零授权判据的路由域:普查实测一个连 `userId` 都没有(身份解析为
  `principalKind: 'guest'`)的调用方,对**破坏性**的 `POST /:id/discard-drafts`、整包
  `GET /:id/export`(27 种 metadata)、`GET /packages`(id 枚举面)与 `POST /:id/publish-drafts`
  一律得 **200** 并真的调进目标函数;而隔壁五个同族域(`/meta`、`/actions`、`/automation`、
  `/ai`、`/security`)都带 `shouldDenyAnonymous` 匿名门。本次按维护者 2026-08-09 裁定补齐:

  - **全域匿名门**:`shouldDenyAnonymous` 作为 `handlePackagesRequest` 的**第一条语句**,
    在 ObjectQL registry 探测之前,使匿名调用方拿不到 401-vs-503 的部署指纹。
  - **写 / 破坏性路由**(install / enable / disable / publish / publish-drafts /
    discard-drafts / commit-revert / rollback / revert / adopt-orphans / duplicate /
    manifest-PATCH / DELETE)要求 `manage_metadata` —— 与 #6603 / #7019 给 `/meta` 写面
    落的同一道门、同一判据(「能写 schema 的人就该是能管理 package 的人」)。
  - **读路由**(list / detail / commits / export)要求 ADR-0106 D4 读集
    `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES`(`studio.access` / `setup.access`)—— **引用
    该常量,不复制**,使 package 读取的能力集不会与 metadata 掩码豁免集漂移。
  - 门覆盖**两个 transport**:runtime dispatcher 域(`domains/packages.ts`)**与**
    `@objectstack/rest` 直挂注册器(`package-routes.ts` 的 `refusePackageRequest`,
    经 `RestServer.resolvePackageRouteExecutionContext` 解析与其余表面同一身份)。缺
    resolver 时 REST 侧**失败即关**(401),不留裸露回退。所有门都在协议/服务解析**之前**
    判,拒绝时不写不删(防「先删后拒」)。`isSystem`(不可从线上伪造)旁路,CORS `OPTIONS` 放行。

  **盲区(明说,勿当已核):** `cloud` 仓在本会话与前序普查会话中**均未挂载**(`add_repo`
  两次被拒),调用方普查**不覆盖该仓**。若 `cloud` 内存在直打 `/api/v1/packages/*` 或
  dispatcher `/packages` 且今天不持 `manage_metadata` / D4 读集的生产调用方,本门可能将其
  403 —— 落地后需在 `cloud` 补一次调用方普查复核。`#7020` 记录的「门能力集 ≠ D4 掩码豁免集」
  对齐方向仍归维护者,本次不动。

- be7945a: feat(rest): `audience: 'public'` publishes a book anonymously on a secure-by-default deployment (#3963)

  `book.audience: 'public'` was a declared per-book capability that in practice
  required the deployment to open its **entire** data plane. The `/meta` umbrella
  gate refused every anonymous caller unless `api.requireAuth` was `false`, so a
  `public` book was only ever reachable inside a globally-public deployment — the
  audience model was _re-narrowing_ what that flag had already opened, not granting
  anything of its own. ADR-0046 §6.7 recorded exactly that as ground truth ("the
  gate is the optional global `requireAuth` … not the handler").

  The exemption is now derived from the declaration, the same shape ADR-0056
  Option A chose for public form submission (`publicFormGrant`): the umbrella gate
  admits an anonymous **GET** of the book/doc read surface, and the §6.7 audience
  gate inside the handler is what authorizes it.

  Narrow in three independent ways:

  1. **Only when no execution context resolved.** An authenticated caller still
     goes through `enforceAuth` unchanged, so the ADR-0069 auth-policy gate
     (expired password, enforced MFA) keeps governing a gated session's book reads.
  2. **Only GET, only book/doc.** `GET /meta/:type`, `GET /meta/:type/:name` (type
     `book` or `doc`, either spelling — #3984) and `GET /meta/book/:name/tree`.
     Every other type stays 401 for anonymous, writes stay 401, and `GET /meta`
     itself stays 401. The predicate keys on the REGISTERED route path plus the
     normalized `:type`, so a route added later cannot fall into it by accident.
  3. **Reachability, not authorization.** `audienceAllows` admits `'public'` only;
     `org` and `{ permissionSet }` books require `caller.authenticated` and
     unresolvable holdings fail closed, so an anonymous read of a gated book is
     still `401`.

  A deployment can now publish a public manual with `requireAuth: true` — which is
  the prerequisite for retiring that flag entirely (#3963 step 2). ADR-0046 §6.7
  carries an amendment recording the new gate; its SEO and tenant-from-host
  reasoning is unchanged, having never depended on the flag.

- d586366: fix(rest): a public form that declares no fields now REFUSES the submit instead of accepting every key the caller sent (#6920)

  `POST /api/v1/forms/:slug/submit` narrows a visitor's suppliable keys to the
  fields the matched FormView's `sections` declare — and the filter read
  `allowedFields.size === 0 || allowedFields.has(k)`. For a form with no declared
  fields that limb degenerated, and not into "every field of the object": it
  accepted **every key the caller sent**, minus the `#3022` server-managed anchors
  and the three prototype keys. Measured on the real registered handler,
  anonymously, against a `sections: []` form:

      submit accepted = ["email","internal_margin","internal_tier",
                         "not_even_a_field","status","subject"]

  `not_even_a_field` is not declared on the target object at all. So an anonymous
  visitor could set `status`, a workflow stage, an internal tier — anything, on
  the one object the form targets. `publicFormGrant` (ADR-0056) keeps the insert
  scoped to that object, so this was never a cross-object hole; it was an
  unbounded **column** surface on one. The way in is an ordinary authoring
  mid-state: the author creates the public form and wires its sections later.

  **What changes.** A form whose sections declare no fields now answers
  `400 VALIDATION_ERROR` and inserts nothing. The message names the empty
  declaration and gives the author's fix ("wire the fields it collects into the
  form's sections"); it names no object, field or slug, because this reply is
  readable by anyone on the internet. The three authoring shapes that reach it —
  `sections: []`, sections present but declaring no fields, and `sections` omitted
  — are treated identically, and the refusal keys off the **declaration**, not the
  body, so an empty POST is refused too rather than inserting a blank row.

  `VALIDATION_ERROR` is the standard ADR-0112 catalog's generic validation
  failure, and what `HttpStatusErrorCodeMap[400]` already names a bare 400. It is
  deliberately not a newly minted `FORM_*` synonym of a condition the catalog
  already covers.

  **Why a refusal and not a silent drop.** Dropping the keys would have kept the
  `201` and changed no wire status, but it would swallow data the caller believes
  it wrote — a visitor is told their support ticket was filed and an empty row is
  stored. Loud is also the only answer that reaches the author, who is the one who
  can fix it.

  **This is a behaviour change on a shipped success path.** A deployment that
  today collects submissions through a section-less public form starts getting
  `400`s. That form's read side already publishes nothing (`fields: {}`) since
  `#6601`, so it cannot render either — the two planes now enforce the same rule,
  "the form declares what it collects", on both. **Fix: declare the fields in the
  form's `sections`.** Forms that already declare sections are entirely
  unaffected — that path never consulted the removed limb.

  `#3022`'s anchor guarantee is preserved unchanged: `owner_id`,
  `organization_id`, `id` and the audit columns remain unsuppliable on this
  surface, including when a FormView mis-declares one in a section.

- 54fe9d5: fix(rest): 未声明字段的公开表单不再向匿名调用者发布目标对象的**全部**字段(#6601)

  `GET /api/v1/forms/:slug` 会把目标对象的 schema 一并内嵌进应答,好让匿名前端不必再走
  一次需要鉴权的 `/meta` 就能渲染表单。收窄的依据是表单 `sections` 声明的字段集合,但那段
  代码写的是:

  ```ts
  if (allowed.size === 0 || allowed.has(name)) {
    fields[name] = def;
  }
  ```

  `allowed.size === 0` —— 表单**没有 sections**,或者 sections 一个字段都没声明 —— 会
  落到「发布该对象每一个非 server-managed 字段」这一支。**这条路由是匿名的**,所以发出去的
  是完整的字段定义:label、type、picklist 的选项值(常常就是一份运营分类表)、formula
  表达式(定价/评分 IP)。下方的 `safeForm` 只过滤表单自己的 `sections`(未声明
  `publicPicker` 的 lookup),它与 `objectSchema.fields` 是同一份应答上的两个并列键,从不
  收窄后者。那段代码上方注释里的「limited to fields referenced by the form」在这一支上是
  不成立的;注释同时提到的「submit 侧仍有服务端字段白名单」是**写**侧防线,挡不住**读**侧
  的披露。

  「表单先建、sections 之后再配」是完全正常的编写中间态,所以这不是一个刁钻配置。
  ADR-0106(#3682)刚刚让平台能完整地讲出「调用者读不到的字段,对它而言在任何平面上都不
  存在」这句话,而这条路由是它剩下的那个反例,且调用者是**匿名**的。

  **行为变化(线上可见)。** 发布集合现在等于表单声明的字段集合本身:

  ```ts
  if (!allowed.has(name)) continue;
  ```

  一个字段都没声明的表单,`objectSchema.fields` 就是 `{}`。应答的信封形状不变
  (`objectSchema` 仍是 `{ name, label, fields }`,不会变成 `null`),`object` /
  `label` / `form` 几个键也都不变。**已经正常声明了 sections 的表单,应答逐字节不变** ——
  它们本来走的就是 `allowed.has(name)` 那一支。

  这里没有新增任何可编写的键。发布应当是一次**声明**,而不是从空集合里掉出来的默认值
  (AGENTS.md「Explicit composition over default magic」);真需要「整对象发布」的场景,
  带着真实用例来提,再按 ADR-0049「没有需求牵引就不造能力」的顺序决定要不要造这个开关。

  `PUBLIC_FORM_SERVER_MANAGED_FIELDS` 的处理(#3022 的 server-managed 锚点)完全未动,
  `POST /forms/:slug/submit` 与 `GET /forms/:slug/lookup/:field` 也都未动。

- 27358d5: Add a batch form to `security/explain` (#8326): `recordIds: string[]` (max 200, mutually exclusive with `recordId`) on the existing request shape answers the per-record `decision.record.visible` verdict map for one `(object, operation)` pair in one round trip. The response gains an optional `records` array where `records[i]` answers `recordIds[i]` (duplicates answered per position); a missing record fail-closes to `visible: false` with `decidedBy` omitted. Each id is evaluated through the singular pipeline, so the batch answer for a record is identical to the singular answer by construction. Singular and object-level requests and responses stay byte-compatible; a request carrying both spellings, an empty batch, or more than 200 ids is refused with `400 VALIDATION_FAILED`.
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

- a1b61e0: Request bodies are now checked against the schemas the API catalog declares for them (#3899, the request-side dual of #3877).

  **Routes that now answer `400 VALIDATION_FAILED` + `fields[]` for a body violating their declared `requestSchema`** (previously the body was consumed raw, and a malformed one silently executed different semantics):

  - `POST /data/:object/query` — body must be a QueryAST (`FindDataRequestSchema`); a garbage body used to degrade into an unfiltered full read. The path `object` is now pinned into the forwarded query (a body `object` can no longer contradict the path).
  - `POST /data/:object` / `PATCH /data/:object/:id` — body must be a record object (`CreateDataRequestSchema` / `UpdateDataRequestSchema`).
  - `POST /data/:object/batch` — body must be a `BatchUpdateRequestSchema` (`operation` + `records[]`).
  - `POST /data/:object/createMany` — body must be a bare JSON array of records (`CreateManyDataRequestSchema`); `{ records: [...] }` (updateMany's envelope) is rejected with a pointer.
  - `POST /notifications/read` — body must be `{ ids: string[] }` (`MarkNotificationsReadRequestSchema`); a misnamed key used to become `markRead(userId, [])` — a 200 no-op that never cleared the badge.

  **Dispatcher automation routes now validate their bodies** (no catalog schema; hand-written guards):

  - `POST /automation` and `PUT /automation/:name` require a flow-definition object, and POST requires a non-empty `name` — a mistyped `name` used to register the flow under the key `undefined` and echo 200.
  - `POST /automation/:name/toggle` is strictly `{ enabled?: boolean }` — `{"enable": false}` (one letter off) used to ENABLE the flow and answer 200 `{enabled: true}`; it is now a 400 naming the offending key. An empty body still means enable.

  **`QuerySchema` now declares the search contract ADR-0061 actually serves** (additive): `search` accepts the canonical bare query string as well as the structured `FullTextSearch` form, and the server-validated `searchFields` narrowing is formally declared. Previously the schema declared only the object form while every surface (and the ADR's own conformance proof) sent the string — drift that surfaced the moment request bodies started being validated.

  **Catalog corrections in `@objectstack/spec` (`plugin-rest-api.zod.ts`)** — documentation-only tables:

  - `DEFAULT_NOTIFICATION_ROUTES` drops the four device/preferences endpoints — those server routes were removed in #3612 (never built), yet the table kept declaring them, `requestSchema` and all.
  - `DEFAULT_AUTOMATION_ROUTES`' trigger endpoint path is corrected `/trigger` → `/trigger/:name` (the mounted path; the flow name rides the path) and its `AutomationTriggerRequestSchema` declaration is removed — that schema never described this route's wire shape.
  - `DEFAULT_DATA_CRUD_ROUTES` gains the `POST /:object/query` entry (mounted since forever, previously undeclared), repoints create/update to the schemas the routes actually validate (`CreateDataRequestSchema` / `UpdateDataRequestSchema` — the old `CreateRequestSchema`/`UpdateRequestSchema` names described a `{ data }` envelope the wire never had), and drops `requestSchema` from GET/DELETE entries (path/query-bound inputs; nothing can violate them as a body).
  - New gates: catalog `requestSchema`/`responseSchema` strings must resolve to real exported Zod schemas, `requestSchema` may only sit on body-carrying methods, and every declared `requestSchema` on a mounted route has a violating-body → 400 conformance case (`packages/rest` + `packages/runtime` request-schema-gate suites).

  Migration: clients that already send the documented shapes are unaffected. If you relied on a malformed body being silently accepted (e.g. posting `{ records: [...] }` to `createMany`, a non-boolean `enabled` to toggle, or an off-schema analytics/query body), fix the request to the declared shape — the 400's `fields[]` names each offending key.

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

- 361bd5b: fix(spec,rest): three routes stop serving shapes their `responseSchema` never declared (#5882 #5950 #6442)

  Sweep #6487. One admission criterion: a route serves a response shape its
  declared `responseSchema` does not describe. Three members, one direction each,
  stated per member rather than picked for cheapness.

  **`GET /meta/:type/:name` — the ADR-0010 protection envelope is now declared
  (#5950).** The uncached branch has always sent `lock` plus nine siblings on top
  of `{ type, name, item }`, and `GetMetaItemResponseSchema` declared only the
  three, so `.parse()` silently stripped every one of them. `lock` is the READ
  half of the ADR-0008 optimistic-concurrency chain whose write half `#5745`
  already declared — leaving it undeclared meant an SDK caller had to cast to read
  it, the consumer-side tolerance Prime Directive #12 rejects. All ten keys are
  declared **optional**, measured rather than assumed: the cached branch (the
  default, `enableCache: true`) rebuilds the envelope as three keys and resolves
  no lock at all, so `optional` here means "this branch did not publish it", never
  "unlocked". Zero runtime change. Whether lock presence should depend on a cache
  setting at all is the larger question #5950 raises and is deliberately left open.

  **`?layers=true` becomes `GET /meta/:type/:name/layers` (#5882).** The flag made
  one route answer two unrelated resource representations — the ordinary envelope,
  and a three-layer diagnostic projection (`code` / `overlay` / `effective`) that
  drives Studio's "code default vs override vs effective" tabs — while the route
  declared a single `responseSchema`. Anything generating a client from the route
  table wrote a parser that was simply wrong for the flagged call. Per the
  maintainer's ruling the projection gets its own path and its own
  `GetMetaItemLayeredResponseSchema`: one path, one shape. The alternative —
  teaching the route declaration to express "two shapes chosen by a query flag" —
  was rejected as a new primitive every future tool would have to understand, and
  conditional response selection is exactly where codegen and AI-written clients
  go wrong.

  The `?layers=` spelling still answers the identical body during a deprecation
  window (both entry points run one helper, so the two cannot drift), and now
  carries `Deprecation: true` plus a `Link` header naming its successor. No
  `Sunset` date: choosing the hard cut-off is a maintainer call.

  **`GET /analytics/meta` narrows to what it serves (#6442).**
  `AnalyticsMetadataResponseSchema.data` declared `{ cubes: CubeSchema[] }` while
  both implementations of `AnalyticsService.getMeta` return a bare `CubeMeta[]`
  that the runtime hands to `success()` verbatim. A client written against the
  published contract read `data.cubes` and got `undefined`; validating a live
  response against the schema failed outright. Per the maintainer's ruling the
  declaration narrows to the `CubeMeta[]` projection — zero runtime change — and
  the generated `references/api/analytics.mdx`, which was publishing the wrong
  shape, corrects itself. If a dashboard ever needs `format` or `description`, the
  recorded return path is to add the key to the `CubeMeta` projection (additive);
  widening the endpoint back to full cube definitions would push each cube's `sql`
  to clients and is not revisited.

- 3da3da5: feat(metadata-protocol)!: cross-tenant uninstall must be declared — `deletePackage` refuses a call that names neither an organization nor `allTenants` (#7780)

  **This changes the contract of a destructive operation, and a caller that omits
  the organization today starts getting a 400. That is the point of the change,
  not a side effect of it.**

  `protocol.deletePackage` selected its rows with `{ package_id }` and added an
  organization predicate only when the caller supplied one. With no
  `organizationId` the predicate matched **every organization's rows** — measured
  during #7705 at 5 of 5 deleted, including a foreign organization's.

  Nobody chose that. It fell out of a missing argument, and the two doors of
  `DELETE /api/v1/packages/:id` disagreed about which semantic they were invoking:

  - the direct-mount REST registrar (`packages/rest/src/package-routes.ts`) passes
    no organization and got the cross-tenant reading;
  - the dispatcher twin (`packages/runtime/src/domains/packages.ts`) resolves one
    and got the org-scoped reading.

  Worse, the two are indistinguishable at the call site. `resolveActiveOrganizationId`
  (#4127) is entirely `catch`-wrapped, so any throw on the auth seam returns
  `undefined` — an accidental org-less call and a deliberate environment-wide one
  are byte-identical, and the accident silently selected the widest possible
  reading of a destructive operation.

  Maintainer ruling (2026-08-12), quoted unchanged:

  > 跨租户卸载必须显式声明,缺省缺参永远不等于「全部租户」.

  **What changes**

  - `deletePackage` gains `allTenants?: boolean`, the explicit carrier for
    cross-tenant semantics.
  - A call with neither `organizationId` nor `allTenants: true` is refused with
    `TENANT_SCOPE_REQUIRED` (HTTP 400) and deletes nothing. An explicit
    `allTenants: false` is treated as undeclared: it is not an affirmative request
    for cross-tenant semantics, so it cannot authorise them.
  - A call supplying **both** `organizationId` and `allTenants: true` is refused
    with the same code and status. The two are contradictory, not redundant — one
    scopes to a tenant, the other clears every tenant — and both silent
    resolutions are worse than a refusal: resolving narrow-first makes
    `allTenants: true` silently inert, and resolving explicit-first ignores a named
    organization and deletes every tenant's rows, which is the original defect
    wearing a flag. Rejecting is also the only reading that stays correct when a
    request is composed from two places (a resolver supplying the org, config
    supplying the flag). The message names both offending parameters.
  - The REST direct-mount door now declares `allTenants: true`. It has no
    organization to resolve (`packages/rest` carries no org plumbing at all), so of
    the two remedies the ruling allows, only declaring the intent is available
    there. Its observable behaviour is unchanged; what changed is that the width is
    now stated at the call site instead of inferred from an absent argument.

  **What deliberately does NOT change**

  The no-organization branch is still **not** narrowed to `organization_id IS
NULL`. #7705 proved that narrowing orphans every org-scoped row — the same
  defect pointed the other way. The remedy here is explicitness, not narrowing.

  **Callers that must be updated**

  Any caller of `deletePackage` that omits `organizationId` and intends an
  environment-wide uninstall must now pass `allTenants: true`. The refusal message
  names both remedies.

  Registered on the ADR-0087 migration chain (step 17,
  `package-uninstall-explicit-all-tenants`) rather than exempted: a consumer really
  does have to act — an uninstall that succeeded yesterday now answers 400 until it
  states its tenant scope — and which scope it meant is an intent no transform can
  recover, which is the same disposition `rest-requireauth-default-flip` took for
  its own default flip.

  <!-- adr-0087: registered package-uninstall-explicit-all-tenants -->

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

- a8940e4: The ADR-0114 D3 mapper (Zod issue codes → the closed `FieldErrorCode` catalog) is now
  `zodIssuesToFields`, exported from `@objectstack/spec` (`@objectstack/spec/api`), and it is
  the ONE implementation of D3's table in the repo (#8124).

  Why: `fields[].code` is declared as a closed catalog (`FieldErrorCode`, ADR-0114 D2), but
  `@objectstack/types`' `fieldsFromZodIssues` — the helper the runtime `/analytics`,
  `/notifications` and `/automation` entry refusals emit through — passed Zod's own issue
  codes through verbatim. A refusal carrying `unrecognized_keys` / `too_small` did not parse
  against the schema the protocol declares for it, and the same wire slot spoke two
  vocabularies depending on which route served it.

  What changed on the wire (all three runtime domain routes):

  - `fields[].code` values are now catalog members: `unrecognized_keys` → `unknown_field`,
    `too_small` → `min_length`/`min_value`/`min_items` (by origin), `too_big` → the `max_*`
    mirrors, enum misses → `invalid_option`, `custom` and any unmapped Zod code →
    `invalid_value`.
  - A rejection behind a `z.union` is expanded per #5014: the union's own entry is followed
    by the branch entries that explain it, so entry count is no longer issue count.
  - Two hand-spelled `unrecognized_keys` literals (the analytics `filters` hint and the
    automation toggle unknown-key refusal) now say `unknown_field`, the catalog member.

  `@objectstack/rest` re-exports the shared implementation from `rest-server.ts` and its
  behavior is unchanged (its own mapper tests pin that); `fieldsFromZodIssues` keeps its
  signature (plus an optional trailing `input` that upgrades a missing required property from
  `invalid_type` to `required`, per the D3 table) and keeps the `'(body)'` spelling for
  root-level failures.

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

- 978fed2: fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

  `POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
  families because the route recognised their **prose**, not because the errors
  said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
  (`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
  list of message substrings behind it, since all six producers were still bare
  `throw new Error(…)`:

  ```
  /not declared in the dataset|not backed by a declared relationship|
   not supported by the v1 dataset runtime|read-scope-sql|
   not a selected dimension or measure|is not a subset of the selected dimensions/
  ```

  That made the HTTP status of six families a property of their wording.
  Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
  no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
  different family, and no test and no gate would have gone red. Prime Directive
  #12 permits an accommodation like that only while it is declared, loud, tested
  **and removable on a schedule**; #5366 delivered the first three and nothing
  carried the fourth.

  **Five producers now declare their own verdict.** A new
  `dataset-refusal.ts` in `@objectstack/service-analytics` exports
  `datasetInvalidError` — the same shape as that package's existing
  `invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
  (`INVALID_FIELD` / 400) — and five sites throw through it:

  - `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
    a dimension/measure traversing a relationship path the dataset never declared
    in `include`;
  - `dataset-executor.ts` — an `order` key that is not a selected dimension or
    measure; a `totals` grouping that is not a subset of the selected dimensions;
  - `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

  Their five entries are gone from the route's list, which is now a single
  `read-scope-sql` test.

  **`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
  read-scope lowering failures whose inputs are an admin-authored policy and a
  compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
  request is invalid") may well be the wrong verdict and choosing the right one is
  a separate judgement, still tracked by #5367. Deleting the entry before that
  judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

  **No outward behaviour change for the five.** They answered
  `400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
  message; what changed is the mechanism, from message-matching to the producer's
  own declaration. The one visible difference is for a bare `Error` that merely
  _resembles_ one of those messages: it is no longer promoted to a 400. That is the
  point — a phrase is no longer a classification.

  `DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
  ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
  constructor types it as `RegisteredErrorCode` so an unregistered code is a
  compile error rather than a body some route rejects at runtime.

  Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
  five refusals against its real producer — the refusal SET first, green before and
  after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
  drives all five end-to-end through a real `AnalyticsService` with positive
  controls on both the aggregate and raw-SQL paths; and
  `analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
  — the five messages answer 400 when enveloped and 500 when bare, so re-adding a
  regex entry turns it red.

- c36abfe: fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

  #4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
  the field, because a driver error class must never be the caller's `error.code`
  for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
  identical typo one request key over still reached the driver as a `GROUP BY`
  column:

  ```
  POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437
  POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
  → 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
  ```

  **The gate.** `ensureCube` now runs `assertDimensionFields` alongside
  `assertMeasureFields` on every path, so a dimension whose source column the
  backing object does not have is refused **before** any SQL is built, with the
  same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
  `field` / `object` / `param`, a message naming the field, the valid dimensions,
  and the object's known field list. `query`, `generateSql` and `queryDataset` are
  all covered, and a rejected query leaves nothing behind in the cube registry.
  `timeDimensions` are covered too — they resolve through the same
  `cube.dimensions` bag and produced the same 500 — with `param` reporting which
  request key carried the bad name.

  **What deliberately did not change:** grouping by a REAL field the cube never
  declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
  "does the _object_ have this field", never "did the cube declare this
  dimension". A cube whose `sql` is an expression, a dotted relation dimension,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure gate stands down.

  **The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
  5xx body and echoed the error message verbatim. Knex prefixes the offending
  statement to its message, so the caller received the generated SQL — physical
  table and column names included:

  ```
  500 {"code":"ANALYTICS_QUERY_FAILED",
       "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
  ```

  The sibling face never leaked it: `/analytics/query` exits through the
  dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
  to every >= 500 message since #3867. That same predicate now guards this route's
  500 body. Classification is untouched — the status stays 500, the code stays
  `ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
  message list are unchanged — and the full text still reaches server logs. A 500
  whose message does not look like driver output keeps its prose.

- 2f6516e: fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

  Misspell an operator in a dashboard widget's filter and analytics refuses it —
  correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
  argued for one refusal at a time: dropping a predicate the compiler cannot
  express does not narrow the query, it **widens** it to rows the author excluded,
  and a chart drawn over the whole dataset looks like a working chart.

  The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
  — read as "the platform is broken" rather than "your filter has a typo", and
  counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
  `400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
  chosen by which face happened to catch it.

  **One defect, two halves — either alone leaves it unfixed.**

  - **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
    `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
    `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
    becomes the module's only way to refuse.
  - **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
    discarded `error.code` / `error.status` and re-derived the classification from
    a hardcoded list of message substrings — so a producer that took ADR-0112
    seriously was punished for it. It now reads the envelope **first**; the
    substring list is demoted to a fallback for the families that still carry no
    envelope.

  **Observable behaviour change — read this if you alert or retry on status.**
  The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
  `400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
  already declared an envelope this route was discarding, `400 INVALID_FIELD` for
  a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
  unregistered cube). Monitoring that counted these as server faults will see the
  5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
  retrying a request that could only ever fail the same way. Both are the intended
  correction — the condition was always the caller's mistake — but they are
  visible, so they are stated rather than buried.

  **Which inputs are refused did not change.** This changes the SHAPE of the
  error and nothing about the judgement that produced it: no refusal condition
  was touched, no input that used to compile now refuses, and no input that used
  to refuse now compiles. That claim is pinned input-by-input (refusals _and_
  accepted inputs with their compiled trees) in
  `filter-refusal-envelope.test.ts`, which is green both before and after the
  change — only the envelope assertions move.

  The message-substring list survives on purpose. All six of its entries were
  re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
  `dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
  families from `400 DATASET_INVALID` to 500. It is a placeholder for their
  enveloping, not a second classification mechanism, and it is now documented as
  such: a new refusal should carry a `code`/`status` and be served by the
  envelope branch for free. The passthrough is deliberately **4xx-only** and
  requires **both** `code` and `status`, so an internal fault can never be
  re-labelled as the caller's fault, and this route never invents a code a
  producer failed to supply.

- 64cd010: fix(runtime,types)!: `/analytics/query` no longer echoes RLS policy field names — the declared-server-fault withhold is shared by both HTTP boundaries (#5811)

  **Observable behaviour change — read this if you read, log, or assert on
  `error.message` from a dispatcher-plugin route.** An error that **declares a
  server fault** in the ADR-0112 envelope (`status >= 500` _and_ a non-empty
  `code`) now leaves `dispatcher-plugin.errorResponseBase` with its message
  replaced by `"Internal server error"`. It previously reached the caller verbatim
  unless it happened to _sound_ like a SQL/driver dump. This applies to every route
  that plugin mounts — `/analytics`, `/packages`, `/i18n`, `/automation`, `/auth`,
  `/notifications`, `/mcp`, … — not only the one that motivated it. Nothing a
  machine reads changed: the producer's `code` still arrives in the response
  (`error.code`, promoted there from `details` by the shared envelope builder,
  #3842), the status is untouched, and the full original text still goes to the
  server log and `errorReporter` via `__obsRecordedError`.

  ## What was wrong

  #5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
  RLS lowering refusals `READ_SCOPE_COMPILE_FAILED` / 500 and taught
  `POST /analytics/dataset/query` to withhold their message, because those messages
  name the field names and comparands of an **administrator's** sharing rule:

  ```
  [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
  build read scope (fail-closed).
  ```

  The caller never wrote that field name and must not be able to read it out of an
  error body. But the **sibling** analytics face was never closed.
  `compileScopedFilterToSql` runs on both `NativeSQLStrategy.applyReadScope` and
  `ObjectQLStrategy`'s echoed SQL, both of which serve `POST /analytics/query`,
  which exits through `dispatcher-plugin.errorResponseBase`. That exit's only
  message guard was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver
  _phrasing_ — and all eleven read-scope message shapes return `false` from it.
  Measured at that boundary: **11 of 11 echoed verbatim**, at 500, with the policy
  content in `error.message`. A real reachable disclosure, not a theoretical one.

  ## What changed

  - **`@objectstack/types` gains `declaresServerFault(err)`**, exported from
    `error-leak.ts` beside `looksLikeInternalErrorLeak`. The heuristic asks whether
    a message _sounds_ internal; the declaration asks whether the producer _said
    so_. `error-leak.ts`'s own file header already states the principle — "do not
    ship driver internals to clients" is a property of the HTTP boundary, not of
    one router — and this is the second predicate that principle asks for.
  - **Both boundaries read it.** `dispatcher-plugin.errorResponseBase` gains the
    withhold (the fix); `rest-server.ts`'s `/analytics/dataset/query` catch drops
    its in-line copy of the same test in favour of the shared one. #5808 wrote that
    rule in-line on purpose — promoting a rule with one consumer is a speculative
    surface — and this is the second consumer, so it was promoted rather than
    duplicated (`#3843`/`#3867` paid for the two-implementations shape twice).
    The REST face's verdict is unchanged in every case: same `status >= 500` plus
    non-empty `code` test, over the same two fields.

  ## What deliberately did NOT change

  - ⛔ **This is not "withhold every 5xx".** #5667 kept **undeclared** 5xx errors
    legible on purpose: a bare `Error` from our own code ("no strategy can handle
    query …") is the operator's own bug report, names nothing tenant-sensitive, and
    still falls to `looksLikeInternalErrorLeak` alone. A 5xx carrying only half an
    envelope (a status with no code) is likewise still readable — inventing the
    withhold for it would be the consumer-side leniency Prime Directive #12 removes.
  - **4xx is untouched.** `declaresServerFault` requires `status >= 500`, so a
    deliberate business/validation answer can never be swallowed by it.
  - **`statusCode` is not accepted as a substitute for `status`.** `status` is the
    channel ADR-0112 declares; making a disclosure rule depend on which spelling a
    producer reached for would be the same leniency in a different place.
  - **The heuristic was not taught to recognise `[read-scope-sql]`.** That would be
    more prose sniffing — the mechanism #5352/#5367 exist to remove — and would only
    ever cover the family someone remembered to add.

  Coverage: `analytics-query-read-scope-withhold.test.ts` (runtime) drives six RLS
  policy shapes end-to-end through a **real** `AnalyticsService` on the real
  native-SQL path and the real mounted route, asserting the 500, that the whole
  serialized body contains no policy detail, that `error.code` still carries
  `READ_SCOPE_COMPILE_FAILED`, and that the full text is still on the
  `__obsRecordedError` side-channel — plus a positive control and both sides of the
  declared-vs-undeclared tiering. `error-leak.test.ts` (types) pins the predicate
  directly, including that all eleven read-scope shapes stay invisible to the
  heuristic. The REST face's existing `analytics-read-scope-refusal-envelope.test.ts`
  is green before and after, unchanged, which is the pin on the refactor.

- fb3d99b: fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
  lower used to answer `400 DATASET_INVALID` with the refusal message echoed
  verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
  (`"Internal server error"`); the full text goes to the server log. Monitoring that
  counted these as client errors will see a 4xx disappear and a 5xx appear, and a
  client retrying on 5xx will now retry a request that cannot succeed until an
  administrator fixes the policy. Both follow from the correction below and are
  stated rather than buried.

  ## What was wrong

  These ten fail-closed refusals were the last family `/analytics/dataset/query`
  classified by **prose** — the final entry of the hardcoded message-substring list
  #5352 introduced, which #5367's first PR had already shrunk from six entries to
  one. Two defects in one verdict:

  - **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
    `FilterCondition` the security service compiled from an **administrator's**
    sharing rule / permission set, and a join alias the **dataset compiler**
    generated. Neither is caller input — the caller's own predicate goes through
    `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
    what can arrive here is a broken policy, or drift between two of our own
    components (#5557's `$regex` was literally the second case). For this request's
    caller both are a **server** fault; `400` told them to fix a request that was
    never wrong and kept the real fault out of 5xx alerting.
  - **Disclosure.** A 400 echoed the message, so
    `unsafe field identifier "secret_policy_field"` and
    `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
    and comparands of the RLS policy governing them.

  The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
  was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
  path, a 4xx misreports a condition the client cannot fix, and 422 would have left
  the disclosure question to be re-decided message by message).

  ## What changed

  - `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
    `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
    module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
    `:104`'s alias-vs-field split (option C on the card) collapses under B: both
    branches answer the same verdict, pinned so the collapse is a recorded decision.
  - `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
    fully retired** — nothing in this catch reads prose any more, and #5367's
    Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
    on a schedule") is paid off.
  - The route's 5xx branch now withholds the message of any producer that
    **declares** a server fault (`status >= 500` with a `code`). This was needed
    rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
    over SQL/driver _phrasing_, and measured, every read-scope message returns
    `false` from it — so retiring the list alone would have moved the policy content
    from a 400 body into a 500 body instead of out of the response. Teaching that
    heuristic to recognise `[read-scope-sql]` would have been _more_ message
    sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
    errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
    query …") stays readable.
  - `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-analytics` (ADR-0112 D3) and typed as
    `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
    error. It is legible on the wire through the sibling `/analytics/query` exit,
    which puts a thrown `err.code` at **`error.code`** (#3842) — read it there.
    `errorResponseBase` only stages the code inside a `details` object;
    `buildApiError` then runs `splitSemanticCode`, which promotes it into the
    declared `error.code` field and drops the now-empty `details`, so the key is
    omitted from the body and `error.details.code` is never present:
    `{"success":false,"error":{"code":"READ_SCOPE_COMPILE_FAILED","message":"Internal server error","httpStatus":500}}`.

  **Which inputs are refused did not change.** No refusal condition moved: nothing
  that used to lower now throws, and nothing that used to throw now lowers. That is
  pinned input-by-input — refusals _and_ accepted read scopes with their compiled
  SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
  before and after; only the envelope assertions move.

  Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
  sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
  (rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
  asserting the 500, that the body contains no policy detail, and that the withheld
  text is present in the log — plus a positive control and both sides of the
  declared-vs-undeclared withhold.

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

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

- 59768f7: fix(rest): `GET /approvals/requests` refuses an unknown query parameter instead of returning every request (#7527)

  `GET /api/v1/approvals/requests?assignedToMe=true` answered **200 with every
  request the caller could see**. The handler read the keys it knew off the query
  string and ignored the rest, so a caller who believed they had asked for "the
  requests assigned to me" was handed the **unfiltered** list — and could not
  tell, because an unfiltered result is shaped exactly like a genuinely broad
  match. No status, header or field distinguished "your filter matched
  everything" from "your filter was thrown away".

  That is the anti-pattern #7463's defect 2 names, pointed the other way: there an
  unrecognised key silently NARROWS to zero, here an unrecognised parameter
  silently WIDENS to everything. Both are the server accepting a request it does
  not understand and answering with something plausible.

  **The route now declares a closed parameter set** and refuses anything outside
  it with a located `400` — the ADR-0112 nested envelope
  (`{ error: { code: 'VALIDATION_ERROR', message } }`), the same position and code
  the repeated-parameter refusal on this same handler already answers with. The
  message names the parameters that were not understood and lists every one that
  is supported, so a caller can fix the request from the response alone.

  The closed set was measured from the handler's own reads, not from the filter
  list: the five filters (`object`, `recordId`, `status`, `approverId`,
  `submitterId`), the free-text `q`, the paging pair (`limit`, `offset`), and the
  `snake_case` alias spellings the handler honours. Paging is inside the set on
  purpose — a whitelist built from the filters alone would have traded a silent
  widening bug for a loud paging outage.

  **`assignedToMe` is refused, not implemented.** The capability it reaches for
  already exists and is already reachable: the Console asks exactly this question
  as `approverId=<id>,role:user`, which the `approverId` multi-identity arm was
  built for. A second spelling for a question that already has one is surface with
  no pull behind it, and it would have to be carried forever; refusing costs one
  error path and makes every future typo self-reporting.

  **If you were sending `assignedToMe`** — nothing was ever honouring it, so no
  filtering behaviour changes; the request that used to return everything now
  returns a `400` telling you to use `approverId`. Every parameter the endpoint
  actually reads is unaffected, including the unparameterised call that returns
  the full list.

- 8d895ff: feat(spec,objectql,rest): publish the audit-provenance and import-coercion vocabularies (#3786, #4173)

  Two more hand-copied lists retired the same way, each replaced by one spec
  export and derivation at every consumer.

  **`AUDIT_PROVENANCE_FIELDS`** (`@objectstack/spec/data`, with the
  `AuditProvenanceField` type) — the four columns `applySystemFields` injects on
  every audit-tracked object: `created_at`, `created_by`, `updated_at`,
  `updated_by`. That four-name list existed in at least four copies across two
  repos: the registry's injection if-chain, the rule-validator's `preserveAudit`
  allowlist ("Kept in sync with the registry's auto-injected audit fields" — by
  nothing), and two objectui render surfaces. Now:

  - the registry's injection is table-driven, keyed by the tuple with a
    `satisfies Record<AuditProvenanceField, …>` clause — a name added to the spec
    without a column definition (or vice versa) is a compile error, the
    `APPROVER_VALUE_BINDINGS` discipline;
  - the rule-validator's `AUDIT_TIMELINE_FIELDS` derives from the same tuple;
  - `FIELD_GROUP_SYSTEM_FIELDS`' audit prefix derives from it too — one
    declaration even inside the file that hosts both;
  - objectui's `AUDIT_FIELD_BY_ROLE` already pins itself by subset assertion and
    can import the tuple directly once this release is published.

  Injection behaviour is byte-identical — a conformance test pins every injected
  column's shape against the pre-refactor definitions.

  **`IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS` /
  `IMPORT_REFERENCE_TYPES`** (`@objectstack/spec/data`) — the `/import` coercion
  vocabulary #4173 asked for. The server's `import-coerce.ts` now derives its
  `BOOL_TRUE` / `BOOL_FALSE` / `REFERENCE_TYPES` from these instead of owning
  them privately, and objectui's Import Wizard preview — which re-checks the same
  contract client-side so a cell is flagged red exactly when the server would
  reject it — can retire its pinned-inventory mirror once this release is
  published (the retirement path is written in that file's own header).
  `IMPORT_REFERENCE_TYPES` ships with the legacy `'reference'` spelling included,
  retiring the `+ 'reference'` literal both ends carried separately. The tables'
  own discipline is tested: sets disjoint, every token pre-normalized
  (lower-case, trimmed), and the Chinese / check-mark spreadsheet-reality tokens
  pinned by name.

  No behaviour change anywhere: every derived value is byte-identical to the
  literal it replaces.

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

- fae74b5: fix(rest): give the bare 501 error exits a machine `code` (#4067)

  Most REST error exits already carry a typed `code` (`VALIDATION_FAILED`,
  `BATCH_NOT_ATOMIC`, `BATCH_TOO_LARGE`, `PERMISSION_DENIED`), and the clone /
  search 501s already answer `{ error, code: 'NOT_IMPLEMENTED' }`. Four 501 exits
  still returned a bare `{ error: '<string>' }` with no code, so a client could
  only key on the prose:

  - the cross-object transactional batch route (`POST {basePath}/batch`) when the
    runtime has no `transaction()` — the last untyped exit on that route, whose
    siblings (`BATCH_NOT_ATOMIC`, `VALIDATION_FAILED`, the `enforceBatchSize`
    `BATCH_TOO_LARGE`) were already typed by the #3897 / #3933 / #3939 line;
  - the two `saveMetaItem`-unsupported exits;
  - the UI-view-resolution-unsupported exit.

  Each now carries `code: 'NOT_IMPLEMENTED'`, matching the clone / search 501s.
  Additive only — the `error` message is unchanged and no status changes — so
  existing clients are unaffected; new ones can branch on the code.

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- de6b7f1: fix(rest): dashboard 组件门禁在默认配置下真正执行 (#5881)

  ADR-0057 D10 的 `requiresService` 组件门禁 —— 剔除指向未注册可选服务的 dashboard
  磁贴 —— 在默认部署里一次都没跑过。`GET /meta/:type/:name` 的单条读取有一条缓存分支,
  它排除了 `app`(per-user RBAC 过滤)与 `doc` / `book`(per-caller audience),唯独没有
  排除 `dashboard`;而 `enableCache` 默认为 `true`。门禁写在非缓存分支里,于是只有显式
  关掉缓存的部署才会执行到它。

  后果正是该 ADR 点名要防的那一幕:在没有某个可选服务的部署里(比如单租户运行时里的
  Organizations KPI,其 `org-scoping` 服务不存在),console 会渲染一块绑定到缺失服务的
  死磁贴 —— 尽管服务端的门禁代码在、测试也在。

  **修复**:`dashboard` 与 `app` 同款,从缓存分支排除,两种拼写(`/meta/dashboard/x`
  与规范复数 `/meta/dashboards/x`)都覆盖。其它元数据类型的 ETag 快路径不受影响。

  **为什么不是"把门禁提到分支之外、两条路径共用"** —— 那读起来更整齐,但 ETag 无法承载
  门禁结论:validator 是**未过滤文档**的哈希,而 `notModified` 在 protocol 内部就已判定,
  REST 层没有机会重判。共用之后送出的就是"过滤过的正文 + 指向未过滤正文的 validator"。
  一次 boot 之内这没有危害(已注册服务集在 bootstrap 之后不可变),但 `Cache-Control:
private, no-cache` 意味着客户端**存下正文**、之后只做重验证,而存下的正文比进程活得久:
  一次关掉该可选服务的重新部署并不改变文档,ETag 不变 ⇒ 每次重验证都回 304 ⇒ 那块死磁贴
  恰好在移除其服务的那次部署之后被永久缓存下来。放弃快路径的代价则接近于零:
  `getMetaItemCached` 本就委托给 `getMetaItem`,服务端两条路做的是同样的工作,失去的只是
  304 省下的正文字节。

  对调用方的可见变化:dashboard 的单条读取不再返回 ETag / 304,每次都是完整的 200。

- 0a515c8: docs(rest): record the #8039 ruling on `GET /data/:object/:id`'s query-parameter set —
  `fields` / `populate` are refused BY DESIGN, not an open question (#8039)

  Documentation only — `refuseUnknownQueryParams` already rejects any input the same way
  it did before this change.

  The route accepts exactly `select` / `expand`. It never folds the spec's alias table
  (`RPC_QUERY_ALIAS_SLOTS`, which maps `fields` → alias `select` and `expand` → alias
  `populate`), so the canonical `fields` spelling and the `populate` alias are outside the
  accepted set and refused with a located `400 VALIDATION_ERROR` naming `select` / `expand`
  as what the route accepts — never silently dropped.

  That gap used to be recorded as an open question ("tracked as #8039 … rather than widened
  here"). It is now settled: maintainer ruling, 2026-08-12, took **option 2** — keep the
  narrow set, refuse the alias-table spellings loudly. **Option 1 (folding
  `RPC_QUERY_ALIAS_SLOTS` onto this one route, so `fields` / `populate` start working here
  too) was explicitly rejected** — it would be surface expansion on a public route with no
  measured pull behind it, and doing it for this route alone would leave every other data
  route's ingress inconsistent in the opposite direction. If the alias table is ever
  declared universal across data routes, that lands as one card applying the fold to ALL
  data routes at once, with its own ruling — never a quiet per-route widening.

  For anyone integrating against this route: `?fields=…` and `?populate=…` are not aliases
  here and will not become one without a separate, wider decision. Use `select` / `expand`.

- be25f97: fix(rest): dataset queries stop rejecting their own read-time annotation

  Every widget on every dataset-bound dashboard failed with

  ```
  Dataset query failed: 400 Bad Request — Invalid dataset definition.
  ```

  The dataset itself was fine. `POST /analytics/dataset/query` resolves a saved
  `datasetName` through `getMetaItems`, and the metadata READ path stamps the
  spec-validation verdict `_diagnostics` onto every document it serves. Since
  #4001 closed the metadata schemas, `DatasetSchema.parse()` rejects unrecognized
  keys instead of dropping them — so the route handed a served document back to
  the very schema that produced it and got `unrecognized_keys: ["_diagnostics"]`
  for its trouble. The 400 blamed the author for a key the server had just added.

  This is the failure mode `stripReadDecorations` exists to prevent, and the one
  `spec/kernel/metadata-read-decorations.ts` already documents from the cold-boot
  flow bind (cloud#971): _a served body is not a valid input to the schema that
  produced it._ The route now strips read decorations before validating.

  Stripped on **both** branches, not only the `datasetName` read: the Studio
  dataset preview posts its draft inline, and that draft is the document the
  designer GET-loaded — decorations and all. A hand-authored draft never carries
  these keys, so the strip is a no-op there. The ADR-0010 provenance envelope
  (`_packageId`, `_provenance`, `_lock`, …) is deliberately _not_ a read
  decoration and still survives the round-trip.

  Regression coverage for the saved-dataset path was the gap that let this ship —
  every existing case passed the dataset inline, so nothing exercised the read.
  The route's tests now cover resolve-by-name, the inline decorated draft, the
  404, and a genuinely malformed saved dataset (still a 400).

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

- 366105c: fix(service-datasource,rest): the last three uncovered datasource routes answer their registered refusal code (#4264)

  #4249 (fixed in #4263) gave the rest surface's two introspection routes a
  failure contract; this closes the same gap on the three sibling routes it left
  uncovered. Each had no `catch` around its service call, so a service throw was
  swallowed by the adapter and surfaced as the pre-#3675 non-envelope
  `500 { error: 'No response from handler' }` — no `success` flag, no
  `error.message`, no code to switch on, real cause lost.

  Wire-visible changes — each route now answers `400` in the declared envelope,
  under the refusal code registered (ADR-0112) for the service it dispatches to,
  with the service's own message at `error.message`:

  - `GET /api/v1/datasources` (`listDatasources` throw) →
    `400 DATASOURCE_ADMIN_ERROR` — matching its eight siblings in
    `service-datasource/admin-routes.ts`, which already answer their catches this
    way.
  - `POST /api/v1/datasources/:name/external/refresh-catalog` (`refreshCatalog`
    throw) and `POST /api/v1/datasources/:name/external/validate` (`validateAll`
    throw) → `400 EXTERNAL_DATASOURCE_ERROR` — the same code #4249 gave the two
    introspection routes one block above them.

  The issue left the code choice open (`INTERNAL_ERROR` was the alternative);
  the registered per-service codes win on consistency: every other catch in both
  modules — including pure reads — already answers 400 with the service-attributed
  code, and `refreshCatalog`'s dominant throw class (unknown datasource,
  unreachable remote, no such schema) is the one #4249 already adjudicated as a
  400 refusal on `listRemoteTables`. A 500 here would fork the failure contract
  within a module — the drift #4249 removed.

  No new codes: both were registered in the error-code ledger by #4263. The
  envelope-conformance suites and the `REFUSALS` pin table gain one row per
  route.

- c001422: feat(spec): declare `routes.mcp` on `ApiRoutesSchema`, and extend the discovery conformance gate one level down (#5679)

  `/discovery` advertises `routes.mcp`, `objectui` reads it, and
  `ApiRoutesSchema` never declared it. This is #4828's defect one level down —
  with the opposite disposition: `endpoints` was retired because a census found
  no reader, while `mcp` has two real ones (`ConnectAgentWidget.tsx` and
  `AgentConnectSection.tsx` both gate the Integrations connect card on it), and
  it is in fact the only `routes.*` key anything in `objectui` reads. So it is
  declared, not removed.

  Why it was a defect and not tidiness: `ApiRoutesSchema` is a plain `z.object`,
  which **strips** unknown keys. Any consumer parsing `/discovery` through the
  spec dropped `routes.mcp` silently — the connect card would blank with no
  error. Nothing broke yet only because those two readers happen to read raw
  JSON.

  - **`ApiRoutesSchema` declares `mcp: z.string().optional()`**, as measured off
    both producers rather than guessed: a path string (`/api/v1/mcp`), always the
    **unscoped** base — `/mcp` is mounted bare, so a scoped mount advertising
    `/api/v1/environments/env_alpha/data` still advertises `/api/v1/mcp` — and
    `optional`, not `nullable`: the key is absent (rest-server `delete`s it, the
    dispatcher leaves it `undefined`) when MCP is disabled or unserveable.
    Neither producer ever emits `null`.
  - **`@objectstack/rest` drops the two `as any` casts** at the emit site. That is
    type-only — the emitted body is byte-identical — but the cast's disappearance
    is the structural proof: with the key undeclared, removing it produced two
    `TS2339 Property 'mcp' does not exist`; with it declared, `tsc --noEmit`
    returns to its ratcheted baseline.
  - **The #4828 conformance gates now cover `routes` keys**, not just top-level
    ones, in all three producer packages, deriving the allowance from
    `ApiRoutesSchema` the same way the top-level check derives it from the
    protocol schema. Extended one level, not recursed — full recursion stays out
    of scope, and `capabilities` / `services` are `z.record`s whose keys are open
    by design.

  - **`@objectstack/client`'s conventional route table gains an `mcp` row.** That
    table is `Record<keyof ApiRoutes, string>` — total by design — so a newly
    declared route owes a convention, and the public `ApiRouteType` (`keyof
ApiRoutes`) widens by one member. The path is `/api/v1/mcp`, which is what
    both producers emit, so the fallback agrees with the discovered value instead
    of competing with it. Resolution behaviour is unchanged: `getRoute()` still
    prefers the discovered route, and the pre-existing catch-all already produced
    the same string.

  Corrects one detail of the issue's premise: the runtime dispatcher's
  `getDiscoveryInfo()` **does** also emit `routes.mcp` (its routes literal always
  carries the key, holding the path or `undefined`), so both producers were
  affected, not just REST — and the new gate went red on both before the fix.

- 76682cb: fix(meta): gate `GET /meta/_drafts` and `GET /metadata/_drafts` as authoring surfaces (ADR-0106 D5(4), #6599)

  The two `_drafts` outlets were the one schema-serving endpoint the ADR-0106
  implementation-time sweep (#3682) left uncovered. Both called
  `protocol.listDrafts()` and returned the result verbatim, so an authenticated
  caller with no read access to a field still learned that a **pending object
  draft** carried it — the field's label, type, picklist options, formula and
  `requiredPermissions` — exactly the disclosure ADR-0106 closes on every other
  `/meta` outlet.

  Per the #6599 ruling, `_drafts` is treated as an **authoring surface** rather
  than a general read (its only consumers are the console's pending-changes and
  Studio/Setup design surfaces). It now gates per caller on the SAME `systemPermissions`
  judgement ADR-0106 D4 uses for its mask exemption (`isObjectSchemaMaskExempt`:
  `studio.access` / `setup.access` / `manage_metadata`, or `isSystem`) and answers
  **403** to everyone else — rather than projecting the draft field-by-field. The
  gate runs before the protocol is resolved, so the 501-vs-200 answer cannot be
  used to probe kernel support, and it is independent of the D8 per-field-mask
  escape hatch. Authors' access is unchanged; non-authors, who have no pending
  drafts to publish, receive a refusal instead of the disclosure.

  The refusal envelope follows each transport's existing precedent: REST answers
  `FORBIDDEN`, the runtime dispatcher answers `PERMISSION_DENIED` (derived from the
  403 status). Both faces are pinned in the shared ADR-0106 case table
  (`meta-object-fls.test.ts` in `@objectstack/rest` and `@objectstack/runtime`),
  driven by the same case list so the two transports cannot diverge silently.

- d9bef45: fix(spec,rest): `OVERLAY_PERSISTENCE_FAILED` leaves the error-code ledger — it lost its only producer (#5783)

  `ERROR_CODE_LEDGER` registered `OVERLAY_PERSISTENCE_FAILED` under
  `@objectstack/metadata-protocol`, but nothing in the repository can emit it any
  more. Its one emission point was the `catch` inside `saveMetaItem`'s legacy
  raw-engine branch, and #5264 (PR #5782) deleted that branch. A registered code
  with no producer is ADR-0112's "no silent fourth state" read backwards: the
  vocabulary promises a client a code no response can carry, and the ledger's own
  admission test cannot notice, because it checks casing, duplication and
  shadowing — never whether anyone still throws the code.

  Verified before removing: a declaration-and-emission search over `origin/main`
  finds the name only in the ledger row itself, two generated reference pages, one
  `rest-server.ts` comment, one historical changeset plus its CHANGELOG entry, and
  two `packages/rest` tests that construct the error themselves. No producer, and
  no consumer — including `objectui` and `cloud`, both searched at their
  `origin/main` — reads the literal. Removal only shrinks a dead row: nothing
  gates an emission on ledger membership, so no runtime or gate starts rejecting
  anything it accepted before.

  **Wire impact: none.** No response carried this code, so no client can lose one.
  The narrowing is type-level: `ErrorCode` (`StandardErrorCode` ∪ the ledger, what
  `ApiErrorSchema.code` validates) no longer admits the string, so TypeScript
  would now reject `code: 'OVERLAY_PERSISTENCE_FAILED'` at a call site — and there
  is no such call site left to reject.

  Note for whoever compiles the release: #5437's changeset
  (`rest-5xx-message-withheld.md`) names this code as one of two examples of a
  `code` that "still rides on the response". That sentence was accurate when it
  was written; the other example, `NOT_IMPLEMENTED`, is unaffected and still
  demonstrates the same behaviour.

  The two `packages/rest` tests that asserted `resolveErrorResponse`'s handling of
  a declared 5xx keep their substance and switch to a producer that still exists —
  `metadata-protocol`'s `batchData` atomic refusal (`501` / `NOT_IMPLEMENTED`) and
  the surviving overlay-delete `500`. Three stale comments are corrected in the
  same pass: the `agent` entry in `metadata-plugin.zod.ts` (which described a
  routing mechanism replaced by #5086's 403 refusal), the reachability argument in
  `rest-5xx-message-sanitization.test.ts`, and `resolveErrorResponse`'s own
  docblock in `rest-server.ts`.

- 82da264: feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

  The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
  the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
  assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
  and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
  closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
  so a field that exists only inside an `as any` is **outside every closure gate by
  construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
  `ExecutionContextEntryFields` could not demand it, and the runtime pin that
  reconciles the closed set against `ExecutionContextSchema.shape` could not see
  it. It was the exact blind spot that gate exists to remove, sitting one `as any`
  outside it.

  **@objectstack/spec** declares the field:

  ```ts
  authGate: z.object({ code: z.string(), message: z.string() }).optional();
  ```

  Both inner keys are required, matching the sole producer
  (`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
  is the stable machine code a client branches on, `message` is what the blocked
  user reads, and the transport seam renders both as the `403` body.

  **@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
  the request's own session at the transport entry point, never written mid-request
  — so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
  same footing as `accessToken`: every face states its decision instead of omitting
  it. A guest principal never carries one (no authenticated session for a policy
  gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
  user's loose `authGate` into the declared shape at the one producer rather than
  tolerating a partial shape downstream — a gate naming a `code` but no `message`
  no longer renders a `403` body with `message: undefined`. `AuthGate` is now
  derived from the schema instead of being a second hand-written declaration.

  **@objectstack/rest** passes the resolved gate as an assembler input and drops the
  post-assembly spread; the remaining `as any` covers `__kernel` alone.
  **@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
  (`HttpDispatcher.enforceAuthGate` re-reads the session and calls
  `evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
  would be a second copy no consumer reads.

  **No runtime behaviour change on either surface.** The shared assembler omits
  `undefined`-valued keys, so the key is present exactly when it was before. The one
  new behaviour is the normalization above, on a shape the sole producer never
  emits today.

- f586f1a: refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

  `resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
  step after it — turning the resolved envelope into the `ExecutionContext` that
  reaches enforcement — was still one hand-written copy per transport, and the
  copies drifted twice for real: **#6071** (the REST copy never set
  `principalKind`, so every enforcement judgment reading it was silently
  never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
  produced real 403s on the share-link faces).

  **@objectstack/core** gains the single assembly, with the anonymous divergence
  as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
  A):

  - `assembleExecutionContext(input)` — the **fail-closed default** entry. No
    resolved principal → `undefined`, and the surface answers 401.
  - `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
    resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
    `positions: ['guest']`), whose consumers are live (`explain-engine`'s
    guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
    semantics serve anonymous principals.
  - The field set is **closed by type**: `ExecutionContextEntryFields` requires a
    decision for every `ExecutionContext` field that is not explicitly declared
    non-entry-resolved, so a new field cannot reach one transport and miss
    another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
    `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
    `OAuthTokenProvenance`, `EntryLocalization`.

  **@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
  dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
  that module — the dispatcher via the guest entry, REST via the fail-closed
  default.

  **No runtime behaviour change on either surface.** The remaining per-face
  divergences are required inputs rather than silent omissions: REST passes
  `accessToken: undefined` (it has never carried the session bearer on the
  envelope, and `session.accessToken` is a published hook surface) and
  `oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
  one measurable difference is that a key whose value was `undefined` is now
  omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
  and to spreading the envelope.

- d2d6e4c: fix(rest): exported `datetime` cells render in the business timezone, not UTC (#8373)

  `GET /api/v1/data/{object}/export` formatted every `datetime` column with
  `getUTC*`, while the UI rendered the same field in the business timezone. The
  whole file was therefore off by the tenant's offset, on **every** export format
  — and the harm was not "a few hours out". A record the screen showed at
  `2026/8/1 06:00` (+08) landed in the file as `2026-07-31 22:00:00`: the row left
  August. A downstream deployment's monthly reconciliation stopped balancing on
  exactly that, and because `getUTC*` ignores the process `TZ`, no deployment-side
  setting could work around it.

  The timezone was already resolved on this path and simply never threaded. The
  export route opens with `resolveExecCtx`, whose `ExecutionContext` carries
  `timezone` from the platform-default → global → tenant localization cascade; the
  formatting layer just never asked for it. It now does, reading the calendar
  components through `Intl.DateTimeFormat(…, { timeZone })` so DST comes from the
  platform tz database rather than hand-rolled offset arithmetic. This brings the
  export formatter into line with the ADR-0053 business-timezone semantics that
  autonumber date tokens already follow.

  Fixed on all three output formats — CSV, XLSX and JSON — which share one
  formatter; the reported symptom reproduced on CSV and XLSX alike.

  **Nothing changes without a resolved timezone.** No `timezone` on the context (or
  one this platform does not recognise) keeps the previous UTC rendering, byte for
  byte, so a deployment that never configured one sees the same files as before.

  **`date` columns are deliberately untouched.** Under ADR-0053 a `date` is a
  timezone-naive calendar day — `@objectstack/driver-sql`'s `toDateOnly` is the
  source of truth and the filter, write and read paths all agree with it.
  Projecting a date-only value through a zone would move `2026-08-01` to
  `2026-07-31` for every deployment west of UTC, inventing the off-by-one-day
  defect that ADR decision exists to remove. Only `datetime`, which ADR-0053
  defines as an instant rendered in a reference timezone, follows the business
  zone.

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

- f0d6594: fix(rest): `GET /data/:object/export` honours a `search` term

  The streaming export route accepted `filter` and `orderby` but had no way to
  carry the term a user had typed into the list's search box. So exporting after
  a search downloaded the **unsearched superset** — more rows than the screen
  showed, in a file that looks authoritative, with nothing indicating the
  difference. The route's own comment claimed the opposite: that it "mirrors the
  active view's filter + sort so the exported file matches what the user sees".

  Same family as a dropped filter (objectstack#3948, objectstack#4181): a
  plausible answer that is quietly broader than the one asked for.

  Two new query params, both matching the list endpoint's semantics:

  - `search=<term>` — folded into `findData` as `$search`, so it **composes**
    with `filter` (`{ $and: [filter, search] }`) rather than replacing it. Empty
    or whitespace-only terms are ignored rather than applied as a blank predicate.
  - `searchFields=a,b` — the ADR-0061 override for which fields the term scans.
    Only meaningful alongside `search`, and intersected with the object's allowed
    searchable set by the engine, exactly as on the list endpoint.

  Unknown query params on this route were already ignored, so a client that sends
  `search` to an older server gets today's behaviour rather than an error.

  Covered by `export-integration.test.ts` against the real engine + protocol: the
  composition case is built so each half alone returns a different non-empty
  result and only "both applied" returns none. Reverting the route change fails 4
  of the tests. The file's in-memory driver also learned `$or` / `$contains` —
  without them a search predicate is a silent no-op and an "it filtered"
  assertion would pass for the wrong reason.

- bcf1112: fix(service-datasource,rest)!: external-datasource refusals answer their own error code (#4249)

  #4225 / #4234 fixed the 503 `message` on the three routes in
  `service-datasource/admin-routes.ts` that dispatch to `external-datasource`
  rather than `datasource-admin`. The identical mis-attribution survived one field
  over, on the 400 path — and machine-readably: one shared `badRequest` helper
  hard-coded `DATASOURCE_ADMIN_ERROR`, which the ADR-0112 ledger defines as a
  refusal _from the datasource-admin service_. So a `no such schema` raised by the
  external-datasource introspector was reported as datasource-admin's, and where
  #4225 misled a human reading prose, this misrouted a client switching on
  `error.code`.

  `EXTERNAL_DATASOURCE_ERROR` is now registered in the error-code ledger — under
  `@objectstack/service-datasource` and `@objectstack/rest`, the two packages that
  emit it; per the ledger's own rule the per-package rows are provenance, not
  identity — and `badRequest` takes the same `ServiceName` the route passed to
  `resolve` (#4234), so the code, like the 503 message, comes from the service the
  route actually dispatches to.

  Wire-visible changes:

  - **The three external-datasource routes' 400 `error.code`** —
    `GET /datasources/:name/remote-tables`, `POST /datasources/:name/test`,
    `POST /datasources/:name/object-draft` — is now `EXTERNAL_DATASOURCE_ERROR`
    (was `DATASOURCE_ADMIN_ERROR`). Status, envelope, and `error.message` are
    unchanged, as is everything on the six datasource-admin routes. No consumer
    branches on the old code (grepped both repos, all the ADR-0112 sweep forms).
  - **The rest surface's two introspection routes now have a failure contract at
    all.** `GET /datasources/:name/external/tables` and
    `POST /datasources/:name/external/tables/:remote/draft` carried no
    `try`/`catch`, so the very same service operations that answer 400 through
    the admin surface surfaced here as the adapter's non-envelope
    `500 { error: 'No response from handler' }`. They now answer
    `400 EXTERNAL_DATASOURCE_ERROR` in the declared envelope — one operation, one
    failure contract, on both paths. (`EXTERNAL_IMPORT_ERROR` on the import route
    is unchanged: a refused import is a different act from a failed
    introspection, and its name says so.)

  Why a new registered code rather than reusing one: ADR-0112's ledger asks
  _generic_ conditions to reuse the standard catalog — that argument carried
  #4225's 503, where `SERVICE_UNAVAILABLE` is correct for all nine routes and only
  the free-text `message` named the service. A refusal specific to one service is
  exactly what registered extension codes are for, and the closed `ErrorCode`
  union means correcting the attribution had to be a ledger edit. Widening
  `EXTERNAL_IMPORT_ERROR` to cover introspection was rejected because these are
  not imports; leaving the throws uncaught was rejected because the adapter's 500
  is not the declared envelope.

  The conformance rows that pinned the drift move with it, and each surface now
  pins the refusal code per route the way #4234 pinned the 503 message per route.

  Pre-existing, like #4225: #3843 carried every code string over verbatim.

- 284e7d2: fix(rest): a crashing hook body answers the sanitised fault envelope, not a raw `TypeError` at 400 (#7543)

  `POST /api/v1/data/showcase_task` with `{"title": 12345}` answered

  ```
  400 { "error": "TypeError: not a function", "object": "showcase_task" }
  ```

  — a JS runtime error as the client-facing message, in a body with no `code` at
  all. Two contract breaks in one response: an internal fault echoed verbatim to a
  caller, and an error body outside the ledgered envelope, so a client keying on
  `code` got nothing.

  **The seam.** `mapDataError` has two sandbox-unwrap branches, and they are the
  only ones in the file that emit `{ error, object }` with no `code` at 400. They
  exist for one shape: a hook or action body that runs
  `throw new Error('删除被阻断：仍有未结清的发票')` — an author writing a business
  rule whose message _is_ the remedy, which is answered verbatim at 400 and
  deliberately without a `code`. A body that instead **crashes** arrives as a
  thrown error too, so it took the same branch and its `TypeError` went out as if
  it were that author's message.

  **The fix.** Both branches now separate a body that _reported_ something from a
  body that _faulted_, by the thrown error's constructor name — the sandbox
  stringifies a throw as `<name>: <message>`, so a leading `TypeError:`,
  `ReferenceError:`, `RangeError:`, `SyntaxError:`, `URIError:`, `EvalError:`,
  `InternalError:` or `AggregateError:` is structural evidence of a crash rather
  than a keyword heuristic over prose. A crash answers the same sanitised
  `500 INTERNAL_ERROR` the mapper's terminal branch already gives — which is not
  new policy: that branch's own contract (#5489) names this exact case ("a plain
  handler bug (`TypeError: x is not a function`) … server faults that a caller
  cannot fix and a caller SHOULD retry"). The unwraps simply sat above it and
  intercepted the crash first.

  Both doors are guarded, not one. The `innerMessage` branch and the raw-message
  regex fallback produce byte-identical bodies, so classifying in only one would
  make the envelope depend on whether the `SandboxError` instance survived a
  rethrow.

  **Unchanged:** a deliberate refusal still reaches the caller verbatim at 400
  with no `code`. The fix changes _which_ errors take that branch, not what it
  emits. A body that expresses a business rule as `throw new RangeError('…')` is
  now sanitised — an accepted cost, since that is not the documented authoring
  style and the fail-safe direction is the one that does not ship runtime faults to
  clients. The operator still gets the full text: 500 is outside
  `isExpectedDataStatus`, so `handleRouteError` logs `[REST] Unhandled error` with
  the whole error.

  **Showcase.** `NormalizeTaskTitleHook` guarded its trim with truthiness
  (`if (ctx.input.title)`), so the number `12345` passed the guard and had no
  `.trim`. It now checks `typeof … === 'string'`. That is the actual cause of the
  reported repro, and with it fixed the request **succeeds** rather than erroring:
  `record-validator` coerces a `text` value with `String(value)`, so a number in a
  text field breaks no declared contract. These hook bodies are read as
  documentation, so the type-safe shape is the one to show — a hook must not assume
  a field's runtime type just because its metadata declares one.

- 427344c: fix(i18n): the object catalog no longer overwrites an explicitly-set `label` / `pluralLabel` / `description`

  `translateObject` resolved an object's three scalars as `catalog ?? document`. The
  i18n catalog is keyed by object name and is the packaged translation of the
  **packaged** declaration, so consulting it first discarded every value authored on
  top of that declaration: a code-shipped `objectExtensions` scalar, and — the severe
  half — a tenant's own Studio rename, which answered `200` and then appeared on
  neither `GET /meta/object` nor `GET /meta/object/:name`, i.e. neither read a
  writable form derives from.

  The catalog now applies only while the document's scalar still equals the packaged
  base value; a scalar that differs was authored by somebody, and the catalog yields
  to it. Comparison-based, per scalar, with no provenance flag carried through the
  fold: `@objectstack/metadata-protocol` exposes the packaged owner declaration
  (`getPackagedObjectBase`) and `@objectstack/rest` hands it to the translator at the
  three sites that localize an object document. A host whose protocol does not
  answer keeps the previous behaviour exactly, so nothing loses a translation it has
  today. `?layers=true` stays untranslated and diagnostic, unchanged.

- 53ef057: fix(rest,objectql): the import dry run asks the engine for its verdict instead of predicting it (#4633 ruling D)

  `POST /api/v1/data/:object/import?dryRun=true` green-lit rows the very same
  endpoint then rejected. Measured on 17.0.0-rc.1: a CSV cell aimed at a
  structured `address` field reported `{ ok: 1, created: 1 }` on the dry run and
  `{ errors: 1, code: 'VALIDATION_FAILED' }` on the real write.

  The dry run predicted the write's verdict with a hand-copied mirror of a slice
  of the engine's rules (`import-coerce.ts`'s `firstMissingRequiredField` and
  `firstConstraintViolation`). A copy cannot structurally keep up with the family
  it mirrors: ADR-0104 value shapes (`address` / `location` / references / media),
  `format` checks, object-level `validations` and the state machine had no
  counterpart, and `coerceFieldValue` routes structured shapes through its
  pass-through catch-all, so no verdict was formed at all.

  **The mirror is retired.** The dry run now calls `DataProtocol.validateData`
  (#6037), which runs the same `validateRecord` / `evaluateValidationRules` that
  `insert()` runs, under the deployment's own ADR-0104 posture — so a bad value
  shape is an error on a self-certified deployment and an admitted warning on a
  warn-first one, exactly as on the write. Agreement is by construction, not by a
  copy kept in step by hand.

  Also in this change:

  - **`engine.validate()` now resolves `defaultValue`s and seeds owned roll-up
    `summary` fields before validating, on `insert` mode**, because `insert()`
    does. Without it a required-but-defaulted column left unmapped was previewed
    `failed` and written `created` — a false alarm on the row a preview is meant
    to reassure you about. `update` mode still does not default (#2706).
  - **A row report failed by validation now names the offending column.** The
    engine's `ValidationError` carries `fields[]`, so the row's `field` is set and
    its `code` is the field-level code (`required`, `min_value`, `max_length`,
    `invalid_type`, …) rather than the wrapper's `VALIDATION_FAILED`. This is the
    same vocabulary the dry run and the per-cell coercion failures already spoke;
    before, a `min: 0` violation was `min_value` on the dry run and
    `VALIDATION_FAILED` on the write.
  - **Dry-run rows may carry `warnings[]`** — findings this deployment admits
    rather than rejects (ADR-0104 warn-first). The row is `ok`, and the complaint
    is visible instead of living only in a server log line.

  A protocol that does not implement `validateData` (plugin-auth's identity
  import, whose write is better-auth rather than the engine) is not handed a
  substitute: its dry run reports coercion and create/update/skip resolution only.
  An engine-derived preview of a non-engine write would report findings that write
  never produces.

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

- a92b179: rest 的异步导入行数上限改为直接读取 spec 的 `IMPORT_JOB_MAX_ROWS` 导出，不再自己声明一份同值字面量（#6535）。

  **行为没有任何变化**：两处此前都是 `50_000`，改后仍是 `50_000`，上限、`413` 文案、拒绝边界全部不动。
  这是一次一致性收敛，不是缺陷修复——因此按 patch 计。

  收敛掉的是一处漂移面：`packages/spec/src/api/export.zod.ts` 的那份导出带着 TSDoc，是这个
  上限的**对外说明**（喂给生成的 reference 表面）；而真正执行拒绝的是 `packages/rest`，它此前
  读的是自己那份本地 `const`，两者之间只有一句 "mirrors spec" 注释相连。没有任何 gate 比较这
  两个数——`api-surface/api.json` 只记下 `"IMPORT_JOB_MAX_ROWS (const)"` 这个**名字**，不记它的
  **值**——所以把 spec 那份改成 20_000、执行侧纹丝不动，`pnpm test` 与全部 `check:*` 依然全绿
  （本 PR 实测过）。失效方向是文档说一套、系统做一套，而 `413` 文案里内插的又是 rest 那一份，
  连报错都会自洽地说谎。现在一处定义、两处读点（`maxRows:` 与 `413` 文案）同源。

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

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- fc71b84: Package publish: a driver fault is answered as a server error, and its driver text no longer reaches the caller

  `POST /api/v1/packages/publish` answered **`400 PACKAGE_PUBLISH_FAILED`** when the
  `INSERT INTO sys_packages` statement itself failed, carrying the driver's own message as
  the caller-facing text. Measured on a real SQLite engine, that was literally:

  ```
  400 {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
       "message":"no such table: sys_packages"}}
  400 {"success":false,"error":{"code":"PACKAGE_PUBLISH_FAILED",
       "message":"NOT NULL constraint failed: sys_packages.tenant_ref"}}
  ```

  Two defects in one line. The **status** was a client error for a fault the client had no
  part in — the mirror of the mislabelling fixed for the throw path, and it hid a real
  server fault from every dashboard that buckets by status. The **message** was raw driver
  text: a constraint dump naming physical tables and columns.

  Fixed at the producer, which is the only place that closes it. A 5xx message withhold
  already exists at this door, but it is applied when an error is _thrown_, and this
  failure was _returned_ — so it never met the withhold at any status. Reclassifying alone
  would have moved the driver line from a 400 to a 500 and left it on the wire; that is
  measured, and it stays true against the widened leak predicate that now recognises this
  phrasing, because nothing on the returned path ever consults one.

  Now the driver's text goes to the log and nowhere else — it was already logged, so nothing
  an operator sees changes — and the caller gets a stable sentence that names what happened
  without quoting the driver.

  **Caller-facing 4xx messages are unchanged.** A missing manifest, an invalid manifest, and
  any coded refusal thrown from below `publish` all keep their own status, code and
  self-correcting message — a `409 DESTRUCTIVE_CHANGE` is still a 409.

  **BREAKING — the `PackageService.publish` return shape.** A bare `error` string could not
  say which side was at fault, so the door had one status for both and picked the wrong one.
  `publish` now reports a broken write as `{ success: false, driverFault: { message } }`;
  the `error` field is removed. If you only _call_ `publish`, read
  `result.driverFault?.message` where you read `result.error`. If you _implement_
  `PackageService`, report a broken write through `driverFault` with a message safe to show
  a caller, and **throw** — rather than return — a refusal that carries its own `status`, so
  the door answers it with that status and code.

  <!-- adr-0087: not-required (no-migration-prescription) This change retires no authorable key and adds none. `PackageService` is a runtime TypeScript service interface in `packages/services/service-package`; it has no Zod schema, no `packages/spec` declaration, no metadata type and no stored representation. `packages/spec` is untouched by this PR. Nothing exists for `objectstack migrate meta` to rewrite, because nothing an author writes and nothing persisted in `sys_metadata` or `sys_packages` changes shape — the wire envelope is unchanged too (still ADR-0112 `{ success, error: { code, message } }`), and only the STATUS a driver fault selects and the TEXT the producer puts in it move. Nor is there a FROM/TO rule a ledger entry could state: the ledger's subject is metadata, and the only readers affected here are TypeScript callers of one in-process service — measured as three in-repo consumers (`@objectstack/rest`, `@objectstack/runtime`, `@objectstack/cli`), of which exactly one, `packages/rest/src/package-routes.ts`, reads the changed field. The channel that reaches an affected reader is strictly more precise than any ledger line: the compiler itself. Reading the removed field is a hard type error at the call site — verified by reinstating it, which fails as `error TS2339: Property 'error' does not exist on type 'PackagePublishResult'` — so no consumer can carry this change silently, and this changeset's CHANGELOG text carries the one-line repair for the reader who hits it. -->

- 07383fe: REST: a declared 5xx status now survives on the CRUD data routes

  `mapDataError`'s explicit-status passthrough accepted only 4xx, while
  `resolveErrorResponse` (the door every metadata/UI/discovery/batch route uses)
  accepts 400-599. The same thrown error therefore got two different answers
  depending on which route caught it, and on the data routes a producer's
  declared 5xx was overwritten — the status re-derived from the message text, or
  falling through to `500 INTERNAL_ERROR`.

  The passthrough is now 400-599 on both doors, with the same disposition #5437
  already ruled for a declared server fault: **keep the status, keep the
  machine-readable `code`, drop the prose**. The `code` half reads
  `declaresServerFault` from `@objectstack/types`, so an empty or non-string code
  is not mistaken for an ADR-0112 declaration and nothing is invented when the
  producer named no code.

  User-visible effect: an aggregate function a SQL backend cannot compile
  (`count_distinct` / `array_agg` / `string_agg`) now answers
  `501 NOT_IMPLEMENTED` instead of `500 INTERNAL_ERROR`, and an upstream/
  dependency `502` / `503` reaches the caller as itself rather than as a generic 500. The 4xx half is unchanged (wording truncated, `object` retained), no 5xx
  message text reaches the client, and the withheld text still reaches the
  operator log.

- 99b4392: Advertise `mcp` in `/discovery` only when it is actually serveable (#4024).

  Both discovery producers gated the `/mcp` route on `isMcpServerEnabled()` alone.
  The stated justification was a lockstep — `os serve` auto-loads plugin-mcp from
  the same flag, so on that path advertised did imply mounted. But the lockstep is
  a property of the CLI, not of the dispatcher: `@objectstack/rest` has no
  `@objectstack/mcp` dependency, mounts no `/mcp` route and performs no auto-load,
  so a host that embedded it without plugin-mcp advertised `/mcp` in `/discovery`
  and then answered 501 on it — the `declared ≠ enforced` failure #3369 forbids,
  and a broken contract for third-party clients that read `/discovery` to decide
  what exists.

  Both producers now require the flag AND a serveable MCP service. The runtime
  dispatcher gates on the handler's own predicate (`typeof
mcp.handleHttpRequest === 'function'`), so a wrong-shaped service can't
  over-promise either. `@objectstack/rest` probes via the per-request kernel or the
  single-env `serviceExistsProvider`; when it genuinely cannot probe it keeps the
  prior flag-only answer rather than hiding a working endpoint (fail-open,
  ADR-0057 D10). The `os serve` / `os dev` path is unchanged — it loads the plugin,
  so the service resolves and `/mcp` is still advertised.

  Also exercises the `mcp: false` seam in `route-parity.integration.test.ts`, which
  had existed unused since the file was written: `bootServe()` was only ever called
  with no args or `{ notification: false }`. The one capability whose advertisement
  was not service-presence gated was also the one whose absence was never tested.

- 870f90c: REST: the `/meta` write routes' 501 refusals now speak the ADR-0112 error envelope

  `DELETE /meta/:type/:name`, `PUT /meta/:type/:name` and `PUT /meta/:type/:section/:name`
  answer 501 when the protocol implementation lacks the corresponding method. Each
  answered that refusal in a different shape: the `DELETE` sent a bare-string
  `error` with no code at all, and the two `PUT` twins sent the code as a _sibling_
  of `error` rather than inside it — while `POST /meta/_migrate-stored`, a few
  hundred lines away in the same file, already sent the ADR-0112 nested shape for
  the same condition.

  All four now answer `{ error: { code: 'NOT_IMPLEMENTED', message } }`, so
  `err.error.code` — the position ADR-0112 declares — resolves on every one of
  them. `NOT_IMPLEMENTED` is unchanged and needs no new catalog entry: it is
  already the standard catalog's member for 501.

  **Wire-visible** for a caller running a kernel that does not implement metadata
  writes. A client that read `err.code` (the sibling position) on the two `PUT`
  routes must read `err.error.code` instead; a client that read `err.error` as a
  string on the `DELETE` route must read `err.error.message`. No in-repo or
  objectui consumer read either retired position.

- 6ceffe0: `GET /api/v1/meta/app/<name>`: report a permission denial instead of absence

  An app the session lacks the `requiredPermissions` for used to answer the same
  404-equivalent as an app that does not exist, so the two were byte-identical on
  the wire. A console has nothing to branch on and renders its only copy for an
  absent app — "it may still be publishing" — over a permanent authorization
  denial.

  The by-name route now answers `403` with the ADR-0112 standard catalog code
  `PERMISSION_DENIED`, in the declared envelope
  (`{ success: false, error: { code, message } }`), when the app EXISTS and the
  session lacks its `requiredPermissions`.

  Deliberately unchanged, because the disclosure is licensed only for the case
  above:

  - a **nonexistent** app name keeps answering absence — converting it too would
    make every app name on the platform enumerable;
  - an **unpublished** app keeps answering `404` (ADR-0045 §3 makes it externally
    unobservable, and a 403 confirms existence);
  - an app withheld by an absent optional service (ADR-0057 D10) keeps answering
    `404` — nothing was denied to the caller;
  - the **list** route `GET /meta/apps` stays filtered exactly as before, with no
    `authorized: false` flag, so the enumeration surface is not widened past what a
    direct by-name probe already implies.

- 667192b: fix(rest): `GET /api/v1/meta/app?id=` narrows the app list instead of being dropped (#7566)

  `GET /api/v1/meta/app?id=…` accepted the parameter and then ignored it. The
  same apps came back for **every** value, including one that names no app at all
  — `?id=crm` and `?id=no_such_app` produced byte-identical responses. Nothing on
  `GET /meta/:type` had ever read `id`: the list route narrows by permission
  (`filterAppForUser`) and by `?package=` / `?object=` / `?include=`, and `id` was
  never among them.

  Worse than an error, because the answer looks like the one that was asked for: a
  caller cannot tell a working filter from a dropped one. A client that asks for
  one app and renders `items[0]` gets a plausible, wrong answer, and a bogus id can
  never come back empty.

  The filter is now honoured, matching on `name` — the App document's identity
  (`AppSchema.name`, "App unique machine name"), the key `GET /meta/app/:name`
  addresses and the key the metadata store merges overlays on. `AppSchema` declares
  no `id` of its own, so there is no second identity for the two to disagree about.
  Both spellings of the type segment are covered (`/meta/app` and `/meta/apps`),
  since every other per-type filter on this handler keys off `metaTypeSingular`.

  **A filter that matches nothing answers `200` with an empty list, not a `404`.**
  Measured off this route's siblings rather than chosen: `?package=<no such
package>` and `/meta/view?object=<no such object>` both serve an empty list here,
  and the only 404 on the meta surface is the single-item address `GET
/meta/:type/:name`. An empty list is already observably different from the
  defect, which answered with all of them.

  **A repeated `?id=a&id=b` is refused with `400`**, through the same
  `refuseRepeatedQueryParams` gate this route already opens with for `?package=` /
  `?preview=` / `?object=` / `?include=` (#6877) — one route, one dialect for "this
  request is malformed". Picking one of two conflicting intents is a wrong answer
  delivered as a success, and the alternative the other filters on this line were
  bitten by (`String(['crm','account'])` → the single app name `'crm,account'`)
  would just have emptied the list silently.

  **The filter narrows within what the caller may observe, never around it.** It
  runs after the ADR-0045 §3 publish gate, so `?id=<an unpublished app>` answers the
  same empty list to a non-builder as `?id=<nonexistent>` — the two are
  indistinguishable by design. It is also not part of the permission branch's
  `ctx?.userId` guard, so an anonymous read of a public deployment gets the filter
  too.

  **Nothing that worked before changes.** An absent `?id=` still returns the whole
  list, and so does the empty spelling `?id=` — the same falsy gate `?package=` on
  this route has always used, and what an unset `<select>` submits. Other metadata
  types are untouched: `?id=` on `/meta/view` and friends keeps being ignored
  exactly as before, since #7566 is filed on the app list and teaching every type an
  `id` filter in the same change would be surface expansion with nothing measured
  behind it.

- 83a3b1f: fix(rest): `GET /meta/books/:name` no longer bypasses the ADR-0046 §6.7 audience gate (#6241)

  The single-item metadata read has a cached branch and an uncached one, and the
  ADR-0046 §6.7 audience gate lives in the uncached one. The comment above the
  cached branch's entry condition has always stated why `doc` and `book` must skip
  it:

  > `doc` and `book` bypass the shared cache: their §6.7 audience gate is
  > per-caller, and a shared ETag would leak gated content across viewers.

  The condition beneath that sentence compared the **raw** `:type` path segment
  against the literals `'doc'` / `'book'`. The route serves both spellings, and
  Prime Directive #3 makes the **plural** one canonical — so
  `GET /api/v1/meta/books/:name` did not match the exclusion, took the cached
  branch, and the audience gate never ran. `enableCache` defaults to `true`, which
  made the failing path the default one.

  Measured against a real `RestServer` — one book declaring
  `audience: { permissionSet: … }`, one signed-in caller holding no permission
  set:

  ```
  singular "book"  :: cachedCalls=0 status=[403] PERMISSION_DENIED
  plural   "books" :: cachedCalls=1 status=[]    full gated body served
  ```

  Same book, same caller, two spellings of one route. `GET /meta/docs/:name` took
  the same path. This was **fail-open**: the wrong outcome is disclosure of gated
  documentation, not an availability error.

  **The fix is structural, not two corrected literals.** This is #3984 recurring
  in the same file eight days later, so the handler now normalizes the type
  **once** at the top (`RestServer.metaTypeSingular`) and every gate below reads
  that local — a per-type gate added later has no raw param in scope to compare
  against by accident. The cache exclusion and the §6.7 gate now read one shared
  predicate, so "which types bypass the cache" and "which types are audience
  gated" can no longer drift apart. A repository guard
  (`pnpm check:meta-type-normalized`, AST-based, zero exemptions) refuses the next
  raw comparison in `packages/rest/src`.

  **Behaviour change worth knowing:** `GET /meta/docs/:name` and
  `GET /meta/books/:name` now take the uncached branch, as their singular
  spellings always did, so those two responses no longer carry an `ETag` /
  `Cache-Control` validator and a conditional request no longer answers `304`. No
  other metadata type is affected. The cost is only the 304's saved bytes —
  `getMetaItemCached` delegates to `getMetaItem`, so the server does identical
  work either way — and the ETag it gave up was a hash of the **unfiltered**
  document, which is the cross-viewer leak the exclusion exists to prevent.

- 2443bb4: `/meta` reads localize the canonical PLURAL spelling, not just the singular

  The three metadata read handlers (`GET /meta/:type`, `GET /meta/:type/:name`,
  `GET /meta/:type/:section/:name`) handed the raw `:type` path segment to the
  translate helpers, whose "does this type translate" predicate reads a set derived
  from singular-only translator keys (`view` / `action` / `object` / `app` /
  `dashboard` / `page`). Prime Directive #3 makes plural the canonical REST
  spelling, so a caller following the documentation received unlocalized
  labels/descriptions/navigation while the singular spelling of the same route
  returned the translated document.

  `translateMetaItem` / `translateMetaItems` now fold the spelling to the canonical
  singular before asking, so both spellings answer the same localized body. The set
  of translatable types is unchanged — only which spellings reach it.

- 495019b: fix(rest): the /meta per-type gates are enforced on both spellings of the type segment (#3984)

  Every per-type filter on `GET /meta/:type` and `GET /meta/:type/:name` compared
  `req.params.type` to a literal SINGULAR name, while the protocol's `getMetaItems`
  normalizes singular↔plural and serves either. Prime Directive #3 makes plural the
  canonical REST spelling, so the form a client is most likely to use —
  `/api/v1/meta/books` — reached the handler with every gate skipped.

  Three of those gates are authorization:

  - **ADR-0046 §6.7 book / doc audience** (three sites: the list, the single-item
    read, and the doc effective-audience union). `GET /meta/books` returned a
    `{ permissionSet }`-gated book — an _Admin Guide_ — to a caller who does not
    hold the set, and `GET /meta/books/admin_guide` answered `200` where the
    singular spelling answers `401`. On a publicly-served deployment the same skip
    handed an `org` book to an anonymous reader.
  - **App RBAC filter** — hides privileged apps (Studio, Setup) and gated nav
    entries from callers without the grants. `GET /meta/apps` skipped it.
  - **Dashboard `requiresService` gate** (ADR-0057 D10). `GET /meta/dashboards`
    skipped it.

  The remaining spelling-sensitive branches are behavioural rather than
  authorization — doc i18n locale collapse, and the list-response `content` strip —
  and were inconsistent between the two spellings for the same reason.

  Each handler now normalizes the type ONCE (`RestServer.metaTypeSingular`, backed
  by the same `PLURAL_TO_SINGULAR` table the protocol uses) and every gate keys on
  that value, so the two spellings of one route can no longer diverge. Found while
  scoping #3963.

- 54adb1f: fix(rest): a bearer-authenticated metadata write is attributed to the caller, not to `system` (#7749)

  An admin's ordinary `PUT /api/v1/meta/<type>/<name>` was attributed to nobody:
  the `sys_metadata_audit` row recorded the sentinel `actor: 'system'` and the
  `sys_metadata_history` row recorded `recorded_by: NULL`. The real identity
  appeared only if the caller hand-set a non-standard `X-Actor` header — so the
  audit trail could not answer "who changed this" for any normal console or API
  client.

  The cause was a fallback chain with no producer. Five `/meta` write sites
  (save, delete, publish, rollback, compound save) each resolved the actor as
  `req.headers['x-actor'] ?? req.headers['X-Actor'] ?? req.user?.id ?? req.userId`,
  and **nothing on this transport ever sets `req.user` or `req.userId`** — REST
  resolves identity through `resolveExecCtx` (better-auth → `resolveAuthzContext`),
  which puts it on the returned ExecutionContext, never back onto the raw request.
  The token was validated; its identity simply never reached the handlers.

  The two dead limbs are replaced — not widened with a third — by a single shared
  producer, `resolveMetaWriteActor`, which reads the SAME identity resolution the
  route's own `manage_metadata` capability gate reads a few lines earlier. The
  caller a write is attributed to can no longer drift from the caller it was
  authorized against, and all five sites share one rule rather than five copies.

  Unchanged, deliberately: `X-Actor` still outranks the authenticated identity,
  exactly as the original expression read — that precedence is a security-semantics
  question for the audit contract, tracked on the issue, not something to settle as
  a side effect of fixing the producer. Also unchanged: anonymous and internal
  system writes resolve no principal, so they still record `'system'` / `NULL`. A
  machine write is never stamped with a real user.

- 20bc1ec: fix(spec,rest): the metadata forms save what they show — form ↔ Zod reconciliation (#3786)

  Every entry in `METADATA_FORM_REGISTRY` is a hand-written `defineForm` layout
  that names keys of a Zod schema it never imports: two descriptions of one key
  set, a comment asking the next author to keep them in step, and nothing that
  fails when they don't. #3786 asked for a sweep of that shape across the repo.
  **Four of the seventeen forms had already drifted, every one of them silently.**

  The silence is the point. `ObjectSchema` / `FieldSchema` are deliberately not
  `.strict()`, so a key the schema does not declare parses clean and is stripped
  on the way to storage — the same ADR-0104 failure class the `field.zod.ts`
  prune tombstone already describes in prose. An admin toggled a switch in
  Studio, got no error, and the value never landed.

  **What was broken, from an author's seat:**

  - **Object → Capabilities.** The block bound to `capabilities`; the
    `ObjectSchema` key is `enable`. All seven toggles (Track history, Searchable,
    API enabled, Files, Feeds, Activities, Clone) saved nothing.
  - **Object → Fields.** The inline column grid offered 16 keys `FieldSchema` has
    never declared. `PII`, `Encrypted`, `Indexed`, `Immutable`, `Filterable`,
    `Placeholder`, `Validation`/`Error message` and `Starting number` were
    controls with no storage behind them at all; the rest named keys the schema
    had **renamed** and the form never followed:
    `referenceFilter` → `lookupFilters`, `cascadeDelete` → `deleteBehavior`
    (a three-way enum, not a boolean), `formula` → `expression`,
    `displayFormat` → `autonumberFormat`, and the flat `summaryType` /
    `summaryField` pair → the single `summaryOperations` object, which also
    restores the `object` key the flat pair had no slot for. Roll-ups authored in
    that grid saved nothing.
  - **Report → Advanced.** `aria` and `performance` were pruned from
    `ReportSchema` by #3496; the form kept rendering both.
  - **Hook / Action → Body.** `memoryMb` was unauthorable — named in
    `hook.form.ts`'s own doc comment, absent from the list beneath it.
  - **Page → Interface.** `interfaceConfig.sort` was unauthorable, so a page's
    default sort order could not be set in Studio at all.

  **No authored metadata changes and nothing you can write is removed.** These
  were UI controls that never persisted; every corrected key is one `FieldSchema`
  / `ObjectSchema` already accepted. Metadata authored in YAML/TS was always
  validated against the real schema and is unaffected. If you had been filling
  those Studio controls expecting them to stick, they now either work (the
  renamed five) or are gone rather than lying to you.

  The metadata-form translation bundles are derived from the registry, so all
  four locales are regenerated. Worth naming what they contained: translated
  labels, in four languages, for switches that saved nothing — the drift had
  propagated into a generated artifact and been dutifully translated there.

  **The mechanism.** `metadata-form-zod-reconciliation.test.ts` walks every
  registered form and reconciles it against `getMetadataTypeSchema()`. The two
  directions are deliberately asymmetric: **form-only** (a control whose value is
  discarded) is always a defect and cannot be excused, because no design wants
  one; **zod-only** is ledgerable with a reason, for a deprecated key held back
  from new authoring or a curated quick-add subset that defers to a fuller
  editor. Ledger entries are checked for non-vacuity and for still resolving on
  both sides, per the #4045 / #4040 discipline. Verified by mutation — re-adding
  a stripped key, dropping a covered key, and offering a ledgered omission each
  turn the gate red.

  **New export: `TRANSLATABLE_METADATA_TYPES`** (`@objectstack/spec/system`), the
  set of metadata types whose labels `translateMetadataDocument` localizes,
  derived from its dispatch table rather than restated. `@objectstack/rest` had
  been carrying a hand-copied literal set under a "keep in sync with the type
  dispatch" comment; it now reads this instead. Registering a translator in spec
  reaches the REST boundary with nothing else to remember — the second list is
  deleted rather than checked, which is the better half of derive-or-gate.

  Also corrected: `ActionAiCategorySchema`'s comment claimed it mirrored
  `ToolCategorySchema` in `ai/tool.zod` and told the next author to update both
  sides — but #3896 deleted `ToolCategorySchema` along with the inert
  `tool.category` key it typed. The instruction had been pointing at a source
  that no longer exists. The enum is canonical now and says so.

- 7bc02f4: fix(rest): drop a navigation group that was DECLARED empty, not just one the gate emptied (#7380)

  `filterAppForUser`'s docblock has promised "Empty groups collapse so the sidebar
  doesn't render a label with no children" since #4651, and its `filterNav` branch
  carried the matching comment. The guard in front of that branch was
  `Array.isArray(e.children) && e.children.length > 0`, so a group authored
  `children: []` never reached the rule that owns the promise — it fell through the
  `else` and shipped in `GET /meta/app` as a bare label. The one shape the sentence
  most obviously covers was the one shape it could not reach.

  The judgement is now on what SURVIVES rather than on how the entry got there. A
  `type: 'group'` with no surviving children is dropped whether it **became** empty
  (children filtered away by `requiredPermissions` / the ADR-0057 D10
  `requiresService` gate) or **started** empty (`children: []`). Nesting composes:
  an outer group left holding only a dropped inner group collapses in the same
  pass. A group carrying no `children` key at all — unreachable through the spec,
  where `children` is required on both the input and output `group` branches, but
  reachable at runtime because this filter reads untyped documents off the metadata
  store — is the same dead label and drops too.

  **Contribution slots are the shape this actually shipped.** `setup.app.ts` is
  authored entirely out of it: nine `type: 'group'` anchors with `children: []`,
  filled on read by `Registry.applyNavContributions` (ADR-0029 D7) from whichever
  capability packages are installed. That merge runs in the protocol layer _before_
  this filter, so a slot a plugin filled arrives here with children and survives,
  while a slot left empty because its capability is disabled arrives `[]` and is
  now dropped — exactly the "a disabled capability contributes nothing and its slot
  stays empty" case `setup.app.ts` documents. Deployments that ran without the
  optional plugins were serving those anchors as empty, unopenable sidebar
  headings; they now disappear, and the ones with contributions are untouched.

  **The rule is `type: 'group'` and nothing else.** The navigation union nests on
  two branches (`object` and `group`). An `object` entry navigates on its own
  `objectName`, so `{ type: 'object', objectName: 'lead', children: [] }` is a live
  link that nests nothing, and emptiness says nothing about whether to serve it —
  non-group entries keep their existing behaviour exactly, including when the gate
  empties their children. A group cannot be a target: `GroupNavItemSchema` is a
  `strictObject` declaring no `objectName` / `pageName` / `componentRef` / `url`
  (it rejects them), and its docblock reads "Does not perform navigation itself."
  Measured before the change: 41 `type: 'group'` entries across the shipped apps
  (`account`, `setup`, `studio`), the examples (`app-crm`, `app-showcase`,
  `app-todo`) and the spec's nav type-assertion fixtures. 16 are childless — the 9
  `setup` slots plus 7 spec fixtures, none in the example apps — and zero of the 41
  carry `objectName` / `pageName` / `componentRef` / `url` or any other target. The
  drop is therefore unconditional; no standalone-group shape needed sparing.

  One consequence worth naming: because `areas[].navigation` is filtered through
  this same `filterNav`, an area whose entries are all childless groups now empties
  and is dropped by the existing area-collapse rule. An area authored
  `navigation: []` is still passed through untouched, as before — a group is a
  sidebar label and nothing else, while an area is a workspace the shell can select
  on its own, and that divergence is documented at `filterAreas`.

- 6b7129a: fix(rest,lint,spec): prune nav entries whose destination object cannot serve, and refuse them at authoring time (#7912)

  A `type: 'object'` navigation entry pointing at an object that **cannot answer a
  list** was served to the client in the `/meta` payload anyway. The user saw a
  menu item that could not work, and the console rendered the failure as a generic
  empty state — so it read as _"you have no records"_ rather than _"this page
  cannot work"_.

  Two independent conditions make a destination unservable, and **neither was
  expressible on a nav entry**:

  - `enable.apiEnabled: false` → the list answers `OBJECT_API_DISABLED` (404);
  - an `enable.apiMethods` whitelist without `list` → `OBJECT_API_METHOD_NOT_ALLOWED` (405).

  Both are pure functions of the object's own `enable` block — no user, no
  permissions, no request context — so the destination is dead for **every**
  persona, platform administrator included. That is why a `requiredPermissions`
  gate could never prune such an entry: the two are independent conditions, and no
  combination of permissions on the _entry_ rescues an entry whose _object_ is
  API-disabled. One shipped that way for a year and read as correct to reviewers,
  its in-code comment claiming a non-admin "403s server-side" — which implies an
  admin could list. None could.

  **The fact is now derived, not declared.** `filterAppForUser` consults the
  destination's `enable` block for every `type: 'object'` entry and drops the ones
  that cannot serve, on both the app-list and the by-name `/meta` routes and
  inside `children` and `areas[]` alike. No new authorable key was minted: the
  platform already knows this, on the object, in one place.

  **And the prune is never silent.** A prune the author cannot see is the same
  failure one layer over, so it is refused at authoring time: `os validate` /
  `os build` / `os lint` now **fail** with `nav-object-unservable`, naming the
  entry, the object, the offending `enable` key path and which of the two
  conditions fired. The serving side logs the same facts for an entry that reaches
  a running deployment anyway.

  The single two-step order these consumers share — `apiEnabled` first and
  independently, the whitelist second — is now declared once as
  `apiExposureDenialReason` / `canServeApiOperation` in `@objectstack/spec/data`,
  beside the `resolveEffectiveApiMethods` / `isApiOperationAllowed` primitives it
  composes. The REST data gate, the nav prune and the authoring rule all read that
  one export instead of re-spelling the order.

  **Deliberately unchanged:**

  - `requiresObject` keeps its client-only evaluation. It asks whether an object
    is _registered_; this gate asks whether a registered object's `enable` block
    lets it answer. An entry whose object this layer cannot find is **served**,
    not pruned.
  - `visible` (CEL) is still client-side only.
  - Fail-open throughout: unreadable object metadata prunes nothing, so a cold
    start or a metadata outage cannot empty a healthy deployment's sidebar.
  - Objects an authoring stack does not itself declare are not judged by the lint
    rule — their `enable` block is not visible from there.

- 3a27c46: test(rest,dogfood): enumerate every property the object-extension fold touches, and locate #8037's divergence in i18n rather than in the fold (#8037)

  Third card in one family. #7556 (PR #8015) reconciled the by-name and list reads
  on `fields`; #8027 (PR #8045) then found `validations`/`indexes` duplicated,
  invisible to #8015's pin because it compares FIELD NAMES and the field spread is
  idempotent. #8037 arrived next, about `label`.

  **The enumeration, because the instances keep arriving.**
  `mergeObjectDefinitions` names six keys and copies nothing else — which
  `ObjectExtensionSchema`'s own guidance states from the other side ("the merge
  carries `fields`, `label`, `pluralLabel`, `description`, `validations` and
  `indexes` only") — in three merge kinds:

  | property                                | merge kind               | idempotent? |
  | --------------------------------------- | ------------------------ | ----------- |
  | `fields`                                | key-keyed spread         | yes         |
  | `validations`                           | CONCATENATED             | no (#8027)  |
  | `indexes`                               | CONCATENATED             | no (#8027)  |
  | `label` / `pluralLabel` / `description` | scalar, last-writer-wins | yes         |

  So a fold has three distinct failure modes and a field-name pin sees one.
  `meta-object-extension-property-classes.test.ts` sweeps all six across twelve
  host shapes (artifact/bridged/absent × no-row/customised/verbatim/prefolded),
  asserting each read against the REGISTRY'S RESOLVED SCHEMA (ADR-0029 D9.2)
  rather than against another route — both prior defects had the two routes
  agreeing with each other on a body that was already wrong.

  **#8037 is not a fold defect.** Traced through a real artifact-ingest boot,
  `foldObjectExtendersOnto` is called on the by-name read and on the layered read
  with the same base and returns the same body to both, `label` included. The
  sweep holds the same result from the other side: on all twelve shapes every read
  agrees with D9.2 on all six properties. The divergence is produced one layer up.
  `translateObject` resolves each of the three scalars as `catalog ?? document`,
  and the showcase's own catalog declares `objects.showcase_account.label =
"Account"`. The list and by-name reads are translated, so the catalog entry
  replaces whatever the fold resolved; `?layers=true` is deliberately not
  translated ("this is a diagnostic"). Hence "onto `?layers=true` only".

  **The extension is the milder half.** The catalog is keyed by object name and
  resolved ahead of the document, so it defeats the TENANT's customisation too: an
  admin who renames the object through the ordinary Studio round-trip gets a
  `layers.overlay` carrying `"Customer"` and both reads every writable form
  derives from still serving `"Account"`. That is the scenario #8027/#8045 were
  about. Escalated rather than decided here — the issue itself asks for a design
  ruling, and both candidate directions change behaviour well outside this card's
  region.

  **No behaviour change.** Tests only; `mergeObjectDefinitions`,
  `foldObjectExtendersOnto`, `getMetaItem` and `getMetaItemLayered` are untouched,
  so #8045's idempotency, the `layers.overlay` boundary and byte-identity for
  unextended objects all stand as they were.

  Reverse-verified per arm (A: #8045's subtraction disabled; B: the card's
  proposed "fold drops scalars"; C: #7556's fold disabled). Arm B — the easy half
  the card asked for — is invisible to BOTH existing pins and is caught only by
  this file's anti-vacuity case: dropping scalars makes the three reads agree by
  deleting a documented `ObjectExtensionSchema` feature, and leaves the tenant
  rename defect untouched.

- aeb9b27: **发布出去的 OpenAPI 文档 `components.schemas` 不再是空的,6 个 `$ref` 不再悬空(#5168)**

  `GET /api/v1/openapi.json` 的 base spec 由 `packages/spec/scripts/build-openapi.ts` 生成,它把九个契约 schema(`CreateRequest` / `ApiError` / `ListRecordResponse` / …)转成 JSON Schema 填进 `components.schemas`。收集判据写的是 `typeof schema === 'object' && '_zod' in schema`,而这九个 schema 全部经 `lazySchema()` 包装 —— 其 Proxy target 是 `function lazyZod() {}`,于是 `typeof` 是 `'function'` 而不是 `'object'`,判据第一段就短路,九个一个都没进去。`paths` 里那 6 个 `$ref` 是手写字面量,不受影响照常写出,结果是**一份 `components.schemas` 为 `{}`、6 个 `$ref` 全部悬空的文档被发布出去**,覆盖 `/api/{object}` 与 `/api/{object}/{id}` 上全部 CRUD 操作的请求体与响应体。

  判据放宽为同时接受 `'object'` 与 `'function'`。`'_zod' in schema` 那一段对 Proxy 本来就是有效的 —— `lazySchema` 专门维护了 `_zod` facade 供 `toJSONSchema` 遍历 —— 所以 `lazySchema` 本身不需要改动。对照实验坐实了唯一变量就是 Proxy:同一份源码下 `npx tsx scripts/build-openapi.ts` 得到 `Components: 0`,而 `OS_EAGER_SCHEMAS=1`(`lazySchema` 自带的绕过 Proxy 应急开关)得到 `Components: 9`。修复后不带任何环境变量即为 `Components: 9`。

  两类消费者直接受益:`GET /api/v1/docs` 的 Scalar viewer 现在有 schema 可渲染;从该文档做客户端代码生成的集成方(openapi-generator / orval / …)不再在解析期撞上 unresolvable reference。

  **同时补上防复发的门禁。** 这个缺陷三个层次同时可见(空 components、悬空 ref、控制台明晃晃的 `Components: 0`)却没有任何一处红 —— `gen:openapi` 是全仓两个完全无门禁的生成器之一。生成器现在在**写盘之前**自检两条,任一不满足即以非零码退出,自恰不了的文档根本不会被写出来:

  1. **每个本地 `$ref` 都必须解析得到。** 按 JSON Pointer 解析而不是按 `#/components/schemas/` 前缀匹配,将来新增的 `#/$defs/…` 引用自动被覆盖;报错逐条点名悬空的 `$ref` 及其在文档中的位置,并把「已定义的 schema 列表」一并打出来 —— 哪一侧是空的是读者最先需要的信息。
  2. **没有 schema 被静默降级。** 九个契约 schema 是一张字面清单,某个名字没产出东西永远是缺陷而不是「这个可选」。原先的循环写成 `if (像 zod) { 收 }` 且没有 `else`,正是这个「静默跳过」的形状让九次跳过发布成了空文档;现在**声明即强制**,漏掉的名字会被点名。`z.toJSONSchema()` 抛错时原先会塞一个 `{type:'object'}` 占位描述冒充契约,这条同样改为响亮失败 —— 当前九个全部干净转换,零占位。

  门禁接在生成器内部而不是单独的 `check:` 脚本,因为 `packages/spec/json-schema/` 是 gitignore 的、每次 `pnpm build` 重新生成,独立检查脚本无论如何都要先跑一次生成器才有东西可查。「产物自恰」这类断言比「产物最新」更便宜,且不需要任何基线快照。

  `packages/rest` 侧无行为改动:声明式端点的 enrichment 仍然只写 `type: object` 而不编造 `$ref` —— 九个契约 schema 是通用 CRUD 信封,不是某个具体对象的 body 形状 —— 但三处以现在时陈述「`components.schemas` 是空的」的注释已按事实更新。

- b4b2c7d: fix(rest,runtime,types): the direct-mount package door answers a coded refusal with its own status and code (#8016)

  **This changes HTTP status codes on a live surface.** Requests to
  `/api/v1/packages` that today come back `500 INTERNAL_ERROR` will come back as
  the refusal they always were — `409 DESTRUCTIVE_CHANGE` for an uninstall that
  would drop data, `400`/`403` for a coded refusal thrown from below. A client
  that keys on `500` to decide "the platform is down, retry later" for these
  routes must key on the `code` instead. No route, path, verb or success body
  changes.

  `/api/v1/packages` has two HTTP transports. The runtime dispatcher's
  (`packages/runtime/src/domains/packages.ts`) reads a thrown error's own
  `.status` and `.code` and answers with them. The direct-mount REST registrar
  (`packages/rest/src/package-routes.ts`) had **four** catch-alls that answered
  `sendError(res, 500, 'INTERNAL_ERROR', …)` regardless — and that registrar
  mounts _first_ in the production stack, so the status-blind answer was the one
  production actually returned. `packageService.publish`, `packageService.delete`
  and `protocol.deletePackage` all execute inside those blocks, and
  `@objectstack/metadata-protocol` throws coded, status-carrying refusals from
  that call path. So a caller who was **refused** was told the platform had
  **broken**: the wrong class of answer, a retry that cannot succeed, and the one
  field a client can branch on dropped.

  The four sites now leave through one shared exit. The mapping is not
  reimplemented here — that is how the two doors diverged in the first place. It
  moved to `resolveThrownHttpError` in **`@objectstack/types`** (alongside the
  `sendOk`/`sendError` envelope writer and `looksLikeInternalErrorLeak`, for the
  same reason: it is a property of the HTTP boundary, not of one router), and the
  dispatcher's `HttpDispatcher.errorFromThrown` is now its other caller. It could
  not live in `@objectstack/runtime`: that package depends on `@objectstack/rest`,
  so the import can only point one way.

  The rule, unchanged from what the dispatcher always applied:

  - **status** — the producer's `.status`, then `.statusCode` (both spellings are
    produced in this repo), then `400` for a record-validation failure, then the
    caller's fallback.
  - **code** — `VALIDATION_FAILED` for a validation failure, then the thrown
    `.code` **when it is a member of the declared ADR-0112 vocabulary**
    (`StandardErrorCode ∪ ERROR_CODE_LEDGER`), then the code the status derives.
    An unregistered code no longer reaches `error.code` on the dispatcher door
    either; it would have failed envelope parse, which is ADR-0112's closed
    vocabulary working rather than a dialect leaking onto the wire.
  - **the 500 survives** — a throw declaring neither status nor a registered code
    is a genuine fault and still answers `500 INTERNAL_ERROR`.

  `validation-failure.ts` moved from `@objectstack/runtime` to
  `@objectstack/types` for reachability and is re-exported from its old module
  path; every existing import site is unchanged.

  Unchanged and deliberately so: this REST door still ships a 5xx message
  verbatim, where the dispatcher withholds one that looks like an internal leak
  (`looksLikeInternalErrorLeak`, #3867). That asymmetry predates this fix and is
  filed separately.

- 2ee1ab9: fix(rest): the direct-mount package door withholds a leaky 5xx message, like its two siblings already do (#8086)

  A driver failure under `/api/v1/packages` returned the driver's own line to the
  API client. Reproduced end to end through a real `ObjectQL` engine and a real
  `ObjectStackProtocolImplementation`, with the driver failing the `sys_metadata`
  read the way a missing table does — `DELETE /api/v1/packages/:id` answered:

  ```
  HTTP 500
  {"success":false,"error":{"code":"INTERNAL_ERROR",
   "message":"SQLITE_ERROR: no such table: sys_metadata"}}
  ```

  That path is not exotic: a full uninstall (no `?version=`) routes to
  `protocol.deletePackage`, whose first database touch sits outside its own
  per-item `try`, so the driver line propagates whole into this registrar's
  catch-all and onto the wire.

  **Not a new rule — the rule this surface already followed, at the door that was
  missed.** Both siblings sanitize: the dispatcher twin (`HttpDispatcher.error`)
  has replaced a leaky 5xx message with the generic text since #3867, and
  `rest-server.ts` runs the same predicate at three call sites. The earlier fix
  for this class (#5437) reached neither this registrar nor could it, because
  this door does not go through `resolveErrorResponse` at all. `/api/v1/packages`
  has **two** HTTP doors and this one mounts first in the production stack, so
  the unfiltered answer was the live one — one deployment, two different answers
  to the same failure.

  **Only the prose is withheld.** `status`, `code` and `details` are untouched,
  so a client can still branch on the code and the coded-refusal mapping added in
  #8016 still answers. The full text still reaches the server log and the error
  reporter.

  **4xx is deliberately untouched.** A refusal's message is caller-facing by
  design — `[tenant_scope_required]` names the exact parameter to pass, a `409
DESTRUCTIVE_CHANGE` names the remedy — and it is disclosed where disclosure
  costs nothing, because the caller supplied the input. Withholding those would
  delete the self-correcting sentence that makes the refusal actionable.

  **Known ceiling, stated so a green suite is not mistaken for full coverage.**
  The shared predicate is a heuristic over the message and does not recognise
  Postgres's `relation "…" does not exist` phrasing, so that dialect's line still
  travels — here and through the dispatcher twin alike, since both run the same
  predicate. Widening it at one door would re-create the divergence this closes.
  The cure is to stop interpolating driver text into client-facing messages at
  the producer, which is tracked separately.

- a3c0865: Give `POST /api/v1/packages/publish` an owner on every boot (#7563)

  On a live showcase boot, `POST /api/v1/packages/publish` answered **405** with
  `Allow: DELETE, GET, HEAD, PATCH`. Not one of those verbs belongs to the publish
  surface — `POST` is the only verb it has ever had. They are `/packages/:id`'s
  method set, offered because with the publish route unmounted that pattern was
  the only registration still matching the path, with `id = "publish"`. A caller
  was told "this path exists, use another method", and every method on offer would
  have operated on a package literally named `publish`.

  Two facts produced it, and both are repaired.

  The REST package registrar was gated on `ctx.getService('package')` resolving at
  the single instant `RestApiPlugin.start()` ran. `objectstack serve` registers the
  capability providers (`requires: ['marketplace']` → `PackageServicePlugin`)
  _after_ `createRestApiPlugin`, and start order follows registration order for
  plugins with no dependency edge between them — so the deployments that do
  compose a package service are precisely the ones that answered "no" at mount
  time. The service is now handed to the registrar as a resolver and read per
  request, which makes the answer independent of composition order instead of
  silently encoding it.

  And `POST /packages/publish` has no dispatcher twin, so "not mounted" never
  degraded to the 404 the composition documented — it degraded to a sibling's 405.
  It therefore mounts unconditionally and answers its own honest 404, naming the
  surface rather than a package id, where no package service is composed. The
  other three package routes deliberately do **not** follow: each shadows a live
  dispatcher twin at a byte-identical pattern, so mounting them without a service
  would replace three working routes with a degraded refusal.

  The route-ledger ↔ live-mount parity gate (#7526) had this row **pinned** as
  unobservable, reasoned as "the registrar is service-gated and this boot composes
  none". The reason was true and the conclusion was wrong: an unmounted route is
  not automatically an unanswered one. The pin is deleted (the route is now
  observable for real), and the pin rule itself is tightened — a pinned path that
  some _other_ pattern answers now fails the gate, because that is the disguise
  the gate already refuses for every unpinned row.

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

- 3ac243a: fix(rest): resolve the public-lookup picker target from the canonical `reference` key (#7486)

  `GET /forms/:slug/lookup/:field` treats `publicPicker.object` as an optional
  override: omit it and the server is supposed to resolve the target from the
  field's own definition on the parent object. It could not. The fallback chain
  read three **legacy** spellings only —

  ```ts
  referenceTo = def?.referenceTo ?? def?.target ?? def?.options?.objectName;
  ```

  — while `packages/spec/src/data/field.zod.ts` folds `relatedTo` / `referenceTo`
  / `target` / `targetObject` / `lookupObject` **all onto `reference`** at parse.
  A parsed, canonical object schema therefore carries none of the three keys the
  route read: the chain resolved `undefined` and the route answered
  `500 LOOKUP_TARGET_MISSING` for exactly the well-formed metadata the platform
  produces. Net effect, `publicPicker.object` was de-facto **required** while the
  schema and the docs presented it as optional.

  The canonical `reference` now heads the chain. A field declared
  `{ type: 'lookup', reference: 'sys_user' }` resolves with no `object` override,
  which is the form authors are told to write.

  The three legacy spellings are **kept after it**, not replaced: rows stored
  before the alias fold never went through the alias table and still carry them,
  so this widens the resolution rather than moving it. Precedence is
  `reference` → `referenceTo` → `target` → `options.objectName`, so a
  partially-migrated def carrying both follows the canonical key.

  `LOOKUP_TARGET_MISSING` did not become unreachable — it became rare. A field
  naming no target object at all (or one whose object metadata cannot be read)
  still gets the loud 500 rather than a silent search of nothing.

  No spec change: the spec was already right, the consumer was reading the wrong
  keys. The docs table in `content/docs/ui/forms.mdx`, which pointed authors
  hitting this 500 at declaring `object`, is corrected in the same change.

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- e98c9d3: fix(rest): a repeated `?filter=` on `GET /data/:object` is refused as a repetition, not misdiagnosed as a malformed filter (#7390)

  **This is a behaviour change on a live surface.** A request that previously
  answered `200` now answers `400`, and a request that already answered `400` now
  carries a different message. Both changes make the response describe what the
  caller actually did.

  Repeating a query parameter used to be invisible: the production Hono adapter
  collapsed repeats to the first value before any handler ran. Since #6878 route 2
  (PR #7396) it surfaces them as arrays, so a repeated `?filter=` now reaches the
  shared list-query normalizer — and that normalizer structurally cannot tell what
  it is looking at. A filter AST **is** an array (`["status","=","open"]`), so the
  arity gate #7386 added to every other query slot had to leave this one alone: on
  the filter slot, an array is the ordinary shape of a legitimate body-form filter
  sent to `POST /data/:object/query`.

  Two shapes came out of that, both live:

  | request                                 | before                                                    | now                                                 |
  | :-------------------------------------- | :-------------------------------------------------------- | :-------------------------------------------------- |
  | `?filter={"a":1}&filter={"b":2}`        | `400 INVALID_FILTER`, diagnosed as a **malformed** filter | `400 INVALID_FILTER`, diagnosed as a **repetition** |
  | `?filter=status&filter=%3D&filter=open` | **`200`**, applying `{status:"open"}`                     | `400 INVALID_FILTER`                                |

  The first was the common one, and its message was actively misleading: both
  filters the caller sent were well-formed, the response told them to check their
  AST syntax, and the operator vocabulary it listed could not help. The second is
  contrived to write by hand but is the sharper defect — three occurrences of one
  parameter happened to spell a valid AST, so the request succeeded while applying
  a filter nobody expressed.

  The refusal now names the condition: `Repeated "filter" query parameter — send
exactly one.` A repeated filter is **not** merged and **not** resolved by
  precedence — either would silently serve one of two intents the caller actually
  expressed, which is the authoring trap this refusal exists to close.

  The judgement is made at the REST querystring parse rather than in the shared
  normalizer, because the querystring layer is the only one that knows it is
  looking at a querystring: there, an array on the filter slot is a repeated
  parameter and can be nothing else. All four wire spellings of the one slot
  (`filter`, `where`, `filters`, `$filter`) are covered.

  **Unaffected:**

  - A **single** `?filter=` in either accepted form — the JSON object
    (`?filter={"status":"open"}`) and the bare AST
    (`?filter=["status","=","open"]`).
  - `POST /data/:object/query` — the body face legitimately sends an array, and is
    untouched.
  - Genuinely multi-valued query parameters (`$select`, `$expand`,
    `$searchFields`), which keep their array arm.
  - A one-element array from a repeat-preserving adapter, which is one occurrence
    and is unwrapped rather than refused — this also stops it being read as a
    malformed AST.

  No spec change: `INVALID_FILTER` is already a standard-catalog code, and the
  accepted wire forms of `filter` are unchanged.

- af5918b: fix(rest): `DELETE /api/v1/reports/:id` stops telling a caller whether a report id exists

  `DELETE /api/v1/reports/:id` answered differently depending on whether the target
  id **existed**, which let any authenticated caller enumerate other users' saved
  reports by probing ids and reading the status code:

  | Target                    | Before                     | After                        |
  | ------------------------- | -------------------------- | ---------------------------- |
  | Another owner's report id | `500 REPORT_DELETE_FAILED` | `404 REPORT_NOT_FOUND`       |
  | An id that does not exist | `204 No Content`           | `404 REPORT_NOT_FOUND`       |
  | Your own report           | `204 No Content`           | `204 No Content` (unchanged) |

  The service layer was never wrong. `deleteReport()` returns early for an unknown
  id and throws `REPORT_NOT_FOUND` for a report the caller does not own — with the
  intent written down in the source: _"others get a not-found so the delete neither
  fires nor reveals the report's existence"_. **The route discarded it.** Its catch
  went straight to `res.status(500)` and never reached the file-local
  `handleValidation`, which maps `REPORT_NOT_FOUND*` to 404 — the sibling
  `DELETE /reports/schedules/:scheduleId` in the same file does call it, which is
  why that route was already correct.

  Rewiring that catch is necessary but **not sufficient**: it maps the cross-owner
  arm to 404 while an unknown id still answers 204, which is the same oracle in a
  quieter costume — 404-vs-204 discriminates on existence exactly as well as
  500-vs-204 did. So the two deny arms are now answered by **one** response, before
  the delete fires, using the call this surface already keeps blind to the
  difference: `getReport()` returns null for an unknown id and for another owner's
  id alike (#2980). That response is emitted by `handleValidation` from a
  synthesised `REPORT_NOT_FOUND` — the same code path the thrown arm takes — so the
  status and the body cannot drift apart. Both arms also now do identical work (one
  visibility read, no delete, no `logError`), where the cross-owner arm previously
  threw and logged and the unknown one did neither.

  **Behaviour change for existing clients.** Deleting a report you own still answers
  `204`, and the SDK's `reports.delete()` is unaffected on that path. What changes
  is deleting an id you _cannot see_: previously a silent, idempotent `204`, now a
  `404 REPORT_NOT_FOUND` — so a client that re-issues a delete for a report already
  deleted (or never present) now sees an error where it saw success. That is the
  cost of closing the oracle, and it puts delete in line with the rest of the
  surface: cross-owner `GET`, `run`, upsert-overwrite and unschedule all already
  answer 404 for the same input.

- 2c2a212: fix(reports): owner-gate the saved-report schedule routes (#2980)

  The report read/run/delete routes are owner-isolated (a caller may only touch a
  report they own, denied as `REPORT_NOT_FOUND` to avoid leaking that the id
  exists), but the two schedule routes bypassed that gate: `unscheduleReport` and
  `listSchedules` took the caller `context` as `_context` and never consulted it,
  querying under the system context (RLS-bypassing). Any authenticated caller
  could therefore delete another owner's report schedule — a cross-owner
  destructive write — or list another owner's schedules (leaking recipient
  addresses and cron), by supplying an id.

  Both now resolve the schedule's parent report and require the caller to own it,
  mirroring the sibling routes:

  - **`unscheduleReport`** loads the schedule, then its report, and deletes only
    when `canAccessReport` holds; a cross-owner attempt throws `REPORT_NOT_FOUND`
    (mapped to `404` by the REST layer, deny-as-404 anti-enumeration), while a
    genuinely-absent schedule stays idempotent. `scheduleReport` (create) was
    already gated via `getReport`, so only the delete/list doors were open.
  - **`listSchedules`** returns an empty list to any non-system caller who cannot
    access the report it is scoped to — the same non-leaking posture as
    `listReports`. The scheduler's system context still sees every schedule.

  No authoring-surface or metadata change; existing owner-path behavior is
  unchanged.

- 39396bd: REST 的显式状态直通:4xx 错误消息超过 500 字符时**截断**,不再整条替换成 `Request failed`

  `mapDataError` 与 `resolveErrorResponse`(`sendError` 的取值端)两处 4xx 直通分支,过去都以 500 字符为界把整条 message 换成字面量 `Request failed` —— `status` 和 `code` 照常落地,正文一个字不剩。这把激励方向弄反了:驱动层那些拒收信息**唯一的存在意义**就是告诉作者哪个操作符/字段写错了、协议是怎么声明的,而 driver-sql 里写得最细的两条(#5158 未降解的 `FilterArray`、#5347 非布尔 `$null` 比较值)恰好都越过 500 字符,于是客户端只收到 `{ "code": "INVALID_FILTER", "error": "Request failed" }`。更反直觉的是:这两条**不带** `status` 时反而能原文直达(走 `mapDataError` 末尾的 `{ status: 400, body: { error: raw } }`),#4436 给它们加 `status: 400` 是为了赋予 ADR-0112 的 wire 身份,却在这一档让可读性变差了。

  现在超长消息按 `message.slice(0, 499) + '…'` 截断,与驱动侧 `safeShapePreview` 同源。这些消息把主句(操作符、字段、path、收到了什么、协议怎么声明)放在最前,被截掉的是尾部的归因和 issue 号 —— 本就该留在日志里而非响应里的部分。上限仍是 500,变的是**到达上限时的处理方式**;短于 500 的消息逐字不变。

  影响面不止过滤器:任何携带 4xx `status` 的领域错误同享此修复,包括 metadata save 校验的 422(实测一条五 issue 的 `INVALID_METADATA` 就在这条线上下)、plugin-sharing 的 record-scope 403 等。

  `sendError` 一侧的直通区间是 400–599,其中 **5xx 的整条替换刻意保持不变**:4xx 的正文是写给调用方的补救说明,5xx 的正文是服务端故障的日志诊断 —— 这与 `mapDataError` 同族分支「deliberately limited to 4xx」的既有取向一致。

- 577cd27: fix(rest): a declared 5xx no longer ships its own message to the client (#5437)

  **Behaviour change — read this if you operate a deployment or parse REST error
  bodies.** An error that carries an explicit `status` of 500 or above now reaches
  the client as `{ "error": "Internal server error", "code": "<the producer's
code>" }`. The status and the code are unchanged; only the free-text message is
  withheld, and the full original text is written to the server log.

  **What was wrong.** `sendError` — the error path of the metadata, UI, discovery
  and batch routes — passed an explicit status straight through for the whole
  400-599 band, so a declared 5xx returned `error.message` verbatim without
  passing through any of the sanitizing heuristics (`isSqlLeak`,
  `looksLikeInternalErrorLeak`, the `Internal data error` envelope). The sibling
  branch in `mapDataError` stops at 4xx on purpose, with the reason written down:
  "5xx messages keep going through the sanitizing heuristics below so
  internal/SQL details never reach the client verbatim". Two opposite verdicts on
  one question, and the routes that report through `sendError` got the permissive
  one.

  That was reachable, not theoretical. `metadata-protocol` interpolates the raw
  driver error into two client-facing 500s — the customization-overlay persist and
  delete failures — so a real driver line such as `SQLITE_ERROR: no such table:
sys_metadata`, `relation "sys_metadata" does not exist`, or a unique-constraint
  payload naming physical columns was returned to whoever made the request. The
  only thing standing in the way was a 500-character bound, and driver errors are
  far shorter than that. Length was never a proxy for leakage; on this side of the
  bound it failed open.

  **Accepted cost.** A 5xx message written _for_ the caller now reaches them as
  the generic sentence plus its code. Two concrete examples: the overlay-persist
  failure's "In-memory registry was updated but will be lost on restart", and the
  atomic-batch refusal's "retry without options.atomic, or probe
  capabilities.transactionalBatch on /discovery first". Both remain fully readable
  in the server log, and the machine-readable `code` (`OVERLAY_PERSISTENCE_FAILED`,
  `NOT_IMPLEMENTED`) still rides on the response, so a client keying on codes is
  unaffected. If you were surfacing 5xx `error` text in an operator console, read
  it from the log instead — `[REST] Unhandled error` for a genuine fault, and a
  new `[REST] 5xx message withheld from client` line for the 502/503 lifecycle
  statuses that the unhandled-error predicate deliberately keeps quiet.

  The message is dropped unconditionally rather than filtered by keyword: a
  predicate would only move the question to "does the heuristic know this
  dialect", which is the failure mode that produced the bug. 4xx behaviour is
  untouched — an over-long client message is still truncated rather than erased
  (#5423 / #5436).

- f690747: fix(rest): exempt a request from the ADR-0069 auth gate only when it carries a REAL path (#7432)

  `isAuthGateAllowlisted(undefined)` returns `true` — it treats "no path" as
  allow-listed. REST's `enforceAuth` passed `req.path` straight through, so a
  request whose `path` was absent or an empty string read as allow-listed on
  **every** route and the ADR-0069 gate (expired password / enforced MFA) did not
  fire for a session policy says must be blocked.

  `enforceAuth` now applies the guard its sibling seam already carries
  (`shouldDenyAnonymous`, `@objectstack/core/security`): a path exempts a gated
  session only when it is a non-empty string that the allow-list actually accepts.

  **Nothing shipped was bypassable.** The hono adapter populates `path` at all
  three request-construction sites, so no live transport reached this seam without
  one. What is fixed is the direction of the default: the guard was carried by the
  **caller's** discipline on a fail-OPEN seam, so a new transport adapter — or any
  synthetic request — disabled a security gate by omission with no test going red.

  No behaviour change for any request that carries a path: allow-listed paths
  (auth, remediation, health, UI-bootstrap reads) still pass, protected paths still
  block, and `OPTIONS` preflight is still exempt. A gated session with no path is
  now blocked rather than waved through.

- 773f80a: fix(rest): REST 面的执行上下文补齐 ADR-0090 D9/D10 的 principal 分类(#6071)

  `resolveAuthzContext`(`@objectstack/core`)被提取出来,正是为了让两个 HTTP 入口
  不再在**授权**上漂移。但它之后的一步 —— 把授权信封组装成 `ExecutionContext` ——
  仍是两份手写副本,而两份的字段集已经不一致:runtime / dispatcher 那份
  (`packages/runtime/src/security/resolve-execution-context.ts`)按 ADR-0090 D9/D10
  设置 `principalKind`(必要时连同 `onBehalfOf`),`rest-server.ts` 的 `computeExecCtx`
  两个都不设。

  后果不在装饰面而在 enforcement 面:`plugin-security/explain-engine.ts` 的
  posture 下限、`security-plugin.ts` 的 agent 基线、`observability/perf-timing.ts`
  的披露闸门都读 `principalKind`,于是同一个请求走 dispatcher 与走 REST 会拿到不同
  的上下文,读这个字段的判断在 `os serve` / `dev` 的数据与元数据路由上**从不成立**。
  问题由 #5859 实施时的 dogfood 全栈 boot 插桩测得:到达消费方的键集里 `__kernel`
  在(自证是 rest-server 这条组装路径)、`principalKind` 不在。

  本次改动只补这一个传输上缺的字段,口径与 runtime 侧完全一致:

  - 会话(cookie)或 API key 背书的主体 ⇒ `principalKind: 'human'` —— 与 runtime
    侧「an authenticated (API-key) request resolves as a human principal, never
    guest」的钉子同一判定。
  - `'agent'` 与随之而来的 `onBehalfOf` **在本传输上不可表达**:它需要一个指明已授权
    客户端的 OAuth access token,而该凭据只在 dispatcher 的 `/mcp` 门上被接受
    (`acceptOAuthAccessToken`),正是为了不让粗粒度的工具族 scope 溜进 REST。
  - `'guest'` 同样不可表达:`computeExecCtx` 在信封没有 `userId` 时就返回
    `undefined`,匿名 REST 调用者本来就拿不到任何上下文(随后被 `enforceAuth` 401)。
    **匿名面零变化** —— 不给匿名调用者凭空发一个 guest 上下文。

  行为差量(逐条核过,无一条改变授权结果):`explain-engine.ts` 的 guest ⇒ `EXTERNAL`
  与 `security-plugin.ts` 的 agent 分支在 REST 面仍不成立(前者的 `!context?.userId`
  前肢本就恒真,后者读 `'agent'` 标签、且真正的兜底是委托 LINK);`perf-timing.ts`
  只认 `'service'` / `'system'`,`'human'` 不开闸。唯一可观测的新增是 explain 输出里
  多回显一个 `principalKind: 'human'`(该字段在 explain schema 中本就是 optional)。

- 5897552: fix(rest): expected 4xx no longer logged as "[REST] Unhandled error" with a stack (#4886)

  Opening Studio flooded the server log with stack traces. The designer probes
  `GET /meta/:type/:name?state=draft` on every panel to decide whether to show
  "unsaved draft" state, and "no draft exists" is the overwhelmingly common
  answer — true of every artifact nobody is currently editing. `getMetaItem`
  throws a structured `{ code: 'NO_DRAFT', status: 404 }`, the client got a clean
  404 and handled it fine, but the route logged it anyway:

  ```
  [REST] Unhandled error: Error: [no_draft] No pending draft exists for app/showcase_app.
      at _ObjectStackProtocolImplementation.getMetaItem (…)  { code: 'NO_DRAFT', status: 404 }
  ```

  **45 of these in one browsing session** — by far the dominant entry in the log,
  which is how a genuine 500 goes unnoticed, and it misreports severity: nothing
  was broken.

  The metadata routes had 29 catch blocks logging unconditionally. The data
  routes already consulted `isExpectedDataStatus` / `isExpectedQueryRejection` —
  but in four different open-coded spellings across 12 sites, and
  `isExpectedQueryRejection`'s docblock records an earlier lap of exactly this
  drift (the filter and sort codes shipped without joining the list, so every
  rejection they produced was logged as unhandled too).

  Both families now decide through one predicate behind one door,
  `handleRouteError(res, error, object?)`: it resolves the response once — the
  same structured-status passthrough or `mapDataError` envelope `sendError`
  already produced — logs only when that resolved response is a genuine fault,
  then sends it. `isExpectedDataStatus` and `isExpectedQueryRejection` have no
  other callers left, so the two families cannot drift apart again.

  Expected now means an explicitly recognised client or lifecycle outcome:
  403/404/409/502/503, the client-caused 400 query-rejection vocabulary, and
  `VALIDATION_FAILED`. It deliberately does **not** mean "any 4xx" —
  `mapDataError` degrades an error it recognised nothing about to an un-coded
  400, and that bucket is where a real handler bug lands, so it stays loud.

  **No wire responses change** — every status and body is byte-for-byte what it
  was; this only decides whether the log line is printed. Two operator-visible
  log deltas beyond the metadata fix:

  - the cross-object transactional batch route judged on `status >= 500` alone,
    which also swallowed that un-coded 400 — a handler `TypeError` inside a batch
    transaction used to vanish, and now prints;
  - `updateMany` / `deleteMany` / clone / global search / the public-form routes
    stop logging normal 404s, 403s and query rejections.

- d6f3f2f: fix(rest): a hook refusal that declares its status as `statusCode` reaches the wire with that status, not `500 INTERNAL_ERROR` (#7525)

  **Observable behaviour change — read this if you alert or retry on `/api/v1/data` statuses.**
  A write refused by an engine lifecycle hook that declared an explicit status used
  to answer `500 INTERNAL_ERROR` with no `code`. It now answers the status the hook
  declared, carrying the hook's ADR-0112 `code`. Two refusals QA reproduced 2× each
  move from `500` to `409 RECORD_LOCKED` and `403 FORBIDDEN`. Monitoring that counted
  these as server faults will see a 5xx disappear and a 4xx appear, and a client
  retrying on 5xx will stop retrying a request that can never succeed.

  ## What was wrong

  `mapDataError` — the error exit for the ~11 CRUD data routes, which bypass
  `resolveErrorResponse` entirely — opened its explicit-status passthrough on
  `typeof error.status === 'number'` and nothing else. An engine lifecycle hook
  declares its status as `statusCode`:

  ```ts
  // plugin-approvals/src/lifecycle-hooks.ts
  err.code = "RECORD_LOCKED";
  err.statusCode = 409; // a pending lockRecord approval
  err.code = "FORBIDDEN";
  err.statusCode = 403; // a delegation row the caller does not own
  ```

  so the refusal never entered that branch at all. It fell past every structured
  branch, matched no message heuristic, and left through `UNCLASSIFIED_FAULT` as
  `500 INTERNAL_ERROR` — for a deliberate, well-understood business refusal, with
  the correctly-shaped original sitting in the server log. The console never hit
  the record-lock case (the affordance is disabled while a lock is live); a direct
  API caller — script, integration, second-party client — got an unactionable 500.

  **#5582 is not the fix and could not have been.** It widened this same
  passthrough's _range_ (4xx → 400-599) for producers that declared `status`. The
  loss here is one question earlier: _whether_ a status was declared at all.

  ## The fix, and why it is at the boundary

  `status` → `statusCode` → default is what **every other HTTP exit in this repo**
  already reads — `runtime`'s `HttpDispatcher.errorFromThrown` (#3867),
  `dispatcher-plugin.errorResponseBase`, `endpoint-executor`, `domains/actions`,
  `plugin-hono-server`'s user endpoints. `mapDataError` was the single exit that
  read one spelling, which is why one thrown error came back as `403` through a
  dispatcher route and as `500` through `/api/v1/data`. The gate is now a named
  `declaredHttpStatus(error)` helper asking the same 400-599 band over both
  spellings.

  Teaching the two approvals hooks to spell it `status` would have fixed two
  producers and left the boundary answering 500 for the next one — including
  `runtime`'s own `action-execution.ts` (`{ statusCode: 503 | 501 | 400 }`) and
  `metadata-protocol` (`{ statusCode: 404 }`). The hooks are unchanged.

  ## What deliberately did NOT change

  - ⛔ **`declaresServerFault`'s own read is still `status`-only.** #5811 ruled that
    a _disclosure_ rule must not depend on a producer's spelling, and that is
    untouched. This is _status resolution_, a different question, and the one call
    site inside the passthrough hands the predicate the status this boundary just
    resolved — otherwise a `{ statusCode: 5xx, code }` producer would take the 5xx
    arm and then be told it declared no fault, dropping its code.
  - **The 5xx withhold is unconditional as before.** A `statusCode`-declared 5xx
    gets `INTERNAL_ERROR_MESSAGE` plus its code; no producer prose crosses the
    boundary, and the full text still reaches the operator.
  - **A hook that declares NO status is unchanged** — still judged by the
    classifiers, still the terminal sanitised `500 INTERNAL_ERROR`. Promoting a
    bare `code` to a 4xx would be consumer-side leniency; that belongs with #7463,
    not here.
  - **The structured branches keep their precedence.** `OBJECT_NOT_FOUND`,
    `DELETE_RESTRICTED`, `VALIDATION_FAILED` and the rest still sit above the
    passthrough and still win, `statusCode` or not.
  - **`resolveErrorResponse` still reads `status` only.** It delegates to
    `mapDataError` for everything it does not pass through, so both doors already
    give one wire answer without a second copy of the two-spelling read.

  Coverage: `rest-hook-refusal-status-passthrough.test.ts` — 26 cases, including
  both reported requests walked in process on the real `PATCH /data/:object/:id`
  and `POST /data/:object` routes. Run against unmodified `main` the file is 15/26
  red; three further mutations cover the remaining 11, so no case is unfalsifiable.

- 6c87cc9: fix(data): a filter the server cannot apply is rejected, not silently ignored (#4181)

  `GET /api/v1/data/:object?filter={status:done` — one missing quote — answered
  `200` with the **unfiltered** page. The JSON-parse tolerance
  (`catch { /* keep as-is */ }`) left the raw string on `where`, a shape no
  driver consumes, so the filter was dropped whole and the response was
  byte-for-byte a successful unfiltered query. The worst failure direction in
  this family: #4134 returned nothing, #4164 dropped one predicate, this
  returned everything.

  The sibling `GET /data/:object/export` route had rejected the same input since
  it was written — the list path was the outlier. That guard now lives in the
  shared normalizer, so `GET /data/:object`, `POST /data/:object/query` and the
  runtime dispatcher all give one answer:

  - Unparseable JSON → `400 INVALID_FILTER`, naming the parameter and stating the
    filter was not applied.
  - Parses but is not a filter (`?filter=5`, `?filter="done"`, `?filter=null`) →
    same rejection; usable JSON is not a usable filter.
  - Blank `?filter=` → treated as absent, as before. No error.
  - `filter` / `filters` / `$filter` / `where` are four spellings of ONE slot.
    Sending two with **different** values used to run one and discard the rest
    silently; it is now `400 INVALID_REQUEST` (each value is a valid filter — the
    _request_ is ambiguous, so it does not share the malformed-filter code).
    Redundant identical spellings pass.
  - `orderby` on the export route gets the same treatment — a sort that cannot be
    parsed is refused rather than dropped (lower stakes than a filter: the row set
    is unchanged, but a caller taking "latest N" got an arbitrary N).

  **One wire code for one condition.** #4121 landed `400 INVALID_FILTER` for
  malformed filter _arrays_ on this same code path while this fix was in flight;
  the non-array rejections above use that code too, so a caller asking "did my
  filter run?" never has to know which branch caught it. The export route's
  filter guard moves from `INVALID_REQUEST` to `INVALID_FILTER` to match — a wire
  change on an existing route, and the reason it is worth making is that a client
  otherwise has to handle two codes for one condition depending on which URL it
  called. The route's `orderby` guard keeps `INVALID_REQUEST` (it is not a
  filter).

  **What changes for callers:** requests carrying a malformed filter now fail
  loudly instead of receiving every record. Every valid filter shape — JSON
  string, live object, `FilterCondition` AST array, and all four alias spellings
  used alone — is unaffected.

- af2a095: fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

  #4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
  #4181 / #4121) that made four field-naming read axes that either apply or fail.
  The same machine kept leaking on the remaining three, and each failure corrupted
  something the closed axes never touched:

  ```
  search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
  groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
  sum(no_such)                       -> 200  0 — indistinguishable from a real zero
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `POST /data/:object/query`, the export route and the runtime dispatcher give
  one answer instead of four.

  - **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
    flipped outward: the engine dropped unknown names and, when that emptied the
    override, fell back to the FULL searchable set — so a parameter that exists
    only to narrow a search widened it, and it changed which ROWS came back, not
    just which columns. Its only in-framework caller is `GET /data/:object/export`
    — the route whose `search` support just shipped so exports would stop
    downloading "the unsearched superset … in a file that looks authoritative";
    a typo'd `searchFields` did exactly that, one parameter over. Three causes,
    three messages, because the fixes differ (the split #4226 drew on expand): a
    name that is no field is a request typo; a REAL field outside the searchable
    set needs the object changed (its message names the declared
    `searchableFields` or the auto-default's type rule, whichever applies); and
    a `searchableFields` entry that names no field is a STALE DECLARATION — a
    bug on the object, called out as such because clients (objectui's list
    search) echo the declaration verbatim. The allowed set is resolved by the
    same `@objectstack/spec/data` function the engine's search expansion
    consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
    cannot drift from what search actually scans.
  - **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
    an unknown column as `null` for every row, so all rows landed in ONE bucket
    whose count is the true row count — structurally perfect, identical to "this
    column really holds a single value". A chart draws one bar; nothing says the
    grouping never ran. Native SQL aggregation errors on the same input, so which
    backend a deployment sits on decided the answer — the "two routes, opposite
    answers" split, one axis over.
  - **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
    `undefined` to `0` — the exact number an empty quarter produces, in reports
    whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
    way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
    field-less form and passes.
  - **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
    standard-catalog code that had no emitter since it was written, like
    `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
    function or `dateGranularity` outside the spec enums, a missing `alias`: each
    slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
    computed a silent placeholder (`null` results, a column keyed `"undefined"`,
    one bucket per raw value under an unknown granularity).

  Tiering is unchanged from #4226: registry + field map present → authoritative;
  no registry / no field map / legacy array field map → the NAME gates skip (shape
  gates still apply — they need no schema). The engine's own tolerance is
  untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
  directly are unaffected. `@objectstack/rest` also stops logging
  `INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
  "[REST] Unhandled error" — they are client mistakes the response already
  explains, as `INVALID_FIELD` always was.

  Requests that name real fields are unaffected.

- dd5daac: fix(data): reject unknown list query parameters instead of reading them as zero-matching field filters (#4134)

  `GET /api/v1/data/:object` reads any parameter it does not reserve as a
  field-level equality filter — that is what makes `?status=done` shorthand for
  `?filter={"status":"done"}`. When the name matched **no** field the resulting
  predicate could only ever match nothing, so `?pageSize=5` on a 10-row object
  returned `200` + `total: 0`: structurally valid, and indistinguishable from
  "this object is empty". The write path already rejected the same unknown name
  loudly (`400 INVALID_FIELD`), so one piece of knowledge — does this field
  exist — was enforced on write and silently zeroed on read.

  The read path now answers the same way, in the same envelope:

  ```json
  {
    "error": "Unknown field 'pageSize' on object 'showcase_task'. Query parameters that are not reserved are read as field filters, so an unknown name can only match zero records. Did you mean the 'top' query parameter (OData spelling '$top')?",
    "code": "INVALID_FIELD",
    "field": "pageSize",
    "object": "showcase_task"
  }
  ```

  The rejection carries a suggestion — the canonical parameter for a known
  dialect (`pageSize` / `perPage` / `page` / `sortBy` / `q` → `top` / `skip` /
  `sort` / `search`), or the closest real field name when it reads like a typo —
  and fires whether or not an explicit `filter` rode along, so the failure never
  depends on which other parameters were sent.

  **What changes for callers:** a request sending a parameter that names no field
  now gets a `400` where it used to get an empty `200`. Page size is `top` /
  `$top` / `limit`; page offset is `skip` / `$skip` / `offset`. Every documented
  parameter, every `$`-prefixed OData alias, and the full `QueryAST` body of
  `POST /data/:object/query` are unaffected. An object with a field named after a
  reserved parameter (`count`, `cursor`, `object`, `top`, `search`, …) filters it
  through the explicit form: `?filter={"count":3}`.

- 2efd2c9: `GET /api/v1/meta/:type/:name/published`: resolve from the published store, not the code/package snapshot

  The REST transport carried the same defect the dispatcher fixed for
  `/meta/:type/:name/published`: an item published at runtime — authored as an
  ADR-0027 draft and promoted via `POST /packages/:id/publish-drafts` — answered
  `404` here, while the ordinary read `GET /api/v1/meta/:type/:name` served it.
  The route and the publish path shared no store:

  - **the write** flips the artifact's `sys_metadata` row `state:'draft' →
'active'` (`publishPackageDrafts` / `promoteDraft`);
  - **the read** resolved only through `metadata.getPublished`, which reads the
    row-local `publishedDefinition` key that `MetadataManager.publishPackage`
    writes into its own in-memory registry — the ADR-0016-era package publish.

  So the 404 was a false statement about an item that IS published, on the
  transport that actually serves the cloud runtime. ADR-0027 (E)(5) defines
  sealing a publish as exactly that `draft → active` flip;
  `SysMetadataRepository` names `'active'` "the published, live overlay"; and
  ADR-0033 §2 routes every runtime authoring write into that same ADR-0027 draft.
  The `active` overlay row is therefore the authoritative answer to "what is
  published", and both route arities — `/meta/:type/:name/published` and
  `/meta/:type/:section/:name/published` — now consult it first.

  The overlay is read through `getMetaItemLayered`, whose overlay layer is a
  strict `state:'active'` lookup reported separately from the code layer. That
  separation is what the fix rests on:

  - a **runtime-published** item is served, and served the published body;
  - a **draft-only** item is still `404` — the overlay lookup never reads a draft,
    so a pending edit is not served as published;
  - a **code-published** item is untouched: a null overlay is positively "no
    runtime-published row" and falls through to the existing `getPublished` path,
    which answers byte-identical bytes.

  Unchanged on purpose: `404` on this route continues to mean "no such item"
  rather than "exists but unpublished" — an existing item that was never published
  still answers `200` with its current definition, which is `getPublished`'s
  documented fallback and a different fact from absence.

  Two deliberate differences from the dispatcher twin:

  - **No organization scoping.** `packages/rest` carries no
    `resolveActiveOrganizationId` and no org plumbing at all — the same seam
    `package-routes.ts` already names at its `deletePackage` call. The read
    resolves the env-wide (`organization_id: null`) overlay row, which is
    symmetric with what an org-less `publishPackageDrafts` writes.
  - **A metadata-store outage stays a `503`.** `getMetaItemLayered` throws
    `SERVICE_UNAVAILABLE` when an overlay read that would decide a layer did not
    happen (the benign "table not provisioned yet" case returns normally with a
    null overlay). That throw is re-raised rather than swallowed, so an
    availability failure is never answered as `404 Not found`.

- f3f855a: Refuse a repeated single-valued query parameter instead of silently answering the wrong thing (#6877)

  `IHttpRequest.query` is declared `Record< string, string | string[] >`, and the array
  arm is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
  through as `['1','2']`, measured over a socket). `rest-server.ts` read ~50 of its
  query parameters as if the union had one arm, so a repeated parameter was coerced
  into a _different_ value and served with a `200` rather than refused. None of it was
  a type error — every site laundered the array through `any`, `String()` or
  `Number()`.

  Two of the outcomes were inversions rather than degradations:

  - `PUT /meta/:type/:name?force=false&force=false` — the read fell through to
    `!!forceRaw`, and a non-empty array is truthy, so repeating an explicit **opt-out**
    switched the destructive-change guard **on**.
  - `GET /data/:object/export?limit=1&limit=2` — `Number([...])` is `NaN`, `NaN || 0`
    is `0`, `Math.max(1, 0)` is `1`: a **one-row export**, `200 OK`.

  Each affected handler now declares which of its parameters are single-valued, and a
  repeated one is refused with `400` and the ADR-0112 nested envelope
  `{ error: { code: 'VALIDATION_ERROR', message } }` — the same rule and message
  #6307 landed on `/api/v1/packages/:id`, now shared rather than duplicated. The rule
  counts occurrences, not values: a one-element array is one occurrence and is
  accepted (and unwrapped), an empty array is none, two identical values are still two.

  **Wire-visible**: requests that used to receive a wrong `200` now receive a `400`.
  No well-formed single-value request changes in any way.

  Parameters that are genuinely multi-valued are deliberately untouched and pinned by
  tests — `select` / `expand` on `GET /data/:object/:id` (whose consumer takes
  `string | string[]` by design), `objects` on `/search`, `fields` / `searchFields` on
  the export route, and `approverId` on `/approvals/requests`.

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

- 91ec1ea: fix(rest): an unclassified route error answers a sanitised 500, not a 400 (#5489)

  **升级须知 — 状态码行为变化。** `@objectstack/rest` 的错误映射 `mapDataError`
  在所有分类分支都不匹配时,原先的终局兜底是
  `{ status: 400, body: { error: <原始 message> } }`。这一支现在改为一个消毒过的
  服务端故障信封:

  ```
  500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
  ```

  **为什么。** 400 的语义是「你请求错了」——SDK、fetch 封装、代理和重试策略都据此
  判定「不要重试,调用方得改点什么」。而真正落到这一支的错误恰恰相反:元数据存储
  读不到时 `matchEndpoint` 按契约抛错(它抛就是为了让 outage 不伪装成「没有声明
  任何 endpoint」,ADR-0110 D3),或者干脆是处理器自身的 `TypeError`。两者调用方都
  修不了,且都**应该**重试。实测:`GET /api/v1/meta/api` 对着一个抛
  `Error('metadata store unreachable')` 的存储,返回 HTTP 400。

  同时,原始 message 是逐字下发的——而这偏偏是全文件里最没有证据表明可以下发的一
  条路径:走到这里的前提就是 `looksLikeInternalErrorLeak` 什么都没匹配上,而
  #5462 已经记过「关键词启发式沉默不等于安全」。实测到的一例:一个声明了
  `status: 502`、message 为 `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)`
  的错误,经由数据路由直接调用 `mapDataError` 时,以 400 携带主机与端口下发。
  沿用 #5464 的纪律:原文进服务端日志,不进客户端(500 不在
  `isExpectedDataStatus` 内,`handleRouteError` 会打印完整错误对象)。

  **真正的客户端错误一个都没有改变。** 改动前先做了测绘:给这一支加桩,跑完
  `@objectstack/rest` 全套(48 文件 / 719 用例),落到这一支的只有 6 个错误——本单
  的存储 outage、两个 502 的 ECONNREFUSED、三个 `TypeError`,没有一个是客户端
  错误。历史上唯一骑在这条兜底上的客户端错误家族(driver-sql 无法编译的 filter
  拒绝)已由 #4436 在**生产者侧**声明 `status: 400` + `INVALID_FILTER` 迁走。
  validation / permission / unknown object / unknown field / not-null 漂移 /
  unique 冲突 / 沙箱业务拒绝等全部仍由各自分支给出原本的 4xx。

  **`INTERNAL_ERROR` 而非 `DATABASE_ERROR`。** #5462 的 `DATA_STORE_FAULT`
  (`500 DATABASE_ERROR`)用在证据**指名**了存储故障的地方(驱动的 missing-relation
  措辞、`looksLikeInternalErrorLeak` 命中);而这一支的定义性事实是「没有任何证据」,
  把处理器的 `TypeError` 报成 `DATABASE_ERROR` 会把运维指向一个其实健康的数据库。
  `INTERNAL_ERROR` 是 `standardErrorCodeForHttpStatus(500)` 的取值
  (`@objectstack/spec` 的 `HttpStatusErrorCodeMap`)——目录自己为「500 且无更具体
  code」定义的下限,不是第三套措辞;message 复用的也是
  `resolveErrorResponse` 声明式 5xx 分支已在用的 `INTERNAL_ERROR_MESSAGE`。

  **如果你的客户端把这条兜底当 400 处理过**:它现在是 5xx,可以重试;若你有生产者
  依赖「不声明 status 即可把 message 原文送达调用方」,请改为在抛出点声明
  `status` 与 `code`(契约优先),那是唯一仍会把措辞交给调用方的路径。

- 2d25303: fix(rest): 联合类型分支里的拒绝理由现在能到达调用方,不再只剩 `Invalid input` (#5014)

  zod 会把一个失配的 `z.union([...])` 折叠成**一条**顶层 `invalid_union` issue,它自己的
  `message` 是裸的 `"Invalid input"`;每个分支真正的抱怨——包括 #4001 那批 `strictObject`
  写下的处方文案——躺在 `issue.errors` 里(每分支一个数组)。`zodIssuesToFields` 过去只映射
  顶层 issue,于是 `POST /api/v1/data/:object/query` 对着
  `{"search": {"fields": ["name"]}}` 只回一条

  ```
  { "field": "query.search", "code": "invalid_shape", "message": "Invalid input" }
  ```

  ——说清「缺的是 `query` 这个键」的那句话被生产出来,然后被丢掉。同一个坑在
  `QuerySchema.groupBy` 的联合分支上一样:`dateGranularity` 写错值,作者拿不到那份
  「可选 day/week/month/quarter/year」的清单。

  现在 `fields[]` 会在联合条目**之后**追加解释它的分支条目,`field` 用分支路径拼上联合自身
  的路径(`query.search.query`),`code` 照常走 ADR-0114 D3 的目录映射——所以缺键报
  `required` 而不是 `invalid_type`(这一判定要走绝对路径去读入参,分支路径是相对的)。

  分支选择策略直接沿用 #4971 给 CLI/spec 侧 `formatZodError` 落的那一套:只报根部
  KIND 不匹配的分支整支丢弃(全部如此则不展开,输出和以前逐字一致);剩下的**报得最少的
  分支胜出**——这条是防止「一个拼错的键被 N 个分支各报一遍」的机制本身;`unrecognized_keys`
  破平局;声明顺序破剩下的;真正并列的分支全部输出(上限 3 条);跨分支重复的相同结论只
  出现一次;嵌套联合按绝对路径递归,深度上限 3。两侧必须给出**同一个判定**,否则同一个错误
  从终端发布和从 API 提交会得到两套说法。

  对 wire 而言这是**纯追加**:原有的每一条 `fields[]` 条目——包括联合自身那条——`field` /
  `code` / `message` 和相对次序都不变,新条目插在它解释的那条之后。信封形状仍与
  `mapDataError` 同形(ADR-0114),数组长度从来不是契约的一部分。

- b03b0e1: refactor(rest): retire the public lookup route's `picker.sort` read (#7485)

  `GET /forms/:slug/lookup/:field` composed its query with
  `sort: picker.sort ?? [{ field: displayFields[0], order: 'asc' }]` — a fifth
  read of the `publicPicker` block that #7467's declaration enumerated four keys
  for (`displayFields`, `maxResults`, `filter`, `object`). `sort` was in neither
  the schema nor the enumeration, so it sat in exactly the state ADR-0049 calls
  the mirror-gap: **enforced by the route, declarable nowhere.** The strict block
  (ADR-0089 D3a) rejects a form authoring `publicPicker.sort` with
  `unrecognized_keys`, so no form written since #7467 has ever reached the read.

  The maintainer ruled **retire the read** rather than declare the key: `sort` has
  zero measured pull, and declaring it would mean permanently maintaining one more
  public knob on an **unauthenticated** search surface. Ordering is now fixed —
  the first `displayFields` entry, ascending — and is the only behavior.

  **Impact.** None for any form that parses today: the read was unreachable
  through the authoring path. A row persisted before #7467 declared the block
  (never validated by `ViewMetadataSchema`, so it can carry a `sort` the schema
  would refuse now) is **ignored, not an error** — the route reads past it and
  answers 200 with the fixed ordering, pinned in
  `packages/rest/src/public-form-lookup-picker.test.ts`. If custom ordering is
  ever wanted here, the declare fork on #7485 re-runs then; it stays cheap.

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

- cc3555e: Mount five ledgered-but-dead routes, and gate the class that hid them (#7526)

  Three routes shipped in the ledgers, implemented in the dispatcher, and mounted
  by nobody. Two of them answered a plausible `200` rather than a 404, which is
  worse: `GET /meta/types` fell into the `/meta/:type` catch-all and returned
  `{"type":"types","items":[]}`, shape-identical to `/meta/zzz_not_a_type`, and
  `GET /meta/:type/:name/published` fell into the compound-name route and
  returned a stub identical before publish **and for a name that does not exist**
  — a route that structurally could not 404. `GET /meta/objects/:name/state/:field`
  was the honest one: REST's `/meta` registrations topped out at three path
  segments and it needs four, so it answered Hono's `notFound`. All three now
  mount, `published` 404s for a bogus name, and the compound-name arity the SDK
  documents (`getPublished('lead', 'views/all_leads')`) mounts with it.

  The routes were the symptom. The route ledgers are a DECLARATION and every
  guard built on them (#3563 / #3587 / #3636 / #3642) reads that union as an
  OBSERVATION of what is mounted, so the whole audit chain was green on this
  class by construction — `/meta/objects/:name/state/:field` counted as mounted
  because it was ledgered. This adds the missing observation: a route-ledger ↔
  live-mount parity gate that boots a real server, reads the mount table off it,
  and asserts both directions — every ledgered route reachably mounted, every
  mounted route ledgered. It never consults a second hand-written list of what is
  mounted, and it PROBES reachability through the live router rather than
  checking presence in a table, because a literal route registered after a
  catch-all sibling is mounted and unreachable.

  `IHttpServer` grows two optional, feature-detected members for it —
  `getMountedRoutes()` (the live mount table, in registration order) and
  `resolveMountedRoute(method, path)` (which registration answers a concrete
  request, per the router itself) — implemented by the Hono adapter.

  The gate found three more instances of the same class on its first run:
  `GET /automation/actions`, `/automation/connectors` and `/automation/_status`
  were ordered ahead of the `/:name` catch-all inside `dispatch()`, with a
  comment saying the order was load-bearing, while the bridge that actually
  mounts `/automation` registered `/:name` and never those three. They now mount.
  It also found the unledgered live mounts: the four `/api/settings` routes get a
  ledger of their own, and `GET /.well-known/objectstack` and the object-less
  `POST /actions//:action` get rows in the dispatcher ledger.

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- ea936f3: fix(plugin-reports): `DELETE /api/v1/reports/schedules/:scheduleId` stops telling a caller whether a schedule id exists

  `DELETE /api/v1/reports/schedules/:scheduleId` answered differently depending on
  whether the target id **existed**, which let any authenticated caller enumerate
  other owners' report schedules by probing ids and reading the status code:

  | Target                              | Before                 | After                              |
  | ----------------------------------- | ---------------------- | ---------------------------------- |
  | Another owner's schedule id         | `404 REPORT_NOT_FOUND` | `404 REPORT_NOT_FOUND` (unchanged) |
  | A schedule id that does not exist   | `204 No Content`       | `404 REPORT_NOT_FOUND`             |
  | A schedule whose report row is gone | `404 REPORT_NOT_FOUND` | `404 REPORT_NOT_FOUND` (unchanged) |
  | Your own schedule                   | `204 No Content`       | `204 No Content` (unchanged)       |

  This is the same defect #7523 closed on the sibling `DELETE /reports/:id`, in the
  costume that card explicitly warned about: there the split was 500-vs-204 and
  loud, here it was 404-vs-204 and read as correct. The route was in fact cited by
  #7523's investigation as the example of the _right_ shape, because it does route
  its catch through `handleValidation` — which is why the cross-owner arm is a
  clean 404 rather than a 500. Only the cross-owner arm was ever probed (QA run
  #7515); the unknown-id arm was not, so the surviving half went unseen and
  `packages/rest/src/rest.test.ts` pinned its `204` green.

  `ReportService.unscheduleReport()` carried the intent — _"others get a not-found
  so the delete neither fires nor reveals the schedule's existence"_ — and a hole
  one line wide above it: `if (!schedule) return; // idempotent`. Idempotence is
  only harmless where every caller may see the row; with a cross-owner arm that
  throws, resolving quietly _is_ the tell.

  Both deny arms are now one decision, taken before the delete fires, by the
  predicate already blind to the difference between them: `canAccessReport` is
  false for a schedule that does not exist, for one whose report is gone, and for
  one owned by somebody else alike. A single throw site means a single message, so
  the route's single `handleValidation` call emits a single response — status and
  body cannot drift apart.

  Unlike `deleteReport`, this could not be pre-empted in the route. That one
  collapses its arms with `getReport()`, which is already blind to the same
  difference (#2980); the caller here presents a `scheduleId`, and `IReportService`
  exposes no by-id schedule read to be blind with (`listSchedules` is keyed by
  `reportId`). The blinding therefore lives in the service, and
  `IReportService.unscheduleReport` now states it as a contract obligation rather
  than leaving each implementation to rediscover it.

  Deleting a schedule you own still answers `204`. Deleting one you cannot see is
  now `404` instead of a silent `204` — the cost of closing the oracle, and in line
  with the cross-owner GET / run / upsert-overwrite / delete arms, which all
  already answer 404. A system/dispatcher context deleting an id with no row now
  gets `REPORT_NOT_FOUND` too, where it previously resolved; no caller in the repo
  relies on that (the route is the only production caller).

  Tests assert the two deny arms' responses are **EQUAL** rather than pinning each
  arm's status separately, so the plausible half-fix cannot pass through them — a
  mutation that answers both arms 404 with different bodies leaves every per-arm
  status assertion green and turns the equality assertions red.

- 69ac82c: fix(metadata-protocol,rest,spec): derive `capabilities.search` from what serves `/search`, not from an empty service slot (#7541)

  Every REST host advertised `capabilities.search = { enabled: false }` in
  `/discovery` while `GET /api/v1/search?q=…` answered `200` with real hits. This
  is Prime Directive #10 inverted: not an advertised endpoint that 404s, but a
  live endpoint **no conforming client will ever call**, because the document
  whose only job is to say what is available said it was not.

  **Two producers, two unrelated predicates.** The capability bit came from a
  registered `search` service slot (`registeredServices.has('search')`), while the
  route refused on something else entirely — `registerSearchEndpoints` returns
  `501 NOT_IMPLEMENTED` exactly when `typeof protocol.searchAll !== 'function'`.
  Nothing in either repository registers that slot (`CORE_SERVICE_PROVIDER`
  records this, verified), and the protocol implements `searchAll`
  unconditionally, so the two answers were not merely capable of disagreeing —
  they disagreed on every host that exists.

  `search` was the last well-known capability still on bare slot presence. Its
  neighbours were moved onto serveability with the rule stated in the builder —
  _"the predicate is deliberately the SAME one that decides whether the route is
  advertised — what we advertise and what we claim cannot disagree"_ — most
  recently `chunkedUpload` in #5672. This brings `search` onto that footing: **one
  predicate, both ends.**

  - `@objectstack/metadata-protocol` — `capabilities.search` is now
    `typeof this.searchAll === 'function'`, the route's own refusal predicate.
  - `@objectstack/rest` — the `/discovery` producer ANDs that with
    `api.enableSearch`, the flag that decides whether this server mounts the route
    at all. Exactly the two-layer conjunction `transactionalBatch` already uses
    with `api.enableBatch`: the protocol states what it can serve, the server
    states what it mounted, and a deployment that opts out reports `false` rather
    than promising a 404. Nothing was added to the route itself.

  **`services.search` is unchanged, and deliberately so.** The slot answers a
  different question — `CoreServiceName` declares it "Search Engine
  (Elastic/Meili)" and `ISearchService` is an index/query contract — so it still
  reports _which engine occupies the slot_, while the capability reports _whether
  the surface is served_. On an ordinary host those now differ
  (`capabilities.search.enabled: true` beside `services.search.status:
'unavailable'`), and both statements are true. So that the two halves of one
  document do not read as contradicting each other, `@objectstack/spec` gives the
  slot a `REMEDY_DETAIL` sentence — the same treatment `ui` carries for the same
  shape (#4146) — which keeps the unchanged "no implementation ships" fact and
  adds which question the entry answers. The `status` itself stays
  `unavailable`: no engine is registered, and saying otherwise would be the
  original defect pointed the other way.

  **Client impact.** A client that gated its search UI on
  `capabilities.search.enabled` was hiding a working feature on every deployment;
  it now sees `true` wherever the endpoint really serves, and `false` when the
  protocol cannot search (route `501`) or the server did not mount it (`404`).

- 422e97b: fix(rest): one error envelope across the three `/security/suggested-bindings` routes (#7981)

  `registerSecurityEndpoints` answered **three mutually incompatible error
  envelopes**, decided only by which arm refused — on three routes a single client
  calls in sequence (list → confirm / dismiss):

  | arm                                                           | shape                                                  |
  | :------------------------------------------------------------ | :----------------------------------------------------- |
  | validation refusals (repeated query param, unknown `?status`) | `{ error: { code, message } }` — ADR-0112              |
  | security service not registered (`respond501`)                | `{ code, message }` — no `error` wrapper at all        |
  | thrown service error, 403 / 404 / 409 / 500 (`handleError`)   | `{ code, error: '<message>' }` — `error` a bare string |

  So `body.error.code` — the one position [ADR-0112](docs/adr/0112-error-code-vocabulary-and-ledger.md)
  D5 declares for the semantic code — read `undefined` on two arms out of three,
  and the two it failed on include the one carrying the typed `PERMISSION_DENIED`
  403 / `SUGGESTION_NOT_FOUND` 404 / `SUGGESTION_STATE` 409 codes the routes' own
  docblock advertises, i.e. the arm a consumer is most likely to branch on. None of
  the three was wrong on its own; they were wrong as a set, which is the class no
  per-arm review catches.

  All three now emit the ADR-0112 body `{ error: { code, message } }` through one
  shared helper, so "the arms agree" is a property of the code rather than of three
  literals that happen to match. The bare-string `error` is specifically the dialect
  retired from this file's `/meta` 501 refusals in #7035; this finishes that
  convergence for the security family. The shape is taken from the sibling arm in
  the same file rather than re-derived from the ADR, so the region converges instead
  of acquiring a fourth reading.

  **This is a wire shape change, and the bare-string `error` field is its
  wire-visible half.** A caller that read `body.error` as a human-readable string on
  a 403 / 404 / 409 / 500 from these three routes now finds an object there, with
  that text at `body.error.message`; a caller that read the semantic code at the
  top-level `body.code` now finds it at `body.error.code`. Neither the codes
  themselves nor any HTTP status moves — `NOT_IMPLEMENTED` and `VALIDATION_ERROR`
  remain the standard catalog's members for 501 / 400, the thrown arm still passes
  the service's own `err.code` through, and nothing in `packages/spec` changes.

  Unchanged: every success path (200 with `{ data }`), the 501 duck-type check on a
  security service that predates this surface, the status→arm mapping, and the
  500-character cap on an unexpected fault's message.

- 7e04fd0: fix(rest): one error envelope across the `/security/explain` pair (#8073)

  `registerSecurityExplainEndpoints` — `GET/POST /api/v1/security/explain` and
  `GET /api/v1/security/my-delegable-scope` — answered two retired dialects across
  its eight refusal arms: the 401 / 501 / 400 / 403 arms were flat
  `{ code, message }`, and the two 500s were `{ code, error: 'a bare string' }`. So
  `body.error.code`, the one position ADR-0112 D5 declares, read `undefined` on all
  six — while the immediately adjacent registrar (`/security/suggested-bindings`,
  converged in #7981) already answered the declared shape. A client calling
  `explain` and then `suggested-bindings` met two envelopes inside one `security`
  family.

  Every arm now emits `{ success: false, error: { code, message } }` through the
  shared `sendError` from `@objectstack/types` — the same builder every conformant
  route module writes through — so the family agrees by construction rather than by
  eight literals happening to match. The 400 arm's Zod-issue dump moves from a
  top-level `detail` sibling to `error.details`, the slot `ApiErrorSchema` declares
  for structured context.

  No status code moves, and no code VALUE changes: `UNAUTHORIZED`,
  `NOT_IMPLEMENTED`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `EXPLAIN_FAILED` and
  `DELEGABLE_SCOPE_FAILED` are all already registered, so nothing in
  `packages/spec` moves. `ObjectStackClient` reads both envelopes' declared spots
  (`errorBody?.code ?? errorBody?.error?.code`, and a bare-string limb for the
  message), so `client.security.explain()` and
  `client.security.describeDelegableScope()` keep throwing identical `err.code` and
  `err.message` — re-measured against these call paths rather than inherited from
  #7981. `err.details` does change on refusals, from "the whole response body" to
  the structured slot or the new body.

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

- e474853: fix(security): `sys_session.token` stops serializing on the data API — `internal: true`, with the write-response strip relocated to the generic-data-path ingress (#7823)

  <!-- adr-0087: not-required (no-migration-prescription) One field-level flag added
  to one existing declaration, plus an internal relocation of where that flag's
  write-response half is enforced (engine write sites → the metadata-protocol
  ingress). Nothing authorable is renamed, retired or tombstoned, so there is no
  conversion to register. The behavioural changes are that a field which already
  DECLARED it was never exposed stops being exposed, and that better-auth's
  session-lifecycle routes keep working while it does. -->

  `sys_session.token` — the **live bearer credential** for an active session —
  declared `description: 'Opaque session token — never exposed in UI'` and then
  serialized anyway on the generic data path.

  **Scope the persona precisely: this is an ADMIN-CROSS-USER disclosure**, not an
  any-authenticated-caller one. Measured on a real engine (`bootStack(showcaseStack)`,
  in-process HTTP + sqlite-wasm):

  - **admin**, `GET /data/sys_session` (list) — 200, `token` present on every row,
    the admin's own **and every other user's**;
  - **admin**, `GET /data/sys_session/{another user's id}` — 200, that member's
    token verbatim;
  - **admin**, `?select=id,token` — 200, present;
  - anonymous — 401, fully denied;
  - member — self-scoped reads only, and a cross-user get-by-id still answers
    **404**: the `sys_session_self` RLS policy was already holding that line and
    is untouched here.

  **Why this is more than exposure.** The sibling column closed by #7728
  (`sys_api_key.key`) is a stored SHA-256 hash. This one is not: the disclosure was
  **replay-proven** — a member's token, taken exactly as it came back to the admin
  off the data API, authenticates as that member when sent as
  `Authorization: Bearer <token>`. So the defect was admin-to-member
  **impersonation**, and any admin-adjacent read (an integration, a leaked admin
  API response, a support tool) inherited it.

  **The fix is one declaration plus one relocation** (maintainer ruling
  2026-08-13, "A-prime + compose"):

  - `sys_session.token` is declared `internal: true` — the opt-in,
    type-independent flag minted by #7728 meaning _the declared value is never
    returned on the generic data path_. The engine's READ-path strip is
    unchanged and closes the disclosure.
  - The flag's **write-response** half moves out of the engine's insert/update
    result paths — where it conflated "never on the generic data path" with
    "never returned to the engine-level writer" and broke `signIn`/`signUp`
    (better-auth reads the minted session row back off the insert result) —
    into the **generic-data-path ingress**: every `*Data` write face in
    `@objectstack/metadata-protocol` routes its response records through the
    single exported helper `omitInternalFieldsFromWriteResponse`, held there by
    a tripwire test that enumerates the ingress surface and fails on any face
    the sentinel reaches (or any new `*Data` face with no recipe). The
    `sys_api_key.key` PATCH-body closure (#7728's fourth surface) is preserved
    at the ingress, byte-for-byte for callers. `@objectstack/rest`'s
    cross-object batch update — the one write mouth outside the protocol —
    applies the same shared strip.
  - better-auth's session-lifecycle readbacks (revoke-other-sessions,
    sliding-expiry refresh, expired-session cleanup) read `token` back off
    adapter find results, which the read strip starves — measured:
    `POST /auth/revoke-other-sessions` answered `200 {"status":true}` while the
    other session kept authenticating. The adapter now re-attaches the token
    through `Engine.resolveInternalField` (#8118's privileged batch accessor) —
    no engine carve-out, no second accessor. Plain bearer validation never
    needed the readback and is untouched.

  `hidden: true` was never the broken contract (spec defines it as "Hidden from
  default UI", never as "stripped from serialization"); the broken contract was the
  field's own description.

  **Not retyped, deliberately.** `Field.secret` would encrypt at rest and replace
  the column with a `sys_secret` ref, destroying the by-token session lookup
  better-auth performs on every authenticated request — it would break
  authentication in order to fix a disclosure. `Field.password` is inert here: the
  read mask skips `password` on `managedBy: 'better-auth'` objects, and it collects
  by **TYPE** regardless, which a `text` column never satisfies. Two independent
  barriers, so the column stays `text`.

  **Storage, filtering and indexing are untouched** — the strip runs on the rows the
  driver has already produced, after the predicate has been evaluated and the unique
  index on `token` used. The regression proof drives both directions: sessions still
  mint, the minted bearer still authenticates (`GET /auth/get-session` ⇒ 200), a
  `where: { token }` lookup still resolves the row server-side while that same row
  comes back with no `token` key, and revoke-other-sessions / expired-session
  cleanup are pinned on the ROW they act on, not the status code that lied.
  Without those, a change that simply broke authentication would satisfy every
  "absent" assertion.

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

- 5326b36: fix(rest): one error envelope across the record-sharing family (#8111)

  `registerSharingEndpoints` — `GET/POST /data/:object/:id/shares` and
  `DELETE /data/:object/:id/shares/:shareId` — answered two retired dialects across
  its nine refusal arms: the 501 was flat `{ code, message }`, and the five mapped
  verdicts (400 / 403 / 404 / 409 / 422) plus the three verb-specific 500s were
  `{ code, error: 'a bare string' }`. So `body.error.code`, the one position
  ADR-0112 D5 declares, read `undefined` on all nine — while the adjacent
  `/security` registrars, converged in #7981 and #8073, already answered the
  declared shape.

  Every arm now emits `{ success: false, error: { code, message } }` through the
  shared `sendError` from `@objectstack/types` — the same builder every conformant
  route module writes through — so the family agrees by construction rather than by
  nine literals happening to match.

  No status code moves and no code VALUE changes. One code did change status in the
  REGISTRY rather than on the wire: the 409 arm's `CONFLICT` was registered in
  neither `StandardErrorCode` nor `ERROR_CODE_LEDGER`, so `ApiErrorSchema` — whose
  `code` is a closed enum — would have rejected that body. It is now registered
  under `@objectstack/rest`, keeping the emitted value byte-identical; consolidating
  it onto the standard catalog's `RESOURCE_CONFLICT` would change what clients read
  and is filed separately for the maintainer.

  The `CODE:` message prefix the service uses to signal its verdict is untouched: it
  is a server-internal service→REST derivation, stripped before the response is
  written and never present on the wire, so no consumer can read it (censused at
  claim). `ObjectStackClient` reads both envelopes' declared spots
  (`errorBody?.code ?? errorBody?.error?.code`, and a bare-string limb for the
  message), so `client.shares.list()`, `.grant()` and `.revoke()` keep throwing
  identical `err.code`, `err.message`, `err.httpStatus`, `err.category`,
  `err.retryable` and `err.fields` — re-measured against these call paths rather
  than inherited from #7981 or #8073. `err.details` does change on every refusal:
  its last fallback is the whole response body, and the body is what moved.

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

- 1216dcc: fix(rest): sweep the REST composition root's slot lookups — 16 sites typed (#4251 B4)

  Batch B4 of the #4251 sweep: every service-lookup erasure in the REST
  composition root. `rest-api-plugin.ts` (15) and `external-datasource-routes.ts`
  (1) now pass the slot's contract type instead of annotating the result `any`;
  the ratchet baseline drops **159 → 143 sites, 34 → 32 files**, and both files
  leave the grandfather list. No behaviour change.

  **Every contract named here is evidenced by an `implements`.** `email`,
  `sharing`, `sharingRules`, `reports`, `approvals` and `external-datasource` had
  a written `packages/spec` contract all along, and the class each provider
  registers into the slot declares `implements` on it (`EmailService implements
IEmailService`, `ExternalDatasourceService implements IExternalDatasourceService`,
  …). So the compiler verifies the shape on the producer side on every build and
  this file only has to name it — the #4404 discipline that replaced seven
  unchecked local stand-ins with one checked claim. `auth`, `objectql`, `i18n`,
  `analytics`, `security` and `metadata` come from the `ServiceSlotContracts`
  ledger; `objectql` is `IObjectQLEngine`, not `IDataEngine`, because the consumer
  reaches the full engine (the `transaction` probe behind the batch routes).

  **The wrapper return annotations went with them.** Ten of these lookups sit
  inside `async (environmentId?) => Promise<any | undefined>` providers, and
  typing only the lookup would have re-erased the contract one line later — the
  KNOWN RESIDUAL shape the rule documents and cannot see. Each provider now
  returns its slot's contract.

  **Three slots have no contract, and say so three different ways rather than one
  `any`.** `env-registry` is typed as `RestEnvRegistry`, the shape `RestServer`'s
  own constructor declares for that parameter, so the argument is checked rather
  than waved through. `settings` gets a named local surface (`SettingsReadSurface`)
  following B2's decision for this slot — `service-settings` is optional, so the
  REST layer must not depend on it — carrying the one method the platform consumes
  (`get`, through `resolveLocalizationContext`'s cascade) with the public
  `ResolvedSettingValue` as its return type. `default-project` gets a narrow slice
  declaring only the field this file reads. And the service-existence probe, whose
  slot name is a runtime argument, is `unknown`: it asks whether something
  occupies the slot and never touches its shape, which is exactly what `unknown`
  says and `any` does not.

  **No dead probe this batch — reported rather than implied.** Every earlier batch
  in this line found one (#4361's `getMetaItem` on a service that never had it,
  #4321's `registerInMemory`), so each probe the typed consumers make was checked
  against its contract: `emailService.send`, `authService.getApi` /
  `isAuthGateActive`, `svc.queryDataset`, `ql.transaction`, the six approval
  verbs, the five security methods and the five federation methods all name real
  members at real arities. The `external-datasource` route probes are now visibly
  redundant-but-correct — the contract's methods are required, so `svc?.method` is
  truthy whenever the service resolved, and the 503 path is reached only by the
  service being absent, which is what it is for.

  The new pin is a runtime test, deliberately. `packages/rest` excludes its test
  files from `tsconfig.json` and declares no `typecheck` script, so no tsc program
  compiles them and a type-level assertion there would evaluate never — the
  phantom-check shape #5286 / #5449 paid for. What is checkable is the wiring, and
  that is the risk this change actually carries: the providers are positional
  arguments 6..19 of a twenty-argument constructor, all with the same
  `(environmentId?) => Promise<unknown>` shape, so a provider resolving the wrong
  slot is assignable everywhere and invisible to the compiler. The test drives
  each provider and asserts it hands back the instance registered in ITS slot,
  pins the exact set of slot names the boot resolves, and pins the degraded path
  where every optional slot is empty.

- ee264b2: fix(rest): refuse an unknown `?status` on `/security/suggested-bindings` instead of answering an empty list (#7678)

  `GET /api/v1/security/suggested-bindings?status=garbage` returned **200 with an
  empty list**. That is worse than an error: an empty list is a plausible,
  actionable-looking answer, so the response reads as _"there are no suggestions"_
  rather than _"your filter was not a status"_. An admin checking whether a package
  still has pending audience-binding suggestions got a clean, wrong all-clear.

  The route (`registerSecurityEndpoints`) forwarded `req.query.status` straight into
  `listAudienceBindingSuggestions`, whose contract — `AudienceBindingSuggestionFilter`
  — declares exactly three values (`pending`, `confirmed`, `dismissed`). Anything
  else was not an injection (the `where` clause is structured, never interpolated),
  it simply matched no row.

  **The rule already existed; only one of its two seams had it.** The runtime
  dispatcher's `/security` domain has refused unknown statuses since the filter was
  first tightened, carrying a comment describing precisely the empty-list arm above.
  The live REST route is a second seam onto the same service call and never got it —
  a dispatcher-vs-REST divergence pointing the opposite way from the earlier `/meta`
  cases, where routes existed on the dispatcher but were never mounted on REST.

  So this is a **convergence, not a second implementation**. The vocabulary, the
  predicate and the refusal wording move to `@objectstack/core`'s security barrel
  (`isAudienceBindingSuggestionStatus`, alongside `shouldDenyAnonymous` and the other
  decisions shared by every HTTP seam), and both callers import it. The accepted
  values stay keyed _by_ the contract type, so adding a status to
  `AudienceBindingSuggestionFilter` leaves a key missing and fails to compile rather
  than silently drifting.

  An unknown `?status` is now refused with **400** and the ADR-0112 envelope
  (`{ error: { code: 'VALIDATION_ERROR', message } }`) — matching the repeated-query-
  parameter guard already on this route — and the service is not called at all. The
  vocabulary is case-sensitive, so `?status=PENDING` is refused like any other
  non-status.

  Unchanged: every declared status still returns its list, omitting `?status`
  entirely still returns the unfiltered list, `?packageId` is untouched, and the
  dispatcher seam answers exactly as it did before.

- be90dea: fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

  Attachments derive their visibility from the parent record; comments derived
  nothing. On the _same_ record, with the _same_ user, the two answered
  differently:

  ```
  user: rep2 (does NOT own and cannot read the opportunity)
  GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
  GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
  GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                     → 200, 1 row
  POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
  ```

  `sys_comment` is public, has no owner column, and hides its parent inside a
  string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
  RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
  every object in every app carried that org-wide readable, org-wide writable
  side-channel — a deployment that carefully authored OWD, sharing rules and RLS
  on its records still leaked their discussion.

  `AuditPlugin` now installs the same two-part kit `service-storage` installs for
  `sys_attachment`, keyed off `thread_id`'s parent:

  - **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
    query with the threads whose record the caller can actually read (resolved
    through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
    decide). `count()` is filtered identically to `find()`, so a list `total`
    cannot leak the hidden rows' existence either.
  - **write** — `beforeInsert` requires READ on the record the thread names;
    `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
    or to hold EDIT on that record. `author_id` is server-stamped from the
    session, so a client-supplied value never wins.

  Everything fails CLOSED: a `thread_id` that names no record — the dangling
  `"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
  itself — is refused on write and excluded on read, and a filter that cannot be
  computed denies all rather than falling open. Refusals answer **403
  `RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
  permission condition takes a catalogued code rather than a new synonym), with
  `error.object` naming the record's object.

  **Breaking for deployments that depended on the gap.** Reads that used to
  return other people's comments now return fewer rows (or none), and writes that
  used to 201 now 403. Specifically:

  - Listing `sys_comment` without being able to read the parent record → the row
    is gone, not merely unlabelled. Panels that render a thread must be reached by
    a principal who can read the record.
  - Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
    usable at all: creating one is refused, and existing rows become invisible to
    everyone but system context. Migrate free-form threads to a real record
    reference (or keep them under a system-context surface).
  - Deleting or editing another user's comment now requires EDIT on the record.
    Note also that `sys_comment` delete already needed a permission set carrying
    `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
  - Posting a comment no longer requires the client to send `author_id` (it is
    stamped); a client that sends someone else's is silently corrected rather than
    believed.

  Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
  an object has comments at all, and anonymous callers are still refused with 401
  before any of this runs.

- 2a18012: fix(plugin-sharing): the ADR-0111 D7 inert-grant guard runs for SYSTEM callers too, so the sharing-rule evaluator can no longer materialise rows no gate consults (#8207)

  `SharingService.grant` skipped **both** of its pre-flights for a system context,
  in one block, under one justification: _"System callers bypass: the rule
  evaluator materialises through here under its own validation."_ The two halves
  ask different questions, and only one of them may vary by caller.

  - **D1, `assertCanManageShares` — an AUTHORIZATION check.** "May this principal
    manage shares on this record?" A sharing rule is not a principal and has no
    ownership to prove, so the system skip is correct and is unchanged.
  - **D7, the inertness guard — not an authorization check.** "Would any gate ever
    read a row on this object?" The gates that would consult the row
    (`buildReadFilter`, `checkEdit`, `checkDelete`) never see the granter, so the
    answer cannot depend on who asks. Exempting the system context made the guard
    answer a question it was not asked.

  **The "own validation" the old comment credited the evaluator with is not
  there.** Measured, one rule per class, `defineRule` then `evaluateRule`, both
  under a system context: a rule against a `public_read_write` object, an
  owner-less object, a `controlled_by_parent` detail, a federated phantom-anchor
  object, or a bypass object was accepted and materialised a real
  `sys_record_share` row — five for five. `defineRule` never reads the object's
  schema, and reconcile hands `grant` whatever `object_name` the rule row carries.
  So an authored sharing rule pointed at any of those objects minted rows that
  looked granted and enforced nothing, which is the ADR-0078 silently-inert trap
  arriving through the one door the guard did not watch.

  The inertness verdict is now computed caller-free and refused for **every**
  caller. Refusing costs no live access on either path: the row it declines to
  write could never have granted any.

  **What deliberately did NOT move.** The existence check stays non-system-only. An
  unresolvable object name is a NOT_FOUND (REST: 404) for a caller who typed it,
  but for the evaluator it is a stored `object_name` meeting an engine that may not
  have that schema registered at this instant — and absence of a schema is absence
  of _evidence_ of inertness, not evidence of it. Hard-failing a reconcile pass on
  that would refuse a write nobody showed to be inert. An engine with no
  `getSchema` at all keeps its existing "it cannot know" skip.

  **Operator-visible effects.** A sharing rule pointed at an object no gate
  consults now fails loudly instead of quietly writing nothing usable. Every system
  caller of `grant` is the rule evaluator's reconcile, and each of its entry points
  already treats a per-rule failure as best-effort: the boot rule backfill, the
  object-wide re-grant and the business-unit re-grant queue log the refusal (naming
  the rule and the reason) and carry on, and the write hooks catch it, so a user's
  insert or update is never failed by it. `POST /api/v1/sharing/rules/:idOrName/evaluate`
  now answers **422 `SHARING_NOT_ENABLED`**, naming the object and the reason,
  instead of burying the diagnosis in a 500 — the same code-to-status pair the
  per-record shares routes already publish. Withdrawal is untouched, so rows minted
  by an earlier build stay purgeable through `deleteRule` and through evaluating a
  deactivated rule.

- 129b378: fix(types,rest): one named answer for "which column conflicted" — an index name is never returned as one (#6544)

  #6250 retired four private "is this a unique violation?" vocabularies into
  `isUniqueViolationError`. It left the harder half of the question behind: the
  import runner's `sanitizeRowError` still carried its own three-dialect regex
  chain, because it does **more** than answer yes/no — it names the offending
  column so the importer can say _"A record with this `email` already exists."_
  This lands that second answer as a shared export and migrates the last private
  copy onto it.

  **New — `uniqueViolationColumn(error)` in `@objectstack/types`** (`string |
undefined`), sibling to `isUniqueViolationError` and gated on it, reading the
  same channels one step down the same bounded `cause` chain, plus
  node-postgres' `detail` field.

  **Its contract, per the maintainer's 2026-08-08 ruling: a value comes back only
  when the identifier the driver printed is determinably a COLUMN.** When a
  dialect names an _index_ instead — MySQL's `Duplicate entry … for key
'idx_email_unique'`, Postgres' `violates unique constraint "sys_user_email_key"`,
  SQLite's `UNIQUE constraint failed: index 'x'` — the answer is `undefined`,
  never the index name. Callers render this into a form field, and an index name
  mistaken for a column points the user at a field that does not exist, whereas
  `undefined` degrades to generic copy. A **composite** key (`Key (tenant_id,
email)=(…)`) is `undefined` for the same reason: there is no single offending
  column, and naming the first is the same class of wrong answer.

  **⚠️ User-visible change on MySQL imports.** MySQL's duplicate-entry message
  names the index and never the column, so the importer no longer names a column
  there: rows that used to read _"A record with this `idx_email_unique` already
  exists."_ — or, on MySQL 8's table-qualified `for key 'sys_user.email'`, a
  plausible-looking _`email`_ that was still an index name — now read **"A record
  with this value already exists."** That is deliberate and is the accepted cost
  of the ruling. The conflict is still recognised as a conflict; only the naming
  narrowed.

  Three smaller import messages improve in the same move, all previously wrong
  rather than merely vague:

  - SQLite's expression/partial-index form used to render as _"A record with this
    **index** already exists."_
  - Postgres' expression index used to render the truncated fragment _"A record
    with this **lower(email** already exists."_
  - A Postgres conflict with no `DETAIL:` line used to fall through to the SQL
    backstop and echo the driver's own sentence — index name included — at the
    importer. It now gets the same generic conflict copy, which is also the exact
    wording `mapDataError` puts in the 409 `UNIQUE_VIOLATION` body, so the
    importer and the API say one thing about one condition.

  Not changed: the NOT NULL branch, the raw-SQL backstop, and every non-conflict
  message, which pass through exactly as before.

- ec5a125: fix(rest): the `UNIQUE_VIOLATION` 409 now names the conflicting field, matching the bulk path (#7821)

  A single-record write that violated a `unique` field came back as

  ```json
  {
    "error": "A record with this value already exists",
    "code": "UNIQUE_VIOLATION",
    "object": "invoice"
  }
  ```

  — no `field`. On an object with several unique fields the caller was told only
  that _a_ value was taken and had to guess which one, and a client that wanted to
  render its own localized message could not name the field either, because the
  body carried nothing to name it with.

  The platform already knew the answer. Since #6544 the **bulk / import** path
  resolves the colliding column through `uniqueViolationColumn` and says _"A record
  with this `email` already exists."_ The **single-record** path held the same
  error object, sat one import from the same helper, and withheld it. One rule, two
  implementations, one strictly worse.

  The 409 body now carries the field, and its default message reaches parity:

  ```json
  {
    "error": "A record with this email already exists",
    "code": "UNIQUE_VIOLATION",
    "field": "email",
    "object": "invoice"
  }
  ```

  **Reading the error object, not its message, resolves more than the bulk path
  can.** `sanitizeRowError` only ever holds a string, so it reads the message
  channel alone; this site has the whole error, and `uniqueViolationColumn`
  additionally reads `detail` and one step of `cause`. That is where the column
  actually is for the Postgres driver we ship — node-postgres keeps its
  `DETAIL: Key (email)=(…)` line on `error.detail` and off the message — so that
  shape now names `email` where a string-only read answers nothing.

  **When the driver does not determinably name a column, nothing is guessed.** An
  index name (MySQL's `for key 'idx_email_unique'`, SQLite's `index 'x'`), a
  composite key, or prose the helper does not parse all produce the unnamed
  sentence and **no `field` key at all**. A wrong field name is worse than none: it
  sends the user to correct an input that was never the problem. MySQL deployments
  therefore keep the unnamed message — that is `uniqueViolationColumn`'s documented
  and deliberate cost, not a gap here.

  Unaffected: the status is still `409`, the code is still the registered
  `UNIQUE_VIOLATION`, `object` is unchanged, and adding `field` is additive. The
  bulk path is untouched and still names the field exactly as it did. The
  withholding this branch enforces is intact — the offending user data
  (`Duplicate entry 'acme@example.com' …`), the index name, and the `table.`
  qualifier still never reach the wire; `sys_user.email` is reported as `email`.

  Not addressed here: the message is still built-in English. Localizing
  platform-built-in error copy is one architectural answer owed to this string,
  `DELETE_RESTRICTED` (#7307) and `sanitizeRowError`'s siblings together, and is
  deliberately left to that decision. The `field` on the wire is what lets a client
  build its own localized message today.

- 88f9d94: fix(types,rest): one named unique-violation predicate — a MySQL conflict is 409 UNIQUE_VIOLATION, not 500 (#6250)

  **On MySQL, every unique-constraint conflict came back as `500 INTERNAL_ERROR`.**
  The API contract registers `UNIQUE_VIOLATION` as a 409 code
  (`packages/spec/src/api/error-code-ledger.zod.ts`), so a front end had no way to
  tell "this email is already taken" from "the server fell over" — no retry advice,
  no field to point at, and a 5xx in the operator's dashboards for what is an
  ordinary client outcome. SQLite and Postgres deployments never saw it, which is
  why it survived: their conflict prose happens to contain the words the mapping
  looked for.

  **Cause: the conflict verdict was nested inside a leak heuristic.** REST's 409
  branch lived inside the true-branch of `looksLikeInternalErrorLeak()`, keyed on
  the substrings `unique constraint` / `unique violation`. MySQL says
  `ER_DUP_ENTRY: Duplicate entry '…' for key '…'`, which matches no limb of that
  heuristic, so the conflict never reached the `if` at all and fell out of the
  terminal `UNCLASSIFIED_FAULT`. Two unrelated questions — "is this a conflict?"
  and "would echoing this text leak internals?" — had been fused into one, and
  MySQL is where they disagree.

  Measured on the previous release, through the real error mapper:

  ```
  mysql,    bare message       500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  mysql,    knex-wrapped SQL   500 DATABASE_ERROR  →  409 UNIQUE_VIOLATION
  postgres, SQLSTATE only      500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  sqlite,   message            409 UNIQUE_VIOLATION   (unchanged)
  postgres, message            409 UNIQUE_VIOLATION   (unchanged)
  ```

  So the hole was never MySQL-only: the mapping read one of the two channels
  drivers use. A Postgres error carrying SQLSTATE `23505` with unremarkable prose
  was a 500 as well.

  **New: `isUniqueViolationError(error)`, exported from `@objectstack/types`.** One
  named predicate replaces the substring test, reading every channel a driver
  uses — `code` (`23505` / `ER_DUP_ENTRY` / `SQLITE_CONSTRAINT_UNIQUE`), `errno`
  (`1062`), the message, and one step down the `cause` chain that pool and
  query-builder layers wrap with. Its vocabulary is the union of the four
  hand-written copies the repo already carried, so routing REST through it cannot
  narrow any verdict clients rely on today; an unrecognised error is never a
  conflict, because a false 409 tells an SDK not to retry and points the user at a
  value that is fine.

  **The internal-leak classifier is byte-identical.** The fix hoists the conflict
  question out of it rather than widening its criteria, so nothing else it guards
  is reclassified as safe-to-expose. And the 409 body is fixed text: MySQL embeds
  the offending user data in its message (`Duplicate entry 'a@b.com' …`) and
  Postgres the index and column names, none of which reaches the client. The full
  driver text still reaches the server log.

  No action needed. Clients that already handled `409 UNIQUE_VIOLATION` on SQLite
  and Postgres now receive it on MySQL too.

- 90fa077: fix(rest): a missing relation is only an unknown OBJECT when it IS the object asked for (#5462)

  `mapDataError`'s unknown-object heuristic asked whether a driver error mentioned
  `no such table` / `relation … does not exist` — never **which** table was
  missing. A business object that was never registered and the metadata plane
  collapsing entirely produce the same two words, so `sys_metadata` becoming
  unreachable came back to the caller as:

  ```
  404 {"error":"Object not found","code":"OBJECT_NOT_FOUND"}
  ```

  The caller was told to check the object name they typed while the real answer
  was "the metadata store is gone". And because 404 is an `isExpectedDataStatus`,
  `handleRouteError` printed no `[REST] Unhandled error` — so a total outage of
  the metadata plane left **not one line** in the server log. Reproduced in
  process on a real `ObjectQL` + `ObjectStackProtocolImplementation` whose driver
  fails every access with `SQLITE_ERROR: no such table: sys_metadata`:
  `PUT /api/v1/meta/object/acct` answered 404 with zero log lines.

  **The rule now: a missing-relation message is an unknown-object verdict only
  when the relation it names is the object the request named.** Attribution takes
  both halves — a request object, and a relation name the phrasing actually
  carries (`no such table: main.acct`, `relation "public.acct" does not exist`;
  the schema qualifier is stripped and the compare is case-insensitive). Prime
  Directive #6 is what makes that comparison sound rather than a guess: the object
  `name` **is** the table name, with no `tableName` mapping to launder it.

  Anything unattributable — a different table than the one asked for, an auxiliary
  table, no request object at all (which is every metadata / UI / discovery route,
  since they call `handleRouteError(res, error)` without one), or a phrasing that
  names no relation — is now the sanitised data-store fault the SQL-leak branch
  has always emitted: `500 { "error": "Internal data error", "code":
"DATABASE_ERROR" }`. 500 sits outside `isExpectedDataStatus`, which is what buys
  back the log line the silent 404 never had; the driver's own words still never
  reach the client.

  Deliberately unchanged:

  - **A genuine unknown object is still a quiet `404 OBJECT_NOT_FOUND`.** Both
    producers still land on one envelope (#3770): the protocol's registry gate,
    and the driver limb when the missing table is the requested object. It still
    logs nothing — an unknown object is a client mistake, not a fault (#4886).
  - **The engine-authored limbs.** `unknown object`, `object not found`,
    `[ObjectQL] No driver available for object '<name>'` and the quoted-name
    catch-all are ObjectStack's own vocabulary about a named object; they mean
    what they say. Only the DATABASE-authored limbs, which cannot know which table
    the caller wanted, needed attribution.
  - **The declared-status band.** #5437/#5464 (a declared 5xx is withheld and
    logged) and #5423/#5436 (a 4xx is truncated, not erased) answer in
    `resolveErrorResponse` before the heuristic is reached at all. That fix
    covered producers that declare `status: 500`; this path never reached it,
    because `saveMetaItem` rethrows the driver's `Error` with no `status` and no
    `code` — which is why the message text was judging it.

- 3fc2e48: fix(spec,rest,cli): validation diagnostics reach the real defect — named view-union branches, and `invalid_key` / `invalid_element` descent (#6391, #5389)

  Two cases where a refusal fired correctly but its _diagnostic_ could not reach the
  element that actually failed. Both fixes change the DIAGNOSTIC face only: every
  input that parsed before parses after, every input refused before is refused
  after, and each refusal keeps its issue codes (ADR-0112 / #6142 — a better
  diagnostic never weakens the envelope). Pinned in both directions.

  **#6391 — `ViewMetadataSchema`'s union members are now contractual.** Three of
  its four members were inline expressions with no name, so a consumer diagnosing a
  failure could only reach a branch by indexing the nested `invalid_union`
  `errors[]` **by member position**; objectui shipped exactly that and had to hold
  the coupling down with a canary test (objectui#3606 / PR objectui#3624). The
  union is now built from a named record:

  - `VIEW_METADATA_BRANCHES` — the branch names, in the union's own order;
  - `VIEW_METADATA_MEMBERS` — branch name → the schema the union actually holds
    (`viewItem` is identically `ViewItemWireSchema`, as before);
  - `selectViewMetadataBranch(body)` — which branch a body claims, by the
    discriminants the members already declare;
  - `diagnoseViewMetadata(body)` — the failing branch **named**, with that branch's
    own leaf issues and real field paths, so no consumer needs `errors[i]`.

  The union is **not** converted to `z.discriminatedUnion`. That would move the
  acceptance face — a discriminated union refuses an unknown discriminant outright
  where this one falls through all four members, and several of these shapes carry
  no discriminant at all. `ViewMetadataSchema` remains the only judge of
  acceptance; the dispatch only explains a verdict it did not make, and a pin
  asserts the two never disagree.

  **#5389 — `invalid_key` / `invalid_element` are descended, in all three
  consumers.** Zod hangs a failing record-key / map-element schema's real issues on
  `issue.issues` — the same shape as `invalid_union`'s `issue.errors`, one property
  name over. The family had already been fixed three times for `errors` (#4971,
  #5014, #5341) and none of the three consumers read `issues`, so both codes
  surfaced as a bare wrapper line with the prescription stranded in the payload.
  Now `formatZodError`/`formatZodIssue` (spec), `zodIssuesToFields` (the REST wire)
  and `formatZodErrors` (the CLI terminal) all descend it.

  Before / after, a `z.record` with a constrained key:

  ```
    ✗ fields.First Name: Invalid key in record
  ```

  ```
    ✗ fields.First Name: Invalid key in record
      ✗ fields.First Name: Invalid identifier. Must be lowercase snake_case …
  ```

  The expansion is strictly additive on every surface: the container's own line
  (and, on the wire, its own `{field, code: 'invalid_shape', message}` entry) is
  unchanged, and the leaves follow it. Unlike a union's branches — competing
  candidates, therefore ranked and capped — a container's `issues` are the one list
  the inner schema produced, so every one of them is reported.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
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
- Updated dependencies [c44dd5e]
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
- Updated dependencies [840ee4b]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [9f5cc79]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
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
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [2e836de]
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
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
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
- Updated dependencies [87aca93]
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
- Updated dependencies [ff17642]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
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
- Updated dependencies [32d3800]
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
- Updated dependencies [db0d53c]
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
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [c7e7900]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
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
- Updated dependencies [b25a116]
- Updated dependencies [02dc076]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
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
- Updated dependencies [3670cf9]
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
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [9881074]
- Updated dependencies [1b9a53b]
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
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [fc71b84]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [7372d46]
- Updated dependencies [5e247fd]
- Updated dependencies [d56012f]
- Updated dependencies [1a53a02]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [a954634]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [39eb01b]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
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
- Updated dependencies [030125b]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [fda61e4]
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
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
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
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
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
- Updated dependencies [db48ad5]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [65f184b]
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
- Updated dependencies [91cefb8]
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
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
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
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [d5749d7]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [51a587d]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
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
- Updated dependencies [e787608]
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
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [c073b8c]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
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
- Updated dependencies [d71ff32]
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
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [694c350]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
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
- Updated dependencies [946a131]
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
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
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
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/types@17.0.0
  - @objectstack/metadata-core@17.0.0
  - @objectstack/observability@17.0.0
  - @objectstack/service-package@17.0.0

## 17.0.0-rc.6

### Major Changes

- 9b9b70f: refactor(rest)!: 按 ADR-0049 退役 `ExportFieldMeta` 的八个约束键 —— 唯一的读者已随导入 dry run 的镜像一起退役 (#6536)

  **BREAKING.** `@objectstack/rest` 导出的 `ExportFieldMeta` 不再声明
  `required` / `system` / `readonly` / `hasDefault` / `min` / `max` /
  `minLength` / `maxLength`，`buildFieldMetaMap` 也不再计算它们。
  `ExportFieldMeta` 本身、以及全部展示类键（`name` / `type` / `label` /
  `options` / `reference` / `displayField` / `multiple`）原样保留。

  这是一次**休眠代码清扫，不是缺陷修复** —— 今天没有任何用户会撞上它。

  ## 为什么这八个键留不住

  它们只为一个消费者存在：导入 dry run 手抄的前置校验镜像
  （`firstMissingRequiredField` / `firstConstraintViolation`，framework#3956）。
  #4633 ruling D 已经退役了那份镜像（PR #6532）—— dry run 改为通过
  `DataProtocol.validateData` 向引擎要判决，而引擎读的是对象自己的 schema。
  于是 `buildFieldMetaMap` 每次导入照算不误、却**没有任何代码再读**，正是
  ADR-0049 enforce-or-remove 针对的「已声明、无人读」形状。PR #6532 当时重写了
  注释、把键留在原地，并写明退役是一次独立的清扫 —— 本 PR 就是它承诺的那次。

  关键在于：这八个键**从来不是事实来源**。`buildFieldMetaMap(schema)` 是从调用方
  自己传进来的那个 `schema` 上**派生**出它们的，所以这张表只是把调用方手里已有的
  事实抄了第二份。约束词表旁边没有执行者，却和展示词表并排站着 —— 这恰恰是
  AI 生成的消费端最容易误当成契约的形状。

  ## 迁移：FROM → TO

  只有一类代码受影响：直接调用 `buildFieldMetaMap`（或通过
  `prepareImportRequest` 拿到 `PreparedImport.metaMap`）并读取这八个键的外部消费者。
  仓内、以及 `objectui` 同级仓，逐键逐类型核查后**读者为零**。

  ```ts
  // FROM
  const meta = buildFieldMetaMap(schema).get("amount");
  if (meta?.required && !meta.hasDefault) reject();
  if (meta?.max != null && value > meta.max) reject();

  // TO —— 从你本来就持有的那个 schema 上读，也就是引擎读的同一份
  const field = schema.fields["amount"];
  if (field?.required && field.defaultValue == null) reject();
  if (field?.max != null && value > field.max) reject();
  ```

  一行版：**把读取点从派生副本移回 `schema.fields[name]`。**

  `hasDefault` 没有一对一的替代键 —— 它本身就是派生谓词
  `defaultValue != null`，镜像的是引擎 `applyFieldDefaults` 的判断
  （`packages/objectql/src/engine.ts`，`if (f.defaultValue == null) continue;`）。
  那条事实仍然成立，只是它的权威出处一直在引擎里，不在这份副本里；所以请读
  `field.defaultValue` 并自己套用同一个 `!= null` 判断。

  ⚠️ **请对着一次真实运行验证，而不是只看 tsc 变绿**：这八个是**可选**键，挂在一个
  本身继续存在的接口上，所以 JS 消费者（或任何 `any` 类型的读取）升级后读到的是
  `undefined`，编译期一个字都不会说。TypeScript 消费者才会在读取处收到编译错误。

  字段定义上的 `required` / `min` / `maxLength` 等**照旧完全可写、且照旧由引擎强制** ——
  本次没有任何可编写或已存储的元数据形状发生变化。

  <!-- adr-0087: registered export-field-meta-constraints-retired -->

### Minor Changes

- 97b0798: fix(spec,rest,runtime)!: the ADR-0045 publish gate gets its own machine-managed key — `app.hidden` goes back to meaning navigation, and the built-in Account app stops 404ing for every normal user (#4829)

  <!-- adr-0087: registered app-hidden-to-unpublished -->

  **FROM → TO:** nothing to rewrite by hand. `app.hidden` keeps its spelling and its
  authoring contract; the publish gate moves to a new machine-managed key,
  `app._unpublished`, which no author writes. Stored `sys_metadata` app rows carrying
  `hidden: true` are rewritten to `_unpublished: true` by the ADR-0087 conversion
  `app-hidden-to-unpublished` — automatically on every stored-row read, and in place via
  `os migrate meta --stored --apply`.

  ## The defect

  `filterAppForUser` (`@objectstack/rest`) treated `app.hidden` as an access gate:

  ```ts
  if (
    item.hidden === true &&
    !sysPerms.has("studio.access") &&
    !sysPerms.has("setup.access")
  )
    return null;
  ```

  `hidden` does not mean that. Its contract, written in `app.zod.ts` the day the key was
  born alongside the built-in Account app, is navigation presentation: _"Hidden apps stay
  fully routable and permission-checked"_ — keep it out of the App Switcher, surface it from
  the avatar menu, which is exactly how personal-settings apps behave in GitHub Settings,
  the Google account chip and Salesforce Personal Settings.

  So the platform's own `account` app — authored `hidden: true` on purpose — was erased from
  `GET /api/v1/meta/app` for every user without `studio.access` / `setup.access`. Clicking
  the avatar → Profile landed on _"App not available — it may still be publishing"_, and
  password changes, avatar, linked accounts, active sessions and the inbox were all
  unreachable. Any admin saw a completely healthy system, which is why it survived a release
  candidate and shipped a downstream workaround.

  The two contracts arrived from different places. ADR-0045 §3 did not introduce `hidden`; it
  **borrowed** it, citing an "ADR-0019 launcher contract (`hidden`, `active`)" as an existing
  read side. That contract does not exist — **ADR-0019 contains no `hidden`** and never
  discussed launchers, the avatar menu or the Account app. The reference was dangling from
  the day it was written, which is why nothing caught the collision it created: one boolean,
  two contracts, disagreeing on the only question that matters — _may a normal user reach
  this app?_

  ## What changed

  - **`AppSchema` declares `_unpublished`** — the ADR-0045 §3 publish gate. `true` means the
    app is unpublished: externally unobservable, not merely unlisted. It is written by the AI
    additive-materialization path and cleared by `POST /packages/:id/publish-drafts`, and its
    `_` prefix is this repo's existing marker for the channel tooling stamps onto artifacts
    (ADR-0010's `_lock` / `_provenance` envelope; the prefix `lintAuthoredRecordKeys` already
    skips). It is _declared_ rather than omitted because the write path validates against
    this very schema (`saveMetaItem` → 422; `Registry.validate('app', …)` → `AppSchema.parse`),
    so an undeclared key would make the platform's own flip unwritable. The strict door
    answers the author-shaped spellings — `unpublished`, `published`, `draft` — with a
    prescription that says _publish state is not authorable_, rather than routing them onto
    the key.
  - **`app.hidden` is navigation only**, and its docblock now says so with the incident
    attached. Authoring `hidden: true` affects the App Switcher and nothing else.
  - **The REST gate judges `_unpublished`.** A hidden app is served to everyone, with its
    `hidden` flag intact so the shell can place it; an unpublished app still 404s externally
    and still reaches builders for direct-URL preview, and `requiredPermissions` still applies
    to both.
  - **`publish-drafts` clears `_unpublished`** instead of un-hiding. It writes `false` rather
    than deleting the key, because ADR-0045 §3 makes publish/unpublish symmetric, and it
    copies `hidden` through untouched — publishing no longer rewrites a presentation choice
    as a side effect. The response fields keep their `unhiddenApps` / `unhideError` spelling:
    they are a wire contract read by the objectui Publish button, and renaming them from a
    repo that cannot update that consumer would be a silent break of exactly the kind this
    change is about.
  - **ADR-0045 is amended**, its dangling ADR-0019 reference corrected, and both
    implementation sites (`rest-server.ts`, `runtime/domains/packages.ts`) are now anchored in
    `scripts/adr-anchors.json` — neither carried an anchor before, which is why an author
    could change ADR-0045's §3 without knowing they were changing a decision.

  ## Why a new key rather than deleting the gate

  Taking `hidden` out of the access decision was proposed first and refused. The gate is §3 of
  an **Accepted** ADR with pin tests and a live implementation behind it, so removing it in a
  patch would reverse a recorded decision by side effect. It is also the worse failure
  direction: a gate that fails **open** exposes a half-built app to real users, silently.

  ## Migration reach

  The conversion is `retiredFromLoadPath: true`, and here that flag is load-bearing rather
  than bookkeeping — it confines the rewrite to **stored rows**. `hidden` is not retired as an
  authorable key, so a conversion running on the load path would rewrite
  `defineApp({ hidden: true })`, and the Account app itself, into unpublished apps and
  reproduce the defect through the conversion layer. Excluded from the load path, it replays
  only where the old meaning is the only meaning: the stored-row rehydration seams and
  `os migrate meta`. Stored `hidden: true` was unambiguous under the old regime — that value
  _was_ the gate, so nobody stored it to mean "keep me out of the switcher"; code-declared
  apps like `ACCOUNT_APP` never enter `sys_metadata`, and the Studio app form has no `hidden`
  control.

  ## Follow-ups (other repos, filed separately)

  - **cloud** — the AI materialization write point must stamp `_unpublished: true` where it
    stamps `hidden: true` today.
  - **objectui** — the Unpublished banner and the Publish button must read/clear
    `_unpublished`; the App Switcher keeps reading `hidden`, which now means only what it says.
  - **os-project-titanwind-ehr** — PLAT-DEF-040's startup `{hidden:false}` overlay can be
    deleted once this ships.

- 2ef1807: fix(objectql,rest,spec): the `DELETE_RESTRICTED` 409 stops handing a business user a developer instruction

  Deleting a record that other records reference is correctly refused with
  `409 DELETE_RESTRICTED`. The transport was never the problem — `status` is set
  and the structured fields survive the mapper. What reached the end user was:
  `error.message` is shipped verbatim as `body.error` by `mapDataError`, and
  Console renders that as-is in a toast. So an operator deleting a 部门 in a fully
  Chinese app read

  ```
  Cannot delete sys_business_unit (): 1 dependent os_tianshun_ehr_sporadic_application
  record(s) reference it via apply_dept (apply_dept is required, so it cannot be
  cleared). Delete or reassign them first, or set deleteBehavior:'cascade' on
  os_tianshun_ehr_sporadic_application.apply_dept.
  ```

  — an English sentence in a zh-CN UI, naming two tables and a column they have
  never seen (they know them as 「零星申请」 and 「申报部门」), ending in a
  metadata-authoring instruction a business user cannot act on and will open a
  support ticket about.

  **The error now carries two messages, because it has two audiences.**

  - `message` is the **user's** half: rendered in the caller's locale
    (`ExecutionContext.locale`) from a new built-in catalog, against resolved
    **labels** for the object, the dependent object and the referencing field —
    translation bundle → declared `label` → API name, so the API name is where the
    ladder ends rather than where it starts. The actionable half of the old advice
    ("delete or reassign them first") stays; `deleteBehavior` does not appear in
    any locale.
  - `developerMessage` is the **developer's** half, and is the previous sentence
    byte for byte: English, API names, and the `deleteBehavior:'cascade'` remedy.
    The guidance is correct and useful — it is moved to a channel that reaches
    developers, not deleted. `@objectstack/rest` ships it as a sibling field of the
    409 body (it discloses nothing the envelope did not already carry: `object` and
    `dependentObject` are API names on the same body), and the engine's delete
    error log now carries it too, so a zh-CN deployment's server log does not lose
    its operator detail to the localized sentence.

  `code`, `status`, `object`, `dependentObject` and `dependentCount` are
  unchanged, and the wire code does **not** split — one `DELETE_RESTRICTED`
  (ADR-0112), two sentences, exactly as the field catalog splits a message key
  without splitting `FieldErrorCode`.

  **New in `@objectstack/spec/system`** (`operation-message.ts`): the operation
  message catalog — `renderOperationMessage`, `BUILTIN_OPERATION_MESSAGES`
  (`en` / `zh-CN` / `ja-JP` / `es-ES`), `operationMessageTranslationKey`, plus
  `objectLabelKey` in `i18n-resolver`. A deployment overrides any sentence with a
  `translation` item under `errors.<messageKey>`. It is a **separate** catalog from
  `validation-message.ts` deliberately: that one is addressed `validation.field.*`
  because every entry names a field and the constraint it broke, and a
  `DELETE_RESTRICTED` names neither — the offending field is on a different object
  from the one the caller acted on, and there is no `fields[]` entry to hang it
  off. Filing it there would give deployments an override key that lies about what
  it overrides.

  `minor`, not `major`: nothing breaks. The structured fields clients match on are
  untouched, no test or doc ever pinned the message text, and both new fields are
  additive. `check-changeset-no-major.mjs` is the second reason — every publishable
  package is in the Changesets `fixed` group, so one `major` promotes all ~70
  packages, and the launch-window convention ships even genuinely breaking changes
  as `minor`.

  This is #3957's fix reached from the operation side: same defect (platform copy
  composed in English with API names concatenated in), same machinery, one layer
  up.

- fec7848: fix(rest): 设置了 `api.apiPath` 时,9 条 direct-mount 路由跟随同一个 API base(#6306)

  `RestServer.getApiBasePath()` 回答 `api.apiPath ?? `${basePath}/${version}``,
而 `rest-api-plugin.ts` 为两个 direct-mount registrar(`packages._`×4、`datasources/:name/external/_`×5)自行重算了一次`${basePath}/${version}`,
从不读取 `apiPath`。两个表达式只在 `apiPath`未设时相等——于是设置了`apiPath` 的部署同时出现两个 API 前缀。实测(`apiPath: '/backend/api/v9'`,
真实 `createRestApiPlugin(...).start()`组合、记录型 host server 枚举全部
挂载):**92 条路由中 83 条迁到`{apiPath}`,恰好 9 条滞留 `/api/v1`**;
`{apiPath}/openapi.json`的`isUnderBase` 过滤把这 9 条排除在文档之外
(**71 paths**);`/discovery` 也如实通告了滞留位置
(`routes.packages: '/api/v1/packages'`)——通告没有说谎,是挂载本身分裂了。

  按 maintainer 裁定(Option 1,单一真相源):registrar 现在直接消费
  `restServer.getApiBasePath()` 的返回值——共享同一个值,而不是把 `??`
  表达式复制到第二处(复制正是这个缺陷的成因)。`getApiBasePath()` 因此
  从 `private` 变为 public,职责写入其 doc comment。

  **行为变化,仅限设置了 `api.apiPath` 的部署**:这 9 条路由的 URL 从
  `/api/v1/...` 移到 `{apiPath}/...`,旧前缀不再服务(无兼容双挂载)。
  修复后实测 92 条全部挂在 `{apiPath}` 下,`{apiPath}/openapi.json`
  完整列出这 9 条(**71 → 79 paths**),`/discovery` 通告 `{apiPath}/packages`
  与 `{apiPath}/datasources`。

  需要动手的只有**基础设施配置**:若反向代理、健康检查或外部监控里硬编码了
  `/api/v1/packages` 或 `/api/v1/datasources/*/external/*`,改成 `{apiPath}/…`。
  **SDK 与应用代码无需改动**:`@objectstack/client` 自 #6633 / PR #6712 起从
  `/discovery` 通告的 base 派生这两个面,而通告是已录制挂载的投影,因此客户端
  按构造跟随本次移动。该键也没有 authoring 路径可达
  (`defineStack({server:{api:…}})` 被 strict 块 loud 拒绝,`api:{apiPath}` 被
  静默 strip,`os serve` 只转发两个 scoping 键),只有程序化组合
  `createRestApiPlugin` 的 embedder 能设到它。

  **默认配置(未设 `apiPath`)逐字节不变**:两个表达式在该情形下同值;实测
  修复前后默认挂载表(92 条)、`{base}/openapi.json`(79 paths)与
  `/discovery` 通告完全一致,逐行 diff 无差异。

  另修复同一来源的第二处分歧:插件旧表达式用 `||` 兜底(空串 `basePath`
  ⇒ `/api`),`RestServer` 规范化用 `??`(空串保留)——`basePath: ''` 时
  route-manager 面挂 `/v1` 而 9 条挂 `/api/v1`,同样的分裂不需要 `apiPath`
  也会出现(实测 83/9)。读同一个值后该分歧不复存在。

  Bump 判定为 `minor` 而非 `patch` / `major`。不是 `patch`:除了修缺陷,它
  改变了一个真实配置键下可观测的 URL 表面,并且新增了公共 API 面
  (`RestServer.getApiBasePath()` 由 `private` 转 public,是这次单一真相源的
  承载物)。不是 `major`:没有任何可授权(authorable)的键被移除或重命名,
  没有需要作者迁移的元数据(因而 ADR-0087 无可登记项),默认部署逐字节不变,
  受影响部署的客户端按构造跟随;唯一的 FROM → TO 落在部署方自己的代理配置上,
  而这些部署今天本就是 split-brain——本次是让 `apiPath` 被完整遵守,不是收回
  一个曾被兑现的承诺。

- 11066f6: feat(spec,metadata-protocol,rest,client): the direct-mount surfaces (`packages`, `datasources/:name/external/*`) become discoverable, and the SDK follows the advertised base (#6633)

  The rest surface's `/discovery` never advertised `routes.packages` — routes
  mounted but not advertised, the unstated half of ADR-0076 D12 — so the SDK's
  `packages.*` always fell back to the hard-coded `/api/v1/packages`; and the
  SDK's `datasources.external.*` had no discovery mechanism at all, hard-coding
  `/api/v1/datasources/...` in each of its five methods. On any deployment with a
  non-default API base, both families built wrong URLs (measured in #6633).
  Maintainer ruling 2026-08-08 (route B, prerequisite for #6306):

  - **spec** (minor, additive): `ApiRoutesSchema` declares a `datasources` key —
    the base of the federation-admin family. Optional like `mcp`: absent = not
    mounted.
  - **metadata-protocol** (minor, additive): `getDiscovery()` advertises
    `routes.packages: '/api/v1/packages'` iff the `package` service is
    registered (`serviceToRouteKey` gains the mapping; the route flows through a
    non-slot table because `package` is not a `CoreServiceName`). `datasources`
    is deliberately NOT advertised by this builder — the mount belongs to the
    REST host it cannot see (same disposition as `mcp`).
  - **rest** (minor): `/discovery` advertises `routes.packages` and
    `routes.datasources` as projections of the RECORDED direct mounts (#5822) —
    advertisement and mounting derive from one fact, so #6306's later mount-base
    move carries the advertisement along by construction. Not mounted ⇒ not
    advertised. An end-to-end parity pin (`discovery-advertised-direct-mounts.
parity.test.ts`) drives the composed surface and goes red on any change that
    moves only one side.
  - **client** (patch, behavior fix): the five `datasources.external.*` methods
    derive their base via `getRoute('datasources')` — connected clients follow
    the advertised base; unconnected clients (or servers that advertise no
    `datasources` key) keep building byte-identical `/api/v1/...` URLs.

  No key is removed and no wire shape changes for existing deployments: servers
  gain two advertised keys, and the SDK changes URLs only when a server
  advertises the new keys with a non-default base.

- 916af17: feat(spec,rest,client): the email surface becomes discoverable and the SDK follows the advertised base; the scoped client derives its prefix from discovery (#6714)

  `@objectstack/client` 的 `email.send` 硬编码 `${baseUrl}/api/v1/email/send`,而服务端
  `registerEmailEndpoints` 挂在 `getApiBasePath()` 下、**已经跟随 `apiPath`** —— 设了
  `apiPath` 的部署上这是**现活 404**,不是潜伏项。实测(`apiPath: '/backend/api/v9'`
  启动,录制挂载表):email 面只有 `POST /backend/api/v9/email/send` 一条,
  `POST /api/v1/email/send` 在表中**不存在**。`ScopedProjectClient.scope()` 同样硬编码
  `/api/v1/environments/...`,scoped 面全部 `meta` / `data` / `batch` / `packages` /
  `automation` URL 由它拼出;同一启动下 83 条 scoped 路由全在
  `/backend/api/v9/environments/:environmentId/...`,`/api/v1/environments/` 前缀零挂载。

  按维护者裁定(2026-08-08)复刻 #6633 / PR #6712 的四车道模式:

  - **spec**(minor,纯增量):`ApiRoutesSchema` 声明 `email` 键 —— `POST {email}/send`
    的挂载 base。`optional` 同 `datasources`:缺席 = 未挂载。
  - **rest**(minor):`/discovery` 把 `routes.email` 作为**已录制挂载**的投影通告
    (RouteManager 表中 `registerEmailEndpoints` 写入的那一行,mounted ⇒ advertised,
    不二次计算)—— 挂载随 `apiPath` 移动时,通告按构造随行。未挂载 ⇒ 不通告。
    奇偶钉(`discovery-advertised-direct-mounts.parity.test.ts`)扩展覆盖 email:
    通告值 + `/send` 必须在同一张挂载表里解析得到,单侧移动即红。
  - **client**(patch,行为修复):`email.send` 走 `getRoute('email')`;
    `ScopedProjectClient.scope()` 从通告的 `routes.data` base 推导 scoped 前缀。
    未连接、或服务端未通告 / 不可推导时,回退 URL 与旧硬编码**逐字节一致**。

  面 3 为何用 `routes.data` 而不是 `scoping` 块:实测 discovery 的 `scoping` 只有
  `enabled` / `resolution` / `scoped` / `environmentId` 四个键,**全是姿态、无路径**,
  无法推导 base;`routes.data` 由 rest 通告为 `{realBase}{crud.dataPrefix}`,是唯一可
  推导的来源。`dataPrefix` 被改成非 `/data` 时推导主动放弃、回退惯例(不做宽松再解析)。

  `cloud.environments.*` 面(约 30 处)经测量**未改**:本仓无任何宿主挂载 `/cloud/*` ——
  `@objectstack/rest` 的路由台账(`rest-route-ledger.ts`,由双向 conformance 门禁保证
  穷尽)cloud 行数为 **0**;runtime dispatcher 无 cloud domain(无 `handleCloud`、无
  `domains/cloud.ts`),且显式把 `/cloud` 列为他宿主的控制面(`skipPaths`)。而 `apiPath`
  是 `@objectstack/rest` 独有配置项 —— 该面不随 `apiPath` 移动,按裁定「不随则不收敛」
  保持原样。

- 465c5fc: REST 的 9 条 direct-mount 路由现在对 `RestServer` 可枚举,并随之进入 `GET {apiPath}/openapi.json`

  `package-routes.ts`(4 条 `packages.*`)与 `external-datasource-routes.ts`(5 条
  `datasources/:name/external/*`)一直绕过 `RouteManager`、直接挂在宿主 `IHttpServer` 上,
  `RestServer` 因此不持有「这 9 条本次 boot 是否挂载」的事实。#5588(PR #5821)把
  `/openapi.json` 的 built-in 段改成服务器自身路由表的投影之后,这 9 条(其中 8 条在
  `rest-route-ledger.ts` 里是 `disposition: 'sdk'` 的真实能力)就不在生成的文档里 ——
  用 `/openapi.json` 生成客户端的 consumer 拿不到它们,任何基于 `getRoutes()` 的自省也看不见。

  现在两个 registrar 各自把「实际挂载的那一个数组」原样返回,由组合步骤
  (`mountAndRecordDirectRoutes`,`rest-api-plugin.ts` 调用)登记到 `RestServer` 上:

  - `RestServer.getRoutes()` 返回本次 boot 的**全部**已挂载路由,每条带 `source`
    (`'route-manager' | 'direct-mount'`),类型为新导出的 `MountedRoute`;
  - `/openapi.json` 的 built-in 段随之覆盖这 9 条,带各自的 summary / tags / 路径参数;
  - 描述与挂载**同源**:返回的数组就是用来挂载的那个数组,不存在第二份手工清单。

  诚实性两个方向都保持不变:某次 boot 没有 `package` 服务 ⇒ `packages.*` 既没挂载、
  也不出现在 `getRoutes()` 与文档里;federation 那 5 条无条件挂载(服务缺席时按请求答 503),
  所以它们始终出现 —— 文档说的仍然只是「什么被挂载了」。

  对使用者的影响:`getRoutes()` 的返回值多了 9 条(服务在场时)以及每条上的 `source`
  字段;既有的 `method` / `path` / `handler` / `metadata` 读法不变。

- 623d008: feat(rest): `PUT /api/v1/meta/:type/:name` 要求 `manage_metadata` 能力 (#6603)

  **这是一次访问面收紧,线上可见。** 保存单个元数据项的这条路由此前只有
  `enforceAuth` —— 任何已认证会话都能写任意元数据项。现在它与隔壁的
  `POST /api/v1/meta/_migrate-stored` 用同一道门、同一套机制:调用方必须持有
  ADR-0066 D1 的 `manage_metadata` 能力,`isSystem` 照例放行。

  ## 谁开始吃 403,需要什么

  **任何不持 `manage_metadata` 的已认证调用方**,对这条路由的 `PUT` 一律
  403 `FORBIDDEN`(匿名调用方仍先吃 `/meta` 伞下的 401,门是第二层)。
  平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
  Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是
  自建集成、自建权限集,以及只持 `setup.access` 的 `organization_admin`。

  **要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
  Permission Sets → `systemPermissions`),而不是绕过这条路由。

  ## 为什么必须收紧

  ADR-0106 D1 会把调用方不可读的字段**整个**从服务出的对象 schema 里摘掉,
  而这条路由原样持久化收到的 body。于是一次最普通的
  GET → 改个 label → PUT,就把调用方**从来没被允许看见的字段删掉了**,
  整个交互过程中没有任何东西提示。GET-改-PUT 正是 AI agent 编写元数据的
  标准动作,原先这个动作会静默销毁它看不见的字段;现在它在写入时得到一个
  **响亮的 403**。

  同时这也关掉一个与掩码无关、更早就存在的洞:任何已认证会话都能覆写
  任意 schema。

  ## 尚未关闭的部分

  本次只收紧这一条路由。同形的 `PUT /meta/:type/:section/:name`(复合名)
  与运行时 dispatcher 自己的 `/meta` PUT 仍无能力门,同一次往返丢失仍可经
  它们复现 —— 已另立 #7019 跟踪,不在本次范围内。

- 73648ba: feat(rest,runtime): 元数据写入的其余三扇门同样要求 `manage_metadata` 能力 (#7019)

  **这是一次访问面收紧,线上可见。** #6603 只给 `PUT /api/v1/meta/:type/:name`
  一条路由落了 `manage_metadata` 门,而同一个写操作还有另外三扇门没有门。本次
  把它们补齐,用的是**同一道门、同一套机制**(各自照抄所在文件的既有先例):

  - `PUT /api/v1/meta/:type/:section/:name` —— 复合名保存(`@objectstack/rest`);
  - `DELETE /api/v1/meta/:type/:name` —— 重置为构件默认值(`@objectstack/rest`);
  - 运行时 dispatcher 自己的 `/meta` PUT —— 同一操作的**第二条传输**(`@objectstack/runtime`)。

  ## 谁开始吃 403,需要什么

  **任何不持 `manage_metadata` 的已认证调用方**,对上述三条路径的写入一律 403
  (匿名调用方仍先吃 `/meta` 伞下的 401,能力门是第二层)。`isSystem`(引擎自调)
  照例放行。平台自带的 `admin_full_access` 权限集本就带 `manage_metadata`,所以
  Studio / Setup 里的管理员与 CLI 的 dev admin **不受影响**;受影响的是自建集成、
  自建权限集,以及只持 `setup.access` 的 `organization_admin`。

  **要恢复写入:给该调用方的权限集加上 `manage_metadata`**(Setup →
  Permission Sets → `systemPermissions`),而不是绕过这些路由。

  ## 为什么必须收紧

  两条**各自独立成立**的理由:

  1. **ADR-0106 的读写不对称。** D1 会把调用方不可读的字段**整个**从服务出的对象
     schema 里摘掉,而这些路由原样持久化收到的 body。#6603 落地后**实测**:同一次
     GET → 改个 label → PUT 的字段丢失,经复合名这扇门可原样复现 —— 缺陷没有被修复,
     只是换了一扇门。本次复测的前后对照:

     ```
     加门前: compound PUT status : 200 | saveMetaItem calls : 1 | STORE after PUT : id, name
     加门后: compound PUT status : 403 | saveMetaItem calls : 0 | STORE after PUT : bonus_formula, id, name, salary_grade
     ```

  2. **一个与掩码无关、更早就存在的洞:** 任何已认证会话都能覆写(或重置)任意
     元数据项。`DELETE` 这条尤其是这个理由而**不是**掩码理由 —— 它不往返、不掩码,
     只是把定制覆盖层整个丢掉,`?dropStorage=true` 还会连对象的物理表一起拆掉。

  三处门都落在解析 protocol **之前**,所以未授权调用方无法用 501-vs-200 指纹探测
  内核能力,且拒绝时**什么都没写、什么都没删**。

  ## 不在本次范围

  只收紧写入面;读路径的姿态(ADR-0106 掩码)不变。#7020 记录的「门要求的能力集
  与 D4 掩码豁免集不是同一个集合」仍然成立,本次不替维护者选对齐方向。

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

- 2934761: fix(rest): a repeated `?version=` on `/packages/:id` is refused, not silently resolved (#6307)

  `IHttpRequest.query` is declared `Record<string, string | string[]>` — a repeated
  query parameter arrives as an **array**. Both `/api/v1/packages/:id` handlers read
  it as a string and passed it straight to `PackageService.get/delete`, whose
  parameter is `version?: string`. Measured on `main` before the fix:

  ```
  GET    /packages/com.acme.crm?version=1.0.0&version=2.0.0
         → packageService.get('com.acme.crm', ['1.0.0','2.0.0'])
  DELETE /packages/com.acme.crm?version=1.0.0&version=2.0.0
         → packageService.delete('com.acme.crm', ['1.0.0','2.0.0'])
         → 200 { message: 'Deleted com.acme.crm@1.0.0,2.0.0' }
  ```

  The `DELETE` line is the sharp one. `if (!version && protocol.deletePackage)` is
  what gates the **full uninstall** (#2747: the package's metadata rows, the durable
  `sys_packages` record, and the registered data-plane cleanups — plugin-security
  revoking its permission sets and bindings). Any truthy `version` skips it, so a
  repeated parameter silently narrowed the _scope of the operation_ on a destructive
  verb and still reported success.

  **Both verbs now refuse the ambiguity** with `400 VALIDATION_ERROR`
  (`The "version" query parameter was supplied 2 times. Supply it at most once — this
endpoint will not choose between conflicting values.`). `?version=a&version=b` is a
  well-formed request carrying two conflicting intents; picking one silently is a
  wrong answer delivered as a `200`. The rule is identical on both verbs — one
  parameter, one answer — and the code comes from ADR-0112's **standard** catalog
  rather than a newly registered synonym, because "this request contradicts itself"
  is a generic validation condition.

  The rule is about **multiplicity, not shape**: the parameter may be supplied at
  most once. A one-element array is one occurrence encoded differently by an adapter
  and is accepted; an empty array is no occurrence. Two identical values are still
  two occurrences and are still refused — "at most one _distinct_ value" would be a
  de-duplication rule no client can predict, while "supply it at most once" is
  checkable client-side.

  **Not tolerance for off-spec input.** The contract already declared the array; the
  consumer simply never handled a shape it was told to expect.

  **Nothing that works today changes.** A single `?version=1.0.0`, no `version` at
  all, and an empty `?version=` all behave exactly as before — including the full
  uninstall still being reached when no version is supplied. No in-repo caller,
  documented example or SDK path repeats the parameter (`client.packages.get` builds
  `?version=` from a single `version?: string`), so the new 400 is unreachable from
  any supported client. It is `minor` rather than `patch` only because a request
  shape that used to answer `200` now answers `400`.

  Adapter note, measured over a real socket: the `node:http` adapter
  (`NodeHttpServer`) hands `['1.0.0','2.0.0']` to the handler as the contract
  declares, while the Hono adapter collapses a repeat to the first value before any
  handler sees it. Both are contract-legal (the union permits either), which is
  exactly why the consumer must handle the declared shape rather than depend on
  which server booted.

- b295e4b: feat(runtime,rest): `/packages` 域补齐授权门 —— 写/破坏性路由要求 `manage_metadata`,读路由要求 D4 读集,全域匿名门 (#7033) (#7023)

  `/packages` 是最后一个零授权判据的路由域:普查实测一个连 `userId` 都没有(身份解析为
  `principalKind: 'guest'`)的调用方,对**破坏性**的 `POST /:id/discard-drafts`、整包
  `GET /:id/export`(27 种 metadata)、`GET /packages`(id 枚举面)与 `POST /:id/publish-drafts`
  一律得 **200** 并真的调进目标函数;而隔壁五个同族域(`/meta`、`/actions`、`/automation`、
  `/ai`、`/security`)都带 `shouldDenyAnonymous` 匿名门。本次按维护者 2026-08-09 裁定补齐:

  - **全域匿名门**:`shouldDenyAnonymous` 作为 `handlePackagesRequest` 的**第一条语句**,
    在 ObjectQL registry 探测之前,使匿名调用方拿不到 401-vs-503 的部署指纹。
  - **写 / 破坏性路由**(install / enable / disable / publish / publish-drafts /
    discard-drafts / commit-revert / rollback / revert / adopt-orphans / duplicate /
    manifest-PATCH / DELETE)要求 `manage_metadata` —— 与 #6603 / #7019 给 `/meta` 写面
    落的同一道门、同一判据(「能写 schema 的人就该是能管理 package 的人」)。
  - **读路由**(list / detail / commits / export)要求 ADR-0106 D4 读集
    `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES`(`studio.access` / `setup.access`)—— **引用
    该常量,不复制**,使 package 读取的能力集不会与 metadata 掩码豁免集漂移。
  - 门覆盖**两个 transport**:runtime dispatcher 域(`domains/packages.ts`)**与**
    `@objectstack/rest` 直挂注册器(`package-routes.ts` 的 `refusePackageRequest`,
    经 `RestServer.resolvePackageRouteExecutionContext` 解析与其余表面同一身份)。缺
    resolver 时 REST 侧**失败即关**(401),不留裸露回退。所有门都在协议/服务解析**之前**
    判,拒绝时不写不删(防「先删后拒」)。`isSystem`(不可从线上伪造)旁路,CORS `OPTIONS` 放行。

  **盲区(明说,勿当已核):** `cloud` 仓在本会话与前序普查会话中**均未挂载**(`add_repo`
  两次被拒),调用方普查**不覆盖该仓**。若 `cloud` 内存在直打 `/api/v1/packages/*` 或
  dispatcher `/packages` 且今天不持 `manage_metadata` / D4 读集的生产调用方,本门可能将其
  403 —— 落地后需在 `cloud` 补一次调用方普查复核。`#7020` 记录的「门能力集 ≠ D4 掩码豁免集」
  对齐方向仍归维护者,本次不动。

- d586366: fix(rest): a public form that declares no fields now REFUSES the submit instead of accepting every key the caller sent (#6920)

  `POST /api/v1/forms/:slug/submit` narrows a visitor's suppliable keys to the
  fields the matched FormView's `sections` declare — and the filter read
  `allowedFields.size === 0 || allowedFields.has(k)`. For a form with no declared
  fields that limb degenerated, and not into "every field of the object": it
  accepted **every key the caller sent**, minus the `#3022` server-managed anchors
  and the three prototype keys. Measured on the real registered handler,
  anonymously, against a `sections: []` form:

      submit accepted = ["email","internal_margin","internal_tier",
                         "not_even_a_field","status","subject"]

  `not_even_a_field` is not declared on the target object at all. So an anonymous
  visitor could set `status`, a workflow stage, an internal tier — anything, on
  the one object the form targets. `publicFormGrant` (ADR-0056) keeps the insert
  scoped to that object, so this was never a cross-object hole; it was an
  unbounded **column** surface on one. The way in is an ordinary authoring
  mid-state: the author creates the public form and wires its sections later.

  **What changes.** A form whose sections declare no fields now answers
  `400 VALIDATION_ERROR` and inserts nothing. The message names the empty
  declaration and gives the author's fix ("wire the fields it collects into the
  form's sections"); it names no object, field or slug, because this reply is
  readable by anyone on the internet. The three authoring shapes that reach it —
  `sections: []`, sections present but declaring no fields, and `sections` omitted
  — are treated identically, and the refusal keys off the **declaration**, not the
  body, so an empty POST is refused too rather than inserting a blank row.

  `VALIDATION_ERROR` is the standard ADR-0112 catalog's generic validation
  failure, and what `HttpStatusErrorCodeMap[400]` already names a bare 400. It is
  deliberately not a newly minted `FORM_*` synonym of a condition the catalog
  already covers.

  **Why a refusal and not a silent drop.** Dropping the keys would have kept the
  `201` and changed no wire status, but it would swallow data the caller believes
  it wrote — a visitor is told their support ticket was filed and an empty row is
  stored. Loud is also the only answer that reaches the author, who is the one who
  can fix it.

  **This is a behaviour change on a shipped success path.** A deployment that
  today collects submissions through a section-less public form starts getting
  `400`s. That form's read side already publishes nothing (`fields: {}`) since
  `#6601`, so it cannot render either — the two planes now enforce the same rule,
  "the form declares what it collects", on both. **Fix: declare the fields in the
  form's `sections`.** Forms that already declare sections are entirely
  unaffected — that path never consulted the removed limb.

  `#3022`'s anchor guarantee is preserved unchanged: `owner_id`,
  `organization_id`, `id` and the audit columns remain unsuppliable on this
  surface, including when a FormView mis-declares one in a section.

- 54fe9d5: fix(rest): 未声明字段的公开表单不再向匿名调用者发布目标对象的**全部**字段(#6601)

  `GET /api/v1/forms/:slug` 会把目标对象的 schema 一并内嵌进应答,好让匿名前端不必再走
  一次需要鉴权的 `/meta` 就能渲染表单。收窄的依据是表单 `sections` 声明的字段集合,但那段
  代码写的是:

  ```ts
  if (allowed.size === 0 || allowed.has(name)) {
    fields[name] = def;
  }
  ```

  `allowed.size === 0` —— 表单**没有 sections**,或者 sections 一个字段都没声明 —— 会
  落到「发布该对象每一个非 server-managed 字段」这一支。**这条路由是匿名的**,所以发出去的
  是完整的字段定义:label、type、picklist 的选项值(常常就是一份运营分类表)、formula
  表达式(定价/评分 IP)。下方的 `safeForm` 只过滤表单自己的 `sections`(未声明
  `publicPicker` 的 lookup),它与 `objectSchema.fields` 是同一份应答上的两个并列键,从不
  收窄后者。那段代码上方注释里的「limited to fields referenced by the form」在这一支上是
  不成立的;注释同时提到的「submit 侧仍有服务端字段白名单」是**写**侧防线,挡不住**读**侧
  的披露。

  「表单先建、sections 之后再配」是完全正常的编写中间态,所以这不是一个刁钻配置。
  ADR-0106(#3682)刚刚让平台能完整地讲出「调用者读不到的字段,对它而言在任何平面上都不
  存在」这句话,而这条路由是它剩下的那个反例,且调用者是**匿名**的。

  **行为变化(线上可见)。** 发布集合现在等于表单声明的字段集合本身:

  ```ts
  if (!allowed.has(name)) continue;
  ```

  一个字段都没声明的表单,`objectSchema.fields` 就是 `{}`。应答的信封形状不变
  (`objectSchema` 仍是 `{ name, label, fields }`,不会变成 `null`),`object` /
  `label` / `form` 几个键也都不变。**已经正常声明了 sections 的表单,应答逐字节不变** ——
  它们本来走的就是 `allowed.has(name)` 那一支。

  这里没有新增任何可编写的键。发布应当是一次**声明**,而不是从空集合里掉出来的默认值
  (AGENTS.md「Explicit composition over default magic」);真需要「整对象发布」的场景,
  带着真实用例来提,再按 ADR-0049「没有需求牵引就不造能力」的顺序决定要不要造这个开关。

  `PUBLIC_FORM_SERVER_MANAGED_FIELDS` 的处理(#3022 的 server-managed 锚点)完全未动,
  `POST /forms/:slug/submit` 与 `GET /forms/:slug/lookup/:field` 也都未动。

- 361bd5b: fix(spec,rest): three routes stop serving shapes their `responseSchema` never declared (#5882 #5950 #6442)

  Sweep #6487. One admission criterion: a route serves a response shape its
  declared `responseSchema` does not describe. Three members, one direction each,
  stated per member rather than picked for cheapness.

  **`GET /meta/:type/:name` — the ADR-0010 protection envelope is now declared
  (#5950).** The uncached branch has always sent `lock` plus nine siblings on top
  of `{ type, name, item }`, and `GetMetaItemResponseSchema` declared only the
  three, so `.parse()` silently stripped every one of them. `lock` is the READ
  half of the ADR-0008 optimistic-concurrency chain whose write half `#5745`
  already declared — leaving it undeclared meant an SDK caller had to cast to read
  it, the consumer-side tolerance Prime Directive #12 rejects. All ten keys are
  declared **optional**, measured rather than assumed: the cached branch (the
  default, `enableCache: true`) rebuilds the envelope as three keys and resolves
  no lock at all, so `optional` here means "this branch did not publish it", never
  "unlocked". Zero runtime change. Whether lock presence should depend on a cache
  setting at all is the larger question #5950 raises and is deliberately left open.

  **`?layers=true` becomes `GET /meta/:type/:name/layers` (#5882).** The flag made
  one route answer two unrelated resource representations — the ordinary envelope,
  and a three-layer diagnostic projection (`code` / `overlay` / `effective`) that
  drives Studio's "code default vs override vs effective" tabs — while the route
  declared a single `responseSchema`. Anything generating a client from the route
  table wrote a parser that was simply wrong for the flagged call. Per the
  maintainer's ruling the projection gets its own path and its own
  `GetMetaItemLayeredResponseSchema`: one path, one shape. The alternative —
  teaching the route declaration to express "two shapes chosen by a query flag" —
  was rejected as a new primitive every future tool would have to understand, and
  conditional response selection is exactly where codegen and AI-written clients
  go wrong.

  The `?layers=` spelling still answers the identical body during a deprecation
  window (both entry points run one helper, so the two cannot drift), and now
  carries `Deprecation: true` plus a `Link` header naming its successor. No
  `Sunset` date: choosing the hard cut-off is a maintainer call.

  **`GET /analytics/meta` narrows to what it serves (#6442).**
  `AnalyticsMetadataResponseSchema.data` declared `{ cubes: CubeSchema[] }` while
  both implementations of `AnalyticsService.getMeta` return a bare `CubeMeta[]`
  that the runtime hands to `success()` verbatim. A client written against the
  published contract read `data.cubes` and got `undefined`; validating a live
  response against the schema failed outright. Per the maintainer's ruling the
  declaration narrows to the `CubeMeta[]` projection — zero runtime change — and
  the generated `references/api/analytics.mdx`, which was publishing the wrong
  shape, corrects itself. If a dashboard ever needs `format` or `description`, the
  recorded return path is to add the key to the `CubeMeta` projection (additive);
  widening the endpoint back to full cube definitions would push each cube's `sql`
  to clients and is not revisited.

### Patch Changes

- 121852d: Metadata-plane FLS: the ADR-0106 D4 read exemption is now **derived** from the #6603 write-capability gate, so "whoever can write a schema can see all of it" is enforced by construction (#7020).

  The two sets used to be maintained separately and were in fact different: the write gate demands `manage_metadata`, while the D4 exemption listed `studio.access` / `setup.access`. They met only on the shipped `admin_full_access` set, which carries all three — so the invariant #6603's ruling stated held by coincidence, not by construction. A caller holding `manage_metadata` alone passed every metadata write gate and still read a **masked** object schema, and its GET, edit and PUT round trip then deleted the fields it was never shown.

  `OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` is now the union of two named halves — `OBJECT_SCHEMA_WRITE_CAPABILITIES` (the write gate's key, spelled once) and `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` (`studio.access` / `setup.access`) — both newly exported from `@objectstack/metadata-core`.

  **Behaviour change:** a caller holding `manage_metadata` now reads object schemas unmasked on every schema-serving exit. This widens read access for that cohort and is the ruled intent (maintainer, 2026-08-10). The derivation is one-directional: no principal loses read access, and the `/packages` read cohort (#7033 / #7023) keeps its own separately-ruled set.

- de6b7f1: fix(rest): dashboard 组件门禁在默认配置下真正执行 (#5881)

  ADR-0057 D10 的 `requiresService` 组件门禁 —— 剔除指向未注册可选服务的 dashboard
  磁贴 —— 在默认部署里一次都没跑过。`GET /meta/:type/:name` 的单条读取有一条缓存分支,
  它排除了 `app`(per-user RBAC 过滤)与 `doc` / `book`(per-caller audience),唯独没有
  排除 `dashboard`;而 `enableCache` 默认为 `true`。门禁写在非缓存分支里,于是只有显式
  关掉缓存的部署才会执行到它。

  后果正是该 ADR 点名要防的那一幕:在没有某个可选服务的部署里(比如单租户运行时里的
  Organizations KPI,其 `org-scoping` 服务不存在),console 会渲染一块绑定到缺失服务的
  死磁贴 —— 尽管服务端的门禁代码在、测试也在。

  **修复**:`dashboard` 与 `app` 同款,从缓存分支排除,两种拼写(`/meta/dashboard/x`
  与规范复数 `/meta/dashboards/x`)都覆盖。其它元数据类型的 ETag 快路径不受影响。

  **为什么不是"把门禁提到分支之外、两条路径共用"** —— 那读起来更整齐,但 ETag 无法承载
  门禁结论:validator 是**未过滤文档**的哈希,而 `notModified` 在 protocol 内部就已判定,
  REST 层没有机会重判。共用之后送出的就是"过滤过的正文 + 指向未过滤正文的 validator"。
  一次 boot 之内这没有危害(已注册服务集在 bootstrap 之后不可变),但 `Cache-Control:
private, no-cache` 意味着客户端**存下正文**、之后只做重验证,而存下的正文比进程活得久:
  一次关掉该可选服务的重新部署并不改变文档,ETag 不变 ⇒ 每次重验证都回 304 ⇒ 那块死磁贴
  恰好在移除其服务的那次部署之后被永久缓存下来。放弃快路径的代价则接近于零:
  `getMetaItemCached` 本就委托给 `getMetaItem`,服务端两条路做的是同样的工作,失去的只是
  304 省下的正文字节。

  对调用方的可见变化:dashboard 的单条读取不再返回 ETag / 304,每次都是完整的 200。

- d9bef45: fix(spec,rest): `OVERLAY_PERSISTENCE_FAILED` leaves the error-code ledger — it lost its only producer (#5783)

  `ERROR_CODE_LEDGER` registered `OVERLAY_PERSISTENCE_FAILED` under
  `@objectstack/metadata-protocol`, but nothing in the repository can emit it any
  more. Its one emission point was the `catch` inside `saveMetaItem`'s legacy
  raw-engine branch, and #5264 (PR #5782) deleted that branch. A registered code
  with no producer is ADR-0112's "no silent fourth state" read backwards: the
  vocabulary promises a client a code no response can carry, and the ledger's own
  admission test cannot notice, because it checks casing, duplication and
  shadowing — never whether anyone still throws the code.

  Verified before removing: a declaration-and-emission search over `origin/main`
  finds the name only in the ledger row itself, two generated reference pages, one
  `rest-server.ts` comment, one historical changeset plus its CHANGELOG entry, and
  two `packages/rest` tests that construct the error themselves. No producer, and
  no consumer — including `objectui` and `cloud`, both searched at their
  `origin/main` — reads the literal. Removal only shrinks a dead row: nothing
  gates an emission on ledger membership, so no runtime or gate starts rejecting
  anything it accepted before.

  **Wire impact: none.** No response carried this code, so no client can lose one.
  The narrowing is type-level: `ErrorCode` (`StandardErrorCode` ∪ the ledger, what
  `ApiErrorSchema.code` validates) no longer admits the string, so TypeScript
  would now reject `code: 'OVERLAY_PERSISTENCE_FAILED'` at a call site — and there
  is no such call site left to reject.

  Note for whoever compiles the release: #5437's changeset
  (`rest-5xx-message-withheld.md`) names this code as one of two examples of a
  `code` that "still rides on the response". That sentence was accurate when it
  was written; the other example, `NOT_IMPLEMENTED`, is unaffected and still
  demonstrates the same behaviour.

  The two `packages/rest` tests that asserted `resolveErrorResponse`'s handling of
  a declared 5xx keep their substance and switch to a producer that still exists —
  `metadata-protocol`'s `batchData` atomic refusal (`501` / `NOT_IMPLEMENTED`) and
  the surviving overlay-delete `500`. Three stale comments are corrected in the
  same pass: the `agent` entry in `metadata-plugin.zod.ts` (which described a
  routing mechanism replaced by #5086's 403 refusal), the reachability argument in
  `rest-5xx-message-sanitization.test.ts`, and `resolveErrorResponse`'s own
  docblock in `rest-server.ts`.

- 82da264: feat: declare `ExecutionContext.authGate`, so the ADR-0069 gate sits inside the closed field set (#7280)

  The ADR-0069 authentication-policy gate (expired password, enforced MFA) rode
  the execution context **undeclared**: REST's `computeExecCtx` spread it onto the
  assembled envelope with `...(authGate ? { authGate } : {})` behind an `as any`,
  and its `enforceAuth` read it back ten lines later. Nothing was broken — but the
  closed entry field set shipped in #6216 is derived from `keyof ExecutionContext`,
  so a field that exists only inside an `as any` is **outside every closure gate by
  construction**: `ENTRY_EXECUTION_CONTEXT_FIELDS` could not list it,
  `ExecutionContextEntryFields` could not demand it, and the runtime pin that
  reconciles the closed set against `ExecutionContextSchema.shape` could not see
  it. It was the exact blind spot that gate exists to remove, sitting one `as any`
  outside it.

  **@objectstack/spec** declares the field:

  ```ts
  authGate: z.object({ code: z.string(), message: z.string() }).optional();
  ```

  Both inner keys are required, matching the sole producer
  (`AuthManager.computeAuthGate`, which sets both on every return branch) — `code`
  is the stable machine code a client branches on, `message` is what the blocked
  user reads, and the transport seam renders both as the `403` body.

  **@objectstack/core** picks it up as an ENTRY-decided field — it is resolved from
  the request's own session at the transport entry point, never written mid-request
  — so `ExecutionContextAssemblyInput` gains a **required** `authGate` input on the
  same footing as `accessToken`: every face states its decision instead of omitting
  it. A guest principal never carries one (no authenticated session for a policy
  gate to attach to). Also exported: `normalizeAuthGate`, which completes a session
  user's loose `authGate` into the declared shape at the one producer rather than
  tolerating a partial shape downstream — a gate naming a `code` but no `message`
  no longer renders a `403` body with `message: undefined`. `AuthGate` is now
  derived from the schema instead of being a second hand-written declaration.

  **@objectstack/rest** passes the resolved gate as an assembler input and drops the
  post-assembly spread; the remaining `as any` covers `__kernel` alone.
  **@objectstack/runtime** (the runtime / MCP dispatcher) passes `authGate:
undefined` on the record: it enforces the same gate at its own seam
  (`HttpDispatcher.enforceAuthGate` re-reads the session and calls
  `evaluateAuthGate`) and never reads `context.authGate`, so carrying it there
  would be a second copy no consumer reads.

  **No runtime behaviour change on either surface.** The shared assembler omits
  `undefined`-valued keys, so the key is present exactly when it was before. The one
  new behaviour is the normalization above, on a shape the sole producer never
  emits today.

- f586f1a: refactor: one shared `ExecutionContext` assembler, two named anonymous entries (#6216)

  `resolveAuthzContext` already made AUTHORIZATION resolution single-sourced; the
  step after it — turning the resolved envelope into the `ExecutionContext` that
  reaches enforcement — was still one hand-written copy per transport, and the
  copies drifted twice for real: **#6071** (the REST copy never set
  `principalKind`, so every enforcement judgment reading it was silently
  never-true on that face) and **#6206 / #6551** (a dropped `accessible_org_ids`
  produced real 403s on the share-link faces).

  **@objectstack/core** gains the single assembly, with the anonymous divergence
  as named API rather than drift (maintainer ruling 2026-08-08 on #6216, Option
  A):

  - `assembleExecutionContext(input)` — the **fail-closed default** entry. No
    resolved principal → `undefined`, and the surface answers 401.
  - `assembleExecutionContextOrGuest(input)` — the **explicit guest** entry. No
    resolved principal → a first-class guest envelope (`principalKind: 'guest'`,
    `positions: ['guest']`), whose consumers are live (`explain-engine`'s
    guest ⇒ `EXTERNAL` posture floor). Adopted only by a surface whose product
    semantics serve anonymous principals.
  - The field set is **closed by type**: `ExecutionContextEntryFields` requires a
    decision for every `ExecutionContext` field that is not explicitly declared
    non-entry-resolved, so a new field cannot reach one transport and miss
    another. Also exported: `ENTRY_EXECUTION_CONTEXT_FIELDS`,
    `EntryExecutionContextField`, `ExecutionContextAssemblyInput`,
    `OAuthTokenProvenance`, `EntryLocalization`.

  **@objectstack/runtime** (`resolveExecutionContext`, the runtime / MCP
  dispatcher) and **@objectstack/rest** (`computeExecCtx`) now assemble through
  that module — the dispatcher via the guest entry, REST via the fail-closed
  default.

  **No runtime behaviour change on either surface.** The remaining per-face
  divergences are required inputs rather than silent omissions: REST passes
  `accessToken: undefined` (it has never carried the session bearer on the
  envelope, and `session.accessToken` is a published hook surface) and
  `oauth: undefined` (OAuth bearers are honoured on the `/mcp` door alone). The
  one measurable difference is that a key whose value was `undefined` is now
  omitted rather than spelled — invisible to `ctx.x` reads, to `JSON.stringify`
  and to spreading the envelope.

- 53ef057: fix(rest,objectql): the import dry run asks the engine for its verdict instead of predicting it (#4633 ruling D)

  `POST /api/v1/data/:object/import?dryRun=true` green-lit rows the very same
  endpoint then rejected. Measured on 17.0.0-rc.1: a CSV cell aimed at a
  structured `address` field reported `{ ok: 1, created: 1 }` on the dry run and
  `{ errors: 1, code: 'VALIDATION_FAILED' }` on the real write.

  The dry run predicted the write's verdict with a hand-copied mirror of a slice
  of the engine's rules (`import-coerce.ts`'s `firstMissingRequiredField` and
  `firstConstraintViolation`). A copy cannot structurally keep up with the family
  it mirrors: ADR-0104 value shapes (`address` / `location` / references / media),
  `format` checks, object-level `validations` and the state machine had no
  counterpart, and `coerceFieldValue` routes structured shapes through its
  pass-through catch-all, so no verdict was formed at all.

  **The mirror is retired.** The dry run now calls `DataProtocol.validateData`
  (#6037), which runs the same `validateRecord` / `evaluateValidationRules` that
  `insert()` runs, under the deployment's own ADR-0104 posture — so a bad value
  shape is an error on a self-certified deployment and an admitted warning on a
  warn-first one, exactly as on the write. Agreement is by construction, not by a
  copy kept in step by hand.

  Also in this change:

  - **`engine.validate()` now resolves `defaultValue`s and seeds owned roll-up
    `summary` fields before validating, on `insert` mode**, because `insert()`
    does. Without it a required-but-defaulted column left unmapped was previewed
    `failed` and written `created` — a false alarm on the row a preview is meant
    to reassure you about. `update` mode still does not default (#2706).
  - **A row report failed by validation now names the offending column.** The
    engine's `ValidationError` carries `fields[]`, so the row's `field` is set and
    its `code` is the field-level code (`required`, `min_value`, `max_length`,
    `invalid_type`, …) rather than the wrapper's `VALIDATION_FAILED`. This is the
    same vocabulary the dry run and the per-cell coercion failures already spoke;
    before, a `min: 0` violation was `min_value` on the dry run and
    `VALIDATION_FAILED` on the write.
  - **Dry-run rows may carry `warnings[]`** — findings this deployment admits
    rather than rejects (ADR-0104 warn-first). The row is `ok`, and the complaint
    is visible instead of living only in a server log line.

  A protocol that does not implement `validateData` (plugin-auth's identity
  import, whose write is better-auth rather than the engine) is not handed a
  substitute: its dry run reports coercion and create/update/skip resolution only.
  An engine-derived preview of a non-engine write would report findings that write
  never produces.

- a92b179: rest 的异步导入行数上限改为直接读取 spec 的 `IMPORT_JOB_MAX_ROWS` 导出，不再自己声明一份同值字面量（#6535）。

  **行为没有任何变化**：两处此前都是 `50_000`，改后仍是 `50_000`，上限、`413` 文案、拒绝边界全部不动。
  这是一次一致性收敛，不是缺陷修复——因此按 patch 计。

  收敛掉的是一处漂移面：`packages/spec/src/api/export.zod.ts` 的那份导出带着 TSDoc，是这个
  上限的**对外说明**（喂给生成的 reference 表面）；而真正执行拒绝的是 `packages/rest`，它此前
  读的是自己那份本地 `const`，两者之间只有一句 "mirrors spec" 注释相连。没有任何 gate 比较这
  两个数——`api-surface/api.json` 只记下 `"IMPORT_JOB_MAX_ROWS (const)"` 这个**名字**，不记它的
  **值**——所以把 spec 那份改成 20_000、执行侧纹丝不动，`pnpm test` 与全部 `check:*` 依然全绿
  （本 PR 实测过）。失效方向是文档说一套、系统做一套，而 `413` 文案里内插的又是 rest 那一份，
  连报错都会自洽地说谎。现在一处定义、两处读点（`maxRows:` 与 `413` 文案）同源。

- 07383fe: REST: a declared 5xx status now survives on the CRUD data routes

  `mapDataError`'s explicit-status passthrough accepted only 4xx, while
  `resolveErrorResponse` (the door every metadata/UI/discovery/batch route uses)
  accepts 400-599. The same thrown error therefore got two different answers
  depending on which route caught it, and on the data routes a producer's
  declared 5xx was overwritten — the status re-derived from the message text, or
  falling through to `500 INTERNAL_ERROR`.

  The passthrough is now 400-599 on both doors, with the same disposition #5437
  already ruled for a declared server fault: **keep the status, keep the
  machine-readable `code`, drop the prose**. The `code` half reads
  `declaresServerFault` from `@objectstack/types`, so an empty or non-string code
  is not mistaken for an ADR-0112 declaration and nothing is invented when the
  producer named no code.

  User-visible effect: an aggregate function a SQL backend cannot compile
  (`count_distinct` / `array_agg` / `string_agg`) now answers
  `501 NOT_IMPLEMENTED` instead of `500 INTERNAL_ERROR`, and an upstream/
  dependency `502` / `503` reaches the caller as itself rather than as a generic 500. The 4xx half is unchanged (wording truncated, `object` retained), no 5xx
  message text reaches the client, and the withheld text still reaches the
  operator log.

- 870f90c: REST: the `/meta` write routes' 501 refusals now speak the ADR-0112 error envelope

  `DELETE /meta/:type/:name`, `PUT /meta/:type/:name` and `PUT /meta/:type/:section/:name`
  answer 501 when the protocol implementation lacks the corresponding method. Each
  answered that refusal in a different shape: the `DELETE` sent a bare-string
  `error` with no code at all, and the two `PUT` twins sent the code as a _sibling_
  of `error` rather than inside it — while `POST /meta/_migrate-stored`, a few
  hundred lines away in the same file, already sent the ADR-0112 nested shape for
  the same condition.

  All four now answer `{ error: { code: 'NOT_IMPLEMENTED', message } }`, so
  `err.error.code` — the position ADR-0112 declares — resolves on every one of
  them. `NOT_IMPLEMENTED` is unchanged and needs no new catalog entry: it is
  already the standard catalog's member for 501.

  **Wire-visible** for a caller running a kernel that does not implement metadata
  writes. A client that read `err.code` (the sibling position) on the two `PUT`
  routes must read `err.error.code` instead; a client that read `err.error` as a
  string on the `DELETE` route must read `err.error.message`. No in-repo or
  objectui consumer read either retired position.

- 83a3b1f: fix(rest): `GET /meta/books/:name` no longer bypasses the ADR-0046 §6.7 audience gate (#6241)

  The single-item metadata read has a cached branch and an uncached one, and the
  ADR-0046 §6.7 audience gate lives in the uncached one. The comment above the
  cached branch's entry condition has always stated why `doc` and `book` must skip
  it:

  > `doc` and `book` bypass the shared cache: their §6.7 audience gate is
  > per-caller, and a shared ETag would leak gated content across viewers.

  The condition beneath that sentence compared the **raw** `:type` path segment
  against the literals `'doc'` / `'book'`. The route serves both spellings, and
  Prime Directive #3 makes the **plural** one canonical — so
  `GET /api/v1/meta/books/:name` did not match the exclusion, took the cached
  branch, and the audience gate never ran. `enableCache` defaults to `true`, which
  made the failing path the default one.

  Measured against a real `RestServer` — one book declaring
  `audience: { permissionSet: … }`, one signed-in caller holding no permission
  set:

  ```
  singular "book"  :: cachedCalls=0 status=[403] PERMISSION_DENIED
  plural   "books" :: cachedCalls=1 status=[]    full gated body served
  ```

  Same book, same caller, two spellings of one route. `GET /meta/docs/:name` took
  the same path. This was **fail-open**: the wrong outcome is disclosure of gated
  documentation, not an availability error.

  **The fix is structural, not two corrected literals.** This is #3984 recurring
  in the same file eight days later, so the handler now normalizes the type
  **once** at the top (`RestServer.metaTypeSingular`) and every gate below reads
  that local — a per-type gate added later has no raw param in scope to compare
  against by accident. The cache exclusion and the §6.7 gate now read one shared
  predicate, so "which types bypass the cache" and "which types are audience
  gated" can no longer drift apart. A repository guard
  (`pnpm check:meta-type-normalized`, AST-based, zero exemptions) refuses the next
  raw comparison in `packages/rest/src`.

  **Behaviour change worth knowing:** `GET /meta/docs/:name` and
  `GET /meta/books/:name` now take the uncached branch, as their singular
  spellings always did, so those two responses no longer carry an `ETag` /
  `Cache-Control` validator and a conditional request no longer answers `304`. No
  other metadata type is affected. The cost is only the 304's saved bytes —
  `getMetaItemCached` delegates to `getMetaItem`, so the server does identical
  work either way — and the ETag it gave up was a hash of the **unfiltered**
  document, which is the cross-viewer leak the exclusion exists to prevent.

- 2443bb4: `/meta` reads localize the canonical PLURAL spelling, not just the singular

  The three metadata read handlers (`GET /meta/:type`, `GET /meta/:type/:name`,
  `GET /meta/:type/:section/:name`) handed the raw `:type` path segment to the
  translate helpers, whose "does this type translate" predicate reads a set derived
  from singular-only translator keys (`view` / `action` / `object` / `app` /
  `dashboard` / `page`). Prime Directive #3 makes plural the canonical REST
  spelling, so a caller following the documentation received unlocalized
  labels/descriptions/navigation while the singular spelling of the same route
  returned the translated document.

  `translateMetaItem` / `translateMetaItems` now fold the spelling to the canonical
  singular before asking, so both spellings answer the same localized body. The set
  of translatable types is unchanged — only which spellings reach it.

- 91cefb8: refactor(types,rest,metadata,analytics): Postgres 的 `"x" of relation "y"` 短语收归一处，三个包不再各修一遍同一个超串洞（#6615）

  Postgres 把「关系内部某个子对象」的失败写成 `column "label" of relation "sys_team" does not exist`——里面**逐字包含**一句合法的「表不存在」短语 `relation "sys_team" does not exist`，含义却相反：关系正因为存在才被点名。任何对「这句话是不是在说表没了」的正则收紧都消不掉这个匹配，短语确实在里面；唯一的修法是**先问更具体的问题**。所以修的是**顺序**，不是模式。

  正因为如此，这个短语被分三次教给了这个仓库，分属三个包、三个 PR，其中两次是在别处已经踩过同一个洞之后：`@objectstack/rest` 的 `mapDataError`（#5352）、`@objectstack/service-analytics` 的缺列扣除（#6035 / PR #6346）、`@objectstack/metadata` 的 `MISSING_TABLE.excludes`（#6347 / PR #6613）。本次把它收进 `@objectstack/types`，与 `isUniqueViolationError`（#6250）和 `isModuleNotFoundError`（framework#3265）同一个理由与同一个位置。

  **两种宽度，故意保留成两个导出。** 三个消费者要的并不是同一条正则，差别也不是随手写的，而是**每个站点哪个方向的误差是安全的**：

  - `matchMissingColumnOfRelation(message)` —— 严格提取器，锚定 Postgres 的 errmsg 模板 `column "%s" of relation "%s" does not exist`，返回列名。`rest` 用它把 42703 答成 `400 INVALID_FIELD` 而不是 `404`；`service-analytics` 用它在分类前扣除缺列。这两处**过宽**会把真正缺失的表变成硬失败、回退 #5033 刻意保留的宽容，**漏匹配**只是让消息含糊一点——所以必须严格。
  - `isRelationSubObjectPhrase(message)` —— 宽检测器，丢掉 `column` / `[a-z0-9_]+` / `does not exist` 三个锚点：任意子对象、任意带引号标识符、任意判词。`metadata` 用它做排除。这一处**过宽**只会把良性判定变成响亮判定，**漏匹配**却会让 `event_seq` 从 1 重新开始、撞进一张已有行的历史表——方向正好相反。

  把两者合并成一条正则，无论哪种宽度胜出都会对其中一个调用方是错的；这是卡片记录在案的风险，两个导出即为此而设，理由是承重的而非风格的。仓库里第四份拷贝（`service-analytics` 测试内用于守护 fixture 的那条正则）同时收编：它本是为「两张面孔别对不上」而写，却把断言打在其中一面的私有复述上，因而正是它要防的漂移。

  行为逐字保持不变：搬进来的两条模式与原站点逐字节相同。`@objectstack/service-analytics` 因此新增一条对 `@objectstack/types` 的依赖边——这是本次唯一的依赖变化，构造上无环（`@objectstack/types` 只依赖 `@objectstack/spec`，后者无仓内依赖），且仓库 73 个包中已有 25 个、16 个 service 中已有 5 个携带同一条边。

- 2c2a212: fix(reports): owner-gate the saved-report schedule routes (#2980)

  The report read/run/delete routes are owner-isolated (a caller may only touch a
  report they own, denied as `REPORT_NOT_FOUND` to avoid leaking that the id
  exists), but the two schedule routes bypassed that gate: `unscheduleReport` and
  `listSchedules` took the caller `context` as `_context` and never consulted it,
  querying under the system context (RLS-bypassing). Any authenticated caller
  could therefore delete another owner's report schedule — a cross-owner
  destructive write — or list another owner's schedules (leaking recipient
  addresses and cron), by supplying an id.

  Both now resolve the schedule's parent report and require the caller to own it,
  mirroring the sibling routes:

  - **`unscheduleReport`** loads the schedule, then its report, and deletes only
    when `canAccessReport` holds; a cross-owner attempt throws `REPORT_NOT_FOUND`
    (mapped to `404` by the REST layer, deny-as-404 anti-enumeration), while a
    genuinely-absent schedule stays idempotent. `scheduleReport` (create) was
    already gated via `getReport`, so only the delete/list doors were open.
  - **`listSchedules`** returns an empty list to any non-system caller who cannot
    access the report it is scoped to — the same non-leaking posture as
    `listReports`. The scheduler's system context still sees every schedule.

  No authoring-surface or metadata change; existing owner-path behavior is
  unchanged.

- 773f80a: fix(rest): REST 面的执行上下文补齐 ADR-0090 D9/D10 的 principal 分类(#6071)

  `resolveAuthzContext`(`@objectstack/core`)被提取出来,正是为了让两个 HTTP 入口
  不再在**授权**上漂移。但它之后的一步 —— 把授权信封组装成 `ExecutionContext` ——
  仍是两份手写副本,而两份的字段集已经不一致:runtime / dispatcher 那份
  (`packages/runtime/src/security/resolve-execution-context.ts`)按 ADR-0090 D9/D10
  设置 `principalKind`(必要时连同 `onBehalfOf`),`rest-server.ts` 的 `computeExecCtx`
  两个都不设。

  后果不在装饰面而在 enforcement 面:`plugin-security/explain-engine.ts` 的
  posture 下限、`security-plugin.ts` 的 agent 基线、`observability/perf-timing.ts`
  的披露闸门都读 `principalKind`,于是同一个请求走 dispatcher 与走 REST 会拿到不同
  的上下文,读这个字段的判断在 `os serve` / `dev` 的数据与元数据路由上**从不成立**。
  问题由 #5859 实施时的 dogfood 全栈 boot 插桩测得:到达消费方的键集里 `__kernel`
  在(自证是 rest-server 这条组装路径)、`principalKind` 不在。

  本次改动只补这一个传输上缺的字段,口径与 runtime 侧完全一致:

  - 会话(cookie)或 API key 背书的主体 ⇒ `principalKind: 'human'` —— 与 runtime
    侧「an authenticated (API-key) request resolves as a human principal, never
    guest」的钉子同一判定。
  - `'agent'` 与随之而来的 `onBehalfOf` **在本传输上不可表达**:它需要一个指明已授权
    客户端的 OAuth access token,而该凭据只在 dispatcher 的 `/mcp` 门上被接受
    (`acceptOAuthAccessToken`),正是为了不让粗粒度的工具族 scope 溜进 REST。
  - `'guest'` 同样不可表达:`computeExecCtx` 在信封没有 `userId` 时就返回
    `undefined`,匿名 REST 调用者本来就拿不到任何上下文(随后被 `enforceAuth` 401)。
    **匿名面零变化** —— 不给匿名调用者凭空发一个 guest 上下文。

  行为差量(逐条核过,无一条改变授权结果):`explain-engine.ts` 的 guest ⇒ `EXTERNAL`
  与 `security-plugin.ts` 的 agent 分支在 REST 面仍不成立(前者的 `!context?.userId`
  前肢本就恒真,后者读 `'agent'` 标签、且真正的兜底是委托 LINK);`perf-timing.ts`
  只认 `'service'` / `'system'`,`'human'` 不开闸。唯一可观测的新增是 explain 输出里
  多回显一个 `principalKind: 'human'`(该字段在 explain schema 中本就是 optional)。

- f3f855a: Refuse a repeated single-valued query parameter instead of silently answering the wrong thing (#6877)

  `IHttpRequest.query` is declared `Record< string, string | string[] >`, and the array
  arm is produced by a real first-party adapter (`NodeHttpServer` hands `?x=1&x=2`
  through as `['1','2']`, measured over a socket). `rest-server.ts` read ~50 of its
  query parameters as if the union had one arm, so a repeated parameter was coerced
  into a _different_ value and served with a `200` rather than refused. None of it was
  a type error — every site laundered the array through `any`, `String()` or
  `Number()`.

  Two of the outcomes were inversions rather than degradations:

  - `PUT /meta/:type/:name?force=false&force=false` — the read fell through to
    `!!forceRaw`, and a non-empty array is truthy, so repeating an explicit **opt-out**
    switched the destructive-change guard **on**.
  - `GET /data/:object/export?limit=1&limit=2` — `Number([...])` is `NaN`, `NaN || 0`
    is `0`, `Math.max(1, 0)` is `1`: a **one-row export**, `200 OK`.

  Each affected handler now declares which of its parameters are single-valued, and a
  repeated one is refused with `400` and the ADR-0112 nested envelope
  `{ error: { code: 'VALIDATION_ERROR', message } }` — the same rule and message
  #6307 landed on `/api/v1/packages/:id`, now shared rather than duplicated. The rule
  counts occurrences, not values: a one-element array is one occurrence and is
  accepted (and unwrapped), an empty array is none, two identical values are still two.

  **Wire-visible**: requests that used to receive a wrong `200` now receive a `400`.
  No well-formed single-value request changes in any way.

  Parameters that are genuinely multi-valued are deliberately untouched and pinned by
  tests — `select` / `expand` on `GET /data/:object/:id` (whose consumer takes
  `string | string[]` by design), `objects` on `/search`, `fields` / `searchFields` on
  the export route, and `approverId` on `/approvals/requests`.

- f8fe47e: feat(runtime,rest,plugin-auth,service-i18n,service-storage): route-ledger 条目类型加可选 `responseSchema` (#5791)

  #3877 的「最小首步」，维护者 2026-08-06 已批。**纯增量、零行为变更**：五个 route
  ledger 的现有条目一行未改，字段缺省即「未声明」。

  ## 为什么是这一步

  #3877 量到的洞不是「发出的和声明的不一致」，而是**大多数路由根本没有可对账的声明**：
  237 条已挂载路由里 215 条是 `sdk` 面，而携带 schema 引用的是 **0 条**。于是同一单
  里裁定了两件事——Stage C（批量补 ~190 条响应 schema）**永不排期**（一条响应 schema
  是「这个端点承诺什么」的产品决定，批量生产正是 #3676 / #3833 / #3847 / #3870 四个
  缺陷的成因），以及先把「这条路由声明了什么」变成**可查询数据**，让 Stage D 的棘轮
  将来有东西可棘。本次落地的就是后者。

  ## 字段语义

  `responseSchema` 是 `@objectstack/spec/api` 导出名，指向该路由**响应载荷**的声明：
  路由套 `{ success, data }` 信封时指 `data`，不套时指整个 body。信封本身不归它管，
  由 `pnpm check:route-envelope` 结构化守住——一个字段无法同时诚实地描述两层。

  五个 ledger 是五个各自独立声明、按约定同形的 interface，因此是五处同名同措辞的可选
  字段，**不是**新建共享类型包。三个 ledger 明确要求保持 import-free（客户端守卫按
  相对**源文件**编译它们），且 `zod` 并非每个持有 ledger 的包的依赖，故字段存的是
  **名字**而非 live schema 对象，解析放在能 import spec 的守卫里。

  ## 已填的两条（实证，不是批量）

  只填 #5682 已给出双断言覆盖（safeParse 判**值** + 键集判**键**）的 discovery 族两条，
  且刻意分处两个 ledger，以证明一个字段形状确实服务五个独立声明的条目类型：

  - `packages/runtime` `GET /discovery` → `DiscoverySchema`（走信封，指 `data`）
  - `packages/rest` `GET /api/v1/discovery` → `DiscoverySchema`（裸发，指整个 body）

  `GET /api/v1` 这条 bare-base 别名**故意不填**：它与上面那条共用同一个
  `discoveryHandler` 闭包，但 #5682 的测试只驱动 `/api/v1/discovery`，「同一个 handler
  所以同一个形状」是对代码的论证而非对代码的测量。没有覆盖就不填。

  ## 新增守卫

  - `packages/client/src/route-ledger-response-schema.test.ts` —— 五个 ledger 的并集里
    每一个 `responseSchema` 都到**活的** `@objectstack/spec/api` 导出里解析，并且真的
    调用一次 `safeParse`（spec 的 schema 是 `lazySchema()` 代理，只查属性存在会被代理
    陷阱满足）。含否定对照（少一个字母的名字、空串、导出了但不是 schema）与反空转下界。
  - `discovery-schema-conformance.test.ts`（runtime / rest 各一）—— 钉住 ledger 报的
    schema 就是该套件实际解析用的**同一个对象**，并各自测量了载荷所在的层级。

- 129b378: fix(types,rest): one named answer for "which column conflicted" — an index name is never returned as one (#6544)

  #6250 retired four private "is this a unique violation?" vocabularies into
  `isUniqueViolationError`. It left the harder half of the question behind: the
  import runner's `sanitizeRowError` still carried its own three-dialect regex
  chain, because it does **more** than answer yes/no — it names the offending
  column so the importer can say _"A record with this `email` already exists."_
  This lands that second answer as a shared export and migrates the last private
  copy onto it.

  **New — `uniqueViolationColumn(error)` in `@objectstack/types`** (`string |
undefined`), sibling to `isUniqueViolationError` and gated on it, reading the
  same channels one step down the same bounded `cause` chain, plus
  node-postgres' `detail` field.

  **Its contract, per the maintainer's 2026-08-08 ruling: a value comes back only
  when the identifier the driver printed is determinably a COLUMN.** When a
  dialect names an _index_ instead — MySQL's `Duplicate entry … for key
'idx_email_unique'`, Postgres' `violates unique constraint "sys_user_email_key"`,
  SQLite's `UNIQUE constraint failed: index 'x'` — the answer is `undefined`,
  never the index name. Callers render this into a form field, and an index name
  mistaken for a column points the user at a field that does not exist, whereas
  `undefined` degrades to generic copy. A **composite** key (`Key (tenant_id,
email)=(…)`) is `undefined` for the same reason: there is no single offending
  column, and naming the first is the same class of wrong answer.

  **⚠️ User-visible change on MySQL imports.** MySQL's duplicate-entry message
  names the index and never the column, so the importer no longer names a column
  there: rows that used to read _"A record with this `idx_email_unique` already
  exists."_ — or, on MySQL 8's table-qualified `for key 'sys_user.email'`, a
  plausible-looking _`email`_ that was still an index name — now read **"A record
  with this value already exists."** That is deliberate and is the accepted cost
  of the ruling. The conflict is still recognised as a conflict; only the naming
  narrowed.

  Three smaller import messages improve in the same move, all previously wrong
  rather than merely vague:

  - SQLite's expression/partial-index form used to render as _"A record with this
    **index** already exists."_
  - Postgres' expression index used to render the truncated fragment _"A record
    with this **lower(email** already exists."_
  - A Postgres conflict with no `DETAIL:` line used to fall through to the SQL
    backstop and echo the driver's own sentence — index name included — at the
    importer. It now gets the same generic conflict copy, which is also the exact
    wording `mapDataError` puts in the 409 `UNIQUE_VIOLATION` body, so the
    importer and the API say one thing about one condition.

  Not changed: the NOT NULL branch, the raw-SQL backstop, and every non-conflict
  message, which pass through exactly as before.

- 88f9d94: fix(types,rest): one named unique-violation predicate — a MySQL conflict is 409 UNIQUE_VIOLATION, not 500 (#6250)

  **On MySQL, every unique-constraint conflict came back as `500 INTERNAL_ERROR`.**
  The API contract registers `UNIQUE_VIOLATION` as a 409 code
  (`packages/spec/src/api/error-code-ledger.zod.ts`), so a front end had no way to
  tell "this email is already taken" from "the server fell over" — no retry advice,
  no field to point at, and a 5xx in the operator's dashboards for what is an
  ordinary client outcome. SQLite and Postgres deployments never saw it, which is
  why it survived: their conflict prose happens to contain the words the mapping
  looked for.

  **Cause: the conflict verdict was nested inside a leak heuristic.** REST's 409
  branch lived inside the true-branch of `looksLikeInternalErrorLeak()`, keyed on
  the substrings `unique constraint` / `unique violation`. MySQL says
  `ER_DUP_ENTRY: Duplicate entry '…' for key '…'`, which matches no limb of that
  heuristic, so the conflict never reached the `if` at all and fell out of the
  terminal `UNCLASSIFIED_FAULT`. Two unrelated questions — "is this a conflict?"
  and "would echoing this text leak internals?" — had been fused into one, and
  MySQL is where they disagree.

  Measured on the previous release, through the real error mapper:

  ```
  mysql,    bare message       500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  mysql,    knex-wrapped SQL   500 DATABASE_ERROR  →  409 UNIQUE_VIOLATION
  postgres, SQLSTATE only      500 INTERNAL_ERROR  →  409 UNIQUE_VIOLATION
  sqlite,   message            409 UNIQUE_VIOLATION   (unchanged)
  postgres, message            409 UNIQUE_VIOLATION   (unchanged)
  ```

  So the hole was never MySQL-only: the mapping read one of the two channels
  drivers use. A Postgres error carrying SQLSTATE `23505` with unremarkable prose
  was a 500 as well.

  **New: `isUniqueViolationError(error)`, exported from `@objectstack/types`.** One
  named predicate replaces the substring test, reading every channel a driver
  uses — `code` (`23505` / `ER_DUP_ENTRY` / `SQLITE_CONSTRAINT_UNIQUE`), `errno`
  (`1062`), the message, and one step down the `cause` chain that pool and
  query-builder layers wrap with. Its vocabulary is the union of the four
  hand-written copies the repo already carried, so routing REST through it cannot
  narrow any verdict clients rely on today; an unrecognised error is never a
  conflict, because a false 409 tells an SDK not to retry and points the user at a
  value that is fine.

  **The internal-leak classifier is byte-identical.** The fix hoists the conflict
  question out of it rather than widening its criteria, so nothing else it guards
  is reclassified as safe-to-expose. And the 409 body is fixed text: MySQL embeds
  the offending user data in its message (`Duplicate entry 'a@b.com' …`) and
  Postgres the index and column names, none of which reaches the client. The full
  driver text still reaches the server log.

  No action needed. Clients that already handled `409 UNIQUE_VIOLATION` on SQLite
  and Postgres now receive it on MySQL too.

- 3fc2e48: fix(spec,rest,cli): validation diagnostics reach the real defect — named view-union branches, and `invalid_key` / `invalid_element` descent (#6391, #5389)

  Two cases where a refusal fired correctly but its _diagnostic_ could not reach the
  element that actually failed. Both fixes change the DIAGNOSTIC face only: every
  input that parsed before parses after, every input refused before is refused
  after, and each refusal keeps its issue codes (ADR-0112 / #6142 — a better
  diagnostic never weakens the envelope). Pinned in both directions.

  **#6391 — `ViewMetadataSchema`'s union members are now contractual.** Three of
  its four members were inline expressions with no name, so a consumer diagnosing a
  failure could only reach a branch by indexing the nested `invalid_union`
  `errors[]` **by member position**; objectui shipped exactly that and had to hold
  the coupling down with a canary test (objectui#3606 / PR objectui#3624). The
  union is now built from a named record:

  - `VIEW_METADATA_BRANCHES` — the branch names, in the union's own order;
  - `VIEW_METADATA_MEMBERS` — branch name → the schema the union actually holds
    (`viewItem` is identically `ViewItemWireSchema`, as before);
  - `selectViewMetadataBranch(body)` — which branch a body claims, by the
    discriminants the members already declare;
  - `diagnoseViewMetadata(body)` — the failing branch **named**, with that branch's
    own leaf issues and real field paths, so no consumer needs `errors[i]`.

  The union is **not** converted to `z.discriminatedUnion`. That would move the
  acceptance face — a discriminated union refuses an unknown discriminant outright
  where this one falls through all four members, and several of these shapes carry
  no discriminant at all. `ViewMetadataSchema` remains the only judge of
  acceptance; the dispatch only explains a verdict it did not make, and a pin
  asserts the two never disagree.

  **#5389 — `invalid_key` / `invalid_element` are descended, in all three
  consumers.** Zod hangs a failing record-key / map-element schema's real issues on
  `issue.issues` — the same shape as `invalid_union`'s `issue.errors`, one property
  name over. The family had already been fixed three times for `errors` (#4971,
  #5014, #5341) and none of the three consumers read `issues`, so both codes
  surfaced as a bare wrapper line with the prescription stranded in the payload.
  Now `formatZodError`/`formatZodIssue` (spec), `zodIssuesToFields` (the REST wire)
  and `formatZodErrors` (the CLI terminal) all descend it.

  Before / after, a `z.record` with a constrained key:

  ```
    ✗ fields.First Name: Invalid key in record
  ```

  ```
    ✗ fields.First Name: Invalid key in record
      ✗ fields.First Name: Invalid identifier. Must be lowercase snake_case …
  ```

  The expansion is strictly additive on every surface: the container's own line
  (and, on the wire, its own `{field, code: 'invalid_shape', message}` entry) is
  unchanged, and the leaves follow it. Unlike a union's branches — competing
  candidates, therefore ranked and capped — a container's `issues` are the one list
  the inner schema produced, so every one of them is reported.

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
- Updated dependencies [5fa04fb]
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
- Updated dependencies [121852d]
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
- Updated dependencies [f586f1a]
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
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [5e247fd]
- Updated dependencies [1a53a02]
- Updated dependencies [a954634]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
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
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
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
- Updated dependencies [129b378]
- Updated dependencies [88f9d94]
- Updated dependencies [1818998]
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6
  - @objectstack/observability@17.0.0-rc.6
  - @objectstack/service-package@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/observability@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/service-package@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- d9cac60: **BREAKING** — `GET /meta/:type/:name` now answers exactly one body shape: the
  `GetMetaItemResponseSchema` envelope `{ type, name, item, … }` that
  `packages/spec` has always declared for it. On the default configuration this
  endpoint used to answer the **bare metadata document** instead (#5563).

  ### What changed, and why it is breaking

  The route had two mutually exclusive branches with different response
  structures. The cached branch — reached whenever `metadata.enableCache` is on,
  which is the **default** (`enableCache: z.boolean().default(true)`) — served
  `getMetaItemCached`'s `result.data`, and that value has the envelope already
  stripped. The uncached branch served `getMetaItem`'s envelope. So the one shape
  the spec declared was the one a default deployment could not obtain, and the
  envelope surfaced only when the cache was off or when the read structurally
  bypassed it (`app`, `doc`, `book`, `?state=draft`, `?preview=draft`,
  `?package=`). Consumers had no correct static type — they sniffed at runtime or
  reached for `as any` (#5545 was blocked on exactly this).

  The dispatcher's `/meta` domain had the same split one layer down: the protocol
  resolver answered the envelope while the ObjectQL-registry and MetadataService
  fallbacks answered bare documents. Both fallbacks now wrap what they found,
  taking `type`/`name` from the request.

  ### Migration

  `GET /api/v1/meta/object/customer`, default configuration:

  ```jsonc
  // before — the bare document
  { "name": "customer", "label": "Customer", "fields": { /* … */ } }

  // after — the declared envelope; the document is verbatim under `item`
  {
    "type": "object",
    "name": "customer",
    "item": { "name": "customer", "label": "Customer", "fields": { /* … */ } }
  }
  ```

  - **Reading the body directly** (`fetch`, `client.meta.getItem`,
    `client.meta.getCached().data`): read the document at `.item`. Nothing inside
    it changed. `type` is the canonical singular metadata type name, so
    `/meta/objects/customer` and `/meta/object/customer` answer the same `type`.
  - **`useObject` / `useFields` (`@objectstack/client-react`)**: `useObject().data`
    is now the envelope — `data.item.label`, `data.item.fields`, where it used to
    be `data.label` / `data.fields`. `useFields()` is unchanged (it already
    returns the flattened field list) and is the shorter path when fields are all
    you need.
  - **`isMetaEnvelope`, exported from `@objectstack/rest`, is REMOVED.** It
    existed only to tell the two shapes apart. There is one shape now, so the
    replacement for `isMetaEnvelope(r) ? r.item : r` is `r.item`.
  - **Not converged, deliberately**: `?layers=true` still answers the layered
    diagnostic projection `{ type, name, code, overlay, overlayScope, effective,
validation }`. Collapsing three layers into one `item` would delete the
    diagnostic. Unaffected unless you pass that flag.

### Minor Changes

- 96d3d4d: The two machine-readable endpoint surfaces announce only the declarations the runtime actually serves

  `GET {basePath}/meta/api` and `GET {basePath}/openapi.json` enumerated declared `api` items
  through the metadata protocol (ObjectQL SchemaRegistry + `sys_metadata`). Whether a declared
  route is SERVED is decided by a different reader — `IMetadataService.matchEndpoint` and the
  endpoint matcher behind it, which sees the metadata manager's registry and its registered
  loaders. A real boot measured the two disagreeing: an `api` row written through
  `PUT /meta/api/{name}` was enumerated by both surfaces — the OpenAPI document publishing it as
  a path with `security: []`, i.e. as needing no credentials — while every request to it answered 404.

  Both surfaces now ask the matcher, per declaration, and announce only what comes back. An
  `/openapi.json` is what SDKs, codegen and AI clients generate from, so an endpoint advertised
  there that does not exist propagates into everything built on top of it.

  **What changes for you:** an `api` declaration that this runtime will not serve disappears from
  both surfaces. That covers a row created by a runtime/Studio metadata write rather than
  published from a stack artifact, and one excluded at load by the ADR-0121 publish gates (for
  example `authRequired: false` with no armed `rateLimit`). If a declaration you expected has
  vanished, it was already answering 404 — the surface has stopped mis-reporting it, and the
  server log now names each omitted declaration, its route, and why. Publish it through a gated
  path (a stack artifact, or `publishPackage` with the package's `manifest.namespace`) to make it
  real. Endpoints declared in a stack artifact are unaffected: they are served, so they are still
  listed and still documented in full.

  Two surfaces deliberately keep their previous behaviour: `GET /meta/api?preview=draft` answers
  "what is pending", which is by construction not the served set, and the single-item
  `GET|PUT|DELETE /meta/api/{name}` routes stay reachable so an unserved declaration can still be
  inspected and removed.

  Hosts that embed `RestServer` directly get a new optional final constructor argument,
  `metadataServiceProvider`, resolving the `metadata` service. `rest-api-plugin` wires it; a host
  that does not pass it keeps the old enumerate-everything behaviour and logs, once, that the
  surfaces can no longer promise they describe only served routes.

- 75f82f3: **`/openapi.json` 的 built-in 路由段改由 rest 按自身路由事实产出(#5588,维护者裁定 C 第一棒)**

  发布出去的 `GET {apiPath}/openapi.json` 里,built-in 路由那一段**一条都不存在**:真实 boot 逐条探测,7 条 path / 10 个 operation **0/10 命中**。段落由 `packages/spec/scripts/build-openapi.ts` 按字面量 `basePath = '/api'` 手写,于是路径全部缺 `/v1`(CRUD 还缺 `/data`);`PUT {object}/{id}` 写错动词,服务器对 `PUT` 明确回 405;`/api/meta/types` 全仓无此路由;`/api/.well-known/objectstack` 是 runtime dispatcher 的路由、服务在**根路径**上而非 API base 下。照这份文档生成客户端,每一个数据调用都 404。

  这个座位上也不可能写对:`apiPath` 是部署级配置(`api.apiPath ?? api.basePath + '/' + api.version`),随包发布的静态 JSON 无法为所有部署拼对前缀。

  **改法**:built-in 段的属主是**挂载这些路由的包**(ADR-0076 一路由一属主;本文档的属主由 #5078 的真实 boot 坐实为 `packages/rest`)。serve 期流水线现在从 `routeManager.getAll()`——路由器自己用来匹配请求的那张表,请求时读取——产出该段,并**丢弃**静态产物里带来的 `paths` 而不是与之合并(合并等于把错误的段再发布一次;spec 侧的生成要到第二棒 #5744 才摘除)。同一张表既决定「谁被服务」又决定「谁被描述」,幽灵行因此在结构上不可能存在:四条 bulk 路由只在 protocol 实现了 `batchData` / `createManyData` 时注册,于是也只在那时被描述。

  - 路径前缀跟随实际配置的 `apiPath`,project-scoped 镜像有自己的文档(不再把每条路径写两遍);
  - 动词是注册时的动词(`PATCH` 就是 `PATCH`);
  - 覆盖面:该 base 下经本服务器 `RouteManager` 挂载的**全部**路由(默认 boot 78 条,对比旧段的 10 个 operation),`rest-route-ledger.ts` 中 `source: 'route-manager'` 的各 family 全含,不按 `disposition` 裁剪——`server-only` / `public` 也是被服务的 HTTP 面。**不含**两个 `direct-mount` registrar(`package-routes.ts` / `external-datasource-routes.ts`,9 行):它们绕过 `RouteManager` 直接注册且受服务开关约束,本服务器**不持有**它们本次 boot 是否挂载的事实,而凭空补上正是本单要修的那类缺陷;也不含其它包挂载的路由(dispatcher 根路由、`service-storage`、`service-i18n`);
  - 不编造:请求/响应 schema、状态码、query 参数一律不生成(旧段的 `CreateRequest` / `UpdateRequest` `$ref` 除了挂在 404 的路径上,连线上形状都是错的——`{ data }` 信封 vs 裸记录体,spec 自己的路由目录 `plugin-rest-api.zod.ts` 里已记录这一点)。每个 operation 只写从注册读出的 `summary` / `tags`、从路径机械推导的 `operationId` 与 path 参数,响应写 `default`(成功状态是逐 handler 的事实,写 `200` 对 201/204 的路由就是错的);
  - 逐 operation 的 `security` 只在注册带 `public` 标签时写 `[]`(匿名表单),其余继承文档级要求——对 `/discovery`、`/openapi.json` 这类实际匿名的路由属于**故意少说**:注册没有携带鉴权事实,而「不需要凭据」是写错会漏数据的那个方向。

  `{object}` 展开与声明式端点合并两步原样保留,只是展开的模板终于是真实存在的路由(`/api/v1/data/{object}` 及其同族)。`components.schemas` / `info` / `securitySchemes` 仍来自 `@objectstack/spec` 并原样保留——那是它真正拥有的部分。

- 1203bb2: **声明式端点进 OpenAPI 文档;`/openapi.json` 的影子属主摘除(#5040 E6,并入 #5078)**

  `GET {basePath}/openapi.json` 只有一个属主,而且实测坐实是 `packages/rest`(#5078:真实 boot 拿到 355KB 的 OpenAPI 3.1 文档,`servers[0]` 按 Host 注入、`{object}` 展开出 199 条 paths、两条 `x-template` —— 三个指纹全部是 rest-server 的行为)。因此 `apis:` 端点的文档面加入 **rest-server 既有的 enrichment 管线**(与 `{object}` 展开同根、同一次请求、同样 best-effort),而**不是**在某个 metadata service 上实现 `generateOpenApi` —— 那会造出 ADR-0076 第 1 条明令禁止的第二属主。E1 的契约成员因此已剔除。

  每条声明贡献一个 path 条目:`path` 原样、`method` 小写作为 Operation 键、`operationId` = `name`,以及词表**真正带有**的两个文档字段 `summary` / `description`(缺省即缺省,不生成替身)。除此之外只写「执行器会怎么对待这条声明」的事实,逐条注明出处:`object_operation` 的 `get`/`update`/`delete` 记录 id 取 `query.id`(词表无路径模板语法)、`create` 答 201 其余 200、`script` / `proxy` 与缺 `objectParams` 的 `object_operation` 答 **501**。不编造任何 request/response schema —— 出厂文档的 `components.schemas` 是空的,凭空写 `$ref` 只会得到悬空引用。

  `authRequired` 由 schema parse 物化(缺省即 `true`),为 true 的条目引用**从文档自身读出**的 security 方案(不在 rest 里硬写方案名,否则就是第二处需要保持正确的地方),为 false 的条目写显式 `security: []` —— 这是 review 时一眼能看见的那个形状。不满足 `ApiEndpointSchema` 的存量条目**响亮跳过**并点名(与端点匹配器的装载门同一姿态);同 `method+path` 撞车时按「`name` 字典序在前者胜」裁决,与匹配器**同一条规则**,否则文档会指认一个运行时并不执行的端点;撞上内建路径时内建保留,声明被略过并报错。

  同时摘除 `http-dispatcher.ts` 里的 `generateOpenApi` 探测死分支:该方法在本仓与两个兄弟仓**零实现**,且 boot 实测**没有任何路由**把 `/openapi.json` 送进 `dispatch()` —— 双重死。`route-ledger.ts` 里对应的行与 `LEGACY_CHAIN_PREFIXES` 条目一并移除(原注记「falls through when metadata service lacks a generator」把「从来没有」写成了「有时没有」,正是 #5078 立单的失准点;把 prefix 留在一张自述为「if-chain 分支」的清单里,会在同一个 PR 里再造一次同样的谎)。该路由的唯一台账行在 `packages/rest/src/rest-route-ledger.ts`,一直是准的。

  **现网行为零变更**:publish / validate 对非空 `apis:` 仍然硬拒(E7 前不撤),所以今天枚举出的是空集,enrichment 原样返回同一个文档对象 —— 服务出去的字节与本次改动前逐字节相同,并有测试钉住。

### Patch Changes

- 978fed2: fix(analytics,rest): five dataset refusals declare `DATASET_INVALID` / 400 themselves, and the route's message-sniffing list shrinks to one entry (#5367)

  `POST /analytics/dataset/query` answered `400 DATASET_INVALID` for six error
  families because the route recognised their **prose**, not because the errors
  said anything about themselves. #5352 gave the catch an ADR-0112 envelope branch
  (`error.code` + a 4xx `error.status`, read first) and had to leave a hardcoded
  list of message substrings behind it, since all six producers were still bare
  `throw new Error(…)`:

  ```
  /not declared in the dataset|not backed by a declared relationship|
   not supported by the v1 dataset runtime|read-scope-sql|
   not a selected dimension or measure|is not a subset of the selected dimensions/
  ```

  That made the HTTP status of six families a property of their wording.
  Rephrasing `dataset-compiler`'s "is not declared in the dataset's `include`" —
  no logic change — moved that refusal from 400 to 500, i.e. re-opened #5352 for a
  different family, and no test and no gate would have gone red. Prime Directive
  #12 permits an accommodation like that only while it is declared, loud, tested
  **and removable on a schedule**; #5366 delivered the first three and nothing
  carried the fourth.

  **Five producers now declare their own verdict.** A new
  `dataset-refusal.ts` in `@objectstack/service-analytics` exports
  `datasetInvalidError` — the same shape as that package's existing
  `invalidFilterError` (`INVALID_FILTER` / 400) and `assertDimensionFields`
  (`INVALID_FIELD` / 400) — and five sites throw through it:

  - `dataset-compiler.ts` — a measure whose aggregate the v1 runtime cannot lower;
    a dimension/measure traversing a relationship path the dataset never declared
    in `include`;
  - `dataset-executor.ts` — an `order` key that is not a selected dimension or
    measure; a `totals` grouping that is not a subset of the selected dimensions;
  - `native-sql-strategy.ts` — a join outside the dataset's declared allowlist.

  Their five entries are gone from the route's list, which is now a single
  `read-scope-sql` test.

  **`read-scope-sql` deliberately stays.** Its ten fail-closed refusals are RLS
  read-scope lowering failures whose inputs are an admin-authored policy and a
  compiler-generated join alias — not caller input — so `DATASET_INVALID` ("your
  request is invalid") may well be the wrong verdict and choosing the right one is
  a separate judgement, still tracked by #5367. Deleting the entry before that
  judgement lands would regress those ten from `400 DATASET_INVALID` to 500.

  **No outward behaviour change for the five.** They answered
  `400 DATASET_INVALID` before and answer `400 DATASET_INVALID` now, with the same
  message; what changed is the mechanism, from message-matching to the producer's
  own declaration. The one visible difference is for a bare `Error` that merely
  _resembles_ one of those messages: it is no longer promoted to a 400. That is the
  point — a phrase is no longer a classification.

  `DATASET_INVALID` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-analytics` as well as `@objectstack/rest` (provenance, per
  ADR-0112 D3; the code itself is unchanged and the union does not grow), and the
  constructor types it as `RegisteredErrorCode` so an unregistered code is a
  compile error rather than a body some route rejects at runtime.

  Coverage: `dataset-refusal-envelope.test.ts` (service-analytics) pins each of the
  five refusals against its real producer — the refusal SET first, green before and
  after, then the envelope; `analytics-dataset-refusal-envelope.test.ts` (rest)
  drives all five end-to-end through a real `AnalyticsService` with positive
  controls on both the aggregate and raw-SQL paths; and
  `analytics-filter-refusal-envelope.test.ts` pins the deletion in both directions
  — the five messages answer 400 when enveloped and 500 when bare, so re-adding a
  regex entry turns it red.

- c36abfe: fix(service-analytics,rest): an analytics dimension over a missing field answers 400 INVALID_FIELD, not a driver 500 (#5520)

  #4437 gave a **measure** over a non-existent field a `400 INVALID_FIELD` naming
  the field, because a driver error class must never be the caller's `error.code`
  for a caller-shaped mistake (ADR-0112). It covered the measure half only, so the
  identical typo one request key over still reached the driver as a `GROUP BY`
  column:

  ```
  POST /analytics/query {"cube":"account_metrics","measures":["account_count"],"dimensions":["bogus_dim"]}
  → 500 {"code":"SQLITE_ERROR","message":"Internal server error"}

  # the control group on the same route, already fixed by #4437
  POST /analytics/query {"cube":"account_metrics","measures":["bogus_measure"]}
  → 400 {"code":"INVALID_FIELD","message":"Measure 'bogus_measure' … Valid measures: …"}
  ```

  **The gate.** `ensureCube` now runs `assertDimensionFields` alongside
  `assertMeasureFields` on every path, so a dimension whose source column the
  backing object does not have is refused **before** any SQL is built, with the
  same envelope the measure gate uses: `INVALID_FIELD` / 400 plus
  `field` / `object` / `param`, a message naming the field, the valid dimensions,
  and the object's known field list. `query`, `generateSql` and `queryDataset` are
  all covered, and a rejected query leaves nothing behind in the cube registry.
  `timeDimensions` are covered too — they resolve through the same
  `cube.dimensions` bag and produced the same 500 — with `param` reporting which
  request key carried the bad name.

  **What deliberately did not change:** grouping by a REAL field the cube never
  declared as a dimension (`dimensions: ["phone"]`) still works. The gate asks
  "does the _object_ have this field", never "did the cube declare this
  dimension". A cube whose `sql` is an expression, a dotted relation dimension,
  and a host that wires no field-name probe are all stood down on, exactly as the
  measure gate stands down.

  **The SQL echo, same request.** `POST /analytics/dataset/query` composed its own
  5xx body and echoed the error message verbatim. Knex prefixes the offending
  statement to its message, so the caller received the generated SQL — physical
  table and column names included:

  ```
  500 {"code":"ANALYTICS_QUERY_FAILED",
       "error":"SELECT bogus_dim AS \"bogus_dim\", COUNT(*) AS \"account_count\"
                 FROM \"crm_account\" GROUP BY bogus_dim - no such column: bogus_dim"}
  ```

  The sibling face never leaked it: `/analytics/query` exits through the
  dispatcher, which has applied the shared `looksLikeInternalErrorLeak` predicate
  to every >= 500 message since #3867. That same predicate now guards this route's
  500 body. Classification is untouched — the status stays 500, the code stays
  `ANALYTICS_QUERY_FAILED`, the ADR-0112 envelope branch and the transitional
  message list are unchanged — and the full text still reaches server logs. A 500
  whose message does not look like driver output keeps its prose.

- 2f6516e: fix(analytics,rest): an analytics filter refusal reaches the caller as `400 INVALID_FILTER`, not `500 ANALYTICS_QUERY_FAILED` (#5352)

  Misspell an operator in a dashboard widget's filter and analytics refuses it —
  correctly, and loudly, which is the posture #3948 / #5240 / #5325 / #5334 each
  argued for one refusal at a time: dropping a predicate the compiler cannot
  express does not narrow the query, it **widens** it to rows the author excluded,
  and a chart drawn over the whole dataset looks like a working chart.

  The refusal never reached the author. It landed as `500 ANALYTICS_QUERY_FAILED`
  — read as "the platform is broken" rather than "your filter has a typo", and
  counted by ops alerting as a 5xx. The identical mistake on `find()` has answered
  `400 INVALID_FILTER` since #3948, so one authoring error had two wire shapes,
  chosen by which face happened to catch it.

  **One defect, two halves — either alone leaves it unfixed.**

  - **Producer** (`filter-normalizer.ts`): seven of its nine refusals were bare
    `throw new Error(…)` carrying no `code`/`status`. All nine now go through the
    `invalidFilterError` helper #5334 introduced (`INVALID_FILTER` / 400), which
    becomes the module's only way to refuse.
  - **Consumer** (`rest-server.ts`, `POST /analytics/dataset/query`): the catch
    discarded `error.code` / `error.status` and re-derived the classification from
    a hardcoded list of message substrings — so a producer that took ADR-0112
    seriously was punished for it. It now reads the envelope **first**; the
    substring list is demoted to a fallback for the families that still carry no
    envelope.

  **Observable behaviour change — read this if you alert or retry on status.**
  The same request that returned `500 ANALYTICS_QUERY_FAILED` now returns
  `400 INVALID_FILTER` (and, for two neighbouring conditions whose producers
  already declared an envelope this route was discarding, `400 INVALID_FIELD` for
  a measure over a field the object does not have, `404 CUBE_NOT_FOUND` for an
  unregistered cube). Monitoring that counted these as server faults will see the
  5xx rate drop and a 4xx rate appear; a client that retries on 5xx will stop
  retrying a request that could only ever fail the same way. Both are the intended
  correction — the condition was always the caller's mistake — but they are
  visible, so they are stated rather than buried.

  **Which inputs are refused did not change.** This changes the SHAPE of the
  error and nothing about the judgement that produced it: no refusal condition
  was touched, no input that used to compile now refuses, and no input that used
  to refuse now compiles. That claim is pinned input-by-input (refusals _and_
  accepted inputs with their compiled trees) in
  `filter-refusal-envelope.test.ts`, which is green both before and after the
  change — only the envelope assertions move.

  The message-substring list survives on purpose. All six of its entries were
  re-verified as bare `Error`s (`dataset-compiler.ts`, `native-sql-strategy.ts`,
  `dataset-executor.ts`, `read-scope-sql.ts`), so deleting it would regress those
  families from `400 DATASET_INVALID` to 500. It is a placeholder for their
  enveloping, not a second classification mechanism, and it is now documented as
  such: a new refusal should carry a `code`/`status` and be served by the
  envelope branch for free. The passthrough is deliberately **4xx-only** and
  requires **both** `code` and `status`, so an internal fault can never be
  re-labelled as the caller's fault, and this route never invents a code a
  producer failed to supply.

- 64cd010: fix(runtime,types)!: `/analytics/query` no longer echoes RLS policy field names — the declared-server-fault withhold is shared by both HTTP boundaries (#5811)

  **Observable behaviour change — read this if you read, log, or assert on
  `error.message` from a dispatcher-plugin route.** An error that **declares a
  server fault** in the ADR-0112 envelope (`status >= 500` _and_ a non-empty
  `code`) now leaves `dispatcher-plugin.errorResponseBase` with its message
  replaced by `"Internal server error"`. It previously reached the caller verbatim
  unless it happened to _sound_ like a SQL/driver dump. This applies to every route
  that plugin mounts — `/analytics`, `/packages`, `/i18n`, `/automation`, `/auth`,
  `/notifications`, `/mcp`, … — not only the one that motivated it. Nothing a
  machine reads changed: the producer's `code` still arrives in the response
  (`error.code`, promoted there from `details` by the shared envelope builder,
  #3842), the status is untouched, and the full original text still goes to the
  server log and `errorReporter` via `__obsRecordedError`.

  ## What was wrong

  #5367 (maintainer ruling 2026-08-06) made `read-scope-sql.ts`'s ten fail-closed
  RLS lowering refusals `READ_SCOPE_COMPILE_FAILED` / 500 and taught
  `POST /analytics/dataset/query` to withhold their message, because those messages
  name the field names and comparands of an **administrator's** sharing rule:

  ```
  [read-scope-sql] unsafe field identifier "secret_policy_field" — refusing to
  build read scope (fail-closed).
  ```

  The caller never wrote that field name and must not be able to read it out of an
  error body. But the **sibling** analytics face was never closed.
  `compileScopedFilterToSql` runs on both `NativeSQLStrategy.applyReadScope` and
  `ObjectQLStrategy`'s echoed SQL, both of which serve `POST /analytics/query`,
  which exits through `dispatcher-plugin.errorResponseBase`. That exit's only
  message guard was `looksLikeInternalErrorLeak` — a heuristic over SQL/driver
  _phrasing_ — and all eleven read-scope message shapes return `false` from it.
  Measured at that boundary: **11 of 11 echoed verbatim**, at 500, with the policy
  content in `error.message`. A real reachable disclosure, not a theoretical one.

  ## What changed

  - **`@objectstack/types` gains `declaresServerFault(err)`**, exported from
    `error-leak.ts` beside `looksLikeInternalErrorLeak`. The heuristic asks whether
    a message _sounds_ internal; the declaration asks whether the producer _said
    so_. `error-leak.ts`'s own file header already states the principle — "do not
    ship driver internals to clients" is a property of the HTTP boundary, not of
    one router — and this is the second predicate that principle asks for.
  - **Both boundaries read it.** `dispatcher-plugin.errorResponseBase` gains the
    withhold (the fix); `rest-server.ts`'s `/analytics/dataset/query` catch drops
    its in-line copy of the same test in favour of the shared one. #5808 wrote that
    rule in-line on purpose — promoting a rule with one consumer is a speculative
    surface — and this is the second consumer, so it was promoted rather than
    duplicated (`#3843`/`#3867` paid for the two-implementations shape twice).
    The REST face's verdict is unchanged in every case: same `status >= 500` plus
    non-empty `code` test, over the same two fields.

  ## What deliberately did NOT change

  - ⛔ **This is not "withhold every 5xx".** #5667 kept **undeclared** 5xx errors
    legible on purpose: a bare `Error` from our own code ("no strategy can handle
    query …") is the operator's own bug report, names nothing tenant-sensitive, and
    still falls to `looksLikeInternalErrorLeak` alone. A 5xx carrying only half an
    envelope (a status with no code) is likewise still readable — inventing the
    withhold for it would be the consumer-side leniency Prime Directive #12 removes.
  - **4xx is untouched.** `declaresServerFault` requires `status >= 500`, so a
    deliberate business/validation answer can never be swallowed by it.
  - **`statusCode` is not accepted as a substitute for `status`.** `status` is the
    channel ADR-0112 declares; making a disclosure rule depend on which spelling a
    producer reached for would be the same leniency in a different place.
  - **The heuristic was not taught to recognise `[read-scope-sql]`.** That would be
    more prose sniffing — the mechanism #5352/#5367 exist to remove — and would only
    ever cover the family someone remembered to add.

  Coverage: `analytics-query-read-scope-withhold.test.ts` (runtime) drives six RLS
  policy shapes end-to-end through a **real** `AnalyticsService` on the real
  native-SQL path and the real mounted route, asserting the 500, that the whole
  serialized body contains no policy detail, that `error.code` still carries
  `READ_SCOPE_COMPILE_FAILED`, and that the full text is still on the
  `__obsRecordedError` side-channel — plus a positive control and both sides of the
  declared-vs-undeclared tiering. `error-leak.test.ts` (types) pins the predicate
  directly, including that all eleven read-scope shapes stay invisible to the
  heuristic. The REST face's existing `analytics-read-scope-refusal-envelope.test.ts`
  is green before and after, unchanged, which is the pin on the refactor.

- fb3d99b: fix(analytics,rest)!: an RLS read-scope lowering failure is a `500`, not the caller's `400` — and its policy detail no longer reaches the response (#5367)

  **Observable behaviour change — read this if you alert, retry, or assert on status.**
  A request whose dataset carries an RLS read scope that `read-scope-sql.ts` cannot
  lower used to answer `400 DATASET_INVALID` with the refusal message echoed
  verbatim. It now answers `500 ANALYTICS_QUERY_FAILED` with the message withheld
  (`"Internal server error"`); the full text goes to the server log. Monitoring that
  counted these as client errors will see a 4xx disappear and a 5xx appear, and a
  client retrying on 5xx will now retry a request that cannot succeed until an
  administrator fixes the policy. Both follow from the correction below and are
  stated rather than buried.

  ## What was wrong

  These ten fail-closed refusals were the last family `/analytics/dataset/query`
  classified by **prose** — the final entry of the hardcoded message-substring list
  #5352 introduced, which #5367's first PR had already shrunk from six entries to
  one. Two defects in one verdict:

  - **Misattribution.** `compileScopedFilterToSql(filter, alias)` receives an RLS
    `FilterCondition` the security service compiled from an **administrator's**
    sharing rule / permission set, and a join alias the **dataset compiler**
    generated. Neither is caller input — the caller's own predicate goes through
    `filter-normalizer.ts` and has answered `INVALID_FILTER` / 400 since #5352. So
    what can arrive here is a broken policy, or drift between two of our own
    components (#5557's `$regex` was literally the second case). For this request's
    caller both are a **server** fault; `400` told them to fix a request that was
    never wrong and kept the real fault out of 5xx alerting.
  - **Disclosure.** A 400 echoed the message, so
    `unsafe field identifier "secret_policy_field"` and
    `unsupported operator "$regex" on "owner_email"` handed a tenant the field names
    and comparands of the RLS policy governing them.

  The maintainer ruled on 2026-08-06 (option B on #5367's decision card; option A
  was `READ_SCOPE_INVALID` / 422, rejected because no consumer reads a code on this
  path, a 4xx misreports a condition the client cannot fix, and 422 would have left
  the disclosure question to be re-decided message by message).

  ## What changed

  - `read-scope-sql.ts` gains a module-local `readScopeCompileError` — the twin of
    `filter-normalizer.ts`'s `invalidFilterError`, and likewise **the only way the
    module refuses**. All ten sites carry `READ_SCOPE_COMPILE_FAILED` / **500**.
    `:104`'s alias-vs-field split (option C on the card) collapses under B: both
    branches answer the same verdict, pinned so the collapse is a recorded decision.
  - `rest-server.ts` loses branch ② entirely. **The message-sniffing mechanism is
    fully retired** — nothing in this catch reads prose any more, and #5367's
    Prime-Directive-#12 retirement schedule ("declared, loud, tested AND removable
    on a schedule") is paid off.
  - The route's 5xx branch now withholds the message of any producer that
    **declares** a server fault (`status >= 500` with a `code`). This was needed
    rather than inherited: `looksLikeInternalErrorLeak` (#3867/#5520) is a heuristic
    over SQL/driver _phrasing_, and measured, every read-scope message returns
    `false` from it — so retiring the list alone would have moved the policy content
    from a 400 body into a 500 body instead of out of the response. Teaching that
    heuristic to recognise `[read-scope-sql]` would have been _more_ message
    sniffing, so the rule keys on the ADR-0112 envelope instead. **Undeclared** 5xx
    errors keep #5667's tiering, so a self-authored fault ("no strategy can handle
    query …") stays readable.
  - `READ_SCOPE_COMPILE_FAILED` is registered in `ERROR_CODE_LEDGER` under
    `@objectstack/service-analytics` (ADR-0112 D3) and typed as
    `RegisteredErrorCode` at the constructor, so an unregistered code is a compile
    error. It is legible on the wire through the sibling `/analytics/query` exit,
    which puts a thrown `err.code` in `error.details.code` (#3842).

  **Which inputs are refused did not change.** No refusal condition moved: nothing
  that used to lower now throws, and nothing that used to throw now lowers. That is
  pinned input-by-input — refusals _and_ accepted read scopes with their compiled
  SQL and bind params — in `read-scope-refusal-envelope.test.ts`, which is green both
  before and after; only the envelope assertions move.

  Coverage: `read-scope-refusal-envelope.test.ts` (service-analytics) drives all ten
  sites through the real compiler; `analytics-read-scope-refusal-envelope.test.ts`
  (rest) drives five policy shapes end-to-end through a real `AnalyticsService`,
  asserting the 500, that the body contains no policy detail, and that the withheld
  text is present in the log — plus a positive control and both sides of the
  declared-vs-undeclared withhold.

- c001422: feat(spec): declare `routes.mcp` on `ApiRoutesSchema`, and extend the discovery conformance gate one level down (#5679)

  `/discovery` advertises `routes.mcp`, `objectui` reads it, and
  `ApiRoutesSchema` never declared it. This is #4828's defect one level down —
  with the opposite disposition: `endpoints` was retired because a census found
  no reader, while `mcp` has two real ones (`ConnectAgentWidget.tsx` and
  `AgentConnectSection.tsx` both gate the Integrations connect card on it), and
  it is in fact the only `routes.*` key anything in `objectui` reads. So it is
  declared, not removed.

  Why it was a defect and not tidiness: `ApiRoutesSchema` is a plain `z.object`,
  which **strips** unknown keys. Any consumer parsing `/discovery` through the
  spec dropped `routes.mcp` silently — the connect card would blank with no
  error. Nothing broke yet only because those two readers happen to read raw
  JSON.

  - **`ApiRoutesSchema` declares `mcp: z.string().optional()`**, as measured off
    both producers rather than guessed: a path string (`/api/v1/mcp`), always the
    **unscoped** base — `/mcp` is mounted bare, so a scoped mount advertising
    `/api/v1/environments/env_alpha/data` still advertises `/api/v1/mcp` — and
    `optional`, not `nullable`: the key is absent (rest-server `delete`s it, the
    dispatcher leaves it `undefined`) when MCP is disabled or unserveable.
    Neither producer ever emits `null`.
  - **`@objectstack/rest` drops the two `as any` casts** at the emit site. That is
    type-only — the emitted body is byte-identical — but the cast's disappearance
    is the structural proof: with the key undeclared, removing it produced two
    `TS2339 Property 'mcp' does not exist`; with it declared, `tsc --noEmit`
    returns to its ratcheted baseline.
  - **The #4828 conformance gates now cover `routes` keys**, not just top-level
    ones, in all three producer packages, deriving the allowance from
    `ApiRoutesSchema` the same way the top-level check derives it from the
    protocol schema. Extended one level, not recursed — full recursion stays out
    of scope, and `capabilities` / `services` are `z.record`s whose keys are open
    by design.

  - **`@objectstack/client`'s conventional route table gains an `mcp` row.** That
    table is `Record<keyof ApiRoutes, string>` — total by design — so a newly
    declared route owes a convention, and the public `ApiRouteType` (`keyof
ApiRoutes`) widens by one member. The path is `/api/v1/mcp`, which is what
    both producers emit, so the fallback agrees with the discovered value instead
    of competing with it. Resolution behaviour is unchanged: `getRoute()` still
    prefers the discovered route, and the pre-existing catch-all already produced
    the same string.

  Corrects one detail of the issue's premise: the runtime dispatcher's
  `getDiscoveryInfo()` **does** also emit `routes.mcp` (its routes literal always
  carries the key, holding the path or `undefined`), so both producers were
  affected, not just REST — and the new gate went red on both before the fix.

- aeb9b27: **发布出去的 OpenAPI 文档 `components.schemas` 不再是空的,6 个 `$ref` 不再悬空(#5168)**

  `GET /api/v1/openapi.json` 的 base spec 由 `packages/spec/scripts/build-openapi.ts` 生成,它把九个契约 schema(`CreateRequest` / `ApiError` / `ListRecordResponse` / …)转成 JSON Schema 填进 `components.schemas`。收集判据写的是 `typeof schema === 'object' && '_zod' in schema`,而这九个 schema 全部经 `lazySchema()` 包装 —— 其 Proxy target 是 `function lazyZod() {}`,于是 `typeof` 是 `'function'` 而不是 `'object'`,判据第一段就短路,九个一个都没进去。`paths` 里那 6 个 `$ref` 是手写字面量,不受影响照常写出,结果是**一份 `components.schemas` 为 `{}`、6 个 `$ref` 全部悬空的文档被发布出去**,覆盖 `/api/{object}` 与 `/api/{object}/{id}` 上全部 CRUD 操作的请求体与响应体。

  判据放宽为同时接受 `'object'` 与 `'function'`。`'_zod' in schema` 那一段对 Proxy 本来就是有效的 —— `lazySchema` 专门维护了 `_zod` facade 供 `toJSONSchema` 遍历 —— 所以 `lazySchema` 本身不需要改动。对照实验坐实了唯一变量就是 Proxy:同一份源码下 `npx tsx scripts/build-openapi.ts` 得到 `Components: 0`,而 `OS_EAGER_SCHEMAS=1`(`lazySchema` 自带的绕过 Proxy 应急开关)得到 `Components: 9`。修复后不带任何环境变量即为 `Components: 9`。

  两类消费者直接受益:`GET /api/v1/docs` 的 Scalar viewer 现在有 schema 可渲染;从该文档做客户端代码生成的集成方(openapi-generator / orval / …)不再在解析期撞上 unresolvable reference。

  **同时补上防复发的门禁。** 这个缺陷三个层次同时可见(空 components、悬空 ref、控制台明晃晃的 `Components: 0`)却没有任何一处红 —— `gen:openapi` 是全仓两个完全无门禁的生成器之一。生成器现在在**写盘之前**自检两条,任一不满足即以非零码退出,自恰不了的文档根本不会被写出来:

  1. **每个本地 `$ref` 都必须解析得到。** 按 JSON Pointer 解析而不是按 `#/components/schemas/` 前缀匹配,将来新增的 `#/$defs/…` 引用自动被覆盖;报错逐条点名悬空的 `$ref` 及其在文档中的位置,并把「已定义的 schema 列表」一并打出来 —— 哪一侧是空的是读者最先需要的信息。
  2. **没有 schema 被静默降级。** 九个契约 schema 是一张字面清单,某个名字没产出东西永远是缺陷而不是「这个可选」。原先的循环写成 `if (像 zod) { 收 }` 且没有 `else`,正是这个「静默跳过」的形状让九次跳过发布成了空文档;现在**声明即强制**,漏掉的名字会被点名。`z.toJSONSchema()` 抛错时原先会塞一个 `{type:'object'}` 占位描述冒充契约,这条同样改为响亮失败 —— 当前九个全部干净转换,零占位。

  门禁接在生成器内部而不是单独的 `check:` 脚本,因为 `packages/spec/json-schema/` 是 gitignore 的、每次 `pnpm build` 重新生成,独立检查脚本无论如何都要先跑一次生成器才有东西可查。「产物自恰」这类断言比「产物最新」更便宜,且不需要任何基线快照。

  `packages/rest` 侧无行为改动:声明式端点的 enrichment 仍然只写 `type: object` 而不编造 `$ref` —— 九个契约 schema 是通用 CRUD 信封,不是某个具体对象的 body 形状 —— 但三处以现在时陈述「`components.schemas` 是空的」的注释已按事实更新。

- 39396bd: REST 的显式状态直通:4xx 错误消息超过 500 字符时**截断**,不再整条替换成 `Request failed`

  `mapDataError` 与 `resolveErrorResponse`(`sendError` 的取值端)两处 4xx 直通分支,过去都以 500 字符为界把整条 message 换成字面量 `Request failed` —— `status` 和 `code` 照常落地,正文一个字不剩。这把激励方向弄反了:驱动层那些拒收信息**唯一的存在意义**就是告诉作者哪个操作符/字段写错了、协议是怎么声明的,而 driver-sql 里写得最细的两条(#5158 未降解的 `FilterArray`、#5347 非布尔 `$null` 比较值)恰好都越过 500 字符,于是客户端只收到 `{ "code": "INVALID_FILTER", "error": "Request failed" }`。更反直觉的是:这两条**不带** `status` 时反而能原文直达(走 `mapDataError` 末尾的 `{ status: 400, body: { error: raw } }`),#4436 给它们加 `status: 400` 是为了赋予 ADR-0112 的 wire 身份,却在这一档让可读性变差了。

  现在超长消息按 `message.slice(0, 499) + '…'` 截断,与驱动侧 `safeShapePreview` 同源。这些消息把主句(操作符、字段、path、收到了什么、协议怎么声明)放在最前,被截掉的是尾部的归因和 issue 号 —— 本就该留在日志里而非响应里的部分。上限仍是 500,变的是**到达上限时的处理方式**;短于 500 的消息逐字不变。

  影响面不止过滤器:任何携带 4xx `status` 的领域错误同享此修复,包括 metadata save 校验的 422(实测一条五 issue 的 `INVALID_METADATA` 就在这条线上下)、plugin-sharing 的 record-scope 403 等。

  `sendError` 一侧的直通区间是 400–599,其中 **5xx 的整条替换刻意保持不变**:4xx 的正文是写给调用方的补救说明,5xx 的正文是服务端故障的日志诊断 —— 这与 `mapDataError` 同族分支「deliberately limited to 4xx」的既有取向一致。

- 577cd27: fix(rest): a declared 5xx no longer ships its own message to the client (#5437)

  **Behaviour change — read this if you operate a deployment or parse REST error
  bodies.** An error that carries an explicit `status` of 500 or above now reaches
  the client as `{ "error": "Internal server error", "code": "<the producer's
code>" }`. The status and the code are unchanged; only the free-text message is
  withheld, and the full original text is written to the server log.

  **What was wrong.** `sendError` — the error path of the metadata, UI, discovery
  and batch routes — passed an explicit status straight through for the whole
  400-599 band, so a declared 5xx returned `error.message` verbatim without
  passing through any of the sanitizing heuristics (`isSqlLeak`,
  `looksLikeInternalErrorLeak`, the `Internal data error` envelope). The sibling
  branch in `mapDataError` stops at 4xx on purpose, with the reason written down:
  "5xx messages keep going through the sanitizing heuristics below so
  internal/SQL details never reach the client verbatim". Two opposite verdicts on
  one question, and the routes that report through `sendError` got the permissive
  one.

  That was reachable, not theoretical. `metadata-protocol` interpolates the raw
  driver error into two client-facing 500s — the customization-overlay persist and
  delete failures — so a real driver line such as `SQLITE_ERROR: no such table:
sys_metadata`, `relation "sys_metadata" does not exist`, or a unique-constraint
  payload naming physical columns was returned to whoever made the request. The
  only thing standing in the way was a 500-character bound, and driver errors are
  far shorter than that. Length was never a proxy for leakage; on this side of the
  bound it failed open.

  **Accepted cost.** A 5xx message written _for_ the caller now reaches them as
  the generic sentence plus its code. Two concrete examples: the overlay-persist
  failure's "In-memory registry was updated but will be lost on restart", and the
  atomic-batch refusal's "retry without options.atomic, or probe
  capabilities.transactionalBatch on /discovery first". Both remain fully readable
  in the server log, and the machine-readable `code` (`OVERLAY_PERSISTENCE_FAILED`,
  `NOT_IMPLEMENTED`) still rides on the response, so a client keying on codes is
  unaffected. If you were surfacing 5xx `error` text in an operator console, read
  it from the log instead — `[REST] Unhandled error` for a genuine fault, and a
  new `[REST] 5xx message withheld from client` line for the 502/503 lifecycle
  statuses that the unhandled-error predicate deliberately keeps quiet.

  The message is dropped unconditionally rather than filtered by keyword: a
  predicate would only move the question to "does the heuristic know this
  dialect", which is the failure mode that produced the bug. 4xx behaviour is
  untouched — an over-long client message is still truncated rather than erased
  (#5423 / #5436).

- 5897552: fix(rest): expected 4xx no longer logged as "[REST] Unhandled error" with a stack (#4886)

  Opening Studio flooded the server log with stack traces. The designer probes
  `GET /meta/:type/:name?state=draft` on every panel to decide whether to show
  "unsaved draft" state, and "no draft exists" is the overwhelmingly common
  answer — true of every artifact nobody is currently editing. `getMetaItem`
  throws a structured `{ code: 'NO_DRAFT', status: 404 }`, the client got a clean
  404 and handled it fine, but the route logged it anyway:

  ```
  [REST] Unhandled error: Error: [no_draft] No pending draft exists for app/showcase_app.
      at _ObjectStackProtocolImplementation.getMetaItem (…)  { code: 'NO_DRAFT', status: 404 }
  ```

  **45 of these in one browsing session** — by far the dominant entry in the log,
  which is how a genuine 500 goes unnoticed, and it misreports severity: nothing
  was broken.

  The metadata routes had 29 catch blocks logging unconditionally. The data
  routes already consulted `isExpectedDataStatus` / `isExpectedQueryRejection` —
  but in four different open-coded spellings across 12 sites, and
  `isExpectedQueryRejection`'s docblock records an earlier lap of exactly this
  drift (the filter and sort codes shipped without joining the list, so every
  rejection they produced was logged as unhandled too).

  Both families now decide through one predicate behind one door,
  `handleRouteError(res, error, object?)`: it resolves the response once — the
  same structured-status passthrough or `mapDataError` envelope `sendError`
  already produced — logs only when that resolved response is a genuine fault,
  then sends it. `isExpectedDataStatus` and `isExpectedQueryRejection` have no
  other callers left, so the two families cannot drift apart again.

  Expected now means an explicitly recognised client or lifecycle outcome:
  403/404/409/502/503, the client-caused 400 query-rejection vocabulary, and
  `VALIDATION_FAILED`. It deliberately does **not** mean "any 4xx" —
  `mapDataError` degrades an error it recognised nothing about to an un-coded
  400, and that bucket is where a real handler bug lands, so it stays loud.

  **No wire responses change** — every status and body is byte-for-byte what it
  was; this only decides whether the log line is printed. Two operator-visible
  log deltas beyond the metadata fix:

  - the cross-object transactional batch route judged on `status >= 500` alone,
    which also swallowed that un-coded 400 — a handler `TypeError` inside a batch
    transaction used to vanish, and now prints;
  - `updateMany` / `deleteMany` / clone / global search / the public-form routes
    stop logging normal 404s, 403s and query rejections.

- 91ec1ea: fix(rest): an unclassified route error answers a sanitised 500, not a 400 (#5489)

  **升级须知 — 状态码行为变化。** `@objectstack/rest` 的错误映射 `mapDataError`
  在所有分类分支都不匹配时,原先的终局兜底是
  `{ status: 400, body: { error: <原始 message> } }`。这一支现在改为一个消毒过的
  服务端故障信封:

  ```
  500 {"error":"Internal server error","code":"INTERNAL_ERROR"}
  ```

  **为什么。** 400 的语义是「你请求错了」——SDK、fetch 封装、代理和重试策略都据此
  判定「不要重试,调用方得改点什么」。而真正落到这一支的错误恰恰相反:元数据存储
  读不到时 `matchEndpoint` 按契约抛错(它抛就是为了让 outage 不伪装成「没有声明
  任何 endpoint」,ADR-0110 D3),或者干脆是处理器自身的 `TypeError`。两者调用方都
  修不了,且都**应该**重试。实测:`GET /api/v1/meta/api` 对着一个抛
  `Error('metadata store unreachable')` 的存储,返回 HTTP 400。

  同时,原始 message 是逐字下发的——而这偏偏是全文件里最没有证据表明可以下发的一
  条路径:走到这里的前提就是 `looksLikeInternalErrorLeak` 什么都没匹配上,而
  #5462 已经记过「关键词启发式沉默不等于安全」。实测到的一例:一个声明了
  `status: 502`、message 为 `connect ECONNREFUSED 10.0.0.5:5432 (internal pool)`
  的错误,经由数据路由直接调用 `mapDataError` 时,以 400 携带主机与端口下发。
  沿用 #5464 的纪律:原文进服务端日志,不进客户端(500 不在
  `isExpectedDataStatus` 内,`handleRouteError` 会打印完整错误对象)。

  **真正的客户端错误一个都没有改变。** 改动前先做了测绘:给这一支加桩,跑完
  `@objectstack/rest` 全套(48 文件 / 719 用例),落到这一支的只有 6 个错误——本单
  的存储 outage、两个 502 的 ECONNREFUSED、三个 `TypeError`,没有一个是客户端
  错误。历史上唯一骑在这条兜底上的客户端错误家族(driver-sql 无法编译的 filter
  拒绝)已由 #4436 在**生产者侧**声明 `status: 400` + `INVALID_FILTER` 迁走。
  validation / permission / unknown object / unknown field / not-null 漂移 /
  unique 冲突 / 沙箱业务拒绝等全部仍由各自分支给出原本的 4xx。

  **`INTERNAL_ERROR` 而非 `DATABASE_ERROR`。** #5462 的 `DATA_STORE_FAULT`
  (`500 DATABASE_ERROR`)用在证据**指名**了存储故障的地方(驱动的 missing-relation
  措辞、`looksLikeInternalErrorLeak` 命中);而这一支的定义性事实是「没有任何证据」,
  把处理器的 `TypeError` 报成 `DATABASE_ERROR` 会把运维指向一个其实健康的数据库。
  `INTERNAL_ERROR` 是 `standardErrorCodeForHttpStatus(500)` 的取值
  (`@objectstack/spec` 的 `HttpStatusErrorCodeMap`)——目录自己为「500 且无更具体
  code」定义的下限,不是第三套措辞;message 复用的也是
  `resolveErrorResponse` 声明式 5xx 分支已在用的 `INTERNAL_ERROR_MESSAGE`。

  **如果你的客户端把这条兜底当 400 处理过**:它现在是 5xx,可以重试;若你有生产者
  依赖「不声明 status 即可把 message 原文送达调用方」,请改为在抛出点声明
  `status` 与 `code`(契约优先),那是唯一仍会把措辞交给调用方的路径。

- 2d25303: fix(rest): 联合类型分支里的拒绝理由现在能到达调用方,不再只剩 `Invalid input` (#5014)

  zod 会把一个失配的 `z.union([...])` 折叠成**一条**顶层 `invalid_union` issue,它自己的
  `message` 是裸的 `"Invalid input"`;每个分支真正的抱怨——包括 #4001 那批 `strictObject`
  写下的处方文案——躺在 `issue.errors` 里(每分支一个数组)。`zodIssuesToFields` 过去只映射
  顶层 issue,于是 `POST /api/v1/data/:object/query` 对着
  `{"search": {"fields": ["name"]}}` 只回一条

  ```
  { "field": "query.search", "code": "invalid_shape", "message": "Invalid input" }
  ```

  ——说清「缺的是 `query` 这个键」的那句话被生产出来,然后被丢掉。同一个坑在
  `QuerySchema.groupBy` 的联合分支上一样:`dateGranularity` 写错值,作者拿不到那份
  「可选 day/week/month/quarter/year」的清单。

  现在 `fields[]` 会在联合条目**之后**追加解释它的分支条目,`field` 用分支路径拼上联合自身
  的路径(`query.search.query`),`code` 照常走 ADR-0114 D3 的目录映射——所以缺键报
  `required` 而不是 `invalid_type`(这一判定要走绝对路径去读入参,分支路径是相对的)。

  分支选择策略直接沿用 #4971 给 CLI/spec 侧 `formatZodError` 落的那一套:只报根部
  KIND 不匹配的分支整支丢弃(全部如此则不展开,输出和以前逐字一致);剩下的**报得最少的
  分支胜出**——这条是防止「一个拼错的键被 N 个分支各报一遍」的机制本身;`unrecognized_keys`
  破平局;声明顺序破剩下的;真正并列的分支全部输出(上限 3 条);跨分支重复的相同结论只
  出现一次;嵌套联合按绝对路径递归,深度上限 3。两侧必须给出**同一个判定**,否则同一个错误
  从终端发布和从 API 提交会得到两套说法。

  对 wire 而言这是**纯追加**:原有的每一条 `fields[]` 条目——包括联合自身那条——`field` /
  `code` / `message` 和相对次序都不变,新条目插在它解释的那条之后。信封形状仍与
  `mapDataError` 同形(ADR-0114),数组长度从来不是契约的一部分。

- 1216dcc: fix(rest): sweep the REST composition root's slot lookups — 16 sites typed (#4251 B4)

  Batch B4 of the #4251 sweep: every service-lookup erasure in the REST
  composition root. `rest-api-plugin.ts` (15) and `external-datasource-routes.ts`
  (1) now pass the slot's contract type instead of annotating the result `any`;
  the ratchet baseline drops **159 → 143 sites, 34 → 32 files**, and both files
  leave the grandfather list. No behaviour change.

  **Every contract named here is evidenced by an `implements`.** `email`,
  `sharing`, `sharingRules`, `reports`, `approvals` and `external-datasource` had
  a written `packages/spec` contract all along, and the class each provider
  registers into the slot declares `implements` on it (`EmailService implements
IEmailService`, `ExternalDatasourceService implements IExternalDatasourceService`,
  …). So the compiler verifies the shape on the producer side on every build and
  this file only has to name it — the #4404 discipline that replaced seven
  unchecked local stand-ins with one checked claim. `auth`, `objectql`, `i18n`,
  `analytics`, `security` and `metadata` come from the `ServiceSlotContracts`
  ledger; `objectql` is `IObjectQLEngine`, not `IDataEngine`, because the consumer
  reaches the full engine (the `transaction` probe behind the batch routes).

  **The wrapper return annotations went with them.** Ten of these lookups sit
  inside `async (environmentId?) => Promise<any | undefined>` providers, and
  typing only the lookup would have re-erased the contract one line later — the
  KNOWN RESIDUAL shape the rule documents and cannot see. Each provider now
  returns its slot's contract.

  **Three slots have no contract, and say so three different ways rather than one
  `any`.** `env-registry` is typed as `RestEnvRegistry`, the shape `RestServer`'s
  own constructor declares for that parameter, so the argument is checked rather
  than waved through. `settings` gets a named local surface (`SettingsReadSurface`)
  following B2's decision for this slot — `service-settings` is optional, so the
  REST layer must not depend on it — carrying the one method the platform consumes
  (`get`, through `resolveLocalizationContext`'s cascade) with the public
  `ResolvedSettingValue` as its return type. `default-project` gets a narrow slice
  declaring only the field this file reads. And the service-existence probe, whose
  slot name is a runtime argument, is `unknown`: it asks whether something
  occupies the slot and never touches its shape, which is exactly what `unknown`
  says and `any` does not.

  **No dead probe this batch — reported rather than implied.** Every earlier batch
  in this line found one (#4361's `getMetaItem` on a service that never had it,
  #4321's `registerInMemory`), so each probe the typed consumers make was checked
  against its contract: `emailService.send`, `authService.getApi` /
  `isAuthGateActive`, `svc.queryDataset`, `ql.transaction`, the six approval
  verbs, the five security methods and the five federation methods all name real
  members at real arities. The `external-datasource` route probes are now visibly
  redundant-but-correct — the contract's methods are required, so `svc?.method` is
  truthy whenever the service resolved, and the 503 path is reached only by the
  service being absent, which is what it is for.

  The new pin is a runtime test, deliberately. `packages/rest` excludes its test
  files from `tsconfig.json` and declares no `typecheck` script, so no tsc program
  compiles them and a type-level assertion there would evaluate never — the
  phantom-check shape #5286 / #5449 paid for. What is checkable is the wiring, and
  that is the risk this change actually carries: the providers are positional
  arguments 6..19 of a twenty-argument constructor, all with the same
  `(environmentId?) => Promise<unknown>` shape, so a provider resolving the wrong
  slot is assignable everywhere and invisible to the compiler. The test drives
  each provider and asserts it hands back the instance registered in ITS slot,
  pins the exact set of slot names the boot resolves, and pins the degraded path
  where every optional slot is empty.

- 90fa077: fix(rest): a missing relation is only an unknown OBJECT when it IS the object asked for (#5462)

  `mapDataError`'s unknown-object heuristic asked whether a driver error mentioned
  `no such table` / `relation … does not exist` — never **which** table was
  missing. A business object that was never registered and the metadata plane
  collapsing entirely produce the same two words, so `sys_metadata` becoming
  unreachable came back to the caller as:

  ```
  404 {"error":"Object not found","code":"OBJECT_NOT_FOUND"}
  ```

  The caller was told to check the object name they typed while the real answer
  was "the metadata store is gone". And because 404 is an `isExpectedDataStatus`,
  `handleRouteError` printed no `[REST] Unhandled error` — so a total outage of
  the metadata plane left **not one line** in the server log. Reproduced in
  process on a real `ObjectQL` + `ObjectStackProtocolImplementation` whose driver
  fails every access with `SQLITE_ERROR: no such table: sys_metadata`:
  `PUT /api/v1/meta/object/acct` answered 404 with zero log lines.

  **The rule now: a missing-relation message is an unknown-object verdict only
  when the relation it names is the object the request named.** Attribution takes
  both halves — a request object, and a relation name the phrasing actually
  carries (`no such table: main.acct`, `relation "public.acct" does not exist`;
  the schema qualifier is stripped and the compare is case-insensitive). Prime
  Directive #6 is what makes that comparison sound rather than a guess: the object
  `name` **is** the table name, with no `tableName` mapping to launder it.

  Anything unattributable — a different table than the one asked for, an auxiliary
  table, no request object at all (which is every metadata / UI / discovery route,
  since they call `handleRouteError(res, error)` without one), or a phrasing that
  names no relation — is now the sanitised data-store fault the SQL-leak branch
  has always emitted: `500 { "error": "Internal data error", "code":
"DATABASE_ERROR" }`. 500 sits outside `isExpectedDataStatus`, which is what buys
  back the log line the silent 404 never had; the driver's own words still never
  reach the client.

  Deliberately unchanged:

  - **A genuine unknown object is still a quiet `404 OBJECT_NOT_FOUND`.** Both
    producers still land on one envelope (#3770): the protocol's registry gate,
    and the driver limb when the missing table is the requested object. It still
    logs nothing — an unknown object is a client mistake, not a fault (#4886).
  - **The engine-authored limbs.** `unknown object`, `object not found`,
    `[ObjectQL] No driver available for object '<name>'` and the quoted-name
    catch-all are ObjectStack's own vocabulary about a named object; they mean
    what they say. Only the DATABASE-authored limbs, which cannot know which table
    the caller wanted, needed attribution.
  - **The declared-status band.** #5437/#5464 (a declared 5xx is withheld and
    logged) and #5423/#5436 (a 4xx is truncated, not erased) answer in
    `resolveErrorResponse` before the heuristic is reached at all. That fix
    covered producers that declare `status: 500`; this path never reached it,
    because `saveMetaItem` rethrows the driver's `Error` with no `status` and no
    `code` — which is why the message text was judging it.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [64cd010]
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
- Updated dependencies [b746aa0]
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
- Updated dependencies [08f93bc]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [02dc076]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
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
- Updated dependencies [f104bab]
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
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/observability@17.0.0-rc.4
  - @objectstack/service-package@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 05d8a54: fix(rest)!: 服务端权威闸门现在也过滤 `areas[].navigation` —— area 内导航项的权限/能力闸门不再只是渲染层的礼貌 (#4722)

  `filterAppForUser` 是 `/meta` 上 app 元数据的**服务端权威可见性闸门**,但它此前只走 app
  的顶层 `navigation` 树:读到 `item.navigation` 不存在就原样返回,`item.areas` 从头到尾没被
  读过。后果是,写在 **area 内部**导航项上的 `requiredPermissions` / `requiresService`
  只有客户端 `NavigationRenderer` 会执行 —— 该条目连同它的 `objectName` / `pageName` /
  `componentRef` 指向,照常出现在 `/meta` 响应体里。改一次前端状态、或者直接读 `/meta` 的
  JSON,就能看到本该被 gate 掉的条目。对 areas 型 app 而言,导航项级闸门此前**不是**服务端强制。

  **现在**:同一个 `filterNav` 被复用到每一棵 `areas[].navigation` 上 —— 不是第二份实现,
  所以两棵树对同一个键的语义不可能漂移。列表 `GET /meta/apps` 与单项 `GET /meta/apps/:name`
  两条路径都覆盖(两者都经过这个函数;单项读对 app 类型本就绕过缓存)。

  **响应形状收紧(可能影响消费方)**:无权限用户拿到的 app 元数据里,被 gate 掉的 area 内
  导航项**不再出现**。被闸门滤空的 area 整个剥离 —— 与顶层树对「被滤空的 group」的既有处理
  同形(空壳标签没有消费价值);作者本就写成空的 area 原样返回(过滤只报告调用方看不到什么,
  不负责整理元数据)。任何依赖「服务端会把 area 内条目全量下发、由客户端自己藏」的消费方需要
  改为信任服务端已过滤后的树 —— 这正是本次收紧的目的。

  同一提交修正了 `resolveRegisteredServices` 的探测面:它此前每个节点只取第一个命中的子数组
  (`navigation` / `children` / `widgets` 三选一),不会下钻 `areas`。若不改,只在 area 内被
  引用的服务名不会被探测,而未探测的名字在闸门看来等同于「服务不存在」,会把一个本该存活的
  条目误剥离 —— 探测面必须与过滤面完全一致。

  **明确不做**:`visible`(CEL)在任何层级仍然只在客户端求值 —— 服务端求值需要绑定 `user`
  上下文,不是这个读路径现有的能力,另立单处理。这个不对称写进了代码注释、`packages/spec/liveness/app.json`
  的账本 note,以及 `rest.test.ts` 的 characterisation pin。必须永不到达浏览器的东西,写
  `requiredPermissions`,不要写 `visible`。#4651 退役的 **area 级**键(`areas[].visible` /
  `areas[].requiredPermissions`)未被复活:本次强制的是 area **里面**的项级闸门。

- 8aacf94: feat(rest,runtime,client): `POST /meta/_migrate-stored` — run the stored-metadata migration without a shell (#4327)

  `os migrate meta --stored` (#4327) gave ADR-0087's stored-metadata chain a finish
  line, but only for someone who can reach the deployment's database from a
  terminal. A hosted operator cannot, so on a managed deployment the chain had no
  finish line at all — just the per-read conversion, running forever, with no way
  to assert what protocol the rows are on.

  The same pass is now reachable over HTTP:

  ```ts
  const preview = await client.meta.migrateStored(); // writes nothing
  const result = await client.meta.migrateStored({ apply: true });
  const flows = await client.meta.migrateStored({ types: ["flow"] });
  ```

  It returns the same `StoredMigrationReport` the CLI renders, and takes the same
  posture:

  - **Preview by default.** `apply` must be literally `true`; an empty body, a
    missing body, and `"apply": "yes"` all preview. Nothing is inferred.
  - **Gated on `manage_metadata`.** Unlike the single-item `PUT /meta/:type/:name`
    next door, this rewrites every eligible row in the deployment, so it demands
    the ADR-0066 D1 authoring capability rather than just a session, and answers
    `403` otherwise. The gate runs before the protocol is probed, so an
    unauthorized caller cannot use `403`-vs-`501` to learn which kernels can be
    migrated. `/meta`'s anonymous-deny umbrella still closes it to anonymous
    callers first.
  - **Attributed to the caller.** The `actor` recorded on the history and audit
    rows names the user who fired it — that is the question those rows exist to
    answer.

  **Flows need no extra setup on this path.** The CLI has to boot an inert
  automation engine to hold the executor registry ADR-0078's conflict guard needs;
  a server already has a live one, and the protocol resolves it from the services
  registry itself (#4498), so this route covers flow rows by simply running in the
  process that owns them.

  Registered on both the REST server and the runtime dispatcher's `/meta` domain,
  ledgered in both route ledgers, and mounted before `/:type` so the
  leading-underscore segment is never captured as a metadata type name.

### Patch Changes

- 2826d1e: fix(automation,approvals): an approval decision can no longer succeed while its flow stays parked (#4420)

  A flow paused at an `approval` node, a deploy, then an approver clicking
  Approve: the request row flipped to `approved`, the UI toasted success — and
  the flow never moved. No next-stage request, no error, the record's mirrored
  status frozen mid-workflow. Approval flows pause for days by design, so a
  restart mid-flight is the normal case: every release could quietly zombify
  every in-flight approval, with the approvers none the wiser.

  Durable suspended runs (#1518) had shipped and were not the missing piece. Two
  other things were.

  **The wiring could enable a store over a table nobody had created.** Object
  registration and store activation resolve different services in different
  phases — `manifest` at `init()`, `objectql` at `start()` — and the plugin
  declared no ordering. Composed ahead of ObjectQL, `init()` found no `manifest`,
  warned, and continued; `start()` then attached the DB-backed store anyway. Every
  suspend failed with `no such table: sys_automation_run` into a log line nobody
  read, pauses silently stayed in memory, and the next restart lost them all.
  Now: `AutomationServicePlugin` declares `optionalDependencies:
['com.objectstack.engine.objectql']` (order-if-present, per ADR-0116 — an
  engine-less kernel must still boot); a registration missed at `init()` is
  retried at `start()`, which still lands before ObjectQL's schema sync; the
  store is never attached when registration did not happen, and says so at
  **error** level instead of warning; the table is probed once at boot so a
  broken setup surfaces there rather than one failed write at a time; and a
  failed durable write of a paused run is logged at error — it is data loss in
  waiting, not a warning.

  **A reported resume failure read as success.** `AutomationEngine.resume()`
  answers a lost run by _returning_ `{ success: false }`, never by throwing.
  `ApprovalService` discarded that return value, and `decide()` counted only a
  thrown error as failure — so a decision against a dead run came back
  `resumed: true`, HTTP 200. Resume failures are now classified
  (`RUN_NOT_FOUND`, `STORE_UNAVAILABLE`, `RESUME_IN_PROGRESS`, joining
  `PERMISSION_DENIED` / `INVALID_SIGNAL`), so a run that is gone for good is
  distinguishable from a store that is merely unreachable, and the raw resume
  route maps them to 404 / 503 / 409.

  Approvals acts on them. A new `AutomationEngine.hasSuspendedRun(runId)` — which
  reads the suspension store, unlike `getRun()`, and throws rather than answering
  `false` when the store is unreadable — pre-flights every flow-advancing
  operation (`decide`, `sendBack`, `resubmit`) **before its first write**, so the
  zombie half-state is never created rather than merely reported: the decision
  fails with `RESUME_TARGET_LOST` (HTTP 409) and the request stays actionable. A
  resume that fails after the decision is durable can no longer be undone, but it
  now throws `RESUME_FAILED` (HTTP 500) naming the stranded run instead of
  reporting success. A concurrent duplicate resume stays benign — the engine's
  idempotency guard is doing its job — and reports through the new optional
  `resumeError` field. Recall and revise-window cancellation stay non-fatal by
  design (they abandon the request), but log at error with the reason instead of
  swallowing it. Compositions with no automation engine attached are unaffected.

  Existing zombie requests from affected deployments (already `approved`, run
  stranded) are not repaired by this change — `releaseDeadRunRequests` only
  sweeps requests that are still `pending`.

- be25f97: fix(rest): dataset queries stop rejecting their own read-time annotation

  Every widget on every dataset-bound dashboard failed with

  ```
  Dataset query failed: 400 Bad Request — Invalid dataset definition.
  ```

  The dataset itself was fine. `POST /analytics/dataset/query` resolves a saved
  `datasetName` through `getMetaItems`, and the metadata READ path stamps the
  spec-validation verdict `_diagnostics` onto every document it serves. Since
  #4001 closed the metadata schemas, `DatasetSchema.parse()` rejects unrecognized
  keys instead of dropping them — so the route handed a served document back to
  the very schema that produced it and got `unrecognized_keys: ["_diagnostics"]`
  for its trouble. The 400 blamed the author for a key the server had just added.

  This is the failure mode `stripReadDecorations` exists to prevent, and the one
  `spec/kernel/metadata-read-decorations.ts` already documents from the cold-boot
  flow bind (cloud#971): _a served body is not a valid input to the schema that
  produced it._ The route now strips read decorations before validating.

  Stripped on **both** branches, not only the `datasetName` read: the Studio
  dataset preview posts its draft inline, and that draft is the document the
  designer GET-loaded — decorations and all. A hand-authored draft never carries
  these keys, so the strip is a no-op there. The ADR-0010 provenance envelope
  (`_packageId`, `_provenance`, `_lock`, …) is deliberately _not_ a read
  decoration and still survives the round-trip.

  Regression coverage for the saved-dataset path was the gap that let this ship —
  every existing case passed the dataset inline, so nothing exercised the read.
  The route's tests now cover resolve-by-name, the inline decorated draft, the
  404, and a genuinely malformed saved dataset (still a 400).

- 9fd9ae7: Init-time service consumption is now declared everywhere, and the declaration is enforced (#4471, ADR-0116). A new CI gate (`check:init-service-contract`) walks every plugin's `init()` call graph — including private helpers, the shape that shipped #4420 — and errors on any init-reachable `getService('X')` of a workspace-provided service that is not covered by `dependencies`, `optionalDependencies`, or `requiresServices`. Eleven previously undeclared init-time consumers (metadata, rest, cli serve plugins, and seven services) now declare `optionalDependencies` on their providers, so the kernel orders them deterministically instead of by registration luck; each still degrades on purpose when the provider is not composed. Plugin authors: a best-effort init-time `getService` must declare its provider in `optionalDependencies` (declared tolerance) — the checker never exempts it.
- be90dea: fix(plugin-audit,rest)!: `sys_comment` derives its access from the record its thread names (#4630)

  Attachments derive their visibility from the parent record; comments derived
  nothing. On the _same_ record, with the _same_ user, the two answered
  differently:

  ```
  user: rep2 (does NOT own and cannot read the opportunity)
  GET  /api/v1/data/crm_opportunity?$filter=["id","=","1A7n…"]      → 200, 0 rows
  GET  /api/v1/data/sys_attachment?$filter=["parent_id","=","1A7n…"] → 200, 0 rows
  GET  /api/v1/data/sys_comment?$filter=["thread_id","=","crm_opportunity:1A7n…"]
                                                                     → 200, 1 row
  POST /api/v1/data/sys_comment {"thread_id":"crm_opportunity:", …}  → 201 Created
  ```

  `sys_comment` is public, has no owner column, and hides its parent inside a
  string (`thread_id` = `{object_name}:{record_id}`), so neither OWD/sharing nor
  RLS ever narrowed it. Because `enable.feeds` is opt-OUT (spec default `true`),
  every object in every app carried that org-wide readable, org-wide writable
  side-channel — a deployment that carefully authored OWD, sharing rules and RLS
  on its records still leaked their discussion.

  `AuditPlugin` now installs the same two-part kit `service-storage` installs for
  `sys_attachment`, keyed off `thread_id`'s parent:

  - **read** — a `find`/`findOne`/`count`/`aggregate` middleware intersects every
    query with the threads whose record the caller can actually read (resolved
    through the caller-scoped engine, so the parent's own OWD/sharing/RLS/CRUD
    decide). `count()` is filtered identically to `find()`, so a list `total`
    cannot leak the hidden rows' existence either.
  - **write** — `beforeInsert` requires READ on the record the thread names;
    `beforeUpdate` / `beforeDelete` require the caller to be the comment's AUTHOR
    or to hold EDIT on that record. `author_id` is server-stamped from the
    session, so a client-supplied value never wins.

  Everything fails CLOSED: a `thread_id` that names no record — the dangling
  `"crm_opportunity:"` above, a free-form thread, a thread on `sys_comment`
  itself — is refused on write and excluded on read, and a filter that cannot be
  computed denies all rather than falling open. Refusals answer **403
  `RECORD_NOT_ACCESSIBLE`** (the standard error catalog, per ADR-0112 — a generic
  permission condition takes a catalogued code rather than a new synonym), with
  `error.object` naming the record's object.

  **Breaking for deployments that depended on the gap.** Reads that used to
  return other people's comments now return fewer rows (or none), and writes that
  used to 201 now 403. Specifically:

  - Listing `sys_comment` without being able to read the parent record → the row
    is gone, not merely unlabelled. Panels that render a thread must be reached by
    a principal who can read the record.
  - Threads whose `thread_id` is not `{object_name}:{record_id}` are no longer
    usable at all: creating one is refused, and existing rows become invisible to
    everyone but system context. Migrate free-form threads to a real record
    reference (or keep them under a system-context surface).
  - Deleting or editing another user's comment now requires EDIT on the record.
    Note also that `sys_comment` delete already needed a permission set carrying
    `allowDelete` — the `member_default` baseline has none (ADR-0090 D5).
  - Posting a comment no longer requires the client to send `author_id` (it is
    stamped); a client that sends someone else's is silently corrected rather than
    believed.

  Orthogonal and unchanged: `enable.feeds` (`FEEDS_DISABLED`) still gates whether
  an object has comments at all, and anonymous callers are still refused with 401
  before any of this runs.

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
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
- Updated dependencies [ff17642]
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
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
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
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/observability@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2
  - @objectstack/service-package@17.0.0-rc.2

## 17.0.0-rc.1

### Major Changes

- 3c628ce: feat(auth)!: retire the `api.requireAuth` opt-out — anonymous access to object data is always denied (#3963)

  `api.requireAuth: false` let a deployment open its ENTIRE data plane with one
  config key. It is removed. Auth is a kernel concern, not a deployment posture:
  anonymous callers are denied on every HTTP surface that reaches object data,
  unconditionally.

  Every surface that legitimately serves a session-less caller already derives its
  own narrow authorization from a DECLARATION, so none of them needed the global
  switch:

  - control plane (`/auth/*`, `/health`, `/ready`, `/discovery`, ADR-0069
    remediation) — the auth-gate allowlist;
  - public form submission — `publicFormGrant` (ADR-0056 Option A);
  - share links — the capability token, validated then read as SYSTEM;
  - a `book.audience: 'public'` read — the ADR-0046 §6.7 audience gate (#3995);
  - MCP — an OAuth token or API key.

  **Breaking changes.**

  - `api.requireAuth` is a retired key. It is tombstoned (`retiredKey`) in both
    `RestApiConfigSchema` and the stack `api` block, so authoring it now fails with
    a fix-it message rather than being silently stripped (the ADR-0104 / #3733
    quiet-failure this whole line of work has been closing). `os migrate meta`
    drops it via the protocol-17 conversion `stack-api-require-auth-removed`.
  - `shouldDenyAnonymous` (@objectstack/core) no longer takes a `requireAuth`
    input; it denies any anonymous, non-system caller outside the control-plane
    allowlist.
  - A stack that mounts **no auth at all** now FAILS AT BOOT when it would serve a
    data API (`objectstack serve`, plugin-dev), instead of getting an explicit
    fail-open. Enable auth (the `auth` tier or AuthPlugin), or run without the data
    API. There is no anonymous-data carve-out any more — publishing a public
    surface is done by declaration (see above).

  **Migration.** Delete `api.requireAuth` from the stack config (or run
  `os migrate meta`). If you were serving data publicly with `requireAuth: false`,
  replace it with the declaration that fits: a public form view, a share link, or
  `book.audience: 'public'`. If you have an auth-less stack that intentionally
  served data, it must now mount auth or stop serving the data API.

### Minor Changes

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

- 7d7521f: feat(spec,rest,objectql)!: a closed field-level error catalog, and Zod stops leaking onto the wire (#3977)

  Settles the vocabulary ADR-0112 D6 deferred, per [ADR-0114](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0114-field-level-error-code-catalog.md).

  **`FieldErrorCode` — a closed, lowercase catalog.** 27 members covering what the
  six emitters already emit. `FieldErrorSchema.code` tightens from `z.string()` to
  this enum, so a validation body's per-field codes are validated for the first time.
  `FieldValidationError.code` (objectql) and `FieldCoerceError.code` (rest) stop
  being a hand-listed union and a bare `string` respectively and reference the
  catalog, so the three cannot drift apart.

  Lowercase is deliberate, not an oversight against ADR-0112's SCREAMING*SNAKE: a
  top-level code names the condition the \_request* hit, while a field-level code
  names the _constraint_ the value violated — and constraints are declared in the
  metadata's own snake_case, so `max_length` the code and `max_length: 50` the
  property are the same word on purpose.

  **Zod issue codes no longer reach the wire (wire-visible).** Routes that validate
  with Zod passed its vocabulary straight through, so `fields[]` spoke a different
  language depending on which route served it, and `too_small` was ambiguous between
  a short string, a small number and a short array. `zodIssuesToFields` now maps
  using Zod's `origin`/`format`:

  | Was                                               | Now                                                |
  | :------------------------------------------------ | :------------------------------------------------- |
  | `too_small`                                       | `min_length` / `min_value` / `min_items`           |
  | `too_big`                                         | `max_length` / `max_value` / `max_items`           |
  | `invalid_format`                                  | `invalid_email` / `invalid_url` / `invalid_format` |
  | `invalid_value`                                   | `invalid_option`                                   |
  | `unrecognized_keys`                               | `unknown_field`                                    |
  | `invalid_union`, `invalid_element`, `invalid_key` | `invalid_shape`                                    |

  **A missing required property now reports `required`, not `invalid_type`.** Zod
  spells "absent" as a type mismatch against `undefined`, so passing it through made
  a form mark a _missing_ input as the wrong _type_. The two are indistinguishable on
  the issue alone, so the mapper takes the parsed input as an optional argument and
  walks the issue path; a caller that cannot supply it keeps `invalid_type` rather
  than guessing.

  **`unknown_param` → `unknown_field`.** `ActionParamIssue.code` references the
  catalog instead of its own literal union; the `param` key beside it already says
  what was addressed.

  **Not changed:** `EnhancedApiErrorSchema.fieldErrors` keeps its name even though
  every producer emits `fields`. Retiring an authorable key needs a tombstone plus a
  migration (ADR-0104's contract guard), so it lands on its own — the property now
  carries a banner saying which name the wire uses.

- 789ad63: fix(spec,rest): the batch-size cap is enforced now, and each bulk endpoint has one Zod source (#3939)

  `max 200` was declared in four places and enforced in one.

  `batch.zod.ts` put `.min(1).max(200)` on `BatchUpdateRequestSchema`,
  `UpdateManyRequestSchema` and `DeleteManyRequestSchema`, and the docs repeated
  it — but no per-object bulk route validated against those schemas, so
  `createMany` / `updateMany` / `deleteMany` / `/data/:object/batch` all accepted
  an unbounded list. The only route that capped anything was the cross-object
  `/batch`, and it checked the _configured_ `maxBatchSize` rather than the
  hardcoded 200 — so even the one enforcement point disagreed with the schema.

  That stopped being cosmetic with #3897, which made `deleteMany` delete per id by
  primary key (so `deleteBehavior` cascades run and every row gets its own
  result). A 10k-id body is now 10k sequential engine round-trips inside a single
  request, where before it was one statement that mostly failed anyway.

  **The cap moved to the routes, and the schemas gave it up.** Batch size is
  deployment policy — `RestServerConfig.batch.maxBatchSize`, 1..1000, default 200
  — so a hardcoded bound in the spec could only ever be a second, wrong answer
  (a deployment raising the limit to 500 would still have been refused at 200).
  All five bulk routes now call one `enforceBatchSize` helper with the configured
  value and answer with one envelope:

  ```json
  {
    "error": "Batch too large: 500 records (max 200)",
    "code": "BATCH_TOO_LARGE",
    "count": 500,
    "max": 200,
    "object": "account"
  }
  ```

  The cross-object route is included: it used to answer with a bare `error` string
  and no `code` for a client to key on.

  **One Zod source per bulk endpoint (Prime Directive #7).** Each of these
  endpoints had _two_ schemas, and they had already drifted into disagreeing about
  more than counts: `UpdateManyRequestSchema` described its rows with
  `BatchRecordSchema`, whose `id` and `data` are optional because the generic
  `/batch` route serves create (no id) and delete (no data) through the same
  shape — so the declared contract accepted `{}` rows that `updateManyData`, which
  reads `record.id` and `record.data` unconditionally, could never process. The
  enforced shape lived in the _other_ copy, in `protocol.zod.ts`.

  The wire body is now the single source (`UpdateManyRequestSchema` /
  `DeleteManyRequestSchema`, with the new `UpdateManyRecordSchema` for a row), and
  the protocol schemas are that plus the `object` the route takes from the URL
  path (#3933) — `UpdateManyRequestSchema.extend({ object })`. The derivation runs
  that direction because `protocol.zod` already imports `batch.zod`; the reverse
  would be a cycle.

  **Behaviour changes.**

  - A bulk request over the configured cap is `400 BATCH_TOO_LARGE` instead of
    being executed. Deployments that were quietly relying on unbounded batches
    should raise `batch.maxBatchSize` (up to 1000) rather than discover the cap in
    production.
  - `.min(1)` is gone with `.max(200)`: an empty batch is a no-op returning
    `total: 0`, which is what these routes already did, rather than a validation
    error the schema claimed but nothing raised.
  - `UpdateManyRequest` now types (and validates) `records` as
    `{ id: string; data: Record<string, unknown> }[]`. Callers already had to send
    that — the route has validated the strict shape since #3933 — but the declared
    type was looser.
  - New export: `UpdateManyRecordSchema` / `UpdateManyRecord`.

- fccec22: fix(rest): bulk writes bind to the object in the path, not the one in the body (#3933)

  `POST /data/:object/updateMany` spread the request body over the value it had
  just taken from the URL:

  ```js
  const result = await p.updateManyData!({
      object: req.params.object,   // trusted, written first
      ...req.body,                 // …and spread over it
      ...
  });
  ```

  The gate on the line above reads the PATH object — `enforceApiAccess` starts
  with `const objectName = req?.params?.object` — so `enable.apiEnabled` /
  `enable.apiMethods` (ADR-0049 / #1889) was enforced on the object in the URL
  while the object named in the body got written. Measured on a stock CRM dev
  deployment: `POST /data/crm_account/updateMany` with
  `{"object":"crm_contact", "records":[…]}` returned `succeeded: 1` and changed
  the `crm_contact` row. Point the URL at any exposed object, name a hidden one in
  the body, and the gate clears the wrong object every time.

  This is not a row-authorization bypass — the engine middleware still evaluates
  RLS/FLS against the object actually written, and `assertObjectRegistered` (#3770)
  still resolves it. What it defeats is the object-level exposure policy, the layer
  ADR-0049 exists to make enforceable rather than advisory.

  The path object is now written LAST, after the body, so the object the gate
  cleared is the object that gets written — a property of the code rather than of
  the caller declining to send that key. The body is parsed against
  `UpdateManyDataRequestSchema` first, which (Zod strips unknown keys) also stops a
  body `context` from becoming the execution context on a deployment where none
  resolves — `requireAuth: false` plus an anonymous caller, the one case where the
  trailing `...(context ? { context } : {})` has nothing to overwrite it with.

  `deleteMany` gets the same ordering: #3897 moved it behind a schema parse, but
  fed that parse `{ object: req.params.object, ...req.body }` — still body-wins.
  `createMany` (`records: req.body || []`) and `batch` (`request: req.body`) never
  splatted the body at the top level and are unaffected.

  **Behaviour change.** A malformed `updateMany` body is now `400
VALIDATION_FAILED` naming the offending path, instead of reaching the protocol
  and failing further in. A body `object` key is ignored rather than honoured.

- f4d7f1d: fix(metadata-protocol,rest): the id list is the only thing deleteMany can select on (#3897)

  `deleteManyData` built the predicate its endpoint is named after and then spread
  the caller's `options` **over** it:

  ```js
  return this.engine.delete(request.object, {
    where: { id: { $in: request.ids } },
    ...request.options, // ← lands after `where`, so it can replace it
  });
  ```

  `request.options` is caller-supplied — `POST /data/:object/deleteMany` splatted
  the whole request body into the protocol request (`{ object, ...req.body }`) —
  so one body key rewrote the operation:

  ```json
  { "ids": ["a"], "options": { "multi": true, "where": {} } }
  ```

  reached `engine.delete` as an unscoped bulk delete. The engine's write
  middleware still composes RLS/sharing predicates onto the AST, so the blast
  radius is not automatically the whole table: it is **everything the caller is
  allowed to delete**. For an ordinary user with delete permission that is the
  difference between the 3 records they asked for and every record they can see;
  measured on a stock CRM dev deployment, that payload against one id removed all
  8 rows in the object and returned the raw driver count (`8`). The same spread
  also accepted `context`, i.e. a forged principal wherever the route is reachable
  without auth.

  **The id set is now authoritative, structurally.** The engine options are built
  from the validated id list and nothing else — caller `options` is a
  `BatchOptions` bag (`atomic` / `returnRecords` / `continueOnError` /
  `validateOnly`) that carries nothing `engine.delete` consumes, so merging it
  could only ever smuggle in engine keys. Ids must be scalars, so an operator
  object (`{"ids":[{"$ne":null}]}`) cannot reach `where.id` either; a malformed
  list is a `400 VALIDATION_FAILED` instead of a wider delete. The REST route
  parses the body against `DeleteManyDataRequestSchema` first, one hop earlier —
  Zod object schemas strip unknown keys, so `options.where`, top-level `where` and
  a body `context` no longer survive the ingress at all.

  **The endpoint also works now.** `deleteManyData` never set `multi`, so a
  correctly-formed `{"ids":[…]}` hit the engine's
  `'Delete requires an ID or options.multi=true'` throw — only the requests that
  triggered the override above ever completed. Deletes now go one id at a time by
  primary key, the same shape `batchData`'s `delete` case uses, which closes two
  gaps behind that: the bulk branch skips `cascadeDeleteRelations`, so
  `deleteBehavior` (`cascade` / `set_null` / `restrict`) was not honoured for the
  rows it removed; and the declared `BatchUpdateResponse` contract (per-record
  `results`, `atomic`, `continueOnError`) was unimplementable from a bulk row
  count. Both are delivered rather than declared.

  **Behaviour change.** The endpoint returns a `BatchUpdateResponse`
  (`{ success, operation, total, succeeded, failed, results }`) where it
  previously returned the driver's raw delete count — on the paths where it
  returned anything at all. The caller's execution context is threaded to every
  delete, so RLS/FLS now run under the caller here as they do on the single-record
  route.

- 507b92a: fix(spec,objectql,rest,runtime): field-validation messages answer in the caller's language, named by the field's label (#3957)

  The write path built every built-in validation message by concatenating the **API
  field name** into a **hardcoded English** template. Those strings are what the
  Console toast, the CSV-import row report, the CLI and any custom client display
  verbatim, so a Chinese-locale user importing a bad row read:

  ```
  第 1 行:penalty_amount must be ≥ 0
  ```

  …for a field declared `label: '处罚金额'` with a full `zh-CN` bundle loaded. The
  form layer localized the _same_ constraint correctly (the browser's native
  `min`), so the language flipped depending on which layer caught the value.

  **Three things changed.**

  1. **The message is rendered in the caller's locale** from a built-in catalog
     (`BUILTIN_VALIDATION_MESSAGES`, `@objectstack/spec/system`) shipping `en`,
     `zh-CN`, `ja-JP`, `es-ES` — the same four locales as the platform bundles.
     The locale comes from `ExecutionContext.locale`, whose contract already read
     "Drives message catalogs"; this is the consumer that makes that true. Both
     HTTP entries (REST server, runtime dispatcher) now resolve it from the
     request's `Accept-Language` / `?locale` first, falling back to the workspace
     `localization.locale` — so a rejection message and the field labels around it
     can no longer disagree.

  2. **The field is named by its label, never the API name**: translation bundle
     (`objects.<obj>.fields.<f>.label`) → declared `label` → API name as the last
     resort. `FieldValidationError.field` still carries the API name so a form can
     focus the right input.

  3. **The constraint is exposed as data**, so a client can format its own text
     instead of parsing the sentence:
     `{ field, code, message, label, constraint: { min: 0 } }`. This rides
     ADR-0114's existing `constraint` / `value` positions on `FieldErrorSchema`
     (`constraint` tightens from `unknown` to `Record<string, unknown>`) rather
     than adding a parallel payload — `label` is the only new field. The bag
     carries `min`/`max`/`minLength`/`maxLength`/`actual`/`allowed`/`type`, and the
     message templates interpolate from exactly those keys.

  Covered end-to-end, not only in the validator: single and batch insert,
  single-id and multi-row update, ADR-0113's clear-out rejection, the object-level
  rule evaluator's own built-in messages (`requiredWhen`, per-option gating,
  state-machine fallbacks), and the importer's cell-coercion, required pre-check
  and #3956 bound pre-check messages — all of which land in the same row report.

  **What this changes for consumers.**

  - `code` is unchanged (ADR-0114's `FieldErrorCode`) and remains the thing to
    match on. Message keys are finer-grained than codes — `invalid_datetime`,
    `invalid_option_value`, `required_cleared` are rendering detail and never reach
    the wire — so localization never splits the client-facing vocabulary.
  - `message` **text changes**: it is localized, and it names the field by label
    even in English (`Budget must be ≥ 0`, not `budget must be ≥ 0`). Anything
    asserting on the old English string should match `code` (and now
    `constraint`) instead.
  - An author-written validation-rule `message` is never touched — it is already
    in the language its author chose.
  - A deployment can override any built-in message with a `translation` item
    defining `validation.field.<messageKey>` (e.g.
    `validation.field.min_value: '{{label}}不得小于 {{min}} 元'`).
  - The importer's reference-failure message no longer names the target object's
    API name (`no sys_user matches "…"`): naming internal identifiers is the
    defect being fixed, and the column plus the offending value are what an
    importer can act on.

- be7945a: feat(rest): `audience: 'public'` publishes a book anonymously on a secure-by-default deployment (#3963)

  `book.audience: 'public'` was a declared per-book capability that in practice
  required the deployment to open its **entire** data plane. The `/meta` umbrella
  gate refused every anonymous caller unless `api.requireAuth` was `false`, so a
  `public` book was only ever reachable inside a globally-public deployment — the
  audience model was _re-narrowing_ what that flag had already opened, not granting
  anything of its own. ADR-0046 §6.7 recorded exactly that as ground truth ("the
  gate is the optional global `requireAuth` … not the handler").

  The exemption is now derived from the declaration, the same shape ADR-0056
  Option A chose for public form submission (`publicFormGrant`): the umbrella gate
  admits an anonymous **GET** of the book/doc read surface, and the §6.7 audience
  gate inside the handler is what authorizes it.

  Narrow in three independent ways:

  1. **Only when no execution context resolved.** An authenticated caller still
     goes through `enforceAuth` unchanged, so the ADR-0069 auth-policy gate
     (expired password, enforced MFA) keeps governing a gated session's book reads.
  2. **Only GET, only book/doc.** `GET /meta/:type`, `GET /meta/:type/:name` (type
     `book` or `doc`, either spelling — #3984) and `GET /meta/book/:name/tree`.
     Every other type stays 401 for anonymous, writes stay 401, and `GET /meta`
     itself stays 401. The predicate keys on the REGISTERED route path plus the
     normalized `:type`, so a route added later cannot fall into it by accident.
  3. **Reachability, not authorization.** `audienceAllows` admits `'public'` only;
     `org` and `{ permissionSet }` books require `caller.authenticated` and
     unresolvable holdings fail closed, so an anonymous read of a gated book is
     still `401`.

  A deployment can now publish a public manual with `requireAuth: true` — which is
  the prerequisite for retiring that flag entirely (#3963 step 2). ADR-0046 §6.7
  carries an amendment recording the new gate; its SEO and tenant-from-host
  reasoning is unchanged, having never depended on the flag.

- a1b61e0: Request bodies are now checked against the schemas the API catalog declares for them (#3899, the request-side dual of #3877).

  **Routes that now answer `400 VALIDATION_FAILED` + `fields[]` for a body violating their declared `requestSchema`** (previously the body was consumed raw, and a malformed one silently executed different semantics):

  - `POST /data/:object/query` — body must be a QueryAST (`FindDataRequestSchema`); a garbage body used to degrade into an unfiltered full read. The path `object` is now pinned into the forwarded query (a body `object` can no longer contradict the path).
  - `POST /data/:object` / `PATCH /data/:object/:id` — body must be a record object (`CreateDataRequestSchema` / `UpdateDataRequestSchema`).
  - `POST /data/:object/batch` — body must be a `BatchUpdateRequestSchema` (`operation` + `records[]`).
  - `POST /data/:object/createMany` — body must be a bare JSON array of records (`CreateManyDataRequestSchema`); `{ records: [...] }` (updateMany's envelope) is rejected with a pointer.
  - `POST /notifications/read` — body must be `{ ids: string[] }` (`MarkNotificationsReadRequestSchema`); a misnamed key used to become `markRead(userId, [])` — a 200 no-op that never cleared the badge.

  **Dispatcher automation routes now validate their bodies** (no catalog schema; hand-written guards):

  - `POST /automation` and `PUT /automation/:name` require a flow-definition object, and POST requires a non-empty `name` — a mistyped `name` used to register the flow under the key `undefined` and echo 200.
  - `POST /automation/:name/toggle` is strictly `{ enabled?: boolean }` — `{"enable": false}` (one letter off) used to ENABLE the flow and answer 200 `{enabled: true}`; it is now a 400 naming the offending key. An empty body still means enable.

  **`QuerySchema` now declares the search contract ADR-0061 actually serves** (additive): `search` accepts the canonical bare query string as well as the structured `FullTextSearch` form, and the server-validated `searchFields` narrowing is formally declared. Previously the schema declared only the object form while every surface (and the ADR's own conformance proof) sent the string — drift that surfaced the moment request bodies started being validated.

  **Catalog corrections in `@objectstack/spec` (`plugin-rest-api.zod.ts`)** — documentation-only tables:

  - `DEFAULT_NOTIFICATION_ROUTES` drops the four device/preferences endpoints — those server routes were removed in #3612 (never built), yet the table kept declaring them, `requestSchema` and all.
  - `DEFAULT_AUTOMATION_ROUTES`' trigger endpoint path is corrected `/trigger` → `/trigger/:name` (the mounted path; the flow name rides the path) and its `AutomationTriggerRequestSchema` declaration is removed — that schema never described this route's wire shape.
  - `DEFAULT_DATA_CRUD_ROUTES` gains the `POST /:object/query` entry (mounted since forever, previously undeclared), repoints create/update to the schemas the routes actually validate (`CreateDataRequestSchema` / `UpdateDataRequestSchema` — the old `CreateRequestSchema`/`UpdateRequestSchema` names described a `{ data }` envelope the wire never had), and drops `requestSchema` from GET/DELETE entries (path/query-bound inputs; nothing can violate them as a body).
  - New gates: catalog `requestSchema`/`responseSchema` strings must resolve to real exported Zod schemas, `requestSchema` may only sit on body-carrying methods, and every declared `requestSchema` on a mounted route has a violating-body → 400 conformance case (`packages/rest` + `packages/runtime` request-schema-gate suites).

  Migration: clients that already send the documented shapes are unaffected. If you relied on a malformed body being silently accepted (e.g. posting `{ records: [...] }` to `createMany`, a non-boolean `enabled` to toggle, or an off-schema analytics/query body), fix the request to the declared shape — the 400's `fields[]` names each offending key.

### Patch Changes

- 8d895ff: feat(spec,objectql,rest): publish the audit-provenance and import-coercion vocabularies (#3786, #4173)

  Two more hand-copied lists retired the same way, each replaced by one spec
  export and derivation at every consumer.

  **`AUDIT_PROVENANCE_FIELDS`** (`@objectstack/spec/data`, with the
  `AuditProvenanceField` type) — the four columns `applySystemFields` injects on
  every audit-tracked object: `created_at`, `created_by`, `updated_at`,
  `updated_by`. That four-name list existed in at least four copies across two
  repos: the registry's injection if-chain, the rule-validator's `preserveAudit`
  allowlist ("Kept in sync with the registry's auto-injected audit fields" — by
  nothing), and two objectui render surfaces. Now:

  - the registry's injection is table-driven, keyed by the tuple with a
    `satisfies Record<AuditProvenanceField, …>` clause — a name added to the spec
    without a column definition (or vice versa) is a compile error, the
    `APPROVER_VALUE_BINDINGS` discipline;
  - the rule-validator's `AUDIT_TIMELINE_FIELDS` derives from the same tuple;
  - `FIELD_GROUP_SYSTEM_FIELDS`' audit prefix derives from it too — one
    declaration even inside the file that hosts both;
  - objectui's `AUDIT_FIELD_BY_ROLE` already pins itself by subset assertion and
    can import the tuple directly once this release is published.

  Injection behaviour is byte-identical — a conformance test pins every injected
  column's shape against the pre-refactor definitions.

  **`IMPORT_BOOLEAN_TRUE_TOKENS` / `IMPORT_BOOLEAN_FALSE_TOKENS` /
  `IMPORT_REFERENCE_TYPES`** (`@objectstack/spec/data`) — the `/import` coercion
  vocabulary #4173 asked for. The server's `import-coerce.ts` now derives its
  `BOOL_TRUE` / `BOOL_FALSE` / `REFERENCE_TYPES` from these instead of owning
  them privately, and objectui's Import Wizard preview — which re-checks the same
  contract client-side so a cell is flagged red exactly when the server would
  reject it — can retire its pinned-inventory mirror once this release is
  published (the retirement path is written in that file's own header).
  `IMPORT_REFERENCE_TYPES` ships with the legacy `'reference'` spelling included,
  retiring the `+ 'reference'` literal both ends carried separately. The tables'
  own discipline is tested: sets disjoint, every token pre-normalized
  (lower-case, trimmed), and the Chinese / check-mark spreadsheet-reality tokens
  pinned by name.

  No behaviour change anywhere: every derived value is byte-identical to the
  literal it replaces.

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

- fae74b5: fix(rest): give the bare 501 error exits a machine `code` (#4067)

  Most REST error exits already carry a typed `code` (`VALIDATION_FAILED`,
  `BATCH_NOT_ATOMIC`, `BATCH_TOO_LARGE`, `PERMISSION_DENIED`), and the clone /
  search 501s already answer `{ error, code: 'NOT_IMPLEMENTED' }`. Four 501 exits
  still returned a bare `{ error: '<string>' }` with no code, so a client could
  only key on the prose:

  - the cross-object transactional batch route (`POST {basePath}/batch`) when the
    runtime has no `transaction()` — the last untyped exit on that route, whose
    siblings (`BATCH_NOT_ATOMIC`, `VALIDATION_FAILED`, the `enforceBatchSize`
    `BATCH_TOO_LARGE`) were already typed by the #3897 / #3933 / #3939 line;
  - the two `saveMetaItem`-unsupported exits;
  - the UI-view-resolution-unsupported exit.

  Each now carries `code: 'NOT_IMPLEMENTED'`, matching the clone / search 501s.
  Additive only — the `error` message is unchanged and no status changes — so
  existing clients are unaffected; new ones can branch on the code.

- 366105c: fix(service-datasource,rest): the last three uncovered datasource routes answer their registered refusal code (#4264)

  #4249 (fixed in #4263) gave the rest surface's two introspection routes a
  failure contract; this closes the same gap on the three sibling routes it left
  uncovered. Each had no `catch` around its service call, so a service throw was
  swallowed by the adapter and surfaced as the pre-#3675 non-envelope
  `500 { error: 'No response from handler' }` — no `success` flag, no
  `error.message`, no code to switch on, real cause lost.

  Wire-visible changes — each route now answers `400` in the declared envelope,
  under the refusal code registered (ADR-0112) for the service it dispatches to,
  with the service's own message at `error.message`:

  - `GET /api/v1/datasources` (`listDatasources` throw) →
    `400 DATASOURCE_ADMIN_ERROR` — matching its eight siblings in
    `service-datasource/admin-routes.ts`, which already answer their catches this
    way.
  - `POST /api/v1/datasources/:name/external/refresh-catalog` (`refreshCatalog`
    throw) and `POST /api/v1/datasources/:name/external/validate` (`validateAll`
    throw) → `400 EXTERNAL_DATASOURCE_ERROR` — the same code #4249 gave the two
    introspection routes one block above them.

  The issue left the code choice open (`INTERNAL_ERROR` was the alternative);
  the registered per-service codes win on consistency: every other catch in both
  modules — including pure reads — already answers 400 with the service-attributed
  code, and `refreshCatalog`'s dominant throw class (unknown datasource,
  unreachable remote, no such schema) is the one #4249 already adjudicated as a
  400 refusal on `listRemoteTables`. A 500 here would fork the failure contract
  within a module — the drift #4249 removed.

  No new codes: both were registered in the error-code ledger by #4263. The
  envelope-conformance suites and the `REFUSALS` pin table gain one row per
  route.

- f0d6594: fix(rest): `GET /data/:object/export` honours a `search` term

  The streaming export route accepted `filter` and `orderby` but had no way to
  carry the term a user had typed into the list's search box. So exporting after
  a search downloaded the **unsearched superset** — more rows than the screen
  showed, in a file that looks authoritative, with nothing indicating the
  difference. The route's own comment claimed the opposite: that it "mirrors the
  active view's filter + sort so the exported file matches what the user sees".

  Same family as a dropped filter (objectstack#3948, objectstack#4181): a
  plausible answer that is quietly broader than the one asked for.

  Two new query params, both matching the list endpoint's semantics:

  - `search=<term>` — folded into `findData` as `$search`, so it **composes**
    with `filter` (`{ $and: [filter, search] }`) rather than replacing it. Empty
    or whitespace-only terms are ignored rather than applied as a blank predicate.
  - `searchFields=a,b` — the ADR-0061 override for which fields the term scans.
    Only meaningful alongside `search`, and intersected with the object's allowed
    searchable set by the engine, exactly as on the list endpoint.

  Unknown query params on this route were already ignored, so a client that sends
  `search` to an older server gets today's behaviour rather than an error.

  Covered by `export-integration.test.ts` against the real engine + protocol: the
  composition case is built so each half alone returns a different non-empty
  result and only "both applied" returns none. Reverting the route change fails 4
  of the tests. The file's in-memory driver also learned `$or` / `$contains` —
  without them a search predicate is a silent no-op and an "it filtered"
  assertion would pass for the wrong reason.

- bcf1112: fix(service-datasource,rest)!: external-datasource refusals answer their own error code (#4249)

  #4225 / #4234 fixed the 503 `message` on the three routes in
  `service-datasource/admin-routes.ts` that dispatch to `external-datasource`
  rather than `datasource-admin`. The identical mis-attribution survived one field
  over, on the 400 path — and machine-readably: one shared `badRequest` helper
  hard-coded `DATASOURCE_ADMIN_ERROR`, which the ADR-0112 ledger defines as a
  refusal _from the datasource-admin service_. So a `no such schema` raised by the
  external-datasource introspector was reported as datasource-admin's, and where
  #4225 misled a human reading prose, this misrouted a client switching on
  `error.code`.

  `EXTERNAL_DATASOURCE_ERROR` is now registered in the error-code ledger — under
  `@objectstack/service-datasource` and `@objectstack/rest`, the two packages that
  emit it; per the ledger's own rule the per-package rows are provenance, not
  identity — and `badRequest` takes the same `ServiceName` the route passed to
  `resolve` (#4234), so the code, like the 503 message, comes from the service the
  route actually dispatches to.

  Wire-visible changes:

  - **The three external-datasource routes' 400 `error.code`** —
    `GET /datasources/:name/remote-tables`, `POST /datasources/:name/test`,
    `POST /datasources/:name/object-draft` — is now `EXTERNAL_DATASOURCE_ERROR`
    (was `DATASOURCE_ADMIN_ERROR`). Status, envelope, and `error.message` are
    unchanged, as is everything on the six datasource-admin routes. No consumer
    branches on the old code (grepped both repos, all the ADR-0112 sweep forms).
  - **The rest surface's two introspection routes now have a failure contract at
    all.** `GET /datasources/:name/external/tables` and
    `POST /datasources/:name/external/tables/:remote/draft` carried no
    `try`/`catch`, so the very same service operations that answer 400 through
    the admin surface surfaced here as the adapter's non-envelope
    `500 { error: 'No response from handler' }`. They now answer
    `400 EXTERNAL_DATASOURCE_ERROR` in the declared envelope — one operation, one
    failure contract, on both paths. (`EXTERNAL_IMPORT_ERROR` on the import route
    is unchanged: a refused import is a different act from a failed
    introspection, and its name says so.)

  Why a new registered code rather than reusing one: ADR-0112's ledger asks
  _generic_ conditions to reuse the standard catalog — that argument carried
  #4225's 503, where `SERVICE_UNAVAILABLE` is correct for all nine routes and only
  the free-text `message` named the service. A refusal specific to one service is
  exactly what registered extension codes are for, and the closed `ErrorCode`
  union means correcting the attribution had to be a ledger edit. Widening
  `EXTERNAL_IMPORT_ERROR` to cover introspection was rejected because these are
  not imports; leaving the throws uncaught was rejected because the adapter's 500
  is not the declared envelope.

  The conformance rows that pinned the drift move with it, and each surface now
  pins the refusal code per route the way #4234 pinned the 503 message per route.

  Pre-existing, like #4225: #3843 carried every code string over verbatim.

- 99b4392: Advertise `mcp` in `/discovery` only when it is actually serveable (#4024).

  Both discovery producers gated the `/mcp` route on `isMcpServerEnabled()` alone.
  The stated justification was a lockstep — `os serve` auto-loads plugin-mcp from
  the same flag, so on that path advertised did imply mounted. But the lockstep is
  a property of the CLI, not of the dispatcher: `@objectstack/rest` has no
  `@objectstack/mcp` dependency, mounts no `/mcp` route and performs no auto-load,
  so a host that embedded it without plugin-mcp advertised `/mcp` in `/discovery`
  and then answered 501 on it — the `declared ≠ enforced` failure #3369 forbids,
  and a broken contract for third-party clients that read `/discovery` to decide
  what exists.

  Both producers now require the flag AND a serveable MCP service. The runtime
  dispatcher gates on the handler's own predicate (`typeof
mcp.handleHttpRequest === 'function'`), so a wrong-shaped service can't
  over-promise either. `@objectstack/rest` probes via the per-request kernel or the
  single-env `serviceExistsProvider`; when it genuinely cannot probe it keeps the
  prior flag-only answer rather than hiding a working endpoint (fail-open,
  ADR-0057 D10). The `os serve` / `os dev` path is unchanged — it loads the plugin,
  so the service resolves and `/mcp` is still advertised.

  Also exercises the `mcp: false` seam in `route-parity.integration.test.ts`, which
  had existed unused since the file was written: `bootServe()` was only ever called
  with no args or `{ notification: false }`. The one capability whose advertisement
  was not service-presence gated was also the one whose absence was never tested.

- 495019b: fix(rest): the /meta per-type gates are enforced on both spellings of the type segment (#3984)

  Every per-type filter on `GET /meta/:type` and `GET /meta/:type/:name` compared
  `req.params.type` to a literal SINGULAR name, while the protocol's `getMetaItems`
  normalizes singular↔plural and serves either. Prime Directive #3 makes plural the
  canonical REST spelling, so the form a client is most likely to use —
  `/api/v1/meta/books` — reached the handler with every gate skipped.

  Three of those gates are authorization:

  - **ADR-0046 §6.7 book / doc audience** (three sites: the list, the single-item
    read, and the doc effective-audience union). `GET /meta/books` returned a
    `{ permissionSet }`-gated book — an _Admin Guide_ — to a caller who does not
    hold the set, and `GET /meta/books/admin_guide` answered `200` where the
    singular spelling answers `401`. On a publicly-served deployment the same skip
    handed an `org` book to an anonymous reader.
  - **App RBAC filter** — hides privileged apps (Studio, Setup) and gated nav
    entries from callers without the grants. `GET /meta/apps` skipped it.
  - **Dashboard `requiresService` gate** (ADR-0057 D10). `GET /meta/dashboards`
    skipped it.

  The remaining spelling-sensitive branches are behavioural rather than
  authorization — doc i18n locale collapse, and the list-response `content` strip —
  and were inconsistent between the two spellings for the same reason.

  Each handler now normalizes the type ONCE (`RestServer.metaTypeSingular`, backed
  by the same `PLURAL_TO_SINGULAR` table the protocol uses) and every gate keys on
  that value, so the two spellings of one route can no longer diverge. Found while
  scoping #3963.

- 20bc1ec: fix(spec,rest): the metadata forms save what they show — form ↔ Zod reconciliation (#3786)

  Every entry in `METADATA_FORM_REGISTRY` is a hand-written `defineForm` layout
  that names keys of a Zod schema it never imports: two descriptions of one key
  set, a comment asking the next author to keep them in step, and nothing that
  fails when they don't. #3786 asked for a sweep of that shape across the repo.
  **Four of the seventeen forms had already drifted, every one of them silently.**

  The silence is the point. `ObjectSchema` / `FieldSchema` are deliberately not
  `.strict()`, so a key the schema does not declare parses clean and is stripped
  on the way to storage — the same ADR-0104 failure class the `field.zod.ts`
  prune tombstone already describes in prose. An admin toggled a switch in
  Studio, got no error, and the value never landed.

  **What was broken, from an author's seat:**

  - **Object → Capabilities.** The block bound to `capabilities`; the
    `ObjectSchema` key is `enable`. All seven toggles (Track history, Searchable,
    API enabled, Files, Feeds, Activities, Clone) saved nothing.
  - **Object → Fields.** The inline column grid offered 16 keys `FieldSchema` has
    never declared. `PII`, `Encrypted`, `Indexed`, `Immutable`, `Filterable`,
    `Placeholder`, `Validation`/`Error message` and `Starting number` were
    controls with no storage behind them at all; the rest named keys the schema
    had **renamed** and the form never followed:
    `referenceFilter` → `lookupFilters`, `cascadeDelete` → `deleteBehavior`
    (a three-way enum, not a boolean), `formula` → `expression`,
    `displayFormat` → `autonumberFormat`, and the flat `summaryType` /
    `summaryField` pair → the single `summaryOperations` object, which also
    restores the `object` key the flat pair had no slot for. Roll-ups authored in
    that grid saved nothing.
  - **Report → Advanced.** `aria` and `performance` were pruned from
    `ReportSchema` by #3496; the form kept rendering both.
  - **Hook / Action → Body.** `memoryMb` was unauthorable — named in
    `hook.form.ts`'s own doc comment, absent from the list beneath it.
  - **Page → Interface.** `interfaceConfig.sort` was unauthorable, so a page's
    default sort order could not be set in Studio at all.

  **No authored metadata changes and nothing you can write is removed.** These
  were UI controls that never persisted; every corrected key is one `FieldSchema`
  / `ObjectSchema` already accepted. Metadata authored in YAML/TS was always
  validated against the real schema and is unaffected. If you had been filling
  those Studio controls expecting them to stick, they now either work (the
  renamed five) or are gone rather than lying to you.

  The metadata-form translation bundles are derived from the registry, so all
  four locales are regenerated. Worth naming what they contained: translated
  labels, in four languages, for switches that saved nothing — the drift had
  propagated into a generated artifact and been dutifully translated there.

  **The mechanism.** `metadata-form-zod-reconciliation.test.ts` walks every
  registered form and reconciles it against `getMetadataTypeSchema()`. The two
  directions are deliberately asymmetric: **form-only** (a control whose value is
  discarded) is always a defect and cannot be excused, because no design wants
  one; **zod-only** is ledgerable with a reason, for a deprecated key held back
  from new authoring or a curated quick-add subset that defers to a fuller
  editor. Ledger entries are checked for non-vacuity and for still resolving on
  both sides, per the #4045 / #4040 discipline. Verified by mutation — re-adding
  a stripped key, dropping a covered key, and offering a ledgered omission each
  turn the gate red.

  **New export: `TRANSLATABLE_METADATA_TYPES`** (`@objectstack/spec/system`), the
  set of metadata types whose labels `translateMetadataDocument` localizes,
  derived from its dispatch table rather than restated. `@objectstack/rest` had
  been carrying a hand-copied literal set under a "keep in sync with the type
  dispatch" comment; it now reads this instead. Registering a translator in spec
  reaches the REST boundary with nothing else to remember — the second list is
  deleted rather than checked, which is the better half of derive-or-gate.

  Also corrected: `ActionAiCategorySchema`'s comment claimed it mirrored
  `ToolCategorySchema` in `ai/tool.zod` and told the next author to update both
  sides — but #3896 deleted `ToolCategorySchema` along with the inert
  `tool.category` key it typed. The instruction had been pointing at a source
  that no longer exists. The enum is canonical now and says so.

- 6c87cc9: fix(data): a filter the server cannot apply is rejected, not silently ignored (#4181)

  `GET /api/v1/data/:object?filter={status:done` — one missing quote — answered
  `200` with the **unfiltered** page. The JSON-parse tolerance
  (`catch { /* keep as-is */ }`) left the raw string on `where`, a shape no
  driver consumes, so the filter was dropped whole and the response was
  byte-for-byte a successful unfiltered query. The worst failure direction in
  this family: #4134 returned nothing, #4164 dropped one predicate, this
  returned everything.

  The sibling `GET /data/:object/export` route had rejected the same input since
  it was written — the list path was the outlier. That guard now lives in the
  shared normalizer, so `GET /data/:object`, `POST /data/:object/query` and the
  runtime dispatcher all give one answer:

  - Unparseable JSON → `400 INVALID_FILTER`, naming the parameter and stating the
    filter was not applied.
  - Parses but is not a filter (`?filter=5`, `?filter="done"`, `?filter=null`) →
    same rejection; usable JSON is not a usable filter.
  - Blank `?filter=` → treated as absent, as before. No error.
  - `filter` / `filters` / `$filter` / `where` are four spellings of ONE slot.
    Sending two with **different** values used to run one and discard the rest
    silently; it is now `400 INVALID_REQUEST` (each value is a valid filter — the
    _request_ is ambiguous, so it does not share the malformed-filter code).
    Redundant identical spellings pass.
  - `orderby` on the export route gets the same treatment — a sort that cannot be
    parsed is refused rather than dropped (lower stakes than a filter: the row set
    is unchanged, but a caller taking "latest N" got an arbitrary N).

  **One wire code for one condition.** #4121 landed `400 INVALID_FILTER` for
  malformed filter _arrays_ on this same code path while this fix was in flight;
  the non-array rejections above use that code too, so a caller asking "did my
  filter run?" never has to know which branch caught it. The export route's
  filter guard moves from `INVALID_REQUEST` to `INVALID_FILTER` to match — a wire
  change on an existing route, and the reason it is worth making is that a client
  otherwise has to handle two codes for one condition depending on which URL it
  called. The route's `orderby` guard keeps `INVALID_REQUEST` (it is not a
  filter).

  **What changes for callers:** requests carrying a malformed filter now fail
  loudly instead of receiving every record. Every valid filter shape — JSON
  string, live object, `FilterCondition` AST array, and all four alias spellings
  used alone — is unaffected.

- af2a095: fix(data): `searchFields` / `groupBy` / `aggregations` naming a field that does not exist are rejected, not silently degraded (#4254)

  #4226 closed `sort` / `select` / `expand`; with the filter axis (#4134 / #4164 /
  #4181 / #4121) that made four field-naming read axes that either apply or fail.
  The same machine kept leaking on the remaining three, and each failure corrupted
  something the closed axes never touched:

  ```
  search=alpha&searchFields=no_such  -> 200  MORE rows than the narrowing allowed
  groupBy=[no_such]                  -> 200  [{no_such: null, n: <true count>}]  N groups collapsed into 1
  sum(no_such)                       -> 200  0 — indistinguishable from a real zero
  ```

  Each is now refused at the shared normalizer, so `GET /data/:object`,
  `POST /data/:object/query`, the export route and the runtime dispatcher give
  one answer instead of four.

  - **`searchFields` → `400 INVALID_FIELD`.** The `select` failure with the sign
    flipped outward: the engine dropped unknown names and, when that emptied the
    override, fell back to the FULL searchable set — so a parameter that exists
    only to narrow a search widened it, and it changed which ROWS came back, not
    just which columns. Its only in-framework caller is `GET /data/:object/export`
    — the route whose `search` support just shipped so exports would stop
    downloading "the unsearched superset … in a file that looks authoritative";
    a typo'd `searchFields` did exactly that, one parameter over. Three causes,
    three messages, because the fixes differ (the split #4226 drew on expand): a
    name that is no field is a request typo; a REAL field outside the searchable
    set needs the object changed (its message names the declared
    `searchableFields` or the auto-default's type rule, whichever applies); and
    a `searchableFields` entry that names no field is a STALE DECLARATION — a
    bug on the object, called out as such because clients (objectui's list
    search) echo the declaration verbatim. The allowed set is resolved by the
    same `@objectstack/spec/data` function the engine's search expansion
    consumes (`resolveSearchFieldResolution`, moved from objectql), so the gate
    cannot drift from what search actually scans.
  - **`groupBy` → `400 INVALID_FIELD`.** The in-memory aggregation path projects
    an unknown column as `null` for every row, so all rows landed in ONE bucket
    whose count is the true row count — structurally perfect, identical to "this
    column really holds a single value". A chart draws one bar; nothing says the
    grouping never ran. Native SQL aggregation errors on the same input, so which
    backend a deployment sits on decided the answer — the "two routes, opposite
    answers" split, one axis over.
  - **`aggregations` → `400 INVALID_FIELD`.** `sum(<typo>)` folded a column of
    `undefined` to `0` — the exact number an empty quarter produces, in reports
    whose whole job is to be believed (`avg`/`min`/`max` answered `null` the same
    way). `count` with no `field` (or the `'*'` sentinel) is the one legitimate
    field-less form and passes.
  - **Unreadable SHAPES on the aggregation axes → `400 INVALID_QUERY`** — the
    standard-catalog code that had no emitter since it was written, like
    `INVALID_SORT` before #4226. A string `groupBy`, an entry naming no field, a
    function or `dateGranularity` outside the spec enums, a missing `alias`: each
    slipped past the `Array.isArray` routing guard (rows returned UNGROUPED) or
    computed a silent placeholder (`null` results, a column keyed `"undefined"`,
    one bucket per raw value under an unknown granularity).

  Tiering is unchanged from #4226: registry + field map present → authoritative;
  no registry / no field map / legacy array field map → the NAME gates skip (shape
  gates still apply — they need no schema). The engine's own tolerance is
  untouched: internal callers reaching `engine.find()` / `engine.aggregate()`
  directly are unaffected. `@objectstack/rest` also stops logging
  `INVALID_FILTER` / `INVALID_SORT` / `INVALID_QUERY` rejections as
  "[REST] Unhandled error" — they are client mistakes the response already
  explains, as `INVALID_FIELD` always was.

  Requests that name real fields are unaffected.

- dd5daac: fix(data): reject unknown list query parameters instead of reading them as zero-matching field filters (#4134)

  `GET /api/v1/data/:object` reads any parameter it does not reserve as a
  field-level equality filter — that is what makes `?status=done` shorthand for
  `?filter={"status":"done"}`. When the name matched **no** field the resulting
  predicate could only ever match nothing, so `?pageSize=5` on a 10-row object
  returned `200` + `total: 0`: structurally valid, and indistinguishable from
  "this object is empty". The write path already rejected the same unknown name
  loudly (`400 INVALID_FIELD`), so one piece of knowledge — does this field
  exist — was enforced on write and silently zeroed on read.

  The read path now answers the same way, in the same envelope:

  ```json
  {
    "error": "Unknown field 'pageSize' on object 'showcase_task'. Query parameters that are not reserved are read as field filters, so an unknown name can only match zero records. Did you mean the 'top' query parameter (OData spelling '$top')?",
    "code": "INVALID_FIELD",
    "field": "pageSize",
    "object": "showcase_task"
  }
  ```

  The rejection carries a suggestion — the canonical parameter for a known
  dialect (`pageSize` / `perPage` / `page` / `sortBy` / `q` → `top` / `skip` /
  `sort` / `search`), or the closest real field name when it reads like a typo —
  and fires whether or not an explicit `filter` rode along, so the failure never
  depends on which other parameters were sent.

  **What changes for callers:** a request sending a parameter that names no field
  now gets a `400` where it used to get an empty `200`. Page size is `top` /
  `$top` / `limit`; page offset is `skip` / `$skip` / `offset`. Every documented
  parameter, every `$`-prefixed OData alias, and the full `QueryAST` body of
  `POST /data/:object/query` are unaffected. An object with a field named after a
  reserved parameter (`count`, `cursor`, `object`, `top`, `search`, …) filters it
  through the explicit form: `?filter={"count":3}`.

- 0931185: fix(rest,service-settings,service-datasource)!: four more route modules emit the declared envelope, and the guard is now shared (#3843)

  #3675 and #3689 moved `service-storage` and `service-i18n` onto the declared
  response envelope (`BaseResponseSchema` + `ApiErrorSchema`). Each scoped itself
  to one service, and neither asked whether the same drift existed elsewhere. It
  did — in four more modules, and in two of them it was the _older_ shape, the one
  #3675 had already declared wrong:

  | Module                                | before                                                         | now           |
  | ------------------------------------- | -------------------------------------------------------------- | ------------- |
  | `service-settings/settings-routes.ts` | nested `error`, no `success` on any of 5 bodies                | full envelope |
  | `service-datasource/admin-routes.ts`  | `{ error: '<string>' }`, `message` a **sibling**               | full envelope |
  | `rest/external-datasource-routes.ts`  | `{ error: '<string>' }` + a private `ok`                       | full envelope |
  | `rest/package-routes.ts`              | 3 of 16 bodies had `success`, 2 failures had no `error` at all | full envelope |

  ## Breaking: where to read things now

  **Success payloads move under `data`.** The keys are unchanged — only their
  depth. `unwrapResponse` in `ObjectStackClient` returns `body.data` when the flag
  is present, so every SDK method (`packages.list()`, `datasources.external.*`)
  resolves to exactly the object it always did. Raw `fetch` callers must add one
  hop:

  ```
  GET  /api/v1/datasources            body.datasources     → body.data.datasources
  GET  /api/v1/datasources/drivers    body.drivers         → body.data.drivers
  GET  /api/v1/datasources/:name      body.datasource      → body.data.datasource
  GET  /api/v1/packages               body.packages        → body.data.packages
  GET  /api/v1/packages/:id           body.package         → body.data.package
  GET  /api/settings                  body.manifests       → body.data.manifests
  GET  /api/settings/:ns              body.manifest/.values → body.data.manifest/.values
  POST /…/external/validate           body.ok, body.results → body.data.ok, body.data.results
  ```

  `SettingsNamespacePayloadSchema` and friends still describe those payloads
  exactly; they now describe the envelope's `data` rather than the whole body.

  **Error bodies stop being a string.** `{ error: 'datasource_admin_error',
message }` → `{ success: false, error: { code: 'datasource_admin_error',
message } }`. Read `body.error.message`, not `body.message`; read
  `body.error.code`, not `body.error`. This is the asymmetry #3675 opened on: a
  caller reading `body.error.message` previously got the real message from the
  dispatcher and `undefined` from these routes.

  **Two failures that never said why now do.** `DELETE /api/v1/packages/:id`
  answered a bare `{ success: false }` and a bare
  `{ success: false, failed, cleanups }`. They are now `PACKAGE_DELETE_FAILED` and
  `PACKAGE_DELETE_PARTIAL`, with the per-item `failed` / `cleanups` arrays under
  `error.details`.

  **Codes follow ADR-0112.** #3841 settled the vocabulary while this was in review:
  `error.code` is SCREAMING_SNAKE and `ApiErrorSchema.code` is now the closed
  `ErrorCode` union, so an unregistered code fails schema parse. Generic conditions
  reuse the STANDARD catalog rather than becoming registered synonyms of it, per the
  ledger's own guidance:

  ```
  datasource_admin_unavailable  → SERVICE_UNAVAILABLE      (standard)
  external_service_unavailable  → SERVICE_UNAVAILABLE      (standard)
  not_found / PACKAGE_NOT_FOUND → RESOURCE_NOT_FOUND       (standard)
  PUBLISH_FIELDS_MISSING        → MISSING_REQUIRED_FIELD   (standard)
  INTERNAL                      → INTERNAL_ERROR           (standard)
  datasource_admin_error        → DATASOURCE_ADMIN_ERROR   (registered)
  external_import_error         → EXTERNAL_IMPORT_ERROR    (registered)
  PUBLISH_MANIFEST_INVALID      → PACKAGE_MANIFEST_INVALID (registered)
  PUBLISH_FAILED                → PACKAGE_PUBLISH_FAILED   (registered)
  PACKAGE_DELETE_PARTIAL / PACKAGE_DELETE_FAILED / SETTINGS_ACTION_FAILED (registered)
  ```

  Which service is unavailable is carried by `message`. The seven registered codes are
  added to `ERROR_CODE_LEDGER` under their owning packages — including a new
  `@objectstack/service-datasource` entry.

  **`POST /external/validate` keeps its `ok`.** Unlike the `{ ok: true, key }`
  #3689 retired from storage — a private second word for `success` — this `ok` is a
  computed verdict over the federated objects (`results.every(r => r.ok)`). The
  request can succeed while the verdict is false, so the two flags are not the same
  field; `ok` moves inside `data` rather than being dropped.

  Consumers were taught both shapes first, so the two repos are not coupled by
  merge order: objectui's `packages` readers were already tolerant
  (`payload?.data ?? payload`), and its datasource page plus the generic
  `type: 'api'` action runner now unwrap the envelope and read `error.message`
  (the latter previously toasted `[object Object]` for any nested error).

  ## The guard is shared now, not copied

  `scripts/check-route-envelope.mjs` + `pnpm check:route-envelope`, wired into
  `lint.yml` alongside the nine sibling `check:*` guards. Its load-bearing assertion
  is structural rather than per-route: **it counts the response write sites per
  module.** When every body goes through the `sendOk` / `sendError` pair that count
  is fixed at two and does not grow with the route list — so a _future_ route that
  hand-rolls a body fails the guard. That is the coverage a driven-body test can
  never give, since it can only drive the routes that existed the day it was
  written.

  This existed three times already as an open-coded regex block (storage error,
  storage success, i18n error). Lifting it did more than deduplicate: a per-package
  scan **structurally cannot notice a module nobody thought to convert**, and going
  repo-wide found two the moment it ran — neither is in #3843's hand-written survey:

  - `plugin-sharing/share-link-routes.ts` — the fifth drifting module. No body
    carries `success`, and one answers `{ ok: true }`, the private second word #3689
    retired from storage. Filed as #3983 and pinned by the guard; converting it is
    breaking for share-link consumers and needs its own sweep.
  - `metadata/routes/hmr-routes.ts` — declared **exempt** with a reason (dev-only
    SSE endpoint, not on the SDK surface), not skipped. Three states, deliberately —
    conformant / ratcheted / exempt — because that is the honest classification
    ADR-0049 asks for. A route module the scan finds but the table does not declare
    is an **error**, never a default: applying `2 / 1 / 1` to an unknown module would
    let a new one pass by coincidence.

  It also drops the regex for the TypeScript AST, fixing two real bugs the copies
  had. They stripped comments with `String.replace`, whose line-comment pattern also
  ate `//` inside string literals and truncated the rest of that line — response
  writes included. And `.json(` does not mean "write a response": `hmr-routes.ts`
  calls `c.req.json()` twice to READ a request body, which a textual count reports as
  two unenveloped responses. Comments and literals are not AST tokens, and
  request-vs-response is a property of the callee, so both disappear. The script
  carries a `--self-test` pinning each case — the nine sibling guards have none, but
  both of these bugs survived a review of the regex version.

  **The i18n ratchet, stated rather than hidden.** `i18n-service-plugin.ts` is
  declared at `responses: 5, ok: 4, err: 1` with a ratchet pointing at #3973. Its
  error half _is_ consolidated (#3675), but each of its four read routes builds
  `{ success: true, data }` inline. Those bodies are correct — that is not envelope
  drift — but an unconsolidated builder is a weaker guard: a fifth read route could
  get the shape wrong and only a driven test would notice. The numbers pin today's
  structure exactly (a new inline body fails) and drop to the conformant `2 / 1 / 1`
  when #3973 lands.

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
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
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
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/observability@17.0.0-rc.1
  - @objectstack/service-package@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

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
