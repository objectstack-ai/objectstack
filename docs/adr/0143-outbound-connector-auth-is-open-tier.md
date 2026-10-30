# ADR-0143: Outbound connector auth is open tier — OAuth2 grants, vendor app-credential exchange and request signing in one declarative auth contract

**Status**: Accepted — 2026-10-28. Proposed 2026-10-27 (#26833, which also landed the six amendment
notes this record names). The maintainer answered the four [decisions](#decisions-put-to-the-maintainer)
on 2026-10-28. Each answer is recorded under its question, and D2.1, D2.3, D3, D4 and D7 state what the
answers settle. `docs/adr/` is Tier H (Prime Directive #14).
- **Deciders**: ObjectStack maintainer, 2026-10-27, verbatim and untranslated. On outbound connector OAuth:
  「OAuth 放开源层，先起草 ADR 修订」, 「平台基于 better-auth ，怎么会有没有 oauth」, 「创建issue 就行」. On request
  signing, the three recommendations of the MCP / OpenAPI directory survey: 「三条行动建议 立卡」 →
  「建议 1+2立卡」 → 「3 不考虑」 (recommendation 2 is request signing). On Q1–Q4, 2026-10-28: the
  maintainer asked for an independent analysis of the four decisions with a recommendation for each, then
  accepted the recommendations as written there: 「同意」.
- **Amends**: the outbound-connector-auth tier placement — and nothing else — in
  [ADR-0018](./0018-unified-node-action-registry.md) "Out of scope (deliberately not baseline)",
  [ADR-0022](./0022-connectors-vs-messaging-channels.md) §4,
  [ADR-0023](./0023-openapi-to-connector-generator.md) §4,
  [ADR-0024](./0024-mcp-connectors.md) §3–§4 and
  [ADR-0097](./0097-declarative-connector-instances.md) §3 and its "Open / enterprise line"; and the
  attribution of that placement to [ADR-0015](./0015-external-datasource-federation.md), which never drew
  it (see [Context](#where-the-enterprise-placement-came-from)). All six carry a dated amendment note.
- **Builds on**: [ADR-0097](./0097-declarative-connector-instances.md) (`credentialRef`, the
  `CredentialResolver` seam, degrade-don't-die), [ADR-0073](./0073-automation-execution-identity.md)
  (whose grant a run uses), [ADR-0100](./0100-credential-field-channels.md) (the encrypted `secret`
  channel), [ADR-0049](./0049-no-unenforced-security-properties.md) (declared ≠ enforced — a scheme enum
  lists only implemented signers), [ADR-0087](./0087-metadata-protocol-upgrade-contract.md) (how the unused runtime
  `oauth2` shape is retired or redefined)
- **Evidence**: [#26702](https://github.com/objectstack-ai/objectstack/issues/26702) (OAuth2 grants and
  the app-credential exchange; its "Current state" read at `71a4b4ea`),
  [#26710](https://github.com/objectstack-ai/objectstack/issues/26710) (request signing; its proposed
  shape), [#26768](https://github.com/objectstack-ai/objectstack/issues/26768) (this record's card). Every
  claim below about current behaviour cites a file and line on `origin/main` at `0ea90c7a`.

---

## Provenance — read this before citing this file

Prime Directive #13 places a decision that draws the open / commercial boundary in
`objectstack-ai/cloud`, cited from here as `cloud ADR-NNNN`. The boundary this record moves was
never drawn there: the five records that put outbound OAuth2 in the enterprise tier — ADR-0018,
-0022, -0023, -0024 and -0097, each "per ADR-0015" — are all in this repository, and none cites
a cloud record (`git grep -n "cloud ADR" origin/main -- docs/adr/0015* docs/adr/0018* docs/adr/0022*
docs/adr/0023* docs/adr/0024* docs/adr/0097*` answers nothing).

So this file is the **mechanism half**, in the repository whose code it governs: which auth kinds the
open connector layer implements and the contract they follow. The **commercial half** — what, if
anything, an enterprise subscription still sells around connector credentials — is owed as a
cloud-repository record with a `## Provenance` pointer back to this number. That record is **not
filed by the PR that lands this file**; the cloud repository is outside its reach. Until it exists,
the maintainer's ruling quoted above is the commercial decision of record.

⚠️ Where a cloud record and this document disagree about the *commercial* boundary, the cloud record
decides. What this document decides, and cloud does not, is where the **code** lives and what its
contract is.

---

## Context

### Inbound OAuth exists; outbound connector auth is static only

The maintainer's 「平台基于 better-auth ，怎么会有没有 oauth」 is right about the platform and wrong about
the connector layer, which uses none of it:

| surface | what exists on `main` | where |
|:---|:---|:---|
| sign-in OAuth | better-auth `socialProviders`, from the host's config | `packages/plugins/plugin-auth/src/auth-plugin.ts#socialProviders` |
| OAuth authorization **server** (for MCP clients and SSO into ObjectStack) | `@better-auth/oauth-provider`, `/oauth2/{authorize,token,…}` | `packages/plugins/plugin-auth/src/auth-manager-plugin-list.ts` |
| a per-user linked account holding the provider's tokens | `sys_account`, `user_id` required, keyed `(provider_id, account_id)` | `packages/platform-objects/src/identity/sys-account.object.ts#user_id`, `packages/plugins/plugin-auth/src/auth-schema-config.ts#AUTH_ACCOUNT_CONFIG` |
| declarative instance auth | `none` / `bearer` / `api-key` / `basic` only | `packages/spec/src/shared/connector-auth.zod.ts#ConnectorInstanceAuthSchema` |
| credential resolution | once, at materialization; open default reads `process.env` | `packages/services/service-automation/src/credential-resolver.ts#CredentialResolver`, `#defaultEnvCredentialResolver`; `packages/services/service-automation/src/plugin.ts#materializeDeclaredConnectors`, `#resolveInstanceAuth` |
| MCP http transport auth | static header fold of the resolved credential | `packages/connectors/connector-mcp/src/mcp-provider.ts#applyAuthToHeaders`, `#normalizeTransport` |
| OpenAPI `securitySchemes` | typed, never read | `packages/connectors/connector-openapi/src/openapi-connector.ts#OpenApiDocument`, `#OpenApiSecurityScheme` (the only reader of auth is the static `#applyAuth`) |
| REST connector auth | static only | `packages/connectors/connector-rest/src/rest-connector.ts#applyAuth`, `packages/connectors/connector-rest/src/index.ts` |

`resolveInstanceAuth` turns a `credentialRef` into a `ResolvedConnectorAuth` once and hands it to the
provider factory; nothing re-resolves it, so a token that expires has no
refresh point. The one per-connection credential seam on `main` is the IMAP connector's
`MailCredentialProvider.credentialFor(account)` (`packages/connectors/connector-imap/src/account.ts#MailCredentialProvider`, `#credentialFor`),
which already says "obtaining and refreshing the token is the provider's job, not the connector's" — the
shape D4 generalises.

### The two `oauth2`-shaped things in `connector-auth.zod.ts`, and which surface each serves

The card's re-check `git grep -n "intentionally absent"` on that file answers nothing on `0ea90c7a`, but
the sentence is still there: it wraps, "OAuth2 is intentionally" ending line 113 and "absent (enterprise
tier, ADR-0015)." opening line 114. The file holds two shapes, for two doors:

- **`ConnectorOAuth2Schema`** (retired by D7; its record is `packages/spec/src/migrations/entries/semantic/18.connector-auth-config-oauth2-retired.ts`) is a
  variant of the **runtime** union `ConnectorAuthConfigSchema` (`packages/spec/src/shared/connector-auth.zod.ts#ConnectorAuthConfigSchema`): what a plugin hands to `registerConnector`, with
  `clientSecret` and `refreshToken` **inline**. It may never be authored —
  `DeclarativeConnectorEntrySchema` refuses any non-`none` `authentication` on every published entry
  (`packages/spec/src/integration/connector.zod.ts#DeclarativeConnectorEntrySchema`). No provider consumes it: the providers
  take `ResolvedConnectorAuth`, which `Extract`s exactly the four static kinds
  (`packages/spec/src/shared/connector-auth.zod.ts#ResolvedConnectorAuth`).
- **`ConnectorInstanceAuthSchema`** (`packages/spec/src/shared/connector-auth.zod.ts#ConnectorInstanceAuthSchema`) is the **authored** shape, with
  `credentialRef` in place of every secret. It has no OAuth2 variant; that absence is what lines 113-114
  and ADR-0097:119 ("The open tier deliberately omits OAuth2 from `ConnectorInstanceAuthSchema`")
  record.

### Where the enterprise placement came from

Every record that puts OAuth2 refresh in the enterprise tier says it does so "per ADR-0015". ADR-0015 —
external datasource federation — contains neither "OAuth" nor "enterprise" (`git grep -c -i enterprise
origin/main -- docs/adr/0015-external-datasource-federation.md` answers nothing). Its §10 says only that
credentials are a `credentialsRef` into a secrets service. The split was first drawn for connectors by
ADR-0018 ("Managed credentials/secret vault, OAuth2 token refresh, multi-tenant connection lifecycle,
and a connector marketplace … are the enterprise tier, on the ADR-0015 precedent", line 229) and
repeated by ADR-0022 §4, ADR-0023 §4, ADR-0024 §4 and ADR-0097 §3.

### Why it matters

The vendors an integration-heavy core system must reach no longer accept a static key on their primary
channel. #26702's survey found Salesforce, Slack, HubSpot, Atlassian, Notion and Asana shipping hosted
MCP servers that require OAuth; Feishu, DingTalk and WeCom issuing short-lived tokens from app
credentials; and #26710's found Alipay, WeChat Pay, Aliyun and Tencent Cloud signing every request.
None of the three shapes is reachable from a declarative instance today, so an AI-authored app's
`connector_action` stops at the long tail of static-key APIs.

---

## Decision

### D1 — The tier line moves

Outbound connector auth — every auth kind below, the per-dispatch resolution that keeps it alive, the
connection record that holds its tokens and the Connect / Reconnect flow that creates them — is
**open tier**, in this repository, Apache-2.0. This reverses the placement of "OAuth2
authorization-code / refresh lifecycle" and "per-tenant connection lifecycle" in ADR-0018, -0022,
-0023, -0024 and -0097, and nothing else in those records: vaulting **backends** (an external KMS or
secret manager behind `CredentialResolver`), curated or paid connector catalogs, marketplace
distribution and sandboxed stdio execution keep the placement those records gave them, subject to
the cloud record named in [Provenance](#provenance--read-this-before-citing-this-file).

### D2 — Three new variants of the authored contract, each closed

`ConnectorInstanceAuthSchema` gains three discriminants beside `none` / `bearer` / `api-key` / `basic`.
Every enum below is **closed** and refused at publish when unknown (Prime Directive #12): a new value is
a spec change with its implementation, never a free-form escape. The shapes are normative in what they
carry and forbid; exact key spelling is the spec slice's, reviewed against this record.

1. **`oauth2`** — RFC 6749 grants.
   - `grant`: `'authorization_code' | 'client_credentials'`.
   - Endpoints: `authorizationUrl` (required for `authorization_code`), `tokenUrl`; `scopes`; an optional
     resource / audience indicator.
   - Client: `clientId` (not a secret); the client secret is a `credentialRef` — optional only for a
     public client.
   - `authorization_code` always uses PKCE with `S256`; there is no switch to turn it off.
   - A refresh token is used when the server issues one, and a rotated refresh token replaces the old one
     atomically.
   - For `provider: 'mcp'` on an http transport, endpoints and `clientId` may be omitted: the provider
     runs the MCP authorization flow (protected-resource metadata, authorization-server metadata,
     dynamic client registration, PKCE), and the registered client lives in the connection record (D3),
     never in metadata.
   - They may also be supplied. A vendor MCP server without dynamic client registration takes a
     pre-registered `clientId` and a client-secret `credentialRef`, as for any other `oauth2` instance.
     HubSpot's remote server is one such vendor (Q3).
2. **`app-credential`** — the non-interactive vendor exchange of an app id and secret for a short-lived
   access token, which is not an RFC 6749 grant: each vendor spells the request, the response fields
   and where the token rides differently.
   - `vendor`: `'feishu' | 'dingtalk' | 'wecom'`.
   - `appId`: not a secret; the app secret is a `credentialRef`.
   - Each vendor value names one exchange — the token endpoint, its request and response shape, the
     token's placement on the outgoing call (a header for one vendor, a query parameter for another) —
     implemented and tested in the shared transport against the vendor's published documentation.
     Nothing about the exchange is authored.
3. **`signed`** — per-request signing; no token exists.
   - `scheme`: a closed enum of vendor-documented canonical-request algorithms (the
     [fourth decision](#q4--which-signing-schemes-ship-first) picks the first members).
   - `keyId` and scheme-specific **non-secret** parameters (an app id, a region, a vendor
     public-key `credentialRef` where the scheme verifies responses).
   - The private key or HMAC secret is a `credentialRef`.
   - A scheme enters the enum together with its signer and its test vectors. Where the vendor publishes
     a complete worked example, the vectors reproduce it byte for byte. Where it does not (a masked
     secret, an unreachable page), the vectors are taken from the vendor's official SDK test suite, and
     the test names that SDK and its version. An enum member without a shipped signer is a
     declared-but-unenforced property (ADR-0049) and is not admitted.
   - The signer seam carries an optional response-verification step beside request signing. A scheme
     whose vendor signs its responses implements that step in its first release; `alipay-v3` does
     (Q4). A "generic HMAC" member is admitted only with a
     canonical form pinned in the spec; without one, it is a dialect.

### D3 — Secrets are references; tokens are runtime state in a connection record

- Every secret an author names is a `credentialRef`, resolved through `CredentialResolver` (ADR-0097 §3,
  unchanged). Publish keeps refusing an inline secret, now on the three new variants too.
- Tokens, registered MCP clients and their expiry are **not metadata**. They never appear in
  `sys_metadata`, in `GET /api/v1/automation/connectors`, in a connector descriptor, or in a log line.
- Only what cannot be re-obtained unattended is persisted: the `authorization_code` refresh token, the
  client a dynamic registration created, and the grant's status, scopes and expiry. These live in a
  dedicated connection record bound to the instance (Q2), their secrets encrypted at rest through the
  `secret` channel (ADR-0100).
- Access tokens are never persisted. They live in an in-process cache. This includes every
  `client_credentials` and `app-credential` token, which the configured secret re-derives at any time.

### D4 — Grant-bearing kinds resolve per dispatch, not at materialization

This changes ADR-0097's contract for the new kinds only; the four static kinds keep resolving once, at
materialization.

- The resolution seam gains a per-dispatch form: given the instance, answer a live credential — an access
  token for `oauth2` / `app-credential`, a signer bound to its key for `signed`.
- Refresh happens on expiry (with a clock-skew margin) and once on a `401` from the upstream, then the
  call is retried once. Concurrent dispatches on one connection share one refresh (single flight), so a
  rotating refresh token is never spent twice.
- Failure follows ADR-0097's split between configuration and operation:
  - An unreachable or `5xx` token endpoint is operational: `CONNECTOR_UPSTREAM_UNAVAILABLE`, retried
    on the existing backoff.
  - A revoked or expired grant with no usable refresh is not retried into existence. The instance turns
    `degraded` with a reason that names the grant and the remedy ("reconnect required"), and the
    dispatch fails with that reason.
- An `authorization_code` instance whose connection has never been authorized is not an authoring fault
  and never fails a boot. It materializes `degraded` ("not connected") until an administrator connects
  it.
- A connection is selected by the run's organization (Q1). A run that carries no organization, such as
  a schedule (`packages/services/service-automation/src/runtime-identity.ts#resolveRunDataContext`),
  uses the instance's connection only when exactly one exists. Otherwise the dispatch is refused with a
  reason naming the missing organization. It never falls back to an arbitrary connection: this is
  ADR-0073's "missing identity is refused" applied to the organization.

### D5 — Connecting is an authorized, server-side act

- The `authorization_code` flow's redirect lands on a platform route. `state` and the PKCE verifier are
  bound to the initiating session and the connection. The redirect URI is fixed per deployment, never
  taken from the request.
- The route declares its closed query-parameter set on the day it lands (Route & surface ownership,
  rule 5).
- Who may connect, reconnect or revoke is a capability check the server slice declares. Whose grant a
  run then uses is the [first decision](#q1--connection-ownership-and-execution-identity).

### D6 — An integration grant is never a sign-in method

A grant obtained to call a vendor on the platform's behalf must not let anyone sign in to ObjectStack,
and must not be revoked or replaced by an unrelated sign-in. Whatever the storage decision, this holds.

### D7 — The unused runtime `oauth2` shape is retired

`ConnectorOAuth2Schema` (retired by D7; its record is `packages/spec/src/migrations/entries/semantic/18.connector-auth-config-oauth2-retired.ts`) inlines a client secret and a refresh token
and has no consumer. The spec slice that adds D2's `oauth2` variant **retires** it through ADR-0087. It
is not redefined as a resolved shape. Under D4 a provider receives a credential source answered per
dispatch, an interface rather than a schema, and that source is separate from `CredentialResolver`, which
keeps resolving `credentialRef`s.

### What this record does not decide

- **Inbound auth.** Sign-in, the OAuth authorization server, API keys and sessions are unchanged.
- **Messaging channel accounts.** ADR-0022's enterprise row also names the "multi-tenant
  `sys_channel_account` lifecycle". A Slack channel's transport delegates to the Slack connector
  (ADR-0022 §3) and so inherits D2–D4 when it is built. The channel-account lifecycle itself is not
  moved here.
- **Which actions each product exposes**, the bulk import of third-party catalogs, and authoring
  OpenAPI documents for vendors that publish none (recommendation 3, 「3 不考虑」).

---

## Decisions put to the maintainer

The maintainer answered all four on 2026-10-28 by accepting an independent analysis's recommendations
(see Deciders). Each question keeps its options as drafted, followed by the **Decision**. Where the
decision departs from the drafted recommendation, it says so.

### Q1 — Connection ownership and execution identity

Is a connection shared by the organization, or held per user, and whose grant does a flow run use
(ADR-0073)?

- **A. Organization-shared only.** One connection per instance per organization. Every run dispatches
  with it, whatever its `runAs`. This is the shape of a service integration (Salesforce Named
  Credentials with a named principal; a Power Platform connection shared with a flow). Cost: no
  per-user audit trail at the vendor; a vendor action taken "as the user" is impossible.
- **B. Per-user only.** The run uses the triggering user's own grant. A user-less run is refused, as a
  user-less `runAs:'user'` data operation already is (ADR-0073, 2026-07-28 amendment). Cost: every
  user must connect before any flow works, and record-change and scheduled runs, which often carry no
  user, can never dispatch.
- **C. Both, declared per instance** (an organization default, a per-user mode). Cost: the largest
  build — two resolution paths, two Console flows — and a per-user mode whose user-less case still
  needs B's refusal.

**Recommendation: A now, with C's per-user mode left as an additive later key.** ADR-0073's automation
principal (D1/D2) is unbuilt, and many runs carry no user, so B fails the commonest automation shapes.
A covers every acceptance scenario #26702 names, and adding a scope key later is additive
(`Metadata-protocol: added`), not a migration.

**Decision (2026-10-28): A.** It comes with D4's rule for a run that carries no organization. Per-user
connections stay a later additive key. The `oauth2` and `app-credential` variants carry no scope key
now, and Console Connect / Reconnect is organization-level.

### Q2 — Where grants are stored

Reuse better-auth's `account` storage and refresh, or a dedicated connection object?

- **A. Reuse `sys_account`.** Measured against D3 and D6:
  - `user_id` is required (`packages/platform-objects/src/identity/sys-account.object.ts#user_id`), so an organization-shared connection (Q1 A)
    has no row to live in.
  - The token columns are `textarea` + `internal: true` (`packages/platform-objects/src/identity/sys-account.object.ts#access_token`, `#refresh_token`): omitted from the data API, but not
    the encrypted `secret` channel (ADR-0100), so D3's encryption at rest is not met as they stand.
  - A row is a linked sign-in account keyed `(provider_id, account_id)`, which is exactly what D6 forbids
    an integration grant to become.
  - better-auth refreshes against the providers in its own configuration (`packages/plugins/plugin-auth/src/auth-plugin.ts#socialProviders`), not against an endpoint declared per instance in metadata.
- **B. A dedicated connection object** (the spec slice names it), owned by the automation service:
  - bound to `(organization, connector instance)`;
  - tokens and the registered MCP client in `secret` fields;
  - status, expiry, scopes and the reason a grant failed, for the Console and for D4's `degraded` reason.

  Cost: a new platform object, its permissions and its Console view, all of which A would also need in
  some form.

**Recommendation: B.** A fails three of D3 / D6's requirements on today's columns, and closing them
would bend a sign-in table into a second purpose.

**Decision (2026-10-28): B, scoped as D3 states.** Only the refresh token, the dynamically registered
client and the grant's status, scopes and expiry are persisted. Access tokens are not. Further reasons
`sys_account` does not fit:
- `(provider_id, account_id)` is a globally unique index, so two organizations connected to one vendor
  tenant collide.
- The token columns are kept out of the `secret` channel deliberately, because better-auth reads them
  back through its own adapter.
- Both points are in `packages/platform-objects/src/identity/sys-account.object.ts`.

The connection object follows the shape of
`packages/platform-objects/src/identity/sys-scim-connection-credential.object.ts`: an organization
column, a revocation switch, an expiry, engine-owned, and a declared permission.

### Q3 — First products for the first acceptance

Which vendors does the first acceptance target? One per grant kind keeps every new path exercised by a
real upstream:

- **A.** `authorization_code`: one OAuth-protected hosted vendor MCP server (HubSpot, whose server
  requires OAuth 2.1 + PKCE per #26702's survey). `app-credential`: Feishu. `signed`: an Alipay v3
  sandbox query through the `openapi` provider (the one official OpenAPI document #26710 found among
  Chinese platforms). `client_credentials`: a conformance test against an in-repo token server.
- **B.** As A, with Salesforce REST through `openapi` in place of the MCP server. Cost: leaves the MCP
  authorization flow, the hardest new path, without a live proof.
- **C.** The OAuth half only (A without `signed`), with signing accepted later. Cost: #26710 stays
  blocked on a record that has already decided it.

**Recommendation: A.** It is the union of the acceptance lines both parent cards already wrote.

**Decision (2026-10-28): A, revised. This departs from the drafted recommendation.** HubSpot's remote
MCP server has no dynamic client registration. Clients are pre-registered in HubSpot
([HubSpot docs](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server)),
so HubSpot alone cannot prove D2.1's discovery-and-registration path, the hardest new path. The first
acceptance therefore targets:
- `authorization_code` over MCP:
  - **Notion's hosted MCP server is the live proof**
    ([Notion docs](https://developers.notion.com/guides/mcp/build-mcp-client)). It provides dynamic
    client registration, mandatory S256 PKCE, and a refresh token rotated on every refresh, so it
    exercises D2.1, D4's single-flight refresh and atomic rotation, and the revoked → `degraded` path
    at once.
  - HubSpot is the second case, live or as a contract test, for the pre-registered `clientId` form.
- `app-credential`: Feishu. WeCom's early token invalidation is a unit case for D4's refresh-once-on-401
  rule.
- `signed`: an Alipay v3 sandbox query, called over https. `signed` is instance-level `auth`: the
  Alipay document declares no `securitySchemes`.
- `client_credentials`, plus a dynamic-registration / PKCE contract test: against the platform's own
  embedded OAuth authorization server (`@better-auth/oauth-provider`), which already issues
  `client_credentials` tokens and has dynamic registration enabled
  (`packages/plugins/plugin-auth/src/auth-manager-plugin-list.ts`).

### Q4 — Which signing schemes ship first

The secret is always a `credentialRef` (D2.3); the question is the first members of the closed enum.

- **A.** `alipay-rsa2`, `aliyun-acs3-hmac-sha256`, `tencentcloud-tc3-hmac-sha256` — #26710's proposal:
  request-only signers with published vectors.
- **B.** A plus `wechatpay-rsa2048`. WeChat Pay APIv3 also requires verifying the platform's response
  signature against rotating platform certificates, so it carries a response-verification half A does
  not.
- **C.** A plus `aws-sigv4`, for the global shelf.

**Recommendation: A.** The other schemes join the enum when a consumer declares one, each with its
signer and vectors (D2.3). An enum listing schemes nobody implements would be declared-not-enforced.

**Decision (2026-10-28): A, with three conditions.**
1. **The Alipay member is named `alipay-v3`.** `RSA2` is the v2 gateway's `sign_type`; the v3 protocol
   header is `ALIPAY-SHA256withRSA`. The first enum is
   `'alipay-v3' | 'aliyun-acs3-hmac-sha256' | 'tencentcloud-tc3-hmac-sha256'`.
2. **The signer seam carries response verification from the start (D2.3).** `alipay-v3` implements it
   in its first release. WeChat Pay then joins later as one more signer, with no seam change.
3. **The test-vector rule takes D2.3's relaxed form.** Of the three, only Aliyun publishes a complete,
   reproducible worked example; Tencent masks its SecretKey. The rule as first drafted would have
   admitted Aliyun alone.

Option B's cost statement is partly out of date. New WeChat Pay merchants verify against a fixed
platform public key rather than rotating certificates, but the response-verification half remains.

---

## Consequences

**Positive**
- A declarative instance can reach OAuth-protected vendor MCP servers, the Chinese suites'
  app-credential APIs and request-signing payment and cloud APIs. That covers the integrations an
  AI-authored core system most often needs, without plugin code or an env-var token.
- One authored contract for every auth kind, each closed, each refused at publish when wrong.
- Tokens leave the env-var world: no operator pastes a short-lived token, and none lands in metadata.

**Negative / costs**
- ADR-0097's "resolve once at materialization" stops being universal. Two resolution regimes coexist,
  static and per-dispatch, and the provider factories must take a credential source instead of a
  resolved credential for the new kinds.
- A new stateful object (the connection record) and a new inbound route (the redirect) on the security
  surface, each needing its own review.
- Every signer is security-critical code with vendor-specific canonicalisation. The test-vector rule
  in D2.3 is what keeps it honest.

---

## Acceptance (pinned from #26702 and #26710)

- A declarative `provider: 'mcp'` instance pointing at Notion's hosted MCP server, with no endpoints
  and no `clientId` authored, is authorized once from the Console through dynamic client registration.
  A flow `connector_action` then dispatches end to end. After the access token expires, the next
  dispatch refreshes it with no operator action, and the rotated refresh token replaces the old one.
  HubSpot covers the pre-registered `clientId` form, live or as a contract test (Q3).
- A Feishu (or DingTalk) instance declared with `app-credential` dispatches through `openapi` or
  `rest`, and its token renews without a restart.
- An `openapi` instance over the Alipay v3 document, normalized to JSON first, with
  `auth: { type: 'signed', scheme: 'alipay-v3', … }`, dispatches a sandbox query over https and
  verifies the response signature. Signer unit tests meet D2.3's vector rule.
- `client_credentials` and the dynamic-registration flow pass a contract test against the embedded
  OAuth authorization server.
- An unknown `grant`, `vendor` or `scheme`, or an inline secret on any variant, is refused at publish
  with a located error.
- No token, client secret or private key appears in `sys_metadata`, in
  `GET /api/v1/automation/connectors`, or in logs.

---

## Implementation slices

Each slice is its own card and lands after this record is accepted.

| slice | owner (triage confirms) | carried by |
|:---|:---|:---|
| D2 variants, publish refusals, D7's `ConnectorOAuth2Schema` disposition | `domain:spec` | #26702 item 5, #26710 item 2 |
| connection record (D3, per Q2), per-dispatch resolution and refresh (D4), the redirect route (D5) | `domain:server` | #26702 items 2–4 |
| providers: MCP authorization flow, OpenAPI `securitySchemes`, REST; the `RequestSigner` seam and first signers | `domain:server` | #26702 item 6, #26710 items 3–4 |
| Console Connect / Reconnect and connection status | `domain:ui` | #26702 item 7 |
| the cloud-repository record ([Provenance](#provenance--read-this-before-citing-this-file)) | the commercial repository | #26702 item 1, #26768 item 3 |
