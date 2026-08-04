---
"@objectstack/plugin-auth": patch
---

docs(plugin-auth): the session of record is always `sys_session` — cache backs rate-limit counters only (#4785)

Settles an architectural question that had been answered two different ways by
the code and the docs. **Nothing about the runtime changes**: this records the
decision, proves the behaviour that depends on it, and corrects the docs that
described the road not taken.

**The decision.** ObjectStack's session of record is always the `sys_session`
table. The kernel `cache` service serves authentication as the ADR-0069 D2
rate-limit counter store and nothing else. It is never bound as better-auth's
`secondaryStorage`, because that option is not a counter store — handing
better-auth one also relocates sessions into it (`createSession` skips the
`sys_session` row; `findSession` answers from the cached snapshot without
reading the database). ADR-0069 D4's three session controls — idle timeout,
absolute lifetime, concurrent-session cap — all revoke by writing that row, so a
cache-backed session store would silently disable every one of them. Dual-writing
(`session.storeSessionInDatabase: true`) was considered and rejected as the worst
of the options: the row exists, so the controls *appear* to work, while the read
path still answers from the cache.

**Why this needed settling rather than just fixing.** The conflict had never
fired — the cache lookup that would have wired `secondaryStorage` ran before the
cache service registered, so the binding never took in a standard composition.
The declaration and the runtime disagreed for a month and no test could tell,
because no test asserted that a D4 control ends a *live session*; they asserted
at most that a row got stamped. A stamped row nobody reads is exactly the failure
mode in question.

**What is new.** `session-of-record.test.ts` drives the real better-auth pipeline
end to end and proves each of the three D4 controls actually de-authenticates a
live session cookie — not that a column was written. It also pins the
counter-factual: with a `secondaryStorage` bound, `sys_session` stays empty and
the idle timeout never fires. Two facts that make the guarantee hold for real
deployments are pinned with it — `AuthManager` does not plumb
`storeSessionInDatabase`, so the rejected dual-write shape is unreachable through
configuration; and the default composition (OIDC provider on) makes better-auth
*refuse to boot* with a `secondaryStorage` rather than degrade quietly.

**For hosts.** `cacheSecondaryStorage()` remains exported for anyone who wants
better-auth's cached session store deliberately. It now says plainly what it
costs: opting in disables the ADR-0069 D4 session controls, and a revoked session
stays usable until its cached copy expires. Moving sessions into the cache
platform-wide would be a new decision requiring its own revocation-consistency
requirements, not a configuration change.

ADR-0069's D2 "shared store" is scoped to rate-limit counters, D4 records
`sys_session` as a precondition rather than a deployment preference, and the
`ICacheService` contract page no longer lists session storage among the cache's
uses.
