---
"@objectstack/plugin-security": patch
"@objectstack/runtime": patch
---

fix(security): fail closed when an object's security posture can't be resolved
(#3545)

#3545 accepted the API-exposure gate's fail-open on unresolvable metadata on one
load-bearing premise: that gate is a SURFACE-AREA control, while the real
authorization boundary — auth + the ObjectQL security middleware (CRUD/FLS/RLS)
— enforces unconditionally on the data call whatever the gate answers.

Verifying that premise rather than assuming it shows it did not hold. The
middleware does run unconditionally, but two of its INPUTS were read from the
same object metadata and defaulted permissively when it could not be resolved,
so the very trigger the issue is about reached one layer PAST the gate, into the
boundary itself: an unresolved `access.default` read as PUBLIC (so a plain `'*'`
wildcard covered an object ADR-0066 D2 excludes from it) and an unresolved
`requiredPermissions` read as NO CONTRACT (so the D3 capability AND-gate was
skipped entirely).

`getObjectSecurityMeta` now flags `unresolved`, and the three consumers that turn
posture into an access decision fail closed on it: the middleware denies (with an
error log, so a persistent metadata outage is observable rather than a silent
blanket-allow), `canExport` denies, and `getReadableFields` exposes no columns —
the same stance already taken for a permission-resolution failure and a dangling
delegator. `computeLayeredRlsFilter` keeps consuming the defaults deliberately:
there the permissive value WITHHOLDS the cross-tenant exemption, so it is already
the closed direction.

Blast radius is bounded to the risky case. System/boot writes (`isSystem`) and
principal-less/anonymous contexts short-circuit earlier in the middleware, so
reaching the new check means an authenticated principal with resolved grants
asking for an object whose declaration is missing; the cold-start window is
served by those short-circuits, not by the permissive default. The exposure
gate's own tiered decision (transient unavailability → fail open) is therefore
unchanged — it now rests on a boundary that actually holds.

The explain engine reports the denial on its existing `object_crud` layer naming
the real cause, so the "why am I denied?" surface cannot drift from enforcement.
