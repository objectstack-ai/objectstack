---
'@objectstack/lint': minor
'@objectstack/cli': minor
---

Navigation reachability vs. granted access (issue #3583, assessment R5)

`validate-nav-access` joins what an app's navigation exposes against
`buildAccessMatrix` — the first lint consumer of the ADR-0090 D6 matrix, which
previously only backed `os compile`'s snapshot gate. An object in the menu that
no permission set grants read on renders as an entry and then fails
permission-denied when opened: it works while you browse as an administrator
(the platform's built-in `admin_full_access` carries a wildcard grant) and
breaks for exactly the users the app ships permission sets for.

Advisory severity — a grant can legitimately come from a permission set another
installed package ships. Quiet by construction in three cases: platform-provided
objects (their own packages grant them), stacks that declare no permission sets
at all (permissions managed elsewhere, so flagging every entry says nothing),
and any stack where a set carries a wildcard `objects: { '*': … }` grant — the
shape `admin_full_access` itself uses, which the access matrix records under the
literal key `*`.

Wired into `os validate`, `os lint`, and `os compile`.
