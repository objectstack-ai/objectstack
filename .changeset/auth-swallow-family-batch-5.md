---
"@objectstack/plugin-auth": patch
---

fix(plugin-auth): report the refused identity writes ten `catch {}` sites swallowed (#12981)

Batch 5 of the ruled `catch { return null; }` worklist, scoped to `plugin-auth`.
A re-run of the census instrument
(`scripts/measure-durability-swallow-family.mjs`) moves tier-1 DARK from
**21 sites in 11 files to 11 in 10**, with `LOUD` rising **32 → 34** and the
adjacent `QUIET` bucket **85 → 93** — the ten, moved, nothing else touched.

Every site swallowed a refused write into a bare `catch` whose comment said
"best-effort". That was true about **control flow** — a bookkeeping write must
never turn a valid sign-in into a 500 — and it was being read as permission to
say nothing, which is a different decision. The request answered 200, the
session was issued, and nothing downstream looked wrong; the write simply did
not happen. In `plugin-auth` that silence was hiding **security controls that
had quietly stopped enforcing**.

**What an operator now sees that they did not before** — one line per seam,
each naming the object that did not land, the control that is consequently not
enforced, and the remedy:

- **`recordSignInOutcome`** — a refused `failed_login_count` / `locked_until`
  write means consecutive failures never accumulate and the account is never
  locked: `lockoutThreshold` (ADR-0069 D2) is configured and not enforced, so a
  brute-force run against that account meets no limit.
- **`recordPasswordHistory`** — a refused ring write means the password just
  replaced was never recorded, so `passwordHistoryCount` (ADR-0069 D1) will not
  refuse it next time. "You cannot reuse your last N passwords" is advertised
  and, for that identity, not enforced.
- **`enforceSessionControls`** — a refused revocation leaves a session that IS
  past its idle / absolute limit fully live (ADR-0069 D4). A refused activity
  heartbeat is reported separately, because it fails the other way: the idle
  clock keeps measuring from an older instant, so an active user is signed out
  **earlier** than the configured window.
- **`enforceConcurrentCap`** — a refused revocation leaves the account holding
  more simultaneous sessions than `maxConcurrentSessions` allows.
- **`stampIdentitySource`** (and its SCIM twin in `auth-plugin.ts`) — a refused
  provenance stamp leaves a federated identity still reading `env_native`, so it
  is offered the local-password actions that are supposed to hide for a managed
  identity (cloud ADR-0024 D4) — the path by which a managed user self-mints a
  password that bypasses enforced SSO. The SCIM hook is the sharper of the two:
  it is the **only** stamp on the adapter-level path and nothing retries it.
- **`unlockUser`** — the password stage is cleared and the method still answers
  `true`, so the admin is told the unlock worked while a user locked at the
  second factor stays locked with no escape hatch at all. That `true` is
  exactly why the silence had to go.
- **`stampPasswordChangedAt`** — a refused write leaves any admin-issued
  force-change flag SET (so the user is told to change a password they just
  changed) and leaves the password-age policy reading a timestamp for a password
  that no longer exists.
- **`stampLastLogin`** — this write is what plugin-audit turns into the
  change-trail row, so a refusal leaves the sign-in with **no** trace in the
  compliance ledger at all.

Three inline `.catch(() => undefined)` swallows inside the two session controls
are repaired in the same change. They are not optional to it: they sit between
the refused write and the enclosing `catch`, so repairing only the outer handler
would have produced a reporter that could never fire — a green-looking fix over
an unchanged silence.

Level: the eight `AuthManager` seams report at `warn`, not `error`.
`AuthManagerOptions.logger` declares `{ info?; warn }` with no `error` and is
re-exported from the package `index.ts`, so adding one is a published-shape
change; #12981 routes that question to #13398 and scopes this batch to the
**silence**, exactly as batches 1 and 2 did for `plugin-security`. The two
`AuthPlugin` seams log through the kernel `Logger`, whose `error` is required,
and use it.

No entry was added to `scripts/durability-degradation.baseline.json`, and the
gate vocabulary is untouched in either direction.
