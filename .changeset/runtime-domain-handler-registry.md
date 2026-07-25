---
"@objectstack/runtime": minor
---

feat(runtime): thin domain-handler registry seam in the HTTP dispatcher — ADR-0076 D11 step ③, PR-1 (#2462)

`dispatch()` routed every domain through one hand-written
`if (cleanPath.startsWith('/xxx'))` chain — the "god implementation on a clean
port" shape ADR-0076 D11 calls out. This lands the decomposition seam: a
first-match `DomainHandlerRegistry` consulted before the legacy chain, plus a
public `HttpDispatcher.registerDomainHandler()` so follow-up PRs can hand each
domain's normalized handler to its owning service package.

Migration discipline is "registry first, code moves later, ownership last":
this PR only wraps four existing branches (`/health`, `/ready`, `/analytics`,
`/i18n` — three shapes: no-service probe, service bridge, optional-service
501) into registry entries with faithful legacy matching semantics. Zero
behavior change, locked by the 41-assertion http-conformance cross-adapter
suite and 11 new seam tests.
