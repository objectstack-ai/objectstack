---
"@objectstack/plugin-auth": patch
---

fix(auth): authorize before the break-glass guard on `POST /api/v1/auth/admin/remove-user` (#11477)

The break-glass last-local-credential guard is registered as a global better-auth
`hooks.before`, which runs ahead of an endpoint's own middleware. On
`/admin/remove-user` — served directly by better-auth's router, whose
`adminMiddleware` establishes only a session, with the role decision landing
later inside the vendor's handler — that ordering let the guard's lookup and its
distinctive refusal be reached by any **authenticated** caller before either
authorization layer had run. Because that refusal is target-dependent, the
refusal itself carried a per-record fact about a user the caller was not
entitled to ask about.

`/admin/ban-user` already ran the same guard **after** authorization: #9652
shades that path with an ObjectStack raw mount whose platform-admin gate fires
first. One guard, two routes, opposite orders, and nothing asserting either.

`/admin/remove-user` now carries the same shading, converging the whole
`/admin/*` family on **authorization before the guard**. The mount reuses the
landed #9652 / #9653 pattern and introduces no new mechanism.

What changes is **when** the guard decides, never **what** it decides:

- an anonymous caller still gets `401 UNAUTHENTICATED`;
- an authenticated non-admin now gets `403 PERMISSION_DENIED` for every target,
  so the guard is unreachable before authorization and its answer no longer
  varies with the named user;
- a platform admin is unaffected in every respect — the mount **delegates** into
  better-auth rather than re-implementing removal, so the path-keyed hook still
  fires and the guard still refuses the removal of the last local password
  login, and admission remains the vendor's own decision (#9969).

An ordering pin ships with the fix so the sequence is mechanically checkable
rather than re-argued: it asserts that one authenticated non-admin naming two
different targets receives **indistinguishable** responses, and — so the pin
cannot be satisfied by deleting the guard — that an admitted platform admin
still hits the guard's refusal, and still succeeds on an ordinary user.
