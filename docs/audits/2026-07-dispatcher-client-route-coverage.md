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

## Follow-up slicing (proposed)

1. **`client.actions.invoke(...)`** — closes the largest hole (3 routes).
2. **`keys` / `share-links` / `security`** surfaces — 7 gaps, small and mechanical.
3. **Packages lifecycle** (11 gaps) — publish/drafts/commits/revert/export.
4. **Meta drafts/published/FSM + automation descriptors** (6 gaps).
5. **Mismatch reconciliation** (§4) — server-side aliases or client-side fixes.
6. **Docs**: delete or regenerate README surface table + CLIENT_SPEC_COMPLIANCE.md; extend client-sdk.mdx.
7. **Deprecate `DEFAULT_DISPATCHER_ROUTES`**; point at the ledger.
8. **REST-surface tranche** (§8) with the same ledger+guard treatment.

Each gap closed must flip its ledger row to `sdk` and lower the ratchet bound
in the conformance test — the guard enforces both directions from PR-1 onward.
