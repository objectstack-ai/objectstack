---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): the D5.1 `/oauth2/authorize` env-access gate now runs for a signed bearer credential (#8102)

ADR-0069 D5.1's cloud-as-IdP gate (`oidcAuthorizeGate`) is what enforces
org-membership / app-assignment before the OP issues an authorization code. It
resolved its subject with an **inline copy** of the shared `resolveActor` —
line for line the same logic, in a second place — and the two diverged the
moment one of them was fixed.

`#8049` taught `resolveActor` that a bearer credential must have its signature
stripped before lookup: `bearer()` hands clients the signed form in the
`set-auth-token` response header (the documented API-lane credential) and
accepts it back, while `session.token` stores the **unsigned** value. The copy
guarding `/oauth2/authorize` kept looking the signed credential up verbatim and
so resolved nothing.

**Why that is a security defect and not a lookup miss.** The unresolved case at
this endpoint is deliberately **fail-open** — an anonymous caller must fall
through so the OP can redirect them to log in. So an *authenticated* caller
holding the signed bearer was read as unauthenticated, and the env-access check
was not denied but **never evaluated at all**: the request proceeded, and
against a `skip_consent` client it was issued an authorization code that the
gate, had it run, would have refused. A declared control enforced for one
credential spelling and silently absent for the other.

Impact is bounded: `oidcAuthorizeGate` is set only on the cloud control plane
(unset in open editions / self-host, where there is no gate at all), and the
OP's authorize endpoint is normally browser/cookie-driven — the cookie branch
always normalized and was never affected.

**Fix.** The inline copy is deleted; the branch calls the shared
`resolveActor`, so there is one resolution site instead of two. The fail-open
default for genuinely unauthenticated callers is unchanged and deliberately
preserved.

Pinned by a new dogfood gate that arms a **denying** gate and drives
`/oauth2/authorize` over the cookie lane and both accepted bearer spellings,
asserting on each that the gate was actually invoked with the caller as its
subject and that the request was refused rather than issued a code.
