# @objectstack/platform-objects

## 17.1.0

### Minor Changes

- e43d63a: feat(identity): API keys are minted against the minter's active organization, and carry it into the request (#8287)
  
  <!-- adr-0087: not-required (no-migration-prescription) One additive column on
  an `isSystem` object declaring `protection: { lock: 'full' }`, which tenants
  cannot author, so there is no consumer metadata to migrate and nothing
  authorable is renamed, retired or tombstoned — no conversion to register. The
  behavioural change is that a minted key now carries an organization, that a key
  which cannot carry one is refused under the posture where it could never read
  anything, and that an ex-member's key stops authenticating. -->
  
  On a deployment running `OS_TENANCY_POSTURE=isolated`, a minted API key could
  read **nothing at all**. `sys_api_key` carried no organization column, so key
  authentication established a user but no active organization — and the
  `isolated` Layer 0 wall is `organization_id = activeOrganizationId`, which with
  no active organization matches no row. Every organization-scoped read answered
  `200` with `total 0` while the console went on offering minting, so a tenant
  admin could mint a valid-looking secret and discover only at call time that it
  read nothing. (There was no cross-tenant leak — the failure was in the other
  direction.)
  
  **The column was absent by an inherited rule, not by oversight.**
  `resolveInjectedSystemColumns` injects `organization_id` into every registered
  object *except* `managedBy: 'better-auth'` ones, and `sys_api_key` carries that
  flag — even though better-auth's `apiKey` plugin is not loaded and the table is
  hand-rolled ObjectStack. So the fix needs the declaration *and* the ADR-0105 D7
  extension-field registration to stay consistent. The read side, by contrast,
  was **already wired**: `resolveApiKeyPrincipal` already read an organization
  into `tenantId` and `resolveAuthzContext` already adopted it — it was reading a
  column no mint path ever wrote.
  
  **What changes**
  
  - `sys_api_key` declares `active_organization_id` (+ index, and the column is
    shown in the "My Keys" and "All" list views, because the card's complaint was
    a credential whose reach its owner could not see).
  - `POST /api/v1/keys` **inherits** the caller's active organization — there is
    deliberately no org parameter and no cross-org key — and **re-checks the
    caller's `sys_member` membership at mint time**, honouring ADR-0091 validity
    windows. Under a walled posture it refuses (400) rather than minting a key
    with no organization, and refuses (403) for an organization the caller is not
    a member of. The mint response echoes the organization the key is pinned to.
  - The verifier reads **one spelling** (Prime Directive #12): the
    `row.organization_id ?? row.organizationId` chain it used to carry was a
    consumer-side tolerance for a producer that did not exist.
  - An **ex-member's key fails closed at verify time** — no principal, not a
    degrade to a user-only principal, which would resurrect the same
    `200 + total 0` silent-empty. Checked at verify rather than by revoking on
    membership loss, because membership ends through many paths (better-auth org
    endpoints, SCIM, a direct `sys_member` delete, a lapsing validity window) and
    a hook must catch every one or it silently misses. It costs **zero extra
    queries**: the resolver has already read `sys_member` for this user.
  - **Pre-existing org-less keys are never backfilled** — that would silently
    upgrade credentials minted under a different promise. They keep working under
    `single` (no wall) and under `group` (whose wall derives from the owner's
    memberships independently of the active organization, so they already work
    there), and are **refused under `isolated`**, where they are provably dead
    today.
  
  **The column is deliberately named `active_organization_id`, not
  `organization_id`** — the `sys_session` spelling, for the same concept: the
  organization a credential makes *active*. `objectHasOrgIdField` tests for the
  literal `organization_id`, and Layer 0 exempts objects without it, so the other
  name would have made `sys_api_key` itself org-walled. Both walled postures
  exclude NULL, so every pre-existing org-less row would have vanished from its
  **own owner's** "My Keys" list while, under `group`, continuing to
  authenticate — a live credential nobody could see or revoke, which is a fresh
  instance of the very class this change removes.
- 6158146: Stop serving custom email headers through the generic data-API read of `sys_email` (#8149).
  
  **What this closes.** `sys_email.headers_json` — the custom headers handed to `IEmailService.send`, the ordinary place a relay credential or provider token goes — was readable by every caller the data API admits (list, get, an explicit `?select=headers_json`). The column is now declared `internal: true`, so the engine omits it from every generic read with no system carve-out (#7728); `SYSTEM_CTX` does not reopen it either. This is the same shape #8118 ruled on for `sys_http_delivery.headers_json`: this change adopts that remedy rather than deciding it a second time.
  
  **Delivery is unaffected, and fail-closed.** `sys_email` is not delivered from the in-memory message but FROM THE ROW: the after-insert outbox drain hook, the `email.send.async` queue subscriber and the boot outbox sweep all re-read the row and hand it to `EmailService.deliverPersistedRow`. All three read through `engine.find`, which is exactly what the flag empties — so the recovery ships with the flag. `deliverPersistedRow` now recovers the column through ObjectQL's privileged accessor (`resolveInternalField`, consumed unchanged) and sends every authored header verbatim. A message whose headers cannot be recovered is NOT sent without them: a missing header is not self-announcing — a relay that does not require it accepts the mail while the delivery silently deviates from the authored configuration. That case throws and leaves the row `queued`, not `failed`, so the queue retry or the next boot's sweep delivers it intact.
  
  **New optional seam.** `EmailPersistence.readHeadersJson(rowIds)` — the readback the plugin wires off the raw engine. It probes the OBJECT SCHEMA flag, never the absence of the key from a result row: `headers_json` is `required: false` and most real rows carry no custom headers at all, so a key-absence inference would treat every ordinary email as redacted (the regression measured on `sys_account`'s optional token columns in #7987/PR #8675). Engines that do not redact are left untouched and trigger no privileged read.
  
  **What this deliberately does NOT close.** The row still holds the header map in cleartext at rest. Encrypting it (`Field.secret()`) was measured and rejected on #8118 — an orphan `sys_secret` row per message with no cascade or retention, a boot-window fail-open, and a per-row decrypt on every delivery — and this change adopts that ruling unchanged.

### Patch Changes

- c9f5950: fix(security): `sys_account`'s OAuth access/refresh/id tokens stop serializing on the data API — `internal: true`, with better-auth's readback seam widened to cover them (#7987)
  
  <!-- adr-0087: not-required (no-migration-prescription) Three field-level flags
  added to one existing declaration, plus a rename and a widening of a
  plugin-internal helper module (`session-token-readback.ts` →
  `internal-field-readback.ts`, not an exported surface of the package). Nothing
  authorable is renamed, retired or tombstoned, so there is no conversion to
  register. The behavioural change is that three columns holding someone else's
  live bearer credentials stop being returned on the generic data path, while
  better-auth's own token routes keep working. -->
  
  `sys_account.access_token`, `.refresh_token` and `.id_token` hold each user's
  **live third-party OAuth credentials** — the tokens ObjectStack received from
  Google, GitHub or an OIDC IdP — in cleartext (better-auth's
  `account.encryptOAuthTokens` is not set, so `setTokenUtil` stores them
  verbatim). They were plain `Field.textarea` on an object declaring
  `apiEnabled: true, apiMethods: ['get','list']`.
  
  **Both personas were measured leaking, on a real booted stack** (`bootStack(showcaseStack)`,
  in-process HTTP + sqlite-wasm), with a planted token on a member's account row:
  
  - **admin**, `GET /data/sys_account/{another user's account id}` — 200, that
    member's `refresh_token` verbatim, plus `access_token` and `id_token`;
  - **member**, `GET /data/sys_account` (self-scoped by the `sys_account_self` RLS
    policy) — 200, their **own** `refresh_token` verbatim.
  
  The member arm is the one this object does not share with its `sys_session`
  sibling (#7823), and it is the sharper of the two: it converts a short-lived,
  revocable ObjectStack session bearer into a **long-lived third-party refresh
  token that this platform cannot revoke at all**. Neither collector reached these
  columns — the engine's credential mask collects by field TYPE (`textarea` is
  neither `secret` nor `password`) *and* exempts objects with
  `managedBy: 'better-auth'`, which this object is.
  
  **The fix is three declarations plus one widening**, inheriting #7823's shape
  rather than inventing a second mechanism:
  
  - the three columns are declared `internal: true` — the opt-in, type-independent
    flag minted by #7728 meaning *the declared value is never returned on the
    generic data path*. Storage, filtering and indexing are untouched: the strip
    runs on rows the driver has already produced.
  - better-auth **reads these back off adapter result rows** — measured, and the
    risk this card was parked on: `internalAdapter.findAccounts(userId)` issues a
    `findMany` with no projection, and `/get-access-token`, `/account-info` and
    `/refresh-token` then read `account.refreshToken` / `.accessToken` /
    `.idToken` off those rows. The read strip alone would answer
    `REFRESH_TOKEN_NOT_FOUND` (400) and hand back an empty access token. So the
    existing readback seam in `@objectstack/plugin-auth` — which already recovered
    `sys_session.token` through `Engine.resolveInternalField` (#8118's privileged
    batch accessor) — is widened to cover these three columns and renamed
    accordingly. No engine carve-out, no second accessor.
  
  **Not retyped, deliberately.** `Field.secret()` would route better-auth's own
  writes through the engine's encrypt-on-write path, placing the engine between
  better-auth and its own adapter. `Field.password()` is inert here for the two
  reasons above.
  
  **`password` / `previous_password_hashes` are deliberately out of scope** —
  they are better-auth one-way hashes (ADR-0100's third channel), not reversible
  outbound credentials, and the readback seam refuses to touch them.
  
  The regression proof drives both directions: the fixture PLANTS real token
  values and re-reads them out of storage through the privileged accessor before
  asserting anything (so "absent from the response" cannot pass vacuously), then
  pins that the values are still on disk, still usable as a server-side predicate,
  and that password sign-in — which reads a `sys_account` row back through the
  same seam on every request — still works.
- d6e80b2: fix(security): `sys_account.password` and `previous_password_hashes` stop serializing on the data API — `internal: true`, with the raw-engine readers converted to the privileged accessor (#8676)
  
  <!-- adr-0087: not-required (no-migration-prescription) Two field-level flags
  added to one existing declaration, plus one new export on a plugin-internal
  helper module (`internal-field-readback.ts`, not an exported surface of the
  package). Nothing authorable is renamed, retired or tombstoned, so there is no
  conversion to register. The behavioural change is that two columns holding
  one-way password hashes stop being returned on the generic data path, while the
  ADR-0069 D1 reuse ring and better-auth's sign-in verifier keep reading them
  through the engine's privileged accessor. -->
  
  `sys_account.password` (the credential hash) and `previous_password_hashes` (the
  ADR-0069 D1 reuse-prevention ring) serialized on `/api/v1/data/sys_account`,
  which declares `apiEnabled: true, apiMethods: ['get','list']` — to an **admin
  for every user's row**, and to a **member for their own** (the
  `sys_account_self` RLS policy grants `select` on `user_id == current_user.id`).
  
  These are one-way hashes, not reversible outbound credentials — which is why
  #7987 correctly refused to bundle them with the OAuth tokens. But a served
  password hash is an offline-cracking target, and `previous_password_hashes`
  multiplies it by the history ring while its own declaration says it is *never
  exposed in UI*. This is the disposition #7728 already reached for
  `sys_api_key.key`, which was **also** a stored hash and was still ruled unfit to
  serialize through the API face.
  
  Neither credential collector could reach them: `collectMaskedReadFields` keys on
  the field **TYPE** (`secret` / `password`) *and* exempts objects declaring
  `managedBy: 'better-auth'`, which this object is — while these columns are
  `text` / `textarea`. Two independent barriers, both missing.
  
  **The fix is two declarations plus two recovery seams**, and the second seam is
  the part a bare flag would have missed:
  
  - both columns are declared `internal: true` — the opt-in, type-independent flag
    from #7728 meaning *the declared value is never returned on the generic data
    path*. Storage, filtering and indexing are untouched: the strip runs on rows
    the driver has already produced.
  - **better-auth's adapter readers** are recovered by the existing per-object
    readback table, widened with `password`: the sign-in verifier compares against
    the hash on the row `internalAdapter.findCredentialAccount(userId)` returns,
    so the strip alone would break password sign-in for every user.
  - **plugin-auth's own RAW-engine readers** are recovered by a new seam in the
    same module, `recoverInternalFieldsForSystemRead`. This is the half that makes
    the flag safe: the readback table is imported by exactly one file
    (better-auth's storage adapter), so it cannot reach a caller that reads the
    engine directly — and the engine's strip has **no `isSystem` carve-out** by
    #7728's design. Measured against a real ObjectQL engine: the reuse ring's
    `findOne` returns `{"id":"a1"}` for a query that names both columns in an
    explicit projection under `context: { isSystem: true }`.
  
    Left unrecovered, `assertPasswordNotReused` would become a **silent no-op** —
    its comparison list empties, the loop never runs, `PASSWORD_REUSE` is never
    thrown, and its own `catch { return undefined }` means nothing announces it.
    The ADR-0069 D1 control would report success while accepting every reused
    password. Its unit tests would have stayed green throughout, because they use
    fake engines that never apply the strip.
  
  **No ADR-0100 guard change, and none was needed.** `Engine.resolveInternalField`
  has exactly one predicate — `internal === true` — so flagging the columns makes
  them legitimately dereferenceable through the privileged accessor. The ADR-0100
  sentence in its refusal message is prose explaining why a *non-flagged* field has
  other channels, not a second predicate; the guard stays exactly as selective as
  it was, and a non-flagged column on the same object is still refused with
  `INVALID_FIELD` / 400.
  
  Regression proof drives both directions on a real booted stack: both columns are
  absent for both personas — including a caller who spells them out in `?select=` —
  while the values remain on disk and reachable through the privileged accessor,
  password sign-in still works, and the reuse ring still grows across a password
  change on every transport lane.
- 66beee0: Guard every authored record-scoped action predicate for the sparse action face, so a list row that did not project the gated column no longer silently drops the button.
  
  An action's `visible` / `disabled` predicate binds whatever record the client already fetched — a record-detail read, or a list row carrying only the view's `$select` projection. That binding stays sparse by decision (it is the one record binding the platform does not make total), and CEL aborts the whole expression at key resolution when a key is absent. The abort is fail-closed, so the button is simply not offered — indistinguishable to the user from the gate having said no, and reported nowhere.
  
  Every authored predicate on `sys_user`, `sys_invitation`, `sys_member`, `sys_oauth_application` and `sys_approval_request` now opens each `record.*` read with `has()`. The guard is the minimal measured form per predicate, not one blanket rewrite: a bare equality against a literal needs `has()` alone, because CEL compares heterogeneously and answers `false` on a projected-null column rather than faulting.
  
  Two predicates change what a user sees, both on `sys_oauth_application`, whose `disabled` column is nullable upstream and therefore null on every application nobody has ever toggled:
  
  - `disable_oauth_application` was `!record.disabled`, which faulted on a projected-null row (`!` needs a bool) — so the Disable button was missing from every never-toggled application in the list. It is now `has(record.disabled) && record.disabled != true` and is offered.
  - `enable_oauth_application` was `record.disabled`, which answered `null` rather than a boolean and left the decision to the renderer. It is now `has(record.disabled) && record.disabled == true`.
  
  `sys_approval_request`'s decision levers gate on the attached `record.viewer` block and traverse, so they are guarded at the leaf (`has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true`). Measured, that is the minimal safe form for a nested read: the canonical `has(x) && x != null` conjunction still faults when the block is present but the flag is absent or null, while a leaf `has()` subsumes the parent `!= null` half. Their intended fail-closed behaviour is unchanged — it is now a real `false` instead of an evaluation fault.
- 03520eb: deps(auth): the better-auth family moves off the `1.7.0-rc.2` prerelease onto stable `^1.7.1` (#3002)
  
  `@objectstack/plugin-auth` shipped with **exact pins on a release candidate** —
  `better-auth`, `@better-auth/core`, `@better-auth/oauth-provider` and
  `@better-auth/sso` all at `1.7.0-rc.2`. That pin was never housekeeping debt: it was
  the remediation for **GHSA-p2fr-6hmx-4528** (`@better-auth/oauth-provider`) and
  **GHSA-j8v8-g9cx-5qf4** (`@better-auth/scim`, high — account/provider takeover), both
  patched only in `>=1.7.0-beta.4`, so there was no stable line to move to. Upstream has
  now shipped one: `npm view <pkg> dist-tags` reports `latest: 1.7.1` for every family
  member. The declarations become `^1.7.1`, which is what a downstream
  `npx create-objectstack` install now resolves.
  
  **`@better-auth/scim` deliberately stays at `1.7.0-rc.1`.** Measured against the
  published stable tarball rather than assumed: `@better-auth/scim@1.7.1` ships the rc.2
  **rewrite** — no `scimProvider` model, no generate-token endpoint, and six replacement
  models (`scimUser`, `scimGroup`, `scimGroupMember`, `scimSubject`,
  `scimConnectionBinding`, `scimIdentityTombstone`). Adopting it is a feature migration
  (ADR-0071, tracked separately), not a version bump. The hold stays security-clean: rc.1
  is above the advisory's fix floor, `pnpm audit --audit-level=high` is green, and rc.1's
  peer ranges accept the stable 1.7.1 core the rest of the family resolves to.
  
  **Three pieces of upstream drift are absorbed here, and one of them was a live
  sign-in outage waiting to happen.**
  
  `1.7.0-rc.2` renamed the account model's `accountId` field to `providerAccountId`;
  **stable 1.7.0/1.7.1 renamed it back to `accountId`**, keeping the new required
  `issuer`. Carrying the rc.2 spelling into the stable line left the field unmapped, so
  better-auth's adapter asked for a column named `accountId` and **every sign-up answered
  500** — `Unknown field 'accountId' on object 'sys_account'`. The `account_id` column
  itself never changed and no data moves; only the camelCase key does. The same rename
  reaches `@objectstack/client`: `auth.accounts.list()` (better-auth's `/list-accounts`)
  returns `accountId`, and its declared response type said `providerAccountId`. If you
  read that field off the client's typed response, rename it.
  
  `@better-auth/oauth-provider` 1.7.1's client model writes three fields the platform
  object did not answer for. `applicationType` is the OIDC spelling of what rc.2 called
  `type`, so it maps onto the **existing** `type` column and no data moves;
  `clientDiscoveryId` and `clientCredentialsScopes` are genuinely new and are now
  declared on `sys_oauth_application` as `client_discovery_id` and
  `client_credentials_scopes`. Without them, dynamic client registration
  (`POST /oauth2/register`) fails at the driver.
  
  Two endpoints are newly mounted by the auth catch-all and are now ledgered:
  `POST /oauth2/end-session` and `POST /oauth2/end-session/confirm` — the POST form of
  OIDC RP-initiated logout, whose `GET` counterpart was already published.
  
  **Nothing here needs an action on upgrade.** The new columns are additive and optional,
  and the field rename is internal to how the plugin talks to better-auth — with the one
  exception of the `@objectstack/client` response type named above.
- 04f8fdb: fix(platform-objects): drop the dead `mapId` ("Map: User ID claim") param from `register_sso_provider` — the OIDC subject claim is not configurable (#8222)
  
  <!-- adr-0087: not-required (no-migration-prescription) One action PARAM is
  removed from a UI action declaration, plus the generated i18n entries that
  carried its label/helpText. `params` are the form fields an `type: 'api'` action
  collects for its request body — not an authorable metadata property, not a field,
  not a stored column, so there is nothing to tombstone and no conversion to
  register. No stored `sys_sso_provider` row changes shape: the param was only ever
  a transient form input, and since #8193/#8221 the bridge has not forwarded it to
  better-auth at all. The runtime accept set does not move. -->
  
  The `register_sso_provider` action on `sys_sso_provider` offered an optional
  **"Map: User ID claim"** text field (`mapId`), with helpText reading *"Optional.
  ID-token claim mapped to the user ID. Defaults to `sub`."*
  
  **That capability no longer exists.** It was retired upstream in
  `@better-auth/sso@1.7.0-rc.2`:
  
  - `oidcConfig.mapping` is a `z.strictObject` whose members are
    `{ email, emailVerified?, name, image?, extraFields? }` — there is no `id`;
  - the federated subject is hard-wired to the OIDC `sub` claim
    (`id: readStringClaim(rawUserInfo, "sub")` and `id: idToken.sub`), then
    cross-checked (`id_token_subject_missing`,
    `id_token_userinfo_subject_mismatch`);
  - `extraFields` is not an escape hatch — it is spread **before** `id` in the
    profile literal, so an `extraFields.id` is overwritten by `sub` before anything
    reads it.
  
  `1.6.20` did honour `mapping.id` (`id: rawUserInfo[mapping.id || "sub"]`); the
  version bump deleted the member.
  
  So the field's only accepted values were "empty" and the `sub` it already
  defaulted to. #8193 (PR #8221) stopped the bridge emitting the retired key and —
  rather than accept a value it would silently discard — made a non-`sub` value
  answer `INVALID_REQUEST`. That left the last half of the problem: **the form
  still advertised a free-form optional field that 400s on anything meaningful.**
  Removing it restores declared = enforced. Nothing else about registration moves:
  the runtime accept set is unchanged, and a registration that never sent `mapId`
  behaves exactly as before.
  
  `mapEmail` and `mapName` are untouched — they map to live `oidcMappingSchema`
  members and are still honoured.
  
  **The bridge-side guard in `plugin-auth`'s `register-sso-provider.ts` is kept**,
  and its refusal test with it. The admin form was only one caller: a direct API
  client, a script, or a stale cached console bundle can still put `mapId` on the
  wire, and telling those callers plainly still beats discarding the value in
  silence. Only the guard's doc comment changed, to stop describing `mapId` as a
  field the form sends.
  
  The generated translation bundles (`*.objects.generated.ts`, all four locales)
  were **regenerated**, not hand-edited, so the retired label disappears from every
  locale rather than lingering as a stale entry.
- 84cb121: State `sys_job`'s uniqueness boundary explicitly: `unique: 'global'` on the declared `(name)` index, and correct the `name` field's description (#8578)
  
  The declared index carried the bare `unique: true` spelling, which ADR-0120 D1 defines as the deprecated positional spelling of `'global'` — the listed columns verbatim. Because `sys_job` also carries a kernel-injected `organization_id`, the tenancy sweep could not tell that shape apart from the #8323 cross-tenant-oracle class, and the field's description published a boundary-free "Unique job identifier" claim that left the question open in the generated reference.
  
  The reading settles it in the `'global'` direction: nothing writes `sys_job` per organization. `DbJobAdapter` is the sole writer and upserts under a SYSTEM context, locating rows by `where: { name }` with no organization dimension; the `job` metadata type is closed to tenants on all three flags (`allowOrgOverride: false` — "no per-org job fork" — plus `allowRuntimeCreate: false` and `supportsOverlay: false`); `enable.apiMethods` advertises no write verb at all (ADR-0103 engine-owned); and every `schedule()` call site is registration-time and installation-scoped. ADR-0120's own S5 inventory already names `sys_job.name` as one of the nine engine idempotency keys that are platform-wide by construction.
  
  No migration and no drift: `'global'` **is** the semantics bare `true` already materialized, so the physical index is byte-identical (ADR-0120 D2). What changes is that the boundary is stated rather than inferred from position, and that the published description names it. The reading itself is pinned — the new test asserts the write paths that would have to open for the opposite verdict to become true, so a future per-organization job path fails loudly instead of silently invalidating the constraint.
- ca19ee8: Fix `sys_job_run`'s object `description` to say "history", not "audit trail" (#9735)
  
  `sys_job_run` is job run **history**; `sys_audit_log` is the separate audit surface,
  with its own opt-in, writer and retention (binding ruling on #9633). The object's own
  header comment already said "Background Job Execution History", but the `description`
  field two lines below — the user-facing copy Studio/Setup surface, and the string that
  propagates into the generated translation bundle — still called it "Background job
  execution audit trail". Both now say "Background job execution history"; the generated
  `en.objects.generated.ts` bundle was regenerated to match (never hand-edited).
- a675b4d: fix(platform-objects): the System Overview by-action table serves its declared title again, and the default locale bundle is now pinned to the source string (#8721)
  
  `widget_recent_events` was converted into an ADR-0021 single-form — a
  dataset-bound breakdown of `sys_audit_log` events by action — but all four
  hand-authored locale bundles kept serving the title the widget had *before* the
  conversion (`Recent Audit Events` / `最近审计事件` / `最近の監査イベント` /
  `Eventos de Auditoría Recientes`). The translation is what renders, so the
  declared string reached nobody in any locale. Its `description` had drifted the
  same way and in the same direction, one field over.
  
  **The duplicate the stale translation was hiding.** With the source string
  restored, the board carried the same label twice: `widget_events_by_type` (a
  pie) and `widget_recent_events` (a table) both declared `Audit Events by
  Action`, over the same dataset and the same dimension. They looked distinct in a
  running instance only because one of them was serving a stale translation. The
  pair now splits on what each adds — the pie keeps `Audit Events by Action` (the
  share picture), the table becomes **`Event Volume by Action`** (the exact
  per-action count, which is what its `values: ['event_count']` produces and what
  its description already said). All four locales are translated to the new
  strings; the widget **ids are unchanged**, so no translation key, persisted
  widget state or dataset binding moves.
  
  **Why nothing caught it, and what now does.** This package's `apps` /
  `dashboards` / `pages` i18n is hand-authored and cannot be regenerated —
  regenerating would delete ~40 runtime-contributed nav translations per locale —
  so it never had the source-tracking the generated half gets from the extractor.
  Every gate over it made a **key-set** claim (`app-nav-translation-parity.test.ts`
  asserts a translation exists and does not outlive its declaration;
  `check:i18n-coverage` ratchets *untranslated* labels; `check:app-nav-i18n` judges
  the merged nav tree), and a key whose value is stale satisfies all of them.
  
  `app-nav-translation-parity.test.ts` now also asserts the **default locale's
  content**: every statically declared app label, description and nav label, plus
  the dashboard's label, description and every widget title/description, must
  appear in `en.ts` **verbatim**. That claim is available for `en` alone because
  `en` is a copy of the source rather than a translation of it — the same
  invariant the generated half already enforces by rewriting its `en` bundle on
  every extract. What a *translated* locale should do when its source string
  changes is a separate product decision and is deliberately not decided here.
- b887013: fix(platform-objects): remove the System Overview board's permanently-empty "Permission Changes" tile (#8148, #7675)
  
  <!-- adr-0087: not-required (no-migration-prescription) A widget is removed from
  a platform-shipped dashboard, and four hand-authored locale bundles drop the
  matching `dashboards.system_overview.widgets.widget_permission_changes` subtree.
  No authorable KEY changes: `DashboardWidgetSchema` is untouched, nothing is
  renamed or tombstoned, and the retirement of the `sys_audit_log.action` VALUE
  this tile filtered was registered by #8147 as a SEMANTIC entry
  (`17.audit-log-action-enum-retired`). This change is the UI half of that already
  registered retirement, so it prescribes no migration of its own. -->
  
  The System Overview dashboard shipped a "Permission Changes" metric tile
  filtering `sys_audit_log.action = 'permission_change'`. **The tile could never
  report anything but `0`, on any deployment that has ever existed** — the value
  had no writer anywhere in the repo. There are exactly two `sys_audit_log`
  writers: `plugin-audit`'s generic hook writer, whose `actionFor` maps
  afterInsert/afterUpdate/afterDelete to `create`/`update`/`delete` and nothing
  else, and `plugin-auth`'s admin user-import. Neither has ever emitted
  `permission_change`. #8147 then retired the value from the action enum outright,
  so the tile's filter now names a value the platform does not even declare.
  
  **An empty tile on a compliance surface is worse than a missing one.** A
  permanently-`0` "Permission Changes" count does not read as "this platform does
  not track permission changes" — it reads as a *negative finding*: an auditor
  concludes the platform watched for permission changes over the selected window
  and found none. The number was live and the query was real; the question it
  answered was one no row could ever be an answer to. 审计面宁窄勿谎 — a narrow
  audit surface beats a lying one.
  
  **Removed rather than refiltered onto a live action.** Permission and role edits
  *are* captured today, as ordinary `create` / `update` rows written by the generic
  hook against the permission objects — so the honest lens on them is `object_name`
  on the audit list view, a row-level question rather than a single-number KPI.
  Approximating one as a tile would have put a second not-quite-true number on the
  same board. The two surviving Row 2 tiles ("Login Events", "Config Changes")
  split the 12-column row in half instead of leaving a gap where the removed tile
  sat.
  
  The by-action tile's description stops naming `permission` among its example
  actions, in the source **and in all four locale bundles** — the translations are
  the strings actually served, so correcting only the source would not have reached
  a single user.
  
  ⚠️ **`import` is deliberately untouched.** It was named in the same ruling as
  `permission_change`, but its retirement premise was falsified during #8147: it
  has a live writer (`plugin-auth`'s admin user-import writes a run-level row) and
  a shipped list view that filters it. Removing it from the dashboard while the
  platform still emits it would produce the exact inverse defect — an audit action
  that can be written but cannot be found.
  
  Both directions are pinned. A tombstone refuses any board widget filtering a
  retired action value, with a live-action control so it cannot pass on a board
  that has no widgets or whose predicates moved. The app/dashboard translation
  parity test gains the **reverse direction it was missing** for dashboard widgets
  — it asserted every declared widget has a translation, but nothing stopped a
  translation outliving its widget, which is precisely what these four locale
  entries would have done.
- 7901b2d: feat(spec): stamp-only `tenancy.organizationField` — audit rows can follow the record's organization on objects that must stay unwalled (#8778, closes the #8707 remainder)
  
  The platform had one answer to "what is this object WALLED by"
  (`tenancy.tenantField`) and no answer to "which column says who this row is
  ABOUT". For ordinary objects the two coincide; for credential tables they
  deliberately do not — `sys_api_key` records the organization a key
  authenticates into under `active_organization_id` precisely so the credential
  table is not org-walled (#8287). #8777's schema-resolved audit stamping could
  therefore reach every shipped object except the one that motivated it, and
  revocation rows on `sys_api_key` kept stamping the revoker's organization.
  
  `TenancyConfigSchema` now accepts an optional `organizationField` — a
  READ-NEUTRAL, STAMP-ONLY declaration (maintainer-ruled option A on #8778):
  
  - The audit writer's `resolveRecordOrganizationField` consults it first, ahead
    of the ADR-0066 `enabled: false` opt-out — an author declaring it on an
    unwalled object is stating exactly that the audit trail should follow the
    record's own organization even though no wall does. It is honoured only when
    the object really has the field (the #5315 guard `tenantField` carries).
  - No read path reads it: `applyTenantScope`, `injectTenantOnInsert`,
    `computeTenantLayer0Filter` and `resolveInjectedSystemColumns` are all
    measured blind to it, and that read-neutrality is pinned by tests beside
    each. Declaring it never walls an object and never hides rows.
  - ⛔ Scope pin from the ruling: this is ONE stamp-only key, not the opening
    move of a general field-roles mechanism. A consumer other than audit
    stamping needs its own ruling before reading it.
  
  `sys_api_key` now declares
  `tenancy: { enabled: false, organizationField: 'active_organization_id' }`,
  so revoking another user's key from a different active organization lands the
  audit row behind the wall of the KEY's organization — where the tenant admin
  who can act on it reads it. The `enabled: false` is measured
  behavior-identical to the previous absent block for this object on every read
  path (injection bails on `managedBy: 'better-auth'` first; the SQL driver's
  tenant field resolves null either way; Layer 0 is exempt either way; the
  memory/mongo boot guards count only an explicit `enabled: true`).
- b3f9831: fix(platform-objects): a translated Setup/Studio/Account label whose source string has been edited underneath it now serves the source text instead of the stale translation (#8765)
  
  The `apps` / `dashboards` / `pages` half of this package's i18n is hand-authored
  per locale. Every gate over it judges **presence or ownership** —
  `app-nav-translation-parity.test.ts` (a translation exists for every declared
  id, and none outlives its declaration), `check:i18n-coverage` (ratchets
  *untranslated* labels), `check:app-nav-i18n` (a label per locale on the merged
  nav tree). A translated value that has gone **stale** satisfies every one of
  them: it is present, it is owned, it is not untranslated.
  
  So a source-string edit left `zh-CN` / `ja-JP` / `es-ES` serving the previous
  translation indefinitely, under a fully green build — which is how
  `widget_recent_events` shipped its pre-conversion title in all four locales.
  Pinning `en` to the declared source did not create that drift, but it removed
  the one accidental symptom that made it visible: the drift stopped being
  uniform across four bundles and became locale-specific, invisible to every
  reviewer who reads the product in English.
  
  **Ruled Option B** (#8765): record the source hash at translation time; a hash
  mismatch marks the translation stale, and stale falls back to the source text.
  
  - Each translated locale ships a `<locale>.source-hashes.ts` table recording,
    per leaf, the digest of the `en` source string that leaf was translated from.
    `setup.translation.ts` compares them against the current source when it
    assembles the bundle the kernel is handed.
  - **Edit a source string** ⇒ that leaf falls back to the source text in every
    locale that had translated it.
  - **Update one translation** (its value *and* its recorded hash) ⇒ **that locale
    alone recovers**; the others keep falling back.
  - **A leaf with no recorded hash is legacy-trusted**, not stale. The tables were
    backfilled once from the then-current source, so no existing translation
    degraded when this landed.
  
  **No new failure mode, and no new gate.** The fallback substitutes the source
  string rather than deleting the key, so no key set moves; a translated locale
  carrying the source string verbatim is exactly what the extractor already
  writes for an untranslated key under `--fill=default`, and exactly what the
  resolver's locale chain has always rendered. Staleness degrades what is
  *served* — it never fails a build, which would put a four-locale translation
  task in front of every one-word source edit.
  
  Scope is the hand-authored sections only. `objects` / `metadataForms` are
  generated, and the hole cannot occur there: `os i18n extract` rewrites the `en`
  bundle from the source on every run and does not merge the default locale, so a
  source edit either lands in the generated bundle or fails `check:i18n` as drift.
- Updated dependencies [56656aa]
- Updated dependencies [07e630e]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [75b7c24]
- Updated dependencies [d5552ca]
- Updated dependencies [d9813a9]
- Updated dependencies [8640fb2]
- Updated dependencies [2420641]
- Updated dependencies [2ad91c3]
- Updated dependencies [f57fb38]
- Updated dependencies [00777a0]
- Updated dependencies [d491625]
- Updated dependencies [420804d]
- Updated dependencies [716ac9b]
- Updated dependencies [62b1427]
- Updated dependencies [7ea1372]
- Updated dependencies [23abe27]
- Updated dependencies [985a9cd]
- Updated dependencies [a8189ae]
- Updated dependencies [26e70fb]
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
- Updated dependencies [7ff3975]
- Updated dependencies [29d055b]
- Updated dependencies [65589d6]
- Updated dependencies [2c86fe3]
- Updated dependencies [e196c6a]
- Updated dependencies [4ab7523]
- Updated dependencies [19539b4]
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
- Updated dependencies [3851f87]
- Updated dependencies [845e164]
- Updated dependencies [2a29caa]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
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
- Updated dependencies [7a537ce]
- Updated dependencies [593c4bf]
- Updated dependencies [ff08691]
- Updated dependencies [60e0f90]
- Updated dependencies [90c5285]
- Updated dependencies [7901b2d]
- Updated dependencies [56bca91]
- Updated dependencies [79394d7]
- Updated dependencies [730fd9a]
- Updated dependencies [44bc51d]
- Updated dependencies [73cfddf]
- Updated dependencies [d634e66]
  - @objectstack/spec@17.1.0
  - @objectstack/metadata-core@17.1.0

## 17.0.0

### Major Changes

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
  production-dependency batch from #3517

  **better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
  `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
  adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
  1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
  `scimProvider` model and the generate-token endpoint are gone), which is a
  feature migration, not a version bump. Its peer range accepts rc.2 core, and the
  advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

  **BREAKING — account identity.** better-auth renamed `account.accountId` to
  `account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
  resolves accounts by `(issuer, providerAccountId)`.

  - FROM `fields: { accountId: 'account_id' }` → TO
    `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
    account id keeps its `account_id` column — only the better-auth-side name
    moved — and `sys_account` gains an `issuer` column.
  - FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
    `createAccount({ providerId, issuer, providerAccountId, … })`. A local
    password account carries the issuer better-auth mints for itself,
    `local:credential`.
  - FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
    `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
    from `accounts.list()`), matching better-auth's narrowed body.
    `accounts.list()` returns `issuer` + `providerAccountId` in place of
    `accountId`.

  **Existing deployments:** rows written before 1.7 have no issuer and are
  invisible to sign-in until stamped. The auth plugin now runs an idempotent
  boot-time backfill that stamps what it can derive — `local:credential` for
  password accounts, `local:oauth:<providerId>` for configured social providers,
  and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
  Accounts from a federated IdP that is no longer registered cannot be derived;
  they are logged with their provider id and row count rather than guessed, and
  those users cannot sign in through that provider until the row is stamped with
  the IdP's issuer or removed so a fresh login re-links it.

  **Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
  now implemented over the kernel cache service — `getAndDelete` (single-use
  verification values) and `increment` (fixed-window rate-limit counter;
  `rateLimit.storage: 'secondary-storage'` throws at boot without it).

  The rest of #3517's production-dependency batch rides along: `@oclif/core`
  4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
  `pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.

### Minor Changes

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- 1bd5652: feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
  `delegated_admin` org role, capped so it cannot mint authority (#3697)

  D8 authorizes invitation _placement_ against the issuer's `adminScope`
  (ADR-0090 D12), so a delegated plant admin may invite only into their own
  subtree. That gate is implemented, unit-proven and reachable — but no principal
  could reach it in a state where it did anything:

  - better-auth grants `invitation: ["create"]` to `owner` and `admin` only
    (`memberAc` holds `invitation: []`, which every other registered role
    inherits);
  - under a wall-enforcing posture, owners and admins are auto-elevated to
    `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
    `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
    short-circuits on tenant admins.

  The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
  wall (real, and correct) but never by `adminScope`, so D8's motivating story —
  "a plant admin invites into their own subtree without a platform admin
  finishing the job" — could not happen.

  **Two pieces, and they only ship together.**

  **1. The role.** `delegated_admin` is now registered with the organization
  plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
  membership grade that may reach `/organization/invite-member` without being an
  org admin. Deliberately _not_ `invitation: ["cancel"]`: better-auth's cancel
  route checks the permission with no inviterId attribution, so it would mean
  "cancel anyone's pending invitation in the org".

  The role carries no ObjectStack authority by construction — `mapMembershipRole`
  passes it through as a position name, and with no `sys_position_permission_set`
  binding that name resolves to nothing. Role = _can reach the endpoint_;
  `adminScope` = _what the endpoint permits_.

  `sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
  fourth option. Those selects are **enforced on write** — better-auth's own
  invitation and membership inserts are validated like any other row — so
  registering the role with the org plugin without listing it in both would have
  produced a role nobody could hold and nobody could hand out
  (`ValidationError: role must be one of: owner, admin, member`). That is exactly
  how the end-to-end regression caught it, twice; neither unit test could. The
  three non-English translation bundles carry the English label for the new option
  until localized.

  **2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
  beside the D8 placement gate. Registering the role alone would have been a
  four-step privilege escalation: better-auth's only role-level cap on _what role
  you may invite someone as_ is its `creatorRole` check (default `owner`), which
  blocks inviting an **owner** but not an **admin** — and an accepted `admin`
  membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
  subtree-scoped delegate could have manufactured a tenant admin, with every
  existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
  acceptance-time membership write runs under better-auth's context, not the
  issuer's).

  The cap refuses an invitation whose role outranks the issuer's own, and
  restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
  because an app-registered role projects into `current_user.positions` and may be
  bound to permission sets, making it a capability channel too. A delegate's
  channel for capability is the invitation's _placement_ intent, which the D12
  gate allowlists position-by-position. The cap applies to every invitation,
  placement-carrying or not (the escalation is independent of placement), and
  fails closed: an issuer role that cannot be resolved confers nothing above a
  plain member.

  **What changes for deployments.** One new class of principal exists: members
  holding the `delegated_admin` org role, who can invite into the org — as
  `member` only, into the subtree their `adminScope` allows. It is opt-in twice
  over (someone must set the membership role _and_ grant an adminScope set), so a
  default deployment changes not at all. Org owners and admins are unaffected.

  Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
  console and control-plane surfaces name the role from one place.

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

- 98877c9: feat(core,platform-objects,spec): the ADR-0119 D2 migration-journal runner — a migration killed mid-run is resumable to completion or compensable to clean, with journal rows proving which (#4617)

  **The gap D1 left open.** ADR-0119 D1 made `engine.transaction()` reachable
  through the contract, which is the right answer for multi-write atomicity that
  fits in one transaction. Migration-class work does not fit: a million-row
  backfill cannot hold one write-lock for its duration, `driver-memory`'s
  `beginTransaction` deep-clones the entire database (O(db) per begin),
  `ObjectQL.transaction()` binds the **default driver only** so a multi-datasource
  migration silently commits part of its work outside it, and a process **killed**
  — as distinct from a thrown error — defeats in-process rollback entirely. So the
  unit of atomicity is the _chunk_, and durability across chunks is a journal.

  Four consumers had each converged on the same four moves — dry-run preflight,
  undo journal, LIFO compensation, re-entrant forward recovery (ADR-0105 D13
  promotion, ADR-0117 D8's ownership backfill, the org lifecycle transitions, and
  D10 master-data distribution #4585). One copy is engineering; four is platform
  debt, and the fourth author would have had to rediscover the invariant below
  from scratch.

  **New: `runMigrationJournal` (`@objectstack/core`).** Preflight runs every
  step's read-only validator before any step writes, so a plan that would fail at
  step 3 has not written step 1. Rows are chunked per the `bulk-write.ts`
  discipline; each chunk's writes run inside `engine.transaction()`. On failure,
  committed chunks are compensated newest-first, each in its own transaction. On
  restart, a rediscovered run resumes forward from the first chunk lacking
  `chunk_done`, or unwinds, per the plan's `onCrash` policy. Forward and
  compensate callbacks receive an `attempt` counter; `attempt > 1` means the prior
  outcome is UNKNOWN and the callback must recheck by natural key before
  re-writing — the same at-least-once contract `bulk-write.ts` already documents,
  reused rather than re-derived.

  **The invariant that carries the design:** `chunk_done(i)` is written **inside**
  the chunk's own transaction, so `done ⇔ committed` holds by construction;
  `chunk_started(i)` is written autonomously **before** it. That asymmetry is what
  gives `started ∧ ¬done` exactly one meaning — _the outcome is unknown_ — which
  is the only state a crash can leave and the only state recovery reasons about.
  Making both writes symmetric would look tidier and would destroy recovery.

  **New: `sys_migration_journal` (`@objectstack/platform-objects`).** Rows keyed
  `(run_id, seq)` under a unique index, so a resumed run that miscomputes its next
  sequence fails loudly rather than double-recording an event. Registered
  unconditionally alongside `sys_migration` because recovery must be discoverable
  with **zero host wiring** — a journal some kernels compose and others do not is
  a journal a boot scanner cannot rely on (ADR-0078). Distinct in grain from
  `sys_migration`, which holds one durable verdict per named migration; this holds
  many rows per _run_. Read-only over the API; writes go through the runner in
  system context.

  **The runner refuses rather than degrades**, in four places: the runtime cannot
  roll back; any preflight fails; the plan declares `onCrash: 'compensate'` but a
  step cannot compensate; or a resume's plan hash disagrees with the journal
  (resuming a changed plan would apply chunk boundaries the journal never
  described). A compensation failure halts and is journalled — never swallowed —
  and the run ends `failed`, not `compensated`, because a database in a state no
  clean story covers must not be reported as a tidy rollback.

  **`engineCanRollBack` is now shared.** The two-level probe (engine method AND
  default-driver `beginTransaction`) was the same condition written twice — here
  and in `batchData`'s atomic gate. It now lives in `@objectstack/core` and
  `@objectstack/metadata-protocol` imports it, as a type predicate so callers do
  not each re-narrow the optional member by hand. Two copies of "can this runtime
  actually roll back?" drift by one clause and leave one caller believing it has
  atomicity it does not have.

  Boot reconciliation and `os migrate resume` land separately; `findInterruptedRuns`
  is the discovery primitive they will consume, and is exported here.

  **Docs:** ADR-0118 (plugin-reachable transactions) is renumbered **ADR-0119**.
  It merged one day after an unrelated ADR-0118 (非用户 actor 的平台契约) and the
  earlier merge holds the number; citations of "ADR-0118 D1/D2/D3/D4" written
  before 2026-08-03 mean the renumbered record.

- 06be54e: fix(objectql): a value admitted by an `OS_ALLOW_LAX_*` escape hatch stops released field files from being collected (#4797)

  `recordDataMigrationRun`'s contract says a deployment whose data has regressed
  since it last verified closes its own gate. That only happened when a migration
  was re-run — nothing told the ledger when the data actually regressed.

  Normally nothing has to. Once `sys_migration` records a verified ADR-0104
  migration the write path is strict, a non-conforming value is refused, and the
  certificate cannot go stale. **The operator escape hatches are the exception,
  and they exist precisely to relax a deployment that has already verified.** With
  `OS_ALLOW_MEDIA_VALUES` / `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`
  on, a non-conforming value is admitted and persisted while the row still reads
  `verified_at` non-null, `blocking: 0`. Turn the switch off — or let any other
  process or machine run without it — and strict returns to reject the very data
  this deployment stored. Meanwhile the `adr-0104-file-references` row also governs
  reclamation of released field files, so the reap guard kept **deleting bytes** on
  the strength of a certificate that was no longer true, with nothing in the ledger
  saying so.

  **A lax-admitted write now records a deviation.** The engine's admit path — the
  same sink that already tallies counterexamples for #4769 — stamps
  `sys_migration.deviation_observed_at` (plus a `deviation_detail` naming the
  object, field, type and parse issue) on the migration whose contract the value
  broke.

  **The marker gates the irreversible path, and only that.** Authority is withdrawn
  in proportion to reversibility:

  | behaviour                                 | reversible?                 | predicate                      | while a deviation stands |
  | ----------------------------------------- | --------------------------- | ------------------------------ | ------------------------ |
  | strict value-shape enforcement (#3438)    | a rejected write is retried | `isDataMigrationFlagVerified`  | continues                |
  | tombstoning a released file (#3459 PR-5b) | lifted on re-attach         | `isDataMigrationFlagVerified`  | continues                |
  | reap guard's byte delete                  | **never**                   | `authorisesIrreversibleAction` | **refuses**              |

  A certificate is not a boolean; it is authority over a set of behaviours, and the
  two halves are withdrawn on different evidence. One admitted write is a complete
  disproof of "nothing here violates this contract" — enough to stop deleting data
  forever. It is _not_ evidence of the same order as the full-store scan that
  earned the certificate, so it does not revoke it: doing that would turn an
  explicitly temporary switch into a one-way door, forcing a full re-migration on
  anyone who used the escape hatch once.

  Recording without gating was rejected for the opposite reason — a marker no code
  consumes is a declared-but-unenforced field, and the bytes get deleted regardless.

  **Getting back to full authority is the documented route.** A real
  `os migrate files-to-references --apply` / `os migrate value-shapes --apply` run
  walks the whole store again, which _is_ evidence of the same order, and clears
  the marker.

  Additive and backward compatible. A `sys_migration` row written before these
  columns existed reads as "no deviation observed", so upgrading never retroactively
  closes a gate a deployment earned — the marker only ever closes it on an observed
  deviation. `isDataMigrationFlagVerified` is unchanged and keeps its existing
  consumers; the new `authorisesIrreversibleAction` (spec) and `mayActIrreversibly`
  (platform-objects) are the stronger pair, and the reap guard is their one caller.

- 5fa04fb: Point the account app's **Approvals** navigation entry at the Approvals Inbox component, and contribute an **Approvals Inbox** entry to Setup (#7234).

  The entry point has not moved — the account menu still shows **Approvals** with the same
  label and icon in every locale. Its destination has. It used to open the raw
  `sys_approval_request` grid, which is an admin/diagnostic view of the engine's own table
  and cannot show an approver a single decision button: every action on that object is gated
  on `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block is
  attached only by the approvals REST path, never by the generic data API the object route
  reads. The result was a correct-looking list of rows nobody could act on. The entry is now
  `{ type: 'component', componentRef: 'approvals:inbox' }`, so it opens the full inbox —
  decision actions, business vocabulary, node progress and the request drawer.

  - **Account app**: `nav_account_approvals` becomes a component entry gated by
    `requiresService: 'approvals'`, so it disappears where `plugin-approvals` is not
    installed (the previous `requiresObject` gate does not apply to a component entry).
  - **Setup**: `plugin-approvals` contributes a new **Approvals Inbox** entry at the top of
    **Setup → Approvals**, above the three raw tables, which stay exactly as they were —
    admin-gated by `manage_platform_settings` and now unambiguously the diagnostic surface.
    Labels ship in all four locales (zh-CN 审批中心).
  - `sys_approval_request` is no longer surfaced raw to end users anywhere.
  - **Docs**: the approver's queue is documented as the Approvals Inbox, with a snippet for
    mounting it in any business app — one navigation entry naming the component-registry key
    `approvals:inbox`, never a console path.

  Reaching the inbox end to end in the browser additionally requires the console pin bump,
  tracked separately.

- ce92674: feat(email): declared email templates reach the mail service (#4509)

  Authoring an `email_template` was a silent no-op. `EmailService.sendTemplate`
  resolves `(name, locale)` against **`sys_email_template` rows**, and the only
  writers of those rows were the built-in auth templates plus a code-constructed
  `EmailServicePluginOptions.templates` that no bootstrapper ever passed. Every
  door an author can actually use — a stack's `emailTemplates:`, an
  `*.email-template.ts` file, Studio's metadata-admin list, `PUT /meta` — parked
  items in a metadata store nothing read back. So an admin could "fix" the
  password-reset email in Studio, get a success toast, and watch users keep
  receiving the built-in copy: ADR-0078 false compliance on **authentication
  mail**. This is the shape #3461 had for webhooks, closed the same way (ADR-0049
  enforce-or-remove, route: enforce).

  **`bootstrapDeclaredEmailTemplates`** now materializes declared templates into
  `sys_email_template` at boot. Each item is validated through
  `EmailTemplateDefinitionSchema.parse()` — the spec schema finally has a real
  consumer, defaults and all — and projected with `mapTemplateToRow`, which is the
  **same** mapping the built-in seeder uses, extracted and shared so the two doors
  cannot drift apart. A malformed template warns and is skipped rather than
  crashing boot.

  **Runtime writes take effect immediately.** Unlike `webhook`, `email_template`
  is `allowRuntimeCreate: true`, so a boot-only bridge would have left a Studio
  save inert until the next restart — the same bug, half-fixed. The plugin also
  subscribes to `email_template` metadata changes and re-materializes the single
  changed item; withdrawing a template deactivates its rows (across locales)
  rather than deleting them.

  **Three breaks sat on this path, not one**, and closing any two of them would
  still have shipped a template that never sent:

  - `@objectstack/objectql` never registered a manifest's `emailTemplates:` into
    the metadata registry at all — the key was simply missing from the generic
    ingestion list, so the bridge's own source was empty.
  - The built-in seeder left `managed_by` at the column's `'admin'` default, which
    made platform templates masquerade as admin-authored. Since the bridge refuses
    to overwrite admin rows, a built-in would have permanently outranked the
    template an app declared. Built-ins now stamp `managed_by: 'platform'`.
  - Nothing materialized declared metadata into rows.

  **Seed-not-clobber** mirrors `sys_webhook` (#3489) and `sys_sharing_rule`
  (#2909): `sys_email_template` gains `managed_by` / `customized`. Declared
  templates re-seed every boot as `managed_by: 'package'`; a row an admin created
  (`admin`) or edited (`customized`, stamped by a `beforeUpdate` hook) is never
  overwritten, so reworded transactional mail survives redeploys. This is a
  separate axis from `is_system`, which keeps its existing meaning for built-ins.

  The `email_template` liveness ledger flips from 13 dead properties to fully
  live, with an ADR-0054 runtime proof bound on `subject`
  (`email-template-materialization`): it boots a real stack, authors a template
  that overrides a built-in auth template, and asserts the **authored** wording is
  what reaches the transport.

- e98fb14: fix(service-queue): `sys_job_queue` no longer grows forever — `completed` rows expire on a declared 7-day retention (#5179)

  `DbQueueAdapter` marked a delivered message `status: 'completed'` and then
  **nothing ever touched that row again**. `purge()` had zero production callers
  (tests only), `purgeFailed()` is a manual dead-letter API, and the object
  declared no lifecycle policy at all — so every queue delivery left a permanent
  row, which since #5160 means one permanent row per queued email.

  `sys_job_queue` now declares an ADR-0057 policy and the platform
  `LifecycleService` enforces it on its existing hourly sweep:

  ```ts
  lifecycle: {
    class: 'transient',
    retention: { maxAge: '7d', onlyWhen: { status: 'completed' } },
  }
  ```

  **Only `completed` rows are swept.** `pending` / `running` are live work, and
  `failed` / `dlq` are the dead-letter queue — they exist to wait for a human, so
  they are never deleted automatically at any age. `listFailed()` / `replay()` /
  `purgeFailed()` remain the only way a dead letter leaves the table. This is
  also why the policy is `retention` (age + row filter) rather than a `ttl` on
  `completed_at`: TTL has no row filter, and `dlq` rows stamp `completed_at` too.

  **No new configuration, and no new sweeper.** ADR-0057 §3.3 puts one reaper in
  the platform rather than one per plugin — the same call the sibling
  `sys_job_run` (30d) already makes. Any kernel with a data engine already runs
  it, its per-sweep `[lifecycle] sweep: … ~N rows reaped` line now accounts for
  this table too, and the window is overridable per environment through the
  `lifecycle` settings namespace without touching code.

  **The dedup window is now an enforced invariant, not a coincidence.** Publish
  dedups against a terminal row by comparing its `created_at` to
  `idempotencyWindowMs` (default 24h), and the reaper cuts off on that same
  `created_at` axis — so retention (7d) ≥ dedup window is what keeps "duplicate
  publishes inside the window are suppressed" true. `DbQueueAdapter` reads the
  declared window (new export `completedRetentionWindowMs()`) and **throws at
  construction** if `idempotencyWindowMs` is configured longer than it, instead of
  silently degrading into duplicate deliveries days later. If you raise
  `idempotencyWindowMs` past 7 days, raise the object's declared retention (or the
  `lifecycle` settings override) to match — the error message names both numbers.

  `class: 'transient'` is deliberate: `telemetry`/`event`/`audit` classes
  relocate their table to the dedicated `telemetry` datasource wherever one is
  registered (ADR-0057 §3.6), and moving a live work queue's storage would be a
  migration, not a cleanup.

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

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

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

- aa8b847: feat(authz): scoped invitations — placement intent on an invitation, gated by
  the issuer's adminScope and applied on acceptance (ADR-0105 D8)

  An invitation may now carry PLACEMENT INTENT — the business unit the invitee
  lands in and the positions they are assigned — so a delegated (plant) admin's
  invitee arrives already in the right unit and role instead of waiting on a
  platform admin. This closes the structural gap ADR-0105 D8 names for
  `single`-posture deployments and is the natural admission path under `group`.

  The two halves ship together, deliberately:

  - **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
    by dry-running the existing `DelegatedAdminGate` against the very
    `sys_user_position` rows the acceptance would write. The gate is reused
    verbatim — no second copy of the subtree/allowlist logic to drift — so an
    invitation can never place what its issuer could not have assigned directly.
    Without that gate the feature would be an escalation hole: the built-in
    `organization_admin` is deliberately read-only on the RBAC tables precisely
    so a fresh org admin cannot rebind themselves, and applying an unchecked
    invitation payload under system context would hand that authority straight
    back.
  - **Acceptance applies it**, idempotently and failure-isolated: a replayed
    acceptance converges instead of duplicating assignments, and a placement
    miss never undoes a valid membership.

  Surface:

  - `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
    fields, registered in the D7 collision-guarded whitelist; NOT generically
    editable — placement is set only at issuance, through the gate).
  - `@objectstack/plugin-security` registers the `invitation-placement` service
    (`assertIssuable` / `apply`).
  - `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
    `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
    placement in a deployment without the delegated-administration runtime is
    refused, never silently placed unchecked.

  Existing invitations are unaffected — an invitation without placement intent
  never consults the gate and behaves exactly as before.

- f104bab: feat(plugin-email,platform-objects): `sys_email` carries headers and small attachments, so those messages become durably deliverable (#5177)

  Durable email delivery works from the **row**, not from the in-memory message:
  `send()` publishes an `{ rowId }` job (#5160), the boot sweep re-reads rows
  (#5161), and both end at `rowToNormalized`. So anything a `sys_email` row could
  not carry, a row-based delivery would have dropped — and custom headers and
  attachments were exactly that. The honest workaround was to refuse: a message
  with either was pushed back onto inline delivery so that it would at least go
  out whole, which closed the durable path to precisely the mail most worth
  making durable (a signed receipt, a `List-Unsubscribe` header, an invoice PDF).

  `sys_email` now has two columns, and those messages are queueable.

  **`headers_json`** — the custom headers, as a JSON object. Written in both
  delivery modes (it is audit evidence as much as delivery input) and rebuilt on
  read. Headers are no longer a reason to fall back to inline delivery.

  **`attachments_json`** — attachments as a JSON array of
  `{ filename, contentType?, size, hash, cid?, contentForm, inline?, storageKey? }`,
  content base64 in `inline`. Written when the **combined raw size of one
  message's attachments is within `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` (256 KiB,
  exported from `@objectstack/plugin-email`)** — worst case ~350 KB of base64, so
  a row stays bounded. Both arms of the declared `content: string | Buffer`
  contract round-trip as the arm they were sent as: restoring a text attachment
  as a Buffer would silently drop `charset=utf-8` from its MIME part and let the
  recipient's client mis-decode a UTF-8 file, so `contentForm` records which one
  it was. `cid` travels too — an inline `<img src="cid:…">` is unusable without
  it.

  **Over the limit, nothing changes.** The message is delivered inline exactly as
  before, whole, and the row stores no attachment content; the reason is stated
  at `info` (a bound, not a degradation — the worst outcome is today's
  behaviour). Out-of-row storage for large attachments is #5172; `storageKey` is
  declared now so that lands as a new _producer_ rather than a data migration.

  Rows written before these columns exist read exactly as they did. A column that
  is present but does not describe what it claims — malformed JSON, a size or
  hash that disagrees with the content, a missing `contentForm` — is **rejected**,
  and the row lands at `failed` carrying the reason, rather than being delivered
  with a part quietly missing.

  The `sys_email` schema change is additive (two optional textarea columns); no
  migration is required and default inline delivery is unchanged.

- 68dea0b: feat(platform-objects,service-storage,cli): `sys_migration` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the storage service (#4243)

  The deployment-level data-migration flag ledger (`sys_migration`, #3617) was
  registered by `@objectstack/service-storage` as its first consumer. That was
  deliberate while the file migration was the only consumer, but the ledger now
  gates storage-independent behaviour too — `os migrate value-shapes` (#4235)
  and the fresh-datastore attestation (#4215) — and a non-file migration had to
  boot the whole storage plugin just so the kernel carried the table. Any kernel
  assembled without storage silently had no ledger at all, which read exactly
  like "migration not run" (both answer false) while actually meaning "ledger
  not installed".

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the ledger exists with the
  platform, independent of which optional services are composed. The
  fresh-datastore attestation (#3438, ADR-0104) moves with it: it is ledger
  bookkeeping, and its old home justified itself as "the service that registers
  `sys_migration`". Definition ownership is unchanged (`sys_migration` stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`); the
  flag helpers and readers are untouched.

  Consequences:

  - `@objectstack/service-storage` no longer contributes `sys_migration` to the
    manifest and no longer performs the fresh-datastore attestation. An embedder
    composing `StorageServicePlugin` on a hand-built kernel that relied on it
    for the ledger must compose `PlatformObjectsPlugin` (the plugin every
    supported assembly path already includes).
  - The CLI's `buildDataMigrationPlugins()` no longer boots storage for every
    gated migration — it registers `PlatformObjectsPlugin` always, and settings
    - storage only for `os migrate files-to-references` (`{ storage: true }`),
      the one migration that actually reconciles against the storage adapter.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

- 60f0dd8: feat(spec,platform-objects): add `degraded` to the job status vocabulary (#7072)

  `JobExecutionStatus` and the two `sys_job*` selects now carry a fifth value,
  `degraded` — "the run finished, but its work did not happen". This is the
  consumer-side half of the `JobRunOutcome` producer shape #6617 shipped on
  `contracts/job-service.ts`, and it executes the 2026-08-08 maintainer ruling on
  #5548 verbatim:

  > **Vocabulary stays minimal** — one additional outcome meaning "completed
  > without accomplishing the work". ⛔ Do not open an enum family; a second key
  > would need its own pull.

  Three declaration sites had to move together, because the two platform-object
  selects are _enforced_ — ObjectQL's record validator refuses an
  out-of-vocabulary `select` value with `invalid_option`, and `DbJobAdapter`
  swallows that rejection in a best-effort `try/catch`. A value legal in the spec
  enum but absent from the selects would therefore be a silently dropped write
  that leaves the run row `running` forever, not a type error:

  - `packages/spec/src/system/job.zod.ts` — `JobExecutionStatus`
  - `packages/platform-objects/src/audit/sys-job-run.object.ts` — `status`
  - `packages/platform-objects/src/audit/sys-job.object.ts` — `last_status`

  **`degraded` is not a failure and never retries.** Retry and failure are driven
  exclusively by a rejected handler promise, so a resolved
  `{ outcome: 'degraded' }` never re-runs the job.

  A degraded run's `reason` rides the existing `error` / `last_error` columns and
  leaves `failure_count` flat — the ruling's minimal-vocabulary spirit applied to
  columns as to enum members. The cost is recorded in the TSDoc at the enum: a
  column labelled "Error" may carry a non-error operator note whenever
  `status === 'degraded'`, so readers must gate on the status first.

  Additive only: no existing value changed meaning, and nothing yet produces
  `degraded` — wiring `DbJobAdapter` to map the outcome is #5548, which this
  unblocks. Locale bundles (en / zh-CN / ja-JP / es-ES) carry the new option.

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

- 098f4bb: fix(platform-objects): one decision, one dialog — carry identity confirm questions on `description` (#7309)

  The shared console action runner chains confirmation **then** param collection,
  both awaited (objectui `packages/core/src/actions/ActionRunner.ts`). An action
  declaring `confirmText` **and** `params` therefore opened **two** sequential
  dialogs for one click, with nothing sent until the second — while the first
  already read as "the action ran".

  The maintainer's 2026-08-10 ruling on #7278 (shipped in PR #7592) is to carry the
  confirm question in the action's top-level `description` (#7367), which the param
  dialog renders under its title, and to drop `confirmText`. #7278 applied it to the
  two `plugin-approvals` actions; this change sweeps the **14** remaining in-repo
  action sites, all in `identity/`:

  | object                  | actions                                                                                                     |
  | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
  | `sys_user`              | `ban_user`, `delete_my_account`, `disable_two_factor`, `generate_backup_codes`                              |
  | `sys_oauth_application` | `enable_oauth_application`, `disable_oauth_application`, `rotate_client_secret`, `delete_oauth_application` |
  | `sys_two_factor`        | `disable_two_factor`, `regenerate_backup_codes`                                                             |
  | `sys_account`           | `unlink_account`                                                                                            |
  | `sys_organization`      | `change_slug`                                                                                               |
  | `sys_sso_provider`      | `delete_sso_provider`                                                                                       |
  | `sys_team_member`       | `remove_team_member`                                                                                        |

  **No warning was reworded and none was dropped** — each question moves verbatim
  from `confirmText` to `description`, so the user still reads it before committing,
  now in the one dialog that collects the params. `sys_oauth_application.rotate_client_secret`
  went from three dialogs to two: one param dialog (question + `client_id`), then the
  existing post-run `resultDialog` that reveals the new secret. That reveal is output
  shown once _after_ the rotation, not a second pre-run decision, so it stays.

  **`confirmText` is untouched where it is still correct.** A param-LESS action has
  no param dialog to fold the question into, so the confirm _is_ its only dialog —
  `delete_organization`, `leave_organization` and `impersonate_user` keep theirs.

  The `en` / `zh-CN` / `ja-JP` / `es-ES` bundles move the same 14 leaves by hand.
  `os i18n extract` treats a renamed key as a new gap and this repo extracts with
  `--fill=default`, which would have seeded English over the curated translations
  in three of the four shipped locales — invisible to `check:i18n`, whose fresh
  extract would agree with the English it just wrote. A carryover test pins each
  locale as translated rather than echoing the English source.

  Tests pin the user-visible consequence in both directions: that an action
  carrying params opens one dialog, **and** that its question is still shown.
  Deleting a warning instead of moving it goes red on `ban_user`,
  `delete_my_account` and `rotate_client_secret` — the failure a "no `confirmText`
  anywhere" grep cannot see.

- c44dd5e: fix(objectql,platform-objects): 一次启动不能证明它自己随即违反的契约 —— ADR-0104 空库自证改为在本次启动写完数据后下结论 (#4769)

  一个全新部署第一次 `pnpm dev` 全绿(130 rows,0 ERROR),**第二次启动开始永久 10 条
  ERROR**、10 条种子记录写不进去。数据没变、代码没变,只是重启了一次;被拒的正是首启
  自己写进去的数据。

  根因不是哪个值算错了,是**顺序反了**。`sys_migration` 里那两行
  (`adr-0104-file-references` / `adr-0104-value-shapes`)带着
  `{"attested":"datastore-created-empty"}` 写在 `kernel:ready`,而同一次启动的 seed
  还在往里写行。「空库 ⇒ 没有历史值」这个推理成立的前提是**没有数据可写**,而它恰恰
  写在即将写入 130 行之前 —— 证明落笔那一刻是真的,一秒之后就不是了。于是首启在
  warn-first 下把数据留下,之后每一次启动读到这张证书、进入 strict、拒掉前任写下的
  那批行。

  ## 改了什么

  **证书必须覆盖它所声称的那批数据。**

  - **写入时机**:新库自证改为在**本次启动自己的数据落定之后**进行 ——
    `app:seeded`(inline seed 结算点,含超出 `OS_INLINE_SEED_BUDGET_MS` 后台跑完的
    那一半),不 seed 的 kernel 仍由 `kernel:ready` 兜底。两条路径进的是同一个幂等
    调用。
  - **写入前提**:`attestFreshDatastore` 先问引擎「这次启动放行过违反该契约的值吗」。
    引擎在 warn-first 放行每一个不合形状的值时,用**与 strict 模式完全相同的判定**把
    它记下来 —— 证明干净需要扫全库,证伪只需要一个反例,而这个反例写路径已经算出来
    了。任一条被本次启动证伪的迁移 id **不再自证**,部署维持 warn-first(真实且可
    恢复),并在日志里指名是哪个 `对象.字段` 让这道闸没关上、该跑哪条 `os migrate`。
    两行一起改:`adr-0104-file-references` 与 `adr-0104-value-shapes` 各自独立判定,
    一个 `cover` 不合形状不牵连 `location`,反之亦然。
  - **写入之后**:证书若在签发之后被本次启动推翻(操作员显式开了
    `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`,或后台 seed 收尾晚于
    签发),引擎**撤销**它 —— `verified_at` 清空、`blocking` 记上、`details` 保留原
    `attested` 并补一条 `revoked`。只针对**本次启动亲手创建的库**上的自证行:扫过全
    库的真实迁移证据不会被一次写入的观察推翻。

  **记忆化的第二张脸也一并修了。** 首启之所以「看起来是绿的」,一半靠的是进程内正好
  缓存了 `false`。`sys_migration` 在 kernel init 期间才注册,而第一条写可能赶在它之
  前 —— 那次读根本没读到账本,却被当成结论冻结了一整个进程的姿态。现在区分两种否定:
  **问过了、账本说不**(结论,照旧缓存)与**根本问不到**(未注册 / 查询抛错 —— 依旧
  答 `false`,闸依旧关着,但不记住,下一次写再问一次)。代价是账本存在之前每次写多一
  次 registry 查表(在任何查询之前就短路),账本可读之后即止。

  启动横幅那条 ADR-0104 建议行(`kernel:bootstrapped`)也改为直接读账本而非读记忆化
  结果 —— 否则一个刚刚自证成功的新部署会被告知去跑一条已经不需要跑的迁移。

  ## 对既有部署的影响

  - 数据本来就合规的新部署:行为不变,照旧 born-migrated,启动即 strict。
  - 种子数据不合规的新部署:**不再**发出那张假证书。首启与之后每一次启动一致地停在
    warn-first,并且每次都告诉你是哪一个值、跑哪条命令。数据本身该怎么修还是怎么修
    (showcase 的 `cover` 种子值在 #4774 单独跟踪)。
  - 已经跑过 `os migrate … --apply` 的部署:完全不受影响 —— 扫描得来的证据不经由本
    次改动的任何路径改写。

- 52200b4: fix(platform-objects,plugin-auth): let the API-key revoke/restore actions actually run (#7727)

  `sys_api_key` contradicted itself. It declared two row actions —
  `revoke_api_key` / `restore_api_key` — as `PATCH /api/v1/data/sys_api_key/{id}`
  with `bodyExtra: { revoked: true|false }`, while the same object set
  `enable.apiMethods = ['get', 'list']`. The declared PATCH was refused at the
  ADR-0049 method gate with `405 OBJECT_API_METHOD_NOT_ALLOWED` before any
  authorization ran, so **no product route revoked an API key**: the Setup →
  API Keys → Revoke button produced an error toast, the row still read
  `revoked = false`, and the key kept authenticating. A leaked key could only be
  retired by writing the row out of band.

  Enforcement of the flag was never the problem — the verifier filters
  `revoked: false` and re-checks the row, so a flipped bit takes effect on the
  very next `x-api-key` call. The missing piece was purely the write path, and it
  had **two** gates, not one:

  - **The method gate.** `enable.apiMethods` now carries `update`. `create` and
    `delete` stay off: minting is `POST /api/v1/keys` (the only path that ever
    returns the raw secret) and keys are retired by revoking, not deleting.
  - **The affordance reconciler.** ADR-0103's `reconcileManagedApiMethods` strips
    any write verb a `managedBy` object's resolved affordances do not grant —
    warning, not failing. So `apiMethods` alone would still have served 405 while
    the source read correctly. `userActions: { edit: true }` declares the
    affordance, exactly as `sys_user` does under ADR-0092 D4.

  **Opening the method does not open the columns.** `sys_api_key` stays
  `managedBy: 'better-auth'`, so ADR-0092 D2's identity write guard still
  fail-closed rejects user-context writes, and its per-object update whitelist
  remains the only opening. `revoked` is registered there and nothing else is:
  `key` stays unwritable (a rotated hash would mint a credential nobody holds),
  `user_id` stays unwritable (re-owning a key is privilege transfer), and
  `expires_at` stays on the mint path. A PATCH carrying only non-whitelisted
  columns is refused `403 PERMISSION_DENIED` rather than degrading into a
  timestamp touch, and a mixed patch applies `revoked` while stripping the rest.
  The guard itself is unchanged — no general weakening, and every other identity
  table keeps its default-deny.

  Per ADR-0092 D4's form-rendering constraint, the columns outside the whitelist
  (`name`, `prefix`, `user_id`, `scopes`, `expires_at`) are now `readonly`, so the
  edit form this affordance turns on cannot offer a write the server refuses —
  the declared-≠-enforced shape that caused the original defect.

  Nothing pinned any of this before: the existing tests exercise key _resolution_
  against a pre-revoked row and never call the route the actions declare, which is
  how a declared action and a method gate cancelled out unnoticed. The new
  `api-key-revoke-lifecycle` dogfood suite drives the real PATCH, asserts `200`,
  and then asserts the consequence — the key stops authenticating — because a 200
  that leaves the key working is the defect wearing a success code.

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

- d44dbfa: feat(spec)!: shrink the `ApiMethod` enum to the six primitives — legacy values are stripped at parse, never honored (#3543, P2 of #3391)

  **BREAKING** (the `!` marker and this changeset are the breaking-change
  record; the train ships as the v17 major — see the `v17-rc-anchor` changeset):
  the authored `enable.apiMethods` enum is now exactly the six
  primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`). The eight
  legacy values (`upsert`, `aggregate`, `history`, `search`, `restore`, `purge`,
  `import`, `export`) are no longer authorable — they are DERIVED effective
  operations, resolved by the server's single derivation table.

  **Migration (FROM → TO).** Replace each legacy value with the primitives it
  derives from, then de-duplicate; if the result names all six primitives, delete
  the `apiMethods` key entirely (equivalent to default-open, and it tracks future
  primitives):

  | FROM (legacy) | TO (primitives)      | why                                            |
  | ------------- | -------------------- | ---------------------------------------------- |
  | `upsert`      | `create`, `update`   | upsert ⊆ create ∧ update                       |
  | `import`      | `create`, `update`   | import ⊆ create ∨ update (writeMode-precise)   |
  | `export`      | `list`               | export ⊆ list                                  |
  | `aggregate`   | `list`               | aggregate ⊆ list                               |
  | `search`      | `list`               | search ⊆ list ∧ `searchable`                   |
  | `history`     | `get`                | history ⊆ get ∧ `trackHistory`                 |
  | `restore`     | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |
  | `purge`       | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |

  Reporter codemod: `node scripts/codemod/apimethods-legacy-to-primitives.mjs`
  (scans, reports the exact replacement per site, and flags whitelists the
  mapping would WIDEN so the edit stays reviewable).

  **Stored metadata keeps parsing — permanent tolerance, narrowing only.** Real
  metadata does not upgrade in lockstep with the spec, so a stored legacy value
  is NOT a parse error: `stripLegacyApiMethods` (new export) strips it with a
  FROM→TO warning (canonicalize-and-warn). Stripping only ever NARROWS exposure —
  the derivation table still grants every legacy verb that derives from the
  primitives you declared. Two cliffs to know:

  1. A whitelist of ONLY legacy values (e.g. `['upsert']`) strips to `[]` =
     **deny-all** — the object's API closes instead of widening. The strip
     warning and the objectql registration diagnostic both call this out.
  2. A legacy value NOT derivable from your declared primitives (e.g.
     `['get', 'export']` — export needs `list`) was honored by the P1
     "explicit wins" path and is now denied. Declare the underlying primitive.

  **Type split — authored vs effective vocabulary.** `ApiMethod` (authored) is
  now six values; the NEW `ApiOperation` type / `ApiOperationSchema` /
  `API_OPERATION_ORDER` (fourteen values, byte-stable pre-shrink wire order)
  carry the EFFECTIVE vocabulary. The wire contract is unchanged: the 405
  `allowed` array and `/me/permissions` `apiOperations` still serialize derived
  verbs (`export`, `search`, …), and `EffectiveObjectPermissionSchema.apiOperations`
  now validates against `ApiOperationSchema`. `EffectiveApiMethods.explicitLegacy`
  is removed (nothing is honored verbatim anymore); `API_METHOD_ORDER` remains as
  a deprecated alias of `API_OPERATION_ORDER`.

  **Fail-closed tightening (#3545):** a PRESENT but non-array `apiMethods` (only
  producible by a raw/out-of-band metadata write) now resolves to `deny-all`
  instead of unrestricted — a policy that exists but cannot be read fails CLOSED.

  **Published JSON Schema diverges deliberately:** `data/ApiMethod.json` is the
  strict six-value enum (a `z.preprocess` is not representable in JSON Schema),
  so external JSON-Schema validators reject legacy values that the zod parse
  would strip-and-warn. Treat the JSON Schema as the authored contract; the zod
  tolerance exists for stored metadata.

  **objectql:** the P1 "explicit wins" transition is reclaimed —
  `warnDeprecatedExplicitApiMethods` is replaced by `warnStrippedLegacyApiMethods`
  (a permanent per-object diagnostic for schemas that reach the registry without
  passing through Zod; the parse-time strip warning carries no object name).

  **platform-objects:** whitelist audit — `sys_business_unit`,
  `sys_business_unit_member` (P1's explicit `import`/`export` reclaimed) and
  `sys_user_preference` dropped their `apiMethods` entirely (each named all six
  primitives = default-open). Read-only and deny-all whitelists are unchanged;
  the seven `[]` declarations are deliberately KEPT as defense-in-depth alongside
  `apiEnabled: false`.

  <!-- adr-0087: registered apimethod-enum-shrink -->

- f1cc3a3: fix(spec): stop offering retired `app` keys in the metadata form, and make the reconciliation gate see tombstones (#5280)

  The `app` authoring form rendered **eight** controls for keys `AppSchema` had
  already retired to `retiredKey()` tombstones in 17.0.0 — `version`, `homePageId`,
  `objects`, `apis`, `sharing`, `embed`, `mobileNavigation` and `aria`. A tombstone
  is `z.never().optional()`, so filling one of those controls did not lose the
  value quietly: it failed the **entire save** with the key's removal
  prescription. The controls are gone, each with a comment in place naming where
  the capability went (`manifest.version`; the first `navigation` item by `order`
  plus `isDefault`; `defineStack({ objects })`; `defineStack({ apis })`;
  `FormView.sharing` for both public access and embedding; the component that
  renders the DOM node for `aria`).

  Nothing about the contract changes — every one of these keys was already
  rejected at parse. What changes is that an author is no longer shown a control
  that can only produce a 422.

  **The reconciliation gate now judges the right thing.** #3786's
  `metadata-form-zod-reconciliation.test.ts` asked whether an offered key was
  `∈ shape`. That was the same question as "may the author write this" until
  `retiredKey()` existed: a tombstone **deliberately stays in the shape** so the
  removal can carry its own upgrade prescription, so every one of those eight keys
  read as "the Zod accepts it" and the gate stayed green over all of them. It now
  asserts `∈ shape` **and not a tombstone**, in both directions — a retired key
  may not be offered, and its absence needs no ledger entry to excuse it. The
  detector reads the schema node (`z.never()` under the optional wrapper), never a
  list of key names, mirroring `isRetired()` on the JSON-Schema side of
  `build-schemas.ts`. The next `retiredKey()` retirement that forgets a form now
  fails this test instead of reaching an author.

  Retiring an authorable key already required pruning its form input; that step is
  now enforced rather than remembered.

- 09e4547: feat(spec)!: reject unknown keys across the app shell and navigation tree (#4001 app step, PR B)

  Closes the last high-traffic authorable surface in the unknown-key strictness
  ratchet (flow + permission #4071, RLS / sharing / position #4099, approval
  #4119, App dead-key tombstones #4142). The app shell is the densest
  hand-authored surface on the platform — a navigation tree is where an author
  or AI is most likely to write a key from memory — so a silent strip here was
  the most probable instance of the #3405 trap.

  - **`AppSchema`** and its sub-schemas (`AppBrandingSchema`,
    `NavigationAreaSchema`, `AppContextSelectorSchema` + its `optionsSource` /
    `filter` blocks, `NavigationContributionSchema`) are `.strict()`.
  - **`NavigationItemSchema` becomes a DISCRIMINATED union on `type`.** This is
    what makes strict readable: a plain union of strict members answers one
    unknown key with an `invalid_union` aggregate naming all nine branches,
    while discriminating on `type` first yields a single `unrecognized_keys`
    issue against the branch the author actually wrote — at an exact path
    through nested `children` — and a mistyped `type` gets its own "Invalid
    discriminator value". Each variant carries its own suggestion pool, so a
    `url` item is never told about `dashboardName`.
  - **Still OPEN by design:** `PageNavItem.params`, `ComponentNavItem.params`
    and `ActionNavItem.actionDef.params` — per-target payloads owned by the
    page / component / action, not by the nav item.

  **A real defect the gate caught, in the platform's own app:** `ACCOUNT_APP`
  declared `defaultOpen` on three navigation groups. That was never a schema
  key — `expanded` is — so all three shipped COLLAPSED while their author
  believed they opened by default. Fixed at the producer (contract-first) and
  `defaultOpen` / `open` / `collapsed` / `isOpen` now alias to `expanded`.

  **Migration.** Any key now rejected was previously stripped and had no
  runtime effect. The error carries the fix; mappings include
  `menu`/`sidebar`/`tabs`/`items` → `navigation`, `title` → `label`,
  `permissions` → `requiredPermissions`, `sort`/`position` → `order`,
  `defaultOpen` → `expanded`, `args` → `params` (actionDef), `primary` →
  `primaryColor`, `url` → `endpoint` (options source), plus wrong-layer
  pointers: `pages`/`views`/`flows` are not App fields, and a payload named on
  the wrong variant points at the `type` that owns it.

  The `visibleWhen` → `visible` alias is the load-bearing one: ADR-0089 made
  `visibleWhen` canonical on view/page schemas, so an author who learned it
  there would silently lose a nav entry's visibility gate — a capability gate
  failing open, the worst shape of the silent-strip bug.

- bc17d39: fix(auth): provision the better-auth 1.7 columns `sys_team` / `sys_team_member` / `sys_two_factor` were missing (#3624)

  better-auth 1.7.0-rc.1 added fields to three models that the platform objects
  never provisioned and `auth-schema-config.ts` never mapped. Because an unmapped
  field keeps its camelCase name, the adapter emitted columns no table had:

  | model        | field                                     | column now provisioned                                      |
  | :----------- | :---------------------------------------- | :---------------------------------------------------------- |
  | `team`       | `memberCount`                             | `sys_team.member_count`                                     |
  | `teamMember` | `membershipKey`                           | `sys_team_member.membership_key`                            |
  | `twoFactor`  | `failedVerificationCount` / `lockedUntil` | `sys_two_factor.failed_verification_count` / `locked_until` |

  The team pair broke org creation outright. The organization plugin's team
  sub-feature is on by default, so `POST /api/v1/auth/organization/create`
  auto-creates a default team — and that insert died with `table sys_team has no
column named memberCount` _after_ the organization row had already committed.
  Callers got an HTTP 500 on top of a half-created org: a real org row with no
  default team behind it. Every multi-org deployment's create-org flow hit this.

  The two-factor pair broke the 2FA lockout path the same way: better-auth
  guard-increments `failedVerificationCount` on each wrong code and stamps
  `lockedUntil` past the threshold, so a wrong code 500'd instead of being
  counted. All four columns are better-auth's own state — provisioned, readable,
  and never written from the ObjectStack side.

  Existing environments pick the columns up through the driver's additive schema
  sync; no data migration is needed. `member_count` backfills to 0 and
  better-auth's own `syncTeamMemberCount` reconciles it on the next membership
  change, and `membership_key` stays null on pre-upgrade rows, which better-auth
  tolerates by falling back to the `(team_id, user_id)` pair.

  A new drift gate (`better-auth-schema-parity.test.ts`) now asserts that every
  column the installed better-auth version can write exists on the platform
  object backing it, across the auth manager's whole model surface. The ADR-0092
  D7 guard only ever caught _collisions_ between our extension fields and
  better-auth's, so a bump that adds a brand-new field passed the build and failed
  at runtime — twice now, counting the 1.7 `oauthAccessToken.authorizationCodeId`
  regression. The next one fails the build instead.

- 37785ed: docs: fix `business_unit` sharing-rule docstrings that still attributed the BU subtree expansion to the narrow recipient (#8098)

  #7807 (PR #8097, `9b519815`) narrowed the `business_unit` sharing-rule
  recipient to expand exactly one unit's members, moving the subtree walk onto
  `unit_and_subordinates`. Two docstrings never got the memo:
  `IBusinessUnitGraphService` in `packages/spec/src/contracts/sharing-service.ts`
  and the `sys_business_unit` object definition in
  `packages/platform-objects/src/identity/sys-business-unit.object.ts`. Both
  still said `recipient_type='business_unit'` sharing rules were driven by the
  subtree walk. Both now name `unit_and_subordinates` as the subtree consumer,
  with `business_unit` as the narrow (single-unit) one.

  These are comment-only corrections — the `IBusinessUnitGraphService`
  docstring surfaces in `@objectstack/spec`'s built `dist/**/*.d.ts` hover, and
  the `sys_business_unit` docstring surfaces in
  `@objectstack/platform-objects`'s built `dist/**/*.d.ts` hover; no runtime or
  authoring behaviour changes.

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

- eda599e: fix(platform-objects): 超预算后台 seed 期间不再空库自证 —— 一次启动不再跑两套契约

  #4769 已把 ADR-0104 的空库自证从 `kernel:ready` 挪到 `app:seeded`(本次启动自身数据的结算点),但保留 `kernel:ready` 作为「从不 seed 的内核」的兜底。剩下的窗口是这两个钩子**到达顺序可以颠倒**:`AppPlugin` 的 inline seed 超出软预算(`OS_INLINE_SEED_BUDGET_MS`,默认 8s)后转入后台,于是 `kernel:ready` 先到、兜底自证在 seed 仍在写的时候签发证书并把闸门翻到 strict——同一次 seed 运行的后半段撞上前半段从未见过的契约。showcase 冷启(`OS_INLINE_SEED_BUDGET_MS=1`)实测:自证发生在 +0.470s,seed 结算在 +3.617s,窗口 3.147s。

  现在两个钩子都先问一句「本次启动自己的 seed 落定了吗」,任一处报告仍有未结算的 seed 源就不签发。`app:seeded` 同样受这道检查约束——多 config app 的 bundle 会每个 app 触发一次,第一次并不是本次启动的结算点。

  新增 `seed-settlement` 契约(`@objectstack/spec/contracts`)承载这个信号,而不是让 platform-objects 去嗅 runtime 内部的 `seed-datasets` 服务:那个数组的存在只能说明「seed 源存在」,永远说明不了「已经落定」,而这两件事之间的差正是本 bug 的整个窗口。runtime 在选择分支之前先声明 seed 源,并在写入真正结束的同一刻结算它。

  **multi-tenant 与 `skipSeedData` 的 ADR-0104 姿态(2026-08-06 裁定,#4795)**:这两种部署会注册 seed 数据但在启动时并不写入(前者按 org 在 `sys_organization` insert 时重放,后者是 `os migrate` 的只读规划启动,#3917),`app:seeded` 永不触发。它们的姿态是**启动时不自证,等 `os migrate … --apply` 在真实扫描的证据上落笔**——由同一个判据自然得出,不需要单独分支。这是答案而不是缺口:在启动那一刻断言一次尚未发生的 per-org 重放不含违规值,正是 #4769 的同一个错误、只是引信更长;而停在 warn-first 是可恢复的方向,随时可由 `os migrate value-shapes --apply` / `os migrate files-to-references --apply` 关闭。

  `@objectstack/objectql` 侧只更新了 #4769 撤销机制的注释:「后台 seed 收尾晚于签发」不再是它要兜的场景(已在源头关闭),它对 `os dev` 热重载 seeder、运行期 marketplace 安装以及 lax 开关仍然有效。

- e59786e: fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

  A recursive Zod schema needs an explicit annotation to break its circular
  inference, and five of them took the cheapest one available:

  ```ts
  export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
  export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
  ```

  It compiles, it validates correctly at runtime, and it silently throws the type
  away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
  `any` on the published surface, plus `FieldNodeSchema` — which had no exported
  type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
  `QueryAST['fields']` with it.

  That is worse than a missing export. #4115 tells every consumer that a local
  declaration under a spec export's name must be replaced by a binding to the
  spec — and for these, obeying it **replaced a precise type with `any`**.
  objectui's `NavigationItem` is a 118-line documented interface (`recordId`
  template variables, `requiresObject` / `requiresService` capability gates,
  `filters` precedence); every key of it exists in the spec's version, so by every
  available signal it read as a redundant fork safe to delete. Deleting it swapped
  a fully-typed interface for `any`, with no compile error anywhere to say so.

  It is hard to catch by inspection because `any` is mutually assignable with
  everything, so the natural "are these the same type?" check answers _yes_ in both
  directions and recommends precisely the wrong action. Same failure family as
  #4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
  reads as agreement.

  **Now annotated with the real type**, using the pattern `QueryAST` already
  follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
  knot in the type, so the keys stay derived from the schema instead of being
  hand-maintained beside it:

  ```ts
  const BaseXSchema = z.object({ …every non-recursive key });
  export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
  export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
    children: z.array(XSchema).optional(),
  }));
  ```

  `z.infer` now resolves to the type it should always have been: `NavigationItem`
  is the nine-branch discriminated union, `FormField` the 30-key form-field
  contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
  `visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
  the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
  validation is unchanged: every schema parses exactly what it parsed before.

  **What the types immediately caught**, none of it visible while they were `any`:

  - `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
    never declared. It worked only because objectui's `NavigationRenderer` still
    falls back to that legacy alias. Fixed at the producer per Prime Directive
    #12: the canonical key is `expanded`.
  - The MongoDB driver built its projection with `projection[field] = 1` over
    `query.fields`, so a relationship `FieldNode` would have keyed the projection
    on `"[object Object]"`. It now reads the node's field name.
  - `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
    with the PARSED `App` / `NavigationContribution` types but omitted
    `.default()`ed keys (`expanded`, `target`), as did the form fields
    `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
    default it was relying on, matching what the surrounding literals already do
    for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

  **Gated, not just fixed** (`check:exported-any`, wired into the required
  `TypeScript Type Check` job). `api-surface.json` records that an export _exists_
  and never what it _resolves to_, which is how these survived a whole major with
  every gate green. The new scan reads the built `.d.ts` a consumer's import
  actually resolves to and fails on any exported type that resolves to `any` — or
  any exported schema whose output is `any`, the root cause, and the only reason
  `FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
  currently empty. It self-tests against the real zod first, so if the internals it
  reads are ever renamed the gate fails loudly instead of quietly passing
  everything forever.

- 524151c: fix(i18n): clear the accumulated drift in the generated translation bundles

  The committed bundles had fallen behind the spec on three independent axes.
  `os i18n extract` (merge mode — every existing translation is preserved)
  reconciles all of them:

  **Keys the spec no longer has**, still carrying translations in
  `*.metadata-forms.generated.ts`. All three were removed deliberately and are
  now _rejected_ by the schema, so their entries were dead weight:

  - `capabilities.trash` / `capabilities.mru` — `enable.trash`/`enable.mru`
    retired in the 16.x line (#2377), with tombstone guidance in
    `UNKNOWN_KEY_GUIDANCE`.
  - agent `visibility` — removed 2026-07 (#1901).

  **Keys the spec gained** but the bundles never learned: the
  `summaryOperations.*` sub-fields (`object` / `function` / `field` /
  `relationshipField` / `filter`), and `sys_invitation.business_unit_id` /
  `positions` from the ADR-0105 D8 placement work.

  **Objects stuck on empty strings.** `sys_migration`'s labels and help text were
  committed as `""` in the ja-JP and es-ES bundles, which renders as _blank_ in
  those locales rather than falling back to anything readable. They now carry the
  schema text like every other untranslated key.

  No API or schema change — this only affects what the UI displays.

- 8af76ae: The i18n extractor's default locale now tracks the source instead of merging (#8543), and the approval vocabularies carry authored English labels in the contract (#8580).

  - `os i18n extract` merge mode no longer applies to the default locale: `en` is a copy of the source, not a translation, so an edited label/description/help now reaches the regenerated `en` bundle instead of being silently shadowed by the stale entry forever (53 stale entries had accumulated across 6 packages under the old behavior; all rewritten here). Translated locales (`zh-CN` / `ja-JP` / `es-ES`) keep merge semantics exactly as before — no existing translation is overwritten.
  - Bare-string and label-less select options now seed through the extractor's derived channel: the machine value still seeds the skeleton, but the coverage gate no longer demands "translations" of machine identifiers, and a copied value can no longer masquerade as authored display text.
  - New `@objectstack/spec/contracts` exports `APPROVAL_STATUS_LABELS` and `APPROVAL_ACTION_KIND_LABELS`: the authored English for `sys_approval_request.status` (previously living only in the generated `en` bundle) and `sys_approval_action.action` (previously shipping raw machine values such as `submit` / `request_info` — the #7232 humanization missed this sibling field). Both columns derive their option labels from these maps; the regenerated `en` bundles copy them verbatim.

- d1cabaa: fix(i18n): translate the SSO / SCIM / user-position / import-job admin objects

  Four live, UI-facing system objects were registered but never added to their
  package's i18n extract config, so non-English admins saw raw English `label`
  metadata:

  - `sys_sso_provider`, `sys_scim_provider` (platform-objects) — identity-provider
    admin grids plus the register / verify-domain actions.
  - `sys_user_position` (plugin-security) — delegated position assignment
    (`userActions` create/edit/delete); its sibling `sys_user_permission_set` was
    already translated, so this closes an inconsistency.
  - `sys_import_job` (platform-objects) — import history / progress, alongside the
    already-translated `sys_job` / `sys_job_run`.

  Adds each object to its package's `scripts/i18n-extract.config.ts` and supplies
  real zh-CN / ja-JP / es-ES translations across all four locale bundles, and
  extends the bundle-ownership guards' `OWNED_OBJECTS` to cover them. The
  orphan-only guards from #3502 could not catch this "owned-and-live-but-never-
  extracted" gap.

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

- 4c5e80e: feat(spec): `internal: true` — a field whose value is never returned on the generic data path, applied to `sys_api_key.key` (#7728)

  <!-- adr-0087: not-required (no-migration-prescription) Purely additive: one new
  optional field-level key. Nothing is renamed, retired or tombstoned, so there is
  no conversion to register and no consumer action to prescribe. The only
  behavioural change is that a field which already DECLARED it was never exposed
  stops being exposed. -->

  `sys_api_key.key` — the stored **SHA-256 hash** of an API key — declared
  `description: 'Hashed API key value — never exposed to clients'` and then
  serialized anyway. Measured on a real engine at `origin/main`, the hash came back
  on **four** surfaces: get-by-id, list, an explicit `?select=id,key` projection,
  and the `PATCH` 200 body.

  `hidden: true` was not the broken contract — spec defines `hidden` as "Hidden
  from default UI", never as "stripped from serialization". The broken contract was
  the field's own description, and there was no mechanism to honour it.

  **Why no existing mechanism fit.** ADR-0100 names three credential channels, and
  the third — the auth subsystem's one-way hashes, which live in ordinary `text`
  columns — had no read protection at all. The engine's credential mask collects by
  field **TYPE** (`collectMaskedReadFields` walks for `secret` / `password`), so a
  `text` column is collected by nothing, _regardless_ of `managedBy`; the
  better-auth exemption is the second barrier, not the first. Retyping is not
  available either: `Field.secret` encrypts at rest and replaces the column with a
  `sys_secret` ref, which destroys the `where: { key: hashApiKey(raw) }` lookup the
  API-key verifier depends on — it would break authentication in order to fix a
  disclosure — and `Field.password` is defined as _plaintext at rest_, which a
  one-way hash is not, so adopting it would swap one false declaration for another.

  **The new flag.** `internal: true` is an opt-in, type-independent field
  declaration meaning _the declared value is never returned on the generic data
  path_. The engine omits the key from the rows it hands back at the four post-hook
  positions the `__search` companion strip (#7642) already occupies: `find`,
  `findOne`, the 201 create body and the by-id update body.

  **Omission, not masking.** The credential mask signals "a value is set" without
  leaking it. `key` is `required: true`, so it is always set — the signal carries
  zero bits here, while still shipping a value under a field whose declaration
  promises none. Omitting also leaves the description string untouched, so the four
  generated translation bundles that mirror it do not churn.

  **`?select=` is closed by construction, and that half is load-bearing.** The strip
  acts on the result rows rather than on the projection, so a client that spells the
  column out gets a 200 without it. `select` only gates on whether a field is
  _known_, and a flagged column is known — a projection-aware strip would have
  shipped looking complete while leaking to anyone who named the column.

  **What is deliberately untouched**, because the flag would be unusable otherwise:
  storage and encryption; filtering and indexing, so the verifier's hash lookup
  still resolves a principal (the strip runs _after_ the driver has evaluated the
  predicate); and the show-once mint path — `POST /api/v1/keys` still returns the
  raw secret exactly once at creation.

  Unlike its sibling `stripSearchCompanionFromRead`, this strip has **no
  system-caller carve-out**. That one keeps the `__search` column for a system
  reader that names it by projection, because it has such a reader whose backfill
  would otherwise rewrite every row on every run. This flag has none: the verifier
  uses the column as a filter and never reads it off the result, and the mint path
  returns the plaintext it generated rather than the row it inserted. An escape
  hatch nobody needs is a hole in a non-exposure guarantee.

  Scope is one declaration site. `sys_session.token` is tracked separately as #7823
  and `sys_account.password` is a later card; neither is adopted here.

- 4b5702a: fix(spec,platform-objects): `InvitationStatus` accepts `canceled`, the value cancel-invitation actually writes (#7726)

  The spec's `InvitationStatus` enum listed four values —
  `pending | accepted | rejected | expired` — while the platform shipped a fifth.
  `POST /api/v1/auth/organization/cancel-invitation` (better-auth's organization
  plugin) writes `status: 'canceled'` onto the `sys_invitation` row, and
  `sys_invitation` declared that value in its own select and filtered on it in its
  "Expired / Canceled" listView. So an invitation the platform had just canceled
  through its own UI failed validation against `InvitationSchema`, which composes
  the enum.

  **The enum now accepts `canceled`.** This is a widening that reconciles the
  contract to shipped behaviour rather than a new capability: the writer, the
  route, the object's action and the listView all predate this change. Consumers
  gain a value; none lose one. Nothing in the repo branches exhaustively over
  `InvitationStatus`, so no consumer is broken by the fifth member — an
  out-of-vocabulary value is still refused exactly as before.

  The vocabulary is the union of two upstreams, and the two halves come from
  different places: better-auth contributes `canceled` and has no notion of
  expiry, while `expired` is ObjectStack's own (driven by `expiresAt`). That is
  why the divergence was possible at all.

  **The two definitions are now bound.** `sys_invitation.status` reads its select
  options from `InvitationStatus` instead of repeating them as a literal — the
  same shape the neighbouring `role` field already uses for the membership-role
  vocabulary — and a parity test compares the object's declared options against
  the enum, so a future divergence lands as a red test instead of as a row the
  contract rejects.

- 1b9a53b: plugin-email: large attachments (>256 KiB) now get durable queue delivery, with their content held out of the `sys_email` row

  A message whose attachments exceeded the in-row budget was pushed back onto inline delivery — whole, but with none of the durability queue delivery exists to provide, which meant the platform was weakest about exactly the mail that matters most (a signed contract, an exported report). Its content now goes to the `file-storage` capability, the row records a `storageKey` plus the audit metadata, and the queue worker fetches the content back to rebuild the message.

  - **Zero migration.** `attachments_json` declared `storageKey` from the start; this adds the producer and the reader. Attachments at or under `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` still go in the row exactly as before, and the boundary includes equality.
  - **The row stays an audit log, not a blob store.** `filename` / `contentType` / `size` / `hash` stay on the row permanently; the content is a delivery artifact and is deleted a grace window (24h) after the row reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`. Reclamation is a delayed `email.attachment.reclaim` queue job that carries the storage keys, so a row deleted in the meantime reclaims its content instead of orphaning it.
  - **Nothing degrades silently.** No `file-storage` capability, or an upload that fails, keeps today's behaviour — inline delivery of the whole message — and says which of the two it was and how to fix it. On the way back, content that cannot be fetched (outage, missing object, no capability on the worker, truncated or substituted bytes) fails the row loudly; a message is never delivered without an attachment it declares.

- 5966c2a: feat(spec)!: retire the five keys the advisory lint could never have warned about — mapping `extractQuery`/`errorPolicy`/`batchSize`, contextSelector `includeAll`/`placement` (#4509)

  Five authorable keys parsed, stored, and controlled nothing. What groups them is
  not the type they sit on but **why they had to go out in a major rather than
  after a deprecation cycle**: four of the five carry schema DEFAULTS, and a
  default materialises at parse time — so the liveness advisory lint cannot tell a
  value the author wrote from one the schema supplied. Marking them would have
  warned on every mapping and every selector in existence, which is why the ledger
  recorded them as `_authorWarnSkipped` instead. For a key in that state, removal
  is not the escalation after a warning. It is the only channel that ever reaches
  the author.

  **The retirement kit:**

  | FROM                                | TO          | Fix                                                                                                                                            |
  | ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | `mapping.extractQuery`              | _(removed)_ | Delete the key. Exports run through the ordinary query API (`POST /api/v1/data/:object/query`) — no exporter has ever read a mapping artifact. |
  | `mapping.errorPolicy`               | _(removed)_ | Delete the key. Error handling on the import path belongs to the import REQUEST's own options, not the stored mapping.                         |
  | `mapping.batchSize`                 | _(removed)_ | Delete the key. The write path sizes its own batches. **Do not relocate the value** — see below.                                               |
  | `app.contextSelectors[].includeAll` | _(removed)_ | Delete the key. Selectors are mandatory-scope; widen `optionsSource.filter` to widen the choices.                                              |
  | `app.contextSelectors[].placement`  | _(removed)_ | Delete the key. Selectors always render in the sidebar header; `'topbar'` placed nothing.                                                      |

  Run `os migrate meta --from 16` to rewrite existing sources automatically.

  **`includeAll` is the one worth reading twice.** It was not unread — it was
  deliberately _disobeyed_, and for a security reason. A context selector is a
  mandatory scope, so an "All" row would clear the scope on a surface that exists
  to be scoped; on Studio's package selector that means listing the platform's own
  system/cloud kernel packages to a developer who scoped to their own package. The
  renderer never offered an All row regardless of the flag, so `includeAll: false`
  hardened nothing and `includeAll: true` unlocked nothing. `STUDIO_APP` shipped
  authoring `includeAll: true` against a renderer that ignored it — that authoring
  site goes with the key in this change.

  **`batchSize` deliberately offers no rename.** `bulkActionDef.batchSize`,
  `connector.batchSize`, `sync.batchSize`, `offline.batchSize`, the seed loader's
  and the NoSQL driver cursor's are all LIVE and enforced — but each is a
  different key on a different type sizing its own path, and none of them sizes a
  mapping import. The rejection says so explicitly, because "removed" plus a
  familiar name one line away is exactly how a dead setting gets laundered into a
  live-looking one. Same trap `datasource.retryPolicy` had to defuse against
  `hook`/`job` `retryPolicy` (which spell the delay `backoffMs`) one issue
  earlier.

  Both schemas are `.strict()`, so the keys are deleted from the shape and
  rejected with a `guidance` prescription rather than tombstoned; their liveness
  rows are deleted rather than kept. The retired ALIAS spellings (`query`,
  `onError`, `errorHandling`, `errorMode`, `batch`, `chunkSize`, `skipErrors`,
  `showall`, `location`) route to the same prescriptions instead of suggesting a
  rename onto a key that is also gone.

  Registered as the ADR-0087 D2 conversion `mapping-inert-keys-removed` and an
  extension of `app-dead-authoring-keys-removed`, both wired into the protocol-17
  D3 chain step. The mapping conversion is scoped to the `mappings` collection
  deliberately — a stack-wide strip would delete an enforced `batchSize` from
  connector, sync, bulk-action and offline shapes.

  `datasource` reached zero dead keys in #4583; `mapping` reaches zero here.

- 59c544d: **`member_default`'s removed wildcard was still named as live fact, and two D7 dogfood denials had gone vacuous (#6964).**

  #5491 (PR #6684) removed `member_default`'s plain `'*'` object grant and ADR-0095
  D1 retired its wildcard `tenant_isolation` RLS policy. Six live sites outside the
  two surfaces PR #6958 already fixed still asserted one of those two facts as
  current, and — the reason this is not only prose — two dogfood tests rested their
  whole evidential claim on the first one.

  **Prose (`platform-objects`, `qa/dogfood`, published docs).** The
  `requiredPermissions` gates on `sys_scim_provider` and `sys_sso_provider`
  justified themselves by an exposure that no longer exists, which invites the next
  reader to conclude the gates are redundant. They are not: `requiredPermissions`
  is a capability AND-gate evaluated _before_ the CRUD grant, so it denies
  regardless of how permissive any grant is — including one an app-declared profile
  or a customer-authored set names. `sys_sso_provider`'s `tenancy.enabled:false`
  and `rls-multitenant`'s investigation narrative are re-premised on the ADR-0095
  D1 Layer 0 tenant wall, which is what actually decides them now. And
  `content/docs/permissions/index.mdx` stated the retired wildcard
  `tenant_isolation` policy as shipped behaviour, contradicting
  `releases/implementation-status.mdx` in the same repo; the doc now matches the
  status page.

  **The defect.** `showcase-default-profile` and `showcase-d7-default-profile`
  proved ADR-0056 D7 with `expect(status).not.toBe(200)` on an app object,
  justified by "`member_default` has a wildcard grant → would be 200". With the
  wildcard gone that baseline grants nothing on app objects, so the denial became
  the trivially expected outcome and the assertion passed _because nothing is
  produced_ — it could no longer tell "the declared default is in force" from "no
  default is in force at all", which is the one thing those files exist to tell.
  Measured on a live showcase boot, one fresh sign-up per wiring: under the
  built-in baseline `showcase_private_note` and `showcase_contact` are **403**,
  exactly as under the declared default.

  Both denial cases are replaced wholesale rather than re-worded, with an object
  only the built-in baseline grants (`sys_user_preference`): 200 if and only if
  `member_default` governs. The same run settles the risk that would have killed
  that idea — a named `fallbackPermissionSet` **replaces** `member_default` rather
  than merging additively on top of it. Reverse-verified: stripping the declared-
  default wiring turns the new case red (200) and the positive case red (403),
  while the deleted cases stay green — the vacuity, demonstrated directly.

  No runtime behaviour changes.

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

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- e7a7506: Fix `POST /api/v1/auth/admin/remove-user`, which could never succeed and left the identity un-authenticatable when it failed.

  Three compounding problems on the better-auth admin removal path:

  - **`sys_member.user_id` declared no `deleteBehavior`.** A `lookup` defaults to `set_null`, and the engine escalates a defaulted `set_null` on a REQUIRED foreign key to `restrict` — so the membership every user gets at sign-up (and, since the invitation-adoption change, keeps after accepting an invitation) vetoed every `sys_user` delete. The field now declares `deleteBehavior: 'cascade'`. The last-administrator invariant is unaffected: it is enforced by a `beforeDelete` hook on `sys_member`, and the engine's cascade recurses through the public `delete()`, so that hook still runs.
  - **The removal was not atomic.** better-auth deletes the sessions, then the accounts, then the user, in three calls with no transaction, so anything refusing the last one left the credential rows deleted and the user row behind — an identity still on the org roster that can no longer sign in. Subject-erasure requests now run inside one engine transaction and roll back as a unit. Datasources whose driver has no transaction support keep the previous behaviour and log the engine's existing warning.
  - **A referential refusal reached the client as an HTTP 500 with an empty body.** The auth adapter mapped engine validation errors and policy refusals to better-auth `APIError`s but not referential ones, so a `DELETE_RESTRICTED` escaped unmapped. It now surfaces as a structured 409 carrying the dependent object, the dependent count and the remedy.

- 4921a95: fix(i18n): platform-objects' 231 untranslated strings were 1 — close the real gap and stop the phantom (#3762)

  Closes the rest of #3762. The remaining item was recorded as "platform-objects
  is 77 strings short per locale, in `apps.*` / `dashboards.*`, and its
  `--objects-only` extract cannot scaffold them — needs an emit decision (drop
  `--objects-only`, or a companion `.apps.generated.ts`) before any translating."

  Measured, the premise did not hold. Of the 77 declared keys per locale, **76
  were already translated** in the hand-authored `<locale>.ts` files and had been
  for months. Exactly one was genuinely missing —
  `apps.studio.navigation.nav_app_builder.label`, absent in all four locales
  including `en`. The 231 was a measurement artifact: this config declares
  SETUP_APP / STUDIO_APP / ACCOUNT_APP and SystemOverviewDashboard, but its
  `translations` merge baseline listed only the two GENERATED subtrees
  (`objects`, `metadataForms`), so coverage counted every hand-authored
  app/dashboard key as untranslated.

  **Neither proposed emit is right, and the second would have caused damage.**
  The Setup app is a shell of empty group anchors; its ~25 menu entries are
  contributed at runtime by `SETUP_NAV_CONTRIBUTIONS` and by capability plugins
  (ADR-0029 D7). A bundle generated from a static walk of `SETUP_APP` is
  therefore structurally incomplete, and regenerating over the hand-authored
  files would have **deleted 40 live nav translations per locale**. Dropping
  `--objects-only` fails differently: `kind: 'full'` folds all 803 metadata-form
  keys into `<locale>.objects.generated.ts` and renames the export the baseline
  imports.

  The split is correct as it stands and is now written down: `objects` /
  `metadataForms` are generated and gated by the bundle-drift check; `apps` /
  `dashboards` / `pages` are hand-authored and gated by the coverage ratchet.
  What was wrong was only that the baseline omitted the hand-authored half.

  - Extract config's `translations` now carries the per-locale assemblers, with
    `objects`/`metadataForms` still pinned to the committed generated files.
    Safe for the emit — `--objects-only` writes `data.objects` alone, so nothing
    added here can reach a generated bundle, and `check:i18n` stays in sync
    across all nine packages.
  - `nav_app_builder` translated in all four locales, wording taken from the
    repo's own precedent for "builder" (`构建器` / `ビルダー` / `generador`).
  - `nav_workflows` removed from all four: its menu entry is gone from
    `STUDIO_APP` and nothing contributes to that app, so the translation was
    dead.
  - Coverage ratchet baselined 231 → **0**, making platform-objects the ninth
    package where the ratchet is a strict gate — verified to go red on a single
    removed translation.
  - A local, CLI-independent parity test walks the statically declared Studio and
    Account navigation plus the dashboard's widgets and asserts a translation in
    every locale — and the reverse, that no translation survives its nav item.
    Both directions verified to fail before passing.

  An untranslated nav id is invisible in the UI — it falls back to the app's
  English label, so a Chinese Studio menu just shows one English entry among
  thirty. That is why this needed a gate rather than a one-time sweep.

  Still out of scope: the ~25 Setup entries contributed at runtime. Bringing them
  under a static gate needs either an objectql dependency in this package (it
  depends only on spec and metadata-core) or extractor support for
  `navigationContributions` — a real follow-up, not something to half-do here.

- d6938bf: fix(spec): the remaining six recursive schemas name both type parameters, and the authoring artifacts stop spelling out defaults (#4195)

  #4221 fixed `NavigationItemSchema` — the worst instance, and the one with a
  reproducible "`defineApp` compiles `navigation: [42, 'nonsense']`" demo. This
  finishes the sweep: **six more schemas** had the same shape, and the authoring
  artifacts that #4171 had to work around can now be typed honestly.

  `z.ZodType` takes `<Output, Input>` and `Input` defaults to `unknown`, so naming
  only the first parameter leaves `z.input` of anything embedding that schema at
  `unknown`. Measured with a type probe:

  |                                        | was         | now                       |
  | -------------------------------------- | ----------- | ------------------------- |
  | `QueryInput['joins']`                  | `unknown[]` | `JoinNodeInput[]`         |
  | `QueryInput['fields']`                 | `unknown[]` | `FieldNode[]`             |
  | `z.input<typeof FormFieldSchema>`      | `unknown`   | `FormFieldInput`          |
  | `z.input<typeof QuerySchema>`          | `unknown`   | `QueryInput`              |
  | `z.input<typeof StateNodeSchema>`      | `unknown`   | `StateNodeConfig`         |
  | `z.input<typeof ValidationRuleSchema>` | `unknown`   | `BaseValidationRuleShape` |

  New exported types: `FormFieldInput`, `JoinNodeInput`, `NavigationContributionInput`.
  `FilterCondition`, `NormalizedFilter` and `FieldNode` carry no `.default()` or
  `.transform()`, so their input is their output and the second parameter is the
  first.

  **The `z.ZodType<T>` single-parameter form is now absent from the codebase.**

  ## 26 hand-written defaults deleted

  This is the half #4221 left on the table. #4171 had to spell out
  `expanded: false` (×16) and `target: '_self'` (×10) across `setup.app.ts`,
  `studio.app.ts` and `setup-nav.contributions.ts`, because those artifacts are
  annotated with the PARSED type where a `.default()`ed key is required — and
  retyping them to the input surface would have traded eight loud errors for no
  checking at all.

  With `NavigationItemInput` landed (#4221) and `NavigationContributionInput`
  added here, they are annotated `AppInput` / `NavigationContributionInput`, the
  defaults are defaults again, and the literals are checked for the first time.
  Net across those four files: 21 lines added, 54 removed.

  Verified live, not nominal: a literal omitting `expanded`/`target` compiles, and
  one writing `defaultOpen` — the non-spec key #4171 found in `account.app.ts` —
  is a compile error whose suggestion list names `expanded`.

  ## Two typed with a documented caveat

  `StateNodeSchema` and `ValidationRuleSchema` reuse their hand-written type for
  both parameters: exact on the input side, loose on the output side.
  `StateNodeConfig` marks `type` optional though `.default('atomic')` makes it
  always present; `BaseValidationRuleShape` carries a `[key: string]: unknown`
  index signature. Both were already that loose — input went from `unknown` (types
  nothing) to a real type, output is untouched. Making them exact means deriving
  those types from their schemas instead of maintaining them beside one, which is
  separate work; the caveat is written at each declaration rather than left for a
  reader to find.

  ## Why there is still no CI gate for this

  Worth recording, since #4195 proposed one: extend `check:exported-any` to fail on
  "output precise but input `unknown`". Measured after this change — exactly two
  schemas match, `TranslationItemSchema` and `InlineActionSchema`, and **both are
  correct**: they are `z.preprocess(...)`, where an `unknown` input is zod's
  semantics rather than a missing annotation. Separating those from a genuinely
  missing parameter needs heuristics on emitted type names, and per the rule in
  that script's own header — zero false positives, so red keeps meaning broken — a
  gate that cannot be made reliable is worse than none. #4221's
  `app.nav-type-assertions.ts` is the better pattern where it applies: pin the
  contract at compile level rather than infer intent from shape.

- 5487c20: fix(auth): provision `sys_scim_provider.provider_key` — SCIM provider creation failed the moment SCIM was switched on (#3653)

  `@better-auth/scim` declares `providerKey` as `required: true, unique: true`
  and writes it on every provider insert — a derived `<organization>:<provider_id>`
  uniqueness key it owns end to end. `sys_scim_provider` never provisioned the
  column, so the adapter emitted a `provider_key` no table had: the same failure
  shape as #3624, waiting behind the `OS_SCIM_ENABLED` flag.

  Found by extending the better-auth parity gate to `@better-auth/sso` and
  `@better-auth/scim`. Neither accepts a `schema` option, so `getAuthTables()` is
  blind to them and they were excluded when that gate shipped; the gate now reads
  each plugin's own declared schema and resolves columns the way the adapter
  actually does for a bridged model. `@better-auth/sso` came back fully covered.

  Existing environments pick the column up through the driver's additive schema
  sync; it stays null on pre-upgrade rows, which the nullable UNIQUE index admits.

- 3f296bf: fix(plugin-auth,platform-objects): record the `admin` cause an interactive session revoke never could (#7732)

  `sys_session.revoked_at` / `revoke_reason` are declared `readonly` and
  documented "System-managed", and `revoked_at`'s description names all four
  causes they capture: _idle / absolute-max / concurrent-cap / admin_ (ADR-0069
  D4). Three of them worked — `enforceSessionControls` and `enforceConcurrentCap`
  expire the row in place and stamp both columns. The fourth could not: an
  admin or user-initiated revoke reaches better-auth's `deleteSession` /
  `deleteUserSessions`, which **delete the row**, and a deleted row carries no
  `revoke_reason`. The audit trail was inert for the single cause an audit most
  wants.

  **What changes.** An interactive revoke now ends the session by stamping it
  rather than deleting it — the same shape the automatic path already writes
  (`expires_at` into the past plus both columns). Five endpoints are covered:
  `POST /revoke-session`, `/revoke-sessions`, `/revoke-other-sessions`,
  `/admin/revoke-user-session` and `/admin/revoke-user-sessions`. Self-service
  revocations record `revoke_reason: 'user_revoked'` and the two admin routes
  record `'admin'`, because the column is the only thing in the row that says who
  ended the session and recording `admin` for a user signing out their own other
  device would be a _wrong_ audit record rather than a vague one.

  The substitution happens at the better-auth → ObjectQL adapter, so better-auth's
  whole session-delete hook lifecycle still runs — **OIDC back-channel logout
  still fires on a revoke**. `sys_session`'s field declarations are unchanged.

  **Revoked rows are also retained.** better-auth's one expiry-driven collector
  (inside `GET /get-session`) would otherwise delete the new tombstone the moment
  the revoked client next polled, leaving the trail exactly as inert as before —
  which is why the automatic path's stamps were already best-effort. A revoked
  row is now invisible to better-auth's own session reads, so that collector never
  sees it. The revoked session therefore stops authenticating _harder_ than before
  (`findSession` answers nothing at all, rather than answering an expired row),
  and its record survives. User-deletion routes still see and physically remove
  these rows: erasing a user erases their sessions.

  **Behaviour worth knowing about:** a revoked session no longer disappears from
  the database. The `My Sessions` and `All` views on `sys_session` filter revoked
  rows out, so the Sessions list looks exactly as it did; a new **Revoked** view
  exposes `revoked_at` / `revoke_reason` for auditing. There is no retention
  window or sweeper for `sys_session` — revoked rows are kept indefinitely, the
  same way a session abandoned without signing out already was.

  A normal sign-out is untouched: it still deletes the row and writes no
  `revoke_reason`. Signing yourself out is not a revocation, and whether it earns
  an audit record is a separate open question (#7675).

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

- d42a92f: chore(platform-objects): drop four dead `apps.setup.navigation` translation keys (#6660)

  Four ids kept a Setup nav label in the hand-written locale bundles long after
  the nav item that declared them was removed. No composition renders them, so
  nothing was broken — but a translated key with no declaring nav item is the
  shape `app-nav-translation-parity.test.ts` already refuses for Studio: it reads
  as coverage. `nav_workflows` outlived its Studio menu entry in all four locales
  the same way, and nothing said so until that reverse assertion was written.

  Removed, with the reason each one is gone:

  | id                       | why it has no nav item                                                                                                                 |
  | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
  | `nav_approval_processes` | the approval process engine was retired in favour of the approval flow node (#1408, ADR-0019 P4/P5)                                    |
  | `nav_verifications`      | `sys_verification` omits `list` from `apiMethods`                                                                                      |
  | `nav_device_codes`       | `sys_device_code` likewise — both hold sensitive, ephemeral secrets, so a browse entry could only ever render "failed to load" (#2266) |
  | `nav_metadata`           | moved to Studio as `nav_metadata_directory` when the Studio app was split out                                                          |

  14 key/label pairs in total, not 16: `zh-CN` never carried `nav_verifications`
  or `nav_device_codes`.

  Each id was checked **individually** against a repo-wide grep for a declaring
  `id: '<key>'` — zero hits each, against a control probe (`nav_webhooks`) that
  returns five. That is deliberately not the same claim as a runtime diff: from a
  single booted composition a dead key and a conditionally-contributed one are
  indistinguishable (`plugin-auth` contributes `nav_sso_providers` only when an
  external IdP is wired), which is why `pnpm check:app-nav-i18n` still refuses the
  reverse direction and why this change removes exactly four named ids rather than
  "everything the merged app did not declare".

  A tombstone test pins the four so they cannot drift back in without their nav
  item. Re-adding `nav_verifications` / `nav_device_codes` remains a security
  decision — it means enabling `list` on the object first.

- 569611f: fix(platform-objects): drop the dead Setup › Advanced › Signing Keys (JWKS) nav entry (#7544)

  `Setup › Advanced › Signing Keys (JWKS)` could never load, for **any** persona.
  `sys_jwks` declares `enable.apiEnabled: false` / `apiMethods: []`, so the list
  request answers `OBJECT_API_DISABLED` (404) — and the console masked that as a
  generic "No identity records" empty state, so the surface read as _"you have no
  signing keys"_ rather than _"this page cannot work"_.

  **Why the gate it carried could not help.** The entry was contributed with
  `requiredPermissions: ['manage_platform_settings']`, and an in-code comment
  claimed a non-admin's list "403s server-side" — which reads as though an admin
  could list the keys. None could. `apiAccessDenialFromEnable` (`rest-server.ts`)
  is a **pure function of the object's `enable` block**: it takes no user, no
  permissions and no context, so the 404 is identical for every persona, platform
  admin included. A permission gate on the entry and an API-disabled object are
  independent conditions, and no combination of the first prunes the second.

  **The repair is the entry, not the object.** `sys_jwks` rows are the
  environment's JWT signing keys (`private_key` — private key material); opening a
  read path onto them over the generic data API would be a credential disclosure.
  `enable` is unchanged, and a test now pins that it stays `apiEnabled: false` /
  `apiMethods: []` (fails CLOSED since #3391) and `access: { default: 'private' }`
  (ADR-0066 ④). better-auth continues to read the keys through its adapter under a
  system context, so token signing and verification are unaffected.

  This matches how the same class is already handled two lines below in
  `setup-nav.contributions.ts`: `sys_verification` and `sys_device_code` omit
  `list` and therefore get no browse entry. `sys_jwks` was the only one of the
  repo's seven API-disabled objects that still had a nav entry — the six
  `sys_oauth_*` token/consent stores never had one.

  Also landed with the removal:

  - The four `apps.setup.navigation.nav_jwks` labels move into the
    `DEAD_SETUP_NAV_IDS` tombstone (`setup-nav-dead-key-tombstone.test.ts`), which
    refuses a label with no declaring nav item and states the order for re-adding
    one. The `sys_jwks` **object** labels in the generated bundles are untouched —
    the object still exists.
  - A new invariant in `platform-objects.test.ts`: every contributed
    `type: 'object'` Setup entry must target an object that can actually serve a
    `list`, judged through the same single derivation source the REST gate uses
    (`resolveEffectiveApiMethods` / `isApiOperationAllowed`, #3391). It asserts the
    control too — `nav_api_keys` → `sys_api_key` still lists, so a fix that pruned
    both would fail.

  **Not addressed here** (reported on #7544 instead): nav gating has no declaration
  that can express "prune when the destination cannot serve". `filterAppForUser`
  gates `requiredPermissions` and `requiresService` server-side and deliberately
  leaves `requiresObject` to the client, and nothing anywhere consults
  `enable.apiEnabled` — so re-pointing this entry at a `requiresObject` gate would
  not have pruned it either. Closing that gap is a contract-face change and belongs
  in its own card.

- 51d74ad: fix(platform-objects): translate the Setup app's runtime-contributed navigation, and gate it on the merged app instead of a static walk (#5750)

  Under `zh-CN`, four of the Setup app's ~50 sidebar entries rendered in English —
  `Packages`, `Delegations (OOO)`, `Webhooks`, `HTTP Deliveries` — and it was not a
  client-side fallback: the server's own merged `app` metadata carried the English
  literals. Sitting in a screen of Chinese menu items, they read like words that
  were simply never meant to be translated.

  Two different causes, both now fixed:

  - **`nav_packages` was translated in the wrong app's namespace.** A
    `nav_packages: { label: '软件包' }` existed under `apps.studio.navigation`.
    Setup contributes an entry with the same id (package administration is an
    operator concern, ADR-0084) and looks it up under
    `apps.setup.navigation.nav_packages` — a different subtree, so the lookup
    missed and the author's `'Packages'` literal won. Both entries are legitimate;
    the Setup one has been added and the Studio one left alone.
  - **The other three had no translation anywhere.** `nav_approval_delegations`
    (`@objectstack/plugin-approvals`), `nav_webhooks` and `nav_http_deliveries`
    (`@objectstack/plugin-webhooks`) are contributed at runtime by the capability
    plugins that own the objects, and no locale file carried a label for them.

  Four more were found by the new gate below, invisible to the one-locale browser
  session that reported this: `nav_capabilities`, `nav_settings_localization`,
  `nav_settings_company` and `nav_datasources` were translated in `zh-CN` **only**,
  so `ja-JP` and `es-ES` menus showed English there too. All eight ids are now
  labelled in all four locales (`en`, `zh-CN`, `ja-JP`, `es-ES`).

  **Why nothing caught it, which is the part worth keeping.** The Setup app is a
  shell of empty group anchors whose entries arrive at runtime (ADR-0029 D7), so a
  static walk sees none of them. Both existing gates knew this and each named the
  _other_ as the owner: `app-nav-translation-parity.test.ts` excluded Setup and
  deferred to "the coverage ratchet", while `platform-objects`' extract config
  deferred the same labels to that ratchet "baselined at 0 for this package". The
  ratchet runs `os lint` over **static** stack configs, so its 0 meant "not looked
  at here", not "checked, clean" — and it reported OK the whole time.

  A new gate closes the handoff — `pnpm check:app-nav-i18n`
  (`packages/cli/scripts/check-app-nav-i18n.mjs`, wired into `lint.yml`). It boots
  the real composition, merges the navigation contributions through the same
  `applyNavContributions` path the `/api/v1/meta/app` read uses, and asserts every
  merged nav id carries a label in every locale the platform bundle declares — so
  the next plugin-contributed entry cannot leak the same way. It also fails when a
  declared contributor lands no nav id at all, because fewer merged ids means
  fewer ids checked: a contributor that silently stops contributing would
  otherwise make the gate greener rather than redder. The two comments that
  delegated to the ratchet now say what actually owns these labels.

  No authoring change: plugin nav `label` values stay plain English literals, and
  translations continue to live in `apps.setup.navigation` in this package.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

- e787608: Translate the Setup app's `nav_sso_providers` navigation entry in all four
  locales.

  `@objectstack/plugin-auth` contributes an **SSO Providers** entry into Setup's
  Access Control group (`sys_sso_provider`, priority 250), but no locale bundle
  carried a label for it: measured on `origin/main` `ea1d9165d`, a grep for
  `nav_sso_providers` over `en` / `zh-CN` / `ja-JP` / `es-ES` returned **0 each**,
  against a control probe (`nav_positions`) that returned 1 each. A deployment
  with an external IdP wired therefore rendered `SSO Providers` in English inside
  an otherwise fully translated Setup menu.

  | locale  | label            |
  | ------- | ---------------- |
  | `en`    | SSO Providers    |
  | `zh-CN` | SSO 提供方       |
  | `ja-JP` | SSO プロバイダー |
  | `es-ES` | Proveedores SSO  |

  Each one matches that locale's existing `sys_sso_provider.pluralLabel`, since
  the nav entry opens exactly that object's list view.

  **Why no gate caught it.** `pnpm check:app-nav-i18n` (#5750) boots the real
  composition and asserts every _merged_ Setup nav id carries a label in every
  locale — and `plugin-auth` spreads its `navigationContributions` in only when
  `authManager.isSsoWired()` is true. In the composition that gate boots, this
  entry is never contributed, never merged, and so never judged; the gate's header
  already declared that bound. This id is consequently the one Setup entry no
  boot-time check can reach, so it is pinned by hand instead, next to the dead-key
  tombstone (#6660) it is the converse of: one list holds ids whose label must be
  **gone**, the other ids whose label must **stay**. Making the gate itself
  union-aware was considered and deliberately left unbuilt — a separate
  maintainer-facing call, not a prerequisite for labelling the ids it cannot see.

- 60b672e: fix(spec,platform-objects): put `sys_api_key`'s missing batch route on the record (#7802)

  `@objectstack/spec`'s `apiMethods` conformance scan was failing on `main` — and,
  because the scan lives in `spec` while the object it judges lives in
  `platform-objects`, failing for every PR that touched `spec` and no others.
  #7769 had added `update` to `sys_api_key`'s `enable.apiMethods` so the Setup
  UI's Revoke button had a working route, which tripped the rule "a whitelist that
  grants single-record writes must also grant `bulk`".

  Resolved as the rule's second documented outcome — a registered exemption, not a
  widened object. `sys_api_key` now carries the monorepo's only
  `SINGLE_RECORD_WRITE_ONLY` entry, with the evidence behind it:

  - **No batch surface exists to deny.** The console renders no checkbox column on
    any of the object's list views: multi-select is auto-enabled only when a bulk
    action exists, the sole implicit one is bulk-delete, and this object grants no
    delete affordance (`managedBy: 'better-auth'` denies by default, `userActions`
    opens `edit` alone, `delete` is not in `apiMethods`).
  - **A future multi-select revoke would not need `bulk` either.** `revoke_api_key`
    / `restore_api_key` are `list_item` actions; promoting one into a view's
    `bulkActions` resolves it to a `custom` def that the grid executor fans out
    through the action runner as N single-record PATCHes — never `/batch`.

  So `POST /api/v1/data/sys_api_key/batch` and the `*Many` routes keep answering
  405 for API keys, deliberately: the object's authorable surface is the single
  `revoked` boolean that ADR-0092 D2's identity write guard admits, and nothing
  asks to write it in bulk. #7769's `update` grant is untouched — the Revoke
  button keeps working. Adding `bulk` later requires retiring the exemption in the
  same commit; the conformance suite's stale-entry check refuses to let both stand.

- 6cb81c7: fix(platform-objects): `sys_setting`'s declared unique index becomes per-organization (#8555)

  `sys_setting` declared its row identity as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so `(namespace, key, scope, user_id)`
  materialized as an **installation-wide** unique index on a tenant-scoped object.
  (Field-level `unique: true` means the opposite, per-organization, and has since
  #3696; `packages/lint` names that divergence "the #4986 trap".) This is the sixth
  instance of the class ruled on 2026-08-13, after #8461, #8556 and #8554's five.

  | object        | package            | was                                       | now                            |
  | ------------- | ------------------ | ----------------------------------------- | ------------------------------ |
  | `sys_setting` | `platform-objects` | `[namespace, key, scope, user_id]` global | same columns, per organization |

  ## Why per-organization, when this object had an argument for staying global

  `sys_setting` carries a `scope` column, so the card that filed this asked a real
  question first: if `scope` itself encoded tenancy, the installation-wide key was
  correct and the fix was to spell `'global'` explicitly. It does not. `scope` is
  the cascade LAYER — `global | tenant | user`, a priority ladder walked
  env > global > tenant > user > default — and the organization is carried by
  `organization_id` and nothing else. `SettingsService.loadRows` says so outright
  ("per-tenant isolation for `tenant`-scope rows is still enforced by the engine"),
  `upsertRow` bypasses the tenant audit only for `scope='global'` rows "because
  global rows are platform-wide", and the `lifecycle` manifest depends on the
  per-organization reading: `retention_overrides` is `scope: 'tenant'` precisely so
  that "regulated tenants set years; dev sets days ... one deployment can carry
  both" (ADR-0057 §3.2).

  The `scope='global'` layer is **not** lost by scoping the index. The organization
  key part is NULL-safe (`COALESCE(organization_id, '__global__')`, ADR-0120 D3),
  and platform rows carry no organization — so they share one bucket and stay
  unique among themselves, which is exactly the installation-wide platform default
  the resolver reads at rung 2.

  ## Measured live on a real engine before the fix

  Two organizations, the same `(namespace, key)`, `OS_TENANCY_POSTURE=isolated`,
  driving the real shipped declaration:

  ```
  scope='user'    org_jia POST (mail, smtp_host, user, usr_1) → 201
                  org_yi  POST the SAME                       → 409 UNIQUE_VIOLATION
                  org_yi  POST an unused key                  → 201    ← the control
                  org_yi  GET  the colliding key              → total 0
  scope='tenant'  org_jia 201 / org_yi the SAME → 201
  scope='global'  platform 201 / platform the SAME → 201
  ```

  The 409 is the class defect: a per-value refusal on a row the caller cannot read
  is a cross-tenant existence oracle, and two organizations could not hold
  independent per-user settings for the same key.

  ⚠️ **The two 201s are a second, independent defect that this release does NOT
  fix.** `user_id` is NULL on every `tenant` and `global` row, and SQL UNIQUE is
  NULL-distinct, so the declared row identity is unenforced on those limbs — even
  within one organization, two rows for the same `(namespace, key, scope)` are
  accepted. The organization key part is NULL-safe; the author-declared `user_id`
  column is not. Closing that needs a contract decision about null-safety on
  author-declared columns plus a duplicate pre-flight for databases that have
  already accumulated duplicates, so it is filed as #8629 rather than smuggled in
  here. It is pinned as a live fact in the driver suite so this change cannot be
  read as having fixed it.

  ## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

  Respelling a declared index changes its generated **name**. On an existing
  database `initObjects` is additive: it creates the new per-organization composite
  at boot and **never drops the old global index**, which goes on enforcing. Until
  the retirement is applied, a deployed installation that has taken this release
  still refuses a second organization's per-user setting — that is asserted as a
  test, not assumed.

  ```
  os migrate plan       # one `replace_unique_index` on sys_setting, categorised safe
  os migrate apply      # no --allow-destructive needed
  ```

  It plans as **one pure relaxation**, not as two findings. That matters: if it
  read as "composite missing" (safe) plus "old global index orphaned"
  (destructive, opt-in), an operator applying only the safe half would keep the
  global index — keep the defect — while the plan read as applied. The `#8461`
  `replace_unique_index` arm covers it unchanged (no driver change in this
  release), applies CREATE-before-DROP so uniqueness is never unenforced in
  between, drops the legacy index only once the replacement is confirmed present,
  and converges to no drift.

  Two notes worth an operator's attention:

  - The replacement index name,
    `uniq_sys_setting_organization_id_namespace_key_scope_user_id`, is exactly 60
    characters — the limit — so it is emitted untruncated rather than
    hash-suffixed.
  - Because the replacement does **not** tighten the `user_id` column, the
    migration still applies cleanly to a database that already carries duplicate
    `scope='tenant'` rows (which the old index permitted). Row counts are
    preserved; nothing is deduplicated.

  ## Not breaking

  A relaxation admits key pairs that were previously refused and refuses nothing
  that previously succeeded, so no caller that worked before fails now. Every write
  to `sys_setting` goes through `SettingsService.set()`, whose upsert keys on
  `(namespace, key, scope, user_id)` under the engine's tenant scoping — the shape
  this index now matches.

- 61282f9: fix(platform-objects): `sys_setting.scope` drops the never-implemented `runtime` option (#6036)

  The `scope` select declared four cascade layers while the platform only ever had
  three. `SpecifierScopeSchema` (`packages/spec/src/system/settings-manifest.zod.ts`)
  is `z.enum(['global', 'tenant', 'user'])`, `SettingsService` never mentions the
  string `'runtime'` anywhere, and its `scopeRank()` switch handles only those same
  three — so no code path could write such a row and none could read one back. The
  sibling audit object `sys_setting_audit.scope` already declared only three. This
  was a declared-but-unenforced value domain of the ADR-0049 kind: nobody could hit
  it, but the next reader of the object definition would reasonably conclude the
  platform supports a fourth scope layer.

  Removed rather than implemented — there is no runtime-scope product intent, and
  the spec enum stays the reference truth for what the cascade's layers are. A new
  pin (`sys-setting.scope-options.test.ts`) compares the object's option list
  against `SpecifierScopeSchema` directly, so a future divergence in either
  direction lands as a red test instead of a second silent one.

  Removal was gated on a measurement, not on the zero-write-path prediction: a real
  engine booted over the platform objects, driven through the real
  `/api/settings/:namespace` write path, stored 4 rows (`tenant` 3, `global` 1) and
  **0** with `scope='runtime'` — with a positive control proving the query does
  surface such a row when one is injected directly.

  No stored data is affected and no consumer read the option, so this is a
  definition-only correction.

- 3a2dde7: fix(platform-objects): stop the System Overview date bar from windowing the "Organizations" and "Packages Installed" tiles (#7613)

  Finishes Row 1 of the shipped **System Overview** board. #7531 fixed "Total
  Users" and "Active Sessions"; the identical defect was still live on the other
  two tiles of the same inventory row.

  The board declares a `created_at` global filter defaulting to `last_7_days`, and
  a dashboard-level filter is broadcast into _every_ widget's analytics query
  (#2501). A `created_at` column exists on `sys_organization` and
  `sys_package_installation` alike, so the broadcast landed on both:

  - **"Organizations"** reported organizations created in the last 7 days, under a
    description that says "Total organizations on the platform".
  - **"Packages Installed"** reported installations created in the last 7 days
    with `status: 'installed'`, under a description that says "Active package
    installations across projects".

  Both tiles now opt out with `filterBindings: { created_at: false }`. On
  "Packages Installed" that opt-out is orthogonal to the widget's existing
  `filter: { status: 'installed' }` and both stand — the predicate decides _which_
  installations count, the opt-out decides _how many_.

  The date bar is untouched where it belongs: all six `sys_audit_log` widgets
  (rows 2-4) still inherit it, which is what it was added for. No labels changed
  and no translation keys move — the fix is to the queries, not the wording.

  Behaviour change to be aware of when upgrading: on any instance older than the
  selected window both tiles will now read **higher** than before. On a fresh
  datastore every row is recent, so the windowed count and the true total coincide
  and neither number moves.

- 8c20f75: fix(platform-objects): make the System Overview "Total Users" and "Active Sessions" tiles count what their labels say (#7531)

  Two tiles on the shipped **System Overview** board reported a different quantity
  from the one on the card. Neither number was stale or fabricated — each equalled
  its own captured query and an independent direct aggregate — the query was
  simply answering a different question from the label.

  **"Total Users" was a 7-day count.** The board declares a `created_at` global
  filter defaulting to `last_7_days`, and a dashboard-level filter is broadcast
  into _every_ widget's analytics query (#2501). `sys_user.created_at` exists, so
  the broadcast landed on it and the tile reported "users created in the last 7
  days" under a label that says "Total". On a fresh datastore the two coincide —
  every user _is_ recent — which is why it reads as correct in a demo and as a
  catastrophic user-loss event on any instance older than the window. The tile now
  opts out with `filterBindings: { created_at: false }`.

  **"Active Sessions" counted every session.** `sys_session_metrics` is a bare
  count over `sys_session` and the widget carried no predicate, so a signed-out or
  long-expired session was still reported as active. `sys_session` can express
  "active" exactly (ADR-0069 D4): the tile now filters
  `{ revoked_at: null, expires_at: { $gt: '{now}' } }`. It opts out of the date
  bar as well — "currently active" is a statement about now, not about a window,
  so an old session that is still live must still count.

  The date bar is untouched where it belongs: all six `sys_audit_log` widgets
  (rows 2-4) still inherit it, which is what it was added for.

  No labels changed and no translation keys move — the fix is to the queries, not
  the wording. Behaviour change to be aware of when upgrading: on an instance
  older than the selected window both tiles will now read **higher** than before
  for Total Users, and typically **lower** for Active Sessions.

  Still outstanding, filed separately: the same `created_at` fan-out also reaches
  the other two Row 1 inventory tiles, "Organizations" and "Packages Installed".

- b45c71e: fix(plugin-security,plugin-sharing,plugin-webhooks,platform-objects,service-messaging,spec): five tenant-scoped declared unique indexes become per-organization (#8554)

  Five platform objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object each
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) These are the fourth act of the class ruled on
  2026-08-13, after `sys_user_preference` / `sys_capability` (#8461) and
  `sys_position` (#8556).

  | object                        | package             | was                                | now                               |
  | ----------------------------- | ------------------- | ---------------------------------- | --------------------------------- |
  | `sys_permission_set`          | `plugin-security`   | `[name]` global                    | `[name]` per organization         |
  | `sys_sharing_rule`            | `plugin-sharing`    | `[name]` global                    | `[name]` per organization         |
  | `sys_webhook`                 | `plugin-webhooks`   | `[name]` global                    | `[name]` per organization         |
  | `sys_email_template`          | `platform-objects`  | `[name, locale]` global            | `[name, locale]` per organization |
  | `sys_notification_preference` | `service-messaging` | `[user_id, topic, channel]` global | same, per organization            |

  Measured live on a real engine before the fix — two organizations, the same key,
  `OS_TENANCY_POSTURE=isolated`, driving the real shipped declarations. All five
  reproduced identically:

  ```
  org_jia POST the key   → 201
  org_yi  POST the SAME  → 409 UNIQUE_VIOLATION
  org_yi  POST an unused → 201            ← the control that makes it an oracle
  org_yi  GET  the key   → total 0        ← refused by a row it cannot see
  ```

  Two consequences, both removed. **A cross-tenant existence oracle:** the 409 is a
  per-value answer about a row the caller cannot read, so an organization could
  enumerate another organization's permission-set, sharing-rule, webhook and
  template naming. **A functional dead end:** the second organization simply could
  not use the name, and the refusal did not say why. For
  `sys_notification_preference` the shape is the one #8323 measured on
  `sys_user_preference` — a user belonging to two organizations could not hold
  independent per-topic delivery toggles.

  ## ⚠️ Operators: a migration is REQUIRED, and deploying this release is not it

  Respelling a declared index changes its generated **name**. On an existing
  database `initObjects` is additive: it creates the new per-organization composite
  at boot and **never drops the old global index**, which goes on enforcing. Until
  the retirement is applied, a deployed installation that has taken this release is
  still enumerable — that is asserted as a test, not assumed.

  Run the migration:

  ```
  os migrate plan       # shows one `replace_unique_index` per object, categorised `safe`
  os migrate apply      # no --allow-destructive needed
  ```

  Each object plans as **one pure relaxation**, not as two findings. That matters:
  if it read as "composite missing" (safe) plus "old global index orphaned"
  (destructive, opt-in), an operator applying only the safe half would keep the
  global index — keep the defect — while the plan read as applied. The `#8461`
  `replace_unique_index` arm covers all five unchanged (no driver change in this
  release), applies CREATE-before-DROP so uniqueness is never unenforced in
  between, drops the legacy index only once the replacement is confirmed present,
  preserves every row, and converges to no drift.

  Two columns are worth an operator's attention:

  - `sys_notification_preference`'s replacement index name is **hash-suffixed** —
    `uniq_sys_notification_preference_a22d7d27` — because the natural name is 70
    characters and the limit is 60. That is expected, not corruption.
  - Rows with no `organization_id` (platform/seed rows) stay unique **among
    themselves**: the organization key part is NULL-safe
    (`COALESCE(organization_id, '__global__')`, ADR-0120 D3), so seeding by name
    keeps working and a tenant may hold its own row of the same name.

  ## Not breaking

  A relaxation admits key pairs that were previously refused and refuses nothing
  that previously succeeded, so no caller that worked before fails now. Every read
  path for these five objects goes through the tenant-scoped data API, so no
  consumer resolves one of these names across organizations expecting at most one
  row. Shipped as `patch` for that reason — the same call #8556 made for the same
  shape.

  Published text carrying the bare uniqueness claim was corrected at its source and
  the generated reference pages regenerated (`security/permission.mdx`,
  `automation/webhook.mdx`, and `integration/connector.mdx`, which embeds the same
  webhook schema), together with the `sys_permission_set` field description, its
  clone-dialog help text, the `sys_webhook` field description, and the matching
  translation bundles in all four shipped locales.

- d71ff32: fix(platform-objects,plugin-security,driver-sql): `sys_user_preference` and `sys_capability` uniqueness is per organization (#8323)

  Both objects declared their uniqueness as a table-level index with bare
  `unique: true`. At the DECLARED-index level that is the positional spelling of
  `'global'` — the listed columns verbatim — so on a tenant-scoped object it
  materialized an **installation-wide** unique index. (Field-level `unique: true`
  means the opposite, per-organization, and has since #3696; `packages/lint` names
  that divergence "the #4986 trap" and warns on it via
  `unique/unscoped-declared-index`.) Measured on a deployment running
  `OS_TENANCY_POSTURE=isolated`:

  - **A user in two organizations could never persist a preference key they had
    already used in the first one.** `sys_user_preference`'s `(user_id, key)` was
    installation-wide, so the second organization's write was refused by a row the
    caller cannot read — and `data-objectstack`'s `userState.save()` swallows the
    failure by design, so "recent items" and similar preferences silently stopped
    persisting in a user's second workspace, with no error anywhere.
  - **`sys_capability.name` refusals were an existence oracle across tenants.** An
    organization could POST a name and read `409` vs `201` to learn whether some
    other organization — or the platform seed — already held it, while its own
    `GET` on that name returned zero rows.

  Both declarations now say `unique: 'organization'` (ADR-0120 D1), materializing
  `(COALESCE(organization_id,'__global__'), …)`. Platform-seeded rows carry no
  organization and the key part is NULL-safe (ADR-0120 D3), so they stay unique
  among themselves and `bootstrapSystemCapabilities`' upsert-by-name is unaffected.
  Same-organization duplicates are still refused — the constraint is scoped, not
  removed.

  The bare `unique: true` spelling itself is **unchanged**; whether it should be
  reinterpreted is #5082 (v18), and the publish-time authoring advisory is #8379.

  **Migration (`@objectstack/driver-sql`).** Respelling a declared index changes
  its generated name, which on a deployed database read as two unrelated findings:
  the composite missing (`create_index`, safe) and the old global index orphaned
  (`drop_index`, **destructive**). An operator applying only the safe half would
  have kept the global index — i.e. kept the defect — while the plan read as
  applied. The declared-index respelling now routes through the same
  `replace_unique_index` retirement the field-level `unique` migration has used
  since #3728: one finding, categorised `safe`, CREATE before DROP, and the legacy
  index dropped only once the replacement is confirmed present. Any two rows
  colliding on `(organization, …fields)` already collided on `(…fields)`, so the
  replacement can neither fail on existing data nor lose any.

  Operators upgrading a deployed database should run `os migrate plan` / `os
migrate apply` — no `--allow-destructive` is required. Until the retirement is
  applied the old index keeps enforcing, so the constraint is never unenforced at
  any point in the migration.

- 4d00b13: feat(spec)!: remove `tool.requiresConfirmation` — a safety flag nothing enforced (#3715, ADR-0033 §2)

  `ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read
  it. Not the LLM tool set (a tool reaches the model as name/description/parameters
  only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the
  MCP bridge — which derives `destructiveHint` from a hardcoded name list. Setting
  it on a destructive tool produced **no pause**.

  For an ordinary dead property that is untidy. For a **safety** property it is
  false compliance, which is the case ADR-0049 exists for: an author gates a
  destructive tool, sees the flag accepted, and ships believing a human is in the
  loop. It is made worse by the near-miss — `action.ai.requiresConfirmation` has
  the same name and **does** work, so the mistake reads as correct in review.
  ADR-0033 §2 already resolved to delete this one.

  ## Migration

  - **FROM:** `requiresConfirmation: true` on a tool definition
  - **TO:** put the operation behind an action and set `ai.requiresConfirmation:
true` there — that is the flag the HITL approval queue reads
    (`packages/runtime/src/action-execution.ts`) and the only path that actually
    stops execution.
  - For AI _metadata_ mutations there is nothing to migrate: the ADR-0033
    draft/publish workspace is the gate — nothing is live until a human publishes.

  **`ToolSchema` is now `.strict()`.** This is load-bearing, not tidying. Removing a
  key from a non-strict schema swaps one silent no-op for another: zod strips the
  key wordlessly, the author keeps writing it, and the safety flag goes on meaning
  nothing — the "silent strip" ADR-0032 / #1535 closed for objects. The retired key
  now **rejects**, and the error carries the FROM → TO above, because a parse error
  is the one channel every consumer bumping `@objectstack/spec` is guaranteed to
  hit.

  Strictness applies to _all_ unknown keys on a tool definition, so a typo
  (`buildIn`, `catagory`) is now a located parse error instead of a silently
  dropped field.

  Also removed: the Studio form row, its four generated locale bundles (the
  `en`/`zh-CN`/`ja-JP`/`es-ES` strings still promised _"Ask user to approve before
  executing (for destructive actions)"_ — a translated false promise), the
  liveness-ledger entry, and the generated reference-doc row.

  objectui's `ToolPreview.tsx` reads the field via `!!d.requiresConfirmation`, so it
  degrades to "not shown" with no error; removing that badge is a follow-up in that
  repo.

  <!-- adr-0087: registered tool-requires-confirmation-retired -->

- 9aa5510: fix(i18n): ship the missing object-translation keys for the better-auth 1.7 and ADR-0105 D6 fields (#3624 follow-up)

  The generated object-translation bundles predate two rounds of field additions,
  so six fields had no entry in **any** locale and fell back to their raw schema
  labels in every UI surface that reads the bundle:

  - `sys_team.member_count`, `sys_team_member.membership_key`,
    `sys_two_factor.failed_verification_count` / `locked_until` — the better-auth
    1.7 columns provisioned in #3647.
  - `sys_organization.parent_organization_id` / `sort_order` — the same gap left
    by the earlier ADR-0105 D6 group-structure work.

  Regenerated with `os i18n extract` (merge mode, so every existing translation is
  preserved — the diff is purely additive). No API or schema change; the fields
  themselves already shipped.

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
- Updated dependencies [c7e7900]
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
- Updated dependencies [51a587d]
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
- Updated dependencies [c073b8c]
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
  - @objectstack/spec@17.0.0
  - @objectstack/metadata-core@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 06be54e: fix(objectql): a value admitted by an `OS_ALLOW_LAX_*` escape hatch stops released field files from being collected (#4797)

  `recordDataMigrationRun`'s contract says a deployment whose data has regressed
  since it last verified closes its own gate. That only happened when a migration
  was re-run — nothing told the ledger when the data actually regressed.

  Normally nothing has to. Once `sys_migration` records a verified ADR-0104
  migration the write path is strict, a non-conforming value is refused, and the
  certificate cannot go stale. **The operator escape hatches are the exception,
  and they exist precisely to relax a deployment that has already verified.** With
  `OS_ALLOW_MEDIA_VALUES` / `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`
  on, a non-conforming value is admitted and persisted while the row still reads
  `verified_at` non-null, `blocking: 0`. Turn the switch off — or let any other
  process or machine run without it — and strict returns to reject the very data
  this deployment stored. Meanwhile the `adr-0104-file-references` row also governs
  reclamation of released field files, so the reap guard kept **deleting bytes** on
  the strength of a certificate that was no longer true, with nothing in the ledger
  saying so.

  **A lax-admitted write now records a deviation.** The engine's admit path — the
  same sink that already tallies counterexamples for #4769 — stamps
  `sys_migration.deviation_observed_at` (plus a `deviation_detail` naming the
  object, field, type and parse issue) on the migration whose contract the value
  broke.

  **The marker gates the irreversible path, and only that.** Authority is withdrawn
  in proportion to reversibility:

  | behaviour                                 | reversible?                 | predicate                      | while a deviation stands |
  | ----------------------------------------- | --------------------------- | ------------------------------ | ------------------------ |
  | strict value-shape enforcement (#3438)    | a rejected write is retried | `isDataMigrationFlagVerified`  | continues                |
  | tombstoning a released file (#3459 PR-5b) | lifted on re-attach         | `isDataMigrationFlagVerified`  | continues                |
  | reap guard's byte delete                  | **never**                   | `authorisesIrreversibleAction` | **refuses**              |

  A certificate is not a boolean; it is authority over a set of behaviours, and the
  two halves are withdrawn on different evidence. One admitted write is a complete
  disproof of "nothing here violates this contract" — enough to stop deleting data
  forever. It is _not_ evidence of the same order as the full-store scan that
  earned the certificate, so it does not revoke it: doing that would turn an
  explicitly temporary switch into a one-way door, forcing a full re-migration on
  anyone who used the escape hatch once.

  Recording without gating was rejected for the opposite reason — a marker no code
  consumes is a declared-but-unenforced field, and the bytes get deleted regardless.

  **Getting back to full authority is the documented route.** A real
  `os migrate files-to-references --apply` / `os migrate value-shapes --apply` run
  walks the whole store again, which _is_ evidence of the same order, and clears
  the marker.

  Additive and backward compatible. A `sys_migration` row written before these
  columns existed reads as "no deviation observed", so upgrading never retroactively
  closes a gate a deployment earned — the marker only ever closes it on an observed
  deviation. `isDataMigrationFlagVerified` is unchanged and keeps its existing
  consumers; the new `authorisesIrreversibleAction` (spec) and `mayActIrreversibly`
  (platform-objects) are the stronger pair, and the reap guard is their one caller.

- 5fa04fb: Point the account app's **Approvals** navigation entry at the Approvals Inbox component, and contribute an **Approvals Inbox** entry to Setup (#7234).

  The entry point has not moved — the account menu still shows **Approvals** with the same
  label and icon in every locale. Its destination has. It used to open the raw
  `sys_approval_request` grid, which is an admin/diagnostic view of the engine's own table
  and cannot show an approver a single decision button: every action on that object is gated
  on `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block is
  attached only by the approvals REST path, never by the generic data API the object route
  reads. The result was a correct-looking list of rows nobody could act on. The entry is now
  `{ type: 'component', componentRef: 'approvals:inbox' }`, so it opens the full inbox —
  decision actions, business vocabulary, node progress and the request drawer.

  - **Account app**: `nav_account_approvals` becomes a component entry gated by
    `requiresService: 'approvals'`, so it disappears where `plugin-approvals` is not
    installed (the previous `requiresObject` gate does not apply to a component entry).
  - **Setup**: `plugin-approvals` contributes a new **Approvals Inbox** entry at the top of
    **Setup → Approvals**, above the three raw tables, which stay exactly as they were —
    admin-gated by `manage_platform_settings` and now unambiguously the diagnostic surface.
    Labels ship in all four locales (zh-CN 审批中心).
  - `sys_approval_request` is no longer surfaced raw to end users anywhere.
  - **Docs**: the approver's queue is documented as the Approvals Inbox, with a snippet for
    mounting it in any business app — one navigation entry naming the component-registry key
    `approvals:inbox`, never a console path.

  Reaching the inbox end to end in the browser additionally requires the console pin bump,
  tracked separately.

- 60f0dd8: feat(spec,platform-objects): add `degraded` to the job status vocabulary (#7072)

  `JobExecutionStatus` and the two `sys_job*` selects now carry a fifth value,
  `degraded` — "the run finished, but its work did not happen". This is the
  consumer-side half of the `JobRunOutcome` producer shape #6617 shipped on
  `contracts/job-service.ts`, and it executes the 2026-08-08 maintainer ruling on
  #5548 verbatim:

  > **Vocabulary stays minimal** — one additional outcome meaning "completed
  > without accomplishing the work". ⛔ Do not open an enum family; a second key
  > would need its own pull.

  Three declaration sites had to move together, because the two platform-object
  selects are _enforced_ — ObjectQL's record validator refuses an
  out-of-vocabulary `select` value with `invalid_option`, and `DbJobAdapter`
  swallows that rejection in a best-effort `try/catch`. A value legal in the spec
  enum but absent from the selects would therefore be a silently dropped write
  that leaves the run row `running` forever, not a type error:

  - `packages/spec/src/system/job.zod.ts` — `JobExecutionStatus`
  - `packages/platform-objects/src/audit/sys-job-run.object.ts` — `status`
  - `packages/platform-objects/src/audit/sys-job.object.ts` — `last_status`

  **`degraded` is not a failure and never retries.** Retry and failure are driven
  exclusively by a rejected handler promise, so a resolved
  `{ outcome: 'degraded' }` never re-runs the job.

  A degraded run's `reason` rides the existing `error` / `last_error` columns and
  leaves `failure_count` flat — the ruling's minimal-vocabulary spirit applied to
  columns as to enum members. The cost is recorded in the TSDoc at the enum: a
  column labelled "Error" may carry a non-error operator note whenever
  `status === 'degraded'`, so readers must gate on the status first.

  Additive only: no existing value changed meaning, and nothing yet produces
  `degraded` — wiring `DbJobAdapter` to map the outcome is #5548, which this
  unblocks. Locale bundles (en / zh-CN / ja-JP / es-ES) carry the new option.

### Patch Changes

- 59c544d: **`member_default`'s removed wildcard was still named as live fact, and two D7 dogfood denials had gone vacuous (#6964).**

  #5491 (PR #6684) removed `member_default`'s plain `'*'` object grant and ADR-0095
  D1 retired its wildcard `tenant_isolation` RLS policy. Six live sites outside the
  two surfaces PR #6958 already fixed still asserted one of those two facts as
  current, and — the reason this is not only prose — two dogfood tests rested their
  whole evidential claim on the first one.

  **Prose (`platform-objects`, `qa/dogfood`, published docs).** The
  `requiredPermissions` gates on `sys_scim_provider` and `sys_sso_provider`
  justified themselves by an exposure that no longer exists, which invites the next
  reader to conclude the gates are redundant. They are not: `requiredPermissions`
  is a capability AND-gate evaluated _before_ the CRUD grant, so it denies
  regardless of how permissive any grant is — including one an app-declared profile
  or a customer-authored set names. `sys_sso_provider`'s `tenancy.enabled:false`
  and `rls-multitenant`'s investigation narrative are re-premised on the ADR-0095
  D1 Layer 0 tenant wall, which is what actually decides them now. And
  `content/docs/permissions/index.mdx` stated the retired wildcard
  `tenant_isolation` policy as shipped behaviour, contradicting
  `releases/implementation-status.mdx` in the same repo; the doc now matches the
  status page.

  **The defect.** `showcase-default-profile` and `showcase-d7-default-profile`
  proved ADR-0056 D7 with `expect(status).not.toBe(200)` on an app object,
  justified by "`member_default` has a wildcard grant → would be 200". With the
  wildcard gone that baseline grants nothing on app objects, so the denial became
  the trivially expected outcome and the assertion passed _because nothing is
  produced_ — it could no longer tell "the declared default is in force" from "no
  default is in force at all", which is the one thing those files exist to tell.
  Measured on a live showcase boot, one fresh sign-up per wiring: under the
  built-in baseline `showcase_private_note` and `showcase_contact` are **403**,
  exactly as under the declared default.

  Both denial cases are replaced wholesale rather than re-worded, with an object
  only the built-in baseline grants (`sys_user_preference`): 200 if and only if
  `member_default` governs. The same run settles the risk that would have killed
  that idea — a named `fallbackPermissionSet` **replaces** `member_default` rather
  than merging additively on top of it. Reverse-verified: stripping the declared-
  default wiring turns the new case red (200) and the positive case red (403),
  while the deleted cases stay green — the vacuity, demonstrated directly.

  No runtime behaviour changes.

- d42a92f: chore(platform-objects): drop four dead `apps.setup.navigation` translation keys (#6660)

  Four ids kept a Setup nav label in the hand-written locale bundles long after
  the nav item that declared them was removed. No composition renders them, so
  nothing was broken — but a translated key with no declaring nav item is the
  shape `app-nav-translation-parity.test.ts` already refuses for Studio: it reads
  as coverage. `nav_workflows` outlived its Studio menu entry in all four locales
  the same way, and nothing said so until that reverse assertion was written.

  Removed, with the reason each one is gone:

  | id                       | why it has no nav item                                                                                                                 |
  | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
  | `nav_approval_processes` | the approval process engine was retired in favour of the approval flow node (#1408, ADR-0019 P4/P5)                                    |
  | `nav_verifications`      | `sys_verification` omits `list` from `apiMethods`                                                                                      |
  | `nav_device_codes`       | `sys_device_code` likewise — both hold sensitive, ephemeral secrets, so a browse entry could only ever render "failed to load" (#2266) |
  | `nav_metadata`           | moved to Studio as `nav_metadata_directory` when the Studio app was split out                                                          |

  14 key/label pairs in total, not 16: `zh-CN` never carried `nav_verifications`
  or `nav_device_codes`.

  Each id was checked **individually** against a repo-wide grep for a declaring
  `id: '<key>'` — zero hits each, against a control probe (`nav_webhooks`) that
  returns five. That is deliberately not the same claim as a runtime diff: from a
  single booted composition a dead key and a conditionally-contributed one are
  indistinguishable (`plugin-auth` contributes `nav_sso_providers` only when an
  external IdP is wired), which is why `pnpm check:app-nav-i18n` still refuses the
  reverse direction and why this change removes exactly four named ids rather than
  "everything the merged app did not declare".

  A tombstone test pins the four so they cannot drift back in without their nav
  item. Re-adding `nav_verifications` / `nav_device_codes` remains a security
  decision — it means enabling `list` on the object first.

- 51d74ad: fix(platform-objects): translate the Setup app's runtime-contributed navigation, and gate it on the merged app instead of a static walk (#5750)

  Under `zh-CN`, four of the Setup app's ~50 sidebar entries rendered in English —
  `Packages`, `Delegations (OOO)`, `Webhooks`, `HTTP Deliveries` — and it was not a
  client-side fallback: the server's own merged `app` metadata carried the English
  literals. Sitting in a screen of Chinese menu items, they read like words that
  were simply never meant to be translated.

  Two different causes, both now fixed:

  - **`nav_packages` was translated in the wrong app's namespace.** A
    `nav_packages: { label: '软件包' }` existed under `apps.studio.navigation`.
    Setup contributes an entry with the same id (package administration is an
    operator concern, ADR-0084) and looks it up under
    `apps.setup.navigation.nav_packages` — a different subtree, so the lookup
    missed and the author's `'Packages'` literal won. Both entries are legitimate;
    the Setup one has been added and the Studio one left alone.
  - **The other three had no translation anywhere.** `nav_approval_delegations`
    (`@objectstack/plugin-approvals`), `nav_webhooks` and `nav_http_deliveries`
    (`@objectstack/plugin-webhooks`) are contributed at runtime by the capability
    plugins that own the objects, and no locale file carried a label for them.

  Four more were found by the new gate below, invisible to the one-locale browser
  session that reported this: `nav_capabilities`, `nav_settings_localization`,
  `nav_settings_company` and `nav_datasources` were translated in `zh-CN` **only**,
  so `ja-JP` and `es-ES` menus showed English there too. All eight ids are now
  labelled in all four locales (`en`, `zh-CN`, `ja-JP`, `es-ES`).

  **Why nothing caught it, which is the part worth keeping.** The Setup app is a
  shell of empty group anchors whose entries arrive at runtime (ADR-0029 D7), so a
  static walk sees none of them. Both existing gates knew this and each named the
  _other_ as the owner: `app-nav-translation-parity.test.ts` excluded Setup and
  deferred to "the coverage ratchet", while `platform-objects`' extract config
  deferred the same labels to that ratchet "baselined at 0 for this package". The
  ratchet runs `os lint` over **static** stack configs, so its 0 meant "not looked
  at here", not "checked, clean" — and it reported OK the whole time.

  A new gate closes the handoff — `pnpm check:app-nav-i18n`
  (`packages/cli/scripts/check-app-nav-i18n.mjs`, wired into `lint.yml`). It boots
  the real composition, merges the navigation contributions through the same
  `applyNavContributions` path the `/api/v1/meta/app` read uses, and asserts every
  merged nav id carries a label in every locale the platform bundle declares — so
  the next plugin-contributed entry cannot leak the same way. It also fails when a
  declared contributor lands no nav id at all, because fewer merged ids means
  fewer ids checked: a contributor that silently stops contributing would
  otherwise make the gate greener rather than redder. The two comments that
  delegated to the ratchet now say what actually owns these labels.

  No authoring change: plugin nav `label` values stay plain English literals, and
  translations continue to live in `apps.setup.navigation` in this package.

- e787608: Translate the Setup app's `nav_sso_providers` navigation entry in all four
  locales.

  `@objectstack/plugin-auth` contributes an **SSO Providers** entry into Setup's
  Access Control group (`sys_sso_provider`, priority 250), but no locale bundle
  carried a label for it: measured on `origin/main` `ea1d9165d`, a grep for
  `nav_sso_providers` over `en` / `zh-CN` / `ja-JP` / `es-ES` returned **0 each**,
  against a control probe (`nav_positions`) that returned 1 each. A deployment
  with an external IdP wired therefore rendered `SSO Providers` in English inside
  an otherwise fully translated Setup menu.

  | locale  | label            |
  | ------- | ---------------- |
  | `en`    | SSO Providers    |
  | `zh-CN` | SSO 提供方       |
  | `ja-JP` | SSO プロバイダー |
  | `es-ES` | Proveedores SSO  |

  Each one matches that locale's existing `sys_sso_provider.pluralLabel`, since
  the nav entry opens exactly that object's list view.

  **Why no gate caught it.** `pnpm check:app-nav-i18n` (#5750) boots the real
  composition and asserts every _merged_ Setup nav id carries a label in every
  locale — and `plugin-auth` spreads its `navigationContributions` in only when
  `authManager.isSsoWired()` is true. In the composition that gate boots, this
  entry is never contributed, never merged, and so never judged; the gate's header
  already declared that bound. This id is consequently the one Setup entry no
  boot-time check can reach, so it is pinned by hand instead, next to the dead-key
  tombstone (#6660) it is the converse of: one list holds ids whose label must be
  **gone**, the other ids whose label must **stay**. Making the gate itself
  union-aware was considered and deliberately left unbuilt — a separate
  maintainer-facing call, not a prerequisite for labelling the ids it cannot see.

- 61282f9: fix(platform-objects): `sys_setting.scope` drops the never-implemented `runtime` option (#6036)

  The `scope` select declared four cascade layers while the platform only ever had
  three. `SpecifierScopeSchema` (`packages/spec/src/system/settings-manifest.zod.ts`)
  is `z.enum(['global', 'tenant', 'user'])`, `SettingsService` never mentions the
  string `'runtime'` anywhere, and its `scopeRank()` switch handles only those same
  three — so no code path could write such a row and none could read one back. The
  sibling audit object `sys_setting_audit.scope` already declared only three. This
  was a declared-but-unenforced value domain of the ADR-0049 kind: nobody could hit
  it, but the next reader of the object definition would reasonably conclude the
  platform supports a fourth scope layer.

  Removed rather than implemented — there is no runtime-scope product intent, and
  the spec enum stays the reference truth for what the cascade's layers are. A new
  pin (`sys-setting.scope-options.test.ts`) compares the object's option list
  against `SpecifierScopeSchema` directly, so a future divergence in either
  direction lands as a red test instead of a second silent one.

  Removal was gated on a measurement, not on the zero-write-path prediction: a real
  engine booted over the platform objects, driven through the real
  `/api/settings/:namespace` write path, stored 4 rows (`tenant` 3, `global` 1) and
  **0** with `scope='runtime'` — with a positive control proving the query does
  surface such a row when one is injected directly.

  No stored data is affected and no consumer read the option, so this is a
  definition-only correction.

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
- Updated dependencies [3d4c545]
- Updated dependencies [bb7cb41]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/metadata-core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/metadata-core@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- e98fb14: fix(service-queue): `sys_job_queue` no longer grows forever — `completed` rows expire on a declared 7-day retention (#5179)

  `DbQueueAdapter` marked a delivered message `status: 'completed'` and then
  **nothing ever touched that row again**. `purge()` had zero production callers
  (tests only), `purgeFailed()` is a manual dead-letter API, and the object
  declared no lifecycle policy at all — so every queue delivery left a permanent
  row, which since #5160 means one permanent row per queued email.

  `sys_job_queue` now declares an ADR-0057 policy and the platform
  `LifecycleService` enforces it on its existing hourly sweep:

  ```ts
  lifecycle: {
    class: 'transient',
    retention: { maxAge: '7d', onlyWhen: { status: 'completed' } },
  }
  ```

  **Only `completed` rows are swept.** `pending` / `running` are live work, and
  `failed` / `dlq` are the dead-letter queue — they exist to wait for a human, so
  they are never deleted automatically at any age. `listFailed()` / `replay()` /
  `purgeFailed()` remain the only way a dead letter leaves the table. This is
  also why the policy is `retention` (age + row filter) rather than a `ttl` on
  `completed_at`: TTL has no row filter, and `dlq` rows stamp `completed_at` too.

  **No new configuration, and no new sweeper.** ADR-0057 §3.3 puts one reaper in
  the platform rather than one per plugin — the same call the sibling
  `sys_job_run` (30d) already makes. Any kernel with a data engine already runs
  it, its per-sweep `[lifecycle] sweep: … ~N rows reaped` line now accounts for
  this table too, and the window is overridable per environment through the
  `lifecycle` settings namespace without touching code.

  **The dedup window is now an enforced invariant, not a coincidence.** Publish
  dedups against a terminal row by comparing its `created_at` to
  `idempotencyWindowMs` (default 24h), and the reaper cuts off on that same
  `created_at` axis — so retention (7d) ≥ dedup window is what keeps "duplicate
  publishes inside the window are suppressed" true. `DbQueueAdapter` reads the
  declared window (new export `completedRetentionWindowMs()`) and **throws at
  construction** if `idempotencyWindowMs` is configured longer than it, instead of
  silently degrading into duplicate deliveries days later. If you raise
  `idempotencyWindowMs` past 7 days, raise the object's declared retention (or the
  `lifecycle` settings override) to match — the error message names both numbers.

  `class: 'transient'` is deliberate: `telemetry`/`event`/`audit` classes
  relocate their table to the dedicated `telemetry` datasource wherever one is
  registered (ADR-0057 §3.6), and moving a live work queue's storage would be a
  migration, not a cleanup.

- f104bab: feat(plugin-email,platform-objects): `sys_email` carries headers and small attachments, so those messages become durably deliverable (#5177)

  Durable email delivery works from the **row**, not from the in-memory message:
  `send()` publishes an `{ rowId }` job (#5160), the boot sweep re-reads rows
  (#5161), and both end at `rowToNormalized`. So anything a `sys_email` row could
  not carry, a row-based delivery would have dropped — and custom headers and
  attachments were exactly that. The honest workaround was to refuse: a message
  with either was pushed back onto inline delivery so that it would at least go
  out whole, which closed the durable path to precisely the mail most worth
  making durable (a signed receipt, a `List-Unsubscribe` header, an invoice PDF).

  `sys_email` now has two columns, and those messages are queueable.

  **`headers_json`** — the custom headers, as a JSON object. Written in both
  delivery modes (it is audit evidence as much as delivery input) and rebuilt on
  read. Headers are no longer a reason to fall back to inline delivery.

  **`attachments_json`** — attachments as a JSON array of
  `{ filename, contentType?, size, hash, cid?, contentForm, inline?, storageKey? }`,
  content base64 in `inline`. Written when the **combined raw size of one
  message's attachments is within `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` (256 KiB,
  exported from `@objectstack/plugin-email`)** — worst case ~350 KB of base64, so
  a row stays bounded. Both arms of the declared `content: string | Buffer`
  contract round-trip as the arm they were sent as: restoring a text attachment
  as a Buffer would silently drop `charset=utf-8` from its MIME part and let the
  recipient's client mis-decode a UTF-8 file, so `contentForm` records which one
  it was. `cid` travels too — an inline `<img src="cid:…">` is unusable without
  it.

  **Over the limit, nothing changes.** The message is delivered inline exactly as
  before, whole, and the row stores no attachment content; the reason is stated
  at `info` (a bound, not a degradation — the worst outcome is today's
  behaviour). Out-of-row storage for large attachments is #5172; `storageKey` is
  declared now so that lands as a new _producer_ rather than a data migration.

  Rows written before these columns exist read exactly as they did. A column that
  is present but does not describe what it claims — malformed JSON, a size or
  hash that disagrees with the content, a missing `contentForm` — is **rejected**,
  and the row lands at `failed` carrying the reason, rather than being delivered
  with a part quietly missing.

  The `sys_email` schema change is additive (two optional textarea columns); no
  migration is required and default inline delivery is unchanged.

### Patch Changes

- f1cc3a3: fix(spec): stop offering retired `app` keys in the metadata form, and make the reconciliation gate see tombstones (#5280)

  The `app` authoring form rendered **eight** controls for keys `AppSchema` had
  already retired to `retiredKey()` tombstones in 17.0.0 — `version`, `homePageId`,
  `objects`, `apis`, `sharing`, `embed`, `mobileNavigation` and `aria`. A tombstone
  is `z.never().optional()`, so filling one of those controls did not lose the
  value quietly: it failed the **entire save** with the key's removal
  prescription. The controls are gone, each with a comment in place naming where
  the capability went (`manifest.version`; the first `navigation` item by `order`
  plus `isDefault`; `defineStack({ objects })`; `defineStack({ apis })`;
  `FormView.sharing` for both public access and embedding; the component that
  renders the DOM node for `aria`).

  Nothing about the contract changes — every one of these keys was already
  rejected at parse. What changes is that an author is no longer shown a control
  that can only produce a 422.

  **The reconciliation gate now judges the right thing.** #3786's
  `metadata-form-zod-reconciliation.test.ts` asked whether an offered key was
  `∈ shape`. That was the same question as "may the author write this" until
  `retiredKey()` existed: a tombstone **deliberately stays in the shape** so the
  removal can carry its own upgrade prescription, so every one of those eight keys
  read as "the Zod accepts it" and the gate stayed green over all of them. It now
  asserts `∈ shape` **and not a tombstone**, in both directions — a retired key
  may not be offered, and its absence needs no ledger entry to excuse it. The
  detector reads the schema node (`z.never()` under the optional wrapper), never a
  list of key names, mirroring `isRetired()` on the JSON-Schema side of
  `build-schemas.ts`. The next `retiredKey()` retirement that forgets a form now
  fails this test instead of reaching an author.

  Retiring an authorable key already required pruning its form input; that step is
  now enforced rather than remembered.

- eda599e: fix(platform-objects): 超预算后台 seed 期间不再空库自证 —— 一次启动不再跑两套契约

  #4769 已把 ADR-0104 的空库自证从 `kernel:ready` 挪到 `app:seeded`(本次启动自身数据的结算点),但保留 `kernel:ready` 作为「从不 seed 的内核」的兜底。剩下的窗口是这两个钩子**到达顺序可以颠倒**:`AppPlugin` 的 inline seed 超出软预算(`OS_INLINE_SEED_BUDGET_MS`,默认 8s)后转入后台,于是 `kernel:ready` 先到、兜底自证在 seed 仍在写的时候签发证书并把闸门翻到 strict——同一次 seed 运行的后半段撞上前半段从未见过的契约。showcase 冷启(`OS_INLINE_SEED_BUDGET_MS=1`)实测:自证发生在 +0.470s,seed 结算在 +3.617s,窗口 3.147s。

  现在两个钩子都先问一句「本次启动自己的 seed 落定了吗」,任一处报告仍有未结算的 seed 源就不签发。`app:seeded` 同样受这道检查约束——多 config app 的 bundle 会每个 app 触发一次,第一次并不是本次启动的结算点。

  新增 `seed-settlement` 契约(`@objectstack/spec/contracts`)承载这个信号,而不是让 platform-objects 去嗅 runtime 内部的 `seed-datasets` 服务:那个数组的存在只能说明「seed 源存在」,永远说明不了「已经落定」,而这两件事之间的差正是本 bug 的整个窗口。runtime 在选择分支之前先声明 seed 源,并在写入真正结束的同一刻结算它。

  **multi-tenant 与 `skipSeedData` 的 ADR-0104 姿态(2026-08-06 裁定,#4795)**:这两种部署会注册 seed 数据但在启动时并不写入(前者按 org 在 `sys_organization` insert 时重放,后者是 `os migrate` 的只读规划启动,#3917),`app:seeded` 永不触发。它们的姿态是**启动时不自证,等 `os migrate … --apply` 在真实扫描的证据上落笔**——由同一个判据自然得出,不需要单独分支。这是答案而不是缺口:在启动那一刻断言一次尚未发生的 per-org 重放不含违规值,正是 #4769 的同一个错误、只是引信更长;而停在 warn-first 是可恢复的方向,随时可由 `os migrate value-shapes --apply` / `os migrate files-to-references --apply` 关闭。

  `@objectstack/objectql` 侧只更新了 #4769 撤销机制的注释:「后台 seed 收尾晚于签发」不再是它要兜的场景(已在源头关闭),它对 `os dev` 热重载 seeder、运行期 marketplace 安装以及 lax 开关仍然有效。

- 1b9a53b: plugin-email: large attachments (>256 KiB) now get durable queue delivery, with their content held out of the `sys_email` row

  A message whose attachments exceeded the in-row budget was pushed back onto inline delivery — whole, but with none of the durability queue delivery exists to provide, which meant the platform was weakest about exactly the mail that matters most (a signed contract, an exported report). Its content now goes to the `file-storage` capability, the row records a `storageKey` plus the audit metadata, and the queue worker fetches the content back to rebuild the message.

  - **Zero migration.** `attachments_json` declared `storageKey` from the start; this adds the producer and the reader. Attachments at or under `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` still go in the row exactly as before, and the boundary includes equality.
  - **The row stays an audit log, not a blob store.** `filename` / `contentType` / `size` / `hash` stay on the row permanently; the content is a delivery artifact and is deleted a grace window (24h) after the row reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`. Reclamation is a delayed `email.attachment.reclaim` queue job that carries the storage keys, so a row deleted in the meantime reclaims its content instead of orphaning it.
  - **Nothing degrades silently.** No `file-storage` capability, or an upload that fails, keeps today's behaviour — inline delivery of the whole message — and says which of the two it was and how to fix it. On the way back, content that cannot be fetched (outage, missing object, no capability on the worker, truncated or substituted bytes) fails the row loudly; a message is never delivered without an attachment it declares.

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
- Updated dependencies [db0d53c]
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
- Updated dependencies [51a587d]
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
- Updated dependencies [946a131]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/metadata-core@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- 98877c9: feat(core,platform-objects,spec): the ADR-0119 D2 migration-journal runner — a migration killed mid-run is resumable to completion or compensable to clean, with journal rows proving which (#4617)

  **The gap D1 left open.** ADR-0119 D1 made `engine.transaction()` reachable
  through the contract, which is the right answer for multi-write atomicity that
  fits in one transaction. Migration-class work does not fit: a million-row
  backfill cannot hold one write-lock for its duration, `driver-memory`'s
  `beginTransaction` deep-clones the entire database (O(db) per begin),
  `ObjectQL.transaction()` binds the **default driver only** so a multi-datasource
  migration silently commits part of its work outside it, and a process **killed**
  — as distinct from a thrown error — defeats in-process rollback entirely. So the
  unit of atomicity is the _chunk_, and durability across chunks is a journal.

  Four consumers had each converged on the same four moves — dry-run preflight,
  undo journal, LIFO compensation, re-entrant forward recovery (ADR-0105 D13
  promotion, ADR-0117 D8's ownership backfill, the org lifecycle transitions, and
  D10 master-data distribution #4585). One copy is engineering; four is platform
  debt, and the fourth author would have had to rediscover the invariant below
  from scratch.

  **New: `runMigrationJournal` (`@objectstack/core`).** Preflight runs every
  step's read-only validator before any step writes, so a plan that would fail at
  step 3 has not written step 1. Rows are chunked per the `bulk-write.ts`
  discipline; each chunk's writes run inside `engine.transaction()`. On failure,
  committed chunks are compensated newest-first, each in its own transaction. On
  restart, a rediscovered run resumes forward from the first chunk lacking
  `chunk_done`, or unwinds, per the plan's `onCrash` policy. Forward and
  compensate callbacks receive an `attempt` counter; `attempt > 1` means the prior
  outcome is UNKNOWN and the callback must recheck by natural key before
  re-writing — the same at-least-once contract `bulk-write.ts` already documents,
  reused rather than re-derived.

  **The invariant that carries the design:** `chunk_done(i)` is written **inside**
  the chunk's own transaction, so `done ⇔ committed` holds by construction;
  `chunk_started(i)` is written autonomously **before** it. That asymmetry is what
  gives `started ∧ ¬done` exactly one meaning — _the outcome is unknown_ — which
  is the only state a crash can leave and the only state recovery reasons about.
  Making both writes symmetric would look tidier and would destroy recovery.

  **New: `sys_migration_journal` (`@objectstack/platform-objects`).** Rows keyed
  `(run_id, seq)` under a unique index, so a resumed run that miscomputes its next
  sequence fails loudly rather than double-recording an event. Registered
  unconditionally alongside `sys_migration` because recovery must be discoverable
  with **zero host wiring** — a journal some kernels compose and others do not is
  a journal a boot scanner cannot rely on (ADR-0078). Distinct in grain from
  `sys_migration`, which holds one durable verdict per named migration; this holds
  many rows per _run_. Read-only over the API; writes go through the runner in
  system context.

  **The runner refuses rather than degrades**, in four places: the runtime cannot
  roll back; any preflight fails; the plan declares `onCrash: 'compensate'` but a
  step cannot compensate; or a resume's plan hash disagrees with the journal
  (resuming a changed plan would apply chunk boundaries the journal never
  described). A compensation failure halts and is journalled — never swallowed —
  and the run ends `failed`, not `compensated`, because a database in a state no
  clean story covers must not be reported as a tidy rollback.

  **`engineCanRollBack` is now shared.** The two-level probe (engine method AND
  default-driver `beginTransaction`) was the same condition written twice — here
  and in `batchData`'s atomic gate. It now lives in `@objectstack/core` and
  `@objectstack/metadata-protocol` imports it, as a type predicate so callers do
  not each re-narrow the optional member by hand. Two copies of "can this runtime
  actually roll back?" drift by one clause and leave one caller believing it has
  atomicity it does not have.

  Boot reconciliation and `os migrate resume` land separately; `findInterruptedRuns`
  is the discovery primitive they will consume, and is exported here.

  **Docs:** ADR-0118 (plugin-reachable transactions) is renumbered **ADR-0119**.
  It merged one day after an unrelated ADR-0118 (非用户 actor 的平台契约) and the
  earlier merge holds the number; citations of "ADR-0118 D1/D2/D3/D4" written
  before 2026-08-03 mean the renumbered record.

- ce92674: feat(email): declared email templates reach the mail service (#4509)

  Authoring an `email_template` was a silent no-op. `EmailService.sendTemplate`
  resolves `(name, locale)` against **`sys_email_template` rows**, and the only
  writers of those rows were the built-in auth templates plus a code-constructed
  `EmailServicePluginOptions.templates` that no bootstrapper ever passed. Every
  door an author can actually use — a stack's `emailTemplates:`, an
  `*.email-template.ts` file, Studio's metadata-admin list, `PUT /meta` — parked
  items in a metadata store nothing read back. So an admin could "fix" the
  password-reset email in Studio, get a success toast, and watch users keep
  receiving the built-in copy: ADR-0078 false compliance on **authentication
  mail**. This is the shape #3461 had for webhooks, closed the same way (ADR-0049
  enforce-or-remove, route: enforce).

  **`bootstrapDeclaredEmailTemplates`** now materializes declared templates into
  `sys_email_template` at boot. Each item is validated through
  `EmailTemplateDefinitionSchema.parse()` — the spec schema finally has a real
  consumer, defaults and all — and projected with `mapTemplateToRow`, which is the
  **same** mapping the built-in seeder uses, extracted and shared so the two doors
  cannot drift apart. A malformed template warns and is skipped rather than
  crashing boot.

  **Runtime writes take effect immediately.** Unlike `webhook`, `email_template`
  is `allowRuntimeCreate: true`, so a boot-only bridge would have left a Studio
  save inert until the next restart — the same bug, half-fixed. The plugin also
  subscribes to `email_template` metadata changes and re-materializes the single
  changed item; withdrawing a template deactivates its rows (across locales)
  rather than deleting them.

  **Three breaks sat on this path, not one**, and closing any two of them would
  still have shipped a template that never sent:

  - `@objectstack/objectql` never registered a manifest's `emailTemplates:` into
    the metadata registry at all — the key was simply missing from the generic
    ingestion list, so the bridge's own source was empty.
  - The built-in seeder left `managed_by` at the column's `'admin'` default, which
    made platform templates masquerade as admin-authored. Since the bridge refuses
    to overwrite admin rows, a built-in would have permanently outranked the
    template an app declared. Built-ins now stamp `managed_by: 'platform'`.
  - Nothing materialized declared metadata into rows.

  **Seed-not-clobber** mirrors `sys_webhook` (#3489) and `sys_sharing_rule`
  (#2909): `sys_email_template` gains `managed_by` / `customized`. Declared
  templates re-seed every boot as `managed_by: 'package'`; a row an admin created
  (`admin`) or edited (`customized`, stamped by a `beforeUpdate` hook) is never
  overwritten, so reworded transactional mail survives redeploys. This is a
  separate axis from `is_system`, which keeps its existing meaning for built-ins.

  The `email_template` liveness ledger flips from 13 dead properties to fully
  live, with an ADR-0054 runtime proof bound on `subject`
  (`email-template-materialization`): it boots a real stack, authors a template
  that overrides a built-in auth template, and asserts the **authored** wording is
  what reaches the transport.

- 0848bea: feat(spec)!: retire the overloaded `managedBy: 'system'` bucket — the residue becomes `system-data` (#3355)

  **FROM → TO: `managedBy: 'system'` → `managedBy: 'system-data'`.** One-line fix:
  rename the value. Nothing else about the object changes. `os migrate meta --from 16`
  rewrites it for you; stored metadata is CONVERTED by the ADR-0087 entry
  `object-managed-by-system-to-system-data`, never silently reinterpreted.

  ADR-0103 split the overloaded `system` bucket in v16, and it split it
  **additively**: the 20 engine-owned objects moved to the new explicit
  `engine-owned`, while the 8 admin/user-writable ones — the RBAC link tables
  (`sys_user_position`, `sys_user_permission_set`, `sys_position_permission_set`),
  `sys_user_preference`, `sys_approval_delegation`, and the three messaging config
  grids — stayed behind on `system`. That was the right move for a v16 that could
  not break authors, but it left the enum in a state where the surviving value
  names the half that had already moved out: `system` sitting on precisely the
  objects a user writes.

  That is not a cosmetic complaint. An author choosing between `system` and
  `engine-owned` had nothing in the vocabulary to choose _on_, so the bucket was
  re-overloadable by anyone reading the name in good faith — a model author most
  of all, since "system table" reads as "the engine owns this" in every other
  codebase. `system-data` states both boundaries explicitly: the **schema** is the
  platform's (versus `platform`, which is tenant-modelled), the **data** is the
  admin's or the user's (versus `engine-owned`, where the engine owns both).

  Because v16 already drained the engine side, the conversion is a **one-to-one
  mechanical value rename** with no judgement call — by construction every
  remaining `system` declaration is writable platform data.

  **One deliberate consequence — the affordance default flips.** `system` defaulted
  LOCKED and each of the 8 objects re-opened its writes with a
  `userActions: { create: true, edit: true, delete: true }` block. `system-data`
  defaults **WRITABLE** (full CRUD), because a bucket that exists to say "the data
  is yours" should not make every member ask for it back. Those blocks are now
  redundant and have been deleted from the 8 platform objects; keep `userActions`
  only to **NARROW**. If you converted an object that carried no `userActions`, it
  gains the generic affordances — the honest reading of the bucket it moved into.

  **No enforcement moves.** The engine write guard, the `DelegatedAdminGate`, RLS
  and permission sets all adjudicate off resolved affordances and the principal,
  never off the bucket name. `system-data` simply joins `platform` / `config` as a
  bucket the fail-closed guard does not cover, because a writable default has
  nothing to close on. The 8 objects passed that guard before (via `userActions`)
  and pass it now (via the bucket default), for the same resolved-affordance
  reason.

  `'system'` is **retired from the load path**: the enum rejects it with a
  prescription naming `system-data` and the one-line fix. Absorbing it silently at
  load would leave every author still writing the name this rename exists to
  unteach.

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

- c44dd5e: fix(objectql,platform-objects): 一次启动不能证明它自己随即违反的契约 —— ADR-0104 空库自证改为在本次启动写完数据后下结论 (#4769)

  一个全新部署第一次 `pnpm dev` 全绿(130 rows,0 ERROR),**第二次启动开始永久 10 条
  ERROR**、10 条种子记录写不进去。数据没变、代码没变,只是重启了一次;被拒的正是首启
  自己写进去的数据。

  根因不是哪个值算错了,是**顺序反了**。`sys_migration` 里那两行
  (`adr-0104-file-references` / `adr-0104-value-shapes`)带着
  `{"attested":"datastore-created-empty"}` 写在 `kernel:ready`,而同一次启动的 seed
  还在往里写行。「空库 ⇒ 没有历史值」这个推理成立的前提是**没有数据可写**,而它恰恰
  写在即将写入 130 行之前 —— 证明落笔那一刻是真的,一秒之后就不是了。于是首启在
  warn-first 下把数据留下,之后每一次启动读到这张证书、进入 strict、拒掉前任写下的
  那批行。

  ## 改了什么

  **证书必须覆盖它所声称的那批数据。**

  - **写入时机**:新库自证改为在**本次启动自己的数据落定之后**进行 ——
    `app:seeded`(inline seed 结算点,含超出 `OS_INLINE_SEED_BUDGET_MS` 后台跑完的
    那一半),不 seed 的 kernel 仍由 `kernel:ready` 兜底。两条路径进的是同一个幂等
    调用。
  - **写入前提**:`attestFreshDatastore` 先问引擎「这次启动放行过违反该契约的值吗」。
    引擎在 warn-first 放行每一个不合形状的值时,用**与 strict 模式完全相同的判定**把
    它记下来 —— 证明干净需要扫全库,证伪只需要一个反例,而这个反例写路径已经算出来
    了。任一条被本次启动证伪的迁移 id **不再自证**,部署维持 warn-first(真实且可
    恢复),并在日志里指名是哪个 `对象.字段` 让这道闸没关上、该跑哪条 `os migrate`。
    两行一起改:`adr-0104-file-references` 与 `adr-0104-value-shapes` 各自独立判定,
    一个 `cover` 不合形状不牵连 `location`,反之亦然。
  - **写入之后**:证书若在签发之后被本次启动推翻(操作员显式开了
    `OS_ALLOW_LAX_MEDIA_VALUES` / `OS_ALLOW_LAX_VALUE_SHAPES`,或后台 seed 收尾晚于
    签发),引擎**撤销**它 —— `verified_at` 清空、`blocking` 记上、`details` 保留原
    `attested` 并补一条 `revoked`。只针对**本次启动亲手创建的库**上的自证行:扫过全
    库的真实迁移证据不会被一次写入的观察推翻。

  **记忆化的第二张脸也一并修了。** 首启之所以「看起来是绿的」,一半靠的是进程内正好
  缓存了 `false`。`sys_migration` 在 kernel init 期间才注册,而第一条写可能赶在它之
  前 —— 那次读根本没读到账本,却被当成结论冻结了一整个进程的姿态。现在区分两种否定:
  **问过了、账本说不**(结论,照旧缓存)与**根本问不到**(未注册 / 查询抛错 —— 依旧
  答 `false`,闸依旧关着,但不记住,下一次写再问一次)。代价是账本存在之前每次写多一
  次 registry 查表(在任何查询之前就短路),账本可读之后即止。

  启动横幅那条 ADR-0104 建议行(`kernel:bootstrapped`)也改为直接读账本而非读记忆化
  结果 —— 否则一个刚刚自证成功的新部署会被告知去跑一条已经不需要跑的迁移。

  ## 对既有部署的影响

  - 数据本来就合规的新部署:行为不变,照旧 born-migrated,启动即 strict。
  - 种子数据不合规的新部署:**不再**发出那张假证书。首启与之后每一次启动一致地停在
    warn-first,并且每次都告诉你是哪一个值、跑哪条命令。数据本身该怎么修还是怎么修
    (showcase 的 `cover` 种子值在 #4774 单独跟踪)。
  - 已经跑过 `os migrate … --apply` 的部署:完全不受影响 —— 扫描得来的证据不经由本
    次改动的任何路径改写。

- 5966c2a: feat(spec)!: retire the five keys the advisory lint could never have warned about — mapping `extractQuery`/`errorPolicy`/`batchSize`, contextSelector `includeAll`/`placement` (#4509)

  Five authorable keys parsed, stored, and controlled nothing. What groups them is
  not the type they sit on but **why they had to go out in a major rather than
  after a deprecation cycle**: four of the five carry schema DEFAULTS, and a
  default materialises at parse time — so the liveness advisory lint cannot tell a
  value the author wrote from one the schema supplied. Marking them would have
  warned on every mapping and every selector in existence, which is why the ledger
  recorded them as `_authorWarnSkipped` instead. For a key in that state, removal
  is not the escalation after a warning. It is the only channel that ever reaches
  the author.

  **The retirement kit:**

  | FROM                                | TO          | Fix                                                                                                                                            |
  | ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | `mapping.extractQuery`              | _(removed)_ | Delete the key. Exports run through the ordinary query API (`POST /api/v1/data/:object/query`) — no exporter has ever read a mapping artifact. |
  | `mapping.errorPolicy`               | _(removed)_ | Delete the key. Error handling on the import path belongs to the import REQUEST's own options, not the stored mapping.                         |
  | `mapping.batchSize`                 | _(removed)_ | Delete the key. The write path sizes its own batches. **Do not relocate the value** — see below.                                               |
  | `app.contextSelectors[].includeAll` | _(removed)_ | Delete the key. Selectors are mandatory-scope; widen `optionsSource.filter` to widen the choices.                                              |
  | `app.contextSelectors[].placement`  | _(removed)_ | Delete the key. Selectors always render in the sidebar header; `'topbar'` placed nothing.                                                      |

  Run `os migrate meta --from 16` to rewrite existing sources automatically.

  **`includeAll` is the one worth reading twice.** It was not unread — it was
  deliberately _disobeyed_, and for a security reason. A context selector is a
  mandatory scope, so an "All" row would clear the scope on a surface that exists
  to be scoped; on Studio's package selector that means listing the platform's own
  system/cloud kernel packages to a developer who scoped to their own package. The
  renderer never offered an All row regardless of the flag, so `includeAll: false`
  hardened nothing and `includeAll: true` unlocked nothing. `STUDIO_APP` shipped
  authoring `includeAll: true` against a renderer that ignored it — that authoring
  site goes with the key in this change.

  **`batchSize` deliberately offers no rename.** `bulkActionDef.batchSize`,
  `connector.batchSize`, `sync.batchSize`, `offline.batchSize`, the seed loader's
  and the NoSQL driver cursor's are all LIVE and enforced — but each is a
  different key on a different type sizing its own path, and none of them sizes a
  mapping import. The rejection says so explicitly, because "removed" plus a
  familiar name one line away is exactly how a dead setting gets laundered into a
  live-looking one. Same trap `datasource.retryPolicy` had to defuse against
  `hook`/`job` `retryPolicy` (which spell the delay `backoffMs`) one issue
  earlier.

  Both schemas are `.strict()`, so the keys are deleted from the shape and
  rejected with a `guidance` prescription rather than tombstoned; their liveness
  rows are deleted rather than kept. The retired ALIAS spellings (`query`,
  `onError`, `errorHandling`, `errorMode`, `batch`, `chunkSize`, `skipErrors`,
  `showall`, `location`) route to the same prescriptions instead of suggesting a
  rename onto a key that is also gone.

  Registered as the ADR-0087 D2 conversion `mapping-inert-keys-removed` and an
  extension of `app-dead-authoring-keys-removed`, both wired into the protocol-17
  D3 chain step. The mapping conversion is scoped to the `mappings` collection
  deliberately — a stack-wide strip would delete an enforced `batchSize` from
  connector, sync, bulk-action and offline shapes.

  `datasource` reached zero dead keys in #4583; `mapping` reaches zero here.

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
- Updated dependencies [65f184b]
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
  - @objectstack/metadata-core@17.0.0-rc.2

## 17.0.0-rc.1

### Minor Changes

- 270650f: feat(migrate): a datastore created from empty attests its data migrations at creation (#3438, ADR-0104 2026-07-30 addendum)

  Deployment-level migration flags could only be recorded by running
  `os migrate`. That left a hole at the other end of a deployment's life: a
  database created on a version that already ships the migrations started **lax**
  and stayed lax until someone thought to run a command that, for them, converts
  nothing and finds nothing. Every new deployment re-entered the warn regime, so
  the warn regime would never die out — and, since #3459, every new deployment
  also kept every released file forever.

  A store the platform **creates from empty** now records
  `adr-0104-file-references` and `adr-0104-value-shapes` at that moment. Nothing
  to run; enforcement and collection are live from the first boot.

  **This is not version-gating in disguise.** The fact recorded — no legacy value
  is stored here — is _observed_: the store had no history at all. The platform
  attests only what it watched itself create, and the test is deliberately
  strict: every table made by this boot and **none found already present**. One
  pre-existing table anywhere, one datasource that was already there, one driver
  that cannot account for its schema sync — any of those and the deployment
  attests nothing and produces its evidence by scan, exactly as before. "Found
  empty" and "created empty" are not the same claim, and only the second is an
  observation.

  **New surfaces.** `IDataDriver.getSchemaSyncStats?()` (optional, purely
  observational: tables created vs found since connect — implemented by the SQL
  and in-memory drivers), `engine.wasDatastoreCreatedFromEmpty()`,
  `attestFreshDatastore()` in `@objectstack/platform-objects/system`, and
  `VALUE_SHAPES_MIGRATION_ID` / `CREATION_ATTESTED_MIGRATION_IDS` in
  `@objectstack/spec/system`. Attestation never overwrites an existing flag row
  and never throws into a boot: a failure leaves the deployment lax, which a
  migration run can still fix.

  **Upgrading changes nothing for an existing database.** It is non-empty when
  the platform reaches it, so it is never attested — run
  `os migrate files-to-references --apply` as before. Importing legacy values
  into an attested deployment is rejected loudly at the write path;
  `OS_ALLOW_LAX_MEDIA_VALUES=1` re-opens leniency while you diagnose.

- 68dea0b: feat(platform-objects,service-storage,cli): `sys_migration` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the storage service (#4243)

  The deployment-level data-migration flag ledger (`sys_migration`, #3617) was
  registered by `@objectstack/service-storage` as its first consumer. That was
  deliberate while the file migration was the only consumer, but the ledger now
  gates storage-independent behaviour too — `os migrate value-shapes` (#4235)
  and the fresh-datastore attestation (#4215) — and a non-file migration had to
  boot the whole storage plugin just so the kernel carried the table. Any kernel
  assembled without storage silently had no ledger at all, which read exactly
  like "migration not run" (both answer false) while actually meaning "ledger
  not installed".

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the ledger exists with the
  platform, independent of which optional services are composed. The
  fresh-datastore attestation (#3438, ADR-0104) moves with it: it is ledger
  bookkeeping, and its old home justified itself as "the service that registers
  `sys_migration`". Definition ownership is unchanged (`sys_migration` stays in
  `@objectstack/platform-objects` and in `PLATFORM_OBJECTS_BY_PACKAGE`); the
  flag helpers and readers are untouched.

  Consequences:

  - `@objectstack/service-storage` no longer contributes `sys_migration` to the
    manifest and no longer performs the fresh-datastore attestation. An embedder
    composing `StorageServicePlugin` on a hand-built kernel that relied on it
    for the ledger must compose `PlatformObjectsPlugin` (the plugin every
    supported assembly path already includes).
  - The CLI's `buildDataMigrationPlugins()` no longer boots storage for every
    gated migration — it registers `PlatformObjectsPlugin` always, and settings
    - storage only for `os migrate files-to-references` (`{ storage: true }`),
      the one migration that actually reconciles against the storage adapter.

- 64f8cbe: feat(platform-objects,service-settings,verify): `sys_secret` is platform infrastructure — registered by `PlatformObjectsPlugin`, not by the settings service (#4270)

  The environment's encrypted-secret store (`sys_secret`, ADR-0066 D2/④) was
  registered by `@objectstack/service-settings`, but it has three producer
  classes and only one of them is settings: the settings service's encrypted
  specifiers, the ObjectQL engine's own `secret`-field encryption
  (`encryptSecretFields`/`resolveSecret` — the generic write path of ANY
  business object carrying a `Field.secret()`), and the datasource credential
  binder. Unlike the `sys_migration` precedent (#4243), the failure posture is
  fail-CLOSED: on a kernel composed without settings, every insert/update of an
  object with a secret field threw — with an error message that told the
  operator to "Ensure the platform-objects (sys_secret) are registered", naming
  a package that did not register it.

  The registration now lives in `PlatformObjectsPlugin`
  (`@objectstack/platform-objects/plugin`) — the plugin `os serve` already
  auto-injects into every served kernel — so the store exists with the
  platform, independent of which optional services are composed, and the
  engine's fail-closed error message is true. Definition ownership is unchanged
  (`sys_secret` stays in `@objectstack/platform-objects` and in
  `PLATFORM_OBJECTS_BY_PACKAGE`); the settings service remains a producer and
  consumer through its `sys_secret`-backed secret store.

  Consequences:

  - `@objectstack/service-settings` no longer contributes `sys_secret` to the
    manifest (`settingsObjects` is now `[SysSetting, SysSettingAudit]`). An
    embedder composing `SettingsServicePlugin` on a hand-built kernel that
    relied on it for the `sys_secret` table must compose
    `PlatformObjectsPlugin` (the plugin every supported assembly path already
    includes). The move REPLACES the registration — nothing registers the
    object twice.
  - `@objectstack/verify`'s boot harness now composes `PlatformObjectsPlugin`,
    mirroring `os serve`'s auto-inject — which also means harness kernels now
    carry the `sys_migration` ledger + fresh-datastore attestation (#4243) the
    served assembly always had.

### Patch Changes

- 09e4547: feat(spec)!: reject unknown keys across the app shell and navigation tree (#4001 app step, PR B)

  Closes the last high-traffic authorable surface in the unknown-key strictness
  ratchet (flow + permission #4071, RLS / sharing / position #4099, approval
  #4119, App dead-key tombstones #4142). The app shell is the densest
  hand-authored surface on the platform — a navigation tree is where an author
  or AI is most likely to write a key from memory — so a silent strip here was
  the most probable instance of the #3405 trap.

  - **`AppSchema`** and its sub-schemas (`AppBrandingSchema`,
    `NavigationAreaSchema`, `AppContextSelectorSchema` + its `optionsSource` /
    `filter` blocks, `NavigationContributionSchema`) are `.strict()`.
  - **`NavigationItemSchema` becomes a DISCRIMINATED union on `type`.** This is
    what makes strict readable: a plain union of strict members answers one
    unknown key with an `invalid_union` aggregate naming all nine branches,
    while discriminating on `type` first yields a single `unrecognized_keys`
    issue against the branch the author actually wrote — at an exact path
    through nested `children` — and a mistyped `type` gets its own "Invalid
    discriminator value". Each variant carries its own suggestion pool, so a
    `url` item is never told about `dashboardName`.
  - **Still OPEN by design:** `PageNavItem.params`, `ComponentNavItem.params`
    and `ActionNavItem.actionDef.params` — per-target payloads owned by the
    page / component / action, not by the nav item.

  **A real defect the gate caught, in the platform's own app:** `ACCOUNT_APP`
  declared `defaultOpen` on three navigation groups. That was never a schema
  key — `expanded` is — so all three shipped COLLAPSED while their author
  believed they opened by default. Fixed at the producer (contract-first) and
  `defaultOpen` / `open` / `collapsed` / `isOpen` now alias to `expanded`.

  **Migration.** Any key now rejected was previously stripped and had no
  runtime effect. The error carries the fix; mappings include
  `menu`/`sidebar`/`tabs`/`items` → `navigation`, `title` → `label`,
  `permissions` → `requiredPermissions`, `sort`/`position` → `order`,
  `defaultOpen` → `expanded`, `args` → `params` (actionDef), `primary` →
  `primaryColor`, `url` → `endpoint` (options source), plus wrong-layer
  pointers: `pages`/`views`/`flows` are not App fields, and a payload named on
  the wrong variant points at the `type` that owns it.

  The `visibleWhen` → `visible` alias is the load-bearing one: ADR-0089 made
  `visibleWhen` canonical on view/page schemas, so an author who learned it
  there would silently lose a nav entry's visibility gate — a capability gate
  failing open, the worst shape of the silent-strip bug.

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

- e59786e: fix(spec): five exported symbols resolved to `any` — type the recursive schemas and gate it in CI (#4171)

  A recursive Zod schema needs an explicit annotation to break its circular
  inference, and five of them took the cheapest one available:

  ```ts
  export const NavigationItemSchema: z.ZodType<any> = z.lazy(() => …);
  export type NavigationItem = z.infer<typeof NavigationItemSchema>;   // → any
  ```

  It compiles, it validates correctly at runtime, and it silently throws the type
  away. `NavigationItem`, `FormField`, `JoinNode` and `NormalizedFilter` were all
  `any` on the published surface, plus `FieldNodeSchema` — which had no exported
  type alias yet, so `z.infer<typeof FieldNodeSchema>` was `any` and
  `QueryAST['fields']` with it.

  That is worse than a missing export. #4115 tells every consumer that a local
  declaration under a spec export's name must be replaced by a binding to the
  spec — and for these, obeying it **replaced a precise type with `any`**.
  objectui's `NavigationItem` is a 118-line documented interface (`recordId`
  template variables, `requiresObject` / `requiresService` capability gates,
  `filters` precedence); every key of it exists in the spec's version, so by every
  available signal it read as a redundant fork safe to delete. Deleting it swapped
  a fully-typed interface for `any`, with no compile error anywhere to say so.

  It is hard to catch by inspection because `any` is mutually assignable with
  everything, so the natural "are these the same type?" check answers _yes_ in both
  directions and recommends precisely the wrong action. Same failure family as
  #4075's `[key: string]: any` on `ActionDef`: a type that agrees with everything
  reads as agreement.

  **Now annotated with the real type**, using the pattern `QueryAST` already
  follows in `data/query.zod.ts` — infer the non-recursive part, tie the recursive
  knot in the type, so the keys stay derived from the schema instead of being
  hand-maintained beside it:

  ```ts
  const BaseXSchema = z.object({ …every non-recursive key });
  export type X = z.infer<typeof BaseXSchema> & { children?: X[] };
  export const XSchema: z.ZodType<X> = z.lazy(() => BaseXSchema.extend({
    children: z.array(XSchema).optional(),
  }));
  ```

  `z.infer` now resolves to the type it should always have been: `NavigationItem`
  is the nine-branch discriminated union, `FormField` the 30-key form-field
  contract (with `visibleOn` absent by construction — ADR-0089 D2 folds it into
  `visibleWhen` at the boundary), `JoinNode` and the newly exported `FieldNode`
  the query AST nodes, `NormalizedFilter` the normalized filter AST. Runtime
  validation is unchanged: every schema parses exactly what it parsed before.

  **What the types immediately caught**, none of it visible while they were `any`:

  - `account.app.ts` set `defaultOpen` on three nav groups — a key the spec has
    never declared. It worked only because objectui's `NavigationRenderer` still
    falls back to that legacy alias. Fixed at the producer per Prime Directive
    #12: the canonical key is `expanded`.
  - The MongoDB driver built its projection with `projection[field] = 1` over
    `query.fields`, so a relationship `FieldNode` would have keyed the projection
    on `"[object Object]"`. It now reads the node's field name.
  - `setup.app.ts`, `studio.app.ts` and `setup-nav.contributions.ts` are annotated
    with the PARSED `App` / `NavigationContribution` types but omitted
    `.default()`ed keys (`expanded`, `target`), as did the form fields
    `metadata-protocol` synthesizes for `getUiView` (`span`). Each now states the
    default it was relying on, matching what the surrounding literals already do
    for `active` / `isDefault` / `collapsible` / `collapsed` / `columns`.

  **Gated, not just fixed** (`check:exported-any`, wired into the required
  `TypeScript Type Check` job). `api-surface.json` records that an export _exists_
  and never what it _resolves to_, which is how these survived a whole major with
  every gate green. The new scan reads the built `.d.ts` a consumer's import
  actually resolves to and fails on any exported type that resolves to `any` — or
  any exported schema whose output is `any`, the root cause, and the only reason
  `FieldNodeSchema` was visible at all. Its `KNOWN_ANY` ledger is shrink-only and
  currently empty. It self-tests against the real zod first, so if the internals it
  reads are ever renamed the gate fails loudly instead of quietly passing
  everything forever.

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

- 7ce02eb: feat(spec,objectql): `IObjectQLEngine` — the `objectql` slot's contract exists, the class `implements` it, and the seven consumer-local stand-ins are deleted (#4251 B3)

  ObjectQL registers one instance under two names, and the ledger can finally say
  what each name means: `data` stays `IDataEngine` (the data plane), `objectql`
  now resolves to **`IObjectQLEngine`** — the full engine: schema access
  (`getSchema` / `getObject` / `registry`), actions (`registerAction` /
  `removeActionsByPackage` / `executeAction`), the hook/middleware seams
  (`registerHook` / `unregisterHooksByPackage` / `registerFunction` /
  `registerMiddleware` / `bindHooks`), the first-wins default runners and hook
  metrics, boot wiring (`registerDriver` / `setDatasourceMapping` /
  `registerApp`), and the ops probes (`checkDriversHealth` /
  `wasDatastoreCreatedFromEmpty` / `invalidateDataMigrationFlags`). The ledger
  test pins the new relation: `objectql` strictly widens `data`, deliberately no
  longer equal.

  **Why now, and why `implements` is the point.** The honest state for two
  batches was recorded on `DomainHandlerContext.getObjectQL`: ObjectQL is wider
  than `IDataEngine`, the wider part had no contract, and typing it `IDataEngine`
  would be "the more comfortable-looking lie". The interim discipline — each
  consumer declares the narrow slice it uses — produced seven local surfaces
  (`AppEngineSurface`, `EngineRegistrySurface`, `EngineExtensionSurface`,
  `SecurityEngineSurface`, `FreshDatastoreEngine`, the dispatcher's inline
  `checkDriversHealth` slice, the `getObjectQL: any` itself). Each was honest and
  each was an UNCHECKED claim: `getService<Surface>('objectql')` is an assertion,
  so an engine rename would have broken every consumer at runtime with zero
  compile errors. `ObjectQL implements IObjectQLEngine` converts all of them into
  one compiler-verified claim. All seven stand-ins are deleted; consumers import
  the one declaration. `getObjectQL` is typed `Promise<IObjectQLEngine | null>`
  end to end, closing the oldest documented `any` in the dispatcher.

  **Evidence bar unchanged.** Every declared member has a cross-package consumer
  reaching it through the slot; engine members without one (e.g. `triggerHooks`,
  cross-package only in tests) stay off until a caller appears. The registry view
  (`EngineSchemaRegistryView`) declares exactly the eight members consumers use.

  **`_registry` never leaves the engine package now.** plugin-security's
  declared-metadata readers (`readDeclared`, permission-set projection, suggested
  audience bindings) reached ObjectQL's private `_registry` field through `any` —
  the same private reach `/me/apps` had in B2, five more times. All migrated to
  the public `registry` getter the contract declares, test doubles included.

  **`IMetadataService` gains `subscribe?` / `loadMany?`** — implemented by
  `MetadataManager` beside `watch` all along, reached through the slot only via
  `any` by ObjectQLPlugin's metadata bridge (the re-sync keeping runtime-authored
  hooks/actions live). With them declared, the bridge's six `metadata` lookups
  and metadata-protocol's `objectql` lookup carry contract types, and both files
  leave the grandfather list entirely: baseline **167 → 159 sites, 36 → 34
  files**.

- d6938bf: fix(spec): the remaining six recursive schemas name both type parameters, and the authoring artifacts stop spelling out defaults (#4195)

  #4221 fixed `NavigationItemSchema` — the worst instance, and the one with a
  reproducible "`defineApp` compiles `navigation: [42, 'nonsense']`" demo. This
  finishes the sweep: **six more schemas** had the same shape, and the authoring
  artifacts that #4171 had to work around can now be typed honestly.

  `z.ZodType` takes `<Output, Input>` and `Input` defaults to `unknown`, so naming
  only the first parameter leaves `z.input` of anything embedding that schema at
  `unknown`. Measured with a type probe:

  |                                        | was         | now                       |
  | -------------------------------------- | ----------- | ------------------------- |
  | `QueryInput['joins']`                  | `unknown[]` | `JoinNodeInput[]`         |
  | `QueryInput['fields']`                 | `unknown[]` | `FieldNode[]`             |
  | `z.input<typeof FormFieldSchema>`      | `unknown`   | `FormFieldInput`          |
  | `z.input<typeof QuerySchema>`          | `unknown`   | `QueryInput`              |
  | `z.input<typeof StateNodeSchema>`      | `unknown`   | `StateNodeConfig`         |
  | `z.input<typeof ValidationRuleSchema>` | `unknown`   | `BaseValidationRuleShape` |

  New exported types: `FormFieldInput`, `JoinNodeInput`, `NavigationContributionInput`.
  `FilterCondition`, `NormalizedFilter` and `FieldNode` carry no `.default()` or
  `.transform()`, so their input is their output and the second parameter is the
  first.

  **The `z.ZodType<T>` single-parameter form is now absent from the codebase.**

  ## 26 hand-written defaults deleted

  This is the half #4221 left on the table. #4171 had to spell out
  `expanded: false` (×16) and `target: '_self'` (×10) across `setup.app.ts`,
  `studio.app.ts` and `setup-nav.contributions.ts`, because those artifacts are
  annotated with the PARSED type where a `.default()`ed key is required — and
  retyping them to the input surface would have traded eight loud errors for no
  checking at all.

  With `NavigationItemInput` landed (#4221) and `NavigationContributionInput`
  added here, they are annotated `AppInput` / `NavigationContributionInput`, the
  defaults are defaults again, and the literals are checked for the first time.
  Net across those four files: 21 lines added, 54 removed.

  Verified live, not nominal: a literal omitting `expanded`/`target` compiles, and
  one writing `defaultOpen` — the non-spec key #4171 found in `account.app.ts` —
  is a compile error whose suggestion list names `expanded`.

  ## Two typed with a documented caveat

  `StateNodeSchema` and `ValidationRuleSchema` reuse their hand-written type for
  both parameters: exact on the input side, loose on the output side.
  `StateNodeConfig` marks `type` optional though `.default('atomic')` makes it
  always present; `BaseValidationRuleShape` carries a `[key: string]: unknown`
  index signature. Both were already that loose — input went from `unknown` (types
  nothing) to a real type, output is untouched. Making them exact means deriving
  those types from their schemas instead of maintaining them beside one, which is
  separate work; the caveat is written at each declaration rather than left for a
  reader to find.

  ## Why there is still no CI gate for this

  Worth recording, since #4195 proposed one: extend `check:exported-any` to fail on
  "output precise but input `unknown`". Measured after this change — exactly two
  schemas match, `TranslationItemSchema` and `InlineActionSchema`, and **both are
  correct**: they are `z.preprocess(...)`, where an `unknown` input is zod's
  semantics rather than a missing annotation. Separating those from a genuinely
  missing parameter needs heuristics on emitted type names, and per the rule in
  that script's own header — zero false positives, so red keeps meaning broken — a
  gate that cannot be made reliable is worse than none. #4221's
  `app.nav-type-assertions.ts` is the better pattern where it applies: pin the
  contract at compile level rather than infer intent from shape.

- d92c72d: fix(lint,runtime,core): the slot-lookup guard sees the split-declaration form — the shape that made the ratchet look cleaner the more it was used (#4251)

  The three selectors from #4321 all key off the erasure and the lookup being in
  ONE expression. Split them and every selector misses:

  ```ts
  let ql: any;
  try {
    ql = ctx.getService("objectql");
  } catch {
    /* optional */
  }
  ```

  Selector 1 needs the call inside the declarator (this declarator has no init),
  selector 2 needs `as`, selector 3 needs a type argument. The contract is erased
  exactly as in `const ql: any = ctx.getService(…)`.

  **Why this could not wait for the batches.** The baseline's monotonicity check
  means a file that leaves the grandfather list can never be re-added. So every
  batch converted more of this shape from "grandfathered" into "lint covers this
  file and says nothing" — B2 alone moved `plugin-security/security-plugin.ts`
  into that state. A ratchet that reports a cleaner number the more you sweep is
  the #4342 failure wearing different clothes, and the fix only gets more
  expensive per batch shipped.

  **It is a rule, not a fourth selector, and that is the whole finding.** esquery
  can match `AssignmentExpression:has(CallExpression[…])`, but it cannot tell
  which declaration the assigned identifier resolves to — so it would equally
  flag the correctly-typed form this work line exists to produce (`let
i18nService: II18nService | undefined; i18nService = …`, 8 such sites today in
  runtime/app-plugin.ts, service-automation and metadata-protocol). Resolving the
  identifier needs SCOPE analysis. That is cheap and needs no type information, so
  this stays out of the typed-lint pass the KNOWN RESIDUAL still waits on — but it
  is a rule, and the earlier "just one more selector" estimate was wrong.

  Verified against exactly that: the rule flags all 16 real sites and none of the
  8 correctly-typed lookalikes.

  **Scale.** The baseline goes 140 → **169 sites** with the file count unchanged
  at 37: 29 sites were already inside grandfathered files and simply invisible.
  16 more could NOT be grandfathered (12 in files earlier batches had cleared, 3
  in files never listed, 1 the regex sweep had missed) and are typed here —
  `runtime/app-plugin.ts` ×5, `core/fallbacks/authored-translation-sync.ts` ×2,
  `plugin-security/security-plugin.ts` ×2, `cloud-connection/{runtime-config,
marketplace-proxy}-plugin.ts` ×3, `platform-objects/src/plugin.ts` ×2,
  `runtime/http-dispatcher.ts`, `runtime/domains/ai.ts`. No baseline key was
  added; the key set still only shrinks.

  Contracts where they exist (`IAIService`, `IJobService`, `IMetadataService`,
  `II18nService`, `IDataEngine`, `IHttpServer`), named local surfaces where they
  do not — `AppEngineSurface`, `SecurityEngineSurface`, `RawAppHost`,
  `EnvRegistrySurface`, `FreshDatastoreEngine`, `AuthoredTranslationSink`. Two of
  those record something worth naming: `IHttpServer` has no `getRawApp()` (the
  contract is framework-agnostic and the raw app is Hono's own handle), and
  ObjectQL's `_defaultBodyRunner` / `_defaultActionRunner` have no public reader
  at all — the engine attaches them via `(this as any)` and publishes nothing,
  while `getHookMetricsRecorder()` exists for exactly that question about the
  metrics recorder. Declared rather than laundered through `any`, and filed.

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
- Updated dependencies [2e836de]
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
  - @objectstack/metadata-core@17.0.0-rc.1

## 17.0.0-rc.0

### Major Changes

- 9f060e5: chore(deps)!: better-auth 1.7.0-rc.2 (account identity restructuring) + the
  production-dependency batch from #3517

  **better-auth 1.7.0-rc.1 → 1.7.0-rc.2** across the family (`better-auth`,
  `@better-auth/core`, `@better-auth/oauth-provider`, `@better-auth/sso`, and the
  adapter/telemetry overrides). `@better-auth/scim` deliberately stays on
  1.7.0-rc.1 — rc.2 replaces its whole model (code-defined connections; the
  `scimProvider` model and the generate-token endpoint are gone), which is a
  feature migration, not a version bump. Its peer range accepts rc.2 core, and the
  advisory that forced the original pin (GHSA-j8v8-g9cx-5qf4) is still fixed.

  **BREAKING — account identity.** better-auth renamed `account.accountId` to
  `account.providerAccountId` and added a REQUIRED `account.issuer`; sign-in now
  resolves accounts by `(issuer, providerAccountId)`.

  - FROM `fields: { accountId: 'account_id' }` → TO
    `fields: { issuer: 'issuer', providerAccountId: 'account_id' }`. The provider
    account id keeps its `account_id` column — only the better-auth-side name
    moved — and `sys_account` gains an `issuer` column.
  - FROM `internalAdapter.createAccount({ providerId, accountId, … })` → TO
    `createAccount({ providerId, issuer, providerAccountId, … })`. A local
    password account carries the issuer better-auth mints for itself,
    `local:credential`.
  - FROM `client.auth.accounts.unlink({ providerId, accountId })` → TO
    `unlink({ accountId })`, where `accountId` is now the account ROW id (the `id`
    from `accounts.list()`), matching better-auth's narrowed body.
    `accounts.list()` returns `issuer` + `providerAccountId` in place of
    `accountId`.

  **Existing deployments:** rows written before 1.7 have no issuer and are
  invisible to sign-in until stamped. The auth plugin now runs an idempotent
  boot-time backfill that stamps what it can derive — `local:credential` for
  password accounts, `local:oauth:<providerId>` for configured social providers,
  and the registered IdP's real `iss` from `sys_sso_provider` for federated ones.
  Accounts from a federated IdP that is no longer registered cannot be derived;
  they are logged with their provider id and row count rather than guessed, and
  those users cannot sign in through that provider until the row is stamped with
  the IdP's issuer or removed so a fresh login re-links it.

  **Also required by 1.7:** `SecondaryStorage` gained two mandatory methods, both
  now implemented over the kernel cache service — `getAndDelete` (single-use
  verification values) and `increment` (fixed-window rate-limit counter;
  `rateLimit.storage: 'secondary-storage'` throws at boot without it).

  The rest of #3517's production-dependency batch rides along: `@oclif/core`
  4.13.0, `@hono/node-server` 2.0.12, `hono` 4.12.32, `tar` 7.5.22, `jose` 6.2.4,
  `pinyin-pro` 3.28.2, plus the private docs app's fumadocs/next/react bumps.

### Minor Changes

- fdb4f50: feat(migrate): `os migrate files-to-references` — a data migration with a self-check, gated per deployment (#3617)

  The ADR-0104 file-as-reference migration ships as a command a deployment runs
  against its own database, and the deployment-level flag it records is what may
  later authorise irreversible behaviour — never the platform version.

  ```bash
  os migrate files-to-references           # dry run: reports, writes nothing
  os migrate files-to-references --apply   # converts, verifies, records the flag
  ```

  The run backfills legacy file-field values (inline metadata blobs, own-resolver
  URLs, `data:` URIs) into owned `sys_file` references, reconciles the ownership
  ledger against what records actually hold, and — only on an `--apply` run whose
  reconciliation reports **zero blocking discrepancies** — records
  `sys_migration { id: 'adr-0104-file-references', verified_at, blocking: 0 }`.

  **Why a flag rather than a release note.** ObjectStack is a development
  platform: third-party deployments upgrade on their own schedule and their data
  is not observable by anyone else, so no release-side soak can vouch for them.
  The evidence has to be produced where the data is. Consequences:

  - Installing a new version never starts deleting bytes. Running the migration
    and passing its self-check is the consent.
  - Not run, or not passed → files are retained forever. Wasted storage, zero
    data loss.
  - A later failing run **clears** `verified_at`: a deployment whose data has
    drifted closes its own gate.
  - A dry run writes nothing at all — not the conversions, and not the flag,
    even when the self-check would pass.
  - External URLs stay advisory. They are not `sys_file`s, so they can never
    enter collection; whether to remodel them as a `url` field is the app
    author's decision (ADR-0104 R7), not a gate.

  Ships alongside:

  - `@objectstack/spec` — `DataMigrationFlagSchema`, `FILE_REFERENCES_MIGRATION_ID`,
    and the single `isDataMigrationFlagVerified` predicate both future consumers
    (collection #3459, strict value-shape #3438) read, so the two gates cannot
    disagree about the same fact.
  - `@objectstack/platform-objects` — the `sys_migration` object plus
    `readDataMigrationFlag` / `isDataMigrationVerified` / `recordDataMigrationRun`.
    Reads fail toward "not verified": a gate that cannot read its evidence stays
    closed.
  - `@objectstack/objectql` — a read may now opt out of file-reference expansion
    via the spec's `RAW_FILE_VALUES_CONTEXT_KEY`, and the storage service's
    bookkeeping/scan reads do. Without it the read resolver rewrites stored ids to
    their expanded form before the reconciliation sees them, which reports held
    references as absent — noisy `stale_owner` findings, and a missed
    `unowned_reference` would have been a false pass of the collection gate.

- 1bd5652: feat(auth): give ADR-0105 D8's scope-bounded issuance a caller — the
  `delegated_admin` org role, capped so it cannot mint authority (#3697)

  D8 authorizes invitation _placement_ against the issuer's `adminScope`
  (ADR-0090 D12), so a delegated plant admin may invite only into their own
  subtree. That gate is implemented, unit-proven and reachable — but no principal
  could reach it in a state where it did anything:

  - better-auth grants `invitation: ["create"]` to `owner` and `admin` only
    (`memberAc` holds `invitation: []`, which every other registered role
    inherits);
  - under a wall-enforcing posture, owners and admins are auto-elevated to
    `organization_admin` (`auto-org-admin-grant.ts`), which carries the wildcard
    `modifyAllRecords` that makes `isTenantAdmin()` true — and the gate
    short-circuits on tenant admins.

  The two sets were disjoint. Issuance placement was bounded by the Layer 0 org
  wall (real, and correct) but never by `adminScope`, so D8's motivating story —
  "a plant admin invites into their own subtree without a platform admin
  finishing the job" — could not happen.

  **Two pieces, and they only ship together.**

  **1. The role.** `delegated_admin` is now registered with the organization
  plugin as `memberAc.statements` plus `invitation: ["create"]` — the one
  membership grade that may reach `/organization/invite-member` without being an
  org admin. Deliberately _not_ `invitation: ["cancel"]`: better-auth's cancel
  route checks the permission with no inviterId attribution, so it would mean
  "cancel anyone's pending invitation in the org".

  The role carries no ObjectStack authority by construction — `mapMembershipRole`
  passes it through as a position name, and with no `sys_position_permission_set`
  binding that name resolves to nothing. Role = _can reach the endpoint_;
  `adminScope` = _what the endpoint permits_.

  `sys_member.role` and `sys_invitation.role` each gain `delegated_admin` as a
  fourth option. Those selects are **enforced on write** — better-auth's own
  invitation and membership inserts are validated like any other row — so
  registering the role with the org plugin without listing it in both would have
  produced a role nobody could hold and nobody could hand out
  (`ValidationError: role must be one of: owner, admin, member`). That is exactly
  how the end-to-end regression caught it, twice; neither unit test could. The
  three non-English translation bundles carry the English label for the new option
  until localized.

  **2. The role cap**, in the framework's own `beforeCreateInvitation` hook,
  beside the D8 placement gate. Registering the role alone would have been a
  four-step privilege escalation: better-auth's only role-level cap on _what role
  you may invite someone as_ is its `creatorRole` check (default `owner`), which
  blocks inviting an **owner** but not an **admin** — and an accepted `admin`
  membership is auto-elevated to `organization_admin` → `isTenantAdmin()`. A
  subtree-scoped delegate could have manufactured a tenant admin, with every
  existing defense off the path (`sys_member` is not a `GOVERNED_OBJECT`, and the
  acceptance-time membership write runs under better-auth's context, not the
  issuer's).

  The cap refuses an invitation whose role outranks the issuer's own, and
  restricts a below-admin issuer to plain `member` — not merely "not admin/owner",
  because an app-registered role projects into `current_user.positions` and may be
  bound to permission sets, making it a capability channel too. A delegate's
  channel for capability is the invitation's _placement_ intent, which the D12
  gate allowlists position-by-position. The cap applies to every invitation,
  placement-carrying or not (the escalation is independent of placement), and
  fails closed: an issuer role that cannot be resolved confers nothing above a
  plain member.

  **What changes for deployments.** One new class of principal exists: members
  holding the `delegated_admin` org role, who can invite into the org — as
  `member` only, into the subtree their `adminScope` allows. It is opt-in twice
  over (someone must set the membership role _and_ grant an adminScope set), so a
  default deployment changes not at all. Org owners and admins are unaffected.

  Also exported: `MEMBERSHIP_ROLE_DELEGATED_ADMIN` from `@objectstack/spec`, so
  console and control-plane surfaces name the role from one place.

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

- 0045682: feat(auth)!: membership grade is not a capability channel — the `sys_member.role`
  vocabulary is closed (ADR-0108, #3723)

  `sys_member.role` answers "what is your standing in this organization". It does
  not answer "what may you do" — that is what positions are for. One column was
  answering both.

  `resolve-authz-context` projects EVERY value stored in `sys_member.role` into
  `current_user.positions`, alongside the rows read from `sys_user_position`. So a
  business role handed out through the membership role _was_ capability — granted
  with none of the position system's controls: no `granted_by`, no ADR-0091
  validity window, no BU-subtree check, no `assignablePermissionSets` allowlist.
  That is what ADR-0057 D4 ruled out ("feed the names to better-auth **only** so
  invitations are accepted — **never as the authority for RBAC**"), what
  ADR-0090 D3's word ban restates (distribution = `position`), and what
  ADR-0095 D3 keeps out of the enforcement path.

  The vocabulary is therefore closed to the four framework-owned names:
  `owner` / `admin` / `delegated_admin` / `member`.

  **BREAKING — `additionalOrgRoles` is removed** from `AuthManagerOptions` and
  `AuthPluginOptions`, together with `plugin-auth/src/org-roles.ts` in full
  (`collectStackOrgRoles`, `collectRegisteredOrgRoles`,
  `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
  `withMembershipRoleOptions`, `membershipRoleLabel`, `orgRoleNames`,
  `MEMBERSHIP_ROLE_OBJECTS`, `OrgRoleDescriptor`, `OrgRoleInput`,
  `OrgRoleLogger`) and the `kernel:ready` derivation hook that fed them. From
  `@objectstack/spec`, `MEMBERSHIP_ROLE_NAME_PATTERN` and
  `MEMBERSHIP_ROLE_NAME_MIN_LENGTH` are removed — they existed only to validate
  app-supplied names. A TypeScript error is the intended failure: an option that
  is silently ignored is `declared ≠ enforced` one more time.

  FROM → TO:

  ```diff
  - new AuthPlugin({ additionalOrgRoles: ['sales_rep'] })
  + new AuthPlugin({ /* nothing — declare `sales_rep` as a position */ })

  - POST /organization/invite-member { email, role: 'sales_rep' }
  + POST /organization/invite-member { email, role: 'member',
  +                                    businessUnitId, positions: ['sales_rep'] }
  ```

  For an existing member, assign the position through `sys_user_position` (the
  governed write path). Invitation placement (ADR-0105 D8) is the one-step
  admission flow: issuance is authorized against the issuer's `adminScope` by
  dry-running `DelegatedAdminGate`, and acceptance writes real
  `sys_user_position` rows with a `granted_by` stamp. It reaches **further** than
  what it replaces — a delegated admin may use it within their subtree, where the
  membership-role route was open to org admins only (the invitation role cap holds
  anyone below admin grade to plain `member`).

  An invitation naming an app role now fails at better-auth's door with
  `ROLE_NOT_FOUND`, before any row is written.

  This reverses two changesets that were never consumed into a release
  (`app-org-roles-storable`, `auth-org-roles-self-derived`), so no published
  version ever offered the behaviour; both are removed rather than shipped and
  retracted in the same changelog. A pre-existing deployment could only have
  stored a custom value by direct DB write.

  Also derived rather than transcribed: `@objectstack/lint`'s `MEMBERSHIP_TIERS`
  now reads `BUILTIN_MEMBERSHIP_ROLES` from `@objectstack/spec`. The hand-kept
  copy carried `guest`, which the `sys_member.role` select has never offered — an
  approver authored as `{ type: 'org_membership_level', value: 'guest' }`
  resolved to nobody and the lint whose whole job is to catch that stayed silent.

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

- aa8b847: feat(authz): scoped invitations — placement intent on an invitation, gated by
  the issuer's adminScope and applied on acceptance (ADR-0105 D8)

  An invitation may now carry PLACEMENT INTENT — the business unit the invitee
  lands in and the positions they are assigned — so a delegated (plant) admin's
  invitee arrives already in the right unit and role instead of waiting on a
  platform admin. This closes the structural gap ADR-0105 D8 names for
  `single`-posture deployments and is the natural admission path under `group`.

  The two halves ship together, deliberately:

  - **Issuance is authorized** against the ISSUER's `adminScope` (ADR-0090 D12),
    by dry-running the existing `DelegatedAdminGate` against the very
    `sys_user_position` rows the acceptance would write. The gate is reused
    verbatim — no second copy of the subtree/allowlist logic to drift — so an
    invitation can never place what its issuer could not have assigned directly.
    Without that gate the feature would be an escalation hole: the built-in
    `organization_admin` is deliberately read-only on the RBAC tables precisely
    so a fresh org admin cannot rebind themselves, and applying an unchecked
    invitation payload under system context would hand that authority straight
    back.
  - **Acceptance applies it**, idempotently and failure-isolated: a replayed
    acceptance converges instead of duplicating assignments, and a placement
    miss never undoes a valid membership.

  Surface:

  - `sys_invitation` gains `business_unit_id` + `positions` (ADR-0092 extension
    fields, registered in the D7 collision-guarded whitelist; NOT generically
    editable — placement is set only at issuance, through the gate).
  - `@objectstack/plugin-security` registers the `invitation-placement` service
    (`assertIssuable` / `apply`).
  - `@objectstack/plugin-auth` wires better-auth's `beforeCreateInvitation` /
    `afterAcceptInvitation` to it. **Fail closed**: an invitation that requests
    placement in a deployment without the delegated-administration runtime is
    refused, never silently placed unchecked.

  Existing invitations are unaffected — an invitation without placement intent
  never consults the gate and behaves exactly as before.

### Patch Changes

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

- d44dbfa: feat(spec)!: shrink the `ApiMethod` enum to the six primitives — legacy values are stripped at parse, never honored (#3543, P2 of #3391)

  **BREAKING** (the `!` marker and this changeset are the breaking-change
  record; the train ships as the v17 major — see the `v17-rc-anchor` changeset):
  the authored `enable.apiMethods` enum is now exactly the six
  primitives (`get`, `list`, `create`, `update`, `delete`, `bulk`). The eight
  legacy values (`upsert`, `aggregate`, `history`, `search`, `restore`, `purge`,
  `import`, `export`) are no longer authorable — they are DERIVED effective
  operations, resolved by the server's single derivation table.

  **Migration (FROM → TO).** Replace each legacy value with the primitives it
  derives from, then de-duplicate; if the result names all six primitives, delete
  the `apiMethods` key entirely (equivalent to default-open, and it tracks future
  primitives):

  | FROM (legacy) | TO (primitives)      | why                                            |
  | ------------- | -------------------- | ---------------------------------------------- |
  | `upsert`      | `create`, `update`   | upsert ⊆ create ∧ update                       |
  | `import`      | `create`, `update`   | import ⊆ create ∨ update (writeMode-precise)   |
  | `export`      | `list`               | export ⊆ list                                  |
  | `aggregate`   | `list`               | aggregate ⊆ list                               |
  | `search`      | `list`               | search ⊆ list ∧ `searchable`                   |
  | `history`     | `get`                | history ⊆ get ∧ `trackHistory`                 |
  | `restore`     | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |
  | `purge`       | _(delete the value)_ | never derives — `enable.trash` retired (#2377) |

  Reporter codemod: `node scripts/codemod/apimethods-legacy-to-primitives.mjs`
  (scans, reports the exact replacement per site, and flags whitelists the
  mapping would WIDEN so the edit stays reviewable).

  **Stored metadata keeps parsing — permanent tolerance, narrowing only.** Real
  metadata does not upgrade in lockstep with the spec, so a stored legacy value
  is NOT a parse error: `stripLegacyApiMethods` (new export) strips it with a
  FROM→TO warning (canonicalize-and-warn). Stripping only ever NARROWS exposure —
  the derivation table still grants every legacy verb that derives from the
  primitives you declared. Two cliffs to know:

  1. A whitelist of ONLY legacy values (e.g. `['upsert']`) strips to `[]` =
     **deny-all** — the object's API closes instead of widening. The strip
     warning and the objectql registration diagnostic both call this out.
  2. A legacy value NOT derivable from your declared primitives (e.g.
     `['get', 'export']` — export needs `list`) was honored by the P1
     "explicit wins" path and is now denied. Declare the underlying primitive.

  **Type split — authored vs effective vocabulary.** `ApiMethod` (authored) is
  now six values; the NEW `ApiOperation` type / `ApiOperationSchema` /
  `API_OPERATION_ORDER` (fourteen values, byte-stable pre-shrink wire order)
  carry the EFFECTIVE vocabulary. The wire contract is unchanged: the 405
  `allowed` array and `/me/permissions` `apiOperations` still serialize derived
  verbs (`export`, `search`, …), and `EffectiveObjectPermissionSchema.apiOperations`
  now validates against `ApiOperationSchema`. `EffectiveApiMethods.explicitLegacy`
  is removed (nothing is honored verbatim anymore); `API_METHOD_ORDER` remains as
  a deprecated alias of `API_OPERATION_ORDER`.

  **Fail-closed tightening (#3545):** a PRESENT but non-array `apiMethods` (only
  producible by a raw/out-of-band metadata write) now resolves to `deny-all`
  instead of unrestricted — a policy that exists but cannot be read fails CLOSED.

  **Published JSON Schema diverges deliberately:** `data/ApiMethod.json` is the
  strict six-value enum (a `z.preprocess` is not representable in JSON Schema),
  so external JSON-Schema validators reject legacy values that the zod parse
  would strip-and-warn. Treat the JSON Schema as the authored contract; the zod
  tolerance exists for stored metadata.

  **objectql:** the P1 "explicit wins" transition is reclaimed —
  `warnDeprecatedExplicitApiMethods` is replaced by `warnStrippedLegacyApiMethods`
  (a permanent per-object diagnostic for schemas that reach the registry without
  passing through Zod; the parse-time strip warning carries no object name).

  **platform-objects:** whitelist audit — `sys_business_unit`,
  `sys_business_unit_member` (P1's explicit `import`/`export` reclaimed) and
  `sys_user_preference` dropped their `apiMethods` entirely (each named all six
  primitives = default-open). Read-only and deny-all whitelists are unchanged;
  the seven `[]` declarations are deliberately KEPT as defense-in-depth alongside
  `apiEnabled: false`.

- bc17d39: fix(auth): provision the better-auth 1.7 columns `sys_team` / `sys_team_member` / `sys_two_factor` were missing (#3624)

  better-auth 1.7.0-rc.1 added fields to three models that the platform objects
  never provisioned and `auth-schema-config.ts` never mapped. Because an unmapped
  field keeps its camelCase name, the adapter emitted columns no table had:

  | model        | field                                     | column now provisioned                                      |
  | :----------- | :---------------------------------------- | :---------------------------------------------------------- |
  | `team`       | `memberCount`                             | `sys_team.member_count`                                     |
  | `teamMember` | `membershipKey`                           | `sys_team_member.membership_key`                            |
  | `twoFactor`  | `failedVerificationCount` / `lockedUntil` | `sys_two_factor.failed_verification_count` / `locked_until` |

  The team pair broke org creation outright. The organization plugin's team
  sub-feature is on by default, so `POST /api/v1/auth/organization/create`
  auto-creates a default team — and that insert died with `table sys_team has no
column named memberCount` _after_ the organization row had already committed.
  Callers got an HTTP 500 on top of a half-created org: a real org row with no
  default team behind it. Every multi-org deployment's create-org flow hit this.

  The two-factor pair broke the 2FA lockout path the same way: better-auth
  guard-increments `failedVerificationCount` on each wrong code and stamps
  `lockedUntil` past the threshold, so a wrong code 500'd instead of being
  counted. All four columns are better-auth's own state — provisioned, readable,
  and never written from the ObjectStack side.

  Existing environments pick the columns up through the driver's additive schema
  sync; no data migration is needed. `member_count` backfills to 0 and
  better-auth's own `syncTeamMemberCount` reconciles it on the next membership
  change, and `membership_key` stays null on pre-upgrade rows, which better-auth
  tolerates by falling back to the `(team_id, user_id)` pair.

  A new drift gate (`better-auth-schema-parity.test.ts`) now asserts that every
  column the installed better-auth version can write exists on the platform
  object backing it, across the auth manager's whole model surface. The ADR-0092
  D7 guard only ever caught _collisions_ between our extension fields and
  better-auth's, so a bump that adds a brand-new field passed the build and failed
  at runtime — twice now, counting the 1.7 `oauthAccessToken.authorizationCodeId`
  regression. The next one fails the build instead.

- 524151c: fix(i18n): clear the accumulated drift in the generated translation bundles

  The committed bundles had fallen behind the spec on three independent axes.
  `os i18n extract` (merge mode — every existing translation is preserved)
  reconciles all of them:

  **Keys the spec no longer has**, still carrying translations in
  `*.metadata-forms.generated.ts`. All three were removed deliberately and are
  now _rejected_ by the schema, so their entries were dead weight:

  - `capabilities.trash` / `capabilities.mru` — `enable.trash`/`enable.mru`
    retired in the 16.x line (#2377), with tombstone guidance in
    `UNKNOWN_KEY_GUIDANCE`.
  - agent `visibility` — removed 2026-07 (#1901).

  **Keys the spec gained** but the bundles never learned: the
  `summaryOperations.*` sub-fields (`object` / `function` / `field` /
  `relationshipField` / `filter`), and `sys_invitation.business_unit_id` /
  `positions` from the ADR-0105 D8 placement work.

  **Objects stuck on empty strings.** `sys_migration`'s labels and help text were
  committed as `""` in the ja-JP and es-ES bundles, which renders as _blank_ in
  those locales rather than falling back to anything readable. They now carry the
  schema text like every other untranslated key.

  No API or schema change — this only affects what the UI displays.

- d1cabaa: fix(i18n): translate the SSO / SCIM / user-position / import-job admin objects

  Four live, UI-facing system objects were registered but never added to their
  package's i18n extract config, so non-English admins saw raw English `label`
  metadata:

  - `sys_sso_provider`, `sys_scim_provider` (platform-objects) — identity-provider
    admin grids plus the register / verify-domain actions.
  - `sys_user_position` (plugin-security) — delegated position assignment
    (`userActions` create/edit/delete); its sibling `sys_user_permission_set` was
    already translated, so this closes an inconsistency.
  - `sys_import_job` (platform-objects) — import history / progress, alongside the
    already-translated `sys_job` / `sys_job_run`.

  Adds each object to its package's `scripts/i18n-extract.config.ts` and supplies
  real zh-CN / ja-JP / es-ES translations across all four locale bundles, and
  extends the bundle-ownership guards' `OWNED_OBJECTS` to cover them. The
  orphan-only guards from #3502 could not catch this "owned-and-live-but-never-
  extracted" gap.

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

- 4921a95: fix(i18n): platform-objects' 231 untranslated strings were 1 — close the real gap and stop the phantom (#3762)

  Closes the rest of #3762. The remaining item was recorded as "platform-objects
  is 77 strings short per locale, in `apps.*` / `dashboards.*`, and its
  `--objects-only` extract cannot scaffold them — needs an emit decision (drop
  `--objects-only`, or a companion `.apps.generated.ts`) before any translating."

  Measured, the premise did not hold. Of the 77 declared keys per locale, **76
  were already translated** in the hand-authored `<locale>.ts` files and had been
  for months. Exactly one was genuinely missing —
  `apps.studio.navigation.nav_app_builder.label`, absent in all four locales
  including `en`. The 231 was a measurement artifact: this config declares
  SETUP_APP / STUDIO_APP / ACCOUNT_APP and SystemOverviewDashboard, but its
  `translations` merge baseline listed only the two GENERATED subtrees
  (`objects`, `metadataForms`), so coverage counted every hand-authored
  app/dashboard key as untranslated.

  **Neither proposed emit is right, and the second would have caused damage.**
  The Setup app is a shell of empty group anchors; its ~25 menu entries are
  contributed at runtime by `SETUP_NAV_CONTRIBUTIONS` and by capability plugins
  (ADR-0029 D7). A bundle generated from a static walk of `SETUP_APP` is
  therefore structurally incomplete, and regenerating over the hand-authored
  files would have **deleted 40 live nav translations per locale**. Dropping
  `--objects-only` fails differently: `kind: 'full'` folds all 803 metadata-form
  keys into `<locale>.objects.generated.ts` and renames the export the baseline
  imports.

  The split is correct as it stands and is now written down: `objects` /
  `metadataForms` are generated and gated by the bundle-drift check; `apps` /
  `dashboards` / `pages` are hand-authored and gated by the coverage ratchet.
  What was wrong was only that the baseline omitted the hand-authored half.

  - Extract config's `translations` now carries the per-locale assemblers, with
    `objects`/`metadataForms` still pinned to the committed generated files.
    Safe for the emit — `--objects-only` writes `data.objects` alone, so nothing
    added here can reach a generated bundle, and `check:i18n` stays in sync
    across all nine packages.
  - `nav_app_builder` translated in all four locales, wording taken from the
    repo's own precedent for "builder" (`构建器` / `ビルダー` / `generador`).
  - `nav_workflows` removed from all four: its menu entry is gone from
    `STUDIO_APP` and nothing contributes to that app, so the translation was
    dead.
  - Coverage ratchet baselined 231 → **0**, making platform-objects the ninth
    package where the ratchet is a strict gate — verified to go red on a single
    removed translation.
  - A local, CLI-independent parity test walks the statically declared Studio and
    Account navigation plus the dashboard's widgets and asserts a translation in
    every locale — and the reverse, that no translation survives its nav item.
    Both directions verified to fail before passing.

  An untranslated nav id is invisible in the UI — it falls back to the app's
  English label, so a Chinese Studio menu just shows one English entry among
  thirty. That is why this needed a gate rather than a one-time sweep.

  Still out of scope: the ~25 Setup entries contributed at runtime. Bringing them
  under a static gate needs either an objectql dependency in this package (it
  depends only on spec and metadata-core) or extractor support for
  `navigationContributions` — a real follow-up, not something to half-do here.

- 5487c20: fix(auth): provision `sys_scim_provider.provider_key` — SCIM provider creation failed the moment SCIM was switched on (#3653)

  `@better-auth/scim` declares `providerKey` as `required: true, unique: true`
  and writes it on every provider insert — a derived `<organization>:<provider_id>`
  uniqueness key it owns end to end. `sys_scim_provider` never provisioned the
  column, so the adapter emitted a `provider_key` no table had: the same failure
  shape as #3624, waiting behind the `OS_SCIM_ENABLED` flag.

  Found by extending the better-auth parity gate to `@better-auth/sso` and
  `@better-auth/scim`. Neither accepts a `schema` option, so `getAuthTables()` is
  blind to them and they were excluded when that gate shipped; the gate now reads
  each plugin's own declared schema and resolves columns the way the adapter
  actually does for a bridged model. `@better-auth/sso` came back fully covered.

  Existing environments pick the column up through the driver's additive schema
  sync; it stays null on pre-upgrade rows, which the nullable UNIQUE index admits.

- 4d00b13: feat(spec)!: remove `tool.requiresConfirmation` — a safety flag nothing enforced (#3715, ADR-0033 §2)

  `ToolSchema.requiresConfirmation` accepted `true` and no execution path ever read
  it. Not the LLM tool set (a tool reaches the model as name/description/parameters
  only), not `ToolRegistry.execute`, not `POST /ai/tools/:name/execute`, and not the
  MCP bridge — which derives `destructiveHint` from a hardcoded name list. Setting
  it on a destructive tool produced **no pause**.

  For an ordinary dead property that is untidy. For a **safety** property it is
  false compliance, which is the case ADR-0049 exists for: an author gates a
  destructive tool, sees the flag accepted, and ships believing a human is in the
  loop. It is made worse by the near-miss — `action.ai.requiresConfirmation` has
  the same name and **does** work, so the mistake reads as correct in review.
  ADR-0033 §2 already resolved to delete this one.

  ## Migration

  - **FROM:** `requiresConfirmation: true` on a tool definition
  - **TO:** put the operation behind an action and set `ai.requiresConfirmation:
true` there — that is the flag the HITL approval queue reads
    (`packages/runtime/src/action-execution.ts`) and the only path that actually
    stops execution.
  - For AI _metadata_ mutations there is nothing to migrate: the ADR-0033
    draft/publish workspace is the gate — nothing is live until a human publishes.

  **`ToolSchema` is now `.strict()`.** This is load-bearing, not tidying. Removing a
  key from a non-strict schema swaps one silent no-op for another: zod strips the
  key wordlessly, the author keeps writing it, and the safety flag goes on meaning
  nothing — the "silent strip" ADR-0032 / #1535 closed for objects. The retired key
  now **rejects**, and the error carries the FROM → TO above, because a parse error
  is the one channel every consumer bumping `@objectstack/spec` is guaranteed to
  hit.

  Strictness applies to _all_ unknown keys on a tool definition, so a typo
  (`buildIn`, `catagory`) is now a located parse error instead of a silently
  dropped field.

  Also removed: the Studio form row, its four generated locale bundles (the
  `en`/`zh-CN`/`ja-JP`/`es-ES` strings still promised _"Ask user to approve before
  executing (for destructive actions)"_ — a translated false promise), the
  liveness-ledger entry, and the generated reference-doc row.

  objectui's `ToolPreview.tsx` reads the field via `!!d.requiresConfirmation`, so it
  degrades to "not shown" with no error; removing that badge is a follow-up in that
  repo.

- 9aa5510: fix(i18n): ship the missing object-translation keys for the better-auth 1.7 and ADR-0105 D6 fields (#3624 follow-up)

  The generated object-translation bundles predate two rounds of field additions,
  so six fields had no entry in **any** locale and fell back to their raw schema
  labels in every UI surface that reads the bundle:

  - `sys_team.member_count`, `sys_team_member.membership_key`,
    `sys_two_factor.failed_verification_count` / `locked_until` — the better-auth
    1.7 columns provisioned in #3647.
  - `sys_organization.parent_organization_id` / `sort_order` — the same gap left
    by the earlier ADR-0105 D6 group-structure work.

  Regenerated with `os i18n extract` (merge mode, so every existing translation is
  preserved — the diff is purely additive). No API or schema change; the fields
  themselves already shipped.

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
- Updated dependencies [db48ad5]
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
- Updated dependencies [c073b8c]
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
  - @objectstack/metadata-core@17.0.0-rc.0

## 16.1.0

### Patch Changes

- 212b66a: fix(platform-objects): allow import/export on sys_business_unit (#3025)

  The Business Units list (Setup → Business Units) surfaces Import/Export buttons,
  but `sys_business_unit` declared a restrictive `enable.apiMethods` whitelist of
  only the five CRUD verbs. The REST data plane gates import/export on that
  whitelist (ADR-0049), so both buttons returned `405 OBJECT_API_METHOD_NOT_ALLOWED`.

  This was an unintentional gap, not a deliberate restriction: the object's fields
  (`external_ref`, `effective_from/to`) are designed for HRIS batch sync, and the
  org tree is expected to support bulk import. Added `'import'` and `'export'` to
  the whitelist. Import reuses the `create`/`update` affordances the object already
  grants, and the managed-object reconciliation backstop leaves import/export
  untouched (it only strips write verbs). Regression test added.

- d10c4dc: fix(platform-objects): allow import/export on sys_business_unit_member (#3025 / #3391 P0)

  Completes the #3025 point-fix. #3392 unblocked `sys_business_unit`'s Import/Export
  buttons (405 `OBJECT_API_METHOD_NOT_ALLOWED`) by adding `'import'`/`'export'` to its
  `enable.apiMethods` whitelist, but the HRIS org-tree sync scenario imports **two
  tables together** — the units _and_ their memberships — and the sibling
  `sys_business_unit_member` was left on the CRUD-only whitelist, so the membership
  Import/Export path still 405'd. #3391's P0 checklist pairs both tables; this is the
  half #3392 missed.

  - `packages/platform-objects/src/identity/sys-business-unit-member.object.ts`:
    `apiMethods` gains `'import'`, `'export'`. Import reuses the object's
    already-granted create/update affordances; export is a bulk read.
  - Reconcile-safe: the object is `managedBy:'platform'`, but
    `reconcileManagedApiMethods` only strips generic write verbs
    (`create/update/upsert/delete/purge` — `MANAGED_WRITE_VERB_AFFORDANCE`). It never
    touches `import`/`export`, so the declared whitelist reaches the REST gate intact
    (no false-green: the static whitelist the regression test asserts IS what
    `apiAccessDenialFromEnable` enforces at runtime).
  - Regression test (`platform-objects.test.ts`) locks `import`/`export` presence and
    CRUD retention. Proven red-before-green: reverting the object edit fails with
    `expected [...] to include 'import'`.

  Transitional: #3391 P2 replaces per-object `import`/`export` declarations with a
  single derived mapping (import ⊆ create/update, export ⊆ list) and reclaims the
  explicit entries on both business-unit objects together.

  Refs #3025, #3391.

- Updated dependencies [9e45b63]
  - @objectstack/spec@16.1.0
  - @objectstack/metadata-core@16.1.0

## 16.0.0

### Minor Changes

- bc65105: feat(platform-objects): surface phone number in the create_user result dialog

  `sys_user`'s `create_user` action now declares `user.phoneNumber` in its
  `resultDialog.fields`, so admins creating phone-based accounts see the
  sign-in phone number alongside the email and temporary password. The
  create-user response carries `phoneNumber` only for phone-based users;
  objectui's ActionResultDialog skips declared fields whose path is absent
  from the payload, so email-only users see no extra row.

### Patch Changes

- 6289ec3: feat(i18n): translation slot for action `resultDialog` copy — the one-shot secret-reveal dialogs are now localizable

  The post-success `resultDialog` (temporary passwords, 2FA backup codes, OAuth
  client secrets) had no slot in the translation protocol, so its title /
  description / acknowledge button / field labels always rendered the hardcoded
  English metadata literals even on fully-translated locales.

  - **spec.** `_actions.<action>` (object + object-first node) and
    `globalActions.<action>` gain an optional `resultDialog` translation node
    (`ActionResultDialogTranslationSchema`): `title`, `description`,
    `acknowledge`, and `fields` keyed by the **literal** result-field path
    (e.g. `"user.email"` — keys may contain dots; resolvers index the record
    directly, never split on `.`). New `resolveActionResultDialog` overlay
    resolver, wired into `translateAction` for API-boundary translation.
  - **cli.** `os i18n extract` emits the new `resultDialog.*` keys (title /
    description / acknowledge / `fields.<path>` for labelled fields), so
    coverage and skeleton generation see them.
  - **platform-objects.** en / zh-CN / ja-JP / es-ES bundles ship the
    resultDialog copy for all six shipped dialogs: `sys_user.create_user`,
    `sys_user.set_user_password`, `sys_two_factor.enable_two_factor`,
    `sys_two_factor.regenerate_backup_codes`,
    `sys_oauth_application.create_oauth_application`, and
    `sys_oauth_application.rotate_client_secret`.

  Client-side rendering lands in objectui (`actionResultDialog` resolver in
  `@object-ui/i18n` + result-dialog handlers). Purely additive — untranslated
  locales keep falling back to the metadata literals.

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
- Updated dependencies [06cb319]
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
  - @objectstack/metadata-core@16.0.0

## 16.0.0-rc.1

### Patch Changes

- 6289ec3: feat(i18n): translation slot for action `resultDialog` copy — the one-shot secret-reveal dialogs are now localizable

  The post-success `resultDialog` (temporary passwords, 2FA backup codes, OAuth
  client secrets) had no slot in the translation protocol, so its title /
  description / acknowledge button / field labels always rendered the hardcoded
  English metadata literals even on fully-translated locales.

  - **spec.** `_actions.<action>` (object + object-first node) and
    `globalActions.<action>` gain an optional `resultDialog` translation node
    (`ActionResultDialogTranslationSchema`): `title`, `description`,
    `acknowledge`, and `fields` keyed by the **literal** result-field path
    (e.g. `"user.email"` — keys may contain dots; resolvers index the record
    directly, never split on `.`). New `resolveActionResultDialog` overlay
    resolver, wired into `translateAction` for API-boundary translation.
  - **cli.** `os i18n extract` emits the new `resultDialog.*` keys (title /
    description / acknowledge / `fields.<path>` for labelled fields), so
    coverage and skeleton generation see them.
  - **platform-objects.** en / zh-CN / ja-JP / es-ES bundles ship the
    resultDialog copy for all six shipped dialogs: `sys_user.create_user`,
    `sys_user.set_user_password`, `sys_two_factor.enable_two_factor`,
    `sys_two_factor.regenerate_backup_codes`,
    `sys_oauth_application.create_oauth_application`, and
    `sys_oauth_application.rotate_client_secret`.

  Client-side rendering lands in objectui (`actionResultDialog` resolver in
  `@object-ui/i18n` + result-dialog handlers). Purely additive — untranslated
  locales keep falling back to the metadata literals.

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
  - @objectstack/metadata-core@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- bc65105: feat(platform-objects): surface phone number in the create_user result dialog

  `sys_user`'s `create_user` action now declares `user.phoneNumber` in its
  `resultDialog.fields`, so admins creating phone-based accounts see the
  sign-in phone number alongside the email and temporary password. The
  create-user response carries `phoneNumber` only for phone-based users;
  objectui's ActionResultDialog skips declared fields whose path is absent
  from the payload, so email-only users see no extra row.

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
- Updated dependencies [a3823b2]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [5e3301d]
- Updated dependencies [46e876c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [06cb319]
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
  - @objectstack/metadata-core@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/metadata-core@15.1.1

## 15.1.0

### Minor Changes

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

- 4109153: Close the `@better-auth/oauth-provider` 1.7 schema drift that broke platform
  SSO (token exchange 500: `table sys_oauth_access_token has no column named
authorizationCodeId`).

  - `sys_oauth_access_token` / `sys_oauth_refresh_token`: add
    `authorization_code_id`, `resources`, `requested_user_info_claims`,
    `confirmation` (+ access-token `revoked`; + refresh-token `rotated_at`,
    `rotation_replay_response`, `rotation_replay_expires_at`).
  - `sys_oauth_consent`: add `resources`, `requested_user_info_claims`.
  - `sys_oauth_application`: add `jwks`, `jwks_uri`, `backchannel_logout_uri`,
    `backchannel_logout_session_required`, `dpop_bound_access_tokens`.
  - New platform objects for the three models 1.7 introduced:
    `sys_oauth_resource`, `sys_oauth_client_resource`,
    `sys_oauth_client_assertion` (RFC 8707 resource indicators + RFC 7523
    client-assertion replay prevention), registered in the auth manifest and
    mapped in `buildOauthProviderPluginSchema()`.
  - All camelCase→snake_case `fieldName` mappings extended accordingly, and a
    new parity test (`oauth-provider-schema-parity.test.ts`) fails the build
    whenever a future better-auth bump introduces model fields our objects or
    mappings don't cover.

### Patch Changes

- f531a26: feat(attachments): edit-on-parent attach, upload-session lifecycle, trash=false (#2970 items 3-5)

  Closes the remaining enforce-or-remove / lifecycle items of #2970:

  - **Edit-on-parent for attach (item 3, Salesforce parity).** Creating a
    `sys_attachment` now requires EDIT access to the parent record (via the
    sharing service's `canEdit`), not merely read — public-model parents are
    unchanged (canEdit is true for any member), private/owner-scoped parents
    require the caller to own/edit them. Degrades to read visibility when no
    sharing service is present.
  - **`sys_upload_session` lifecycle (item 4).** Abandoned / terminal chunked
    upload sessions are reaped by the platform LifecycleService (`transient`;
    TTL 1d past `expires_at`; retention 7d for terminal statuses). Row reap
    only — a reap guard that aborts backend multipart uploads for partial S3
    sessions is a filed follow-up.
  - **`sys_attachment.enable.trash` → `false` (item 5, ADR-0049).** The flag is
    `dead` in the liveness ledger (no engine soft-delete reader) and attachment
    deletes are hard (the reap guard reclaims a file's bytes once its last join
    row is gone, so a restore would dangle) — declare the honest state rather
    than claim a restore capability the runtime does not provide.

- f531a26: **Every feature-gated capability is now UI-gated, guardrailed by a flag registry and a declarative `requiresFeature` annotation (#2874, generalizing the create-user phone fix #2871).**

  `@objectstack/spec/kernel` gains `PUBLIC_AUTH_FEATURES` — a classification registry for all 13 boolean flags served at `/api/v1/auth/config`: consumption surface (crud/login/status), default semantics (opt-in `== true` vs default-on `!= false`), and the gated spec inputs or an exemption reason. A plugin-auth drift test pins the served key set to the registry, and a platform-objects completeness guard pins the registry to the actual gates in both directions.

  `ActionSchema`/`ActionParamSchema` gain `requiresFeature: '<flag>'` (enum-checked), lowered at parse time into the canonical `visible` CEL predicate per the flag's registered semantics, AND-composed with any explicit `visible`, and stripped from the output — renderers and lint see only `visible`, so objectui needs no changes. All 22 hand-written `features.*` gates migrated (behavior-locked by an exact-string matrix test), and the audit gated 17 previously naked capability-dependent actions: the six `sys_user` platform-admin actions, six 2FA actions, and five `sys_oauth_application` actions now hide when their plugin is off instead of rendering buttons that 404.

- f531a26: feat(cli): `os i18n extract` now emits action param keys (`o.<object>._actions.<action>.params.<param>.*`) so action-dialog forms are translatable (#3030)

  The console client already resolves param labels, help text, placeholders and
  option labels from `o.<object>._actions.<action>.params.*`, but the extractor
  never walked `actions[].params`, so those keys were absent from generated
  bundles and dialogs like Setup → Create User rendered raw English under any
  locale. The extractor now emits:

  - inline params → `label` / `helpText` / `placeholder` / `options.<value>`;
  - field-backed params (`{ field: '…' }`) → only when they carry a literal
    override (field translations already cover them at runtime);
  - both object actions and top-level (global) actions.

  `@objectstack/platform-objects` regenerates its en/zh-CN/ja-JP/es-ES bundles
  with the new keys filled (user admin actions, sys_jwks fields, page variable
  forms). Re-running extract with `--merge` stays idempotent.

- f531a26: fix(auth): align the better-auth family on 1.7.0-rc.1, implement the new adapter methods, and add the new sys_jwks columns (#2974)

  Remediating GHSA-p2fr-6hmx-4528 (`@better-auth/oauth-provider`) requires the
  1.7 plugin line, which imports `CLIENT_ASSERTION_TYPE` and other symbols that
  only exist in `@better-auth/core` 1.7.x — so the whole better-auth family is
  pinned to `1.7.0-rc.1` together (mixing a 1.7 plugin with 1.6.23 core 500s on
  sign-in). better-auth 1.7 also extends its `CustomAdapter` contract with two
  new methods, which the ObjectQL adapter now implements:

  - `consumeOne` — atomic single-row consume (find the guarded row, delete it,
    return it), used by better-auth for single-use credential consumption
    (e.g. verification tokens on the sign-in path).
  - `incrementOne` — guarded counter mutation (`field = field + delta` per
    `increment` entry plus any absolute `set` values), returning the updated row
    or `null` when the guard matches nothing.

  Both are find-then-write mirrors of the existing `delete` / `update` methods
  (ObjectQL exposes no native atomic primitive) and honour the same core/plugin
  field-name bridging.

  better-auth 1.7 also extends its `jwks` model with two new optional columns,
  `alg` (signing algorithm, e.g. `EdDSA`) and `crv` (curve, e.g. `Ed25519`), and
  writes them when minting signing keys. The `sys_jwks` platform object gains the
  matching fields — without them every JWKS write failed (`table sys_jwks has no
column named alg`), 500ing token signing and breaking session validation
  (sign-in succeeded but every authenticated request 401'd).

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
  - @objectstack/metadata-core@15.1.0

## 15.0.0

### Minor Changes

- 02a014b: feat(platform-objects): sys_user 记录页新增 Permission Sets 与 Business Units 两个一站式分配 tab (A3, #2920)

  管理员现在可在单个用户记录页完成三类分配:岗位(Positions,已有)、直接权限集授权(Permission Sets)、业务单元归属(Business Units)。两个新 tab 均为纯 SDUI 的 `record:related_list` + Add picker:

  - **Permission Sets** — junction `sys_user_permission_set`(id-keyed,`relationshipField: 'user_id'`),Add picker 绑定 `sys_permission_set`(`linkField: 'permission_set_id'`)。服务端 audience-anchor(D5/D9)与 delegated-admin(D12)门禁的拒绝原因会显示在 Add 对话框。
  - **Business Units** — junction `sys_business_unit_member`(id-keyed,`relationshipField: 'user_id'`),Add picker 绑定 `sys_business_unit`(`linkField: 'business_unit_id'`,按显示字段 `name` 标注)。

  tab 顺序为 Positions → Permission Sets → Business Units,四语言标签齐全。

### Patch Changes

- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/spec@15.0.0
  - @objectstack/metadata-core@15.0.0

## 14.8.0

### Patch Changes

- bb71321: i18n: translate the system account/messaging surfaces end to end.

  - **spec**: `ObjectTranslationDataSchema` / `ObjectTranslationNodeSchema` now
    accept `_views.<view>.emptyState.{title,message}` so list-view empty states
    are translatable (contract-first for the extractor below).
  - **cli**: `os i18n extract` emits `_views.<view>.emptyState` keys when a view
    declares an empty state.
  - **platform-objects**: fill every missing zh-CN/ja-JP/es-ES translation for
    `sys_user`, `sys_organization` and `sys_business_unit` (fields, options,
    views, actions); replace the hardcoded English tab/section/action labels in
    the `sys_user`, `sys_organization` and `sys_position` detail pages with
    inline i18n label objects, and route the user Security tab through
    `record:quick_actions` so object action labels localize.
  - **service-messaging**: new ADR-0029 D8 translation bundle
    (`MessagingTranslations`) covering the seven `sys_*` messaging objects
    (inbox message, receipts, deliveries, preferences, subscriptions, templates,
    HTTP deliveries), registered on `kernel:ready`; zh-CN is fully translated
    and ja-JP/es-ES cover `sys_inbox_message` (incl. the `mine` view empty
    state).

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/metadata-core@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/metadata-core@14.7.0

## 14.6.0

### Patch Changes

- 609cb13: **Action params gain a `visible` predicate; the create-user `phoneNumber` param is gated on `features.phoneNumber`.**

  `ActionParamSchema` gains an optional `visible` (CEL, `ExpressionInputSchema`) evaluated against the same scope as action `visible` (`current_user`/`app`/`data`/`features`); a UI that honors it omits the param when it's false. The `sys_user` `create_user` action's `phoneNumber` param now carries `visible: 'features.phoneNumber == true'`, so the form no longer offers a Phone Number field when the opt-in `phoneNumber` auth plugin is off — otherwise the endpoint rejects it with "Phone numbers require the phoneNumber auth plugin". Pairs with the objectui `ActionParamDialog` change that evaluates `param.visible`.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/metadata-core@14.6.0

## 14.5.0

### Minor Changes

- 6da03ee: feat(identity): open the standard Edit affordance on sys_user for profile fields (ADR-0092 D4)

  `sys_user` now sets `userActions: { edit: true }`, so the generic row-edit
  form is available (create / import / delete stay off). The two profile fields
  (`name`, `image`) are editable; every other column — `email`, `role`, ban
  state, phone, and all system-managed stamps — is marked `readonly` so the
  standard edit form renders it non-editable.

  This is safe because the server boundary is the identity write guard shipped
  in the previous change (ADR-0092 D2): a user-context update to `sys_user` may
  only touch `{name, image}` regardless of what any form submits; everything
  else is stripped or rejected. The `readonly` flags here are UX only.

  The dedicated action dialogs are unaffected — `create_user` / `invite_user` /
  `set_user_role` reference `email` and `role` as action **params** (their own
  inputs), which do not inherit the field-level `readonly` and stay editable
  (verified in the running Console).

  Note: the Console's record-form renderer must honor `userActions.edit` +
  per-field `readonly` on `managedBy:'better-auth'` objects for the edit form to
  be functional; that is an objectui-side change vendored via `objectui:refresh`
  and tracked separately.

### Patch Changes

- 526805e: ADR-0057 data-lifecycle follow-ups (#2834): the per-plugin retention sweepers are retired, telemetry separation goes live in dev, and the lifecycle contract reaches the Studio.

  - **BREAKING (ships as minor per the launch-window convention)**: `JobRunRetention` / `NotificationRetention` and the `retentionDays` / `retentionSweepMs` options on `JobServicePlugin` / `MessagingServicePlugin` are removed. The platform LifecycleService enforces the same windows from the `lifecycle` declarations (`sys_job_run` 30d, notification pipeline 90d); tune them at runtime via the `lifecycle` settings namespace (`retention_overrides`, tenant-scoped).
  - **Fix**: `sys_automation_run` no longer declares a blanket 30d lifecycle retention — that table interleaves live SUSPENDED runs (an approval may stay paused for months) with terminal history, and a blanket age reap could strand in-flight approvals. Bounding stays with the automation store's terminal-only sweep.
  - **CLI**: `objectstack dev` now provisions a dedicated `telemetry` datasource (`<primary>.telemetry.db`) for file-backed SQLite primaries, so lifecycle-classed system data stops sharing the business dev DB (`OS_TELEMETRY_DB=0` opts out; `OS_TELEMETRY_DB=<path>` opts in anywhere). New `os db clean` runs the one-time `VACUUM` that lets legacy files adopt `auto_vacuum=INCREMENTAL` and reports reclaimed bytes.
  - **Studio**: the object metadata form exposes the `lifecycle` block (class + retention/TTL/rotation/archive/reclaim); metadata-forms i18n bundles regenerated with curated zh-CN translations.

- 8f23746: `sys_sso_provider` domain-verification `resultDialog` paths now address the
  inner `data` payload (`dnsRecordType`, not `data.dnsRecordType`), matching every
  other object. Pairs with the objectui `apiHandler` envelope-unwrap fix
  (objectui#2396) — the old `data.` prefix compensated for a runtime bug and would
  blank the dialog once the runtime unwraps correctly.
- b97af7e: `sys_user` account-management actions (Ban/Unban, Unlock Account, Set Password, Set Platform Role, Impersonate) now also surface on the user record-detail header (`record_header`, overflowing into the ⋯ "More" menu), not just the Users list row menu — so a platform admin can manage an account from an open user record without navigating back to the list.
- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
  - @objectstack/spec@14.5.0
  - @objectstack/metadata-core@14.5.0

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
  - @objectstack/metadata-core@14.4.0

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

### Patch Changes

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

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/spec@14.3.0
  - @objectstack/metadata-core@14.3.0

## 14.2.0

### Minor Changes

- 4ab9958: Position assignment panels as pure SDUI (ADR-0090 follow-through).

  - `RecordRelatedListProps` gains `relationshipValueField` (default `'id'`): which parent-record field the junction's `relationshipField` stores — the generic affordance for name-keyed junctions (`sys_user_position.position` stores `sys_position.name`). Used for both the list filter and the Add-picker's parent-side value.
  - `sys_user` detail page gains a **Positions** tab (assign positions to a user; Add picker stores the position machine name via `valueField: 'name'`; the D12 delegated-admin gate's denials surface in the dialog).
  - New `sys_position` detail page (shipped by plugin-security): **Holders** (name-keyed via `relationshipValueField: 'name'`) and **Permission Sets** (bindings) tabs — zero bespoke UI; ADR-0091 validity columns slot in later as plain column additions.

  Renderer note: the generic `record:related_list` Add-picker and `relationshipValueField` support land in objectui alongside the ^14 alignment; with older renderers these tabs degrade to read-only lists.

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/metadata-core@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/metadata-core@14.1.0

## 14.0.0

### Patch Changes

- 332b711: feat(mcp): plugin-carried "Connect an agent" Setup page (#2714 Phase 1)

  The MCP plugin now registers a Setup page (`connect_agent`) plus its
  navigation entry under Integrations — the nav lives and dies with the
  capability (cloud ADR-0009 principle) and follows the surface's default-on
  switch: an opted-out deployment (`OS_MCP_SERVER_ENABLED=false`) gets no page
  and no entry. The page body is the `mcp:connect-agent` SDUI widget provided
  by objectui (objectui#2372): env MCP URL, per-client connect cards, SKILL.md
  download, API-key minting. zh-CN nav label included.

- d0531c4: Setup → Access Control nav: the `sys_position` entry is renamed
  `nav_roles`/"Roles" → `nav_positions`/"Positions" (岗位 / ポジション /
  Posiciones) — the last "role" leftover in platform UI copy (ADR-0090 D3;
  the Studio-side relabel already landed in objectui). The framework's
  `.objectui-sha` pin is bumped to pick up the Studio Access-pillar explain
  panel ("why can this user access?", ADR-0090 D6) and the suggested
  audience-binding install prompt (D5/D9).
- cff5aac: Setup navigation: the Access Control menu entry for `sys_position` is now labeled "Positions" (was still "Roles" after the ADR-0090 D3 rename) — `nav_roles` → `nav_positions`, with zh-CN 岗位 / ja-JP ポジション / es-ES Posiciones translations updated to match the position vocabulary.
- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
  - @objectstack/spec@14.0.0
  - @objectstack/metadata-core@14.0.0

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

- b271691: ADR-0090 P3 — security-domain publish linter (D7) and delegated administration (D12).

  **D7 — `validateSecurityPosture` (@objectstack/lint), wired into `os compile` (errors gate the build) and `os lint`.** Rules, each with a failing fixture: `security-owd-unset` (custom object with no `sharingModel` — the objectui#2348 leave_request shape), `security-owd-alias` (retired D4 alias values, with fix-it), `security-external-wider-than-internal` (D11 `external ≤ internal`), `security-wildcard-vama` (`'*'` + View/Modify All outside the platform admin set, ADR-0066), `security-anchor-high-privilege` (an `isDefault`/everyone-suggested set carrying anchor-forbidden bits), `security-role-word` (D3 vocabulary freeze in security identifiers/labels; ARIA/page roles exempt), and advisory `security-private-no-readscope`.

  **D12 — delegated administration (@objectstack/plugin-security `DelegatedAdminGate`).** `PermissionSetSchema.adminScope` (new in spec, persisted as `sys_permission_set.admin_scope`) declares WHERE (a `sys_business_unit` subtree), WHAT (`manageAssignments` / `manageBindings` / `authorEnvironmentSets`), and WHICH sets a delegate may hand out (`assignablePermissionSets` allowlist). Writes to `sys_user_position`, `sys_position_permission_set`, `sys_user_permission_set`, and `sys_permission_set` are now governed: tenant-level admins (ADR-0066 superuser wildcard) pass through; delegates need a covering scope — inside their subtree, allowlisted sets only (to others AND themselves), single-row writes, `granted_by` audit-stamped; everyone else (including holders of plain CRUD on RBAC tables) is denied. Granting or authoring a set that itself carries an `adminScope` requires a held scope that STRICTLY contains it. The `everyone`/`guest` anchors stay tenant-level only, and direct position assignments to an anchor are rejected for every caller.

  **ADR-0090 Addendum — assignment-level BU anchor.** `sys_user_position.business_unit_id` lands with its three consumers scoped: D12 delegation boundary (enforced here), audit fact, and the depth-anchor contract for enterprise `hierarchy-scope-resolver` implementations (documented on `IHierarchyScopeResolver`).

  **D9 tier tightening.** `describeHighPrivilegeBits` moved to `@objectstack/spec/security` (re-exported from plugin-security) alongside new `describeAnchorForbiddenBits`: `guest` bindings now additionally reject edit bits (read-only by default; create stays the case-by-case exception).

  **BREAKING (@objectstack/plugin-security):** exports renamed to the ADR-0090 D3 vocabulary — `SysRole`→`SysPosition`, `SysUserRole`→`SysUserPosition`, `SysRolePermissionSet`→`SysPositionPermissionSet` (no aliases, pre-launch one-step rename). `sys_position` row actions/list views renamed (`activate_position`, …), labels relabeled Role→Position. Non-tenant-admin writes to the RBAC link tables without an `adminScope` are now denied (previously any CRUD grant on those tables sufficed).

  **BREAKING (@objectstack/platform-objects):** `sys_business_unit_member.role_in_business_unit` → `function_in_business_unit` (D3 reserved-word sweep; values member/lead/deputy unchanged).

### Minor Changes

- 9fa84f9: Secure-by-default posture for sensitive system objects (ADR-0066 ④, system-object
  slice) — the platform's raw secret/credential stores no longer ride the wildcard
  `'*'` permission grant.

  `sys_secret` (encrypted settings/datasource secrets), `sys_jwks` (JWT signing
  keys), `sys_verification` (password-reset / verify tokens),
  `sys_oauth_access_token`, `sys_oauth_refresh_token` (live bearer credentials),
  and `sys_device_code` (pending device-grant codes) now declare
  `access: { default: 'private' }`: an ordinary member's generic data-layer
  read/write gets 403 instead of being covered by `member_default`'s
  `'*': allowRead`. Platform admins retain access via the posture-gated
  `viewAllRecords`/`modifyAllRecords` superuser bypass, and every runtime consumer
  is unaffected — better-auth reads via its adapter (system context),
  `engine.resolveSecret` reads at driver level, and SettingsService / the
  datasource secret-binder read principal-less (middleware falls open for internal
  calls).

  `sys_scim_provider` (SCIM bearer-token config) gains the object-level
  `requiredPermissions: ['manage_platform_settings']` capability gate, mirroring
  its sibling `sys_sso_provider`. The Setup nav item for Signing Keys (JWKS) is
  now capability-gated like API Keys, so non-admins don't see a menu entry that
  can only 403.

  Member self-service objects (`sys_session`, `sys_api_key`,
  `sys_oauth_application`, `sys_two_factor`) deliberately keep the public posture —
  the Account app ("My Sessions" / "My API Keys" / "My Apps" / 2FA "My
  Enrollment") reads them through the generic data layer as the member; row
  scoping remains their guard. The declarations are pinned by
  `platform-objects.test.ts` and the ADR-0056 D10 conformance-matrix row
  `secure-by-default-posture`, so dropping the flag from a secret store fails CI.

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
  - @objectstack/metadata-core@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
  - @objectstack/spec@12.6.0
  - @objectstack/metadata-core@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/metadata-core@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/metadata-core@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/metadata-core@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
  - @objectstack/spec@12.2.0
  - @objectstack/metadata-core@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/metadata-core@12.1.0

## 12.0.0

### Minor Changes

- 07f055c: feat(auth): last-login audit fields — sys_user.last_login_at / last_login_ip (ADR-0069 D7)

  Completes the ADR-0069 D7 identity-field set: `sys_user.last_login_at` and
  `sys_user.last_login_ip` are stamped on every successful `/sign-in/email` by
  `AuthManager.stampLastLogin` (a best-effort after-hook, independent of the
  lockout-accounting path so it runs even when lockout is disabled). The IP is
  taken from the trusted forwarded headers (`x-forwarded-for` →
  `cf-connecting-ip` → `x-real-ip`), the same precedence as the D5 IP allow-list
  middleware, and capped to the 45-char column width. Both fields are
  system-managed, read-only, and land in the Admin group of `sys_user`.

  The rest of ADR-0069 P1 (password complexity/history/expiry, HIBP, account
  lockout, enforced MFA) was already implemented; this fills the one missing D7
  field pair. ADR-0069 status updated Proposed → Accepted (P1/P2 implemented)
  with an implementation-status matrix reflecting what is landed vs the remaining
  P2 gaps (per-org IP ranges, shared-store rate limiting).

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
  - @objectstack/metadata-core@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/metadata-core@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/metadata-core@11.9.0

## 11.8.0

### Patch Changes

- 53d491a: feat(setup): Packages entry in Setup's Apps group

  Package administration (install / inspect / manage) is an operator concern
  (ADR-0084: packages are Operate, out of the builder), so it gains a home in the
  Setup app: `group_apps` now carries a **Packages** entry bound to the console's
  existing `developer:packages` page. Building apps remains a separate journey
  (the Home builder cover → `/studio`); this entry is for administration.

- b84726b: feat(studio): "App Builder" navigation entry — the pillar builder joins the journey

  The Studio app's Overview group gains an **App Builder** entry (componentRef
  `studio:builder`, bound by the console to the builder landing page). This makes the
  pillar application builder reachable from the moment a user logs in — Home → Studio
  → App Builder → pick/create a writable base package → the full-screen builder at
  `/studio/:packageId/:tab` — instead of being a URL-only surface.

  - @objectstack/spec@11.8.0
  - @objectstack/metadata-core@11.8.0

## 11.7.0

### Patch Changes

- 5178906: ADR-0085: object presentation intent is declared as cross-surface semantic
  roles, never as per-surface hint blocks.

  **@objectstack/spec**

  - New top-level `stageField: string | false` — names the object's linear
    lifecycle field (`false` declares the status-like field non-linear and
    suppresses every consumer's stage heuristics). Legitimizes the key the UI
    runtime already read but the schema rejected.
  - `compactLayout` → **`highlightFields`** (the value is an ordered field
    list, not a layout; "highlight" is already the renderer-side term of art).
    `compactLayout` stays accepted as a parse-time alias and is preserved on
    output — the ADR-0079 `displayNameField → nameField` pattern.
  - `fieldGroups[].collapse: 'none' | 'expanded' | 'collapsed'` replaces
    `defaultExpanded` AND the UI-dialect `collapsible`/`collapsed` boolean pair
    (which had drifted two ways: spec declared a key no renderer read, renderers
    read keys the spec rejected). Old keys map onto the enum at parse and remain
    accepted for one minor.
  - `fieldGroups[].visibleOn` removed (no consumer anywhere — ADR-0049
    enforce-or-remove; re-add together with its enforcement when a surface
    evaluates it).
  - The `detail: { … }.passthrough()` UI-hints block is **removed**. Every key
    in it was either unauthorable, a proven no-op for spec authors
    (`hideReferenceRail` — the rail is default-off and its enabling key was
    never typed), or a per-page toggle that belongs to an assigned Page. Zero
    authors existed across framework and objectui (evidence in ADR-0085); the
    removal ships as a minor under the documented dead-surface exception
    (PR #2272 precedent).
  - New `deriveFieldGroupLayout(def)` in `@objectstack/spec/data` — the single
    source of the fieldGroups rendering semantics (declared order, empty groups
    dropped, ungrouped trailing bucket minus audit/system fields, collapse
    passthrough incl. deprecated aliases). UI renderers consume this instead of
    their two pre-existing near-identical local copies.

  **@objectstack/lint / @objectstack/cli**

  - New `validateSemanticRoles` (wired into `os lint`): warns on
    `Field.group` → undeclared group, declared-but-unreferenced groups, and
    `stageField`/`highlightFields` entries naming non-existent fields — the
    dangling-pointer shapes that are Zod-valid but silently inert at render
    time (ADR-0078 completeness gate).

  **@objectstack/platform-objects**

  - All 35 system objects renamed `compactLayout:` → `highlightFields:`
    (behaviour unchanged via the alias).

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/metadata-core@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/metadata-core@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/metadata-core@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/metadata-core@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/metadata-core@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/metadata-core@11.2.0

## 11.1.0

### Minor Changes

- cbc8c02: feat(auth): opt-in SSO domain verification (ADR-0024 ②)

  Add DNS-TXT domain-ownership verification for external SSO providers, gated
  behind a new `OS_SSO_DOMAIN_VERIFICATION` flag (off by default — today's
  register→login behavior is unchanged). When enabled, `@better-auth/sso` mounts
  `/sso/request-domain-verification` + `/sso/verify-domain` and enforces that a
  provider's email domain be DNS-verified before it may complete a login.

  - `auth-manager.ts`: new `ssoDomainVerification` enabled-flag (readBooleanEnv) →
    passes `domainVerification: { enabled: true }` to `sso()`; public
    `isSsoDomainVerificationEnabled()` helper.
  - `register-sso-provider.ts`: `runRequestDomainVerification` /
    `runVerifyDomain` bridges — re-dispatch through the gated better-auth
    endpoints and reshape the response into the `{ success, data }` envelope the
    `sys_sso_provider` action `resultDialog` reads (request → ready-to-paste DNS
    TXT record; verify → clear success/error). A bare 404 from the inner endpoint
    is surfaced as "not enabled for this environment".
  - `auth-plugin.ts`: mount the two bridges as rawApp routes
    (`/admin/sso/{request-domain-verification,verify-domain}`).
  - `sys_sso_provider`: `domain_verified` field + list column + the two actions;
    `domainVerified` documented in `AUTH_SSO_PROVIDER_SCHEMA`.

- ce0b4f6: Auth: password expiry — the session-validation gate (ADR-0069 D1, P1)

  Builds the **authentication-policy session gate** ADR-0069 needs and uses it for password expiry. When `password_expiry_days` (new `auth` setting, 0 = off) is exceeded, an authenticated user is blocked from protected REST resources with `403 PASSWORD_EXPIRED` until they change their password — while auth + remediation paths stay reachable.

  - **core**: new pure `evaluateAuthGate` / `isAuthGateAllowlisted` helper (`@objectstack/core/security`) — single source of truth for the allow-list (auth endpoints, change-password, health, UI-bootstrap reads).
  - **plugin-auth**: `customSession` computes the gate posture once and attaches `user.authGate`; `computeAuthGate` reads `sys_user.password_changed_at` vs the configured window; `password_changed_at` is stamped on sign-up / change / reset; `isAuthGateActive()` keeps the gate **zero-overhead** when off.
  - **platform-objects**: new `sys_user.password_changed_at` column.
  - **rest**: `resolveExecCtx` carries `authGate`; `enforceAuth` blocks gated sessions (independent of `requireAuth`) using the core allow-list.
  - **service-settings**: new `password_expiry_days` field.

  Default-off / additive (no upgrade behavior change); a null `password_changed_at` never expires (existing users). Per ADR-0049 the setting ships with its enforcement; timestamps written as `Date` (ADR-0074).

  This gate is the shared seam for **enforced MFA** (ADR-0069 D3), which lands next as a small addition (a second `authGate` branch). The dispatcher/MCP path is a follow-up (tracked in #2375); the REST surface the Console uses is fully gated here.

- 90bce88: Auth: enforced MFA (ADR-0069 D3, P1)

  Completes the session-validation gate: when `mfa_required` (new `auth` setting) is on, an authenticated user without TOTP enrolled is blocked from protected resources with `403 MFA_REQUIRED` once their `mfa_grace_period_days` (default 7) window elapses — while the two-factor enrollment endpoints stay reachable so they can comply. Reuses the `authGate` seam shipped in #2388 (a second posture branch in `computeAuthGate`).

  - New `auth` settings `mfa_required` (toggle) + `mfa_grace_period_days`; enabling `mfa_required` also force-enables the `twoFactor` plugin so `/two-factor/*` enrollment exists.
  - New `sys_user.mfa_required_at` column — the grace clock, stamped lazily the first time a user is seen required-but-unenrolled.
  - `isAuthGateActive()` now also trips on `mfa_required` (still zero-overhead when off).

  Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

  **Needs an objectui follow-up**: the Console should handle a `403 MFA_REQUIRED` by showing the TOTP-enrollment prompt. Per-org `sys_organization.require_mfa` and the dispatcher/MCP gate remain follow-ups (#2375).

- 3209ec6: Auth: session controls — idle timeout, absolute max lifetime, concurrent cap (ADR-0069 D4, P2)

  Adds three `auth` session-control settings (all 0 = off):

  - `session_idle_timeout_minutes` — sign a user out after inactivity. Enforced in `customSession`: touches `sys_session.last_activity_at` (throttled to once a minute) and, once the idle window is exceeded, revokes the session.
  - `session_absolute_max_hours` — cap total session lifetime regardless of refresh; revoked once `created_at` is older than the cap.
  - `max_concurrent_sessions_per_user` — on sign-in, keep the newest N live sessions and revoke the rest (oldest first).

  Revocation expires the session in place (`expires_at` set to the past + `revoked_at` / `revoke_reason` stamped on new `sys_session` columns), so better-auth returns no session on the next request → the Console's existing 401 → login redirect handles it (no client change). Note: better-auth garbage-collects expired sessions, so the `revoke_reason` audit row is best-effort; the enforcement (session killed) is not.

  Default-off / additive (no upgrade behavior change); per ADR-0049 each setting ships with its enforcement.

- e011d42: Auth: per-org MFA + dispatcher/MCP gate — complete the ADR-0069 enforced-MFA story

  Two follow-ups that make enforced MFA total:

  - **Per-org `sys_organization.require_mfa`** — an org may require MFA above the global floor. `computeAuthGate` now treats the active org's `require_mfa` as an effective MFA requirement even when the global `mfa_required` is off; `isAuthGateActive()` stays cheap via a 60s-TTL "any org requires MFA" cache (lazy background refresh), so a brand-new per-org requirement activates the gate on the next request without per-request org queries.
  - **Dispatcher/MCP gate** — the auth-policy gate now also runs in the runtime dispatcher (after `resolveExecutionContext`), so MCP / GraphQL / embedded data paths enforce `PASSWORD_EXPIRED` / `MFA_REQUIRED` consistently with the REST seam (reusing the shared `evaluateAuthGate` allow-list). Previously only the REST surface (the Console) was gated.

  Default-off / additive. Per ADR-0049 each setting ships with its enforcement.

- 6e5bdd5: feat(auth): SAML 2.0 SSO via @better-auth/sso (ADR-0069 P3)

  `@better-auth/sso@1.6.20` ships full SAML 2.0 (samlify-backed), so SAML needs no
  custom plugin. Adds a `register_saml_provider` action on `sys_sso_provider` and a
  `runRegisterSamlProviderFromForm` bridge that reshapes the flat admin form into the
  nested `samlConfig` and re-dispatches through `/sso/register` (admin gate enforced),
  returning the SP ACS + metadata URLs to configure on the IdP. Updates ADR-0069 to
  correct the stale "SAML is out of better-auth core" premise.

### Patch Changes

- 07c2773: Auth: make the SSO Providers list visible to admins (ADR-0024 / cloud#551)

  The `sys_sso_provider` Setup list rendered empty even after an admin registered a provider: `member_default`'s wildcard `tenant_isolation` RLS (`organization_id == current_user.organization_id`) denied every row, because better-auth writes these via its adapter with no tenantId context so `organization_id` is never stamped, and the platform-admin `viewAllRecords` superuser bypass is gated to private/non-tenant objects.

  `sys_sso_provider` is env-global, admin-only identity config, so it now declares:

  - `tenancy: { enabled: false }` — opts out of multi-tenancy (the env IS the tenant; providers are env-wide), letting a platform admin's `viewAllRecords` bypass see every provider.
  - `requiredPermissions: ['manage_platform_settings']` — object-level capability gate so ordinary members are denied (without it, tenancy-disabled + `member_default`'s `'*': allowRead` would expose providers to every authenticated user).

  Verified E2E: an admin sees all env providers in the Setup → Access Control → SSO Providers list; a non-admin gets 403. (Env-only object — no control-plane cross-tenant impact. The sibling `sys_oauth_application` / `sys_account` nav entries share the same empty-list symptom but span the control plane and need separate per-object analysis.)

- d7a88df: Auth: SSO quality polish (ADR-0024 / cloud#551)

  - **plugin-auth**: `OS_OIDC_PROVIDER_ENABLED` / `OS_SSO_ENABLED` / `OS_SCIM_ENABLED` now parse with the shared `readBooleanEnv` helper (same as `OS_AUTH_TWO_FACTOR` etc.), so the platform-standard truthy set works (`true`/`1`/`yes`/`on`, case-insensitive) instead of only the literal `'true'` — a repeated operator footgun where `OS_SSO_ENABLED=1` silently parsed as disabled. Added unit tests.
  - **platform-objects**: `sys_sso_provider`'s list view gets a per-object empty state ("No SSO providers yet" + a pointer to "Register SSO Provider"), replacing the shared identity-object copy ("records are created automatically … cannot be added here") which is wrong for this object — it HAS a register action.

- 4f8f108: Auth: make the open-source SSO-provider registration form produce a usable IdP (ADR-0024 / cloud#551)

  The `sys_sso_provider` `register_sso_provider` UI action posted FLAT form fields to `@better-auth/sso`'s `/sso/register`, which expects the OIDC fields NESTED under `oidcConfig`. The top-level `clientId`/`clientSecret` were Zod-stripped, so the form persisted an `oidc_config = null` provider that could never complete a login ("Invalid SSO provider").

  - **plugin-auth**: new shared `runRegisterSsoProviderFromForm` helper reshapes the flat form body into the nested shape and re-dispatches it through the real `/sso/register` (so the admin gate, the public-routable `trustedOrigins` allowance, discovery hydration, and secret handling all still run). Exposed via a new `/admin/sso/register` bridge route on the host `AuthPlugin`. (The cloud per-env runtime mounts the same helper in its `AuthProxyPlugin` — mirrors `set-initial-password`.)
  - **platform-objects**: `register_sso_provider` retargets to `/api/v1/auth/admin/sso/register` and gains `discoveryEndpoint`, `scopes`, and attribute-mapping (`mapId`/`mapEmail`/`mapName`) fields. Open mechanism — keeps runtime IdP registration self-service in the OSS edition.

  Verified E2E: an admin registers an external OIDC IdP from the flat form → a member logs in through it (JIT-provisioned, `sys_account.provider_id` set); a non-admin is rejected (403) before discovery runs.

- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/spec@11.1.0
  - @objectstack/metadata-core@11.1.0

## 11.0.0

### Minor Changes

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

### Patch Changes

- 5737261: fix(setup): drop Advanced nav entries for non-listable objects (sys_verification, sys_device_code)

  Dogfooding every Setup menu surfaced two Advanced entries that always render
  "无法加载记录 / failed to load": **Verifications** (`sys_verification`) and
  **Device Codes** (`sys_device_code`). Both objects deliberately omit `list`
  from `apiMethods` (sensitive, ephemeral secrets — verification tokens and OAuth
  device-grant codes are not meant to be browsed), so the generic object/list-view
  menu can only ever 405. Removed both nav entries (and their orphaned zh labels);
  the objects remain reachable by id. Re-adding a browse menu would require
  enabling `list` on the object — a security decision, not a nav fix.

- a619a3a: fix(setup): first-run admin polish — pin Company/Localization, gate dashboard widgets by `requiresService`, i18n + settings PUT envelope

  Dogfooding the Setup app as a brand-new system administrator surfaced a cluster of small first-run gaps, now fixed:

  - **platform-objects**: pin **Localization** and **Company** in the Setup sidebar's Configuration group — both are registered `service-settings` manifests (the two lowest-`order` Workspace settings) but were reachable only via the "All Settings" hub. Translate the previously-English nav labels Cloud Connection (云连接), Datasources (数据源) and Capabilities (能力). Tag the System Overview `widget_organizations` KPI with `requiresService: 'org-scoping'`.
  - **rest**: extend the ADR-0057 D10 server-side visibility gate to **dashboard widgets** — strip widgets whose `requiresService` names an unregistered kernel service (mirrors the existing app-nav gate; `resolveRegisteredServices` now also discovers gates declared on widgets). In a single-tenant runtime this removes the orphan "Organizations" KPI, matching the already-hidden org nav entries.
  - **service-settings**: add the missing zh `help` strings for the Localization manifest (number/currency/first-day-of-week/fiscal-year fields), and accept the `{ values: { … } }` envelope on `PUT /api/settings/:ns` symmetrically with what `GET` returns.

- f44c1bd: fix(platform-objects): hide org/membership surfaces in single-org mode

  The platform gates multi-org features two ways — nav entries on
  `requiresService: 'org-scoping'` (e.g. setup-nav Organizations/Invitations)
  and object actions on `visible: 'features.multiOrgEnabled != false'` (e.g.
  `sys_organization.create_organization`). That convention had only been applied
  to a handful of spots, so a wide band of org/membership surface leaked into
  single-org deployments where it is pure noise or a broken affordance:

  - The Account app's "My Organizations" entry (`sys_member` / `mine` view) was
    gated on `requiresObject: 'sys_member'` — but `sys_member` is a system object
    that is always registered, so the gate never fired. In single-org there are
    no `sys_organization` rows and no auto-stamped memberships, so the view is
    always empty for every user. Re-gated on `requiresService: 'org-scoping'`.
  - The setup-nav "Teams" entry had no gate at all, while its sibling
    Organizations/Invitations entries were correctly service-gated. Added
    `requiresService: 'org-scoping'`.
  - Org/membership mutation actions rendered (and on toolbars, were clickable)
    in single-org but hit better-auth endpoints that resolve an active org that
    does not exist, failing at the API. Gated each on
    `features.multiOrgEnabled != false`:
    - `sys_user.invite_user` (the most exposed — the Users list is always
      reachable in single-org)
    - `sys_member.add_member` / `update_member_role` / `remove_member`, and
      `transfer_ownership` (combined with its existing `record.role != 'owner'`
      condition)
    - `sys_team.create_team` / `update_team` / `remove_team`
    - `sys_team_member.add_team_member` / `remove_team_member`
    - `sys_invitation.invite_user` / `resend_invitation` / `cancel_invitation`
      (recipient-side accept/reject stay record-gated; they are unreachable in
      single-org anyway since no invitation rows exist)

  Also tightened the remaining single-org rough edges on these objects:

  - `sys_organization` admin actions (`update` / `delete` / `set_active` /
    `leave` / `change_slug`) are now all gated on
    `features.multiOrgEnabled != false`, joining the already-gated
    `create_organization` — previously only create was gated.
  - `titleFormat` no longer renders a null organization: `sys_member` is titled
    `'{user_id} ({role})'` (was `'… in {organization_id}'`) and `sys_invitation`
    is titled `'Invitation for {email}'` (was `'Invitation to {organization_id}'`).
    In single-org `organization_id` is null, so the old formats read "… in null".
    The new fields are more useful identifiers in both modes.

  No behavior change in multi-org deployments (`OS_MULTI_ORG_ENABLED=true`):
  `features.multiOrgEnabled` is true and the `org-scoping` service is present, so
  every gate evaluates to visible exactly as before. This is metadata-only — no
  schema, API, or runtime changes.

- Updated dependencies [4d99a5c]
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
  - @objectstack/metadata-core@11.0.0
  - @objectstack/spec@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/metadata-core@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/metadata-core@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/metadata-core@10.1.0

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

- 2256e93: Setup nav: gate Organizations/Invitations on multi-org; enforce `requiresService` server-side (ADR-0057 addendum D10).

  `rest-server`'s `filterAppForUser` now honours `NavigationItem.requiresService` — entries
  whose named kernel service isn't registered are dropped from the served app metadata
  (fail-open when the kernel can't be probed; previously the field was a frontend-only hint).
  Applies `requiresService: 'org-scoping'` to the Setup app's Organizations and Invitations
  entries, so they surface only in multi-org (multi-tenant) deployments and disappear in
  single-tenant. Business Units is intentionally left ungated — it is open per the open/paid
  seam + D12 ("pick people by BU"); only the hierarchy rollup capability is enterprise.

- 7108ff3: Drop the unused `team` value from `sys_business_unit.kind` (ADR-0057 addendum D11).

  The `team` kind collided head-on with the first-class `sys_team` object: a
  `kind='team'` business unit walks the hierarchical `BusinessUnitGraphService`,
  while `sys_team` is the flat better-auth collaboration grouping served by
  `TeamGraphService`. `kind` is a display-only categorisation hint (it does not
  change graph semantics) and had **zero** usages anywhere in the repo, so this is a
  safe narrowing with no data migration. New enum:
  `company | division | department | office | cost_center`.

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

- ae271d0: feat(identity): add an Org Chart tree view to `sys_business_unit`

  `sys_business_unit` is already a self-referencing hierarchy
  (`parent_business_unit_id`, ADR-0057 D2) but Setup only exposed flat grids. Adds
  an `org_chart` list view (`type: 'tree'`) that renders the hierarchy as an
  indented, expand/collapse tree-grid, listed first so it's the default tab. No
  schema change — the parent pointer and graph traversal already existed; this only
  surfaces them. The `active` / `inactive` / `by_kind` / `all` grids stay for
  search, filter, and bulk edit.

- 47d978a: Add `manager_id` (self-lookup) to `sys_user` — the reporting chain that the ADR-0057 `own_and_reports` hierarchy scope walks.

  The `own_and_reports` scope was implemented in the resolver but **unbacked**: nothing on `sys_user` modelled a manager, so it always degraded to owner-only. This adds the field (+ en/zh/ja/es labels) and extends the scope-depth dogfood to prove the scope end-to-end — a user now sees their own records plus everyone down their `manager_id` chain.

### Patch Changes

- 61ed5c7: Complete the ADR-0057 `sys_department` → `sys_business_unit` rename in the Setup app and across the object's i18n (en / zh / ja / es).

  - Setup nav entry "Departments" → "Business Units" (`nav_departments` → `nav_business_units`).
  - `sys_business_unit` / `sys_business_unit_member` field **labels and descriptions** in the object definitions now read "business unit" instead of "department" (the generated `en` labels had been hand-updated ahead of the def; the def was the stale source).
  - All four locales' generated object translations aligned to 业务单元 / ビジネスユニット / Unidad de negocio.

  Intentionally preserved: the `kind` enum value `department` (a business unit can be _of kind_ department) and the multi-concept node descriptions that list kinds.

- 0df063e: Fix: `sys_business_unit` / `sys_team` could not be created in single-tenant deployments.

  `organization_id` was `required`, but single-tenant has no `sys_organization` row and
  nothing auto-stamps one (OrgScopingPlugin is multi-tenant-only), so every create failed
  with `VALIDATION_FAILED: organization_id (required)`. Make `organization_id` optional on
  both objects: single-tenant leaves it null; multi-tenant still auto-stamps it via
  OrgScopingPlugin and tenant-isolation RLS hides any null-org row (fail-closed), so there is
  no cross-tenant exposure. (sys_member / sys_invitation carry the same `required` flag but are
  created only through better-auth org flows, which always supply an org — left unchanged.)

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
  - @objectstack/metadata-core@10.0.0

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
  - @objectstack/metadata-core@9.11.0

## 9.10.0

### Patch Changes

- 4331adb: fix(i18n): add view form `end_user_controls` translations for en, es-ES, ja-JP and zh-CN metadata-forms bundles.
- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/metadata-core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/metadata-core@9.9.1

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
  - @objectstack/metadata-core@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/metadata-core@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/metadata-core@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/metadata-core@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/metadata-core@9.5.1

## 9.5.0

### Patch Changes

- 5be7102: i18n(metadata-forms): correct stale page-`type` help text across locales

  The page `type` field help text still described page types as "record, home, app, dashboard …" — listing `dashboard` (and implying grid/kanban/calendar) as page types, which is wrong after the ADR-0047 page-type cleanup: those are visualizations configured under Interface, not page kinds. Updated en / zh-CN / ja-JP / es-ES to "page kind — list / record / home / app / utility; visualizations live under Interface". Also fixed the stale zh-CN `kind` help text (it described "record / list / detail" instead of the record-page override mode).

- Updated dependencies [d08551c]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/metadata-core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [fef38ec]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/metadata-core@9.4.0

## 9.3.0

### Minor Changes

- c802327: Marketplace Setup navigation is now plugin-owned (cloud ADR-0009): `MarketplaceProxyPlugin` carries the "Browse Marketplace" entry and `MarketplaceInstallLocalPlugin` carries "Installed Apps" — no plugin mounted (e.g. `OS_CLOUD_URL=off`), no entry, no dead page. The two entries are removed from `@objectstack/platform-objects`' setup-nav contributions (ADR-0029 K2 ownership handoff).

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/metadata-core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/metadata-core@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/metadata-core@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/metadata-core@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/metadata-core@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/metadata-core@8.0.1

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
  - @objectstack/metadata-core@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/metadata-core@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/metadata-core@7.8.0

## 7.7.0

### Patch Changes

- 023bf93: fix(spec): reject unknown top-level keys on `ObjectSchema.create()` (#1535)

  `ObjectSchemaBase` is a plain `z.object({...})` (Zod default `.strip()`), so any
  unknown top-level key passed to `ObjectSchema.create()` — `workflows`, a typo'd
  `validation`/`indexs`, etc. — was discarded silently: no error, no warning, and a
  green `tsc`. Declarative metadata an author believed they shipped (e.g. object-level
  `workflows: [...]`) vanished from every built artifact, dead from day one. This is the
  metadata-shape analogue of ADR-0032's "no silent failure" principle.

  `create()` now rejects unknown top-level keys with a precise, fixable build error that
  names the offending key(s), suggests the intended key on a likely typo
  (`validation` → `validations`), and — for known-confusable keys like `workflows` —
  points authors at the supported mechanism (a lifecycle hook `src/objects/<name>.hook.ts`
  or a top-level `record_change` flow; there is no object-level `workflows[]` field). The
  factory signature also constrains excess keys to `never`, so the mistake is caught at
  `tsc` time as well as at build.

  The non-strict `ObjectSchema.parse()` load path (registry/artifact validation) is
  unchanged.

  Also fixes two platform objects (`sys_secret`, `sys_setting_audit`) that carried
  silently-stripped `views`/`scope`/`defaultViewName` keys: their intended list views are
  migrated to the supported `listViews` field (`type: 'list'` → `'grid'`) so they now
  render instead of being dropped. The `objectstack-data` skill's CRM blueprint no longer
  teaches the non-existent `workflows[]` shape.

- 764c747: fix(metadata): home the metadata-storage objects in metadata-core and register them from ObjectQL

  Standalone "host config" apps boot without `@objectstack/metadata`'s MetadataPlugin, so nobody registered the metadata-storage objects (`sys_metadata`, `_history`, `_audit`, `sys_view_definition`) into ObjectQL — their tables were never schema-synced and ObjectQL's own protocol (`loadMetaFromDb` / `getMetaItems`) failed with `no such table: sys_metadata` on every read.

  - Move the four storage-object definitions from `@objectstack/platform-objects/metadata` to `@objectstack/metadata-core` (the lowest package shared by their real consumers); `platform-objects/metadata` now re-exports them for back-compat.
  - `ObjectQLPlugin` registers these objects itself (gated on `environmentId === undefined`, mirroring `restoreMetadataFromDb`) so their tables always sync on platform/standalone kernels.
  - Gate the SQL driver's tenant-audit warning on actual multi-tenant mode — `organization_id` now exists on every table, so column presence alone no longer implies "tenant-scoped"; single-tenant boots no longer spam the warning for system writes.

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/metadata-core@7.7.0

## 7.6.0

### Patch Changes

- 7ae6abc: Fix `sys_user` load failure after the validation-rule type trim (#1485)

  #1485 trimmed the unenforceable validation-rule types (`unique`, `async`,
  `custom`) from the `ValidationRuleSchema` discriminated union, but `sys_user`
  still declared an `email_unique` rule with `type: 'unique'`. Loading the object
  then threw a `ZodError` ("Invalid discriminator value … at validations[0].type"),
  failing `platform-objects.test.ts` and turning `main` red.

  The rule was redundant: `sys_user` already declares a unique index on `email`
  (`indexes: [{ fields: ['email'], unique: true }]`), and the user table is
  managed by better-auth which enforces email uniqueness at the source. Removed
  the unenforceable validation rule; uniqueness remains enforced by the index.
  No other object uses a trimmed validation type.

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

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1

## 7.4.0

### Minor Changes

- c72daad: ADR-0029 D7 — Setup app navigation contributions.

  Adds the UI-layer analog of object `own`/`extend`: a package can contribute
  navigation items into an app it does not own, so a shared admin app can be a
  thin shell while each capability plugin ships the menu for the objects it owns.

  - **`@objectstack/spec`** — new `NavigationContributionSchema` (`{ app, group?,
priority, items }`) and an optional `navigationContributions` field on the
    manifest.
  - **`@objectstack/objectql`** — `SchemaRegistry.registerAppNavContribution()`
    plus lazy merge in `getApp` / `getAllApps` (by target group id + priority,
    cloning so the stored app is never mutated); the engine wires
    `manifest.navigationContributions` during app registration.
  - **`@objectstack/platform-objects`** — the Setup app becomes a **shell** of
    empty group anchors; its entries for platform-objects-owned objects move to
    `SETUP_NAV_CONTRIBUTIONS`.
  - **`@objectstack/plugin-auth`** — registers `SETUP_NAV_CONTRIBUTIONS` alongside
    the Setup app it already registers.
  - **`@objectstack/plugin-webhooks`** — contributes its `Webhooks` /
    `Webhook Deliveries` entries into the Setup `group_integrations` slot (it owns
    `sys_webhook` / `sys_webhook_delivery` per K2.a), demonstrating end-to-end
    cross-plugin contribution.

  The rendered Setup nav is identical to the former static artifact — just
  assembled from its owners. A disabled/absent capability contributes nothing and
  its slot stays empty (in addition to the existing `requiresObject` gating).
  This unblocks moving each remaining K2 domain's menu out of the monolith with
  its objects.

- eea3f1b: ADR-0029 K0 + K2.a — single-owner invariant and webhooks ownership pilot.

  **K0 (`@objectstack/objectql`)** — add `SchemaRegistry.assertSingleOwnerPerObject()`,
  the install-time backstop for the kernel-decomposition invariant: every
  registered object must resolve to exactly one `own` contributor. A second
  cross-package owner is already rejected at registration time; this additionally
  catches "extend with no owner" (which would otherwise resolve to nothing). Call
  after kernel bootstrap completes.

  **K2.a (`@objectstack/plugin-webhooks` ← `@objectstack/platform-objects`)** — move
  the `sys_webhook` object definition out of the `platform-objects` monolith into
  `@objectstack/plugin-webhooks`, where it joins its sibling `sys_webhook_delivery`
  so the plugin owns both its data model and behavior as one unit. `sys_webhook` is
  no longer exported from `@objectstack/platform-objects` (or its `/integration`
  subpath, now an empty barrel); import it from `@objectstack/plugin-webhooks/schema`
  instead. Runtime behavior is unchanged — the webhook plugin already registered
  `sys_webhook` at runtime; only the definition's home moved. Setup-app navigation
  (which references `sys_webhook` by name) and existing i18n bundles (object-name
  keyed) continue to work. Per ADR-0029 D8, migrating the object's i18n extraction
  into the plugin is a tracked follow-up before the next translation regeneration.

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

- 4cc2ced: ADR-0029 K2.b — approvals domain ownership + Setup nav contribution.

  Moves `sys_approval_request` / `sys_approval_action` out of the
  `@objectstack/platform-objects` monolith into `@objectstack/plugin-approvals`,
  which already registers and operates them — so the plugin now owns its data
  model, behavior, and admin menu as one unit.

  - The object definitions move to `plugin-approvals`; `platform-objects` no
    longer exports them from `/audit`. Runtime is unchanged (the plugin already
    registered them at runtime).
  - **D7 navigation** — the Setup app's `group_approvals` entries (`Requests`,
    `Action History`) move out of `platform-objects`' `SETUP_NAV_CONTRIBUTIONS`
    into `plugin-approvals`' `navigationContributions`. The plugin fills the slot
    it owns; when the plugin is absent the slot stays empty.
  - **i18n (D8)** — the objects are removed from the `platform-objects` i18n
    extract config; their existing generated translation bundles keep working at
    runtime (object-name keyed). Migrating the i18n extraction/bundles to the
    plugin remains the tracked cross-cutting follow-up (best done with the
    `os i18n extract` tooling, not hand-edited generated files).

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

- c381977: Harden the notification pipeline: race-safe dedup + opt-in retention (ADR-0030).

  **Race-safe dedup.** `sys_notification.dedup_key` is now declared a **UNIQUE**
  index (was a plain index), and `emit()` **converges on a unique-key conflict**:
  the pre-insert `dedup_key` check is a fast-path, but if a concurrent `emit`
  raced past it and inserted first, our insert hits the violation — we catch it
  and converge to the winner's event (a dedup hit) instead of throwing or
  double-emitting. This mirrors the delivery outbox's enqueue convergence and
  stops a record-change storm from producing duplicate bell notifications. SQL
  treats NULLs as distinct, so the common events with no `dedup_key` are
  unconstrained. (Enforcement is per-driver: where declared indexes are
  materialized the conflict path activates; drivers that don't materialize them
  fall back to the best-effort fast-path — the catch is simply never taken. Note
  the SQL driver currently doesn't sync declared object indexes, which already
  affects the delivery/receipt unique indexes — tracked separately.)

  **Opt-in retention.** New `NotificationRetention` sweeper + plugin options
  `retentionDays` / `retentionSweepMs`. Every `emit()` writes a `sys_notification`
  event (plus delivery/materialization/receipt rows), so a high-frequency
  periodic flow grows the tables unbounded. When `retentionDays > 0`, a
  low-frequency sweep (default hourly, timer `unref`'d) bulk-deletes events,
  deliveries, inbox messages and receipts older than the cutoff — a notification
  ages out wholesale, keeping the model consistent (no dangling `notification_id`)
  and the bell (recent-only) unaffected. The delivery row's epoch-ms `created_at`
  vs the others' ISO `created_at` is handled per target. **Default off** — no
  notification data is deleted without explicit operator policy. Each target is
  isolated (one object's failure doesn't abort the sweep), and the sweep runs
  under a system context (retention is a cross-tenant operator policy).

  Tests: +7 `service-messaging` cases (converge-on-conflict, non-conflict
  rethrow, retention cutoff-formatting per target, no-engine / non-positive
  no-ops, failure isolation, missing-count) — 102 passing.

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

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0

## 7.1.0

### Patch Changes

- 6228609: Account App: route Profile to a custom React component instead of the
  generic sys_user record page.

  The Account App's `nav_account_profile` entry switched from
  `type: 'object'` (sys_user record, current user id) to
  `type: 'component'` with `componentRef: 'account:profile_card'`.
  End users now see a settings-form-style "My Profile" card
  (avatar / name / password / SSO recovery) registered by the Console
  runtime, while the `sys_user` slotted record page (`SysUserDetailPage`)
  is unchanged and remains the admin view reached from Setup → Users.

  This is a behavioural change for any Studio override that mutates
  `nav_account_profile`: the entry no longer has `objectName`,
  `recordId`, or `requiresObject`. Override consumers should drop
  those fields and target `componentRef: 'account:profile_card'`
  (or restore the previous nav item type explicitly).

  Requires a Console build that registers `account:profile_card`
  (included in the matching `@object-ui/console` release pinned via
  `.objectui-sha`).

  Verified end-to-end: login → Account App → 个人资料 sidebar item
  → `/_console/apps/account/component/account/profile_card` renders
  the React Profile card; editing Name and clicking Save Changes
  POSTs `/api/v1/auth/update-user` (200) and persists.

  Also removes the `nav_account_preferences` entry that exposed the
  raw `sys_user_preference` table as a "Preferences" page in the
  Account App. `sys_user_preference` is an internal key-value store
  the UI uses for state like `ui.recent`, `ui.favorites`, theme, and
  sidebar collapse — not a user-curatable settings surface. A future
  `account:preferences_card` React component should provide curated
  theme / locale / timezone / notifications toggles when needed.
  The corresponding `nav_account_preferences` i18n labels were
  removed from all locale bundles (en / es-ES / ja-JP / zh-CN).

  The upstream `@object-ui/console` release also fixes a latent
  `useState` bug in the same ProfilePage: when mounted under
  `<Suspense>` before `AuthProvider` resolves, `user` is null on
  first render and `setName(user?.name ?? '')` initialised to `''`
  with no follow-up sync. A `useEffect` now mirrors `user.name`
  into local state. This was masked when the page was only reached
  via the System Hub route (where `AuthGuard` ensured user was
  already loaded) and is exposed by the new mount path.

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0

## 7.0.0

### Minor Changes

- 74470ad: **New `account` App for self-service identity management + `App.hidden` shell hint**

  Adds a dedicated **Account** App (`name: 'account'`, icon `user-circle`) that exposes the three end-user identity surfaces:

  - **Two-Factor Authentication** — `sys_two_factor`
  - **Linked Accounts** — `sys_account`
  - **OAuth Applications** — `sys_oauth_application`

  The app declares **no** `requiredPermissions`, so every authenticated user can reach it — unlike Setup, which requires `setup.access` and therefore excludes the default `member_default` permission set. Combined with the C-tier `resultDialog` actions already shipped on these objects (2FA QR + backup codes, OAuth `client_secret` reveal, `link_social` redirect), this replaces the legacy standalone `apps/account` SPA with a single console + metadata-driven surface.

  **New `App.hidden: boolean` field** (`packages/spec/src/ui/app.zod.ts`) hides an app from the top-level App Switcher. Hidden apps stay fully routable and permission-checked; the shell is expected to surface them through the avatar / user dropdown instead. Mirrors the GitHub Settings / Google account chip / Salesforce Personal Settings pattern. The Account app is the first user.

  Wiring: `plugin-auth` registers `ACCOUNT_APP` alongside `SETUP_APP` / `STUDIO_APP` (`packages/plugins/plugin-auth/src/auth-plugin.ts`). The legacy duplicate entries inside Setup's Advanced group are kept unchanged — they remain admin-only for tenant-wide inspection.

  **Follow-up for objectui**: the shell's `AppSwitcher` and avatar `DropdownMenu` need updating to honour `app.hidden` (filter hidden apps out of the switcher; render them as dropdown menu entries). Tracked separately.

- d29617e: Add `Action.resultDialog` for one-shot reveal of API responses

  Some platform operations return values the user MUST copy now because they
  cannot be retrieved later — TOTP enrollment URIs, OAuth client secrets,
  backup recovery codes. Previously these were handled by bespoke account-app
  pages because actions only surfaced a `successMessage` toast.

  This change adds:

  - **`Action.resultDialog`** — describes a post-success modal that renders
    selected fields from `result.data`. Supports `qrcode`, `code-list`,
    `secret`, `text`, and `json` field formats. When set, renderers SHOULD
    suppress `successMessage` and require explicit acknowledgement.

  - **`Action.target` interpolation contract** — formalised TSDoc spelling
    out the `${param.X}` and `${ctx.X}` substitution rules (with mandatory
    `encodeURIComponent` for URL query positions). Used by redirect-style
    actions like `link_social`.

  New / updated platform actions:

  - `sys_two_factor`: `enable_two_factor` now reveals TOTP URI + backup codes;
    added `regenerate_backup_codes`.
  - `sys_oauth_application`: `rotate_client_secret` now reveals the new
    secret; added `create_oauth_application` toolbar action.
  - `sys_account`: added `link_social` toolbar action (type:`url`, templated
    target) for self-service identity linking.

  These let the Setup app cover OAuth-app registration, 2FA enrollment, and
  social-account linking entirely through metadata, removing the last
  must-have reasons to ship a separate `apps/account` SPA.

  Renderer-side work (separate PR in `objectui`): consume `resultDialog`,
  implement `${param}/${ctx}` interpolation, ship `ResultDialog` component.
  See `c-tier-renderer-contract.md` design note.

- 257954d: **Organization detail page — Members / Invitations / Teams tabs (slotted Page)**

  Adds a record-detail Page for `sys_organization` (`SysOrganizationDetailPage`) so admins can manage the entire membership graph from a single record view instead of switching between three separate Setup list views.

  The page uses `kind: 'slotted'` and overrides only the `tabs` slot — header, actions, highlights, details and discussion fall through to the synthesized default, so the existing record-header actions (`Set Active`, `Edit`, `Delete`, `Leave Organization`) are preserved unchanged.

  Three tabs, each a `record:related_list` scoped by `organization_id`:

  - **Members** — `sys_member` (user, role, joined)
  - **Invitations** — `sys_invitation` (email, role, status, expires, inviter)
  - **Teams** — `sys_team` (name, created, updated)

  Per-row actions defined on each child object (`invite_user`, `cancel_invitation`, `remove_member`, `transfer_ownership`, `create_team`, …) are inherited unchanged — no admin endpoint is re-declared here.

  **Deliberately omitted:**

  - **OAuth Apps** — `sys_oauth_application` is owned by `user_id`, not `organization_id`; it surfaces on the user's Account view instead.
  - **SSO** — no `sys_sso*` object exists yet; will become a fourth tab when better-auth's SSO plugin lands.

  **Package wiring:**

  - `@objectstack/platform-objects` exposes a new `./pages` subpath export and re-exports `SysOrganizationDetailPage` from the root.
  - `plugin-auth` registers it via the existing `manifest.register({ ..., pages: [SysOrganizationDetailPage] })` call alongside the platform apps and dashboards.

  Verified end-to-end on the console-starter shell against `example-crm` — the three tabs render and the Members/Teams tables populate with the rows better-auth creates automatically when an org is provisioned.

### Patch Changes

- d29617e: Add self-service account & invitation actions on `sys_*` objects so the
  Setup App can host the day-to-day "account settings" affordances the
  standalone Account SPA used to own — no per-page React code needed.

  **New actions:**

  - `sys_user`
    - `update_my_profile` — wraps `POST /api/v1/auth/update-user` (name + image)
    - `change_my_password` — wraps `POST /api/v1/auth/change-password`
      (current + new + optional revoke-other-sessions)
    - `change_my_email` — wraps `POST /api/v1/auth/change-email`
      (verification email is sent to the new address)
    - `delete_my_account` — wraps `POST /api/v1/auth/delete-user`
      (requires current password)
  - `sys_invitation`
    - `accept_invitation` — wraps `POST /api/v1/auth/organization/accept-invitation`
    - `reject_invitation` — wraps `POST /api/v1/auth/organization/reject-invitation`
  - `sys_member`
    - `transfer_ownership` — wraps `POST /api/v1/auth/organization/update-member-role`
      with `role: 'owner'` (better-auth auto-demotes the previous owner to admin)

  All four `sys_user` self-service actions are gated by
  `visible: 'record.id == ctx.user.id'` so they only render on the signed-in
  user's own row — they never leak into the admin Users list. The two
  `sys_invitation` recipient actions use
  `record.email == ctx.user.email && record.status == 'pending'` so they
  only appear on the user's incoming invitations.

- 010757b: Fix two self-service identity action bugs:

  - `sys_two_factor` was missing the `verified` boolean column that better-auth's two-factor plugin writes during enrollment. Without it the `/2fa/enable` endpoint 500'd with `table sys_two_factor has no column named verified`. Added `Field.boolean({ defaultValue: true })` to match the better-auth schema.
  - `sys_account.link_social` action's `callbackURL` still pointed at the pre-migration Setup path (`/apps/setup/system/sys_account`). Updated to `/apps/account/sys_account` so users land back on the linked-accounts view after the OAuth dance.

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
  - @objectstack/spec@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1

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

- 45d27c5: Setup App: added a **Data Model** navigation group with **Objects** and
  **Fields** entries that open filtered list views of `sys_metadata`.

  To support the new entries, `sys_metadata.listViews` now includes
  `only_objects`, `only_fields`, and `all_metadata` — each filtered by
  `type` and projecting a curated column set (name, namespace, scope,
  managed_by, state, updated_at). The new list views are the read side of
  the protocol-driven metadata editing flow; the matching write surface
  is provided by `MetadataObjectsPage` / `MetadataFieldsPage` in
  `@object-ui/plugin-designer` (separate package), which call the
  existing `/api/v1/meta/*` REST endpoints.

  No behavioural changes to the metadata REST endpoints themselves; no
  migration required.

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
  - @objectstack/spec@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1

## 6.7.0

### Minor Changes

- 4f9e9d4: Setup App: complete the Configuration settings pages.

  **Setup App navigation**

  The Configuration group now lists every built-in settings namespace
  (previously Storage was missing entirely, and Knowledge had no entry):

  - Branding · Email · **File Storage** · **AI & Embedder** · **Knowledge** · Feature Flags

  Order in the left-nav now matches `builtinSettingsManifests` so the
  "All Settings" index and the left-nav stay aligned.

  **AI manifest — embedder section**

  `ai.manifest.ts` now ships an Embedder section in addition to the
  existing chat-LLM section. Knobs:

  - `embedder_provider` — `none` (default) / `openai` / `azure` /
    `dashscope` (阿里通义) / `zhipu` (智谱) / `siliconflow` (硅基流动) /
    `doubao` (火山引擎) / `minimax` / `ollama` / `custom`. Preset list
    mirrors `@objectstack/embedder-openai`'s `OPENAI_COMPATIBLE_PRESETS`.
  - `embedder_api_key` — encrypted password.
  - `embedder_model` — free text with documented examples per provider.
  - `embedder_base_url` — visible for `custom` / `azure` only.
  - `embedder_dimensions` — optional Matryoshka override.
  - `embedder_batch_size` — `embed()` chunk batch size.
  - Test action wired to `POST /api/settings/ai/test_embedder` — fallback
    validates form completeness; real probe lives in `service-ai` /
    `service-knowledge`.

  **New `knowledge` settings manifest**

  `knowledge.manifest.ts` is the canonical surface for RAG infrastructure:

  - `adapter` — `memory` / `turso` / `ragflow`.
  - Turso group — `turso_url` (libsql://, file:, :memory:) + encrypted
    `turso_auth_token`. Leaving URL blank means "reuse the tenant's
    primary libSQL connection" — the recommended cloud setup.
  - RAGFlow group — base URL + encrypted API key + default dataset id.
  - Indexing defaults — `chunk_target`, `chunk_overlap`, `over_fetch`.
  - Permissions — `enforce_rls` defaults to `true` (security-critical;
    toggling off skips the platform's unique RLS re-check on every hit).
  - Test action wired to `POST /api/settings/knowledge/test`.

  **Translations**

  Full `ai` and `knowledge` translation blocks added to both `en.ts` and
  `zh-CN.ts`. Storage block had translations already.

  **Tests**

  - `ai.manifest.test.ts`: +5 cases covering embedder select, encryption,
    test action wiring, and embedder handler validation across 5 provider
    shapes (none / ollama / OpenAI-compatible cloud / custom / azure).
  - `knowledge.manifest.test.ts`: 20 new cases covering manifest shape,
    adapter selection, secret encryption, default `enforce_rls=true`,
    test handler validation across all 3 adapters and payload merging.

  78/78 tests pass in `@objectstack/service-settings`.

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0

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

## 5.2.0

### Minor Changes

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

### Patch Changes

- f0f7c27: Add `mark_read` / `mark_unread` row actions to `sys_notification` and polish
  listView columns + grouping.

  - Row-level `mark_read` / `mark_unread` actions guarded by CEL `visible`
    expressions so each only renders on rows in the appropriate state. Both
    use the generic PATCH `/api/v1/data/sys_notification/{id}` endpoint with
    `bodyExtra` to flip `is_read` (and clear `read_at` on unmark).
  - Reordered listView columns to lead with `title` + `actor_name` (the "who
    did what" users actually scan) and demote `type` to a chip column.
  - `mine` view now groups by `type` so mention/assignment storms don't bury
    system or task_due rows.

  `mark_all_read` is intentionally not added server-side — there's no bulk
  PATCH primitive on the REST surface yet, and the popover already handles
  multi-row mark-all client-side via N single-row PATCHes
  (`InboxPopover.tsx` → `AppHeader.markAllRead`).

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

- 823d559: Remove `sys_metadata_history.metadata_id` column.

  The column was originally a `Field.lookup` FK into `sys_metadata.id`,
  then downgraded to plain `text` during the M1 history-writes work so
  that DELETE tombstones could keep an orphaned ref. After M1 we
  concluded the column carries no business value:

  - Audit-time joins use `(organization_id, type, name, version)`,
    which is already a UNIQUE composite key.
  - The physical row id is a database-internal detail with no logical
    identity — it cannot follow an item through delete + recreate.
  - No code reader was ever added.

  This release removes the column outright:

  - Dropped `metadata_id` from `SysMetadataHistoryObject`
    (`@objectstack/platform-objects`).
  - Dropped `metadataId` from `MetadataHistoryRecordSchema`
    (`@objectstack/spec`).
  - `SysMetadataRepository.put`/`delete` no longer write the column.
  - Legacy `DatabaseLoader.createHistoryRecord` no longer writes it;
    `getHistoryRecord`/`queryHistory` filter by `(type, name)` directly
    (no parent-row lookup needed).
  - `MetadataHistoryCleanup` `maxVersions` policy groups by
    `(type, name)` instead of `metadata_id`.

  **Migration**: Drop the column from existing `sys_metadata_history`
  tables in a follow-up SQL migration. Existing history rows remain
  queryable since `(organization_id, type, name, version)` is already
  the canonical lookup key. No consumer code should be reading
  `metadata_id` — if you are, switch to `(organization_id, type, name,
version)`.

  See ADR-0008 §14 for the full rationale.

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0

## 5.0.0

### Patch Changes

- 888a5c1: PR-10d.3 — feature flag for `SysMetadataRepository.put` write path in `saveMetaItem`.

  - `ObjectStackProtocolImplementation` now accepts an `options.useRepositoryWritePath` flag
    (also honored via `OBJECTSTACK_USE_REPOSITORY_WRITE_PATH=1`) that routes overlay writes
    through `SysMetadataRepository.put`, appending to the change-log and emitting HMR `seq`.
  - `saveMetaItem` request grew optional `parentVersion` (If-Match) and `actor` fields.
    `ConflictError` is mapped to a 409 `metadata_conflict` API error.
  - Plural metadata type aliases (`views`, `dashboards`, ...) are normalized to singular
    before the repo's overlay-allowlist gate.
  - `SysMetadataRepository.put`/`delete` now update/delete by row `id` (the engine's
    strict `.update` semantics require an id or `multi:true`).
  - `sys_metadata.checksum` column widened from 64 → 71 chars to hold the `"sha256:"`
    prefix produced by `hashSpec()`.
  - Default behaviour unchanged: legacy raw-engine path remains until PR-10d.4 flips the
    flag and removes it.

- Updated dependencies [2f9073a]
  - @objectstack/spec@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
