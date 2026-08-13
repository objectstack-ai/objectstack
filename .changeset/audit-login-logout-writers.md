---
"@objectstack/plugin-audit": minor
"@objectstack/plugin-auth": minor
---

feat(audit): sign-in and sign-out are recorded in `sys_audit_log`, with the actor and the tenant (#8144)

`sys_audit_log.action` declares `login` and `logout`, the shipped `auth_events`
list view filters on them, and two System Overview dashboard widgets chart them —
but **nothing in the platform ever wrote either row**. The audit writers subscribe
to the ObjectQL CRUD lifecycle, so `create`/`update`/`delete`/`restore` were the
only actions that could ever materialize. On a fresh boot, signing in and then
querying `GET /api/v1/data/sys_audit_log?$filter={"action":"login"}` returned
**total 0**, and the `auth_events` view was empty by construction.

The whole trace a sign-in left behind was one **unattributed** `update sys_user`
row (`user_id` null) diffing `last_login_at` — a compliance ledger recording that
somebody, unknown, had signed in.

Both halves are fixed:

- **`login` on every session creation.** The writer is wired to better-auth's
  `session.create` database hook rather than to the `/sign-in/email` endpoint, so
  it covers every way a session is minted — email sign-in, sign-up auto-sign-in,
  SSO, OAuth callback, magic link, email OTP, passkey. The row carries the actor
  (`user_id`), the tenant (`tenant_id` + the RLS `organization_id`), the session
  it is about, and the client fingerprint better-auth recorded (IP, user agent).
  An impersonation session keeps the subject on `user_id` and names the
  impersonating admin on `actor`, so it cannot be misread as a self-service login.
- **`logout` on sign-out.** Scoped to `POST /sign-out` deliberately: a session row
  is also deleted by admin revokes, `/revoke-session`, bans, user erasure and
  better-auth's own collection of expired rows, and recording any of those as
  `logout` would name an action the user never took. Those revocations already
  carry their own cause on the ADR-0069 D4 session tombstone.
- **The `last_login_at` write is now attributed.** It goes out through the
  platform's existing attribution channel (`ExecutionContext.attributedUserId`),
  so the row names the person who signed in. It is attribution only — the write
  still authorizes as the system, and nothing about who may touch `sys_user`
  changes. The row is kept rather than suppressed: a login from a new address is
  exactly what a compliance ledger is read for.

The audit plugin now registers the `audit` service, the ledger's write ingress
for events that are not CRUD. `@objectstack/plugin-auth` resolves it lazily and
takes no dependency on the audit package — a deployment without the audit plugin
installed writes no auth rows, exactly as before.

No API, schema or enum changes: `login`/`logout` were already declared members of
the `action` enum, and `sys_audit_log` remains `get`/`list`-only over HTTP.
