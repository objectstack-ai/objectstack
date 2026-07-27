---
"@objectstack/runtime": minor
---

feat(runtime): extract the first four dispatcher domain bodies into `domains/` modules — ADR-0076 D11 step ③, PR-2 (#2462)

The `/analytics`, `/i18n`, `/notifications` and `/security` handler bodies
move out of the `HttpDispatcher` god class into per-domain modules under
`packages/runtime/src/domains/`, running against an explicit
`DomainHandlerDeps` contract (resolveService / getService / success / error —
the WHOLE dispatcher surface a domain may touch). The dispatcher keeps thin
`handleXxx` delegates for direct callers, and `/notifications` + `/security`
leave the legacy if-chain for the domain registry (new `match: 'segment'`
preserves their `=== p || startsWith(p + '/')` branch shape exactly).

Route registration stays dispatcher-owned on purpose: most service slots are
multi-provider (i18n = I18nServicePlugin OR the AppPlugin in-memory fallback;
analytics = service-analytics OR the ObjectQLPlugin fallback), so a route is
the bridge to a SLOT, not the property of any one providing package. Zero
behavior change — http-conformance (41 cross-adapter assertions) and the
seam suite (18 tests) lock it.
