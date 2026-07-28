# Dispatcher ↔ client route-coverage audit (#3563)

**Date:** 2026-07-27 · **Trigger:** #3528 → #3552 · **Machine ledger:** `packages/runtime/src/route-ledger.ts` · **Guard:** `packages/runtime/src/route-ledger.conformance.test.ts`

#3528 shipped because a route existed, worked, and was documented while the SDK
had no way to call it (`automation resume`, fixed in #3552). This audit asks how
many more instances of that class exist. Answer: **27 dispatcher routes with no
SDK expression, across 6 domains — plus a second, larger un-audited surface in
`@objectstack/rest`.**

The audit is three-column, not two. A route can fail to reach users at three
distinct layers, and instances of all three were found:

```
dispatch() branch  ↔  HTTP mount (dispatcher-plugin.ts)  ↔  client method
```

## 1. Coverage by domain (dispatcher surface)

Full per-route dispositions live in the ledger; this is the shape of it.

| Domain | Routes | sdk | gap | other |
|---|---|---|---|---|
| `/automation` | 15 | 12 | 3 (`/actions`, `/connectors`, `/_status`) | — |
| `/packages` | 17 | 6 | 11 (publish/drafts/commits/revert/rollback/export/adopt/duplicate/edit) | — |
| `/meta` | 8 | 4 | 3 (`published`, `_drafts`, FSM states) | 1 server-only |
| `/data` | 6 | 6 | — | — |
| `/actions` | 3 | 0 | **3 — the largest functional hole** | — |
| `/share-links` | 5 | 0 | 3 | 2 public |
| `/security` | 3 | 0 | 3 | — |
| `/keys` | 1 | 0 | 1 (no SDK path to mint an API key at all) | — |
| `/i18n`, `/notifications` | 6 | 6 | — | — |
| `/analytics` | 3 | 1 | — | 2 **mismatch** (§4) |
| `/storage` | 2 | 0 | — | 2 **mismatch** (§4) |
| `/ui` | 1 | 1 (as `meta.getView`) | — | — |
| `/auth`, `/ai`, `/mcp*`, probes, discovery, openapi | — | — | — | wildcard / dynamic / server-only |

`engine.registerAction`-registered actions (`POST /actions/...`, three shapes,
`http-dispatcher.ts:1951-1953`) are entirely unreachable from the SDK — every
console today hand-rolls `fetch` for them.

## 2. Reachability: dispatch branches with no HTTP mount

The dispatcher has **no catch-all**; `dispatcher-plugin.ts` mounts routes
explicitly, so a `dispatch()` branch without a mount is dead over HTTP in a
plain runtime (`dispatcher-plugin.routes.test.ts:9-14` records `/mcp`, `/keys`,
`/ready` shipping broken exactly this way). Currently mount-less:

- `/security/*`, `/share-links/*`, `/ui/view/*`, `/meta/*`, `/data/*`,
  `/openapi.json`, `/automation/actions|connectors|_status`, and the i18n
  query-param variants.

They are reachable only where `@objectstack/rest` or a host-mounted catch-all
(cloud) fronts the dispatcher — noted in the domain files themselves
(`domains/security.ts:13-15`, `domains/share-links.ts:11-14`). The
`route-parity.integration.test.ts` gate (#3369) probes a hardcoded list of six
paths; extending its probe list from the ledger is the natural follow-up.

## 3. The stale spec route table

`DEFAULT_DISPATCHER_ROUTES` (`packages/spec/src/api/dispatcher.zod.ts:141-164`)
is consumed by **nothing in `packages/runtime`** — only by its own tests and
`api-surface.json`. It lists `/workflow` and `/realtime` (no dispatcher branch
exists; `/realtime` is deliberately never advertised,
`http-dispatcher.ts:1128-1133`) and omits `/keys`, `/mcp`, `/mcp/skill`,
`/actions`, `/security`, `/share-links`, `/ready`, `/openapi.json`.

Worse, `packages/client/CLIENT_SPEC_COMPLIANCE.md:14` anchors its "✅ FULLY
COMPLIANT" claim on that table — compliance measured against a route list that
predates five of the domains it should be measuring. Disposition: deprecate the
export (removal is a spec major) and retire the compliance doc or regenerate it
from the ledger.

## 4. Shape mismatches (client speaks REST, dispatcher speaks dispatcher)

| Dispatcher route | Client call | Effect |
|---|---|---|
| `GET /analytics/meta` (`domains/analytics.ts:49`) | `analytics.meta(cube)` → `GET /analytics/meta/:cube` | extra segment only REST understands |
| `POST /analytics/sql` (`analytics.ts:55`) | `analytics.explain()` → `POST /analytics/explain` | different route name entirely |
| `POST /storage/upload` (`domains/storage.ts:47`) | presigned/chunked protocol (`/upload/presigned`, `/upload/complete`, `/upload/chunked/*`) | client can't upload through a bare dispatcher |
| `GET /storage/file/:id` (`storage.ts:56`) | `storage.getDownloadUrl` → `GET /storage/files/:id/url` | ditto for download |

These are ledgered as `mismatch`, not `sdk`: the method exists but does not
speak the dispatcher's dialect. Reconciliation (pick one shape, alias the
other) is its own follow-up.

### Resolution (#3584) — split decision, not one letter for all four

Re-verification for #3584 corrected one premise of this table: the two
analytics shapes the client spoke (`GET /analytics/meta/:cube`,
`POST /analytics/explain`) were served by **nothing** — not the dispatcher,
not `@objectstack/rest` (which only mounts `/analytics/dataset/query`), not
`service-analytics` (which registers no HTTP routes). "Only REST understands"
was wrong; those two client methods 404ed against every server in the repo and
had zero call sites in `objectstack` and `objectui`.

- **Analytics ×2 → client aligned to the dispatcher** (the "Option B"
  direction, but not breaking in practice — a universally-404ing method has no
  working consumers). `analytics.meta(cube?)` now calls `GET /analytics/meta`
  with an optional `?cube=` filter (honored server-side —
  `AnalyticsService.getMeta(cubeName?)` always supported it; the dispatcher
  now threads it through). `analytics.explain(payload)` keeps its name and
  calls `POST /analytics/sql`. Both ledger rows are now `sdk`.
- **Storage ×2 → documented deliberate disposition** (`server-only`). The
  presigned/chunked protocol is **not** REST-only: `service-storage` registers
  it autonomously on any `http-server` service
  (`storage-service-plugin.ts:283`, `storage-routes.ts`). Rewriting the client
  to the dispatcher's bare `POST /storage/upload` would regress
  direct-to-cloud upload, chunked/resumable transfer, upload auth (#2755) and
  download authorization (#2970 / ADR-0104). The protocol is canonical; the
  dispatcher's two plain routes remain a low-level redirect/stream compat
  surface, deliberately outside the SDK.

## 5. Client-internal findings

- **`trigger` vs `execute`** hit different URLs for the same intent
  (`index.ts:2170` `POST /automation/trigger/:name` vs `index.ts:2283`
  `POST /automation/:name/trigger`).
- **`client.analytics.*` skips `unwrapResponse()`** (`index.ts:533-554`) —
  callers get the raw envelope; every other surface unwraps.
- **`ScopedProjectClient` silently drops `If-Match`** on `update`/`delete`
  (`index.ts:3567`, `:3608` vs unscoped `:3053`, `:3152`) — OCC capability loss
  in environment-scoped code, and re-expresses only 4 of 20 surfaces.
- **`getRoute()` invents `views` and `permissions`** (`index.ts:3330-3331`) —
  not in `ApiRoutesSchema`, so discovery can never override them; `projects`
  (23 methods) bypasses routing entirely with hardcoded `/api/v1/cloud/*`.
- **`client.events` (`RealtimeAPI`) is a non-functional stub** — an in-memory
  buffer nothing populates over the network (`realtime-api.ts:163-168`), while
  `client.realtime.*` is the real HTTP surface. Two surfaces, one working.

## 6. Documentation drift (all hand-written; no generator exists)

`packages/client/README.md` documents **six methods that do not exist**
(`meta.getObject`, `views.share`, `views.setDefault`, `workflow.approve`,
`workflow.reject`, `ai.chat` — the last three were deliberately removed) and
claims "13 namespaces" where the SDK ships 20 (~171 methods; README says
"95+"). `content/docs/api/client-sdk.mdx` names `organizations` /
`projects` / `oauth` in its feature bullet and documents none of their 52
methods. No script anywhere generates any of these lists.

## 7. Test deserts

Five entire surfaces have **zero test references**: `analytics`, `storage`,
`projects` (23), `organizations` (23), `oauth` — 62 methods, ~36% of the SDK.
(Grep across all five client test files; `tests/integration/` is additionally
excluded from `pnpm test` by config.)

## 8. The second surface (out of ledger scope, tracked here)

`@objectstack/rest` mounts routes the dispatcher never sees; the client
already targets some (views CRUD, permissions, workflow, approvals, realtime,
notification devices/preferences, presigned storage, import jobs). Zero client
expression exists for: `GET /search`, `POST /email/send`, `forms/:slug`
(3 routes), record shares (`/data/:object/:id/shares*`), `POST .../clone`,
`POST /analytics/dataset/query`, `sharing/rules` (5), `reports` (8),
`external-datasource/*` (`rest-server.ts:4514-5734`,
`external-datasource-routes.ts`). Auditing that surface with the same
three-column method is the next tranche of #3563.

**Closed in #3587** — `packages/rest/src/rest-route-ledger.ts` plus its
conformance guard; the 43 audited gaps and 2 mismatches both ratchet at zero.

## 9. The third surface: autonomous service mounts (#3636)

Neither ledger sees a service that reaches for the `http-server` service and
registers straight on `IHttpServer` — it bypasses `RouteManager` and
`RestServer.getRoutes()` alike. Two do: `service-storage`
(`storage-routes.ts`, 10 routes — the SDK's entire storage surface) and
`service-i18n` (`i18n-service-plugin.ts`, 3 routes). Both now carry a
per-package ledger next to the registrar, enumerated by driving the real
registrar against a capturing mock `IHttpServer`, with the client half in
`packages/client/src/service-route-ledger-coverage.test.ts` (no
service→client package edge — the tranche-1 lesson).

Dispositions: storage audited clean at 7 `sdk` / 3 `server-only` (the
browser-facing `/files/:fileId` redirect objectql stamps into file-field
payloads, and the two `_local/raw/:token` local-driver loopbacks). The chunked
upload family — flagged in #3636 as needing triage — turned out fully
SDK-expressed (`initChunkedUpload` / `uploadPart` / `completeChunkedUpload` /
`resumeUpload`), so no gap to close.

i18n audited at **two mismatches**, both fixed in the same PR:
`i18n.getTranslations` sent `/translations?locale=xx` and
`i18n.getFieldLabels` sent `/labels/:object?locale=xx`, while every serving
surface — service-i18n's mounts, the dispatcher's HTTP mounts, and the
`plugin-rest-api.zod.ts` contract — mounts only the path form. Both were
wire-level 404s, and both had carried a green `sdk` row in
`route-ledger.ts` since tranche 1: **§1 coverage rows assert the client method
exists, not that it speaks a URL anything mounts.** The same audit found
service-i18n omitting the `success` flag from its `{ data }` bodies, so
`unwrapResponse` returned the raw wrapper against that provider while
returning the declared shape against the dispatcher — one method, two shapes,
decided by which plugin mounted the route.

Also filed, not fixed: `GET {base}/_local/file/:key` is built by three call
sites and mounted by none (#3641).

**The gap all three ledgers shared** was the reverse direction — no guard
compared the URL a client method *builds* against the patterns any surface
*mounts*. Four instances of that class were found one at a time
(#3584 ×2, #3611, #3636 ×2). Mechanized in #3642, below.

## 10. The reverse direction, mechanized (#3642)

`packages/client/src/client-url-conformance.test.ts` drives **every** method on
a real `ObjectStackClient` with a recording `fetch` and matches each captured
URL against the **union** of all four ledgers (a union, not an intersection —
a route mounted by one surface is still reachable). A real drive, not a
declaration table: "method X targets route Y" written by hand is an assertion
*about* the code that the code can drift away from, which is the very failure
being fixed.

Result at landing: 196 of ~219 methods matched; the only unmatched family was
`projects.*`, which targets the control plane (below). Mutation-checked — the
#3636 dialect bug, re-injected, fails the suite.

**The sweep's own completeness is asserted**, because that is the part that
rots silently:

| Assertion | What it stops |
|---|---|
| every method is driven or declared `NON_HTTP` **with a reason** | a new SDK method escaping coverage |
| a driven method emitting **zero** requests fails | placeholder args going stale, so the method throws before fetching and the guard passes while covering nothing |
| a URL containing `undefined` / `[object Object]` fails | a placeholder that is accepted but wrong masquerading as coverage |
| `(unmatched)` is excluded from the pattern set | the `__api-endpoint` catch-all matching everything and making the suite vacuous |

**Two bounds, both explicit rather than papered over:**

- **The control plane.** `/api/v1/cloud/*` (23 `projects.*` methods) is served
  by the sibling `cloud` repo — this repo's dispatcher explicitly refuses those
  paths — so no in-repo ledger can vouch for them. Exempt by prefix and bounded
  from both ends: a non-`projects` method reaching `/cloud/` fails. Tracked as
  #3655.
- **Dynamic families.** A `**` row claims a prefix, not a resolvable route.
  **60 of ~196 matched calls (~31%) rested on nothing stronger** — 54 of them on
  `* /auth/**`, where the routes come from a third-party dependency on its own
  release cadence. The guard counts and ratchets this, so it can only shrink.
  Closed to **3** by #3656, below.

## 11. The auth surface, enumerated (#3656)

The widest hole §10 measured. `plugin-auth` mounts better-auth with one
catch-all — `rawApp.all(`${basePath}/*`)` — so there are no per-route
registration calls to capture the way tranche 3 captured
`registerStorageRoutes`. The seam is **`auth.api`**: every better-auth endpoint
object carries `.path` and `.options.method`, so a live instance *is* the route
table. `packages/plugins/plugin-auth/src/auth-route-ledger.ts` reads it.

Two halves, checked differently on purpose:

| Half | Check | Catches |
|---|---|---|
| `AUTH_ROUTE_LEDGER` — 55 reviewed rows, every route the SDK calls, each naming its client method | **strict**: each must exist in the live table | an upstream **rename**. `auth.me` targets `/get-session`; if better-auth renames it, 26 `auth.*` methods 404 and nothing noticed before |
| `BETTER_AUTH_MOUNTED_SURFACE` — 129 wire paths, the whole inventory | **exact equality**, both directions | a version bump silently **adding** publicly-mounted auth endpoints |

The asymmetry is deliberate: demanding a hand-written rationale for all 129
would turn every better-auth upgrade into a hundred-row review, and the ledger
would rot into rubber-stamping. But the catch-all publishes whatever upstream
adds, so growth still has to be a reviewable CI diff — hence a
machine-maintained inventory rather than reviewed prose.

Enumeration is config-dependent (better-auth plugins are opt-in), so the
inventory is pinned at the configuration enabling every plugin the SDK targets
— the maximal surface — with the participating `OS_*` env vars cleared so a
developer's shell cannot produce a spurious diff. Mutation-checked: renaming a
ledgered route fails the suite naming it.

Effect on §10's guard: the wildcard-only count **fell 60 → 3** (only `* /ai/**`
remains, whose routes `service-ai buildAIRoutes()` builds at plugin start). The
capstone also had to prefer exact rows over wildcard families when matching —
otherwise every `/auth/*` URL would still have been absorbed by `* /auth/**`
and the new ledger would have changed nothing.

## 12. What the ledgers cannot see: response bodies (#3675)

Worth recording as a **boundary of this audit family**, not an oversight in it.
Every guard from §1 to §11 answers one question — does this route exist, and
can the SDK address it? None of them looks at what comes back. That is how
service-i18n and service-storage carried green `sdk` rows for surfaces that
emitted a bare `{ error: '<message>' }` against a contract declaring
`{ success: false, error: { code, message } }`.

Four error dialects were live in-repo at the time:

| Producer | Shape |
|---|---|
| `contract.zod.ts` (declared) | `{ success, error: { code: string, message, … } }` |
| `http-dispatcher.ts` | `{ success: false, error: { message, code: <HTTP number>, details } }` |
| `rest-server.ts` | `{ error: <string>, code: <SEMANTIC_STRING> }` |
| `settings-routes.ts`, `share-link-routes.ts` | `{ error: { code, message } }` — no `success` |
| service-i18n, service-storage | `{ error: <string> }`, sometimes `+ code` at the top level |

#3675 moved the last row to the contract. The rest are unchanged, and the
dispatcher's deviation is now pinned to exactly one field (`error.code` carries
the HTTP status where a semantic string is declared) by a test rather than by
prose — it parks the real code in `details` to work around its own occupied
field, which is the tell.

The generalisable lesson matches §11's: a guard only covers the question it
asks. "The route exists" and "the route answers in the declared shape" are two
questions, and the second one needs the contract imported into the assertion —
`BaseResponseSchema.safeParse(body)`, not a hand-copied restatement that drifts
from the schema it claims to check.

## 13. The control plane, from the other side (#3655)

The one surface this repo could never audit. §10's capstone drives every SDK
method and matches its URL against the union of the in-repo ledgers; 196 of
~219 matched, and **every** unmatched one was in `projects.*` — 23 methods on
`/api/v1/cloud/*`, served by the sibling `cloud` repo. The dispatcher here does
not merely lack those routes, it refuses them
(`if (path.includes('/cloud/environments/')) return undefined;`), so no ledger
here could honestly carry a row and the capstone exempts the prefix.

The ledger therefore lives in `cloud`
(`packages/service-cloud/src/cloud-route-ledger.ts`), and it had to: **cloud
depends on this repo, never the reverse**, so it is the only place where the
mounted route set and `@objectstack/client` are both in scope. Same shape as
tranche 3 — 90 routes, each with a reviewed disposition, enumerated for real by
driving all 17 registrars against a capturing mock `IHttpServer`.

The client half is the part that actually closes the boundary. Without it a
route could be renamed there, the ledger updated to match, and every
`projects.*` method 404 with the server-side guard still green — so
`projects-namespace-coverage.test.ts` drives the real SDK with a recording
`fetch` and matches each URL against the ledger. Mutation-checked against
exactly that scenario.

| Disposition | Count |
|---|---|
| `sdk` | 22 |
| `gap` | 14 |
| `mismatch` | 6 |
| `server-only` / `public` | 48 |

Two findings, both pinned by tests rather than prose:

- **`projects.listTemplates` was dead** — it built `/api/v1/cloud/templates`,
  which the string search finds exactly once in each repo: the call itself.
  Templates exist as a filtered `sys_package` view, never as a route. The
  sixth instance of the `#3584 / #3611 / #3636` class, and the first one only
  a cross-repo guard could have seen. **Removed in #3702** — there was no
  route to reconcile the method against, and no caller in either repo; it
  returns when a route exists to back it, with an `sdk` ledger row proving so.
- **A duplicate route registration** — `POST /actions/sys_environment/:actionName`
  mounted twice with an identical path, the second commented "legacy alias"
  and aliasing nothing (cloud#887).

The six `mismatch` rows are all one operation with two live spellings
(`change-hostname` / `hostname`, `rotate-credential` / `credentials/rotate`,
`install-package` / `packages`, a `PUT`/`POST` hostname twin, two
installation-scoped routes). Each is the spelling the SDK does *not* use, so
none is a live break — but each is a rename waiting to pick the wrong one.

The SDK is pinned by cloud's `.objectstack-sha`, so the contract is asserted
against the framework revision cloud builds and ships against. That is the
right revision to check — but it means a `projects.*` change landing here is
not verified against the control plane until that pin moves.

## 14. The last wildcard, and what it was actually worth (#3718)

§10's capstone ratcheted "matched only by a `**` family" as *weaker* evidence,
to be driven down by enumerating each dynamic family. 60 → 3 after #3656. The
last 3 were `ai.nlq` / `ai.suggest` / `ai.insights` on `* /ai/**`.

Enumerating that family answered the question the ratchet was really asking.
`service-ai` lives in the `cloud` repo (Cloud/EE), so this repo could never see
its table — the dispatcher just proxies to whatever `buildAIRoutes()` returned.
That table is **12 routes**: `chat`, `chat/stream`, `complete`, `models`,
`status`, `effective-model`, and six `conversations` routes.

**None of them is `/nlq`, `/suggest` or `/insights`.**

| | |
|---|---|
| `client.ai` methods | 3 — `nlq`, `suggest`, `insights` |
| …that any repo mounts | **0** |
| Real AI routes | 12 |
| …expressed by the SDK | **0** |

The two sets are disjoint. So the wildcard was not weak evidence — it was
**wrong** evidence, certifying three URLs nothing serves, and its note even
asserted the client "expresses nlq/suggest/insights against the REST AI routes"
(never verified, false). `DEFAULT_AI_ROUTES` in `plugin-rest-api.zod.ts`
declares all three, but has **no runtime consumer** — only the spec's own test
reads it — and `aiNlq?` / `aiSuggest?` / `aiInsights?` are optional protocol
methods nothing implements. Declared, never built (#3718). Instances 7–9 of the
`the method exists ≠ the method can be called` class.

`/api/v1/ai/` is now a bounded prefix exemption alongside the control plane —
two cross-repo surfaces, both ledgered in `cloud`
(`packages/service-ai/src/ai-route-ledger.ts`, 10 `gap` / 2 `server-only`,
enumerated straight off the array `buildAIRoutes()` returns). **The
wildcard-only bound is 0**, and the assertion is `toBe(0)` rather than a
ratchet: every matched call now rests on an exact enumerated route, and
reintroducing a `**` match reintroduces the one kind of evidence this audit
family has caught being wrong.

The generalisable lesson, and the one worth carrying out of §1–§14: **a claim
about a family is not a claim about a member.** Wildcards, prefixes and "the
service handles that" all read as coverage in a green suite. Every one of them
this audit opened turned out to be hiding something.

## Follow-up slicing (proposed)

1. **`client.actions.invoke(...)`** — closes the largest hole (3 routes).
2. **`keys` / `share-links` / `security`** surfaces — 7 gaps, small and mechanical.
3. **Packages lifecycle** (11 gaps) — publish/drafts/commits/revert/export.
4. **Meta drafts/published/FSM + automation descriptors** (6 gaps).
5. **Mismatch reconciliation** (§4) — done in #3584: analytics client aligned to the dispatcher, storage protocol documented as canonical (see §4 Resolution).
6. **Docs**: delete or regenerate README surface table + CLIENT_SPEC_COMPLIANCE.md; extend client-sdk.mdx.
7. **Deprecate `DEFAULT_DISPATCHER_ROUTES`**; point at the ledger.
8. **REST-surface tranche** (§8) with the same ledger+guard treatment — done in #3587.
9. **Autonomous service mounts** (§9) — done in #3636.
10. **Cross-surface URL conformance** (§10, the reverse direction) — done in #3642.
11. **Control-plane surface** (§10) — done in #3655; the ledger lives in `cloud`
    (§13), which is the only repo where both halves are in scope.
12. **Enumerate `/auth/**`** (§11) — done in #3656; wildcard ratchet 60 → 3.
13. **Enumerate `/ai/**`** — done (§14). The wildcard ratchet is now **0**; the
    3 SDK methods turned out to be dead (#3718).
14. **Response-shape conformance** (§12) — error path done in #3675 for both
    services; the storage **success** bodies (three shapes, none carrying
    `success: true`) and the dispatcher's numeric `error.code` remain.

Each gap closed must flip its ledger row to `sdk` and lower the ratchet bound
in the conformance test — the guard enforces both directions from PR-1 onward.
