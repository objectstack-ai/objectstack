# Changelog

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
- 5f5e234: fix(security): `sys_permission_set.active` and `sys_position.active` now actually stop granting access (#8613)
  
  <!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
  added, renamed or retired. `active` is a ROW property of a `sys_permission_set`
  / `sys_position` record, not a key on `PermissionSetSchema` (which is a strict
  object in `packages/spec` and deliberately declares no such key — see
  `permission-set-projection.ts`'s ROW_STATE_COLUMNS). No spec schema, export or
  stored metadata shape changes, so there is no conversion to register and no
  tombstone to write. The change is a runtime predicate at the authorization
  resolution seam; the remedy for an affected deployment is operational
  (re-activate rows that were switched off), not a metadata migration. -->
  
  **BREAKING for deployments that already switched a permission set or position
  off.** Both objects ship a Deactivate action whose confirmation dialog promises,
  in all four locales, that access stops:
  
  > Deactivate this permission set? Existing assignments stay in place but stop
  > granting access until re-activated.
  > Deactivate this position? Users keep their assignment but the position stops
  > granting permissions until re-activated.
  
  Nothing read the column. Measured on the real resolver: a position seeded
  `active: false` still granted its permission sets, and a permission set seeded
  `active: false` still returned `posture: PLATFORM_ADMIN` with its system
  permissions. Deactivation moved a badge in Setup and nothing else — while the
  admin who had just revoked a compromised or over-broad grant was told the
  opposite, and whose likely next step was therefore *not* the action that would
  have worked (delete the set, or remove the assignments).
  
  **What changes at runtime.** `resolveAuthzContext` / `resolveUserAuthzGrants`
  (`@objectstack/core`) — the single seam every transport resolves authorization
  through — now drop a deactivated row **before** any derivation:
  
  - a deactivated `sys_position` no longer contributes its
    `sys_position_permission_set` grants, and its name leaves `positions` (so the
    name-reuse path cannot resolve the same grant one layer down);
  - a deactivated `sys_permission_set` contributes no name, no
    `system_permissions`, no `tab_permissions`, **and no `PLATFORM_ADMIN`
    posture** — the flag is applied before the posture is derived, not after;
  - the `plugin-security` DB loader applies the same predicate, which is what
    judges a set reached by NAME through an active position of the same name.
  
  Both tables were already read at that seam, so this costs **zero new hot-path
  queries**.
  
  **⚠️ Read this before upgrading.** Any `sys_permission_set` or `sys_position`
  row currently carrying `active: false` **stops granting the moment this
  lands** — on live data, with no migration step to notice. That is the correct
  direction (it is what the dialog said when someone clicked Deactivate), but on
  an installation that used the switch believing it was inert it is a real
  revocation. Before upgrading, list the deactivated rows and re-activate any that
  are still meant to grant:
  
  ```
  GET /api/v1/data/sys_permission_set?filters=[["active","=",false]]
  GET /api/v1/data/sys_position?filters=[["active","=",false]]
  ```
  
  A row whose `active` column is **absent or NULL** is unaffected: the predicate
  is "explicitly deactivated", never "explicitly active", so rows that predate the
  column keep granting exactly as before.
  
  **Break-glass, closed in the same change** (`@objectstack/plugin-auth`).
  Enforcing the flag opened a one-click, installation-wide lockout: deactivating
  `admin_full_access` un-makes every platform admin at once, through a payload
  that touches neither `name` nor any identity table, and re-activating requires
  the permission the click just took away (the seeders deliberately never
  reconcile `active`, so no restart restores it). The last-administrator guard now
  judges that write like the delete and rename spellings it already refused, and
  an environment whose break-glass set is *already* off is read as emptied rather
  than as a bootstrap window — so it does not silently disarm the guard for every
  other identity write. Re-activation itself stays permitted, or the refusal would
  have no way out from inside the product.
- f8eb736: feat(security): bind the break-glass standing-key lists to what the authz resolver actually reads — the correspondence stops being prose (#8734)
  
  `plugin-auth`'s last-administrator guard (ADR-0024 D5.2) decides whether a
  pending write can empty the administrator population by testing the payload
  against three standing-key lists (`MEMBER_STANDING_KEYS`,
  `GRANT_STANDING_KEYS`, `PERMISSION_SET_STANDING_KEYS`). A payload touching none
  of them is skipped without any reads — so a column `resolveAuthzContext` starts
  reading that a list omits is a write class the guard **silently stops judging**,
  on the one path whose failure mode is an installation-wide administrator lockout
  with no in-product recovery.
  
  Nothing bound the two together. The correspondence lived in a comment, and it
  had already gone false once: #6084 wrote — naming `active` explicitly — that
  everything a permission-set write touches other than `name` is invisible to "who
  is an administrator". That was true when written; #8613 made `active` a
  resolution-time predicate and the sentence became false. Nothing mechanical
  would have caught it, because the guard's own tests stay green precisely when
  the guard is never consulted.
  
  **The mechanism is two links, and the first one is a measurement.**
  
  - `@objectstack/core` now exports `ADMIN_STANDING_SURFACE` — declared beside the
    resolver, listing every table the administrator-derivation path reads, each
    classified `derives` or `reads-only` with its reason, and for the deriving
    tables every column read. It is asserted **equal** to what the real
    `resolveAuthzContext` reads, observed at runtime through a recording engine
    that records every property access and every `where` key per table. Observation
    rather than source extraction because the reads that matter have moved into
    helpers: `active` is read by `isRowActive(row)` and the ADR-0091 window bounds
    by `isGrantActive(row, now)`, neither named at the resolver's own call site —
    the exact shape #8613 had.
  
  - `@objectstack/plugin-auth` now exports its standing-key lists plus
    `STANDING_KEYS_BY_TABLE` and `STANDING_KEY_EXCLUSIONS`, and a gate requires
    every column of that measured surface to have an answer: it is standing-bearing
    (in a list) or it is excluded with the reason it cannot empty the administrator
    population. There is no third state — the third state is what `active` was
    between #6084 and #8613.
  
  So a resolver change that starts reading a new column fails at the first link
  until the declaration is updated, and at the second until the guard has an
  explicit answer for it. Landing #8613 green would have required writing down that
  deactivating `admin_full_access` cannot empty the administrator population —
  which is false, and which is what the old comment asserted by accident.
  
  **No guard behaviour changes.** Every list keeps exactly the values it had; the
  gate is one-directional by construction (it can only ever demand that the guard
  judges *more*), because the other direction would put pressure on a break-glass
  guard to fire less often.
  
  The table-level half is covered too: a resolver that started deriving
  administrator standing from a **new** table is invisible to any column-set
  comparison, since the table is absent from both sides — so the surface enumerates
  every table the path reads, and an unclassified one fails.

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
- e717ba1: fix(plugin-auth): the four `/admin/sso/*` bridges now run the inline ADR-0068 platform-admin gate before delegating into better-auth (#9653)
  
  `POST /api/v1/auth/admin/sso/{register, register-saml, request-domain-verification, verify-domain}` used to hand the raw request straight to their bridge function, resting authorization entirely on the delegated better-auth endpoints. They now run the same shared platform-admin judge their `/admin/` siblings carry (`platform-admin-gate.ts`), before anything else:
  
  - **anonymous caller → `401 UNAUTHENTICATED`** (previously the capability error: e.g. `404 SSO_REGISTER_FAILED` on a stock boot, which collapsed "not signed in" into "registration failed");
  - **authenticated non-platform-admin → `403 PERMISSION_DENIED`** — this includes org owners/admins, who are not platform admins under ADR-0068; previously, with SSO enabled, the register bridges admitted them (and better-auth's own `/sso/register` admits any authenticated user for an org-less registration — measured on the installed `@better-auth/sso` 1.7.1);
  - **platform admin → unchanged**: the request delegates into better-auth exactly as before, so all inner gates and hooks still run.
  
  Registering an identity provider is a platform-operator action (ADR-0068 D4). The accept set only tightens; no successful flow for a platform admin changes.
- 445ae4d: fix(auth): auth emails follow the deployment locale — all five remaining templates localized, and every send names a locale (#8195)
  
  <!-- adr-0087: not-required (no-migration-prescription) No authorable property is
  added, renamed, retired or tombstoned. This adds locale ROWS to templates that
  already exist (the `sys_email_template` shape is unchanged — `(name, locale)` was
  always its key), plus one new public method on `AuthManager` and one new
  plugin-layer read. Nothing existing changes spelling, so there is no conversion
  to register. -->
  
  Outbound auth mail was English-only on a platform that supports four locales and
  whose UI already switches between them. Two facts made every non-`en-US` template
  row unreachable through the platform's own send path:
  
  - **no auth send named a locale** — all five `sendTemplate` calls in
    `auth-manager.ts` omitted it, so `EmailService`'s ladder resolved
    `DEFAULT_TEMPLATE_LOCALE` (`en-US`) every time;
  - **only one auth template had non-`en-US` rows at all** —
    `auth.email_change_notice` shipped four locales with #8019; the other five were
    `en-US`-only.
  
  Both halves land together, and that is the substance of the fix rather than its
  packaging. Shipping the resolution alone was measured to be **worse than the
  English status quo**: the ladder falls back to the **en-US row body** on a miss
  while `const locale = preferred || row.locale` still hands the caller's locale to
  the render filters — so a zh-CN deployment would have received English prose
  carrying zh-CN-formatted dates and numbers *inside a single message*, which is
  precisely the artefact the row-locale authority (#7801) exists to prevent.
  
  **Templates.** `auth.password_reset`, `auth.verify_email`, `auth.magic_link`,
  `auth.invitation` and `auth.two_factor_otp` each gain `zh-CN`, `ja-JP` and
  `es-ES` rows — 15 new rows, seeded through `BUILTIN_AUTH_TEMPLATES` so they are
  selectable rather than merely exported. Each localized row also carries a
  localized **footer**: `wrap()` supplies an English one by default, so a row that
  forgets it renders fluently translated prose under an English sign-off.
  
  **Resolution.** Per the maintainer ruling of 2026-08-13, the recipient locale is
  the **deployment default**, read from `II18nService.getDefaultLocale()` and
  resolved at the plugin layer — `AuthPlugin` pushes it into
  `AuthManager.setDefaultEmailLocale()` on `kernel:ready`, exactly as it already
  pushes the auth **SMS** locale (#2815). `Accept-Language` is rejected: auth mail
  is routinely sent outside the triggering request (invitations, admin-initiated
  resets), so a per-device header is the wrong authority. A per-user
  `sys_user.locale` column is deferred until there is measured pull for one; when
  it arrives it layers on top of this as an override.
  
  **One spelling gap had to be bridged**, and it is measured rather than assumed:
  `getDefaultLocale()` carries the message-**catalog** language, whose English
  spelling is the bare `en` (`FileI18nAdapter`: `options.defaultLocale ?? 'en'`),
  while template rows are keyed `en-US` and `SendTemplateInput.locale` is
  documented as matched exactly, with "no language-only prefix matching". Passed
  through raw, the commonest deployment of all would miss every row and lean on the
  en-US fallback while telling the render filters `en`. `normalizeAuthEmailLocale`
  therefore promotes a **bare language subtag** to the regional row the platform
  ships (`en` ⇒ `en-US`, `zh` ⇒ `zh-CN`, …) and passes everything else through
  untouched — an unshipped regional tag such as `en-GB` or `fr-FR` may well be a
  tenant's own overlay row, and swallowing it would re-create this very bug for the
  fifth locale onward.
  
  **Nothing changes for an unconfigured deployment.** With no i18n service
  registered, or none declaring `getDefaultLocale`, no `locale` key is passed at
  all and the ladder resolves its documented `en-US` default exactly as before.
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
- 7337f30: chore(deps): production-dependency patch bumps from the weekly Dependabot group (#9212)
  
  Routine dependency-range refresh, no behavior change: `@oclif/core` 4.13.2→4.13.3,
  `esbuild` 0.28.1→0.28.2 and `better-sqlite3` ^13.0.2→^13.0.3 (optional) on
  `@objectstack/cli`; `mingo` 7.2.2→7.2.4 on `@objectstack/driver-memory`; `nanoid`
  6.0.0→6.0.1 on `@objectstack/driver-mongodb`, `@objectstack/driver-sql`,
  `@objectstack/driver-sqlite-wasm` and `@objectstack/driver-turso`, plus
  `better-sqlite3` ^13.0.2→^13.0.3 (optional on `@objectstack/driver-sql`, peer on
  `@objectstack/driver-turso`); `js-yaml` 5.2.2→5.2.3 on `@objectstack/metadata`;
  `@noble/hashes` 2.2.0→2.3.0 and `jose` 6.2.5→6.2.8 on `@objectstack/plugin-auth`;
  `nodemailer` 9.0.3→9.0.5 on `@objectstack/plugin-email`; `@hono/node-server`
  2.0.12→2.1.1 and `hono` 4.12.34→4.13.2 on `@objectstack/plugin-hono-server`;
  `pinyin-pro` 3.28.2→3.29.1 on `@objectstack/plugin-pinyin-search`; and
  `@noble/ciphers` 2.2.0→2.3.0 on `@objectstack/service-settings`.
  
  Every entry above changed a `dependencies`, `optionalDependencies` or
  `peerDependencies` range in the published manifest — the only kind of change
  that reaches a consumer's install. The same Dependabot group also bumped
  `devDependencies` on `@objectstack/hono`, `@objectstack/client`,
  `@objectstack/core`, `@objectstack/plugin-sharing` and `@objectstack/spec`
  (none consumer-facing), and touched the private `apps/docs`,
  `examples/app-todo` and workspace-root manifests (none published) — none of
  those get an entry here.
- 5ed8ee6: Platform admins can ban and unban users again.
  
  `POST /api/v1/auth/admin/ban-user` and `POST /api/v1/auth/admin/unban-user` are
  now served by ObjectStack with the ADR-0068 platform-admin gate instead of
  better-auth's `admin` plugin, which authorizes on the legacy
  `user.role === 'admin'` scalar that ADR-0068 D2 stopped synthesizing. On any
  deployment with the admin plugin on (SCIM forces it, ADR-0071) the `sys_user`
  Ban / Unban actions returned `403 YOU_ARE_NOT_ALLOWED_TO_BAN_USERS` for every
  platform admin; they now succeed, and refuse a plain member with
  `403 PERMISSION_DENIED` and an anonymous caller with `401 UNAUTHENTICATED`.
  
  The break-glass guard that refuses to ban the last local-password login is
  unchanged and still applies.
- 2a6ebaf: feat(plugin-auth): mount `POST /api/v1/auth/organization/add-member` — platform-admin-gated wrapper over better-auth's server-only `auth.api.addMember` (#9941)
  
  better-auth (1.7.1 installed; already true on 1.7.0-rc.2) declares `addMember`
  with **no HTTP path** — server-only — so the catch-all never mounted
  `POST /organization/add-member`, yet the `sys_member` **Add Member** toolbar
  action has always targeted exactly that URL and answered 404. On a multi-org
  posture that 404 was a hard blocker: `admin/create-user`'s reconciler resolves
  no target org under the org wall by design, generic `sys_member` CRUD is
  suppressed (ADR-0010 full lock), and the invite flow needs an email round-trip
  phone-number-only users cannot complete — leaving **no UI path at all** to
  attach an existing user to an organization.
  
  What ships:
  
  - `auth-plugin.ts` now mounts the route ahead of the catch-all, wrapping the
    vendor's own `auth.api.addMember` (its already-a-member pre-check, membership
    limit, team resolution and hooks all stay the vendor's — nothing is
    re-adjudicated, and no `sys_member` row is written directly).
  - **Admit set: platform admin only** (the shared ADR-0068 gate,
    `platform-admin-gate.ts`). Anonymous → `401 UNAUTHENTICATED`; any signed-in
    non-platform-admin — including org owners/admins — → `403 PERMISSION_DENIED`
    (ADR-0112 envelope). The vendor endpoint performs no authorization of its own
    (server-only = trusted caller), which is why the gate is not negotiable.
  - Request headers are forwarded, so an omitted `organizationId` defaults to the
    caller's active organization — the behaviour the action metadata documents.
  - The route is ledgered in `auth-route-ledger.ts` (`source: 'objectstack'`,
    `disposition: 'server-only'` — no SDK method builds this URL; the metadata
    action posts it directly), and the stale `adopt-membership.ts` claim that
    named the vendor path as mounted now describes the real shape.
  
  The `sys_member` action metadata itself is untouched: its target was correct
  all along — the route underneath it now exists.
- 03fa4c9: `POST /api/v1/auth/revoke-session` no longer reports success when it revokes nothing. A request whose `token` does not identify a session belonging to the caller now answers `404` with error code `RESOURCE_NOT_FOUND`, instead of `200 { status: true }` over a skipped delete. A token that matches nothing and a token that belongs to another user answer identically, so the refusal discloses no session-existence information. Requests that do identify the caller's own session are unchanged and still answer `200 { status: true }`.
- b5f6b26: `POST /api/v1/auth/admin/revoke-user-session` no longer reports success when it revoked nothing. When the supplied `sessionToken` does not identify any live session — including a session that was already revoked — the endpoint now answers `404` with error code `RESOURCE_NOT_FOUND` (ADR-0112 envelope) instead of `200 { "success": true }` over a delete that removed no record. The refusal is only ever given to callers who pass the admin plugin's own `session: ["revoke"]` permission check; unauthenticated and unauthorized callers keep the previous `401`/`403` answers byte-for-byte, so no session-existence information is exposed below the permission line. A revoke that does identify a live session still answers `200 { "success": true }` and tombstones the session with reason `admin`, unchanged.
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
- Updated dependencies [56656aa]
- Updated dependencies [c9f5950]
- Updated dependencies [d6e80b2]
- Updated dependencies [07e630e]
- Updated dependencies [66beee0]
- Updated dependencies [2f65b1b]
- Updated dependencies [720ee95]
- Updated dependencies [f287435]
- Updated dependencies [e7bccaa]
- Updated dependencies [2782805]
- Updated dependencies [e43d63a]
- Updated dependencies [5047cb8]
- Updated dependencies [ed4ca59]
- Updated dependencies [9aa8890]
- Updated dependencies [7c9c1dd]
- Updated dependencies [03520eb]
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
- Updated dependencies [c766ec3]
- Updated dependencies [420804d]
- Updated dependencies [51a46a4]
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
- Updated dependencies [3ab2488]
- Updated dependencies [2b292ce]
- Updated dependencies [185c7bd]
- Updated dependencies [abcf853]
- Updated dependencies [8b9eba5]
- Updated dependencies [d575779]
- Updated dependencies [94f7ef8]
- Updated dependencies [c5ac5e4]
- Updated dependencies [a777944]
- Updated dependencies [66dbec4]
- Updated dependencies [dd88e1c]
- Updated dependencies [856527c]
- Updated dependencies [870f710]
- Updated dependencies [45862a5]
- Updated dependencies [79c46da]
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
- Updated dependencies [b537855]
- Updated dependencies [2065e31]
- Updated dependencies [6cb88d9]
- Updated dependencies [b69d0f5]
- Updated dependencies [4dc8a61]
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
- Updated dependencies [6a12e5e]
- Updated dependencies [3851f87]
- Updated dependencies [2a29caa]
- Updated dependencies [9e2e682]
- Updated dependencies [09a6eee]
- Updated dependencies [1a7f907]
- Updated dependencies [cd455c8]
- Updated dependencies [e1bb0ca]
- Updated dependencies [30d3752]
- Updated dependencies [c80e7ae]
- Updated dependencies [499f55e]
- Updated dependencies [09a9a8a]
- Updated dependencies [07026cf]
- Updated dependencies [5d4f3d5]
- Updated dependencies [4d80e8b]
- Updated dependencies [30b1c63]
- Updated dependencies [7fc01db]
- Updated dependencies [079b457]
- Updated dependencies [e43b211]
- Updated dependencies [8f266f1]
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
  - @objectstack/rest@17.1.0
  - @objectstack/core@17.1.0

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

- de113a4: BREAKING(auth): `organization/create` 改判**实际生效的** tenancy posture —— 没有组织墙的部署不再能创建组织 (#5261)

  `POST /api/v1/auth/organization/create` 的闸门此前判的是操作者**请求的** posture
  (`postureEnforcesWall(resolveTenancyPosture())`,一次纯 env 读)。现在判 `tenancy` 服务给出的
  **生效** posture —— `tenancy?.posture ?? resolveTenancyPosture()`,与 `/auth/config` 的
  `features.multiOrgEnabled` 是**同一次求值**。

  ## 为什么

  两个站点此前只在一种形状下分叉,而那种形状恰恰是最不该放行的一种 —— ADR-0093 D5 **降级态**:
  请求了 `isolated`/`group`,但企业包 `@objectstack/organizations` 缺席,于是 `tenancy.posture`
  解析为 `single` 且 `degraded=true`。此时:

  - 闸门读「请求」→ **放行**;
  - `/auth/config` 读「生效」→ `multiOrgEnabled=false`,console 把「创建组织」入口**藏起来**。

  结果是 UI 没有按钮而 API 打得通,并且建出来的每一个组织都是**没有任何引擎强制的租户边界** ——
  声明了但没强制,ADR-0049 最讨厌的那一类,只不过发生在部署层。改判生效 posture 之后两者同解、
  永不分叉:**没有墙,就没有组织**,无论这个部署是从未要过墙,还是要了没拿到。

  ## 破坏性影响(有意为之)

  **没有安装企业包 `@objectstack/organizations` 的部署将完全无法创建组织**,任何 env 组合都不行 ——
  `OS_TENANCY_POSTURE=isolated`、`OS_MULTI_ORG_ENABLED=true`、两个一起设,都不再能把闸门说通。
  这是一次实打实的能力收缩,不是 knob 纠正,所以搭 v17 主版本车。

  | 部署形状                                          | 改前   | 改后          |
  | ------------------------------------------------- | ------ | ------------- |
  | 有企业包,posture `isolated` / `group`(墙真的立着) | 200    | **200**(不变) |
  | **请求了墙但企业包缺席(D5 降级态)**               | 200    | **403** ⚠️    |
  | `single` / 两个 knob 都不设                       | 403    | 403(不变)     |
  | 未注册 `tenancy` 服务的精简嵌入(回落 env 解析)    | 按 env | 按 env(不变)  |

  `serve.ts` 本来就在降级态**默认拒绝启动**(要 `OS_ALLOW_DEGRADED_TENANCY=1` 才走),所以这条收缩
  命中的是一个已经需要显式选择才能到达的形状:从此那里的 org-create 路由也一并拒绝,而不是半通不通。
  cloud 控制面与任何装了企业包的部署不受影响。

  **迁移**:需要多组织能力的部署安装并声明 `@objectstack/organizations`(ADR-0081 D2)。仅靠 env
  声明一个墙、而没有实现它的运行时,不再被当作多组织部署对待。

  ## `@objectstack/verify`(minor,新增)

  `BootOptions.multiTenant` 增加 `'posture-only'` 取值:注册一个内置的 `org-scoping` 服务替身,
  让 `tenancy` 服务解析出真实、**非降级**的 `isolated` posture,从而打开受 posture 把守的路由 ——
  供那些「组织墙是**前置条件**而非被测对象」的 fixture 使用(#3624 的 `org-create-default-team`
  dogfood 就是为它而建:那条回归此前靠「boot 后翻 env、闸门 live 读」开路,本次收缩把这个绕法关死了)。

  ⛔ 它**不做任何租户隔离**:不 stamp `organization_id`,不 scope 任何查询 —— 它让部署的
  **posture** 为真,不是让**墙**为真。跨租户隔离的唯一诚实证明仍然是 `multiTenant: true` +
  真实的企业包,这也是那些 gate 在本仓继续 skip 而不是假装通过的原因。

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

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

- 7fb436c: Multi-organization operation is an ENTITLEMENT again: the `group` posture no
  longer activates without the enterprise runtime (ADR-0105 D12 correction).

  The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
  posture self-activating — it never probed for `@objectstack/organizations`. That
  turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
  D2), and made the weaker isolation the free one, which is not a boundary anyone
  would draw on purpose.

  The distinction that was missed: **open code is not free activation.** The wall's
  implementation has always lived in the open packages — that is equally true of
  `isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
  service the enterprise package registers. Cloud ADR-0016's 铁律
  (强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
  safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
  away.

  ## Changes

  - **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
    Without it the posture resolves to `single` and reports `degraded`.
  - **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
    instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
    both the enterprise package load AND the fail-fast, silently degrading to an
    unwalled deployment — the exact ADR-0049 class that guard exists to close. A
    `group` request without the runtime now refuses to boot unless
    `OS_ALLOW_DEGRADED_TENANCY=1`.
  - **New seam — the runtime declares what it entitles.** `org-scoping` may expose
    `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
    the open side honours it and fails closed on anything not listed. Whether
    `group` and `isolated` are one commercial tier or two is packaging policy, and
    packaging policy belongs to the commercial runtime rather than hard-coded in
    open core. Omitting the field entitles every walled posture, so existing
    runtimes are unaffected.
  - **`organization_id` stamping returns to the enterprise runtime.** The previous
    wave moved auto-stamping into the open engine; that removed the closed
    package's only load-bearing runtime duty, so a five-line forged `org-scoping`
    registration would have produced a fully working multi-org deployment. With
    stamping back where it was, a forged registration yields NULL-org rows the wall
    hides — a broken deployment, not an unlicensed working one.

    **Write-side VALIDATION stays open and is unchanged**, including the
    bulk-insert coverage: rejecting a forged `organization_id` is a security
    property, not a packaging one. Only filling an ABSENT value moved back.

  - Default-organization bootstrap returns to `single`-only; every walled posture
    keeps its existing owner (ADR-0081 D1).

  ## Note for operators

  `OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
  **refuses to boot** rather than running single-org. This only affects
  deployments that adopted `group` between the two waves.

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

- fec2f0e: feat(audit): sign-in and sign-out are recorded in `sys_audit_log`, with the actor and the tenant (#8144)

  `sys_audit_log.action` declares `login` and `logout`, the shipped `auth_events`
  list view filters on them, and two System Overview dashboard widgets chart them —
  but **nothing in the platform ever wrote either row**. The audit writers subscribe
  to the ObjectQL CRUD lifecycle, so `create`/`update`/`delete`/`restore` were the
  only actions that could ever materialize. On a fresh boot, signing in and then
  querying `GET /api/v1/data/sys_audit_log?$filter={"action":"login"}` returned
  **total 0**, and the `auth_events` view was empty by construction.

  The whole trace a sign-in left behind was one **unattributed** `update sys_user`
  row (`user_id` null) diffing `last_login_at` — a compliance ledger recording that
  somebody, unknown, had signed in.

  Both halves are fixed:

  - **`login` on every session creation.** The writer is wired to better-auth's
    `session.create` database hook rather than to the `/sign-in/email` endpoint, so
    it covers every way a session is minted — email sign-in, sign-up auto-sign-in,
    SSO, OAuth callback, magic link, email OTP, passkey. The row carries the actor
    (`user_id`), the tenant (`tenant_id` + the RLS `organization_id`), the session
    it is about, and the client fingerprint better-auth recorded (IP, user agent).
    An impersonation session keeps the subject on `user_id` and names the
    impersonating admin on `actor`, so it cannot be misread as a self-service login.
  - **`logout` on sign-out.** Scoped to `POST /sign-out` deliberately: a session row
    is also deleted by admin revokes, `/revoke-session`, bans, user erasure and
    better-auth's own collection of expired rows, and recording any of those as
    `logout` would name an action the user never took. Those revocations already
    carry their own cause on the ADR-0069 D4 session tombstone.
  - **The `last_login_at` write is now attributed.** It goes out through the
    platform's existing attribution channel (`ExecutionContext.attributedUserId`),
    so the row names the person who signed in. It is attribution only — the write
    still authorizes as the system, and nothing about who may touch `sys_user`
    changes. The row is kept rather than suppressed: a login from a new address is
    exactly what a compliance ledger is read for.

  The audit plugin now registers the `audit` service, the ledger's write ingress
  for events that are not CRUD. `@objectstack/plugin-auth` resolves it lazily and
  takes no dependency on the audit package — a deployment without the audit plugin
  installed writes no auth rows, exactly as before.

  No API, schema or enum changes: `login`/`logout` were already declared members of
  the `action` enum, and `sys_audit_log` remains `get`/`list`-only over HTTP.

- 7cf1531: fix(auth): an unrecognised membership policy is refused by both reconcilers, not auto-bound by one of them (#5205)

  **The sign-up path used to bind anyway.** `reconcileMembership` and
  `backfillMemberships` — both public exports of `@objectstack/plugin-auth` — read
  the same `policy` field and judged it with opposite predicates. Sign-up tested
  `policy === 'invite-only'`, so any _other_ value fell through to the `auto`
  branch and auto-bound the new user; the backfill tested `policy !== 'auto'` and
  refused. One input, two opposite postures, and the fail-open half was the one
  that runs per sign-up. A caller who wrote `'inviteOnly'` — or any host passing
  the policy from JavaScript, past the `MembershipPolicy` type — got auto-binding
  while believing they had switched it off, with nothing in the logs to say so.

  Both entry points now check `isMembershipPolicy()` before any policy semantics
  and refuse: nothing is bound, and the refusal names the offending value at
  `error` level (and on the returned result, so it survives a caller that passed
  no logger). This is the posture #5152 took one layer up at the settings
  boundary — an unrecognised value is rejected loudly, never coerced to `auto`.

  **Contract change — `ReconcileOutcome` gains `'invalid-policy'`, and
  `BackfillMembershipsResult.reason` gains the same member.** Both are exported
  types, so a consumer that switches exhaustively over them (a `never`-checked
  `default`, or a `Record< ReconcileOutcome, … >`) must handle the new member.
  The new verdict is deliberately _not_ a reuse of the existing `policy-skip` /
  `'policy'`: those mean "a valid policy said no", and reporting them for "this
  is not a policy" sends whoever is debugging a missing bind to inspect a
  deployment setting that is fine. `BackfillMembershipsResult` also gains an
  optional `error?: string`, and the `logger` shape on `ReconcileMembershipDeps`
  gains an optional `error?` method (it falls back to `warn`).

  **No behaviour change for the two real policies.** `auto` binds and
  `invite-only` skips exactly as before, on both paths — the framework's own
  callers resolve the policy through `AuthManager.getMembershipPolicy()`, whose
  return type is `MembershipPolicy`, so nothing on a supported path can reach the
  new branch. This closes the dormant divergence on the export surface.

- 586d6f7: feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

  **What a new user joins is now configurable at runtime.** ADR-0093's
  `membershipPolicy` decides whether a freshly created user is auto-bound to the
  deployment's default organization (`auto`) or gets membership only from an
  explicit act — creating a workspace, accepting an invitation, an admin adding
  them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
  **only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
  stack gets is injected by the CLI, which passes no such option and has no env
  fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
  otherwise. `invite-only` was, in practice, unreachable outside a custom host.

  It is now `auth.membership_policy` in the platform settings — a two-value select
  (`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
  pairs with: one says whether people may self-register, the other says what they
  join when they do. Set it in Setup → Authentication → Membership, or pin it
  per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
  restart** — the existing `settings.subscribe('auth', …)` re-application seam
  carries it, the same one the password-policy keys ride.

  **No behaviour changes unless you set it.** Only an _explicit_ value applies;
  the manifest's `auto` default is a UI default and never masks a deployment that
  configured the policy in code. A stack that sets nothing keeps today's
  auto-binding exactly.

  **Bug fix — the two membership paths read one source.** Sign-up (the reconciler
  in better-auth's `user.create.after`) read the AuthManager's live config, while
  the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
  **constructor options**. Wiring a setting to the first and not the second would
  have produced "sign-up honours the new policy, backfill still runs the old one"
  — and the backfill binds in **bulk**, so it is the more dangerous half. Both now
  resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
  backfill waits for the settings namespace to bind before its first pass (the two
  `kernel:ready` hooks fire in registration order, which was the wrong order).

  **An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
  a policy outside the declared option table (`invalid_option`, naming the allowed
  set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
  validation — is logged at `error` and **ignored**, leaving the deployment's
  current policy in force; it is never silently read as `auto`, because that would
  leave an operator believing a wall is up while every sign-up is auto-bound.

  New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
  plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.

- a0a206f: feat(plugin-auth): `POST /auth/change-email` works — better-auth's `user.changeEmail` is configured, with verification (#7735)

  `auth.changeEmail()` answered **400 `CHANGE_EMAIL_DISABLED`** on every
  deployment. better-auth ships the capability off and `plugin-auth` never
  configured it, so there was no product switch to flip — while
  `auth-route-ledger.ts` booked the route as a live SDK surface. The route table
  was right about the product and wrong about the runtime.

  `user.changeEmail.enabled` is now set, and the change is **confirmed by email**
  before it applies:

  1. `POST /api/v1/auth/change-email { newEmail }` mints a verification token and
     sends it to the **new** address, through the same
     `emailVerification.sendVerificationEmail` callback (and `auth.verify_email`
     template) that sign-up verification uses. Nothing is written yet — an
     unconfirmed request leaves the identity untouched.
  2. `GET /api/v1/auth/verify-email?token=…` applies it: the address changes,
     `email_verified` becomes true, and the session cookie is re-issued on the new
     identity.

  Two better-auth options are deliberately left at their defaults, because each is
  a policy in its own right: `updateEmailWithoutVerification` (would let a user
  whose current address is unverified swap emails with no confirmation at all) and
  `sendChangeEmailConfirmation` (better-auth's opt-in extra step asking the OLD
  address to approve first).

  **A deployment with no email transport** now answers 400 _"Verification email
  isn't enabled"_ instead of `CHANGE_EMAIL_DISABLED` — a fixable configuration
  statement rather than "the platform does not offer this". Wire an email service
  (`setEmailService`, or register the kernel `email` service) to enable the flow.

  **Self-service account deletion stays off, and now says so.**
  `POST /auth/delete-user` is published by better-auth's catch-all but
  `user.deleteUser` is deliberately not configured, so it answers 404 (as does its
  `GET /auth/delete-user/callback` half). Its route-ledger row is re-booked from
  `sdk` to the new `disabled` disposition carrying that reason, so the ledger no
  longer advertises a dead route. `client.auth.deleteUser()` is unchanged and
  still reaches the endpoint — it is refused there, as it was before this release.
  Self-service deletion in a B2B tenancy touches record ownership and tenant data,
  and needs a deliberate design; nothing about its behaviour changes here.

- 6df5135: feat(auth): change-email now notifies the PREVIOUS address — without gating on it (#8019)

  Self-service email change verified only the **new** address, so an attacker
  holding a live session (stolen cookie, unattended device, a session not yet
  revoked) could move the account identity end to end while the original owner's
  mailbox received **nothing** — and the account-recovery path moved with it.
  Password knowledge was never required, because the session already
  authenticated the request.

  `POST /change-email` now sends an `auth.email_change_notice` mail to the address
  the account is being moved away from, stating what was requested, the new
  address, and who to contact. The notice ships in all four supported locales
  (`en-US`, `zh-CN`, `ja-JP`, `es-ES`).

  **The change itself is unchanged.** It still completes on the new address's
  verification alone — no approval step, no second click, no new gate. That is
  enforced structurally rather than promised: the notice is sent from the
  after-hook, once better-auth has already produced its response, and every
  failure it can hit (no transport, unseeded template, dead mailbox) is swallowed.
  A notification that took the flow down with it would be the exact failure this
  change exists to avoid.

  better-auth's own `user.changeEmail.sendChangeEmailConfirmation` stays **off**.
  Measured against the installed 1.7.0-rc.2, that option is not a notifier: the
  endpoint returns immediately after invoking it and the new address is never
  mailed until the old one clicks, so enabling it would add the approval gate this
  change deliberately does not introduce.

  ⛔ The notice carries no undo/rollback link. Reverting a completed change is a
  separate flow and a separate decision.

- 313d7be: feat(auth): `onInvitationAccepted` host seam — better-auth's
  `afterAcceptInvitation` forwarded to the host (ADR-0105 D8 prerequisite)

  An invitation may carry placement intent (target business unit + positions,
  extension fields on `sys_invitation` per the ADR-0092 whitelist), but there
  was no server-side seam to apply it when the invitation is accepted —
  better-auth's org-plugin models don't fire core `databaseHooks` (framework
  #3541 D8 note).

  `AuthManagerConfig.onInvitationAccepted` mirrors `onOrganizationCreated`:
  invoked from `organizationHooks.afterAcceptInvitation` with the mapped ids
  (`invitationId`, `organizationId`, `userId`, `memberId`, `role`, `email`)
  plus the RAW `invitation` / `member` rows so a host reads its own extension
  columns without a second query. Failure-isolated — acceptance never rolls
  back on a side-effect miss; hosts needing effectively-atomic placement
  should make the callback idempotent and reconcile on retry.

- 61dc08e: feat(plugin-auth): break-glass — a ban may never leave the environment with zero administrators (#5892)

  `sys_user.banned = true` is where every deprovision lands: better-auth's admin
  plugin writes it, and `@better-auth/scim` maps a SCIM `active: false` onto that
  same admin ban. Nothing checked what the write left behind — so **banning the
  last administrator was allowed, reported success, and locked the organization
  out of its own environment permanently.** SCIM makes that a realistic accident
  rather than a hypothetical one: the write is driven by an external system, so
  nobody reads the payload before it commits, and one mis-scoped IdP group is
  enough.

  **New guard (`last-admin-ban-guard.ts`, cloud ADR-0024 D5.2).** A `beforeUpdate`
  hook on `sys_user` refuses any write that turns `banned` on when it would leave
  the environment with **no unbanned administrator**. It sits on the write, not on
  an endpoint, so it holds for the admin ban endpoint, the SCIM adapter write, an
  import, a script, and anything added later — by-id **and** predicate/`multi`
  writes alike.

  Who counts as an administrator is exactly what the rest of the platform already
  counts: a platform admin (an unscoped, in-window `admin_full_access` grant —
  the same evidence `resolveAuthzContext` derives `platform_admin` from) or an
  organization `owner`/`admin` membership. `delegated_admin` does not count
  (ADR-0105 D8: it can reach an endpoint, it carries no authority), an expired
  grant does not count, and the non-loginable `usr_system` account does not count.

  Three consequences worth knowing before you upgrade:

  - The refusal is a **403** carrying `PERMISSION_DENIED` and a message that names
    the user, the invariant, and the fix (grant someone else `admin_full_access`
    or an owner/admin membership first — and if an IdP drove the ban, the SCIM
    deprovision is too broad). On the auth pipeline it now surfaces as a proper
    `APIError` instead of an opaque 500.
  - It **fails closed**: if the administrator population cannot be read, or is too
    large to enumerate, the ban is refused rather than guessed at. The failure
    mode being prevented is a permanent lockout.
  - Writes that do not turn `banned` on — unbans, profile edits, re-banning an
    already-banned admin — are untouched, and so is banning anyone who is not an
    administrator.

  The other half of the same invariant (`enforced` SSO must never disable the last
  local admin's **password** — the escape hatch for an IdP outage) was already
  implemented and is now pinned by tests rather than reimplemented:
  `emailAndPassword.enabled` stays `true` under enforced SSO while sign-up is
  forced off, and the last local `credential` account still cannot be banned,
  removed or deleted.

- 8dcf607: feat(plugin-auth): break-glass — the last administrator cannot be DELETED either (#5941)

  #5892 closed the _ban_ half of ADR-0024 D5.2's break-glass invariant. The
  **delete** half was still open, and it was reachable end to end: in an enforced
  SSO environment the last administrator is typically IdP-managed and holds no
  local password, so when the IdP drops them from the admin group the resulting
  SCIM `DELETE /Users/{id}` (or `/admin/remove-user`, or `/delete-user`) removed
  the row and **left the environment with nobody able to administer it** — quite
  possibly with a password-holding non-admin still able to sign in and change
  nothing. There is no recovery path from inside the product once that happens.

  The pre-existing HTTP guard on those three endpoints did not cover it: it
  protects the last holder of a local `credential` account, so it skips the
  credential-less (IdP-managed) target entirely. It is unchanged and keeps
  enforcing its own invariant.

  **What changed.** The guard module now enforces one invariant on _both_ writes
  that can take the last administrator away, off one administrator enumeration:

  | write                       | hook                     |
  | :-------------------------- | :----------------------- |
  | `sys_user.banned = true`    | `beforeUpdate` (#5892)   |
  | deleting the `sys_user` row | `beforeDelete` (**new**) |

  The delete half is the ban half's twin in every property that matters: it sits
  on the **write**, so it holds for the SCIM adapter delete, better-auth's admin
  remove-user, an import and a script alike; it covers by-id **and**
  predicate/`multi` deletes (including the unpredicated `multi` that would empty
  the table); it applies to **every** context, `isSystem` included, because the
  deprovision path that actually locks organizations out is the system one; and it
  **fails closed** — an administrator population that cannot be read, or is too
  large to enumerate, refuses the delete rather than guessing.

  The refusal is a **403** carrying `PERMISSION_DENIED` and names the operation
  the caller actually attempted ("Refusing to delete 'usr\_…'"), the invariant
  (ADR-0024 D5.2), and the fix — grant someone else `admin_full_access` or an
  owner/admin membership first, and if an IdP drove it, the SCIM deprovision is
  too broad. On the auth pipeline it surfaces as an `APIError`, not an opaque 500.

  Untouched: deleting anyone who is not an administrator, deleting an
  administrator while another unbanned one remains, and deleting an administrator
  who is already banned (that account could not sign in either way).

  **Rename.** The module is now `last-admin-guard.ts` and the exported registration
  function is `registerLastAdminGuard` (was `last-admin-ban-guard.ts` /
  `registerLastAdminBanGuard`, added in the same unreleased cycle) — it registers
  both hooks, so the old name would have understated what it installs. Hosts that
  wire the guard onto their own ObjectQL engine rename the import; there is no
  other change to its signature or behaviour.

  Not covered, tracked separately (#5978): revoking the _standing_ that makes
  someone an administrator — deleting or downgrading their `sys_member` row,
  removing the `admin_full_access` grant — leaves the user row in place and writes
  a different table, so neither hook sees it.

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

- 1fa224a: feat(plugin-auth): the fixed-window counter gets its own `./rate-limit-storage` entry (#6040)

  `rate-limit-storage.ts` is the repo's ONE fixed-window counter —
  `incrementFixedWindow` / `createLazyCounterStore` / `InProcessCounterStore`,
  ADR-0069 D2 — and #4790's cross-reference asks later arrivals to reuse it
  rather than write a third copy. They did, and from outside auth:
  `@objectstack/runtime` counts inbound requests and endpoint policy through it,
  and `@objectstack/service-sms` counts its daily SMS budget through it (#2814).

  `@objectstack/plugin-auth` published exactly one entry, `"."`, whose `export *`
  chain takes **value** imports on `better-auth/adapters`
  (`objectql-adapter.ts`) and `@better-auth/core/db` (`backfill-account-issuer.ts`).
  Value imports are evaluated eagerly, so reaching those ~90 lines of counting
  loaded `better-auth` + `@better-auth/{core,oauth-provider,scim,sso}` + `jose` +
  `@noble/hashes` + `@objectstack/rest` + `@objectstack/platform-objects` first.
  Measured against the built package: `require('@objectstack/plugin-auth')` puts
  109 modules in `require.cache`; the counter needs one.

  So the counter is now published on its own:

  ```ts
  // before — 109 modules, the whole better-auth family
  import { incrementFixedWindow } from "@objectstack/plugin-auth";
  // after — 1 module, 3.7 KB
  import { incrementFixedWindow } from "@objectstack/plugin-auth/rate-limit-storage";
  ```

  `tsup` emits the second entry with `splitting: false`, so it is a self-contained
  bundle rather than a nominal split: `dist/rate-limit-storage.mjs` is 3.71 KB
  against `dist/index.mjs`'s 330.28 KB, contains zero top-level imports and zero
  occurrences of the string `better-auth`. The one better-auth reference that
  survives is `import type { BetterAuthRateLimitStorage }`, which is erased at
  build and costs a consumer nothing at runtime.

  **Nothing is removed.** The root still re-exports every one of these symbols, so
  existing `@objectstack/plugin-auth` imports keep working unchanged — this is a
  new entry point, which is why it is `minor` rather than breaking. The `patch` on
  `runtime` and `service-sms` is the import-specifier switch in those packages;
  their behaviour is identical.

  `src/rate-limit-storage-isolation.test.ts` pins the invariant from both sides,
  in the shape `packages/types/src/node-isolation.test.ts` (#4700) established for
  the `./node` split: it walks the real import graph from the subpath entry and
  fails on any better-auth **value** import or any undeclared external package,
  it fails if a consumer reaches the counter through the package root again, and
  it fails if the root ever _stops_ pulling better-auth eagerly — because at that
  point the split stopped buying anything and deserves re-measuring rather than a
  suite that passes for the wrong reason.

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

- b41f51a: security: encrypt the OIDC SSO `clientSecret` at rest

  `sys_sso_provider.oidc_config` stored the OIDC `clientSecret` in cleartext inside
  its JSON blob — measured on a real registration, byte for byte. That secret
  authenticates the platform itself to the identity provider, and the object is
  readable through the generic data API (`apiMethods: ['get','list']`), so anyone
  who could read the row could impersonate the platform's OIDC client.

  The secret now lives in `sys_sso_provider.oidc_client_secret`, a `Field.secret()`
  column on the engine's encrypted credential channel: the engine wraps it with the
  registered `ICryptoProvider`, stores the ciphertext as a `sys_secret` row, keeps
  only an opaque ref on the provider row, and returns a mask on every generic read.
  `oidc_config` keeps the rest of the config in cleartext on purpose, so the admin
  UI can still render endpoints, scopes and mapping.

  Both better-auth write doors are covered (`/sso/register` and
  `/sso/update-provider`), and the adapter recovers the plaintext server-side for
  `/sso/callback`, so federated login is unchanged.

  Existing provider rows are migrated forward automatically at start. A row that
  cannot be migrated — no `ICryptoProvider` wired — keeps working and is reported
  with a warning rather than silently left looking protected.

  ⚠️ Registering or updating an SSO provider now REFUSES rather than storing
  cleartext when no `ICryptoProvider` is registered. Self-hosted deployments get
  `LocalCryptoProvider` automatically from `serve`; set `OS_SECRET_KEY` (or swap in
  a KMS/Vault provider) so secrets survive a restart.

### Patch Changes

- c9c2d92: fix(plugin-auth): invitations can be accepted again — adopt the existing membership instead of colliding on the unique index (#7725)

  `POST /api/v1/auth/organization/accept-invitation` returned **HTTP 500 with an
  empty body** and left the `sys_invitation` row `pending` **forever**. It was not
  intermittent: on a single-organization deployment the flow in the docs — invite a
  fresh email, invitee signs up through the link, invitee accepts — could never
  complete at all, and the invitation was unrecoverable through the UI because
  re-inviting an address that is already a member is refused too.

  Two correct platform decisions collided:

  - every user is auto-bound to the deployment's default organization at sign-up,
    by the membership reconciler (ADR-0093 D1/D2), and
  - `sys_member` declares `{ organization_id, user_id }` unique.

  better-auth's built-in accept-invitation route assumes an invitee is never
  already a member: after flipping the invitation to `accepted` it inserts a
  membership unconditionally, inside a transaction whose failure handler rolls the
  invitation **back to `pending`** and rethrows. So the invitee's auto-bound row
  made the insert fail, and the rollback erased the only evidence that acceptance
  had been attempted.

  Acceptance now **adopts** that row rather than minting a second one. The declared
  unique pair is the identity of a membership, so a create naming a pair that
  already exists is that membership. The invitation ends `accepted`, and the
  invitee holds exactly one membership in the target organization.

  **What adoption does to the role.** The invitation's role is written onto the
  adopted row, so an invitation's intent is not silently replaced by the
  reconciler's default `member` — accepting an `admin` invitation makes you an
  admin even if you signed up first. One deliberate exception: **adoption never
  lowers a grade.** If the existing membership already outranks the invitation's
  role, the existing role is kept. Acceptance admits a person; demotion belongs to
  `POST /organization/update-member-role`, which is the route the last-admin guard
  stands on — without this exception, an organization's sole owner accepting a
  `member` invitation would have been demoted past that guard, taking the
  organization's last owner with it.

  The membership's `created_at` is not rewritten (the membership really did begin
  at sign-up), and the adoption is recorded in `sys_member` history attributed to
  the person who accepted.

  Unaffected: an invitee who is not yet a member of the target organization still
  gets a membership created exactly as before, and the delegated-admin issuance
  scope (ADR-0090 D12 / ADR-0105 D8) is untouched.

- 690ccf2: fix(objectql): a by-id `update()`/`delete()` against a nonexistent record answers 404 `RECORD_NOT_FOUND` instead of a 400 from further down the pipeline (#7867)

  Nothing on the action-body write path ever asked whether the target row existed.
  `ctx.api.object(name).update({ id, … })` reached `ObjectQL.update()`'s by-id
  branch through `buildSandboxApi` → `ObjectRepository`, and that branch had **no
  existence gate at all**: `engine.update()` on a ghost id was a silent no-op that
  resolved `null`, so the write ran on into validation, the driver and the hook
  chain and died on whichever complained first.

  **Which one it died on varied with the object's declarations**, which is why the
  defect read as several unrelated bugs:

  - a **hooked** object → `400` `HookConditionError`, from an `afterUpdate`
    condition reading `previous` on a row nobody read;
  - an **unhooked** object → `400` `VALIDATION_FAILED` "X is required", because
    with no prior row a PATCH is validated as if it were a whole record.

  The 400 class varied; the missing 404 was the constant. Measured on one showcase
  stack, same id, same object, same second: `POST /actions/showcase_task/
showcase_mark_done/<ghost>` answered 400 while `PATCH /data/showcase_task/
<ghost>` answered 404. Both answer **404 `RECORD_NOT_FOUND`** now.

  `delete()` had the same shape and was the worse of the two: with no gate it
  reported success for a row that was never there, so a typo'd id, an
  already-deleted row and a real deletion were indistinguishable.

  **This is not a `previous`-binding bug.** `if (priorRecord) hookContext.previous
= …` is correct and is untouched — ADR-0058 Addendum II / #4649 require that an
  absent row leave `previous` UNBOUND rather than fabricated. It was behaving
  correctly on a path that should never have been entered, so the fix removes the
  producer rather than specializing what it produced.

  **Where the gate went, and why there.** At the engine, in the by-id branches of
  `update()` and `delete()` — the one point all three action-body write faces
  funnel through (`ctx.api.object()`, its context-less repo-facade fallback, and
  `ctx.engine.update()`). A repository-level gate would have closed one of the
  three and made `ql.update(o, { id })` and `ctx.api.object(o).update({ id })`
  answer one ghost id two different ways. Two sibling paths already gated
  correctly — `protocol.updateData`/`deleteData` (#4435) and `callData`'s ObjectQL
  fallback (#5138) — and all three now throw the **same** `recordNotFoundError`,
  which moved to `@objectstack/core` so the engine can reach it without importing
  `@objectstack/metadata-protocol` (forbidden in the `/core` closure by ADR-0076
  D2's boundary ratchet). `@objectstack/metadata-protocol` re-exports it unchanged.

  Existence is asked with a pre-write read, never off the write's own result:
  `IDataDriver.update` declares no not-found signal, and the engine's post-write
  readback is `null` for a second reason (a write that moves the row out of the
  caller's row scope), so reading either would answer 404 to a write that landed.

  **Behaviour change worth knowing about — the by-id prior-row read is now
  unconditional.** #5284 (update) and #5929 (delete) had narrowed it to "does
  anything CONSUME the prior row?", skipping the read for objects with no hook, no
  prior-reading validation rule and no roll-up. Existence is a consumer that
  demand list never enumerated and the one consumer every by-id write has, and no
  cheaper question answers it — so the skip and the gate are mutually exclusive.
  The measured cost is small: #5929's own record enumerates the global hook
  registrants (plugin-sharing, service-storage, plugin-auth, plugin-audit), so on
  any kernel that loads them the demand was already true for every object and the
  narrowing skipped nothing. The read is genuinely new only for a bare
  `@objectstack/objectql/core` embedder — which is buying a 404 it did not have.

  Three read-count pins measured the old skip and now measure the read, each
  recording what changed and why at its own site: #5284's and #5929's in
  `packages/objectql`, and #5860's `sys_job_queue` case in `@objectstack/plugin-audit`.
  The DISPATCH half all three are actually about — the per-object `hasHooksFor`
  question, the `excludeObjects` subtraction, and the retired
  `sys_fetch_previous_*` builtins — is untouched and still pinned.

  One further case encoded the old silent no-op as correct: `@objectstack/plugin-auth`'s
  #5941 last-admin-guard test deleted a `sys_account` id that was never seeded and
  asserted it RESOLVED, to show the guard does not write-guard that object. It now
  deletes a REAL row — which states the same thing more strongly — and separately
  pins that a ghost id there is refused by the ENGINE rather than by the guard.

  **Scope.** By-id only. A `multi: true` predicate write matching zero rows still
  resolves "0 rows affected" — the same line both sibling paths draw.

  `@objectstack/runtime`: the sandbox error passthrough now also carries `status`
  alongside `code` and `fields`, so an error that names its own HTTP status keeps
  it across the QuickJS boundary. Without it the action surface answered the right
  diagnosis at the wrong status (`{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`);
  `domains/actions.ts` already honoured `.status` first — the number simply never
  arrived. A permission refusal thrown inside a body likewise keeps its 403 now
  instead of flattening to 400.

- 735f850: fix(security): resolve the ISSUER's real grants when authorizing invitation
  placement (ADR-0105 D8)

  Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
  `sys_user_position` rows the acceptance would write. The gate reads authority
  off `context.positions` / `context.permissions` — but the invitation hook
  handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
  delegated administrator therefore resolved to the additive baseline alone and
  was refused:

  > requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

  Fail-closed, but dead: only a tenant admin could ever issue a placement, which
  is the one case the feature was not for. Caught by cloud's group-posture
  dogfood, which exercises the real HTTP path with a real delegate.

  `assertIssuable` now takes `actorUserId` instead of a caller-built
  `actorContext` and resolves that user's grants itself through the single authz
  resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
  transport would have carried, from the same reads. There is no request to
  resolve a context from inside a better-auth hook, so the id is what the caller
  can honestly supply and the resolution belongs behind the boundary.

  A principal-less call still reaches the gate with an empty context on purpose:
  the gate owns that refusal too, so the security boundary keeps exactly one
  place an issuance can be denied.

- bb1ce2e: fix(plugin-auth,plugin-webhooks): retire a dead degrade branch and an implicit transitive dependency (ADR-0116 follow-ups, #4187)

  Two concrete findings from the ADR-0116 consumer-side audit, plus the
  authoring rule that would have prevented both.

  **`plugin-auth` claimed a fallback it did not have.** `init()` ran
  `const dataEngine = ctx.getService('data'); if (!dataEngine) { warn('No data
engine service found - auth will use in-memory storage') }`. That branch could
  never execute: `getService` **throws** for an unregistered service rather than
  returning `undefined`, and this plugin declares a hard dependency on ObjectQL
  (which registers `data` unconditionally), so a kernel without the engine fails
  even earlier with `Dependency … not found`. The branch is removed and the real
  contract is declared — `requiresServices: ['data', 'manifest']` — which also
  replaces a trailing `// manifest service required` comment with the
  machine-checked form of the same claim. `AuthManager` keeps its own optional
  `dataEngine` guards: it is usable outside the plugin.

  **`plugin-webhook-outbox` was protected only transitively.** It resolves
  `manifest` in `init()` with no fallback while depending on
  `com.objectstack.service.messaging`, which in turn depends on ObjectQL, the
  actual provider. That works today and would have broken silently the day
  messaging stopped depending on the engine — surfacing as a crash inside an
  unrelated plugin's init. It now declares `requiresServices: ['manifest']`
  directly.

  Neither change alters ordering or boot outcomes on any current composition:
  both plugins were already ordered correctly. What changes is what a broken
  composition _says_, and that the guarantees are now checked rather than
  inherited.

  Docs: `content/docs/plugins/anatomy.mdx` gains the three ADR-0116 fields and
  the decision rule for resolving a service inside `init()` (hard dependency vs
  `optionalDependencies` + `requiresServices`), including the two traps behind
  these fixes — don't rely on a transitive provider, and don't write an
  `if (!svc)` fallback after a bare `getService`. The api-registry example
  declares the contract on all seven of its plugins instead of relying on
  `kernel.use()` order.

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

- ea24593: fix(plugin-auth): the auth catch-all yields paths better-auth does not own (#4088)

  `registerAuthRoutes` mounts `rawApp.all('${basePath}/*')` over the whole auth
  namespace (`/api/v1/auth` by default), and that handler was **terminal**: it
  returned better-auth's response unconditionally, including the 404 better-auth
  produces for a path it does not implement. Any other plugin's route under that
  prefix was therefore reachable only if it happened to register **first** — Hono
  runs handlers matching a path in registration order and the first to return a
  Response wins.

  That put a load-bearing surface at the mercy of `kernel.use()` order.
  `@objectstack/plugin-hono-server` mounts `/auth/me/permissions` and
  `/auth/me/localization` from its own `kernel:ready` hook; objectui's entire
  permission layer reads the former and `core`'s auth gate allow-lists the latter
  as an endpoint a gated user must still reach. Register `AuthPlugin` before
  `HonoServerPlugin` and all of it silently 404s.

  A 404 from better-auth now means "this path is not mine" and the catch-all yields
  to whatever else matched, in either registration order. Deliberately narrow:

  - **Only 404 falls through.** 401/403 are real better-auth answers, not
    disclaimers of ownership.
  - **Precedence still favours the namespace owner.** better-auth wins every path
    it implements; only its leftovers are up for grabs.
  - **The unclaimed-path wire shape is unchanged.** When nothing downstream
    answers, better-auth's own 404 is returned verbatim rather than Hono's
    `404 Not Found`.

  No configuration changes and no new routes. The only behavioural difference for
  an existing deployment is that a route another plugin mounts under
  `/api/v1/auth/*` now answers regardless of plugin order — previously it answered
  only in the lucky order.

- 86f7a20: refactor(auth)!: stop advertising `passkeys` / `magicLink` on `/api/v1/auth/config` — two flags nothing consumed (#7481, ADR-0049)

  <!-- adr-0087: registered auth-config-unadvertised-reserved-features -->

  **FROM → TO:** reading `config.features.passkeys` or `config.features.magicLink` off
  `GET /api/v1/auth/config` → delete the read; both keys are gone from the payload and there
  is no replacement flag. Neither capability was reachable by a user, so nothing a client
  gated on them was ever offered. `AuthPluginConfig.plugins.passkeys` / `plugins.magicLink`
  are **unchanged** — this narrows the served payload, not the server configuration.

  Both flags were served from introduction and read by no client: no login UI anywhere
  renders a passkey or magic-link affordance off them. So the payload advertised two sign-in
  methods a user could never reach, and a deployer who set either plugin flag flipped a
  switch with no observable effect — ADR-0049's enforce-or-remove, on a deployment-facing
  contract. The maintainer ruled remove over keep-as-reserved on 2026-08-11: declared =
  enforced, and a deployer must not be able to flip a flag that does nothing anywhere.

  The two are not equally empty, and the prescriptions say so separately rather than sharing
  one string:

  - **`passkeys`** has nothing behind it at all — no better-auth passkey plugin is wired, so
    `/passkey/*` does not answer. There is no capability to detect.
  - **`magicLink`** loses only its **advertisement**. `plugins.magicLink` still wires
    better-auth's magic-link plugin, and `/api/v1/auth/magic-link/send` + `/magic-link/verify`
    answer exactly as before — drive them from your own UI.

  Both return to the payload in the change that ships the login UI (objectui#4179); until
  then the standing record is `PUBLIC_AUTH_FEATURES_NOT_ADVERTISED` in
  `kernel/public-auth-features.ts`, and their `PUBLIC_AUTH_FEATURES` entries — which pointed
  at the now-closed objectui#2514 — are gone with them.

  The retirement kit:

  - **Tombstone, not deletion** (`retiredKey()`): `AuthFeaturesConfigSchema` is not
    `.strict()`, so a plain delete would let a payload carrying either key parse clean and
    lose it in silence (the ADR-0104 shape). Each key carries its own prescription.
  - **ADR-0087 D3 `SemanticMigration`** (`auth-config-unadvertised-reserved-features`) plus
    the two exact `RETIRED_KEYS_BY_MAJOR` entries. No D2 conversion, deliberately: this is a
    response surface the server mints per request — nobody authors or persists an
    `AuthFeaturesConfig` — so there is no source for `os migrate meta` to rewrite. The
    `EnhancedApiError.fieldErrors` disposition.
  - `requiresFeature` narrows with the registry: neither name is a gateable flag any more,
    which is what stops a spec input from being written against a capability that is not
    served.
  - Generated baselines (`authorable-surface/api.json` gains two `[RETIRED]` lines,
    `authorable-defaults/api.json` loses two default lines), `spec-changes.json`, the upgrade
    guide, `export-origins/` and the reference docs regenerated.

- 7a40b7a: fix(plugin-auth): better-auth 的 `contains` 下译为 `$contains`,比较值不再当正则求值 (#5710)

  `convertWhere()` 把 better-auth 的 `contains` 译成 `{ field: { $regex: value } }`,
  于是一个**未转义、来自调用方**的比较值(`/admin/list-users` 的 `searchValue`、
  SCIM 过滤值)坐进了正则的**模式位**。它的含义随后端分叉:

  - `driver-memory` 用 `new RegExp(value)` 求值 —— `contains('a.b')` 命中 `axb`,
    `^x` 变成锚定,而值里一个不配对的 `(` 让模式非法(mingo 查询路径直接抛
    `SyntaxError`,参考匹配器则吞成静默零命中);
  - `driver-sql` / `driver-sqlite-wasm` / `driver-turso` 编成子串
    `LIKE '%value%'`(`%`/`_`/`\` 有转义、带显式 `ESCAPE`),元字符是字面量。

  同一个认证查询,在应用测试常用的内存替身上和生产的 SQL 后端上给出**不同答案**,
  且分叉发生在认证路径上。

  现在这一支发出 `$contains` —— 协议 `FILTER_OPERATORS` 里的算子,五后端都必须按
  **字面子串**求值,正是 better-auth `contains` 的本意(其 `Where.mode` 默认
  `"sensitive"`,与 #5701 Q2=A 裁定的 `$contains` 大小写敏感契约同向)。

  **对使用方的影响**:凭 `/admin/list-users?searchValue=…` 之类接口依赖「元字符按正则
  生效」的调用会改变结果 —— 那是本次修复的缺陷本身,不是可依赖的行为。搜索
  `a.b` 从此只命中含字面 `a.b` 的行,不再命中 `axb`;含非法正则字符的搜索值不再
  报错或静默返回空,而是按字面子串匹配。

- f2eb850: fix(plugin-auth): 限流计数器改为惰性解析 kernel cache —— 修掉误报的告警，也修掉「共享限流从未生效」的功能洞 (#4772)

  `pnpm dev`（showcase）每次冷启都会打一条：

  ```
  WARN [auth] no cache service registered — rate-limit counters use a per-process in-memory
       store; a multi-node deployment needs a shared cache (Redis) to enforce limits globally
  ```

  而 `CacheServicePlugin` 就在 **21ms 后**注册好了，它本来就在已加载插件列表里。这条告警把运维引向「你需要 Redis」，接完 Redis 还是同一条告警 —— 因为缺的不是 Redis。

  **这不只是日志误报。** `AuthPlugin.init()` 里那次 `getServiceAsync('cache')`
  探测的结论会被**冻结整个进程生命周期**：better-auth 实例是懒创建的，但它读的是 init
  时定下的 config。所以标准组合下 auth 这一侧永远拿着「没有 cache」这个结论，限流计数器
  **从未**用上共享存储 —— 多节点部署的限额从来没有被全局强制过，每个节点各算各的，轮换
  节点即可绕过。ADR-0069 D2 声明的能力与运行时不一致。

  **修法：把「取 cache 服务」放回真正用到它的那一刻。** 新增
  `createLazyCacheRateLimitStorage()`，实现 better-auth 的 `rateLimit.customStorage`：
  计数器被消费时才解析 `cache` 服务（这一刻必然在 `kernel:ready` 之后，因此与插件启动
  顺序无关），解析到就一直用它。告警保留，但只在**计数器真的要用共享存储、而此刻确实
  一个 cache 服务都没有**时才打一次 —— 那时它才是真信号，「加一个共享缓存」也才是对的
  建议。真没有 cache 的部署仍然限流，只是退化成进程内计数（降级，不是关闭）。

  **刻意走 `rateLimit.customStorage` 而不是 `secondaryStorage`。** 后者会连带把**会话
  的记录之处**搬进缓存：better-auth 的 `createSession` 不再写 `sys_session` 行，
  `findSession` 直接从缓存快照作答、根本不查库；而 ADR-0069 D4 的空闲超时 / 绝对时长
  上限 / 并发上限**全部靠写那一行来撤销会话**。所以自动把 cache 绑成 `secondaryStorage`
  会静默废掉 D4 的三个管控。本次因此不再从 cache 服务自动派生 `secondaryStorage`：
  它回归「宿主显式提供才生效」，`cacheSecondaryStorage()` 改为从包根导出，供知情的宿主
  自行选用。会话到底该存哪，是一个需要维护者裁定的架构问题，记录在 #4785。

  对使用者的影响：

  - 配了 cache 插件的部署不再出现那条 warn，改为一条 info（计数器已绑定到 cache 服务）；
  - 多节点 + Redis cache 的部署，限流计数**现在真的**是全局的；
  - 新增 `AuthManagerOptions.rateLimitStorage`（counters-only，不迁移会话）；宿主自己
    提供的 `secondaryStorage` 行为不变，仍然优先并继续走
    `rateLimit.storage: 'secondary-storage'`。

- 8bd437f: fix(plugin-auth): 每号码 OTP 发送预算改用惰性解析的共享计数存储 —— 多节点下不再按节点数倍增 (#4790)

  #2780 的「每号码 OTP 发送预算」（60s 冷却 + 每小时 5 条）此前**只有宿主显式提供
  better-auth `secondaryStorage` 时才跨节点共享**：`AuthManager.getOtpSendGuard()` 唯一的
  存储来源就是 `AuthManagerOptions.secondaryStorage`，而标准 `serve` 组合里没有任何一处
  提供它（#4788 之后 `AuthPlugin` 也明确不再从 cache 服务派生它）。于是预算落在**每个进程
  一份**：N 个节点的部署，一个号码实际能收到的是声明值的 N 倍，而且**没有任何信号**告诉你
  它没兑现（ADR-0049 声明 ≠ 强制）。这里的计价单位是**真金白银的短信**。

  这是 #4772 那条限流洞的同类，但是独立的一处：#4788 修的是 better-auth 自己的 `rateLimit`
  计数器（走 `rateLimit.customStorage`），OTP 预算是 ObjectStack 在 `AuthManager` 里自己实现
  的另一套计数，行为未被 #4788 改变。

  **修法：复用 #4788 建好的那条路径，而不是再写一份。** `rate-limit-storage.ts` 中把「惰性
  解析 → 绑定即宣告 → 解析不到就降级到有界的进程内存储并响亮告警」抽成
  `createLazyCounterStore()`（`createLazyCacheRateLimitStorage()` 现在就是它的一层薄封装），
  OTP 预算经由新的 `AuthManagerOptions.sharedCounterStore` 接同一条路径：

  - **存储在每次发送校验时才解析**，因此 `CacheServicePlugin` 晚于 `AuthPlugin` 注册也照样
    绑定得上（插件启动顺序不再决定任何事）—— 这正是 #4772 冻结结论造成的那个洞；
  - 配了 cache 的多节点部署，每号码预算**现在真的是一份**，换节点不会重新获得冷却额度；
  - 没有 cache 服务的部署**仍然限额**，只是降级为进程内计数，并在第一次真正计数时打一条
    点名代价的 warn（「an N-node deployment can send up to N× the configured number of PAID
    SMS to one number」）—— 降级不是关闭，两种情况在日志里可区分（绑定打 info，降级打 warn）。

  **刻意不引入 `secondaryStorage` 来修它**（#4785）：那会把会话的记录之处搬进缓存，静默废掉
  ADR-0069 D4 的三个会话管控。宿主自己提供的 `secondaryStorage` 对这个预算仍然优先且行为不变。

  冷却与滚动小时窗的语义**未做任何改动**：计数依旧是按号码的时间戳滚动窗口，只是换了它所在的
  存储。（固定窗口计数器无法表达「距上一次发送满 N 秒」，把它改成定窗会在窗口边界放行两倍突发
  ——用一种倍增换另一种倍增。）

  对使用者的影响：

  - 新增 `AuthManagerOptions.sharedCounterStore`，`AuthPlugin` 自动填充，一般宿主无需感知；
  - 新增导出 `createLazyCounterStore()` 与 `counterStoreFromKv()`；
  - `OtpSendGuard` 新增 `resolveStore` 选项，原有的 `storage`（字符串 KV）选项保持可用。

- 5046afe: fix(plugin-auth): OTP 冷却按声明值真正生效 —— 发送历史的保留时长不再被硬编码的 1 小时截断 (#4808)

  `OtpSendGuard` 有**两个**维度:每号码「距上次发送至少 N 秒」的冷却(`cooldownSeconds`),
  和每号码「滚动一小时内至多 M 条」的上限(`maxPerHour`)。它们需要**不同**的时间窗,而此前
  两者共用了同一个硬编码的一小时:发送历史按 1 小时剪枝、也按 1 小时写 TTL。

  于是把 `phoneOtp.cooldownSeconds` 配成**大于 3600** 时:配置被接受,没有校验错误,没有 warn,
  但冷却所依据的那条历史记录在 1 小时处就被丢掉了 —— 声明「两次发送间隔 2 小时」,实际最多
  只有 1 小时,**反滥用强度是声明值的一半,而且没有任何信号**(ADR-0049 声明 ≠ 强制)。
  计价单位仍然是真金白银的短信。这与 #4790 是同一个 guard 上的**不同**缺陷,且改动前后行为
  一致 —— 不是 #4806 引入的。

  **修法(issue 的方向 1):保留时长跟随配置。** 历史保留 `max(1 小时, cooldownSeconds)`,
  即「两个维度里还用得着它的那个更长的窗」;TTL 同步跟随,记录因此活得比它所度量的冷却更久。
  每小时上限仍在**它自己的滚动一小时**内计数,所以超长冷却不会反过来把 `maxPerHour` 收得比
  声明的更严。

  **上限是拒绝,不是又一次截断。** `cooldownSeconds` 超过 `MAX_COOLDOWN_SECONDS`(86400,
  即 24 小时)会在**启动时**抛错(`AuthPlugin.init()` 构造 `AuthManager` 处),错误信息给出
  值、上限和改法。把截断点挪到更高的数字只是把同一个缺陷往外推一个量级;设上限的理由是:
  一条号码的历史会在共享缓存里驻留整个冷却期,而超过一天的封锁已经不是发送节流而是账号锁定
  (另一套机制、另一套管控)。这条边界同时把「`cooldownSeconds` 误填成毫秒」这类笔误变成
  一次响亮的拒绝(5 分钟以上的意图都会被挡下)。校验放在**配置处**而不是首次发送处:guard
  是惰性构造的,只在那里校验的话,一个配置错误会表现为 `/phone-number/send-otp` 的 500。

  **默认配置行为完全未变**,并有测试锁定:未配置 `phoneOtp` 时仍是 60 秒冷却 + 每小时 5 条,
  历史保留与 TTL 仍是 3600 秒。

  对使用者的影响:

  - `phoneOtp.cooldownSeconds` 现在在 1 小时以上也真正生效(上限 24 小时);
  - 超过 24 小时、负数或非有限值的配置**开始被拒绝**——这些值此前从未按声明工作过(要么被
    静默截断到 1 小时,要么被静默钳成 0 即关闭冷却),因此不存在依赖其旧行为的部署;
  - 新增导出:常量 `MAX_COOLDOWN_SECONDS` 与校验函数 `assertOtpCooldownSeconds()`。

- 984396b: test(plugin-auth): enumerate better-auth's route table — the `/auth/**` wildcard becomes 55 exact rows (#3656)

  The widest hole the #3642 capstone measured. That guard reports how many SDK
  calls match only a `**` prefix family rather than a resolvable route, and the
  answer was 60 of ~196 — with 54 on `* /auth/**`, the largest and most
  security-relevant namespace in the client. `auth.me` builds
  `/api/v1/auth/get-session`; a prefix claim cannot tell you better-auth still
  calls it that, and better-auth is a third-party dependency on its own release
  cadence (this repo already chased its 1.7 column drift in #3624 / #3647).

  `plugin-auth` mounts it with a single catch-all, so there are no per-route
  registration calls to capture the way tranche 3 captured
  `registerStorageRoutes`. The seam is `auth.api`: every better-auth endpoint
  carries `.path` and `.options.method`, so a live instance is the route table.

  `auth-route-ledger.ts` reads it, in two halves checked differently on purpose:

  - **55 reviewed rows** — every route the SDK calls, each naming its client
    method, checked strictly against the live table. This is the rename detector.
  - **129-path mounted-surface inventory** — checked for exact equality both
    ways, so a version bump that adds publicly-mounted auth endpoints becomes a
    reviewable CI diff. Machine-maintained rather than reviewed prose: demanding
    a rationale for all 129 would make every better-auth upgrade a hundred-row
    review and the ledger would rot into rubber-stamping.

  Enumeration is config-dependent, so the inventory is pinned at the
  configuration enabling every plugin the SDK targets — the maximal surface —
  with the participating `OS_*` env vars cleared so a developer's shell cannot
  produce a spurious diff. Mutation-checked: renaming a ledgered route fails the
  suite naming it.

  The capstone guard now includes this ledger in its union and prefers exact rows
  over wildcard families when matching — without that ordering fix every
  `/auth/*` URL would still have been absorbed by `* /auth/**` and the new ledger
  would have changed nothing. Wildcard-only matches fall **60 → 3**; the ratchet
  moves with them. What remains is `* /ai/**`, whose routes `service-ai` builds
  at plugin start.

  No runtime change: a ledger, a guard, and the header/audit-doc notes.

- d0fea33: fix(auth): map ObjectQL `ValidationError` to a 4xx on the better-auth paths (#3398)

  A field-level validation failure raised by the ObjectQL record-validator
  (e.g. an invalid `image` on `POST /api/v1/auth/update-user`) surfaced to the
  HTTP client as a **raw 500 with an empty body**. better-auth only maps its own
  `APIError`s to structured responses; any other error thrown from an adapter
  method propagates to better-call's router as an unhandled fault → `500 {}`.

  Added the auth-path analogue of the REST layer's `mapDataError`: the objectql
  adapter now detects the ObjectQL validation envelope at its boundary (duck-typed
  by `code` / `name`, so plugin-auth keeps no hard dependency on
  `@objectstack/objectql` and cross-realm `instanceof` can't bite) and re-throws
  it as `APIError('BAD_REQUEST', …)`. `update-user` and friends now answer with a
  `400 { code: 'VALIDATION_FAILED', message, fields }` instead of an opaque 500.

- 2d14b35: fix(plugin-auth): `convertWhere()` 补齐 `not_in` / `starts_with` / `ends_with`,未识别算子改为响亮拒收 (#5813)

  `convertWhere()` 的分支链只覆盖 better-auth 十一个算子里的八个。
  `not_in` / `starts_with` / `ends_with` 落在链尾之外:**`filter` 里不写任何键**,
  不告警,链尾也没有 `else` 兜底。一个只带这类条件的 `where` 因此编成 `{}`。

  **丢谓词不是把结果变窄,是变宽 —— 而且发生在身份表上**(#3948 反复论证过的形状,
  driver-memory 的匹配器 `default:` 臂与 objectql 的 `having` 都为此改成了拒收):

  - `findMany` / `count` 变成**全表**(仅受 `limit` 截断)。已挂载的
    `GET /api/v1/auth/admin/list-users`(`auth-route-ledger.ts:161`)把查询参数直接
    推进 `where`,而 `searchOperator` 的枚举是 `contains | starts_with | ends_with`、
    `filterOperator` 的枚举**就是整张算子表**。于是
    `?searchValue=abc&searchOperator=starts_with` 返回的是「全部用户」而不是「以 abc
    开头的用户」,`?filterField=email&filterOperator=not_in&filterValue=…` 不排除任何人。
    管理台的用户检索是它的主要消费者。
  - `update` / `delete` / `consumeOne` / `incrementOne` 走的是「先 `findOne(filter)`
    再按 id 写」,`{}` 让 `findOne` 返回**任意一行**(实测是第一行),于是写到了错误的
    记录上。实测证据:对四行表执行「删除 `name` 以 `zed` 开头的用户」,修复前删掉的是
    `u_abc1`(第一行),不是 `u_zed`。

  ## 改了什么

  **一、三个算子按词表直译**(三个 ObjectQL 算子都在 `FILTER_OPERATORS` 里,
  五后端都必须求值):

  | better-auth   | ObjectQL      |
  | :------------ | :------------ |
  | `not_in`      | `$nin`        |
  | `starts_with` | `$startsWith` |
  | `ends_with`   | `$endsWith`   |

  大小写语义两侧同向,直译不开契约缝:better-auth 的 `Where.mode` 默认
  `"sensitive"`,`$startsWith` / `$endsWith` 按 #5701 Q2=A 在契约层也是大小写敏感。

  **二、链尾未识别算子响亮抛错**,不再静默丢。错误信息带算子名、字段名与受支持算子
  清单,本身就是操作指引。这是 restore-invariant:否则 better-auth 下次加算子时,
  这个洞会以完全相同的方式重开一次。

  ## 对使用方的影响

  - 用上述三个算子的查询**从「返回全表 / 写错行」变成「按谓词正确过滤」**。这是缺陷
    修复,不是可依赖行为的移除 —— 但依赖「`starts_with` 检索能列出全部用户」的脚本会
    看到结果变化。
  - 传入**词表之外**的算子从「静默忽略该条件」变成**抛错**。今天没有活体调用方能命中
    这一支(`/admin/list-users` 的两个参数都由 better-auth 自己的 zod 枚举把关),它面向
    的是将来:better-auth 长出第十二个算子时,查询会在第一次执行就失败,而不是悄悄放大。
    该分支同时是编译期哨兵(`never` 收敛),`pnpm --filter @objectstack/plugin-auth
typecheck` 会先一步报错。
  - `Where.mode: 'insensitive'` **不在**本次范围内,也不会被这条拒收波及 —— `mode` 是
    `operator` 的兄弟字段而非算子,今天仍被忽略(#5814,决策箱中)。

- 36c2f00: fix(plugin-auth): `/auth/change-password` now clears the force-change flag and enforces password-reuse on the BEARER lane, not only on cookies (#8049)

  An admin-provisioned user (`POST /auth/admin/create-user`, where
  `mustChangePassword` defaults to **true**) is gated out of every protected route
  with `403 PASSWORD_EXPIRED` until they rotate their password. On the **bearer
  lane** — the documented API/agent/CLI lane — that escape hatch did not work:
  `POST /auth/change-password` answered **200**, the password really rotated, and
  the caller stayed locked out forever. `must_change_password` stayed `true` and
  `password_changed_at` stayed `null`. The console was unaffected, because the
  cookie lane cleared both correctly.

  **The same root cause silently skipped a security control.** One stash —
  `ctx.context.__osPwChangeUserId`, set by the before-hook when it resolves the
  acting user — gates three behaviours: the `password_changed_at` /
  `must_change_password` stamp, ADR-0069 D1's password-reuse **rejection**, and the
  password-history append. With no principal resolved, none of them ran, so on the
  bearer lane password history was **neither checked nor recorded** — a user could
  immediately "change" their password back to the one they had just rotated away
  and be told 200. A control enforced on one transport and absent on another is
  worse than one absent on both, because the console and the existing tests both
  exercise the working lane.

  **Cause.** better-auth orders `options.hooks.before` (the auth manager's global
  before-hook) ahead of every plugin before-hook — including `bearer()`'s, which is
  what rewrites `Authorization: Bearer` into a session cookie. The resolver used a
  bare `getSessionFromCtx(ctx)`, which reads that cookie, so on the bearer lane it
  read a cookie that did not exist yet and resolved nothing, while better-auth's
  own password write — running after the conversion — succeeded.

  **Fix.** The acting principal is now resolved once, for both lanes, through the
  shared hook-order-independent `resolveActor` (which falls back to explicit token
  lookup) rather than a second stamp site. That resolver also now strips the
  signature from a bearer credential the way it always did for cookies: `bearer()`
  hands clients the signed `<token>.<sig>` form in `set-auth-token` and accepts it
  back, while `sys_session.token` stores the unsigned value — so the credential the
  documented lane actually issues resolved nothing. This also repairs the same
  lookup for the `/sso/register` admin gate, which shares the resolver.

  No behaviour change on the cookie lane.

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

- 93929c2: fix(plugin-auth): break-glass 不变量补上第三条路径 —— 撤销「管理员身份」的写(`sys_member` 降级/删行、`admin_full_access` 授权删/改)同样被拒 (#5978)

  cloud ADR-0024 D5.2 的不变量是「环境永远至少留一个能登录的管理员」。此前它由两个引擎钩子守着,
  **都装在 `sys_user` 上**:`banned = true`(#5892 / PR #5939)与删 `sys_user` 行(#5941 / PR #5993)。

  但「谁是管理员」这件事根本不存在 `sys_user` 上 —— 它由另外两张表推导(`resolveAdminUserIds`
  正是从这两张表反向枚举的)。于是第三条写法完全绕开两个守卫:**用户行原封不动,把他的管理员身份拿掉**。

  - 把最后一个管理员的 `sys_member.role` 降到 admin 等级之下(better-auth 的 `updateMemberRole`、
    一次 SCIM 组映射变更、导入、脚本),或直接删掉那条 `sys_member` 行;
  - 删掉那条 `admin_full_access` 的 `sys_user_permission_set` 授权,或把它改到不再生效
    —— 改指向别的权限集、加上 `organization_id` 组织作用域、把 ADR-0091 有效期窗口改过去。

  三者事后状态与「删掉最后一个管理员」完全等价:所有人都还在,没有任何人能管理任何东西,
  产品内部无恢复路径。

  **新增的拒写语义。** 守卫现在按同一形状扩到 `sys_member` 与 `sys_user_permission_set` 的
  `beforeUpdate` / `beforeDelete`(共六个钩子,同 `packageId`、同 priority 20)。判据就是 issue 的原话
  ——**枚举、模拟、再枚举**:先枚举当前管理员,再把这次写落地后的行拿同一个枚举函数跑一遍,
  若第二次为空而第一次不为空则拒写。两次枚举是同一份实现,「谁是管理员」不可能对写前问题和写后问题
  给出两个答案。

  - **全覆盖,不是只拦自降级**:真正会发生的是 IdP 组映射改别人的角色,不是管理员给自己降级。
  - **谓词/批量写照判**:一次 `where` 命中多行的 update/delete 会先解析出整个匹配行集再做写后模拟,
    而不是一律拒绝;只有匹配集本身解析不出来(读失败,或超过 `maxScan`)才响亮拒写。
  - **fail-closed**:枚举失败或形状不确定一律拒写并点名 ADR-0024 D5.2,与既有两半同向。
  - 模拟是**单向**的 —— 只会拿走身份,不会授予身份(把 role 从 `member` 升到 `admin`、把授权改指向
    `admin_full_access` 这类写,模拟看不见新增的管理员),因此每一处取整都倒向「拒写」而非「放行」。

  **不拦的**:降级到**另一个** admin 等级(`owner` → `admin`,或逗号拼写 `member,admin`)—— 等级未失;
  已被 ban 的管理员的身份被撤(本来就不能登录,没有东西被拿走);非管理员的 membership/授权;
  以及不触及 `role` / `user_id`(membership)或权限集/作用域/有效期(授权)的 payload —— 这类写
  静态可证不改变枚举结果,一次读都不做。

  有效期语义按 `resolveAdminUserIds` 现有的 `isGrantActive`(ADR-0091 D2)**原样消费**,本次不新造
  (#5893 才是那个问题的归属单)。等级判定全程只问 `isOrgAdminGrade` 这把唯一的尺(#5939 / #5942),
  守卫内没有任何手抄的 role 解析。

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

- c892829: fix(auth): a user's first session no longer predates their membership, so its audit rows carry a tenant (#8245, #8247)

  `session.create.before` resolves a session's `activeOrganizationId` from the
  caller's `sys_member` row. The ADR-0093 D2 reconciler that **writes** that row is
  composed into `user.create.after`, and better-auth defers it past the sign-up
  transaction — so the session sign-up mints ran first, found no membership, and
  carried no active organization. Structurally, for every new user, on every
  deployment.

  That first session was not a harmless intermediate. Its `login` audit row takes
  its tenant from `session.activeOrganizationId`, so the row landed with a NULL
  tenant and the SecurityPlugin's RLS predicate (`organization_id =
current_user.organization_id`) hid it from every reader **permanently** —
  nothing back-fills a written ledger row, and the rows lost this way are exactly
  the ones describing account creation.

  The membership now settles at the seam that needs it: when the active-org lookup
  finds nothing, the reconciler runs and the lookup is repeated, so the first
  session mints _with_ its organization.

  **This changes ordering, not policy.** It calls the same reconciler with the same
  membership policy and the same target-organization resolution that
  `user.create.after` uses — both now share one assembly point on the manager — so
  the outcome is exactly what would have happened a moment later:

  - `invite-only` binds nobody, and those sessions still mint with no active
    organization;
  - a multi-organization deployment resolves no unambiguous target and binds
    nobody, unchanged;
  - a user who already holds a membership never reaches the new branch, and no
    second membership is ever written;
  - owner-preference in the active-org selection is unchanged, because the
    selection is one function called on both sides of the settle.

  Cost is paid only where there is something to fix. A deployment that binds nobody
  stops at the reconciler's own policy check without touching the store, and the
  repeat lookup is gated on an outcome meaning a membership now exists — so an
  ordinary sign-in issues no extra query.

  Unchanged: `user.create.after` still reconciles (the creation paths that mint no
  session at all — admin create-user, bulk import, SSO JIT — are untouched), the
  host `session.create.before` hook still chains first and still wins,
  `autoActiveOrganization: false` still opts out entirely, and a failing engine
  still never breaks session creation.

- 08f93bc: fix(auth): `organization/create` gates on the authoritative `OS_TENANCY_POSTURE`, not the demoted `OS_MULTI_ORG_ENABLED` (#5233)

  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — mounted the entire organization wall and still
  answered `403 Creating additional organizations is disabled on this deployment.`
  to `POST /api/v1/auth/organization/create`. Org-less users had no way to create
  their workspace, so the guided "Create your workspace" path was a dead end.

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  Two sites in `AuthManager` kept reading the demoted boolean directly, so both
  reported "single-org" on a deployment that had asked for a wall and got one:

  - `organizationHooks.beforeCreateOrganization` — the 403 above. It now judges
    `postureEnforcesWall(resolveTenancyPosture())`, matching the knob `serve.ts`'s
    own ADR-0093 D5 boot guard keys on. Intent is unchanged (single-org still
    refuses); only the knob is corrected.
  - `/auth/config`'s `features.multiOrgEnabled` — its no-tenancy-service fallback
    read the same boolean. It now falls back to the resolved posture, so a lean
    embedding advertises the capability its own gate allows.

  **No configuration change is needed anywhere.** Deployments that set only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  workaround people used to unblock themselves stays valid. Deployments that set
  only `OS_TENANCY_POSTURE` can now drop the redundant boolean.

  `resolveMultiOrgEnabled()`'s doc comment in `@objectstack/types` — which still
  instructed "the auth manager's `/auth/config` feature flag and org-create guard
  … MUST call this", written before the demotion — now says the opposite: ask the
  posture, and never gate on this boolean. Its behaviour is unchanged.

- 889d1b9: fix(plugin-auth): impersonation actually takes effect for bearer clients — rotate the caller's token, and let `stop-impersonating` recover the admin via bearer (#8243)

  `POST /api/v1/auth/admin/impersonate-user` answered **HTTP 200 and did nothing**
  for every bearer-authenticated client — the console after every normal sign-in,
  and every deployment where cookies are blocked, which is the exact context
  better-auth's `bearer()` plugin exists for.

  Two correct pieces of better-auth collided. `bearer()` authenticates a request by
  **overwriting the request's session cookie** with the bearer token. The admin
  plugin's impersonation route does the opposite: it mints the impersonation
  session and hands it over **as a cookie**, parking the admin's own session token
  in a signed `admin_session` cookie for the way back. A browser composes those
  two; a bearer client cannot. The client kept replaying its unchanged
  `Authorization: Bearer` header, that header kept being converted back into the
  **admin's** session, and the impersonation cookie was never read.

  Nothing reported this. The endpoint returned success, an impersonation session
  row existed, and every subsequent request — including every write, since the
  framework's data routes resolve identity through the same seam — was attributed
  to the **admin** rather than the impersonated user.

  **Impersonation now rotates the caller's credential.** When the caller
  authenticated with a bearer, the token it holds is invalidated as part of
  impersonating: a rotated admin session is minted, the caller is handed it as a
  recovery credential, and the original admin session is deleted. Afterwards the
  only token that resolves is the impersonated one better-auth already emits on
  `set-auth-token`. A client that adopts the rotation is the impersonated
  principal; a client that ignores it gets a loud 401 on its next request.
  "Impersonation succeeded but did not take effect" is no longer expressible.

  Refusing bearer-authenticated impersonation was considered and rejected: it
  would leave cookie-blocked deployments unable to impersonate at all.

  **The exit path ships with it.** `POST /admin/stop-impersonating` resolved the
  admin through the `admin_session` **cookie alone**, so it was dead in precisely
  the deployments this fix is about. The recovery credential is now emitted on a
  `set-admin-session-token` response header (exposed via
  `Access-Control-Expose-Headers`, alongside `set-auth-token`) and accepted back on
  an `x-admin-session-token` request header. Clients that already work through
  cookies need no change: a real `admin_session` cookie still wins, and the vendor
  route's own checks all still run — this adds a lane, it does not open one.

  For API clients, the flow is the same one `set-auth-token` already asks for:
  read both headers off the impersonation response, send `Authorization: Bearer`
  with the new token, and send the recovery credential back on
  `x-admin-session-token` when leaving impersonation.

  Unaffected: cookie-authenticated impersonation, which is unchanged byte for
  byte — a browser caller has no stale credential in hand to invalidate.

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

- 55dbbba: feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

  Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
  declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
  of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
  `@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
  that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
  outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
  tune did not exist (#4937). Neither half was broken; they were simply never connected, and
  both were documented as if they were.

  They are connected now, along one narrow path.

  ## What you write

  ```ts
  export default defineStack({
    manifest: {
      /* … */
    },
    server: {
      security: {
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
      },
      trustProxy: false,
    },
  });
  ```

  `server:` is a **new** top-level stack key. Nothing declared it before, so no existing
  stack changes behaviour on upgrade — there is no configuration that was inert yesterday
  and starts throttling today.

  It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
  nothing else, because those are the two keys with a consumer. It is NOT the nine-key
  `HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
  mounting them here would have made seven dead keys writable in one move (their
  enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
  budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
  is refused at `defineStack` rather than at 3am.

  **No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
  `objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
  the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
  built-in default.**

  ## What happens

  Every inbound request the server routes — REST, dispatcher, service routes, anything
  mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
  refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
  with a `Retry-After` computed from the bucket itself and the standard error envelope
  (`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

  The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
  anonymous traffic — so one abusive session cannot spend another user's budget, and
  credential-stuffing traffic (which has no principal yet) is still metered per source. That
  IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
  otherwise it is the transport's own peer address. Undeclared, those headers are attacker
  input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
  let them drain a chosen victim's.

  Counters live in the kernel `cache` service when one is registered, so a multi-node
  deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
  consume time so a cache plugin that registers later is still picked up (#4772). With no
  cache service at all it falls back to a per-process store and says so once, naming the
  consequence: the effective limit becomes the declared budget multiplied by the number of
  nodes, and nothing about the deployment looks wrong.

  ## Also in this change

  - **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
    passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
    middleware could not read the request, write a response, or decline to continue — a
    declared seam with no execution behind it, unnoticed because nothing called it. It now
    delivers method/path/query/headers plus the transport peer address
    (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
    registered before the routes it guards; the kernel's two-phase boot makes that automatic
    (`init()` before every `start()`).
  - **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
    does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
    in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
    now labelled as the reference material it always was rather than as live defaults.

  ## Explicitly NOT wired

  `ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
  **known-unwired**. Declaring them still changes nothing. They are not retired here either:
  the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
  key of a surface that may yet be implemented would only have to be undone. Tracked, not
  silent.

- 5faeac6: fix(auth): spell isLikelyEmail's ASCII guard with printable bounds (no control char)

  The non-ASCII guard added in framework#3566 was written as `[^\x00-\x7f]`, whose
  regex literal embeds a control character (`\x00`). Rewrite it as `[^\x20-\x7e]` —
  identical behaviour (anything outside printable ASCII fails the email
  pre-filter), but the pattern no longer carries a control character (eslint
  `no-control-regex`), and it matches the objectui side's `isPlausibleEmail`.

- 9fa6bab: fix(plugin-auth): sign JWTs with an algorithm the host can actually use (#3585)

  On any host whose WebCrypto lacks Ed25519 — StackBlitz/WebContainer is the
  reported one — **every authenticated request 500'd as soon as the OIDC provider
  was enabled**, which is the default whenever the MCP server is on. Sign-in
  succeeded, then the first `/api/v1/auth/get-session` returned 500 with
  `OperationError … cfrgGenerateKey`. An app that never asked for OIDC got an
  unusable login, and the only escape was `OS_OIDC_PROVIDER_ENABLED=false`.

  The cause was an inherited default: `plugin-auth` registered better-auth's `jwt`
  plugin without `jwks.keyPairConfig`, so better-auth's **EdDSA / Ed25519** default
  applied and jose asked WebCrypto for an algorithm the host does not have. It hit
  ordinary cookie login rather than just OAuth clients because the plugin's `after`
  hook signs a `set-auth-jwt` header for _every_ session.

  **Three changes, no configuration required:**

  - **The signing algorithm is now chosen by capability, not by inheritance.** At
    instance build the plugin asks WebCrypto whether it can generate an Ed25519
    key pair — using the exact algorithm descriptor jose uses — and pins
    `keyPairConfig` to `EdDSA`/`Ed25519` when it can, or falls back to **ES256**
    when it cannot. Hosts with Ed25519 behave exactly as before.
  - **Deployments that already minted an EdDSA key keep working.** Choosing ES256
    for _new_ keys is not sufficient on its own: better-auth's `resolveSigningKey`
    falls back to _any_ stored key when none matches the configured algorithm, so
    an existing EdDSA key in `sys_jwks` would still be selected and then fail in
    `importJWK`. On a host without Ed25519 the plugin now installs better-auth's
    `adapter.getJwks` keyring seam and hides keys this host cannot import, so a
    fresh ES256 key is minted and the deployment converges on a working state.
    Hidden rows are **never deleted** — move back to a host with Ed25519 and they
    are used again. Such a host also stops advertising those keys in
    `/api/v1/auth/jwks`, since it can neither sign nor verify with them.
  - **A signing failure can no longer take down the session path.** If signing
    fails anyway (neither algorithm usable, an unwritable `sys_jwks`, or a rotated
    `OS_AUTH_SECRET` that cannot decrypt the stored key), `/get-session` now
    returns the session normally and simply omits the `set-auth-jwt` header,
    instead of 500ing. The failure is reported once with an error that names the
    algorithm, says what still works, and points at the opt-out — and is queryable
    via `getDegradedAuthFeatures()` under the new `jwtSigning` key.

  No configuration changes and no migration. Deployments on hosts with Ed25519 are
  unaffected: the keyring override is installed only where it is needed.

- ea1d916: fix(plugin-auth): keep the last-administrator guard exact when `before*` hooks fire per row (#5574)

  The break-glass guard resolved a write's target set as "a scalar `input.id` if
  there is one, otherwise the caller's predicate". That was sound only because a
  predicate (`multi: true`) write's `before*` dispatch left `input.id`
  present-but-**undefined**. ADR-0058 Addendum II makes the `before*` phase fire
  once per MATCHED ROW, each context naming its own row — so read that way, a
  `multi` ban of every administrator arrives as N separate by-id bans, each of
  which is legitimately allowed (banning one admin out of three leaves two), and
  the batch locked the environment out with no refusal anywhere.

  `resolveTargetIds` now asks `options.multi` FIRST: on a predicate write the
  target set is the caller's predicate, whichever row the current dispatch names;
  the id is consulted only when the write really is by-id. `input.options` is the
  caller's bag during `before*` — `where` and `multi` included — and the contract
  preserves that deliberately, so the discriminator the guard needs is unchanged.

  All eight guarded halves (#5892 ban, #5941 delete, #5978 standing) are covered
  by the existing predicate cases, which went red on the engine change and are now
  the pin that a population-scoped invariant survives being asked one row at a
  time.

- b691ba9: fix(plugin-auth): break-glass 守卫扩到 `sys_permission_set`,并把「零管理员」从引导期豁免里分辨出来 (#6084)

  break-glass 不变量(cloud ADR-0024 D5.2)此前守三张表:`sys_user`(ban/删行,#5892/#5941)与
  `sys_member`/`sys_user_permission_set`(撤销 standing,#5978)。**第四条写法绕开全部三条**:
  「谁是 platform admin」是**按名字**解析的——`resolveAdminUserIds` 先
  `where: { name: 'admin_full_access' }` 取那条 `sys_permission_set` 行,再去读指向它 id 的授权行。
  删掉那一行、或把它改个名字,授权行、`sys_user` 行、`sys_member` 行**一个都没动**,而所有
  platform admin 同时不再是管理员。

  ## 放大缺陷:这一条写法还会顺手关掉守卫本身

  两个判据都以「这个环境有管理员吗?没有就放行」开场——引导期本就没有 break-glass 账号可保护,
  在那个窗口里拒绝一切身份写会是守卫拿一个空测量值自造政策。可是 `admin_full_access` 行没了的环境
  **读起来正是零管理员**,于是豁免生效,ban / 删用户 / 降级 / 撤授权**一并放行**。所以这一条写法
  不只是锁死环境,还在锁死的路上把 #5892 / #5941 / #5978 三条守卫一起解除。

  ## 两处改动

  **① 同形状扩到第四张表。** `sys_permission_set` 的 `beforeUpdate` + `beforeDelete`,复用 #5978 的
  `enforceStanding` / `applyPending`,`PendingStandingWrite` 多认一张表;枚举的第一段 scan 现在也对
  pending 做模拟并**重测 `name`**——与 grant 半边重测 `permission_set_id` 同理,scan 自己的 `where`
  只证明了写**之前**那行叫什么。静态跳过键只有 `name` 一个:枚举只读这一列,所以每一次 projection
  回填、每一次 `os meta resync`、每一次 Setup 里编辑权限集(写的是 `label`/`description`/权限 JSON)
  一次读都不花。数据门自己已经拒绝改名(ADR-0094),这道守卫覆盖的是不经数据门的引擎级与
  system-context 写。

  **② 收紧引导期豁免。** 「零管理员」拆成它本来混在一起的两种状态:

  - **真引导期**——没有任何证据说这里曾经有过 platform admin。照旧放行。
  - **刚被清空**——仍存在无组织范围、有效期内的 `sys_user_permission_set` 授权行,而它指向的
    `sys_permission_set` 行已经不在了。fail-closed 拒写,并在报文里点名那些悬空授权行。

  判据选的是**悬空授权行**,因为它在正常路径上根本写不出来:每一个生产者都先插权限集、再读回 id 写
  授权行(`bootstrapPlatformAdmin` 第 1 步 seed 权限集、第 2 步才提拔第一个用户,权限集缺席时返回
  `admin_permission_set_missing` 而不是发授权),所以**全新环境的可写性按构造不变**——测试里有一条
  「真引导期照常放行」的钉专门量这一点。改名不留下悬空授权行,这条判据看不见它;那条路径改由 ① 在
  写入处拦下,残留因此只剩一种状态:守卫尚未注册时落下的改名。曾考虑把判据放宽成「不存在
  `admin_full_access` 行 且 存在无组织范围授权行」,被否掉——它会改变「seed 顺序先写授权行」的全新
  环境的答案,而不改变全新环境的答案正是这条判据唯一不能碰的红线。

  `sys_permission_set` 的拒绝报文结尾不走 SCIM 那句:IdP 不写这张表,写它的是元数据删除、
  `os meta` 与包卸载,报文点名的是这些门。

- 73dc89b: fix(plugin-auth): canonicalise `sys_member.role` at the write, so an org admin can no longer remove an owner (#8317)

  **Security — authorization inversion.** A membership stored with a non-canonical
  role — `Owner`, `' owner'`, `OWNER` — was an **owner** to every ObjectStack-side
  check and a **plain member** to better-auth.

  better-auth `1.7.0-rc.2` reads that column with a raw `role.split(",")`, with no
  `trim()` and no `toLowerCase()`, in three branches of
  `dist/plugins/organization/routes/crud-members.mjs`: `removeMember`'s "only an
  owner may remove an owner", `updateMemberRole`'s creator protection, and
  `organization/leave`'s last-owner count. ObjectStack's own readers all trim and
  lower-case (the #5942 grade ladder, `mapMembershipRole`). So on such a row the
  vendor never entered its owner branch at all and fell through to
  `hasPermission({ member: ['delete'] })` — **which an org admin passes**. An org
  admin could remove, demote, or count out an owner that every ObjectStack check
  treated as an owner.

  Not reachable through the ordinary invite/accept path (better-auth's own writes
  are canonical). Reachable through anything else that writes the column: an
  operator SQL fix-up, a data import, a SCIM group mapping, a script.

  **The fix normalises at the write**, so the disagreement is unrepresentable
  rather than adjudicated per reader:

  - ObjectQL `beforeInsert` / `beforeUpdate` hooks on `sys_member` canonicalise
    `role` on every write path, in every context (system and better-auth adapter
    writes included — those are the paths this exists for). They run at priority
    5, ahead of the ADR-0092 identity write guard and the ADR-0024 D5.2
    break-glass guard, so both judge the value's normal form.
  - A **one-off convergent pass runs at boot** and canonicalises rows that already
    exist. It is idempotent, safe to re-run, and logs a census of every distinct
    non-canonical spelling it found with row counts.

  Canonicalisation is per token: a token that is a membership role (ADR-0108's
  closed vocabulary) is trimmed and lower-cased; any other token is preserved
  verbatim apart from trimming, because `mapMembershipRole` passes an unknown
  value through with its case and it becomes a position name a permission set may
  be bound to. A value carrying no known role at all is left completely untouched
  and only reported — it cannot produce the inversion.

  No API, schema or configuration change: `sys_member.role`'s option list is
  unchanged, and canonicalisation never moves a membership's grade, so no
  membership gains or loses authority as a result of this fix.

- 4addd9d: feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

  SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
  introduced enforced **nothing** on rows whose organization is NULL — which on a
  single-tenant stack (where the kernel injects the column and never fills it) is
  **every row**: field-level `unique: true` was a silent no-op there, measured in
  #5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
  organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
  rows collapse into one platform bucket, unique among themselves; non-NULL rows
  are untouched. Storage stays NULL — the sentinel exists only inside the index
  key, and it is the same word the autonumber sequence table already uses
  (`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
  bucket collided", not as corrupt data.

  What changes, concretely:

  - **Field-level `unique: true`** (and the new explicit synonym
    `'organization'`) on a tenant-scoped object → composite
    `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
    tenant-less objects are unchanged.
  - **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
    `unique: 'organization'` prepends the NULL-safe organization key part to the
    listed columns (degrading to the listed columns on a tenant-less object; a
    listed tenant column is made NULL-safe in place instead — the S6 respelling).
    `unique: true` / `'global'` on a declared index stays **verbatim** — the
    #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
    keys keep their exact physical shape. (The spec/lint side of the vocabulary
    lands separately via #4986; the driver deliberately merges first.)
  - **Drift detection reads both sides through one normalization**
    (the #4884 discipline, extended to the tenant key part): the physical
    `COALESCE(organization_id, <literal>)` form is attributed to the column,
    compared **literal-agnostically**, and recognised as the sync's own
    vocabulary — a healthy database reports zero drift on every dialect.
  - **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
    `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
    surfaces as a `recreate_index` drift op — a pure tightening — gated by a
    **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
    `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
    (data the void constraint wrongly admitted) → the op is **blocked** with a
    per-group row report, the old index stays in place, and apply re-probes so
    even `--allow-destructive` cannot drop a constraint whose replacement is not
    creatable. Deduplicate, re-plan, apply.
  - **`'__global__'` is reserved at the organization-minting seam**
    (plugin-auth): an organization whose id or slug equals the sentinel is
    rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

  Migration note for operators: on databases with pre-existing
  organization-composite uniques, the first `os migrate plan` after upgrading
  shows one `recreate_index` per affected index. On healthy data it auto-applies
  in dev and is a no-op content-wise; a blocked op means the #5030 defect
  admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
  MariaDB cannot express the functional key part: the driver degrades to the
  bare composite, says exactly what is not enforced at `error` level, and keeps
  reporting the tightening as drift for after the server upgrade.

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

- 29308ba: fix(plugin-auth): the D5.1 `/oauth2/authorize` env-access gate now runs for a signed bearer credential (#8102)

  ADR-0069 D5.1's cloud-as-IdP gate (`oidcAuthorizeGate`) is what enforces
  org-membership / app-assignment before the OP issues an authorization code. It
  resolved its subject with an **inline copy** of the shared `resolveActor` —
  line for line the same logic, in a second place — and the two diverged the
  moment one of them was fixed.

  `#8049` taught `resolveActor` that a bearer credential must have its signature
  stripped before lookup: `bearer()` hands clients the signed form in the
  `set-auth-token` response header (the documented API-lane credential) and
  accepts it back, while `session.token` stores the **unsigned** value. The copy
  guarding `/oauth2/authorize` kept looking the signed credential up verbatim and
  so resolved nothing.

  **Why that is a security defect and not a lookup miss.** The unresolved case at
  this endpoint is deliberately **fail-open** — an anonymous caller must fall
  through so the OP can redirect them to log in. So an _authenticated_ caller
  holding the signed bearer was read as unauthenticated, and the env-access check
  was not denied but **never evaluated at all**: the request proceeded, and
  against a `skip_consent` client it was issued an authorization code that the
  gate, had it run, would have refused. A declared control enforced for one
  credential spelling and silently absent for the other.

  Impact is bounded: `oidcAuthorizeGate` is set only on the cloud control plane
  (unset in open editions / self-host, where there is no gate at all), and the
  OP's authorize endpoint is normally browser/cookie-driven — the cookie branch
  always normalized and was never affected.

  **Fix.** The inline copy is deleted; the branch calls the shared
  `resolveActor`, so there is one resolution site instead of two. The fail-open
  default for genuinely unauthenticated callers is unchanged and deliberately
  preserved.

  Pinned by a new dogfood gate that arms a **denying** gate and drives
  `/oauth2/authorize` over the cookie lane and both accepted bearer spellings,
  asserting on each that the gate was actually invoked with the caller as its
  subject and that the request was refused rather than issued a code.

- 759a53a: fix(plugin-auth): OIDC SSO provider registration works again — stop emitting the retired `oidcConfig.mapping.id` key (#8193)

  Registering an external OIDC identity provider through the `sys_sso_provider`
  `register_sso_provider` action failed **every time**, with HTTP 400:

  ```
  [body.oidcConfig.mapping] Unrecognized key: "id"
  ```

  Not intermittent and not configuration-dependent — the OIDC half of the
  registration bridge was unusable for every deployment, and nothing was
  persisted. SAML registration was unaffected.

  The bridge unconditionally emitted a claim mapping of
  `{ id, email, name }`. `@better-auth/sso` declares `oidcConfig.mapping` as a
  **strict** object, so a member it does not declare is rejected outright rather
  than ignored.

  **`id` was not a key that moved — it was retired upstream.** In 1.6.20 the
  mapping was a plain (non-strict) object that did carry `id`, and the plugin
  honoured it when resolving the federated user. The pinned 1.7.0-rc.2 removes the
  member and reads the federated subject from the OIDC `sub` claim directly, then
  cross-checks it against the ID token. There is consequently no new home for the
  key: `extraFields` is the one open member of the strict object, but a value
  placed at `extraFields.id` is overwritten by `sub` before it is ever used, so
  re-homing the key there would have looked configured while doing nothing.

  The emitted mapping is now `{ email, name }` — the two members the strict schema
  requires — and the email/name claim mappings collected by the form continue to
  work exactly as before.

  **The user-ID claim mapping is now refused instead of ignored.** Because the
  subject claim is no longer configurable at all, a registration that asks for a
  non-`sub` user-ID claim is answered with a clear `INVALID_REQUEST` explaining
  that the subject is always read from `sub`, rather than being accepted and
  silently discarded. Leaving the field empty — or setting it to `sub`, the value
  the form suggests — registers as normal.

  Pinned by a regression test that drives the real `/sso/register` endpoint of a
  real better-auth instance, so the emitted body is judged by the installed
  package's own schema and the next dependency bump that moves this surface fails
  loudly instead of shipping.

- e7a7506: Fix `POST /api/v1/auth/admin/remove-user`, which could never succeed and left the identity un-authenticatable when it failed.

  Three compounding problems on the better-auth admin removal path:

  - **`sys_member.user_id` declared no `deleteBehavior`.** A `lookup` defaults to `set_null`, and the engine escalates a defaulted `set_null` on a REQUIRED foreign key to `restrict` — so the membership every user gets at sign-up (and, since the invitation-adoption change, keeps after accepting an invitation) vetoed every `sys_user` delete. The field now declares `deleteBehavior: 'cascade'`. The last-administrator invariant is unaffected: it is enforced by a `beforeDelete` hook on `sys_member`, and the engine's cascade recurses through the public `delete()`, so that hook still runs.
  - **The removal was not atomic.** better-auth deletes the sessions, then the accounts, then the user, in three calls with no transaction, so anything refusing the last one left the credential rows deleted and the user row behind — an identity still on the org roster that can no longer sign in. Subject-erasure requests now run inside one engine transaction and roll back as a unit. Datasources whose driver has no transaction support keep the previous behaviour and log the engine's existing warning.
  - **A referential refusal reached the client as an HTTP 500 with an empty body.** The auth adapter mapped engine validation errors and policy refusals to better-auth `APIError`s but not referential ones, so a `DELETE_RESTRICTED` escaped unmapped. It now surfaces as a structured 409 carrying the dependent object, the dependent count and the remedy.

- db8c285: fix(plugin-auth): 短信日配额拒发时,OTP / 邀请短信按 429 TOO_MANY_REQUESTS 作答,不再是 500 (#6039)

  #2814 把短信总量成本闸落在 `SmsService.send()` —— 它是内核服务,不知道调用方是谁,
  所以超限时**返回**一条失败结果,把码写在服务层既有的 `CODE: message` 信封上:
  `TOO_MANY_REQUESTS: daily SMS quota exhausted`。把 HTTP 语义还原回去是 auth 端点的
  职责,而 `AuthManager` 此前没有做:`deliverPhoneOtp()` / `sendPhoneInviteSms()` 对
  任何 `status === 'failed'` 一律抛普通 `Error`。

  better-auth 的路由层 better-call 只把 `APIError` 映射成真实状态码
  (`isAPIError = err instanceof APIError || err?.name === 'APIError'`,
  better-call@1.3.7 `dist/utils.mjs:57`,消费点在 `dist/router.mjs:93`),其余一律走
  `console.error` + **500、响应体 `null`** 的分支。于是配额拒发对外是 500,
  `TOO_MANY_REQUESTS` 只留在服务端日志里;而**同一个端点**上按号码冷却闸
  (`assertPhoneOtpSendAllowed`,在 admission hook 里)抛的是
  `APIError('TOO_MANY_REQUESTS')`,正常回 429 —— 一个端点两种口径,正是 #2814
  「两道墙从外面看应当一样」的反面。

  现在两处失败分支都先识别信封上的 `TOO_MANY_REQUESTS:` **前缀**,改抛
  `APIError('TOO_MANY_REQUESTS')`:

  - **只有码跨包**。识别用的 `TOO_MANY_REQUESTS` 在 plugin-auth 本地写死并注明出处
    (`SMS_QUOTA_EXCEEDED_CODE`,`packages/services/service-sms/src/sms-daily-quota.ts`)——
    `@objectstack/service-sms` 已经依赖本包(它的日计数器从这里 import
    `InProcessCounterStore`),反向 import 会成环;这与 service-sms 里
    `normalizeSmsRecipient` 就地重述 plugin-auth 形状规则是同一个取舍的另一半。
    跨包重述的只是一个 ADR-0112 闭集错误码,冒号后的措辞归服务层所有,可以自由改写。
  - **不泄露预算**。429 文案沿按号码闸的措辞形状,不含上限、剩余量与重置时刻
    (按号码闸报自己的重试窗口,是因为它算得出;配额闸不承诺它给不出的时间)。
  - **不顺手收紧**。传输故障(provider 宕机等)仍抛普通 `Error`,500 语义原样不变;
    仅仅在文中提到该码而不以之开头的 provider 报错同样保持 500。

  对外可见的变化:`POST /phone-number/send-otp`、
  `POST /phone-number/request-password-reset` 在部署日配额耗尽时,由
  **500 + 空响应体**变为 **429 TOO_MANY_REQUESTS**,与按号码冷却闸同形。
  邀请短信路径同样返回 `APIError`;仓内唯一调用方(admin import-users)按行捕获它并
  记为 `INVITE_SMS_FAILED`,该路径的变化是行内报错不再携带服务层原始信封。

- 2c81b92: Pin the credential-at-rest posture for `sys_scim_provider.scim_token` and `sys_oauth_application.client_secret`.

  Both columns already store a one-way SHA-256 digest, but nothing held them there: no test referenced `storeSCIMToken` or `storeClientSecret` anywhere in the repo, and `@better-auth/scim`'s own default is `storeSCIMToken: 'plain'` — cleartext. A single option literal in `auth-manager.ts` was the only thing keeping a live IdP bearer out of a column that is readable over the generic data API.

  The new pin drives `AuthManager`'s own plugin construction (not a hand-written `scim({ storeSCIMToken: 'hashed' })`, which would have certified the very regression it exists to catch), reads the stored row back at driver level, and asserts the digest relationship recomputed independently with `node:crypto` — including the negative case that the digest of the full bearer does not match, since the stored value covers only the inner base token decoded out of it.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

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

- e5fd28c: fix(plugin-auth): honour better-auth's `Where.mode`, and normalise the identifier SCIM matches on (#5814)

  better-auth's `Where` carries a fourth field — `mode?: "sensitive" | "insensitive"`,
  `@default "sensitive"` — and `convertWhere()` in the ObjectQL adapter read `field` /
  `operator` / `value` and nothing else. The default covers almost every caller, so the
  drop was invisible; the caller it is not invisible for is the one that explicitly asked.

  `@better-auth/scim` is that caller. SCIM's `userName` is case-insensitive by RFC 7643
  (`caseExact: false`), so a `filter=userName eq "Alice@example.com"` reaches this adapter
  as `{ field: 'email', operator: 'eq', mode: 'insensitive' }`. With `mode` unread, whether
  it matched a user stored as `alice@example.com` came down to how the driver under the
  auth path happens to compare strings — and because SCIM provisioning is "look up, create
  if absent", a missed match did not raise an error, it provisioned a **second user**.
  Only deployments that turned SCIM on (`OS_SCIM_ENABLED`, off by default) were exposed.

  Both halves of the fix, per the maintainer's ruling on #5814:

  - **Normalisation, not new vocabulary.** `sys_user.email` — the field SCIM's `userName`
    maps onto — is now stored lower-cased and compared lower-cased by this adapter. An
    insensitive lookup lower-cases its comparand, which is an _exact_ match against the
    stored form, so nothing in the query vocabulary changes. The set is a declared table
    (`NORMALISED_IDENTIFIER_FIELDS`), not a name heuristic, and it drives the read and
    write halves from one place so a field cannot be added to one of them only.
  - **The silent drop ends.** `convertWhere()` handles `mode` explicitly. On a normalised
    identifier the request is satisfied by construction. On **any other** field, a
    `mode: 'insensitive'` clause now emits a loud warning naming the model, the field and
    the operator, and stating that the query is being answered case-sensitively — instead
    of answering a different question and looking fine doing it. It deliberately does not
    throw: refusing here would turn an occasional duplicate user into "`userName` queries
    entirely unavailable", which is the worse trade on an authentication path.

  No migration ships and none is needed. Every existing write path already lower-cased
  `user.email` before reaching the adapter (better-auth's own `internalAdapter` does it on
  `createUser` / `createOAuthUser` / `updateUser` / `updateUserByEmail`, and SCIM's create
  path does it again), so the write half changes no existing behaviour — it moves the
  invariant the read half depends on into the layer that depends on it, instead of
  inheriting it from an internal of a prerelease dependency. Queries that do not set
  `mode`, or set it to `"sensitive"`, keep their comparand byte-for-byte: folding case
  unasked would be the same failure in the opposite direction.

  Adding a case-insensitive equality operator (`$ieq`) was deferred until there is
  demonstrated pull for it, and downgrading `eq + insensitive` to `$icontains` was
  rejected — containment is not equality.

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

- b40f81c: docs(plugin-auth): the session of record is always `sys_session` — cache backs rate-limit counters only (#4785)

  Settles an architectural question that had been answered two different ways by
  the code and the docs. **Nothing about the runtime changes**: this records the
  decision, proves the behaviour that depends on it, and corrects the docs that
  described the road not taken.

  **The decision.** ObjectStack's session of record is always the `sys_session`
  table. The kernel `cache` service serves authentication as the ADR-0069 D2
  rate-limit counter store and nothing else. It is never bound as better-auth's
  `secondaryStorage`, because that option is not a counter store — handing
  better-auth one also relocates sessions into it (`createSession` skips the
  `sys_session` row; `findSession` answers from the cached snapshot without
  reading the database). ADR-0069 D4's three session controls — idle timeout,
  absolute lifetime, concurrent-session cap — all revoke by writing that row, so a
  cache-backed session store would silently disable every one of them. Dual-writing
  (`session.storeSessionInDatabase: true`) was considered and rejected as the worst
  of the options: the row exists, so the controls _appear_ to work, while the read
  path still answers from the cache.

  **Why this needed settling rather than just fixing.** The conflict had never
  fired — the cache lookup that would have wired `secondaryStorage` ran before the
  cache service registered, so the binding never took in a standard composition.
  The declaration and the runtime disagreed for a month and no test could tell,
  because no test asserted that a D4 control ends a _live session_; they asserted
  at most that a row got stamped. A stamped row nobody reads is exactly the failure
  mode in question.

  **What is new.** `session-of-record.test.ts` drives the real better-auth pipeline
  end to end and proves each of the three D4 controls actually de-authenticates a
  live session cookie — not that a column was written. It also pins the
  counter-factual: with a `secondaryStorage` bound, `sys_session` stays empty and
  the idle timeout never fires. Two facts that make the guarantee hold for real
  deployments are pinned with it — `AuthManager` does not plumb
  `storeSessionInDatabase`, so the rejected dual-write shape is unreachable through
  configuration; and the default composition (OIDC provider on) makes better-auth
  _refuse to boot_ with a `secondaryStorage` rather than degrade quietly.

  **For hosts.** `cacheSecondaryStorage()` remains exported for anyone who wants
  better-auth's cached session store deliberately. It now says plainly what it
  costs: opting in disables the ADR-0069 D4 session controls, and a revoked session
  stays usable until its cached copy expires. Moving sessions into the cache
  platform-wide would be a new decision requiring its own revocation-consistency
  requirements, not a configuration change.

  ADR-0069's D2 "shared store" is scoped to rate-limit counters, D4 records
  `sys_session` as a precondition rather than a deployment preference, and the
  `ICacheService` contract page no longer lists session storage among the cache's
  uses.

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

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

- ef8b1ff: fix(plugin-auth): `/sso/register` 的管理员门禁改用唯一那把等级尺,不再手抄一份大小写敏感的判据 (#5942)

  ADR-0024 的 `POST /sso/register` 门禁问的是「这个 membership 是不是本组织的管理员」。
  它此前用的是一份手抄判据:

  ```ts
  raw
    .split(",")
    .map((s) => s.trim())
    .some((r) => r === "owner" || r === "admin");
  ```

  同一个问题在 plugin-auth 内还有另一把尺 —— `invitation-role-cap.ts` 的等级尺
  (`parseOrgRoles()` 会 `.trim().toLowerCase()`,`isOrgAdminGrade()` 据此评级),
  break-glass ban 守卫(`last-admin-ban-guard.ts`,ADR-0024 D5.2)用的就是它。
  两把尺在大小写上不一致:`sys_member.role` 若存成 `Owner` / `ADMIN`,ban 守卫把这一行
  算作**管理员**,而 `/sso/register` 门禁算作**非管理员**。同一条安全路径上的两个答案
  互相矛盾,而且两个方向的错都不出声。

  现在门禁改问 `isOrgAdminGrade(m.role)` —— 「哪种 membership 算管理员」在 plugin-auth
  内只剩一个答案,两处自此同尺。

  **用户可见的行为变化,只有一个方向:放宽,且只放宽在此前判错的取值上。**
  `sys_member.role` 为大小写非常规值(`Owner` / `ADMIN` / `Admin`,以及
  `member,Owner` 这类逗号拼写)或数组拼写(`['owner']`)的成员,此前会被
  `/sso/register` **误拒**,现在正确判为管理员并放行。**没有任何收窄**:此前被判为管理员
  的取值,换尺后仍然是管理员(已逐值实测,见 PR)。

  ADR-0108 的封闭词表(`owner` / `admin` / `delegated_admin` / `member`)全为小写,UI 与
  better-auth 写入的也是小写,所以正常部署下答案逐值不变 —— 这也是为什么它此前只是一条
  静默分歧,而不是线上故障。要撞上分歧得有一条绕过表单的写入(导入、外部写入、手工 SQL)。

  `isOrgOrPlatformAdmin` 名字里的 platform_admin 半边**未改动**,仍由
  `packages/core/src/security/resolve-authz-context.ts` 权威推导;那几处实现的合流是
  另一个决策件。

- cde1975: fix(dev): eliminate three fixed startup log warnings so official examples boot clean (#3420)

  `os dev` on the stock showcase printed three fixed noise sources on every boot,
  with zero example-side changes — training users to ignore warnings.

  - **spec** — add a field-level `ackPlaintextMasking: true` opt-out for the
    generic `password` author-time warning (ADR-0100). A deliberately-masked
    field (like field-zoo's `f_password`) can now affirm intent instead of
    printing an un-actionable "safe to ignore" on every boot; the warning text
    points authors at the flag.
  - **plugin-auth** — pass better-auth's documented
    `silenceWarnings.oauthAuthServerConfig` to `oauthProvider(...)`. We already
    mount the `/.well-known/oauth-authorization-server` documents ourselves at
    the issuer root, so the plugin's "please ensure it exists" reminder was a
    false positive (printed twice); silencing it removes both.
  - **objectql** — route the Registry's re-register / package-overwrite lines
    (normal rebuild / HMR / seed-replay paths) through a new debug-only
    `SchemaRegistry.debug()` so they stay out of the default `info` boot log. Adds
    a `logLevel` construction option (and matching `OS_REGISTRY_LOG` env var) so
    the debug-gated housekeeping is discoverable for troubleshooting.

- c03108c: fix(auth): a degraded tenancy posture must not hand out a default organization

  `TenancyService.defaultOrgId()` documented "returns `null` under any walled
  posture", but the implementation keyed on the posture actually **in force**
  (`isolationActive()`) rather than the one the operator **requested**. Those two
  disagree in exactly one state — DEGRADED: a deployment that asked for `group`
  or `isolated` and could not enforce it (the enterprise `@objectstack/organizations`
  package is absent) reports `posture: 'single'`, and the resolver then happily
  answered with "the `slug='default'` org, or the only org that exists".

  Everything downstream of that resolver binds new users to whatever it returns.
  The membership reconciler (ADR-0093 D2) runs on `user.create.after` — the seam
  every creation path flows through — so in a degraded deployment **every fresh
  signup, admin-created user and SSO JIT user was auto-bound as a `member` of
  whichever organization happened to be resolvable**, and `backfillMemberships`
  (D6) would sweep the pre-existing member-less ones in on the next
  `kernel:ready`.

  This reached production. ObjectStack Cloud's control plane runs
  `OS_MULTI_ORG_ENABLED=true` while deliberately not mounting the enterprise
  package — it enforces its own control-plane org wall instead — so the
  `org-scoping` probe missed, the posture resolved degraded, and self-serve
  signups landed inside a stranger's organization with read access to that org's
  environments (cloud#957).

  `defaultOrgId()` now keys on `requestedPosture`: any walled request, enforced or
  degraded, returns `null` and the framework never guesses. This is the same
  judgement D6 already applies to the backfill — "a wrong org in a tenant-isolated
  deployment is a data-exposure bug, not a convenience" — applied to the resolver
  those consumers share. It also makes the resolver agree with the default-org
  bootstrap in `AuthPlugin.start()`, which was already gated on the requested
  posture.

  Single-org deployments are unaffected: nothing about `requested: 'single'`
  changes. A degraded deployment loses the auto-bind, which is the point — and
  ADR-0093 D5 already refuses to boot that deployment at all unless the operator
  sets `OS_ALLOW_DEGRADED_TENANCY=1`.

- 414083c: Correct `sys_user.phone_number`'s ownership and widen the ADR-0105 D7 collision guard's plugin derivation.

  `phone_number` was declared as an ObjectStack extension field in
  `MANAGED_EXTENSION_FIELDS` while `auth-schema-config.ts` has shipped the explicit
  `phoneNumber -> phone_number` mapping since better-auth's phone-number plugin was
  wired in, so better-auth writes that exact column whenever the plugin is enabled.
  The entry is removed: the mapping is the ownership evidence. No write surface
  changes — the field was never in `MANAGED_EXTENSION_EDITABLE_FIELDS`, and the
  admin bulk-import path that does upsert it runs under a system context off its
  own field list.

  The reason D7 never reported this overlap is the second half: it derived
  better-auth's owned columns from a single plugin (`organization`) while the auth
  manager assembles fourteen. The derivation now loads the auth manager's whole
  set, on the reason the sibling parity gate already records — a plugin that is
  feature-flagged off in some deployments still owns its columns, because the
  column has to exist before the flag can be turned on. A drift tripwire reconciles
  the set against `auth-manager.ts`'s imports so a plugin added there cannot stay
  outside the guard, and the collision rule is now pinned in the red direction
  against a synthetic registry, not only the green one.

- c797473: `POST /api/v1/auth/organization/remove-member` now answers a permission denial
  as `403 YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER`, matching its sibling
  endpoints (`organization/update-member-role`, `organization/update`,
  `organization/delete`, `organization/invite-member`).

  It previously answered `400 YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`
  — a message whose every clause could be false at once: the caller was not
  leaving, was not an owner, and the organization could hold any number of owners.
  better-auth orders its "only an owner may remove an owner" rule ahead of the
  route's real permission check and reports it with the sole-owner invariant's
  code and status, so the invariant answered a question it was never asked. The
  removal itself was always correctly refused; only the response was wrong.

  The genuine sole-owner refusal is unchanged and still fires when a sole owner
  removes themselves or calls `organization/leave`, and every legitimate
  owner-removes-owner / owner-removes-member path still returns `200`.

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

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
- Updated dependencies [c36abfe]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [2f6516e]
- Updated dependencies [9b6fe7c]
- Updated dependencies [64cd010]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [3c8cfd1]
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
- Updated dependencies [f92096b]
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
- Updated dependencies [59768f7]
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
- Updated dependencies [fccec22]
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
- Updated dependencies [1003125]
- Updated dependencies [12a19a8]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [3f86a57]
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
- Updated dependencies [fae74b5]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e650d67]
- Updated dependencies [121852d]
- Updated dependencies [04476e7]
- Updated dependencies [de6b7f1]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [3949a43]
- Updated dependencies [0a515c8]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [be25f97]
- Updated dependencies [48c110e]
- Updated dependencies [87aca93]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [366105c]
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
- Updated dependencies [c20b875]
- Updated dependencies [7c7e246]
- Updated dependencies [f4d7f1d]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [2a37694]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [fec7848]
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
- Updated dependencies [76682cb]
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
- Updated dependencies [96d3d4d]
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
- Updated dependencies [f598aa8]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [d2d6e4c]
- Updated dependencies [ce1f100]
- Updated dependencies [9b9b70f]
- Updated dependencies [f0d6594]
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
- Updated dependencies [05d8a54]
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
- Updated dependencies [d9cac60]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
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
- Updated dependencies [284e7d2]
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
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [a92b179]
- Updated dependencies [c3f4916]
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [9fd9ae7]
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
- Updated dependencies [465c5fc]
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
- Updated dependencies [07383fe]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [99b4392]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [870f90c]
- Updated dependencies [6ceffe0]
- Updated dependencies [667192b]
- Updated dependencies [2f59da0]
- Updated dependencies [8aacf94]
- Updated dependencies [83a3b1f]
- Updated dependencies [2443bb4]
- Updated dependencies [d56012f]
- Updated dependencies [623d008]
- Updated dependencies [495019b]
- Updated dependencies [54adb1f]
- Updated dependencies [73648ba]
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
- Updated dependencies [7bc02f4]
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
- Updated dependencies [3a27c46]
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
- Updated dependencies [75f82f3]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [b4b2c7d]
- Updated dependencies [2ee1ab9]
- Updated dependencies [2934761]
- Updated dependencies [b295e4b]
- Updated dependencies [61ea810]
- Updated dependencies [a3c0865]
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
- Updated dependencies [be7945a]
- Updated dependencies [d586366]
- Updated dependencies [54fe9d5]
- Updated dependencies [3ac243a]
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
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [16adb3c]
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
- Updated dependencies [91cefb8]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [e98c9d3]
- Updated dependencies [32ff033]
- Updated dependencies [af5918b]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [2c2a212]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [39396bd]
- Updated dependencies [577cd27]
- Updated dependencies [f690747]
- Updated dependencies [bbd902d]
- Updated dependencies [773f80a]
- Updated dependencies [5897552]
- Updated dependencies [d6f3f2f]
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [dd5daac]
- Updated dependencies [5ac93d4]
- Updated dependencies [2efd2c9]
- Updated dependencies [f3f855a]
- Updated dependencies [3d5f726]
- Updated dependencies [695cfbd]
- Updated dependencies [91ec1ea]
- Updated dependencies [2d25303]
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
- Updated dependencies [b03b0e1]
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
- Updated dependencies [0931185]
- Updated dependencies [cc3555e]
- Updated dependencies [f8fe47e]
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
- Updated dependencies [422e97b]
- Updated dependencies [7e04fd0]
- Updated dependencies [d318b24]
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
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [1216dcc]
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
- Updated dependencies [be90dea]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [2a18012]
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
- Updated dependencies [ec5a125]
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
- Updated dependencies [90fa077]
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
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/rest@17.0.0
  - @objectstack/types@17.0.0

## 17.0.0-rc.6

### Minor Changes

- 1fa224a: feat(plugin-auth): the fixed-window counter gets its own `./rate-limit-storage` entry (#6040)

  `rate-limit-storage.ts` is the repo's ONE fixed-window counter —
  `incrementFixedWindow` / `createLazyCounterStore` / `InProcessCounterStore`,
  ADR-0069 D2 — and #4790's cross-reference asks later arrivals to reuse it
  rather than write a third copy. They did, and from outside auth:
  `@objectstack/runtime` counts inbound requests and endpoint policy through it,
  and `@objectstack/service-sms` counts its daily SMS budget through it (#2814).

  `@objectstack/plugin-auth` published exactly one entry, `"."`, whose `export *`
  chain takes **value** imports on `better-auth/adapters`
  (`objectql-adapter.ts`) and `@better-auth/core/db` (`backfill-account-issuer.ts`).
  Value imports are evaluated eagerly, so reaching those ~90 lines of counting
  loaded `better-auth` + `@better-auth/{core,oauth-provider,scim,sso}` + `jose` +
  `@noble/hashes` + `@objectstack/rest` + `@objectstack/platform-objects` first.
  Measured against the built package: `require('@objectstack/plugin-auth')` puts
  109 modules in `require.cache`; the counter needs one.

  So the counter is now published on its own:

  ```ts
  // before — 109 modules, the whole better-auth family
  import { incrementFixedWindow } from "@objectstack/plugin-auth";
  // after — 1 module, 3.7 KB
  import { incrementFixedWindow } from "@objectstack/plugin-auth/rate-limit-storage";
  ```

  `tsup` emits the second entry with `splitting: false`, so it is a self-contained
  bundle rather than a nominal split: `dist/rate-limit-storage.mjs` is 3.71 KB
  against `dist/index.mjs`'s 330.28 KB, contains zero top-level imports and zero
  occurrences of the string `better-auth`. The one better-auth reference that
  survives is `import type { BetterAuthRateLimitStorage }`, which is erased at
  build and costs a consumer nothing at runtime.

  **Nothing is removed.** The root still re-exports every one of these symbols, so
  existing `@objectstack/plugin-auth` imports keep working unchanged — this is a
  new entry point, which is why it is `minor` rather than breaking. The `patch` on
  `runtime` and `service-sms` is the import-specifier switch in those packages;
  their behaviour is identical.

  `src/rate-limit-storage-isolation.test.ts` pins the invariant from both sides,
  in the shape `packages/types/src/node-isolation.test.ts` (#4700) established for
  the `./node` split: it walks the real import graph from the subpath entry and
  fails on any better-auth **value** import or any undeclared external package,
  it fails if a consumer reaches the counter through the package root again, and
  it fails if the root ever _stops_ pulling better-auth eagerly — because at that
  point the split stopped buying anything and deserves re-measuring rather than a
  suite that passes for the wrong reason.

### Patch Changes

- ea1d916: fix(plugin-auth): keep the last-administrator guard exact when `before*` hooks fire per row (#5574)

  The break-glass guard resolved a write's target set as "a scalar `input.id` if
  there is one, otherwise the caller's predicate". That was sound only because a
  predicate (`multi: true`) write's `before*` dispatch left `input.id`
  present-but-**undefined**. ADR-0058 Addendum II makes the `before*` phase fire
  once per MATCHED ROW, each context naming its own row — so read that way, a
  `multi` ban of every administrator arrives as N separate by-id bans, each of
  which is legitimately allowed (banning one admin out of three leaves two), and
  the batch locked the environment out with no refusal anywhere.

  `resolveTargetIds` now asks `options.multi` FIRST: on a predicate write the
  target set is the caller's predicate, whichever row the current dispatch names;
  the id is consulted only when the write really is by-id. `input.options` is the
  caller's bag during `before*` — `where` and `multi` included — and the contract
  preserves that deliberately, so the discriminator the guard needs is unchanged.

  All eight guarded halves (#5892 ban, #5941 delete, #5978 standing) are covered
  by the existing predicate cases, which went red on the engine change and are now
  the pin that a population-scoped invariant survives being asked one row at a
  time.

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

- e5fd28c: fix(plugin-auth): honour better-auth's `Where.mode`, and normalise the identifier SCIM matches on (#5814)

  better-auth's `Where` carries a fourth field — `mode?: "sensitive" | "insensitive"`,
  `@default "sensitive"` — and `convertWhere()` in the ObjectQL adapter read `field` /
  `operator` / `value` and nothing else. The default covers almost every caller, so the
  drop was invisible; the caller it is not invisible for is the one that explicitly asked.

  `@better-auth/scim` is that caller. SCIM's `userName` is case-insensitive by RFC 7643
  (`caseExact: false`), so a `filter=userName eq "Alice@example.com"` reaches this adapter
  as `{ field: 'email', operator: 'eq', mode: 'insensitive' }`. With `mode` unread, whether
  it matched a user stored as `alice@example.com` came down to how the driver under the
  auth path happens to compare strings — and because SCIM provisioning is "look up, create
  if absent", a missed match did not raise an error, it provisioned a **second user**.
  Only deployments that turned SCIM on (`OS_SCIM_ENABLED`, off by default) were exposed.

  Both halves of the fix, per the maintainer's ruling on #5814:

  - **Normalisation, not new vocabulary.** `sys_user.email` — the field SCIM's `userName`
    maps onto — is now stored lower-cased and compared lower-cased by this adapter. An
    insensitive lookup lower-cases its comparand, which is an _exact_ match against the
    stored form, so nothing in the query vocabulary changes. The set is a declared table
    (`NORMALISED_IDENTIFIER_FIELDS`), not a name heuristic, and it drives the read and
    write halves from one place so a field cannot be added to one of them only.
  - **The silent drop ends.** `convertWhere()` handles `mode` explicitly. On a normalised
    identifier the request is satisfied by construction. On **any other** field, a
    `mode: 'insensitive'` clause now emits a loud warning naming the model, the field and
    the operator, and stating that the query is being answered case-sensitively — instead
    of answering a different question and looking fine doing it. It deliberately does not
    throw: refusing here would turn an occasional duplicate user into "`userName` queries
    entirely unavailable", which is the worse trade on an authentication path.

  No migration ships and none is needed. Every existing write path already lower-cased
  `user.email` before reaching the adapter (better-auth's own `internalAdapter` does it on
  `createUser` / `createOAuthUser` / `updateUser` / `updateUserByEmail`, and SCIM's create
  path does it again), so the write half changes no existing behaviour — it moves the
  invariant the read half depends on into the layer that depends on it, instead of
  inheriting it from an internal of a prerelease dependency. Queries that do not set
  `mode`, or set it to `"sensitive"`, keep their comparand byte-for-byte: folding case
  unasked would be the same failure in the opposite direction.

  Adding a case-insensitive equality operator (`$ieq`) was deferred until there is
  demonstrated pull for it, and downgrading `eq + insensitive` to `$icontains` was
  rejected — containment is not equality.

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
- Updated dependencies [de6b7f1]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [fec7848]
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
- Updated dependencies [53ef057]
- Updated dependencies [4856789]
- Updated dependencies [a92b179]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [465c5fc]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [07383fe]
- Updated dependencies [59c544d]
- Updated dependencies [870f90c]
- Updated dependencies [2f59da0]
- Updated dependencies [83a3b1f]
- Updated dependencies [2443bb4]
- Updated dependencies [623d008]
- Updated dependencies [73648ba]
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
- Updated dependencies [2934761]
- Updated dependencies [b295e4b]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [d586366]
- Updated dependencies [54fe9d5]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [91cefb8]
- Updated dependencies [2c2a212]
- Updated dependencies [773f80a]
- Updated dependencies [f3f855a]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [f8fe47e]
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
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/rest@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6
  - @objectstack/types@17.0.0-rc.6

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
  - @objectstack/platform-objects@17.0.0-rc.5
  - @objectstack/rest@17.0.0-rc.5
  - @objectstack/types@17.0.0-rc.5

## 17.0.0-rc.4

### Major Changes

- de113a4: BREAKING(auth): `organization/create` 改判**实际生效的** tenancy posture —— 没有组织墙的部署不再能创建组织 (#5261)

  `POST /api/v1/auth/organization/create` 的闸门此前判的是操作者**请求的** posture
  (`postureEnforcesWall(resolveTenancyPosture())`,一次纯 env 读)。现在判 `tenancy` 服务给出的
  **生效** posture —— `tenancy?.posture ?? resolveTenancyPosture()`,与 `/auth/config` 的
  `features.multiOrgEnabled` 是**同一次求值**。

  ## 为什么

  两个站点此前只在一种形状下分叉,而那种形状恰恰是最不该放行的一种 —— ADR-0093 D5 **降级态**:
  请求了 `isolated`/`group`,但企业包 `@objectstack/organizations` 缺席,于是 `tenancy.posture`
  解析为 `single` 且 `degraded=true`。此时:

  - 闸门读「请求」→ **放行**;
  - `/auth/config` 读「生效」→ `multiOrgEnabled=false`,console 把「创建组织」入口**藏起来**。

  结果是 UI 没有按钮而 API 打得通,并且建出来的每一个组织都是**没有任何引擎强制的租户边界** ——
  声明了但没强制,ADR-0049 最讨厌的那一类,只不过发生在部署层。改判生效 posture 之后两者同解、
  永不分叉:**没有墙,就没有组织**,无论这个部署是从未要过墙,还是要了没拿到。

  ## 破坏性影响(有意为之)

  **没有安装企业包 `@objectstack/organizations` 的部署将完全无法创建组织**,任何 env 组合都不行 ——
  `OS_TENANCY_POSTURE=isolated`、`OS_MULTI_ORG_ENABLED=true`、两个一起设,都不再能把闸门说通。
  这是一次实打实的能力收缩,不是 knob 纠正,所以搭 v17 主版本车。

  | 部署形状                                          | 改前   | 改后          |
  | ------------------------------------------------- | ------ | ------------- |
  | 有企业包,posture `isolated` / `group`(墙真的立着) | 200    | **200**(不变) |
  | **请求了墙但企业包缺席(D5 降级态)**               | 200    | **403** ⚠️    |
  | `single` / 两个 knob 都不设                       | 403    | 403(不变)     |
  | 未注册 `tenancy` 服务的精简嵌入(回落 env 解析)    | 按 env | 按 env(不变)  |

  `serve.ts` 本来就在降级态**默认拒绝启动**(要 `OS_ALLOW_DEGRADED_TENANCY=1` 才走),所以这条收缩
  命中的是一个已经需要显式选择才能到达的形状:从此那里的 org-create 路由也一并拒绝,而不是半通不通。
  cloud 控制面与任何装了企业包的部署不受影响。

  **迁移**:需要多组织能力的部署安装并声明 `@objectstack/organizations`(ADR-0081 D2)。仅靠 env
  声明一个墙、而没有实现它的运行时,不再被当作多组织部署对待。

  ## `@objectstack/verify`(minor,新增)

  `BootOptions.multiTenant` 增加 `'posture-only'` 取值:注册一个内置的 `org-scoping` 服务替身,
  让 `tenancy` 服务解析出真实、**非降级**的 `isolated` posture,从而打开受 posture 把守的路由 ——
  供那些「组织墙是**前置条件**而非被测对象」的 fixture 使用(#3624 的 `org-create-default-team`
  dogfood 就是为它而建:那条回归此前靠「boot 后翻 env、闸门 live 读」开路,本次收缩把这个绕法关死了)。

  ⛔ 它**不做任何租户隔离**:不 stamp `organization_id`,不 scope 任何查询 —— 它让部署的
  **posture** 为真,不是让**墙**为真。跨租户隔离的唯一诚实证明仍然是 `multiTenant: true` +
  真实的企业包,这也是那些 gate 在本仓继续 skip 而不是假装通过的原因。

### Minor Changes

- 7cf1531: fix(auth): an unrecognised membership policy is refused by both reconcilers, not auto-bound by one of them (#5205)

  **The sign-up path used to bind anyway.** `reconcileMembership` and
  `backfillMemberships` — both public exports of `@objectstack/plugin-auth` — read
  the same `policy` field and judged it with opposite predicates. Sign-up tested
  `policy === 'invite-only'`, so any _other_ value fell through to the `auto`
  branch and auto-bound the new user; the backfill tested `policy !== 'auto'` and
  refused. One input, two opposite postures, and the fail-open half was the one
  that runs per sign-up. A caller who wrote `'inviteOnly'` — or any host passing
  the policy from JavaScript, past the `MembershipPolicy` type — got auto-binding
  while believing they had switched it off, with nothing in the logs to say so.

  Both entry points now check `isMembershipPolicy()` before any policy semantics
  and refuse: nothing is bound, and the refusal names the offending value at
  `error` level (and on the returned result, so it survives a caller that passed
  no logger). This is the posture #5152 took one layer up at the settings
  boundary — an unrecognised value is rejected loudly, never coerced to `auto`.

  **Contract change — `ReconcileOutcome` gains `'invalid-policy'`, and
  `BackfillMembershipsResult.reason` gains the same member.** Both are exported
  types, so a consumer that switches exhaustively over them (a `never`-checked
  `default`, or a `Record< ReconcileOutcome, … >`) must handle the new member.
  The new verdict is deliberately _not_ a reuse of the existing `policy-skip` /
  `'policy'`: those mean "a valid policy said no", and reporting them for "this
  is not a policy" sends whoever is debugging a missing bind to inspect a
  deployment setting that is fine. `BackfillMembershipsResult` also gains an
  optional `error?: string`, and the `logger` shape on `ReconcileMembershipDeps`
  gains an optional `error?` method (it falls back to `warn`).

  **No behaviour change for the two real policies.** `auto` binds and
  `invite-only` skips exactly as before, on both paths — the framework's own
  callers resolve the policy through `AuthManager.getMembershipPolicy()`, whose
  return type is `MembershipPolicy`, so nothing on a supported path can reach the
  new branch. This closes the dormant divergence on the export surface.

- 586d6f7: feat(auth): `membership_policy` is a platform setting, and sign-up and backfill read one source (#5152)

  **What a new user joins is now configurable at runtime.** ADR-0093's
  `membershipPolicy` decides whether a freshly created user is auto-bound to the
  deployment's default organization (`auto`) or gets membership only from an
  explicit act — creating a workspace, accepting an invitation, an admin adding
  them, SSO just-in-time provisioning (`invite-only`). Until now it was settable
  **only** as an `AuthPlugin` constructor option, and the AuthPlugin a self-hosted
  stack gets is injected by the CLI, which passes no such option and has no env
  fallback. Every self-hosted deployment therefore ran `auto`, with no way to say
  otherwise. `invite-only` was, in practice, unreachable outside a custom host.

  It is now `auth.membership_policy` in the platform settings — a two-value select
  (`auto` / `invite-only`, default `auto`) alongside `signup_enabled`, which it
  pairs with: one says whether people may self-register, the other says what they
  join when they do. Set it in Setup → Authentication → Membership, or pin it
  per-deployment with `OS_AUTH_MEMBERSHIP_POLICY`. It applies **without a
  restart** — the existing `settings.subscribe('auth', …)` re-application seam
  carries it, the same one the password-policy keys ride.

  **No behaviour changes unless you set it.** Only an _explicit_ value applies;
  the manifest's `auto` default is a UI default and never masks a deployment that
  configured the policy in code. A stack that sets nothing keeps today's
  auto-binding exactly.

  **Bug fix — the two membership paths read one source.** Sign-up (the reconciler
  in better-auth's `user.create.after`) read the AuthManager's live config, while
  the ADR-0093 D6 backfill of pre-existing member-less users read the plugin's
  **constructor options**. Wiring a setting to the first and not the second would
  have produced "sign-up honours the new policy, backfill still runs the old one"
  — and the backfill binds in **bulk**, so it is the more dangerous half. Both now
  resolve the policy through the new `AuthManager.getMembershipPolicy()`, and the
  backfill waits for the settings namespace to bind before its first pass (the two
  `kernel:ready` hooks fire in registration order, which was the wrong order).

  **An invalid value is rejected, not coerced.** `PUT /api/settings/auth` refuses
  a policy outside the declared option table (`invalid_option`, naming the allowed
  set). A value arriving from `OS_AUTH_MEMBERSHIP_POLICY` — which bypasses that
  validation — is logged at `error` and **ignored**, leaving the deployment's
  current policy in force; it is never silently read as `auto`, because that would
  leave an operator believing a wall is up while every sign-up is auto-bound.

  New public API on `@objectstack/plugin-auth`: `AuthManager.getMembershipPolicy()`,
  plus `MEMBERSHIP_POLICIES` and `isMembershipPolicy()` from `reconcile-membership`.

- 61dc08e: feat(plugin-auth): break-glass — a ban may never leave the environment with zero administrators (#5892)

  `sys_user.banned = true` is where every deprovision lands: better-auth's admin
  plugin writes it, and `@better-auth/scim` maps a SCIM `active: false` onto that
  same admin ban. Nothing checked what the write left behind — so **banning the
  last administrator was allowed, reported success, and locked the organization
  out of its own environment permanently.** SCIM makes that a realistic accident
  rather than a hypothetical one: the write is driven by an external system, so
  nobody reads the payload before it commits, and one mis-scoped IdP group is
  enough.

  **New guard (`last-admin-ban-guard.ts`, cloud ADR-0024 D5.2).** A `beforeUpdate`
  hook on `sys_user` refuses any write that turns `banned` on when it would leave
  the environment with **no unbanned administrator**. It sits on the write, not on
  an endpoint, so it holds for the admin ban endpoint, the SCIM adapter write, an
  import, a script, and anything added later — by-id **and** predicate/`multi`
  writes alike.

  Who counts as an administrator is exactly what the rest of the platform already
  counts: a platform admin (an unscoped, in-window `admin_full_access` grant —
  the same evidence `resolveAuthzContext` derives `platform_admin` from) or an
  organization `owner`/`admin` membership. `delegated_admin` does not count
  (ADR-0105 D8: it can reach an endpoint, it carries no authority), an expired
  grant does not count, and the non-loginable `usr_system` account does not count.

  Three consequences worth knowing before you upgrade:

  - The refusal is a **403** carrying `PERMISSION_DENIED` and a message that names
    the user, the invariant, and the fix (grant someone else `admin_full_access`
    or an owner/admin membership first — and if an IdP drove the ban, the SCIM
    deprovision is too broad). On the auth pipeline it now surfaces as a proper
    `APIError` instead of an opaque 500.
  - It **fails closed**: if the administrator population cannot be read, or is too
    large to enumerate, the ban is refused rather than guessed at. The failure
    mode being prevented is a permanent lockout.
  - Writes that do not turn `banned` on — unbans, profile edits, re-banning an
    already-banned admin — are untouched, and so is banning anyone who is not an
    administrator.

  The other half of the same invariant (`enforced` SSO must never disable the last
  local admin's **password** — the escape hatch for an IdP outage) was already
  implemented and is now pinned by tests rather than reimplemented:
  `emailAndPassword.enabled` stays `true` under enforced SSO while sign-up is
  forced off, and the last local `credential` account still cannot be banned,
  removed or deleted.

- 8dcf607: feat(plugin-auth): break-glass — the last administrator cannot be DELETED either (#5941)

  #5892 closed the _ban_ half of ADR-0024 D5.2's break-glass invariant. The
  **delete** half was still open, and it was reachable end to end: in an enforced
  SSO environment the last administrator is typically IdP-managed and holds no
  local password, so when the IdP drops them from the admin group the resulting
  SCIM `DELETE /Users/{id}` (or `/admin/remove-user`, or `/delete-user`) removed
  the row and **left the environment with nobody able to administer it** — quite
  possibly with a password-holding non-admin still able to sign in and change
  nothing. There is no recovery path from inside the product once that happens.

  The pre-existing HTTP guard on those three endpoints did not cover it: it
  protects the last holder of a local `credential` account, so it skips the
  credential-less (IdP-managed) target entirely. It is unchanged and keeps
  enforcing its own invariant.

  **What changed.** The guard module now enforces one invariant on _both_ writes
  that can take the last administrator away, off one administrator enumeration:

  | write                       | hook                     |
  | :-------------------------- | :----------------------- |
  | `sys_user.banned = true`    | `beforeUpdate` (#5892)   |
  | deleting the `sys_user` row | `beforeDelete` (**new**) |

  The delete half is the ban half's twin in every property that matters: it sits
  on the **write**, so it holds for the SCIM adapter delete, better-auth's admin
  remove-user, an import and a script alike; it covers by-id **and**
  predicate/`multi` deletes (including the unpredicated `multi` that would empty
  the table); it applies to **every** context, `isSystem` included, because the
  deprovision path that actually locks organizations out is the system one; and it
  **fails closed** — an administrator population that cannot be read, or is too
  large to enumerate, refuses the delete rather than guessing.

  The refusal is a **403** carrying `PERMISSION_DENIED` and names the operation
  the caller actually attempted ("Refusing to delete 'usr\_…'"), the invariant
  (ADR-0024 D5.2), and the fix — grant someone else `admin_full_access` or an
  owner/admin membership first, and if an IdP drove it, the SCIM deprovision is
  too broad. On the auth pipeline it surfaces as an `APIError`, not an opaque 500.

  Untouched: deleting anyone who is not an administrator, deleting an
  administrator while another unbanned one remains, and deleting an administrator
  who is already banned (that account could not sign in either way).

  **Rename.** The module is now `last-admin-guard.ts` and the exported registration
  function is `registerLastAdminGuard` (was `last-admin-ban-guard.ts` /
  `registerLastAdminBanGuard`, added in the same unreleased cycle) — it registers
  both hooks, so the old name would have understated what it installs. Hosts that
  wire the guard onto their own ObjectQL engine rename the import; there is no
  other change to its signature or behaviour.

  Not covered, tracked separately (#5978): revoking the _standing_ that makes
  someone an administrator — deleting or downgrading their `sys_member` row,
  removing the `admin_full_access` grant — leaves the user row in place and writes
  a different table, so neither hook sees it.

### Patch Changes

- 7a40b7a: fix(plugin-auth): better-auth 的 `contains` 下译为 `$contains`,比较值不再当正则求值 (#5710)

  `convertWhere()` 把 better-auth 的 `contains` 译成 `{ field: { $regex: value } }`,
  于是一个**未转义、来自调用方**的比较值(`/admin/list-users` 的 `searchValue`、
  SCIM 过滤值)坐进了正则的**模式位**。它的含义随后端分叉:

  - `driver-memory` 用 `new RegExp(value)` 求值 —— `contains('a.b')` 命中 `axb`,
    `^x` 变成锚定,而值里一个不配对的 `(` 让模式非法(mingo 查询路径直接抛
    `SyntaxError`,参考匹配器则吞成静默零命中);
  - `driver-sql` / `driver-sqlite-wasm` / `driver-turso` 编成子串
    `LIKE '%value%'`(`%`/`_`/`\` 有转义、带显式 `ESCAPE`),元字符是字面量。

  同一个认证查询,在应用测试常用的内存替身上和生产的 SQL 后端上给出**不同答案**,
  且分叉发生在认证路径上。

  现在这一支发出 `$contains` —— 协议 `FILTER_OPERATORS` 里的算子,五后端都必须按
  **字面子串**求值,正是 better-auth `contains` 的本意(其 `Where.mode` 默认
  `"sensitive"`,与 #5701 Q2=A 裁定的 `$contains` 大小写敏感契约同向)。

  **对使用方的影响**:凭 `/admin/list-users?searchValue=…` 之类接口依赖「元字符按正则
  生效」的调用会改变结果 —— 那是本次修复的缺陷本身,不是可依赖的行为。搜索
  `a.b` 从此只命中含字面 `a.b` 的行,不再命中 `axb`;含非法正则字符的搜索值不再
  报错或静默返回空,而是按字面子串匹配。

- 2d14b35: fix(plugin-auth): `convertWhere()` 补齐 `not_in` / `starts_with` / `ends_with`,未识别算子改为响亮拒收 (#5813)

  `convertWhere()` 的分支链只覆盖 better-auth 十一个算子里的八个。
  `not_in` / `starts_with` / `ends_with` 落在链尾之外:**`filter` 里不写任何键**,
  不告警,链尾也没有 `else` 兜底。一个只带这类条件的 `where` 因此编成 `{}`。

  **丢谓词不是把结果变窄,是变宽 —— 而且发生在身份表上**(#3948 反复论证过的形状,
  driver-memory 的匹配器 `default:` 臂与 objectql 的 `having` 都为此改成了拒收):

  - `findMany` / `count` 变成**全表**(仅受 `limit` 截断)。已挂载的
    `GET /api/v1/auth/admin/list-users`(`auth-route-ledger.ts:161`)把查询参数直接
    推进 `where`,而 `searchOperator` 的枚举是 `contains | starts_with | ends_with`、
    `filterOperator` 的枚举**就是整张算子表**。于是
    `?searchValue=abc&searchOperator=starts_with` 返回的是「全部用户」而不是「以 abc
    开头的用户」,`?filterField=email&filterOperator=not_in&filterValue=…` 不排除任何人。
    管理台的用户检索是它的主要消费者。
  - `update` / `delete` / `consumeOne` / `incrementOne` 走的是「先 `findOne(filter)`
    再按 id 写」,`{}` 让 `findOne` 返回**任意一行**(实测是第一行),于是写到了错误的
    记录上。实测证据:对四行表执行「删除 `name` 以 `zed` 开头的用户」,修复前删掉的是
    `u_abc1`(第一行),不是 `u_zed`。

  ## 改了什么

  **一、三个算子按词表直译**(三个 ObjectQL 算子都在 `FILTER_OPERATORS` 里,
  五后端都必须求值):

  | better-auth   | ObjectQL      |
  | :------------ | :------------ |
  | `not_in`      | `$nin`        |
  | `starts_with` | `$startsWith` |
  | `ends_with`   | `$endsWith`   |

  大小写语义两侧同向,直译不开契约缝:better-auth 的 `Where.mode` 默认
  `"sensitive"`,`$startsWith` / `$endsWith` 按 #5701 Q2=A 在契约层也是大小写敏感。

  **二、链尾未识别算子响亮抛错**,不再静默丢。错误信息带算子名、字段名与受支持算子
  清单,本身就是操作指引。这是 restore-invariant:否则 better-auth 下次加算子时,
  这个洞会以完全相同的方式重开一次。

  ## 对使用方的影响

  - 用上述三个算子的查询**从「返回全表 / 写错行」变成「按谓词正确过滤」**。这是缺陷
    修复,不是可依赖行为的移除 —— 但依赖「`starts_with` 检索能列出全部用户」的脚本会
    看到结果变化。
  - 传入**词表之外**的算子从「静默忽略该条件」变成**抛错**。今天没有活体调用方能命中
    这一支(`/admin/list-users` 的两个参数都由 better-auth 自己的 zod 枚举把关),它面向
    的是将来:better-auth 长出第十二个算子时,查询会在第一次执行就失败,而不是悄悄放大。
    该分支同时是编译期哨兵(`never` 收敛),`pnpm --filter @objectstack/plugin-auth
typecheck` 会先一步报错。
  - `Where.mode: 'insensitive'` **不在**本次范围内,也不会被这条拒收波及 —— `mode` 是
    `operator` 的兄弟字段而非算子,今天仍被忽略(#5814,决策箱中)。

- 93929c2: fix(plugin-auth): break-glass 不变量补上第三条路径 —— 撤销「管理员身份」的写(`sys_member` 降级/删行、`admin_full_access` 授权删/改)同样被拒 (#5978)

  cloud ADR-0024 D5.2 的不变量是「环境永远至少留一个能登录的管理员」。此前它由两个引擎钩子守着,
  **都装在 `sys_user` 上**:`banned = true`(#5892 / PR #5939)与删 `sys_user` 行(#5941 / PR #5993)。

  但「谁是管理员」这件事根本不存在 `sys_user` 上 —— 它由另外两张表推导(`resolveAdminUserIds`
  正是从这两张表反向枚举的)。于是第三条写法完全绕开两个守卫:**用户行原封不动,把他的管理员身份拿掉**。

  - 把最后一个管理员的 `sys_member.role` 降到 admin 等级之下(better-auth 的 `updateMemberRole`、
    一次 SCIM 组映射变更、导入、脚本),或直接删掉那条 `sys_member` 行;
  - 删掉那条 `admin_full_access` 的 `sys_user_permission_set` 授权,或把它改到不再生效
    —— 改指向别的权限集、加上 `organization_id` 组织作用域、把 ADR-0091 有效期窗口改过去。

  三者事后状态与「删掉最后一个管理员」完全等价:所有人都还在,没有任何人能管理任何东西,
  产品内部无恢复路径。

  **新增的拒写语义。** 守卫现在按同一形状扩到 `sys_member` 与 `sys_user_permission_set` 的
  `beforeUpdate` / `beforeDelete`(共六个钩子,同 `packageId`、同 priority 20)。判据就是 issue 的原话
  ——**枚举、模拟、再枚举**:先枚举当前管理员,再把这次写落地后的行拿同一个枚举函数跑一遍,
  若第二次为空而第一次不为空则拒写。两次枚举是同一份实现,「谁是管理员」不可能对写前问题和写后问题
  给出两个答案。

  - **全覆盖,不是只拦自降级**:真正会发生的是 IdP 组映射改别人的角色,不是管理员给自己降级。
  - **谓词/批量写照判**:一次 `where` 命中多行的 update/delete 会先解析出整个匹配行集再做写后模拟,
    而不是一律拒绝;只有匹配集本身解析不出来(读失败,或超过 `maxScan`)才响亮拒写。
  - **fail-closed**:枚举失败或形状不确定一律拒写并点名 ADR-0024 D5.2,与既有两半同向。
  - 模拟是**单向**的 —— 只会拿走身份,不会授予身份(把 role 从 `member` 升到 `admin`、把授权改指向
    `admin_full_access` 这类写,模拟看不见新增的管理员),因此每一处取整都倒向「拒写」而非「放行」。

  **不拦的**:降级到**另一个** admin 等级(`owner` → `admin`,或逗号拼写 `member,admin`)—— 等级未失;
  已被 ban 的管理员的身份被撤(本来就不能登录,没有东西被拿走);非管理员的 membership/授权;
  以及不触及 `role` / `user_id`(membership)或权限集/作用域/有效期(授权)的 payload —— 这类写
  静态可证不改变枚举结果,一次读都不做。

  有效期语义按 `resolveAdminUserIds` 现有的 `isGrantActive`(ADR-0091 D2)**原样消费**,本次不新造
  (#5893 才是那个问题的归属单)。等级判定全程只问 `isOrgAdminGrade` 这把唯一的尺(#5939 / #5942),
  守卫内没有任何手抄的 role 解析。

- 08f93bc: fix(auth): `organization/create` gates on the authoritative `OS_TENANCY_POSTURE`, not the demoted `OS_MULTI_ORG_ENABLED` (#5233)

  A deployment configured the documented way — `OS_TENANCY_POSTURE=isolated` (or
  `group`), legacy boolean unset — mounted the entire organization wall and still
  answered `403 Creating additional organizations is disabled on this deployment.`
  to `POST /api/v1/auth/organization/create`. Org-less users had no way to create
  their workspace, so the guided "Create your workspace" path was a dead end.

  ADR-0105 D1 made `OS_TENANCY_POSTURE` the canonical knob and demoted
  `OS_MULTI_ORG_ENABLED` to a back-compat _input_ of `resolveTenancyPosture()`.
  Two sites in `AuthManager` kept reading the demoted boolean directly, so both
  reported "single-org" on a deployment that had asked for a wall and got one:

  - `organizationHooks.beforeCreateOrganization` — the 403 above. It now judges
    `postureEnforcesWall(resolveTenancyPosture())`, matching the knob `serve.ts`'s
    own ADR-0093 D5 boot guard keys on. Intent is unchanged (single-org still
    refuses); only the knob is corrected.
  - `/auth/config`'s `features.multiOrgEnabled` — its no-tenancy-service fallback
    read the same boolean. It now falls back to the resolved posture, so a lean
    embedding advertises the capability its own gate allows.

  **No configuration change is needed anywhere.** Deployments that set only
  `OS_MULTI_ORG_ENABLED=true` keep working unchanged — `resolveTenancyPosture()`
  falls back to it — and the `OS_TENANCY_POSTURE=isolated` + `OS_MULTI_ORG_ENABLED=true`
  workaround people used to unblock themselves stays valid. Deployments that set
  only `OS_TENANCY_POSTURE` can now drop the redundant boolean.

  `resolveMultiOrgEnabled()`'s doc comment in `@objectstack/types` — which still
  instructed "the auth manager's `/auth/config` feature flag and org-create guard
  … MUST call this", written before the demotion — now says the opposite: ask the
  posture, and never gate on this boolean. Its behaviour is unchanged.

- 55dbbba: feat(spec,runtime,hono): `server.security.rateLimit` — an authored budget that actually returns 429 (#4910, #4937)

  Rate limiting in ObjectStack was three shapes with nothing between them. `packages/spec`
  declared `RateLimitConfig` in three places and the whole repo had **zero readers** for any
  of them, so an author wrote a budget, it parsed, and nothing happened (#4686).
  `@objectstack/runtime` shipped a token bucket whose comments claimed, in the present tense,
  that the dispatcher called it and short-circuited with 429 — it had **zero call sites**
  outside its own unit test, and the `DispatcherPluginConfig.rateLimit` field it told you to
  tune did not exist (#4937). Neither half was broken; they were simply never connected, and
  both were documented as if they were.

  They are connected now, along one narrow path.

  ## What you write

  ```ts
  export default defineStack({
    manifest: {
      /* … */
    },
    server: {
      security: {
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 600 },
      },
      trustProxy: false,
    },
  });
  ```

  `server:` is a **new** top-level stack key. Nothing declared it before, so no existing
  stack changes behaviour on upgrade — there is no configuration that was inert yesterday
  and starts throttling today.

  It is deliberately **narrow**: it carries `security.rateLimit` and `trustProxy` and
  nothing else, because those are the two keys with a consumer. It is NOT the nine-key
  `HttpServerConfigSchema` — the other seven have no reader and no authoring surface, and
  mounting them here would have made seven dead keys writable in one move (their
  enforce-or-remove fate stays with #4938). It is strict from birth (#4001), so a misspelled
  budget is rejected with the correction rather than silently defaulted, and `maxRequests: 0`
  is refused at `defineStack` rather than at 3am.

  **No `server.port`.** The listening socket belongs to the deployment, not the artifact, and
  `objectstack serve -p` already owns it. The precedence rule is recorded in the schema and
  the docs in advance, so it cannot be re-litigated per caller: **CLI flag > `server:` >
  built-in default.**

  ## What happens

  Every inbound request the server routes — REST, dispatcher, service routes, anything
  mounted on that transport — consumes from a token bucket sized `capacity = maxRequests`,
  refilling at `maxRequests / (windowMs / 1000)` per second. An empty bucket answers **429**
  with a `Retry-After` computed from the bucket itself and the standard error envelope
  (`code: "RATE_LIMIT_EXCEEDED"`). `OPTIONS` preflights are never metered.

  The bucket is keyed by **resolved principal**, falling back to the caller's **IP** for
  anonymous traffic — so one abusive session cannot spend another user's budget, and
  credential-stuffing traffic (which has no principal yet) is still metered per source. That
  IP comes from `X-Forwarded-For` / `X-Real-IP` **only when `trustProxy: true` is declared**;
  otherwise it is the transport's own peer address. Undeclared, those headers are attacker
  input: honouring them by default would hand anyone an unlimited supply of fresh buckets and
  let them drain a chosen victim's.

  Counters live in the kernel `cache` service when one is registered, so a multi-node
  deployment enforces one budget instead of one per node (ADR-0069 D2), resolved lazily at
  consume time so a cache plugin that registers later is still picked up (#4772). With no
  cache service at all it falls back to a per-process store and says so once, naming the
  consequence: the effective limit becomes the declared budget multiplied by the number of
  nodes, and nothing about the deployment looks wrong.

  ## Also in this change

  - **`IHttpServer.use()` is a real middleware seam.** The Hono adapter's implementation
    passed `{}` for both `req` and `res` and called `next()` unconditionally, so a registered
    middleware could not read the request, write a response, or decline to continue — a
    declared seam with no execution behind it, unnoticed because nothing called it. It now
    delivers method/path/query/headers plus the transport peer address
    (`IHttpRequest.remoteAddress`, new), and honours a short-circuit. Middleware must be
    registered before the routes it guards; the kernel's two-phase boot makes that automatic
    (`init()` before every `start()`).
  - **`packages/runtime/src/security/rate-limit.ts` no longer describes an execution chain it
    does not have** (#4937). The token-bucket arithmetic is extracted so the synchronous
    in-process limiter and the new shared-store one cannot drift, and `DEFAULT_RATE_LIMITS` is
    now labelled as the reference material it always was rather than as live defaults.

  ## Explicitly NOT wired

  `ApiEndpointSchema.rateLimit` and `ApiEndpointRegistrationSchema.rateLimit` remain
  **known-unwired**. Declaring them still changes nothing. They are not retired here either:
  the fate of the whole declarative `apis:` surface is undecided (#4936), and retiring one
  key of a surface that may yet be implemented would only have to be undone. Tracked, not
  silent.

- 9fa6bab: fix(plugin-auth): sign JWTs with an algorithm the host can actually use (#3585)

  On any host whose WebCrypto lacks Ed25519 — StackBlitz/WebContainer is the
  reported one — **every authenticated request 500'd as soon as the OIDC provider
  was enabled**, which is the default whenever the MCP server is on. Sign-in
  succeeded, then the first `/api/v1/auth/get-session` returned 500 with
  `OperationError … cfrgGenerateKey`. An app that never asked for OIDC got an
  unusable login, and the only escape was `OS_OIDC_PROVIDER_ENABLED=false`.

  The cause was an inherited default: `plugin-auth` registered better-auth's `jwt`
  plugin without `jwks.keyPairConfig`, so better-auth's **EdDSA / Ed25519** default
  applied and jose asked WebCrypto for an algorithm the host does not have. It hit
  ordinary cookie login rather than just OAuth clients because the plugin's `after`
  hook signs a `set-auth-jwt` header for _every_ session.

  **Three changes, no configuration required:**

  - **The signing algorithm is now chosen by capability, not by inheritance.** At
    instance build the plugin asks WebCrypto whether it can generate an Ed25519
    key pair — using the exact algorithm descriptor jose uses — and pins
    `keyPairConfig` to `EdDSA`/`Ed25519` when it can, or falls back to **ES256**
    when it cannot. Hosts with Ed25519 behave exactly as before.
  - **Deployments that already minted an EdDSA key keep working.** Choosing ES256
    for _new_ keys is not sufficient on its own: better-auth's `resolveSigningKey`
    falls back to _any_ stored key when none matches the configured algorithm, so
    an existing EdDSA key in `sys_jwks` would still be selected and then fail in
    `importJWK`. On a host without Ed25519 the plugin now installs better-auth's
    `adapter.getJwks` keyring seam and hides keys this host cannot import, so a
    fresh ES256 key is minted and the deployment converges on a working state.
    Hidden rows are **never deleted** — move back to a host with Ed25519 and they
    are used again. Such a host also stops advertising those keys in
    `/api/v1/auth/jwks`, since it can neither sign nor verify with them.
  - **A signing failure can no longer take down the session path.** If signing
    fails anyway (neither algorithm usable, an unwritable `sys_jwks`, or a rotated
    `OS_AUTH_SECRET` that cannot decrypt the stored key), `/get-session` now
    returns the session normally and simply omits the `set-auth-jwt` header,
    instead of 500ing. The failure is reported once with an error that names the
    algorithm, says what still works, and points at the opt-out — and is queryable
    via `getDegradedAuthFeatures()` under the new `jwtSigning` key.

  No configuration changes and no migration. Deployments on hosts with Ed25519 are
  unaffected: the keyring override is installed only where it is needed.

- b691ba9: fix(plugin-auth): break-glass 守卫扩到 `sys_permission_set`,并把「零管理员」从引导期豁免里分辨出来 (#6084)

  break-glass 不变量(cloud ADR-0024 D5.2)此前守三张表:`sys_user`(ban/删行,#5892/#5941)与
  `sys_member`/`sys_user_permission_set`(撤销 standing,#5978)。**第四条写法绕开全部三条**:
  「谁是 platform admin」是**按名字**解析的——`resolveAdminUserIds` 先
  `where: { name: 'admin_full_access' }` 取那条 `sys_permission_set` 行,再去读指向它 id 的授权行。
  删掉那一行、或把它改个名字,授权行、`sys_user` 行、`sys_member` 行**一个都没动**,而所有
  platform admin 同时不再是管理员。

  ## 放大缺陷:这一条写法还会顺手关掉守卫本身

  两个判据都以「这个环境有管理员吗?没有就放行」开场——引导期本就没有 break-glass 账号可保护,
  在那个窗口里拒绝一切身份写会是守卫拿一个空测量值自造政策。可是 `admin_full_access` 行没了的环境
  **读起来正是零管理员**,于是豁免生效,ban / 删用户 / 降级 / 撤授权**一并放行**。所以这一条写法
  不只是锁死环境,还在锁死的路上把 #5892 / #5941 / #5978 三条守卫一起解除。

  ## 两处改动

  **① 同形状扩到第四张表。** `sys_permission_set` 的 `beforeUpdate` + `beforeDelete`,复用 #5978 的
  `enforceStanding` / `applyPending`,`PendingStandingWrite` 多认一张表;枚举的第一段 scan 现在也对
  pending 做模拟并**重测 `name`**——与 grant 半边重测 `permission_set_id` 同理,scan 自己的 `where`
  只证明了写**之前**那行叫什么。静态跳过键只有 `name` 一个:枚举只读这一列,所以每一次 projection
  回填、每一次 `os meta resync`、每一次 Setup 里编辑权限集(写的是 `label`/`description`/权限 JSON)
  一次读都不花。数据门自己已经拒绝改名(ADR-0094),这道守卫覆盖的是不经数据门的引擎级与
  system-context 写。

  **② 收紧引导期豁免。** 「零管理员」拆成它本来混在一起的两种状态:

  - **真引导期**——没有任何证据说这里曾经有过 platform admin。照旧放行。
  - **刚被清空**——仍存在无组织范围、有效期内的 `sys_user_permission_set` 授权行,而它指向的
    `sys_permission_set` 行已经不在了。fail-closed 拒写,并在报文里点名那些悬空授权行。

  判据选的是**悬空授权行**,因为它在正常路径上根本写不出来:每一个生产者都先插权限集、再读回 id 写
  授权行(`bootstrapPlatformAdmin` 第 1 步 seed 权限集、第 2 步才提拔第一个用户,权限集缺席时返回
  `admin_permission_set_missing` 而不是发授权),所以**全新环境的可写性按构造不变**——测试里有一条
  「真引导期照常放行」的钉专门量这一点。改名不留下悬空授权行,这条判据看不见它;那条路径改由 ① 在
  写入处拦下,残留因此只剩一种状态:守卫尚未注册时落下的改名。曾考虑把判据放宽成「不存在
  `admin_full_access` 行 且 存在无组织范围授权行」,被否掉——它会改变「seed 顺序先写授权行」的全新
  环境的答案,而不改变全新环境的答案正是这条判据唯一不能碰的红线。

  `sys_permission_set` 的拒绝报文结尾不走 SCIM 那句:IdP 不写这张表,写它的是元数据删除、
  `os meta` 与包卸载,报文点名的是这些门。

- 4addd9d: feat(driver-sql)!: organization-scoped uniques are NULL-safe — `COALESCE(organization_id, '__global__')` key part + `unique: 'organization'` on declared indexes (ADR-0120 D3/D4, #5030)

  SQL UNIQUE is NULL-distinct, so the `(organization_id, field)` composite #3696
  introduced enforced **nothing** on rows whose organization is NULL — which on a
  single-tenant stack (where the kernel injects the column and never fills it) is
  **every row**: field-level `unique: true` was a silent no-op there, measured in
  #5030. Per ADR-0120 D3, every organization-scoped unique now materializes its
  organization key part as `COALESCE(organization_id, '__global__')`: NULL-organization
  rows collapse into one platform bucket, unique among themselves; non-NULL rows
  are untouched. Storage stays NULL — the sentinel exists only inside the index
  key, and it is the same word the autonumber sequence table already uses
  (`GLOBAL_TENANT`), so a constraint-violation error reads as "the platform
  bucket collided", not as corrupt data.

  What changes, concretely:

  - **Field-level `unique: true`** (and the new explicit synonym
    `'organization'`) on a tenant-scoped object → composite
    `(COALESCE(tenantField, '__global__'), field)`. `unique: 'global'` and
    tenant-less objects are unchanged.
  - **Declared indexes gain the ADR-0120 D1 scope vocabulary at the driver**:
    `unique: 'organization'` prepends the NULL-safe organization key part to the
    listed columns (degrading to the listed columns on a tenant-less object; a
    listed tenant column is made NULL-safe in place instead — the S6 respelling).
    `unique: true` / `'global'` on a declared index stays **verbatim** — the
    #3696 contract, now the `'global'` arm; the nine engine dedup/idempotency
    keys keep their exact physical shape. (The spec/lint side of the vocabulary
    lands separately via #4986; the driver deliberately merges first.)
  - **Drift detection reads both sides through one normalization**
    (the #4884 discipline, extended to the tenant key part): the physical
    `COALESCE(organization_id, <literal>)` form is attributed to the column,
    compared **literal-agnostically**, and recognised as the sync's own
    vocabulary — a healthy database reports zero drift on every dialect.
  - **Existing bare composites migrate through the ceremony (ADR-0120 D4)**:
    `(organization_id, X) → (COALESCE(organization_id, '__global__'), X)`
    surfaces as a `recreate_index` drift op — a pure tightening — gated by a
    **duplicate pre-flight probe**. Clean probe → the op grades `safe` and dev
    `autoMigrate: 'safe'` / a plain `os migrate apply` applies it. Duplicates
    (data the void constraint wrongly admitted) → the op is **blocked** with a
    per-group row report, the old index stays in place, and apply re-probes so
    even `--allow-destructive` cannot drop a constraint whose replacement is not
    creatable. Deduplicate, re-plan, apply.
  - **`'__global__'` is reserved at the organization-minting seam**
    (plugin-auth): an organization whose id or slug equals the sentinel is
    rejected at creation with a prescriptive error (ADR-0120 D3 guardrail).

  Migration note for operators: on databases with pre-existing
  organization-composite uniques, the first `os migrate plan` after upgrading
  shows one `recreate_index` per affected index. On healthy data it auto-applies
  in dev and is a no-op content-wise; a blocked op means the #5030 defect
  admitted real duplicate rows — resolve the listed rows first. MySQL < 8.0.13 /
  MariaDB cannot express the functional key part: the driver degrades to the
  bare composite, says exactly what is not enforced at `error` level, and keeps
  reporting the tightening as drift for after the server upgrade.

- db8c285: fix(plugin-auth): 短信日配额拒发时,OTP / 邀请短信按 429 TOO_MANY_REQUESTS 作答,不再是 500 (#6039)

  #2814 把短信总量成本闸落在 `SmsService.send()` —— 它是内核服务,不知道调用方是谁,
  所以超限时**返回**一条失败结果,把码写在服务层既有的 `CODE: message` 信封上:
  `TOO_MANY_REQUESTS: daily SMS quota exhausted`。把 HTTP 语义还原回去是 auth 端点的
  职责,而 `AuthManager` 此前没有做:`deliverPhoneOtp()` / `sendPhoneInviteSms()` 对
  任何 `status === 'failed'` 一律抛普通 `Error`。

  better-auth 的路由层 better-call 只把 `APIError` 映射成真实状态码
  (`isAPIError = err instanceof APIError || err?.name === 'APIError'`,
  better-call@1.3.7 `dist/utils.mjs:57`,消费点在 `dist/router.mjs:93`),其余一律走
  `console.error` + **500、响应体 `null`** 的分支。于是配额拒发对外是 500,
  `TOO_MANY_REQUESTS` 只留在服务端日志里;而**同一个端点**上按号码冷却闸
  (`assertPhoneOtpSendAllowed`,在 admission hook 里)抛的是
  `APIError('TOO_MANY_REQUESTS')`,正常回 429 —— 一个端点两种口径,正是 #2814
  「两道墙从外面看应当一样」的反面。

  现在两处失败分支都先识别信封上的 `TOO_MANY_REQUESTS:` **前缀**,改抛
  `APIError('TOO_MANY_REQUESTS')`:

  - **只有码跨包**。识别用的 `TOO_MANY_REQUESTS` 在 plugin-auth 本地写死并注明出处
    (`SMS_QUOTA_EXCEEDED_CODE`,`packages/services/service-sms/src/sms-daily-quota.ts`)——
    `@objectstack/service-sms` 已经依赖本包(它的日计数器从这里 import
    `InProcessCounterStore`),反向 import 会成环;这与 service-sms 里
    `normalizeSmsRecipient` 就地重述 plugin-auth 形状规则是同一个取舍的另一半。
    跨包重述的只是一个 ADR-0112 闭集错误码,冒号后的措辞归服务层所有,可以自由改写。
  - **不泄露预算**。429 文案沿按号码闸的措辞形状,不含上限、剩余量与重置时刻
    (按号码闸报自己的重试窗口,是因为它算得出;配额闸不承诺它给不出的时间)。
  - **不顺手收紧**。传输故障(provider 宕机等)仍抛普通 `Error`,500 语义原样不变;
    仅仅在文中提到该码而不以之开头的 provider 报错同样保持 500。

  对外可见的变化:`POST /phone-number/send-otp`、
  `POST /phone-number/request-password-reset` 在部署日配额耗尽时,由
  **500 + 空响应体**变为 **429 TOO_MANY_REQUESTS**,与按号码冷却闸同形。
  邀请短信路径同样返回 `APIError`;仓内唯一调用方(admin import-users)按行捕获它并
  记为 `INVITE_SMS_FAILED`,该路径的变化是行内报错不再携带服务层原始信封。

- b40f81c: docs(plugin-auth): the session of record is always `sys_session` — cache backs rate-limit counters only (#4785)

  Settles an architectural question that had been answered two different ways by
  the code and the docs. **Nothing about the runtime changes**: this records the
  decision, proves the behaviour that depends on it, and corrects the docs that
  described the road not taken.

  **The decision.** ObjectStack's session of record is always the `sys_session`
  table. The kernel `cache` service serves authentication as the ADR-0069 D2
  rate-limit counter store and nothing else. It is never bound as better-auth's
  `secondaryStorage`, because that option is not a counter store — handing
  better-auth one also relocates sessions into it (`createSession` skips the
  `sys_session` row; `findSession` answers from the cached snapshot without
  reading the database). ADR-0069 D4's three session controls — idle timeout,
  absolute lifetime, concurrent-session cap — all revoke by writing that row, so a
  cache-backed session store would silently disable every one of them. Dual-writing
  (`session.storeSessionInDatabase: true`) was considered and rejected as the worst
  of the options: the row exists, so the controls _appear_ to work, while the read
  path still answers from the cache.

  **Why this needed settling rather than just fixing.** The conflict had never
  fired — the cache lookup that would have wired `secondaryStorage` ran before the
  cache service registered, so the binding never took in a standard composition.
  The declaration and the runtime disagreed for a month and no test could tell,
  because no test asserted that a D4 control ends a _live session_; they asserted
  at most that a row got stamped. A stamped row nobody reads is exactly the failure
  mode in question.

  **What is new.** `session-of-record.test.ts` drives the real better-auth pipeline
  end to end and proves each of the three D4 controls actually de-authenticates a
  live session cookie — not that a column was written. It also pins the
  counter-factual: with a `secondaryStorage` bound, `sys_session` stays empty and
  the idle timeout never fires. Two facts that make the guarantee hold for real
  deployments are pinned with it — `AuthManager` does not plumb
  `storeSessionInDatabase`, so the rejected dual-write shape is unreachable through
  configuration; and the default composition (OIDC provider on) makes better-auth
  _refuse to boot_ with a `secondaryStorage` rather than degrade quietly.

  **For hosts.** `cacheSecondaryStorage()` remains exported for anyone who wants
  better-auth's cached session store deliberately. It now says plainly what it
  costs: opting in disables the ADR-0069 D4 session controls, and a revoked session
  stays usable until its cached copy expires. Moving sessions into the cache
  platform-wide would be a new decision requiring its own revocation-consistency
  requirements, not a configuration change.

  ADR-0069's D2 "shared store" is scoped to rate-limit counters, D4 records
  `sys_session` as a precondition rather than a deployment preference, and the
  `ICacheService` contract page no longer lists session storage among the cache's
  uses.

- ef8b1ff: fix(plugin-auth): `/sso/register` 的管理员门禁改用唯一那把等级尺,不再手抄一份大小写敏感的判据 (#5942)

  ADR-0024 的 `POST /sso/register` 门禁问的是「这个 membership 是不是本组织的管理员」。
  它此前用的是一份手抄判据:

  ```ts
  raw
    .split(",")
    .map((s) => s.trim())
    .some((r) => r === "owner" || r === "admin");
  ```

  同一个问题在 plugin-auth 内还有另一把尺 —— `invitation-role-cap.ts` 的等级尺
  (`parseOrgRoles()` 会 `.trim().toLowerCase()`,`isOrgAdminGrade()` 据此评级),
  break-glass ban 守卫(`last-admin-ban-guard.ts`,ADR-0024 D5.2)用的就是它。
  两把尺在大小写上不一致:`sys_member.role` 若存成 `Owner` / `ADMIN`,ban 守卫把这一行
  算作**管理员**,而 `/sso/register` 门禁算作**非管理员**。同一条安全路径上的两个答案
  互相矛盾,而且两个方向的错都不出声。

  现在门禁改问 `isOrgAdminGrade(m.role)` —— 「哪种 membership 算管理员」在 plugin-auth
  内只剩一个答案,两处自此同尺。

  **用户可见的行为变化,只有一个方向:放宽,且只放宽在此前判错的取值上。**
  `sys_member.role` 为大小写非常规值(`Owner` / `ADMIN` / `Admin`,以及
  `member,Owner` 这类逗号拼写)或数组拼写(`['owner']`)的成员,此前会被
  `/sso/register` **误拒**,现在正确判为管理员并放行。**没有任何收窄**:此前被判为管理员
  的取值,换尺后仍然是管理员(已逐值实测,见 PR)。

  ADR-0108 的封闭词表(`owner` / `admin` / `delegated_admin` / `member`)全为小写,UI 与
  better-auth 写入的也是小写,所以正常部署下答案逐值不变 —— 这也是为什么它此前只是一条
  静默分歧,而不是线上故障。要撞上分歧得有一条绕过表单的写入(导入、外部写入、手工 SQL)。

  `isOrgOrPlatformAdmin` 名字里的 platform_admin 半边**未改动**,仍由
  `packages/core/src/security/resolve-authz-context.ts` 权威推导;那几处实现的合流是
  另一个决策件。

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [c36abfe]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [2f6516e]
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
- Updated dependencies [96d3d4d]
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
- Updated dependencies [d9cac60]
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
- Updated dependencies [75f82f3]
- Updated dependencies [aeb9b27]
- Updated dependencies [1203bb2]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [39396bd]
- Updated dependencies [577cd27]
- Updated dependencies [5897552]
- Updated dependencies [91ec1ea]
- Updated dependencies [2d25303]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [1216dcc]
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
- Updated dependencies [90fa077]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/types@17.0.0-rc.4
  - @objectstack/rest@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- ce5242c: feat(auth,objectql,audit,security,spec): identity-table writes carry the real actor, so `sys_member` history stops saying "system" (#4586)

  better-auth owns every write to the identity tables (`sys_member`, `sys_user`,
  `sys_invitation`, …) and its ObjectQL adapter runs them `isSystem: true` **on
  purpose** — the route already authorized the action under better-auth's own ACL,
  and ADR-0092 D2 refuses user-context writes to those tables outright. The
  consequence was that the human who clicked _make admin_ was known exactly once,
  in the hook layer where the session exists, and then discarded: every
  `trackHistory` transition on `sys_member` recorded `user_id: null` / "system",
  and `sys_user_permission_set.granted_by` was written null by the auto-grant.
  "Who made this person an org admin?" had no answer in the platform's own audit
  log.

  **What changed**

  A request-scoped attribution seam, general rather than a `sys_member` special
  case:

  | Layer                        | Before                             | After                                                                                                                          |
  | :--------------------------- | :--------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
  | `ExecutionContext`           | `userId` / `actor` only            | new optional `attributedUserId` — the human CREDITED for a write the system AUTHORIZED                                         |
  | `HookContext`                | `session`, `user`                  | new `provenance.attributedUserId`, split off the context beside `session`                                                      |
  | better-auth ObjectQL adapter | `{ isSystem: true }`               | `{ isSystem: true, attributedUserId }` when a request scope is open                                                            |
  | audit writer                 | `user_id = session.userId ?? null` | falls back to `provenance.attributedUserId` when the session names nobody                                                      |
  | `auto-org-admin-grant`       | `granted_by: null`, no `reason`    | the attributed human in `granted_by`, plus a machine-provenance `reason` naming the writer and the triggering `sys_member` row |

  Outside a request scope nothing changes: writes stay bare `{ isSystem: true }`
  and audit rows keep recording `null`. Absence is still never upgraded into a
  caller, and never written as a sentinel string (ADR-0118 D1/D2).

  **Hard constraint — attribution is not authority**

  `attributedUserId` is read by exactly one consumer, the audit writer, and by no
  security middleware. It never becomes `ExecutionContext.userId`, so it is never
  the subject the engine authorizes as: not RLS `current_user`, not the ownership
  stamp, not permission resolution. A context carrying only `attributedUserId`
  authorizes exactly like an empty context (ANONYMOUS), and a context carrying it
  beside `isSystem: true` authorizes exactly like `isSystem` alone. Re-authorizing
  identity writes as the human would re-adjudicate a decision better-auth already
  made — the second adjudication track ADR-0095 D3 closed. The constraint is
  pinned by tests at three layers: the engine seam
  (`packages/objectql/src/engine.test.ts`), the better-auth adapter
  (`packages/plugins/plugin-auth/src/auth-actor-attribution.test.ts`), and the
  live HTTP route (a plain member still cannot promote themselves).

  **For authors and plugin developers**

  `attributedUserId` is authorable on `ExecutionContext` and readable as
  `ctx.provenance?.attributedUserId` in hooks. Use it to answer _who is
  responsible_; keep using `ctx.session` / `ctx.user` to decide _what is
  permitted_. The two are separate fields precisely so the distinction cannot be
  blurred by accident.

### Patch Changes

- f2eb850: fix(plugin-auth): 限流计数器改为惰性解析 kernel cache —— 修掉误报的告警，也修掉「共享限流从未生效」的功能洞 (#4772)

  `pnpm dev`（showcase）每次冷启都会打一条：

  ```
  WARN [auth] no cache service registered — rate-limit counters use a per-process in-memory
       store; a multi-node deployment needs a shared cache (Redis) to enforce limits globally
  ```

  而 `CacheServicePlugin` 就在 **21ms 后**注册好了，它本来就在已加载插件列表里。这条告警把运维引向「你需要 Redis」，接完 Redis 还是同一条告警 —— 因为缺的不是 Redis。

  **这不只是日志误报。** `AuthPlugin.init()` 里那次 `getServiceAsync('cache')`
  探测的结论会被**冻结整个进程生命周期**：better-auth 实例是懒创建的，但它读的是 init
  时定下的 config。所以标准组合下 auth 这一侧永远拿着「没有 cache」这个结论，限流计数器
  **从未**用上共享存储 —— 多节点部署的限额从来没有被全局强制过，每个节点各算各的，轮换
  节点即可绕过。ADR-0069 D2 声明的能力与运行时不一致。

  **修法：把「取 cache 服务」放回真正用到它的那一刻。** 新增
  `createLazyCacheRateLimitStorage()`，实现 better-auth 的 `rateLimit.customStorage`：
  计数器被消费时才解析 `cache` 服务（这一刻必然在 `kernel:ready` 之后，因此与插件启动
  顺序无关），解析到就一直用它。告警保留，但只在**计数器真的要用共享存储、而此刻确实
  一个 cache 服务都没有**时才打一次 —— 那时它才是真信号，「加一个共享缓存」也才是对的
  建议。真没有 cache 的部署仍然限流，只是退化成进程内计数（降级，不是关闭）。

  **刻意走 `rateLimit.customStorage` 而不是 `secondaryStorage`。** 后者会连带把**会话
  的记录之处**搬进缓存：better-auth 的 `createSession` 不再写 `sys_session` 行，
  `findSession` 直接从缓存快照作答、根本不查库；而 ADR-0069 D4 的空闲超时 / 绝对时长
  上限 / 并发上限**全部靠写那一行来撤销会话**。所以自动把 cache 绑成 `secondaryStorage`
  会静默废掉 D4 的三个管控。本次因此不再从 cache 服务自动派生 `secondaryStorage`：
  它回归「宿主显式提供才生效」，`cacheSecondaryStorage()` 改为从包根导出，供知情的宿主
  自行选用。会话到底该存哪，是一个需要维护者裁定的架构问题，记录在 #4785。

  对使用者的影响：

  - 配了 cache 插件的部署不再出现那条 warn，改为一条 info（计数器已绑定到 cache 服务）；
  - 多节点 + Redis cache 的部署，限流计数**现在真的**是全局的；
  - 新增 `AuthManagerOptions.rateLimitStorage`（counters-only，不迁移会话）；宿主自己
    提供的 `secondaryStorage` 行为不变，仍然优先并继续走
    `rateLimit.storage: 'secondary-storage'`。

- 8bd437f: fix(plugin-auth): 每号码 OTP 发送预算改用惰性解析的共享计数存储 —— 多节点下不再按节点数倍增 (#4790)

  #2780 的「每号码 OTP 发送预算」（60s 冷却 + 每小时 5 条）此前**只有宿主显式提供
  better-auth `secondaryStorage` 时才跨节点共享**：`AuthManager.getOtpSendGuard()` 唯一的
  存储来源就是 `AuthManagerOptions.secondaryStorage`，而标准 `serve` 组合里没有任何一处
  提供它（#4788 之后 `AuthPlugin` 也明确不再从 cache 服务派生它）。于是预算落在**每个进程
  一份**：N 个节点的部署，一个号码实际能收到的是声明值的 N 倍，而且**没有任何信号**告诉你
  它没兑现（ADR-0049 声明 ≠ 强制）。这里的计价单位是**真金白银的短信**。

  这是 #4772 那条限流洞的同类，但是独立的一处：#4788 修的是 better-auth 自己的 `rateLimit`
  计数器（走 `rateLimit.customStorage`），OTP 预算是 ObjectStack 在 `AuthManager` 里自己实现
  的另一套计数，行为未被 #4788 改变。

  **修法：复用 #4788 建好的那条路径，而不是再写一份。** `rate-limit-storage.ts` 中把「惰性
  解析 → 绑定即宣告 → 解析不到就降级到有界的进程内存储并响亮告警」抽成
  `createLazyCounterStore()`（`createLazyCacheRateLimitStorage()` 现在就是它的一层薄封装），
  OTP 预算经由新的 `AuthManagerOptions.sharedCounterStore` 接同一条路径：

  - **存储在每次发送校验时才解析**，因此 `CacheServicePlugin` 晚于 `AuthPlugin` 注册也照样
    绑定得上（插件启动顺序不再决定任何事）—— 这正是 #4772 冻结结论造成的那个洞；
  - 配了 cache 的多节点部署，每号码预算**现在真的是一份**，换节点不会重新获得冷却额度；
  - 没有 cache 服务的部署**仍然限额**，只是降级为进程内计数，并在第一次真正计数时打一条
    点名代价的 warn（「an N-node deployment can send up to N× the configured number of PAID
    SMS to one number」）—— 降级不是关闭，两种情况在日志里可区分（绑定打 info，降级打 warn）。

  **刻意不引入 `secondaryStorage` 来修它**（#4785）：那会把会话的记录之处搬进缓存，静默废掉
  ADR-0069 D4 的三个会话管控。宿主自己提供的 `secondaryStorage` 对这个预算仍然优先且行为不变。

  冷却与滚动小时窗的语义**未做任何改动**：计数依旧是按号码的时间戳滚动窗口，只是换了它所在的
  存储。（固定窗口计数器无法表达「距上一次发送满 N 秒」，把它改成定窗会在窗口边界放行两倍突发
  ——用一种倍增换另一种倍增。）

  对使用者的影响：

  - 新增 `AuthManagerOptions.sharedCounterStore`，`AuthPlugin` 自动填充，一般宿主无需感知；
  - 新增导出 `createLazyCounterStore()` 与 `counterStoreFromKv()`；
  - `OtpSendGuard` 新增 `resolveStore` 选项，原有的 `storage`（字符串 KV）选项保持可用。

- 5046afe: fix(plugin-auth): OTP 冷却按声明值真正生效 —— 发送历史的保留时长不再被硬编码的 1 小时截断 (#4808)

  `OtpSendGuard` 有**两个**维度:每号码「距上次发送至少 N 秒」的冷却(`cooldownSeconds`),
  和每号码「滚动一小时内至多 M 条」的上限(`maxPerHour`)。它们需要**不同**的时间窗,而此前
  两者共用了同一个硬编码的一小时:发送历史按 1 小时剪枝、也按 1 小时写 TTL。

  于是把 `phoneOtp.cooldownSeconds` 配成**大于 3600** 时:配置被接受,没有校验错误,没有 warn,
  但冷却所依据的那条历史记录在 1 小时处就被丢掉了 —— 声明「两次发送间隔 2 小时」,实际最多
  只有 1 小时,**反滥用强度是声明值的一半,而且没有任何信号**(ADR-0049 声明 ≠ 强制)。
  计价单位仍然是真金白银的短信。这与 #4790 是同一个 guard 上的**不同**缺陷,且改动前后行为
  一致 —— 不是 #4806 引入的。

  **修法(issue 的方向 1):保留时长跟随配置。** 历史保留 `max(1 小时, cooldownSeconds)`,
  即「两个维度里还用得着它的那个更长的窗」;TTL 同步跟随,记录因此活得比它所度量的冷却更久。
  每小时上限仍在**它自己的滚动一小时**内计数,所以超长冷却不会反过来把 `maxPerHour` 收得比
  声明的更严。

  **上限是拒绝,不是又一次截断。** `cooldownSeconds` 超过 `MAX_COOLDOWN_SECONDS`(86400,
  即 24 小时)会在**启动时**抛错(`AuthPlugin.init()` 构造 `AuthManager` 处),错误信息给出
  值、上限和改法。把截断点挪到更高的数字只是把同一个缺陷往外推一个量级;设上限的理由是:
  一条号码的历史会在共享缓存里驻留整个冷却期,而超过一天的封锁已经不是发送节流而是账号锁定
  (另一套机制、另一套管控)。这条边界同时把「`cooldownSeconds` 误填成毫秒」这类笔误变成
  一次响亮的拒绝(5 分钟以上的意图都会被挡下)。校验放在**配置处**而不是首次发送处:guard
  是惰性构造的,只在那里校验的话,一个配置错误会表现为 `/phone-number/send-otp` 的 500。

  **默认配置行为完全未变**,并有测试锁定:未配置 `phoneOtp` 时仍是 60 秒冷却 + 每小时 5 条,
  历史保留与 TTL 仍是 3600 秒。

  对使用者的影响:

  - `phoneOtp.cooldownSeconds` 现在在 1 小时以上也真正生效(上限 24 小时);
  - 超过 24 小时、负数或非有限值的配置**开始被拒绝**——这些值此前从未按声明工作过(要么被
    静默截断到 1 小时,要么被静默钳成 0 即关闭冷却),因此不存在依赖其旧行为的部署;
  - 新增导出:常量 `MAX_COOLDOWN_SECONDS` 与校验函数 `assertOtpCooldownSeconds()`。

- c03108c: fix(auth): a degraded tenancy posture must not hand out a default organization

  `TenancyService.defaultOrgId()` documented "returns `null` under any walled
  posture", but the implementation keyed on the posture actually **in force**
  (`isolationActive()`) rather than the one the operator **requested**. Those two
  disagree in exactly one state — DEGRADED: a deployment that asked for `group`
  or `isolated` and could not enforce it (the enterprise `@objectstack/organizations`
  package is absent) reports `posture: 'single'`, and the resolver then happily
  answered with "the `slug='default'` org, or the only org that exists".

  Everything downstream of that resolver binds new users to whatever it returns.
  The membership reconciler (ADR-0093 D2) runs on `user.create.after` — the seam
  every creation path flows through — so in a degraded deployment **every fresh
  signup, admin-created user and SSO JIT user was auto-bound as a `member` of
  whichever organization happened to be resolvable**, and `backfillMemberships`
  (D6) would sweep the pre-existing member-less ones in on the next
  `kernel:ready`.

  This reached production. ObjectStack Cloud's control plane runs
  `OS_MULTI_ORG_ENABLED=true` while deliberately not mounting the enterprise
  package — it enforces its own control-plane org wall instead — so the
  `org-scoping` probe missed, the posture resolved degraded, and self-serve
  signups landed inside a stranger's organization with read access to that org's
  environments (cloud#957).

  `defaultOrgId()` now keys on `requestedPosture`: any walled request, enforced or
  degraded, returns `null` and the framework never guesses. This is the same
  judgement D6 already applies to the backfill — "a wrong org in a tenant-isolated
  deployment is a data-exposure bug, not a convenience" — applied to the resolver
  those consumers share. It also makes the resolver agree with the default-org
  bootstrap in `AuthPlugin.start()`, which was already gated on the requested
  posture.

  Single-org deployments are unaffected: nothing about `requested: 'single'`
  changes. A degraded deployment loses the auto-bind, which is the point — and
  ADR-0093 D5 already refuses to boot that deployment at all unless the operator
  sets `OS_ALLOW_DEGRADED_TENANCY=1`.

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
- Updated dependencies [be25f97]
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
- Updated dependencies [05d8a54]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [b25a116]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [9fd9ae7]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [8aacf94]
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
- Updated dependencies [be90dea]
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
  - @objectstack/rest@17.0.0-rc.2
  - @objectstack/types@17.0.0-rc.2

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

- bb1ce2e: fix(plugin-auth,plugin-webhooks): retire a dead degrade branch and an implicit transitive dependency (ADR-0116 follow-ups, #4187)

  Two concrete findings from the ADR-0116 consumer-side audit, plus the
  authoring rule that would have prevented both.

  **`plugin-auth` claimed a fallback it did not have.** `init()` ran
  `const dataEngine = ctx.getService('data'); if (!dataEngine) { warn('No data
engine service found - auth will use in-memory storage') }`. That branch could
  never execute: `getService` **throws** for an unregistered service rather than
  returning `undefined`, and this plugin declares a hard dependency on ObjectQL
  (which registers `data` unconditionally), so a kernel without the engine fails
  even earlier with `Dependency … not found`. The branch is removed and the real
  contract is declared — `requiresServices: ['data', 'manifest']` — which also
  replaces a trailing `// manifest service required` comment with the
  machine-checked form of the same claim. `AuthManager` keeps its own optional
  `dataEngine` guards: it is usable outside the plugin.

  **`plugin-webhook-outbox` was protected only transitively.** It resolves
  `manifest` in `init()` with no fallback while depending on
  `com.objectstack.service.messaging`, which in turn depends on ObjectQL, the
  actual provider. That works today and would have broken silently the day
  messaging stopped depending on the engine — surfacing as a crash inside an
  unrelated plugin's init. It now declares `requiresServices: ['manifest']`
  directly.

  Neither change alters ordering or boot outcomes on any current composition:
  both plugins were already ordered correctly. What changes is what a broken
  composition _says_, and that the guarantees are now checked rather than
  inherited.

  Docs: `content/docs/plugins/anatomy.mdx` gains the three ADR-0116 fields and
  the decision rule for resolving a service inside `init()` (hard dependency vs
  `optionalDependencies` + `requiresServices`), including the two traps behind
  these fixes — don't rely on a transitive provider, and don't write an
  `if (!svc)` fallback after a bare `getService`. The api-registry example
  declares the contract on all seven of its plugins instead of relying on
  `kernel.use()` order.

- ea24593: fix(plugin-auth): the auth catch-all yields paths better-auth does not own (#4088)

  `registerAuthRoutes` mounts `rawApp.all('${basePath}/*')` over the whole auth
  namespace (`/api/v1/auth` by default), and that handler was **terminal**: it
  returned better-auth's response unconditionally, including the 404 better-auth
  produces for a path it does not implement. Any other plugin's route under that
  prefix was therefore reachable only if it happened to register **first** — Hono
  runs handlers matching a path in registration order and the first to return a
  Response wins.

  That put a load-bearing surface at the mercy of `kernel.use()` order.
  `@objectstack/plugin-hono-server` mounts `/auth/me/permissions` and
  `/auth/me/localization` from its own `kernel:ready` hook; objectui's entire
  permission layer reads the former and `core`'s auth gate allow-lists the latter
  as an endpoint a gated user must still reach. Register `AuthPlugin` before
  `HonoServerPlugin` and all of it silently 404s.

  A 404 from better-auth now means "this path is not mine" and the catch-all yields
  to whatever else matched, in either registration order. Deliberately narrow:

  - **Only 404 falls through.** 401/403 are real better-auth answers, not
    disclaimers of ownership.
  - **Precedence still favours the namespace owner.** better-auth wins every path
    it implements; only its leftovers are up for grabs.
  - **The unclaimed-path wire shape is unchanged.** When nothing downstream
    answers, better-auth's own 404 is returned verbatim rather than Hono's
    `404 Not Found`.

  No configuration changes and no new routes. The only behavioural difference for
  an existing deployment is that a route another plugin mounts under
  `/api/v1/auth/*` now answers regardless of plugin order — previously it answered
  only in the lucky order.

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

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- c54c822: fix(spec,plugins): sweep the auth/session slot lookups — 31 sites typed, and the user-import metadata reader was pointed at a service that never had the method (#4251)

  Batch B2 of the #4251 sweep: every service-lookup erasure in the auth/session
  family. `plugin-auth/auth-plugin.ts` (20), `plugin-hono-server/current-user-endpoints.ts`
  (10) and `plugin-security/security-plugin.ts` (1) now pass the slot's contract
  type; the ratchet baseline drops **171 → 140 sites, 40 → 37 files**.

  **The yield.** `POST /admin/import-users` resolved the `metadata` slot and probed
  `metadataService?.getMetaItem` to decide whether to pass the import's field-coercion
  dependency. `getMetaItem` is a **protocol** method — `ObjectStackProtocolImplementation`,
  registered by MetadataProtocolPlugin under the `protocol` slot. `MetadataManager`,
  which occupies `metadata`, has never had it. So the probe was false on every
  deployment and the dep was never passed: imported rows reached `sys_user`
  uncoerced, with the branch that says otherwise sitting right there. This is the
  same shape as #4127's dead `automation.trigger` and #4321's `registerInMemory`
  probes — a capability the code advertises and the runtime cannot deliver, kept
  invisible by the `any`. Typing the lookup to `IMetadataService` is what turned it
  into a compile error. The route reads `protocol` now.

  `/me/apps` reached ObjectQL's **private** `_registry` through `as any` while
  `/auth/me/permissions`, two handlers up in the same file, read the public
  `registry` getter over the same field of the same object. Both read the public
  accessor now; the one test that stubbed `_registry` was pinning the private reach
  and stubs `registry` instead.

  **Contract, from evidence.** `IDataEngine`'s read methods (`find` / `findOne` /
  `count` / `aggregate`) declare the trailing `options?: BaseEngineOptions`
  argument they have always accepted. ObjectQL's own doc explains why it exists:
  reads once took their context inside the query while writes took it in trailing
  `options.context`, so the same `{ context }` object was correct as `insert`'s 3rd
  argument and **silently dropped** as `find`'s — "an intended `isSystem` bypass
  just vanished". The engine accepts both channels; the contract exposed only the
  query one, so callers using the trailing channel — the current-user endpoints'
  permission-set loader among them — could only reach it by erasing the lookup.
  Adding an optional trailing parameter breaks no implementor (the existing
  minimal-implementation test proves it) and no caller. `BaseEngineOptions` was
  already exported, sitting unused under the "legacy/deprecated" heading, which is
  why the contract went looking and did not find it; it moves up beside the other
  QueryAST-aligned types with the rationale attached. One new spec test pins the
  trailing argument at the call site — the position where the old contract rejected it.

  **Where the contract does not reach, the escape hatch is named.** Three slots
  resist a spec type today and each gets a narrow, documented local interface
  instead of `any`: `security.permissions` (plugin-security's `PermissionEvaluator`
  — plugin-hono-server must not depend on an optional plugin), `settings`
  (service-settings' resolver, same reason), and ObjectQL beyond `IDataEngine`
  (`registry` / `getSchema` / `registerHook` / `registerMiddleware`). That last one
  is deliberate scope: the standing record on `getObjectQL` in `@objectstack/runtime`
  says ObjectQL is genuinely wider than `IDataEngine` and nobody has written the
  wider contract, so typing the whole thing `IDataEngine` would be "the more
  comfortable-looking lie". These declarations are what that contract gets written
  from, and what it deletes.

  No behavior changes beyond the two fixes above.

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
- Updated dependencies [fccec22]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [fae74b5]
- Updated dependencies [366105c]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [c20b875]
- Updated dependencies [f4d7f1d]
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
- Updated dependencies [f0d6594]
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
- Updated dependencies [99b4392]
- Updated dependencies [7309c81]
- Updated dependencies [495019b]
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
- Updated dependencies [be7945a]
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
- Updated dependencies [6c87cc9]
- Updated dependencies [af2a095]
- Updated dependencies [dd5daac]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [0931185]
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
  - @objectstack/rest@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/types@17.0.0-rc.1

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

- 7fb436c: Multi-organization operation is an ENTITLEMENT again: the `group` posture no
  longer activates without the enterprise runtime (ADR-0105 D12 correction).

  The first ADR-0105 wave read D12 as "the `group` wall ships open" and made the
  posture self-activating — it never probed for `@objectstack/organizations`. That
  turned `group` into a free multi-org path around the `isolated` gate (ADR-0081
  D2), and made the weaker isolation the free one, which is not a boundary anyone
  would draw on purpose.

  The distinction that was missed: **open code is not free activation.** The wall's
  implementation has always lived in the open packages — that is equally true of
  `isolated`, whose Layer 0 wall sits in `plugin-security` and is gated on a
  service the enterprise package registers. Cloud ADR-0016's 铁律
  (强制免费、治理收费) guarantees that a deployment RUNNING a multi-org shape is
  safe; it is satisfied by REFUSING to run one unwalled, not by giving the posture
  away.

  ## Changes

  - **`tenancy-service`**: `group` probes `org-scoping` exactly like `isolated`.
    Without it the posture resolves to `single` and reports `degraded`.
  - **`os serve`**: the ADR-0093 D5 boot guard keys off the resolved POSTURE
    instead of `OS_MULTI_ORG_ENABLED`. Previously `OS_TENANCY_POSTURE=group` skipped
    both the enterprise package load AND the fail-fast, silently degrading to an
    unwalled deployment — the exact ADR-0049 class that guard exists to close. A
    `group` request without the runtime now refuses to boot unless
    `OS_ALLOW_DEGRADED_TENANCY=1`.
  - **New seam — the runtime declares what it entitles.** `org-scoping` may expose
    `supportedPostures` (`OrgScopingEntitlement`, `@objectstack/spec/security`);
    the open side honours it and fails closed on anything not listed. Whether
    `group` and `isolated` are one commercial tier or two is packaging policy, and
    packaging policy belongs to the commercial runtime rather than hard-coded in
    open core. Omitting the field entitles every walled posture, so existing
    runtimes are unaffected.
  - **`organization_id` stamping returns to the enterprise runtime.** The previous
    wave moved auto-stamping into the open engine; that removed the closed
    package's only load-bearing runtime duty, so a five-line forged `org-scoping`
    registration would have produced a fully working multi-org deployment. With
    stamping back where it was, a forged registration yields NULL-org rows the wall
    hides — a broken deployment, not an unlicensed working one.

    **Write-side VALIDATION stays open and is unchanged**, including the
    bulk-insert coverage: rejecting a forged `organization_id` is a security
    property, not a packaging one. Only filling an ABSENT value moved back.

  - Default-organization bootstrap returns to `single`-only; every walled posture
    keeps its existing owner (ADR-0081 D1).

  ## Note for operators

  `OS_TENANCY_POSTURE=group` without `@objectstack/organizations` installed now
  **refuses to boot** rather than running single-org. This only affects
  deployments that adopted `group` between the two waves.

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

- 313d7be: feat(auth): `onInvitationAccepted` host seam — better-auth's
  `afterAcceptInvitation` forwarded to the host (ADR-0105 D8 prerequisite)

  An invitation may carry placement intent (target business unit + positions,
  extension fields on `sys_invitation` per the ADR-0092 whitelist), but there
  was no server-side seam to apply it when the invitation is accepted —
  better-auth's org-plugin models don't fire core `databaseHooks` (framework
  #3541 D8 note).

  `AuthManagerConfig.onInvitationAccepted` mirrors `onOrganizationCreated`:
  invoked from `organizationHooks.afterAcceptInvitation` with the mapped ids
  (`invitationId`, `organizationId`, `userId`, `memberId`, `role`, `email`)
  plus the RAW `invitation` / `member` rows so a host reads its own extension
  columns without a second query. Failure-isolated — acceptance never rolls
  back on a side-effect miss; hosts needing effectively-atomic placement
  should make the callback idempotent and reconcile on retry.

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

- 735f850: fix(security): resolve the ISSUER's real grants when authorizing invitation
  placement (ADR-0105 D8)

  Scoped-invitation issuance dry-runs `DelegatedAdminGate` against the
  `sys_user_position` rows the acceptance would write. The gate reads authority
  off `context.positions` / `context.permissions` — but the invitation hook
  handed it a hand-built `{ userId, tenantId }`, which carries neither. Every
  delegated administrator therefore resolved to the additive baseline alone and
  was refused:

  > requires tenant-level administration or a delegated adminScope (ADR-0090 D12)

  Fail-closed, but dead: only a tenant admin could ever issue a placement, which
  is the one case the feature was not for. Caught by cloud's group-posture
  dogfood, which exercises the real HTTP path with a real delegate.

  `assertIssuable` now takes `actorUserId` instead of a caller-built
  `actorContext` and resolves that user's grants itself through the single authz
  resolver (`@objectstack/core` `resolveUserAuthzGrants`) — the same envelope a
  transport would have carried, from the same reads. There is no request to
  resolve a context from inside a better-auth hook, so the id is what the caller
  can honestly supply and the resolution belongs behind the boundary.

  A principal-less call still reaches the gate with an empty context on purpose:
  the gate owns that refusal too, so the security boundary keeps exactly one
  place an issuance can be denied.

- 984396b: test(plugin-auth): enumerate better-auth's route table — the `/auth/**` wildcard becomes 55 exact rows (#3656)

  The widest hole the #3642 capstone measured. That guard reports how many SDK
  calls match only a `**` prefix family rather than a resolvable route, and the
  answer was 60 of ~196 — with 54 on `* /auth/**`, the largest and most
  security-relevant namespace in the client. `auth.me` builds
  `/api/v1/auth/get-session`; a prefix claim cannot tell you better-auth still
  calls it that, and better-auth is a third-party dependency on its own release
  cadence (this repo already chased its 1.7 column drift in #3624 / #3647).

  `plugin-auth` mounts it with a single catch-all, so there are no per-route
  registration calls to capture the way tranche 3 captured
  `registerStorageRoutes`. The seam is `auth.api`: every better-auth endpoint
  carries `.path` and `.options.method`, so a live instance is the route table.

  `auth-route-ledger.ts` reads it, in two halves checked differently on purpose:

  - **55 reviewed rows** — every route the SDK calls, each naming its client
    method, checked strictly against the live table. This is the rename detector.
  - **129-path mounted-surface inventory** — checked for exact equality both
    ways, so a version bump that adds publicly-mounted auth endpoints becomes a
    reviewable CI diff. Machine-maintained rather than reviewed prose: demanding
    a rationale for all 129 would make every better-auth upgrade a hundred-row
    review and the ledger would rot into rubber-stamping.

  Enumeration is config-dependent, so the inventory is pinned at the
  configuration enabling every plugin the SDK targets — the maximal surface —
  with the participating `OS_*` env vars cleared so a developer's shell cannot
  produce a spurious diff. Mutation-checked: renaming a ledgered route fails the
  suite naming it.

  The capstone guard now includes this ledger in its union and prefers exact rows
  over wildcard families when matching — without that ordering fix every
  `/auth/*` URL would still have been absorbed by `* /auth/**` and the new ledger
  would have changed nothing. Wildcard-only matches fall **60 → 3**; the ratchet
  moves with them. What remains is `* /ai/**`, whose routes `service-ai` builds
  at plugin start.

  No runtime change: a ledger, a guard, and the header/audit-doc notes.

- d0fea33: fix(auth): map ObjectQL `ValidationError` to a 4xx on the better-auth paths (#3398)

  A field-level validation failure raised by the ObjectQL record-validator
  (e.g. an invalid `image` on `POST /api/v1/auth/update-user`) surfaced to the
  HTTP client as a **raw 500 with an empty body**. better-auth only maps its own
  `APIError`s to structured responses; any other error thrown from an adapter
  method propagates to better-call's router as an unhandled fault → `500 {}`.

  Added the auth-path analogue of the REST layer's `mapDataError`: the objectql
  adapter now detects the ObjectQL validation envelope at its boundary (duck-typed
  by `code` / `name`, so plugin-auth keeps no hard dependency on
  `@objectstack/objectql` and cross-realm `instanceof` can't bite) and re-throws
  it as `APIError('BAD_REQUEST', …)`. `update-user` and friends now answer with a
  `400 { code: 'VALIDATION_FAILED', message, fields }` instead of an opaque 500.

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

- 5faeac6: fix(auth): spell isLikelyEmail's ASCII guard with printable bounds (no control char)

  The non-ASCII guard added in framework#3566 was written as `[^\x00-\x7f]`, whose
  regex literal embeds a control character (`\x00`). Rewrite it as `[^\x20-\x7e]` —
  identical behaviour (anything outside printable ASCII fails the email
  pre-filter), but the pattern no longer carries a control character (eslint
  `no-control-regex`), and it matches the objectui side's `isPlausibleEmail`.

- cde1975: fix(dev): eliminate three fixed startup log warnings so official examples boot clean (#3420)

  `os dev` on the stock showcase printed three fixed noise sources on every boot,
  with zero example-side changes — training users to ignore warnings.

  - **spec** — add a field-level `ackPlaintextMasking: true` opt-out for the
    generic `password` author-time warning (ADR-0100). A deliberately-masked
    field (like field-zoo's `f_password`) can now affirm intent instead of
    printing an un-actionable "safe to ignore" on every boot; the warning text
    points authors at the flag.
  - **plugin-auth** — pass better-auth's documented
    `silenceWarnings.oauthAuthServerConfig` to `oauthProvider(...)`. We already
    mount the `/.well-known/oauth-authorization-server` documents ourselves at
    the issuer root, so the plugin's "please ensure it exists" reminder was a
    false positive (printed twice); silencing it removes both.
  - **objectql** — route the Registry's re-register / package-overwrite lines
    (normal rebuild / HMR / seed-replay paths) through a new debug-only
    `SchemaRegistry.debug()` so they stay out of the default `info` boot log. Adds
    a `logLevel` construction option (and matching `OS_REGISTRY_LOG` env var) so
    the debug-gated housekeeping is discoverable for troubleshooting.

- a629074: fix(auth): the second factor now obeys the operator's lockout policy instead of better-auth's defaults (#3690)

  `auth-manager.ts` constructed `twoFactor()` with a schema and nothing else, so
  better-auth's built-in `accountLockout` defaults — on, 10 attempts, 15 minutes —
  governed two-factor verification no matter what the admin configured. An operator
  who tightened **Setup → Authentication → Account lockout threshold** to 3 got a
  password stage that locked at 3 and a second factor that still locked at 10: the
  stricter door was the looser one, with nothing in the UI saying so.

  `lockout_threshold` / `lockout_duration_minutes` are now projected onto
  better-auth's own `accountLockout` shape (`enabled` / `maxFailedAttempts` /
  `durationSeconds`, minutes converted to seconds) rather than growing a parallel
  `two_factor_lockout_*` pair — one policy, one mental model, and a future upstream
  field arrives as a new option instead of a conflict. The projection goes through
  `applyConfigPatch`, which resets the cached better-auth instance, so a settings
  change takes effect without a restart.

  Threshold `0` is deliberately **not** forwarded as `enabled: false`. It is the
  password stage's "off", and a deployment may leave that stage unlocked because
  rate limiting or an IdP covers it; the second factor is the last check before a
  session is issued, so it keeps better-auth's default rather than being switched
  off by a setting that never mentioned it.

  The threshold field is also no longer hidden behind `email_password_enabled` —
  two-factor verification exists in passwordless deployments, where the setting was
  previously unreachable.

  The admin **Unlock Account** action now clears both stages. It only ever reset
  `sys_user`, so a user locked at the second factor had no admin escape hatch and
  had to wait the duration out — survivable while that lock needed 10 failures,
  routine once an operator can set the threshold to 3. The second-factor clear is
  best-effort and runs after the primary write, so an account with no enrolment
  still unlocks normally.

  Note the plugin caps attempts at 5 per challenge (`beginAttempt(5)`), which no
  option reaches; a threshold above 5 forces a fresh challenge rather than raising
  that cap.

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
- Updated dependencies [3c8cfd1]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [f92096b]
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
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [1003125]
- Updated dependencies [6e62a93]
- Updated dependencies [ecda20c]
- Updated dependencies [6e62a93]
- Updated dependencies [fc968af]
- Updated dependencies [0bfdf46]
- Updated dependencies [3949a43]
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
- Updated dependencies [ce1f100]
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
- Updated dependencies [65ac468]
- Updated dependencies [ef5e72d]
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
- Updated dependencies [16adb3c]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [bbd902d]
- Updated dependencies [5ac93d4]
- Updated dependencies [3d5f726]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [d318b24]
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
  - @objectstack/rest@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/types@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
- Updated dependencies [818e6a3]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/rest@16.1.0
  - @objectstack/types@16.1.0

## 16.0.0

### Minor Changes

- 616e839: **Bulk user import defaults to `auto` — prefer invite per row, temporary only for undeliverable rows (#3236).** The identity import endpoint (`POST /api/v1/auth/admin/import-users`) gains a fourth `passwordPolicy`, **`auto`**, and it is now the **default** (was `none`).

  `auto` decides **per row** instead of forcing one policy on the whole batch:

  - a row with a deliverable channel — a **real email + a wired email service**, or a **phone + a wired SMS-invite path** — is **invited** (a set-your-password email, or an invitation SMS for phone-only rows), so no shared secret ever leaves the server;
  - a row with **no** deliverable channel (placeholder email, phone-only without SMS, or an email row when no email service is wired) falls back to a **temporary password**, returned once in the response with `must_change_password` stamped.

  This shrinks the temporary-password blast radius from "the whole batch" to "only the rows that genuinely can't be reached", and — unlike `invite` — `auto` **never rejects the request for missing infrastructure**: with nothing wired, every row simply degrades to temporary. The per-row outcome is surfaced on `rows[].delivery` (`email` / `sms` / `temporary`) with a batch breakdown on `summary.delivery` (also recorded in the run audit).

  The three existing policies are unchanged and still selectable explicitly:

  - `invite` — force the invite path for every row; unreachable rows are **failed** per-row (never downgraded). Pick this when a temporary-password fallback is unacceptable.
  - `temporary` — force a generated temporary password for every row.
  - `none` — identity only, no password and no invitation.

  **Behavior change to note:** callers that **omit** `passwordPolicy` previously got `none` (no credential, no outbound message); they now get `auto`, which proactively sends invitations to deliverable rows (and returns temporary passwords for the rest). Callers that want the old identity-only behavior must pass `passwordPolicy: 'none'` explicitly. Every call that already passes an explicit policy is unaffected, and the response is a strict superset (adds the `delivery` fields).

### Patch Changes

- deb7e7e: fix(plugin-auth): run better-auth adapter WRITES as system context so #2948 doesn't strip readonly identity columns (#3164)

  The better-auth ObjectQL adapter wrapped the engine so its READS carried
  `isSystem` (to bypass the control-plane org-scope read hook), but its WRITES
  passed through with no context. The static-`readonly` UPDATE strip (#2948) runs
  on any non-system update — and since the adapter carries no caller context,
  `!ctx?.isSystem` was `true`, so the strip silently DROPPED better-auth's own
  writes to readonly `sys_user` columns: `email` (change-email), `banned` /
  `ban_reason` / `ban_expires` (admin ban). Those operations returned success but
  never persisted.

  `withSystemReadContext` is renamed to `withSystemContext` (a deprecated alias is
  kept for one release) and now injects `isSystem` on `insert` / `update` /
  `delete` as well as reads. This is correct because these are the identity
  authority's own writes — user-context writes to `managedBy: 'better-auth'` tables
  are already rejected upstream by the ADR-0092 identity write guard, so the
  adapter path only ever carries better-auth's internal writes.

  Found while implementing #3043 (the INSERT-side readonly strip). This is its
  UPDATE-side dual: #3043 relocated the insert strip to the external ingress
  precisely because internal writers (this adapter included) don't declare
  `isSystem`; the pre-existing engine-level UPDATE strip has no such relocation, so
  the adapter had to declare its writes system.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

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
  - @objectstack/rest@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/types@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/rest@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1
  - @objectstack/types@16.0.0-rc.1

## 16.0.0-rc.0

### Minor Changes

- 616e839: **Bulk user import defaults to `auto` — prefer invite per row, temporary only for undeliverable rows (#3236).** The identity import endpoint (`POST /api/v1/auth/admin/import-users`) gains a fourth `passwordPolicy`, **`auto`**, and it is now the **default** (was `none`).

  `auto` decides **per row** instead of forcing one policy on the whole batch:

  - a row with a deliverable channel — a **real email + a wired email service**, or a **phone + a wired SMS-invite path** — is **invited** (a set-your-password email, or an invitation SMS for phone-only rows), so no shared secret ever leaves the server;
  - a row with **no** deliverable channel (placeholder email, phone-only without SMS, or an email row when no email service is wired) falls back to a **temporary password**, returned once in the response with `must_change_password` stamped.

  This shrinks the temporary-password blast radius from "the whole batch" to "only the rows that genuinely can't be reached", and — unlike `invite` — `auto` **never rejects the request for missing infrastructure**: with nothing wired, every row simply degrades to temporary. The per-row outcome is surfaced on `rows[].delivery` (`email` / `sms` / `temporary`) with a batch breakdown on `summary.delivery` (also recorded in the run audit).

  The three existing policies are unchanged and still selectable explicitly:

  - `invite` — force the invite path for every row; unreachable rows are **failed** per-row (never downgraded). Pick this when a temporary-password fallback is unacceptable.
  - `temporary` — force a generated temporary password for every row.
  - `none` — identity only, no password and no invitation.

  **Behavior change to note:** callers that **omit** `passwordPolicy` previously got `none` (no credential, no outbound message); they now get `auto`, which proactively sends invitations to deliverable rows (and returns temporary passwords for the rest). Callers that want the old identity-only behavior must pass `passwordPolicy: 'none'` explicitly. Every call that already passes an explicit policy is unaffected, and the response is a strict superset (adds the `delivery` fields).

### Patch Changes

- deb7e7e: fix(plugin-auth): run better-auth adapter WRITES as system context so #2948 doesn't strip readonly identity columns (#3164)

  The better-auth ObjectQL adapter wrapped the engine so its READS carried
  `isSystem` (to bypass the control-plane org-scope read hook), but its WRITES
  passed through with no context. The static-`readonly` UPDATE strip (#2948) runs
  on any non-system update — and since the adapter carries no caller context,
  `!ctx?.isSystem` was `true`, so the strip silently DROPPED better-auth's own
  writes to readonly `sys_user` columns: `email` (change-email), `banned` /
  `ban_reason` / `ban_expires` (admin ban). Those operations returned success but
  never persisted.

  `withSystemReadContext` is renamed to `withSystemContext` (a deprecated alias is
  kept for one release) and now injects `isSystem` on `insert` / `update` /
  `delete` as well as reads. This is correct because these are the identity
  authority's own writes — user-context writes to `managedBy: 'better-auth'` tables
  are already rejected upstream by the ADR-0092 identity write guard, so the
  adapter path only ever carries better-auth's internal writes.

  Found while implementing #3043 (the INSERT-side readonly strip). This is its
  UPDATE-side dual: #3043 relocated the insert strip to the external ingress
  precisely because internal writers (this adapter included) don't declare
  `isSystem`; the pre-existing engine-level UPDATE strip has no such relocation, so
  the adapter had to declare its writes system.

- fdc244e: Dev-loop DX fixes from the 15.1 third-party evaluation (P2 batch):

  - **Hot-added objects are now queryable without a restart.** Adding a `*.object.ts` under `os dev` used to recompile "green" while every query answered `no such table` (or `not registered`) until a manual restart: the artifact reload never notified the ObjectQL registry, tables were only created at boot, and seeds only loaded from the boot-time bundle. The `metadata:reloaded` payload now carries the parsed artifact; ObjectQL ingests the object definitions and re-runs the idempotent schema sync (same `skipSchemaSync` opt-out as boot), and the runtime loads seeds for first-seen objects (dev, single-tenant). `os dev` also prints `✚ new object(s): …` on recompile.
  - **Dev admin credentials stay visible.** The `os dev` startup banner only showed `admin@objectos.ai / admin123` on the boot that actually seeded it; with the persistent default DB every later boot hid it, and the Console login page never knew it existed. The hint now re-arms on every dev boot for as long as the account still verifies against the default password, and `GET /api/v1/auth/config` exposes a dev-gated `devSeedAdmin` field (never present outside `NODE_ENV=development`) so the login page can show it.
  - **`os doctor` reference analysis understands current metadata shapes.** Objects bound through `defineView` containers (`list`/`listViews`/`form`/`formViews` → `data.object`, subform `childObject`, lookup form fields) and app navigation (`objectName`, nested `children`, `areas`) were reported as "defined but not referenced". The collector now walks the canonical shapes (plus flow node `config.object`/`objectName`) and the orphan-view check descends into containers.

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
  - @objectstack/rest@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/types@16.0.0-rc.0

## 15.1.1

### Patch Changes

- 9dbb883: Contain the blast radius of a failing optional better-auth plugin: core email/password + session auth now stays up when an optional feature plugin throws during initialization.

  Previously, one throwing optional plugin (the 15.1.0 incident: `@better-auth/oauth-provider` threw `Cannot set properties of undefined (setting 'modelName')` from a 1.6/1.7 version mix) failed the whole lazily-built better-auth instance, turning EVERY auth endpoint — sign-up, sign-in, get-session — into a 500.

  `AuthManager.buildPluginList` now classifies plugins in two tiers. Optional feature plugins (organization, admin, phoneNumber, magicLink, genericOAuth, jwt+oauthProvider as one atomic unit, sso, scim, deviceAuthorization) are constructed through an isolation wrapper: on failure the feature is skipped with a loud actionable `console.error`, recorded in `getDegradedAuthFeatures()`, and its endpoints 404 while core auth keeps working. Security-bearing plugins (bearer, twoFactor, haveIBeenPwned, customSession with its ADR-0069 authGate) still fail hard — better a hard 500 than silently weakened auth (e.g. 2FA-enrolled accounts signing in on password alone).

  The OIDC discovery mount (`/.well-known/{oauth-authorization-server,openid-configuration}`) checks the degraded set and skips advertising an IdP whose endpoints did not come up, with a clear error log instead of sending external clients into 404s.

- 01ba3b3: Fix fresh-project auth returning 500 on every endpoint (sign-up / sign-in / get-session) with `Cannot set properties of undefined (setting 'modelName')`.

  The published manifest declared `better-auth`, `@better-auth/core`, `@better-auth/oauth-provider`, and `@better-auth/sso` as `^1.6.23`, while only `@better-auth/scim` was pinned to `1.7.0-rc.1` (GHSA-j8v8-g9cx-5qf4 is fixed only in the 1.7.0 pre-release line). The framework workspace forces the whole better-auth family to `1.7.0-rc.1` via pnpm overrides, but overrides do not ship with published packages — a downstream `npx create-objectstack` install resolved the `^1.6.23` ranges to 1.6.23 (still the npm `latest`), and the resulting 1.7/1.6 mix crashes during better-auth initialization, so every fresh 15.1.0 project shipped with broken auth.

  All four packages are now pinned to the exact `1.7.0-rc.1` — the only combination the workspace actually builds and tests against. The pins will be relaxed to `^1.7.0` once a stable better-auth 1.7.0 ships. A new CI gate (`scripts/check-override-consistency.mjs`) fails whenever a pnpm-workspace override target is not reachable from a publishable package's declared range, so tested-vs-published drift like this cannot recur silently.

  - @objectstack/spec@15.1.1
  - @objectstack/core@15.1.1
  - @objectstack/types@15.1.1
  - @objectstack/platform-objects@15.1.1
  - @objectstack/rest@15.1.1

## 15.1.0

### Patch Changes

- f531a26: fix(plugin-auth): re-run membership backfill when app seeding settles (#2996)

  The ADR-0093 D6 membership backfill — the only safety net for users created
  by app seeds (raw `engine.insert` into `sys_user` bypasses better-auth's
  `user.create.after` reconciler) — ran only once on `kernel:ready`. When a seed
  bundle overruns its inline budget (`OS_INLINE_SEED_BUDGET_MS`, default 8s) it
  finishes in the background _after_ `kernel:ready`, so its users stayed
  member-less in single-org `auto` mode until the next restart re-ran the backfill.

  `AppPlugin` now emits a new **`app:seeded`** lifecycle event when an app's inline
  seed settles (success, partial, or fallback) — carrying `{ appId, overBudget }`,
  where `overBudget: true` marks the post-`kernel:ready` background case. plugin-auth
  subscribes and re-runs the (idempotent, self-guarding, opt-out-able)
  `backfillMemberships` on that signal, closing the window without waiting for a
  restart. No behavior change when a seed completes within budget, in multi-tenant
  mode, or under `invite-only` policy; `OS_SKIP_MEMBERSHIP_BACKFILL=1` still opts out.

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
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/rest@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/types@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [a581a65]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/rest@15.0.0
  - @objectstack/types@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [e46169c]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/rest@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/types@14.8.0

## 14.7.0

### Minor Changes

- 824a395: Tenancy mode as a first-class capability + a single owner for the user→membership
  lifecycle (ADR-0093, Phases 1–3).

  **Tenancy service (`@objectstack/types`, `@objectstack/plugin-auth`).** plugin-auth
  registers a `tenancy` service — the single source of truth for tenancy mode
  (`mode`, `isolationActive`, `requested`, `degraded`, `defaultOrgId()`). It derives
  `isolationActive` from the presence of the `org-scoping` service, so the
  enterprise `@objectstack/organizations` package lights it up with no change.
  SecurityPlugin's RLS-strip gate and `/auth/config` (`features.multiOrgEnabled`,
  new `features.degradedTenancy`) now consume it instead of re-deriving the fact.

  **Fail-fast on degraded tenancy (`@objectstack/cli`, ADR-0093 D5).**
  `OS_MULTI_ORG_ENABLED=true` without a working `@objectstack/organizations` now
  **refuses to boot** — a deployment that requested tenant isolation must not serve
  traffic without it (tenant RLS would be silently stripped). Escape hatch:
  `OS_ALLOW_DEGRADED_TENANCY=1` boots in an explicitly branded degraded state
  (`features.degradedTenancy`). **This may halt upgrades for deployments that were
  silently degraded — intentionally; install the enterprise package or set the
  escape hatch.**

  **Membership reconciler (`@objectstack/plugin-auth`, ADR-0093 D1–D3, D6).** A
  single reconciler composed into better-auth's `user.create.after` hook owns the
  "every new user gets a membership" invariant across all creation paths (signup,
  admin create-user, import, SSO JIT). It yields to any existing membership (host
  hooks win), honors a new `membershipPolicy: 'auto' | 'invite-only'` auth option
  (default `auto`), and binds only to an unambiguous target org (single-org default;
  multi-org binds nothing). A bounded, idempotent `kernel:ready` backfill covers
  pre-existing member-less users in single-org/auto deployments
  (`OS_SKIP_MEMBERSHIP_BACKFILL=1` to opt out). The endpoint-level create-user bind
  from #2882 now delegates to this shared reconciler.

  New env vars: `OS_ALLOW_DEGRADED_TENANCY`, `OS_SKIP_MEMBERSHIP_BACKFILL`. New docs:
  Deployment → Tenancy Modes & Membership.

### Patch Changes

- da5e686: fix(auth): create-user membership bind is tenancy-mode-aware; export the ADR-0093 host API

  Multi-org runtime verification (real `@objectstack/organizations` linked into a
  live stack) caught a gap in the #2884 endpoint bind: it resolved its target org
  via `resolveDefaultOrgId` (slug='default' first), so in a multi-org deployment —
  where the bootstrap default org coexists with real tenant orgs — `/admin/create-user`
  would have bound the new user into the default org, violating ADR-0093 D3
  ("the framework never guesses in multi mode"). The bind now consults the
  `tenancy` service (`getTenancy` on the endpoint deps): single mode → default org,
  multi mode → no bind. Verified live: multi-org create-user and sign-up both leave
  the new user member-less (invites / host hooks own membership there); single-org
  behavior unchanged.

  Also exports `reconcile-membership` and `tenancy-service` from the package index
  as the public host API, and adds dogfood integration tests driving the REAL
  better-auth pipeline: sign-up membership via the reconciler hook alone, backfill
  bind + idempotency, invite-only refusal, and the yield-to-host-membership rule.

- Updated dependencies [d6a72eb]
- Updated dependencies [824a395]
  - @objectstack/spec@14.7.0
  - @objectstack/types@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/platform-objects@14.7.0
  - @objectstack/rest@14.7.0

## 14.6.0

### Patch Changes

- 160d565: fix(auth): guarantee an absolute https origin for every user-facing auth URL

  Follow-up to the invitation-link fix. Several other user-facing links were
  built from the raw `config.baseUrl` with no scheme guarantee, so a bare-host
  `baseUrl` (e.g. `cloud.objectos.ai`) produced relative-looking, unclickable
  links. All now flow through the hardened `getCanonicalOrigin()` (prepends
  `https://` when the scheme is missing, trims a trailing slash):

  - better-auth `baseURL` — the reset-password, verify-email and magic-link
    email links are derived from it.
  - OAuth `loginPage` / `consentPage` redirect targets.
  - Device-authorization `verificationUri`.
  - The phone-invite SMS `{{baseUrl}}`.

  Deployments that already configure an absolute `baseUrl` are unaffected.

- e4cf774: fix(auth): single-source Console page-URL construction; correct SMS + OAuth-callback landing paths

  Root-cause hardening after the invitation-link fixes. Every user-facing link
  to a Console page is `${origin}${uiBasePath}${path}`, but that composition was
  hand-written at each call site — which is how the scheme / `/_console` prefix
  kept getting dropped one link at a time.

  **plugin-auth**

  - New single-source `getConsolePageUrl(path)` helper; `loginPage`,
    `consentPage`, device `verificationUri` and the invitation accept URL all
    compose through it, so future page links can't drift.
  - Phone-invite SMS now links to the actual Console sign-in page
    (`${origin}${uiBasePath}/login`) via a new `{{loginUrl}}` template variable
    instead of the bare origin. `{{baseUrl}}` is still provided for backward
    compatibility with tenant-overridden templates.

  **client**

  - `signInWithProvider` now defaults `callbackURL` to the current page
    (`window.location.href`) instead of a hard-coded `origin + '/login'`. The
    SDK cannot know the app's mount path (Console lives under `/_console`), so
    returning the user to where they started is the only base-path-correct
    default; it also mirrors `linkSocial`. Pass an explicit `callbackURL` to
    override.

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/rest@14.6.0
  - @objectstack/types@14.6.0

## 14.5.0

### Minor Changes

- a348394: feat(auth): identity write guard — `managedBy: 'better-auth'` is now enforced at the engine (ADR-0092 D2/D3/D6)

  Every object whose schema declares `managedBy: 'better-auth'` (`sys_user`,
  `sys_member`, `sys_session`, `sys_api_key`, …) is now protected by engine
  `beforeInsert` / `beforeUpdate` / `beforeDelete` hooks registered by
  plugin-auth: **user-context** writes through the generic data path are
  rejected fail-closed with `403 PERMISSION_DENIED`, closing the hole where a
  wildcard admin permission set could raw-write any identity column (including
  `email` and credential stamps) via the data API. Internal writes are
  unaffected — the better-auth adapter, `isSystem` plugin/system contexts, and
  the identity import keep working unchanged.

  The only opening is a per-object update whitelist
  (`registerManagedUpdateWhitelist(object, fields)`): non-whitelisted fields are
  stripped from the payload, and a payload that strips to nothing throws. The
  first registration ships here: `sys_user → { name, image }` (pure profile
  fields), backed by the new shared `SYS_USER_PROFILE_EDIT_FIELDS` /
  `SYS_USER_IMPORT_UPDATE_FIELDS` constants — the import upsert's field
  discipline is now derived from the same module (subset-by-construction, no
  drift).

  After a guarded profile edit, an `afterUpdate` companion hook re-writes the
  user's cached `{session, user}` snapshots in better-auth's secondary storage
  (same TTL, mirror of better-auth's own `refreshUserSessions`) so session
  reads stay coherent; it rewrites rather than deletes, and no-ops when no
  secondary storage is wired.

  Migration note: server-side scripts that previously updated identity tables
  with a **user** execution context must either run with a system context
  (`{ isSystem: true }`) if they are genuinely internal, or move to the
  dedicated auth endpoints (invite / create-user / set-user-password / ban /
  better-auth APIs). Flows and automations that wrote non-profile `sys_user`
  columns under a user identity are now filtered the same way.

- 5bced2f: feat(auth): `passwordPolicy: 'none'` is the identity import's new default — import provisions identity, not credentials

  `POST /api/v1/auth/admin/import-users` now supports (and defaults to)
  `passwordPolicy: 'none'`: accounts are created without a credential record
  (better-auth's optional-password create), so no password material is
  generated, returned, or distributed at all. Users first sign in through a
  channel — phone OTP, magic link, or a password-reset link — and the Console's
  existing credential-less detection (`hasLocalPassword()` → set-initial-password)
  nudges them to set a password afterwards.

  The `invite` policy also no longer mints a throwaway password: it creates the
  same credential-less account and sends the set-your-password invitation
  (better-auth's reset flow creates the credential record on first set).
  `temporary` is unchanged and remains the fallback for deployments without
  email/SMS infrastructure.

  Breaking-ish note: `passwordPolicy` was previously required — requests that
  omitted it got a 400. They now succeed with the `none` behavior.

- e2c05d6: feat(auth/i18n): localised, tenant-customisable phone SMS texts (#2815)

  The OTP and invitation SMS bodies were hard-coded English. They now resolve
  in two layers: a `sys_notification_template` row for
  `(auth.phone_otp | auth.phone_invite, channel 'sms', locale)` — editable in
  Setup, seeded once with built-in en/zh rows, tenant edits never overwritten —
  falling back to the bundled bilingual texts. The locale follows the
  deployment default (`localization.locale` setting, live-rebound); per-user
  locale is deferred until `sys_user` grows a locale column. The OTP wording
  is purpose-neutral (one provider template covers sign-in and reset, and the
  SMS reveals nothing about what the code unlocks). Template lookups are
  best-effort — an outage never blocks an OTP send — and the no-OTP-in-logs
  red line is unchanged.

### Patch Changes

- 3fd87b2: fix(auth): invitation accept link is now an absolute URL under the Console base

  `sendInvitationEmail` built the accept URL straight from `config.baseUrl` with
  no scheme guarantee and no UI mount prefix — `${baseUrl}/accept-invitation/<id>`.
  Two problems surfaced in real deployments:

  1. When `baseUrl` was a bare host (e.g. `cloud.objectos.ai`, no scheme), the
     emailed link was relative-looking; email clients would not linkify it and
     clicking it went nowhere.
  2. The accept-invitation page is a Console SPA route mounted under `uiBasePath`
     (default `/_console`) — the same router/basename as `/login`, `/register`
     and `/oauth/consent`, and the exact link the Console itself generates for its
     "copy invitation link" action (`${origin}${BASE_URL}accept-invitation/<id>`).
     The root-path link omitted that prefix, so it 404'd at the host root instead
     of resolving to the page.

  The link is now built as
  `${origin}${uiBasePath}/accept-invitation/<id>` via a hardened
  `getCanonicalOrigin()` that guarantees an absolute origin (prepends `https://`
  when `baseUrl` has no scheme). The scheme hardening also applies to the OAuth
  issuer / consent / device-flow URLs that share the helper. Deployments that
  mount the Console elsewhere are honoured through the existing `uiBasePath`
  config.

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [4d9dd7b]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/rest@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/types@14.5.0

## 14.4.0

### Patch Changes

- 9887465: fix(auth): make the self-service "Resend Verification Email" action work

  better-auth's stock `POST /send-verification-email` requires `{ email }` in the
  body, but the `sys_user` `resend_verification_email` action (record-header
  button, "email unverified" record alert, and record-section quick action) fires
  with an empty body — so the request bounced with `[body.email] Invalid input:
expected string, received undefined` and the button was permanently broken. A
  thin wrapper route now defaults the address to the authenticated caller's own
  session email when the body omits it, then re-dispatches through the real route.
  An explicitly-supplied `email` (admin / verify-screen path) passes through
  untouched.

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/rest@14.4.0
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

- c1064f1: feat(messaging/auth): SMS infrastructure + phone-number OTP first-login/reset (#2780)

  #2766 shipped phone+password sign-in but no OTP — the platform had no SMS
  delivery capability. This adds the missing infrastructure end to end:

  - **New `@objectstack/plugin-sms`** — `ISmsService`/`ISmsTransport` contracts
    (spec) with Aliyun SMS (ACS3-HMAC-SHA256, template-based) and Twilio
    transports plus a dev log fallback. Configured through the new `sms`
    settings namespace (live provider rebind, encrypted secrets, send-test
    action; `OS_SMS_*` env keys win at the resolver). Deliberately NO message
    persistence and NO body logging — SMS bodies carry OTP codes.
  - **Messaging `sms` channel** — registered at kernel:ready when an `sms`
    service is present; `notify(channels:['sms'])` resolves
    `sys_user.phone_number`, renders `(topic,'sms',locale)` templates, and
    inherits outbox retry/dead-letter.
  - **Phone OTP flows open** — the phoneNumber plugin's `sendOTP` /
    `sendPasswordResetOTP` now deliver via SMS, enabling
    `/phone-number/send-otp` + `/verify` (OTP sign-in/verification) and
    `/phone-number/request-password-reset` + `/reset-password` (self-service
    reset). Without a deliverable SMS service they keep failing loudly
    (NOT_SUPPORTED); `features.phoneNumberOtp` advertises real availability.
    Shipped with the abuse hardening: explicit `allowedAttempts: 3`, always-on
    per-number cooldown (60s) + rolling-hour cap (5, secondaryStorage-shared
    across nodes), `/phone-number/*` in the settings-bound per-IP rate-limit
    rules, and OTP codes never reach logs or error messages.
  - **Import SMS invites** — `/admin/import-users`'s `invite` policy now
    supports phone-only rows: a credential-free invitation SMS points the
    employee at phone-OTP first sign-in followed by self-set password; mixed
    files validate the reachable channel per row.

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
- Updated dependencies [bea4b92]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/rest@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/types@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/types@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/platform-objects@14.1.0
  - @objectstack/types@14.1.0

## 14.0.0

### Patch Changes

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

- 5be00c3: feat(mcp): spec-compliant OAuth 2.1 authorization for `/api/v1/mcp` (#2698)

  Any OAuth-capable MCP client (claude.ai custom connectors, Claude Desktop,
  Claude Code) can now connect to a deployment **self-serve**: no admin-minted
  API key, no central registry — you sign in through the browser as yourself and
  every tool call runs under your own permissions and row-level security.

  **Each deployment is its own authorization server**, backed by the embedded
  better-auth instance (`@better-auth/oauth-provider`). Rationale for the design
  decisions lives in #2698; the moving parts:

  - **Discovery**: `/.well-known/oauth-protected-resource` (RFC 9728, incl. the
    path-inserted variant for `/api/v1/mcp`) and
    `/.well-known/oauth-authorization-server` (RFC 8414, incl. the path-inserted
    variant for the `/api/v1/auth` issuer) are served from the deployment origin.
    401s from `/api/v1/mcp` advertise the resource metadata via
    `WWW-Authenticate`, so clients bootstrap the flow automatically.
  - **Dynamic Client Registration (RFC 7591)** is enabled (unauthenticated, as
    the MCP spec requires) whenever the MCP surface is on — every deployment is a
    distinct AS, so clients cannot ship pre-registered IDs. Force it either way
    with `OS_OIDC_DCR_ENABLED` or the new `plugins.dynamicClientRegistration`
    auth-config field. The embedded AS itself auto-enables whenever the MCP
    surface is on — which is now the default (explicit
    `OS_OIDC_PROVIDER_ENABLED=false` still wins).
  - **Authorization-code + PKCE** flow with RFC 8707 resource binding: access
    tokens are minted with `aud=<origin>/api/v1/mcp` and verified locally
    (signature/issuer/audience/expiry) against the deployment's own JWKS —
    fail-closed parity with API keys: unknown/expired/wrong-audience tokens,
    sub-less M2M tokens, or a presented-but-invalid bearer never fall back to an
    ambient session, they 401.
  - **Token → ExecutionContext**: a valid access token resolves to the same
    principal-bound `ExecutionContext` as every other credential, single-sourced
    through `resolveAuthzContext` — OAuth adds a second _provenance_ for the
    principal, not a second authz model. `ExecutionContext` gains an optional
    `oauthScopes` field carrying the token's granted scopes.
  - **Coarse scopes → tool families**, enforced at tool dispatch: `data:read`
    (list/describe/query/get), `data:write` (create/update/delete),
    `actions:execute` (list_actions/run_action). Constants live in
    `@objectstack/spec/ai` (`MCP_OAUTH_SCOPES`). Tools outside the grant are not
    registered — and therefore rejected — for that request. API-key and session
    principals are unaffected (not scope-limited).
  - **TLS required, localhost exempt** (OAuth 2.1): on a plain-HTTP non-loopback
    origin the OAuth track stays dark (no metadata, no bearer acceptance) and the
    endpoint remains API-key-only. Local clients reach intranet deployments;
    claude.ai web connectors additionally need public HTTPS reachability.

  **API keys are unchanged** (dual-track): `x-api-key` / `Authorization: ApiKey` /
  `Authorization: Bearer osk_…` keep working exactly as before for CI and
  headless agents — covered by new regression tests.

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

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/platform-objects@12.6.0
  - @objectstack/types@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/platform-objects@12.5.0
  - @objectstack/types@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/platform-objects@12.4.0
  - @objectstack/types@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/platform-objects@12.3.0
  - @objectstack/types@12.3.0

## 12.2.0

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
  - @objectstack/types@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/platform-objects@12.1.0
  - @objectstack/types@12.1.0

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

- 1b1b34e: feat(auth): shared cross-node rate-limit + session store via the cache service (ADR-0069 D2)

  Multi-node deployments previously rate-limited **per process** — better-auth's
  default `rateLimit` store is in-memory, so each node counted independently and
  an attacker could rotate nodes to bypass the limit. `AuthPlugin` now wires the
  kernel `cache` service as better-auth's `secondaryStorage` and flips
  `rateLimit.storage` to `'secondary-storage'`, so rate-limit counters (and the
  session cache) are enforced against **one shared store across every node** —
  shared iff the cache service is (Redis adapter in a cluster; memory single-node,
  where behavior is unchanged). When no cache service is registered the plugin
  logs a warning that a multi-node deployment needs a shared cache (ADR-0069
  honesty — no silent per-process limiting presented as global).

  New `cacheSecondaryStorage(cache)` adapter (`ICacheService` → better-auth
  `SecondaryStorage`). Note: the cache has no atomic increment, so under high
  concurrency the get→set counter path can slightly over-count — acceptable for a
  rate limiter and strictly better than independent per-node counters; a future
  cache adapter exposing atomic INCR can add an `increment` method for exact
  counting.

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
  - @objectstack/types@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/platform-objects@11.10.0
  - @objectstack/types@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/platform-objects@11.9.0
  - @objectstack/types@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/types@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/types@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/types@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/platform-objects@11.5.0
  - @objectstack/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/platform-objects@11.4.0
  - @objectstack/types@11.4.0

## 11.3.0

### Patch Changes

- 59576d0: fix(auth): restore the admin gate on POST /admin/oauth-application/toggle-disabled after ADR-0068

  ADR-0068 stopped `customSession` from synthesizing `user.role = 'admin'`;
  canonical roles now arrive in `user.roles[]` with `user.isPlatformAdmin` as a
  derived alias. The OAuth-client enable/disable route was missed in that
  migration and still gated on `session.user.role !== 'admin'`, which now rejects
  even platform admins (the scalar is no longer synthesized). It now mirrors the
  sibling /admin/unlock-user gate: `isPlatformAdmin` / `platform_admin` in
  `roles[]`, with the legacy `role` scalar as a fallback.

  Also corrects the now-stale `customSession()` doc comment in auth-manager that
  still described the removed `user.role = 'admin'` overwrite.

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/platform-objects@11.3.0
  - @objectstack/types@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/platform-objects@11.2.0
  - @objectstack/types@11.2.0

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

- 8c84c97: Auth: IP allow-list — network gating on the auth routes (ADR-0069 D5, P2)

  Adds an `allowed_ip_ranges` auth setting (CIDR ranges or exact IPs; empty = no restriction). A Hono middleware registered ahead of the better-auth handler in the auth-route registration rejects auth requests from a client IP outside the ranges with `403 IP_NOT_ALLOWED`, before they reach better-auth.

  - Client IP is read trust-proxy-aware from `x-forwarded-for` (first hop) / `cf-connecting-ip` / `x-real-ip`.
  - The public render helpers (`/config`, `/bootstrap-status`) are exempt so a blocked client still gets a clean login page + a clear error.
  - **Fails OPEN** when the client IP can't be determined (no proxy header), so a misconfigured proxy is a no-op rather than a lockout — an admin enabling this must ensure forwarded headers are trusted.
  - IPv4 CIDR (`a.b.c.d/n`) + exact IPv4/IPv6 matching.

  Default-off / additive; per ADR-0049 the setting ships with its enforcement.

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

- 18f9713: Auth: surface "SSO Providers" in the Setup app nav when SSO is enabled (ADR-0024 / cloud#551)

  The `sys_sso_provider` admin object (register / list / delete external OIDC IdPs) had no navigation entry, so an admin could only reach it by direct URL. `AuthPlugin` now contributes an **"SSO Providers"** entry into the Setup app's **Access Control** group — but only when the external-IdP RP is wired (`AuthManager.isSsoWired()`, which captures both self-host `OS_SSO_ENABLED` and the cloud per-env `planAllowsSso` arriving via `plugins.sso`). Owning-plugin-contributes pattern (ADR-0029 K2), mirroring `plugin-security`. `isSsoWired()` is made public for this gate.

- 7cf81a7: Auth: org-scope registered SSO/SAML providers so any org admin can manage them (ADR-0024 / cloud#551)

  `@better-auth/sso`'s provider-management endpoints (delete / update / domain verification) gate ORG-LESS providers on `provider.userId === caller` — only the original registrar could manage them, so a second org admin couldn't delete or verify an IdP someone else registered. The register bridges now resolve the caller's active organization (best-effort, via a `/get-session` re-dispatch) and scope the provider to it, so management gates on `isOrgAdmin` instead — **any** org owner/admin can manage the environment's IdPs. Falls back to org-less (no behavior change) when no active org is set.

  Verified E2E: an OIDC provider registered through the form lands with `organization_id` set to the env's org (was null); register + delete still succeed.

- d7a88df: Auth: SSO quality polish (ADR-0024 / cloud#551)

  - **plugin-auth**: `OS_OIDC_PROVIDER_ENABLED` / `OS_SSO_ENABLED` / `OS_SCIM_ENABLED` now parse with the shared `readBooleanEnv` helper (same as `OS_AUTH_TWO_FACTOR` etc.), so the platform-standard truthy set works (`true`/`1`/`yes`/`on`, case-insensitive) instead of only the literal `'true'` — a repeated operator footgun where `OS_SSO_ENABLED=1` silently parsed as disabled. Added unit tests.
  - **platform-objects**: `sys_sso_provider`'s list view gets a per-object empty state ("No SSO providers yet" + a pointer to "Register SSO Provider"), replacing the shared identity-object copy ("records are created automatically … cannot be added here") which is wrong for this object — it HAS a register action.

- 4f8f108: Auth: make the open-source SSO-provider registration form produce a usable IdP (ADR-0024 / cloud#551)

  The `sys_sso_provider` `register_sso_provider` UI action posted FLAT form fields to `@better-auth/sso`'s `/sso/register`, which expects the OIDC fields NESTED under `oidcConfig`. The top-level `clientId`/`clientSecret` were Zod-stripped, so the form persisted an `oidc_config = null` provider that could never complete a login ("Invalid SSO provider").

  - **plugin-auth**: new shared `runRegisterSsoProviderFromForm` helper reshapes the flat form body into the nested shape and re-dispatches it through the real `/sso/register` (so the admin gate, the public-routable `trustedOrigins` allowance, discovery hydration, and secret handling all still run). Exposed via a new `/admin/sso/register` bridge route on the host `AuthPlugin`. (The cloud per-env runtime mounts the same helper in its `AuthProxyPlugin` — mirrors `set-initial-password`.)
  - **platform-objects**: `register_sso_provider` retargets to `/api/v1/auth/admin/sso/register` and gains `discoveryEndpoint`, `scopes`, and attribute-mapping (`mapId`/`mapEmail`/`mapName`) fields. Open mechanism — keeps runtime IdP registration self-service in the OSS edition.

  Verified E2E: an admin registers an external OIDC IdP from the flat form → a member logs in through it (JIT-provisioned, `sys_account.provider_id` set); a non-admin is rejected (403) before discovery runs.

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [fdb41c0]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/types@11.1.0

## 11.0.0

### Minor Changes

- 21b3208: Auth: password complexity policy (ADR-0069 D1, P1)

  Adds `password_require_complexity` (toggle, default off) + `password_min_classes` (1–4, default 3) to the `auth` password-policy settings. A custom validator runs in the better-auth `before` hook on `/sign-up/email`, `/reset-password`, and `/change-password`, rejecting passwords that use fewer than `password_min_classes` of the four character classes (upper / lower / digit / symbol) with `PASSWORD_POLICY_VIOLATION` — better-auth natively enforces only min/max length.

  Default-off and additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement. No new identity fields. Continues the ADR-0069 P1 password-policy work alongside the HIBP breached-password reject (#2361).

- 9b5bf3d: Auth: password history / no-reuse (ADR-0069 D1, P1)

  Adds `password_history_count` (0–24, 0 = off) to the `auth` password-policy settings. On `/change-password` and `/reset-password`, a new password that matches the current password or any of the last N hashes is rejected with `PASSWORD_REUSE`. A new bounded `sys_account.previous_password_hashes` column (JSON ring, system-managed, hidden) backs the check; it is maintained by before/after hooks (capture the old hash, append on success).

  Reuses better-auth's native `password.verify` (no bespoke crypto) and resolves the reset-flow user via the same token lookup better-auth uses. Default-off / additive (no upgrade behavior change); per ADR-0049 the setting ships with its enforcement.

- cb5b393: Auth: account lockout + rate-limit tuning (ADR-0069 D2, P1)

  Second slice of ADR-0069 — per-identity brute-force protection, reusing the setting→enforcement pattern from the HIBP PR.

  - **Account lockout** `[custom][field]`: new `sys_user.failed_login_count` / `sys_user.locked_until` columns; `auth` settings `lockout_threshold` (0 = off) + `lockout_duration_minutes`. Enforced in the `/sign-in/email` before/after hooks — failures increment the counter, crossing the threshold stamps `locked_until`, and a locked account is rejected **even with the correct password** (survives IP rotation, unlike rate limiting). A successful sign-in resets both.
  - **Admin Unlock**: new admin-guarded `POST /api/v1/auth/admin/unlock-user` route + an `unlock_user` action on `sys_user`.
  - **Rate-limit tuning** `[native]`: `auth` settings `rate_limit_max` / `rate_limit_window_seconds` wire better-auth's core `rateLimit` with stricter `customRules` for `/sign-in/email`, `/sign-up/email`, `/request-password-reset`, `/reset-password`.

  All settings default off / to safe values; additive (no upgrade behavior change). Per ADR-0049 each setting ships with its enforcement. Timestamps are written as `Date` (never epoch-ms) per ADR-0074.

- ab5718a: Auth: reject breached passwords via Have I Been Pwned (ADR-0069 D1, P1)

  First slice of ADR-0069 (enterprise authentication hardening) and the enforcement-wired pattern template the rest of the ADR follows. Adds a `password_reject_breached` auth setting (default **off**) bound end-to-end to better-auth's native `haveibeenpwned` plugin — a k-anonymity range check on sign-up / change-password / reset-password (the plaintext password never leaves the process).

  - **spec**: new `passwordRejectBreached` flag on `AuthPluginConfigSchema`.
  - **service-settings**: new "Reject breached passwords" toggle in the `auth` manifest's password-policy group (`global` scope, `manage_platform_settings`).
  - **plugin-auth**: `bindAuthSettings` maps the setting into the plugin config; `buildPluginList` gates and mounts the `haveIBeenPwned` plugin (env `OS_AUTH_PASSWORD_REJECT_BREACHED` wins over config, mirroring `OS_AUTH_TWO_FACTOR`).
  - **cli**: surface the knob in the `serve` boot config alongside `twoFactor`.

  Default-off and additive — no behavior change on upgrade. Per ADR-0049 the toggle ships with its enforcement (no false surface). No new identity fields (the `[custom]` D1 items — complexity / expiry / history — land in follow-up PRs).

### Patch Changes

- caa3ef4: Auth: trust public-routable external-IdP origins at SSO registration (ADR-0024 / cloud#551)

  `@better-auth/sso`'s discovery validation requires every IdP endpoint origin to be in `trustedOrigins` — even for a publicly-routable IdP. That broke ADR-0024's "register your OIDC IdP at runtime, no boot config" promise: registering any external IdP returned `400 discovery_untrusted_origin` unless the operator had pre-listed it.

  When the external-SSO RP is enabled, `trustedOrigins` is now exposed as a per-request function that, for a `POST /sso/register` | `/sso/update-provider`, additionally trusts the **public-routable** issuer / `oidcConfig` endpoint origins declared in the request body (via `@better-auth/core`'s own `isPublicRoutableHost`). Private / internal / loopback hosts are never auto-trusted — they still require explicit `trustedOrigins` config (the documented SSRF escape hatch), and better-auth's own DNS-resolution checks still apply.

  Verified: a same-origin public IdP (GitLab.com — issuer and all discovered endpoints on one origin, like Okta / Entra / Auth0 / Keycloak) now registers at runtime with no boot config (was a hard 400). The admin gate still fires first (a non-admin is rejected before discovery runs). Note: IdPs that split endpoints across multiple domains (e.g. Google's `accounts.google.com` + `oauth2.googleapis.com`) still need those extra origins in `trustedOrigins`.

- 22b32c1: Auth: admin-gate self-service SSO provider registration + default-role JIT (ADR-0024 / cloud#551)

  `@better-auth/sso`'s `POST /sso/register` only enforces org-admin when `body.organizationId` is supplied — a **global** (org-less) provider passed on nothing but a valid session, so any authenticated env member could register an env-wide external IdP (a JIT-provisioning / login-routing vector). This closed the "registerSSOProvider is admin-only" requirement of ADR-0024's first slice.

  - **plugin-auth**: a `before`-hook on `/sso/register` now requires the caller to be a platform admin OR an owner/admin of their active org, regardless of `organizationId`. Fail-closed; unauthenticated requests still fall through to `sessionMiddleware` (→ 401). New helpers `resolveActor()` (hook-order-independent cookie/bearer resolution) and `isOrgOrPlatformAdmin()` (mirrors `customSession`'s role derivation; reads via `withSystemReadContext`).
  - **plugin-auth**: `sso()` now receives `organizationProvisioning.defaultRole:'member'` so a first-time federated login lands with an explicit role (over SecurityPlugin's `member_default` baseline).

  Additive and fail-closed — no behavior change for legitimate admins. The SSO mechanism stays framework-open (no identity-governance added).

- 1e8a813: feat(auth): surface `features.sso` in the public `/auth/config` response

  `getPublicConfig()` reported every other auth capability flag (`oidcProvider`,
  `twoFactor`, `multiOrgEnabled`, …) but omitted enterprise SSO, even though the
  manager already computes whether the domain-routed `@better-auth/sso` plugin is
  wired (`OS_SSO_ENABLED` / `plugins.sso`). Without it the login UI had no signal
  to gate on, so it rendered a "Sign in with SSO" button unconditionally — and on
  a self-hosted / local deployment where SSO isn't wired, clicking it only then
  surfaced "No SSO provider is configured for this email domain."

  The config now includes `features.sso`. `getPublicConfig()` returns the coarse
  "is the plugin wired" flag — resolved with the EXACT logic that decides whether
  the plugin is mounted in `buildPlugins()`, so the advertised capability can never
  disagree with the actual `/sign-in/sso` route. The `/auth/config` route then
  refines it to "usable" via the new `AuthManager.isSsoUsable()`, which additionally
  requires at least one `sys_sso_provider` row to exist — so a freshly-enabled but
  unconfigured SSO setup doesn't advertise a button that errors for everyone.
  `isSsoUsable()` only queries when wired and fails open to the wired flag on any
  introspection error (no data engine, query failure), so config never 500s. The
  console login form consumes `features.sso` to hide the button (objectui side).

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
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
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [795b6d1]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/types@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/types@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/platform-objects@10.2.0
  - @objectstack/types@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/platform-objects@10.1.0
  - @objectstack/types@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
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
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/core@10.0.0
  - @objectstack/types@10.0.0

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
  - @objectstack/core@9.11.0
  - @objectstack/platform-objects@9.11.0
  - @objectstack/types@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0
  - @objectstack/types@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/types@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 0d4e3f3: feat(auth): password-policy & session settings — live, enforced (P0 security)

  Extends the existing `auth` settings manifest (global scope) with the security policy keys that are **genuinely enforced today**, rather than standing up a new `security` namespace full of non-functional toggles (which would be false surface):

  - **Password policy** — `password_min_length` (default 8), `password_max_length` (default 128). Enforced by better-auth on sign-up and password reset.
  - **Sessions** — `session_expiry_days` (default 7, absolute lifetime), `session_refresh_days` (default 1, refresh threshold).

  These ride the existing `AuthPlugin.bindAuthSettings` → `AuthManager.applyConfigPatch` path (read on `kernel:ready`, re-applied live via `settings.subscribe('auth')`, which invalidates the cached better-auth instance). Days are converted to seconds for better-auth's `session.{expiresIn,updateAge}`; unset (`source: 'default'`) and malformed/non-positive values are ignored so the provider default holds. Ships en + zh-CN translations.

  Deliberately **out of scope** (no enforcement exists, so they're not declared as settings): MFA-required, IP allowlist, SSO/SAML, SCIM, API rate limits, password complexity/rotation/history. These are real features to be built, not settings toggles.

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
  - @objectstack/platform-objects@9.9.0
  - @objectstack/types@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0
  - @objectstack/types@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/types@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- 1b82b64: auth: expose `isPlatformAdmin` on the customSession user payload

  The session already derives a coarse `admin` role for platform admins or
  active-org admins, but never surfaced the underlying platform-admin signal.
  Console action `visible` CEL predicates need it to gate platform-admin-only
  object actions (e.g. `sys_environment.change_plan`) without hiding org-admin
  actions. Both `customSession` return paths now carry the boolean; org-admins
  who are not platform admins correctly get `isPlatformAdmin: false`.

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0
  - @objectstack/types@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1
  - @objectstack/types@9.5.1

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
  - @objectstack/types@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0
  - @objectstack/types@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0
  - @objectstack/types@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0
  - @objectstack/types@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0
  - @objectstack/types@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1
  - @objectstack/types@9.0.1

## 9.0.0

### Minor Changes

- f533f42: Settings namespace environment overrides now use the canonical ObjectStack
  `OS_<NAMESPACE>_<KEY>` form, with no unprefixed aliases. For example,
  `ai.openai_base_url` is now `OS_AI_OPENAI_BASE_URL`, and
  `feature_flags.ai_enabled` is now `OS_FEATURE_FLAGS_AI_ENABLED`.

  The AI service now treats a stored or env-locked `provider=memory` setting as
  an explicit override, while the manifest default still leaves boot-time
  provider auto-detection intact.

  The auth plugin now binds the `auth` settings namespace to better-auth runtime
  configuration, exposes an extension hook for provider packages, and includes a
  basic Google sign-in implementation configured either in Setup → Authentication
  or by deployment-level `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0
  - @objectstack/types@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/types@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- 1e8b680: fix(security): close four P0 launch-readiness findings

  - **plugin-auth (P0-1):** `generateSecret()` now throws (fails boot) when no
    `OS_AUTH_SECRET` is set and `NODE_ENV==='production'`, instead of silently
    falling back to a predictable `dev-secret-<timestamp>` (session forgery). The
    dev/test fallback is unchanged.
  - **plugin-security (P0-2):** the permission-resolution `catch` now **fails
    closed** — it logs at ERROR and throws `PermissionDeniedError` rather than
    `return next()`. A degraded metadata service can no longer let every
    authenticated request bypass RBAC/RLS. System operations still bypass as before.
  - **driver-sql (P0-3):** the `contains` / `$contains` operator now escapes LIKE
    metacharacters (`%` / `_` / `\`) in the user value and binds an explicit
    `ESCAPE '\'`, so a value of `%` matches literally instead of every row
    (filter bypass). Correct across SQLite/MySQL/Postgres.
  - **driver-mongodb (P0-4):** the field-operator translator now rejects unknown
    `$`-operators instead of passing them through, blocking `$where` / `$function`
    / `$expr` (server-side JS execution / query-intent bypass). All legitimate
    ObjectQL operators remain allowlisted.

  +12 regression tests across the four packages.

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
  - @objectstack/platform-objects@8.0.0
  - @objectstack/types@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/types@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0
  - @objectstack/types@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0
  - @objectstack/types@7.7.0

## 7.6.0

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
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/types@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/types@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/types@7.4.1
- @objectstack/platform-objects@7.4.1

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

### Patch Changes

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
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/types@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/types@7.3.0

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
  - @objectstack/spec@7.2.1
  - @objectstack/core@7.2.1
  - @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- 74470ad: **New `account` App for self-service identity management + `App.hidden` shell hint**

  Adds a dedicated **Account** App (`name: 'account'`, icon `user-circle`) that exposes the three end-user identity surfaces:

  - **Two-Factor Authentication** — `sys_two_factor`
  - **Linked Accounts** — `sys_account`
  - **OAuth Applications** — `sys_oauth_application`

  The app declares **no** `requiredPermissions`, so every authenticated user can reach it — unlike Setup, which requires `setup.access` and therefore excludes the default `member_default` permission set. Combined with the C-tier `resultDialog` actions already shipped on these objects (2FA QR + backup codes, OAuth `client_secret` reveal, `link_social` redirect), this replaces the legacy standalone `apps/account` SPA with a single console + metadata-driven surface.

  **New `App.hidden: boolean` field** (`packages/spec/src/ui/app.zod.ts`) hides an app from the top-level App Switcher. Hidden apps stay fully routable and permission-checked; the shell is expected to surface them through the avatar / user dropdown instead. Mirrors the GitHub Settings / Google account chip / Salesforce Personal Settings pattern. The Account app is the first user.

  Wiring: `plugin-auth` registers `ACCOUNT_APP` alongside `SETUP_APP` / `STUDIO_APP` (`packages/plugins/plugin-auth/src/auth-plugin.ts`). The legacy duplicate entries inside Setup's Advanced group are kept unchanged — they remain admin-only for tenant-wide inspection.

  **Follow-up for objectui**: the shell's `AppSwitcher` and avatar `DropdownMenu` need updating to honour `app.hidden` (filter hidden apps out of the switcher; render them as dropdown menu entries). Tracked separately.

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

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- de239ef: Fix WebContainer (StackBlitz) sign-up / sign-in failing with
  `INTERNAL_SERVER_ERROR: No request state found. Please make sure you are
calling this function within a `runWithRequestState` callback.`

  WebContainer reports itself as Node.js but its `node:async_hooks`
  implementation does not propagate `AsyncLocalStorage` context across
  `await` boundaries. As a result, better-auth's `runWithRequestState`
  wrap installed by `handleRequest` was lost as soon as the inner
  `customSession` → `getSession()` call chain awaited anything, and every
  endpoint that reads request state (e.g. `should-session-refresh`,
  `oauth`) threw "No request state found".

  `AuthManager` now detects WebContainer and pre-populates better-auth's
  global `requestStateAsyncStorage` slot with a synchronous polyfill
  before better-auth instantiates its own. The polyfill correctly
  propagates the store through awaited promises within a single
  `run()` call, which is sufficient for WebContainer's single-flight
  dev server. Production environments (real Node, Bun, edge runtimes)
  continue to use the native `AsyncLocalStorage` and are unaffected.

  - @objectstack/spec@6.5.1
  - @objectstack/core@6.5.1
  - @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- 0bf6f9a: Add explicit `@better-auth/core` dependency.

  `plugin-auth` already pulled `@better-auth/core` transitively via `@better-auth/oauth-provider`, but several call sites in `auth-manager.ts` import from it directly. Promote it to a first-class dependency so the resolved version is stable across the workspace and `pnpm install` doesn't surface "module not found" against the transitive copy under stricter peer resolution.

  No behaviour change.

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Minor Changes

- b4c74a9: WebContainer (StackBlitz) signup compatibility: `AuthManager` now auto-detects
  WebContainer runtimes at construction time and swaps better-auth's default
  `node:crypto.scrypt`-based password hasher for the pure-JS hasher from
  `@better-auth/utils/password` (which uses `@noble/hashes/scrypt` under the
  hood).

  **Why:** WebContainer's `node:crypto` polyfill ships an incomplete `scrypt`
  implementation that throws `TypeError: y.run is not a function` on every
  signup, blocking template demos on StackBlitz. The pure-JS implementation is
  byte-compatible with the Node hasher (same scrypt params, same `salt:keyHex`
  storage format), so accounts created under either hasher remain mutually
  verifiable — no migration, no template changes.

  **Scope:** detection short-circuits to `undefined` on real Node, so production
  deployments are completely unaffected — the JS fallback module is only
  dynamically imported when one of `process.versions.webcontainer`,
  `SHELL` containing `jsh`, or `STACKBLITZ` env is present.

  Templates (`@template/todo`, `@template/contracts`, …) require no changes;
  the fix lives entirely inside `@objectstack/plugin-auth`.

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## Unreleased

### Minor Changes

- Always register better-auth's `bearer()` plugin so cross-origin browsers
  (where third-party cookies are blocked) and native mobile clients can
  authenticate via `Authorization: Bearer <token>` headers and pick up
  rotated tokens from the `set-auth-token` response header (fixes #1172).

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

- e0b0a78: Deprecate DataEngineQueryOptions in favor of QueryAST-aligned EngineQueryOptions.

  Engine, Protocol, and Client now use standard QueryAST parameter names:

  - `filter` → `where`
  - `select` → `fields`
  - `sort` → `orderBy`
  - `skip` → `offset`
  - `populate` → `expand`
  - `top` → `limit`

  The old DataEngine\* schemas and types are preserved with `@deprecated` markers for backward compatibility.

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.3.0

### Minor Changes

- 814a6c4: sql driver

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- 1fe5612: fix vercel
  - @objectstack/spec@3.2.8
  - @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- 35a1ebb: fix auth
  - @objectstack/spec@3.2.7
  - @objectstack/core@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/core@3.2.6

## 3.2.5

### Patch Changes

- e854538: fix beyyer-auth
  - @objectstack/spec@3.2.5
  - @objectstack/core@3.2.5

## 3.2.4

### Patch Changes

- f490991: fix better-auth
  - @objectstack/spec@3.2.4
  - @objectstack/core@3.2.4

## 3.2.3

### Patch Changes

- 0b1d7c9: fix auth
  - @objectstack/spec@3.2.3
  - @objectstack/core@3.2.3

## 3.2.2

### Patch Changes

- cfaabbb: fix: AuthPlugin error handling & database adapter config

  - `AuthManager.handleRequest()` now inspects `response.status >= 500` and logs the error body via `console.error`, since better-auth catches internal errors and returns 500 Responses without throwing.
  - `AuthPlugin.registerAuthRoutes()` also logs 500+ responses via `ctx.logger.error` for structured plugin logging.
  - `createDatabaseConfig()` now wraps the ObjectQL adapter as a `DBAdapterInstance` factory function so better-auth's `getBaseAdapter()` correctly recognises it (via `typeof database === "function"` check) instead of falling through to the Kysely adapter path.

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

- Unify all package versions with a patch release
- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/core@2.0.5

## 2.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/core@2.0.4

All notable changes to `@objectstack/plugin-auth` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.2] - 2026-02-10

### Added

- Initial release of Auth Plugin
- Integration with better-auth library for robust authentication
- Session management and user authentication
- Support for OAuth providers (Google, GitHub, Microsoft, etc.)
- Organization/team support for multi-tenant applications
- Two-factor authentication (2FA)
- Passkey support
- Magic link authentication
- Configurable session expiry and refresh
- Automatic HTTP route registration
- Comprehensive test coverage

### Security

- Secure session token management
- Encrypted secrets support
- Rate limiting capabilities
- CSRF protection

[Unreleased]: https://github.com/objectstack-ai/spec/compare/v2.0.2...HEAD
[2.0.2]: https://github.com/objectstack-ai/spec/releases/tag/v2.0.2
