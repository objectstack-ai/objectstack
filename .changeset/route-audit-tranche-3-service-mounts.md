---
"@objectstack/service-storage": patch
"@objectstack/service-i18n": patch
"@objectstack/client": patch
---

fix(client,service-i18n): ledger the autonomously-mounted service routes, and repair the two i18n calls that reached nothing (#3636)

Tranche 3 of the #3563 route audit — the last un-audited server surface. The
dispatcher ledger (#3563) and the REST ledger (#3587) each stop at their own
package boundary, and two services mount routes outside both: they reach for
the `http-server` service and register straight on `IHttpServer`, so neither
`RouteManager` nor `RestServer.getRoutes()` has ever seen them. That left the
SDK's entire storage surface, plus all of i18n, in the pre-#3563 posture:
expressed, working, guarded by nothing.

**Ledgers + guards.** `storage-route-ledger.ts` (10 routes) and
`i18n-route-ledger.ts` (3) sit next to the registrars that mount them, each
enumerated for real — the registrar runs against a capturing mock
`IHttpServer` and its registration calls *are* the route set, so a new route
lands with a reviewed disposition or fails CI. The client half is
`packages/client/src/service-route-ledger-coverage.test.ts`; ledgers cross the
boundary as relative source imports, never a service→client package edge.

**Two wire-level 404s fixed.** `i18n.getTranslations` sent
`/i18n/translations?locale=xx` and `i18n.getFieldLabels` sent
`/i18n/labels/:object?locale=xx`, while every serving surface — service-i18n's
mounts, the dispatcher's HTTP mounts, and the `plugin-rest-api.zod.ts`
contract — mounts only the path form. Neither call could ever be answered.
Both had carried a green `sdk` row in the dispatcher ledger since tranche 1,
because that guard asks whether the client *method* exists, not whether it
speaks a URL anything mounts. The client now sends the path dialect, the same
resolution #3611 gave `meta.getView`, and a new suite drives the real client
at a real router so a revert cannot pass quietly.

**One response-shape fix.** service-i18n's success bodies omitted the
`success` flag that `ObjectStackClient.unwrapResponse` keys on, so the SDK
returned the raw `{ data: … }` wrapper against that provider while returning
the declared unwrapped shape against the dispatcher — one method, two shapes,
decided by which plugin mounted the route. Its three handlers now emit the
`{ success: true, data }` envelope the `i18n` route group declares. `data` did
not move, so direct body readers are unaffected.

Storage audited clean: 7 routes SDK-expressed, 3 reviewed `server-only` (the
browser capability URL objectql stamps into file-field payloads, and the two
local-driver loopbacks). The chunked-upload family, flagged for triage, turned
out fully expressed. Both ledgers ratchet `gap` and `mismatch` at zero.

Filed, not fixed: `GET {base}/_local/file/:key` is built by three call sites
and mounted by none (#3641); the cross-surface URL conformance guard that would
have caught all of the above mechanically is the capstone (#3642).
