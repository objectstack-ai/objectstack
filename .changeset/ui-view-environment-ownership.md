---
"@objectstack/rest": minor
---

fix(rest): require the resolved environment to belong to the caller at `GET /api/v1/ui/view/:object/:type` (#13214)

**Security floor.** This route was the one identity-touching route in
`RestServer`'s table that resolved no identity at all: it went from
`resolveProtocol` straight to `getUiView`, answering **200** to an anonymous
caller, byte-identical to an entitled one, with `resolveExecCtx` called **zero**
times — while the other 52 identity-touching routes answered 401 under an absent
context.

Because the unscoped mount lets the REQUEST name its environment (bound
hostname, else the `X-Environment-Id` header), that made it a cross-environment
disclosure rather than a single-tenant one. Driven on the real route table with
a real `envRegistry` + `kernelManager`: an anonymous request naming another
environment received **that environment's** UI view — object label plus every
field's `name` / `label` / `type` / `required` / `readonly` — through **both**
naming channels, with the foreign kernel acquired. The route was additionally an
object-existence oracle for whatever environment was named, and an
**environment-id** oracle: an unresolvable `X-Environment-Id` was not refused but
silently fell through to the default environment and answered 200 with *that*
environment's view, so two 200s with different bytes distinguished a real
environment id from an invented one.

Maintainer ruling 2026-08-30 (option C). Adding anonymous-deny alone was
explicitly measured **not** to be the repair — it stops the anonymous caller and
nothing else, because an authenticated caller could still name a foreign
environment and nothing downstream compared the environment that was *resolved*
with the environment the caller is *entitled to*.

What the seam does now, in order: resolve the environment once through the
shared entry point; resolve identity **in that environment**; refuse anonymity;
then compare. The comparison reads `__authEnvironmentId` — an internal key
`computeExecCtx` now stamps on every context it produces, naming the environment
whose auth service actually validated the caller. It differs from the resolved
environment in exactly the branch that crosses: when the resolved environment's
kernel carries no `auth` service, the lookup falls back to the **default**
environment's, and a session minted there authenticated a request naming another
one.

Both refusable shapes answer with the anonymous-deny envelope **verbatim**
(401 `UNAUTHENTICATED`), and that is deliberate rather than tidiness: a caller
naming a real foreign environment is already refused by the anonymous gate
(their credential is not valid there), so giving "you do not own this
environment" or "that environment id does not resolve" any *other* status would
rebuild the id oracle one layer up. One shape, byte for byte, for every way a
caller can fail to be entitled to the environment it named. The cost is
diagnosability: an operator whose environment genuinely lacks an `auth` service
sees the anonymous 401 rather than a wiring error.

**Migration.** The published route changes from "anonymous read" to
"authenticated **and** ownership-checked", so a caller that relied on the old
behaviour breaks:

- An **anonymous** consumer of `/ui/view/...` (for example a login screen
  rendering a view before authentication) now receives 401. There is no opt-out;
  the route is not on `isAuthGateAllowlisted` and was never a declared
  control-plane exemption.
- A caller sending `X-Environment-Id` **while on a hostname bound to a different
  environment** now receives 401 instead of being served the hostname's
  environment. Drop the contradictory header; the bound hostname still decides.
- A caller sending an `X-Environment-Id` the registry cannot resolve now
  receives 401 instead of the default environment's view.
- A deployment where an environment's kernel carries no `auth` service of its
  own now refuses requests naming that environment, because the credential
  would have been validated in the default environment instead. Wire the
  environment's `auth` service.

Scoped (`/environments/:environmentId/ui/view/...`) and unscoped mounts are both
gated; naming an environment in the URL is no more of an entitlement than naming
it in a header. What the producer is *told* is unchanged — `getUiView` still
receives `{ object, type }` on the unscoped mount and the route-supplied
`environmentId` on the scoped one.
