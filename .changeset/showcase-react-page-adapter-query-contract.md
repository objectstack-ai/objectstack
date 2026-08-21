---
"@objectstack/example-showcase": patch
---

Fix the showcase react pages' `useAdapter()` query contract, and pin it (#10288)

`renewals-pipeline` passed `top: 500` and `crm-workbench` passed `limit: 200` to
`adapter.find`. Neither is a query option: `QueryParams` declares only `$`-prefixed keys
and `ObjectStackAdapter.convertQueryParams` copies exactly those, so the key reached no
branch and was dropped with no error. The consequence is the opposite of a truncated
read — the GET list route has **no default page size**, so an absent `top` returns the
ENTIRE match set, and the cap the author wrote never happened.

The same effect then read its rows off `.records`. `find()` resolves to a normalized
`QueryResult` (`data` + `total`), never the REST envelope, so `pr.records` was
`undefined` on every call and the renewals KPI strip sat at `0 / 0 / 0` while the
`<ListView>` beside it showed the same rows correctly. Measured on a 640-row account with
the real page source driven against a contract-faithful adapter double: before,
`$top` arrives `undefined` and the strip reads `{projects: 0, invoices: 0, openInvoices: 0}`;
after, the cap is applied and it reads `{projects: 640, invoices: 640, openInvoices: 100,
capped: true}`.

Applying the cap is only half a fix, because `data.length` under a `$top` is exactly the
silently-capped count the card was filed about — so both pages now count the envelope's
`total` (the server's real count over the same `$filter` whenever a limit was applied).
The one number a cap genuinely bounds, "Open AR", is a per-row verdict over the fetched
window; it renders as `100+` rather than passing for a total.

`test/react-page-adapter-query-contract.test.ts` executes the page's real rollup effect
and then sweeps every `kind:'react'` page in the app for both contracts, with an
extraction control, a census control, and a positive control on the scanners.
