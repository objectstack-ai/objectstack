---
"@objectstack/rest": patch
---

fix(rest): `/discovery` describes the request's environment, not the control plane (#9292)

`registerDiscoveryEndpoints`' handler opened with `this.protocol.getDiscovery()` — the
**control-plane** protocol captured at construction — while roughly thirty sibling
handlers in the same file obtain theirs from `resolveProtocol(environmentId, req)`.
Everything else in the handler composes over that one document, so the entire body
followed the host's kernel. `/discovery` is the surface SDKs, codegen and AI clients read
to decide what a deployment can do.

**Yes, an observed document changes** — on multi-environment and single-environment
deployments. On a control-plane-only boot nothing changes at all.

The sharper half is the **scoped** route. `registerRoutes` registers the same closure for
the unscoped base and for `.../environments/:environmentId`, so
`GET /api/v1/environments/abc/discovery` — a request naming its environment in the URL —
still received the control plane's document.

**Measured on a two-kernel host before the fix**, with real `getDiscovery()` producers
per environment: two environments with genuinely different kernels received
**byte-identical** `capabilities`, `services` and `locale`, and both received the
*host's* answers rather than either environment's. For the richer of the two tenants that
meant all 13 capability keys wrong (`transactionalBatch`, `automation`, `cron`, `export`,
`comments`, `analytics`, `ai`, `i18n` each reported `false` while the environment
delivered them), its whole `services` map wrong, its `locale` wrong (`en` reported for an
environment serving `zh-CN`), four of its real route keys missing, and a phantom
`routes.notifications` advertised that no tenant could serve.

That is wider than a two-capability defect because the builder derives the whole document
from its own kernel: the `services` map and the optional `routes` keys come from that
kernel's service registry, `locale` from its `i18n` occupant, and the capabilities from
its engine and registry.

The unscoped route reaches the same shared resolution
(`resolveRequestEnvironmentId`, ADR-0076 D11 step ④) rather than getting a special case,
and keeps the control-plane answer exactly where that is the correct one: with no
environment in scope the chain returns `undefined` and `resolveProtocol` falls through to
the captured control-plane protocol. A single-environment boot resolves through step 3
(the default provider) and now describes the kernel that actually serves its data; a
hostname-routed multi-tenant host follows the same authority the HTTP dispatcher uses, so
`/discovery` and the data routes beside it describe one kernel.

Two halves of the handler were already correct and are unchanged: the `realBase` route-
string substitution and the trailing `scoping` block already read
`req.params.environmentId`. The `version` field is overwritten from server config on
every request and never followed the wrong protocol either.
