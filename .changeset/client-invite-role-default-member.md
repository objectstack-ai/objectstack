---
"@objectstack/client": patch
---

fix(client): `organizations.invite` defaults `role` to `'member'`, so the shorter call it declares actually works (#16582)

`organizations.invite` declares `role?` as **optional** and forwarded the caller's object to better-auth verbatim. better-auth 1.7.2's body schema for `POST /organization/invite-member` makes `role` **required**, so the documented-looking minimal call was refused before it reached any ObjectStack code:

```
client.organizations.invite({ email, organizationId })   ->  400  [body.role] Invalid input   (VALIDATION_ERROR)
```

Omitting `role` now sends `'member'`. **No published type moves** — `role` stays optional, and a caller who names a role still gets exactly that role on the wire (including `role: undefined`, which is treated as omission rather than dropped).

The default is `'member'` because the sibling `organizations.invitations.resend` has always substituted exactly that over the **same** vendor endpoint. That asymmetry is why the gap stayed invisible: one member of the family papered over the vendor's requirement and the other did not, so only the shorter form ever failed. It is also the least-privileged name in the closed membership vocabulary (ADR-0108 D1 — `orgRoleGrade` floors at `member` and rises only for `owner`/`admin`), and an invitation is a pending row the invitee must still accept, so the implicit choice cannot confer reach the caller did not ask for.

Measured against a real `AuthManager` (better-auth 1.7.2, organization plugin, `teams: { enabled: true }`) over a real `SqlDriver` (better-sqlite3), before and after:

```
before:  POST /organization/invite-member  ->  400  {"message":"[body.role] Invalid input","code":"VALIDATION_ERROR"}
after:   POST /organization/invite-member  ->  200  {"role":"member","status":"pending", ...}
```

No caller had to change: the census found no in-repo or Console caller using the two-argument form, so this repairs a path that was declared and unreachable rather than one that was in use.
