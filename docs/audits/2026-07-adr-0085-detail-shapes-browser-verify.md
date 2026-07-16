# Audit: ADR-0085 PR4 — real-backend browser verification of the four detail-page shapes

**Date**: 2026-07-16 · **Scope**: objectui `RecordDetailView` rendering after the
legacy monolith detail renderer + `renderViaSchema` kill-switch were removed
(objectui#2546, ADR-0085 PR4). **Method**: drive the running `app-showcase`
backend + the objectui Console (post-#2546 source) in a real headless browser.
**Tracked as**: #2548 (the verification objectui#2546 deferred: "Exercising the
four detail-page shapes … against real data needs a running `@objectstack`
backend, which the CI/agent environment doesn't have. Deferred to #2548 with a
repro runbook.")

## Why this is a separate pass

objectui#2546 deleted the non-schema-driven `DetailView` monolith branch, so
`RecordDetailView` now has exactly **one** path: an authored
`PageSchema(pageType='record')` when assigned, else `buildDefaultPageSchema()`
synthesis — both rendered through `<SchemaRenderer>`. Unit + DOM suites and the
served-metadata proof (`packages/qa/dogfood/test/semantic-roles.dogfood.test.ts`)
cover parse and serialization, but neither renders a page in a browser against a
live backend. This pass closes that gap for the four shapes the PR called out.

## Fixtures (all in `examples/app-showcase`)

| Shape | Object / record | Role posture |
|---|---|---|
| **grouped** | `showcase_semantic_zoo` | `fieldGroups: [basics, money(collapsed)]`, `stageField: 'status'`, `highlightFields: [name,status,amount]` |
| **ungrouped** | `showcase_account` (Details tab) | no `fieldGroups` → flat auto-columns |
| **stageField:false** | `showcase_semantic_zoo_legacy` | `stageField: false` with a `status`-named field (must NOT get a stepper) |
| **related-heavy** | `showcase_account` = "Contoso" | inbound lookups from contact / invoice / project / field_zoo |

`showcase_semantic_zoo{,_legacy}` are the ADR-0085 runtime fixtures; the
`showcase_account` seed provides the ungrouped + related-heavy record (Contoso:
2 contacts, 2 invoices, 2 projects).

## Repro runbook

```bash
# 1. Backend — showcase on a private port + DB, seeded dev admin.
pnpm --filter @objectstack/example-showcase... build            # or: pnpm build
node packages/cli/bin/run.js dev \
  -p 4600 -d file:/tmp/showcase-verify.db --seed-admin --compile \
  --cwd examples/app-showcase
curl -s localhost:4600/api/v1/health          # -> {"status":"ok"}

# 2. Console — objectui source (post-#2546) pointed at the backend. CORS is
#    enabled in dev, so the cross-origin :5180 -> :4600 calls are allowed.
#    DEV_PROXY_TARGET matters too: relative-path calls (/api/v1/runtime/config,
#    /api/v1/dev/metadata-events) go through the Vite /api proxy, which
#    defaults to the dead :3000 without it.
cd ../objectui
VITE_SERVER_URL=http://localhost:4600 DEV_PROXY_TARGET=http://localhost:4600 \
  pnpm --filter @object-ui/console dev  # :5180

# 3. Auth + fixtures (better-auth Bearer). Sign in, grab the set-auth-token
#    header, POST the two semantic-zoo records (not seeded), then drive the
#    detail URLs with Playwright:
#      /apps/showcase_app/<object>/record/<id>
#    inject localStorage['auth-session-token'] = <token> before app boot.
```

The exact Playwright driver + JSON report used for this pass are attached to the
#2548 PR discussion.

## Results — all four shapes render correctly through the schema-only path

| Shape | Observed | Verdict |
|---|---|---|
| **grouped** (`Zoo Grouped Alpha`) | Highlight strip `name / Active / 4,200` (= `highlightFields`); `record:path` stepper **Draft → Active → Done** (from `stageField:'status'`); ungrouped `notes` in the "More details" bucket. | ✅ renders |
| **ungrouped** (Contoso · Details) | Flat two-column field layout (owner / website / HQ / tax / billing) with the "Show 4 empty fields" toggle — no section headers. | ✅ renders |
| **stageField:false** (`Zoo Legacy Beta`) | Highlight strip `name / 99`; the `status` field renders as an ordinary **"STATUS: Green"** field with **no `record:path` stepper** (`[aria-label="Record path"]` absent). The `false` correctly suppresses the heuristic. | ✅ suppressed |
| **related-heavy** (Contoso) | Tab strip **Details · Invoices (2) · Projects (2) · Related (2)** — primary related lists promoted to their own tabs, the rest collapsed into "Related" (ADR-0085 prominence rule); lists lazy-fetch on tab show. | ✅ renders |

`hasRecordPath` matched the expectation for every case (true for grouped +
related-heavy, **false** for stageField:false). No page-render errors, no error
boundaries, no missing-data states.

### Note on the "grouped" fixture

`showcase_semantic_zoo`'s grouped fields (`status` ∈ basics, `amount` ∈ money)
are *also* its `highlightFields`, so they surface in the highlight strip and the
`record:details` derivation correctly drops the now-empty Basics/Money groups,
leaving only the ungrouped `notes` ("More details"). This is the intended
"one curated list, every surface" behavior — the same reason Contoso's
highlighted `status/industry/revenue` do not repeat in its Details body. The
`fieldGroups → section` derivation itself (declared order, collapse, trailing
untitled bucket) is separately proven over the served pipeline in
`semantic-roles.dogfood.test.ts`.

## Out-of-scope observations (triaged in the #2548 follow-up)

- `502 /api/v1/runtime/config` / `502 /api/v1/dev/metadata-events` — **harness
  misconfiguration, not a product defect**. The console dev server proxies
  `/api` to `DEV_PROXY_TARGET` (default `http://localhost:3000`); this pass set
  only `VITE_SERVER_URL`, so relative-path calls hit the proxy's dead default.
  Correct invocation (now also in the runbook above):
  `VITE_SERVER_URL=http://localhost:<port> DEV_PROXY_TARGET=http://localhost:<port> pnpm --filter @object-ui/console dev`.
  In production the SPA and runtime share an origin, so relative paths are by
  design. `initRuntimeConfig` absorbed the failure and the app rendered anyway.
- `401 /api/v1/approvals/requests?…` (header approvals badge) — **real latent
  defect for split-origin deployments**: `approvalsApi` authenticated with
  cookies only (`credentials: 'include'`) while every other console API call
  sends the Bearer token, so any deployment where the SameSite cookie doesn't
  flow (custom-domain console ↔ API split, or this token-injected harness)
  loses the approvals surface. Fixed in the objectui #2548 follow-up —
  `approvalsApi` now attaches the stored Bearer token like the rest of the
  console.

## Conclusion

The removal of the legacy monolith renderer (objectui#2546) leaves all four
detail-page shapes rendering correctly through the single `SchemaRenderer` /
`buildDefaultPageSchema` path against a real `@objectstack` backend. **No
regressions found; no objectui follow-up required.** The framework-side cleanup
#2546 flagged (the stale `renderViaSchema` source comment) ships alongside this
note.
