---
'@objectstack/core': patch
---

perf(core): an administrator whose `admin_full_access` grant belongs to the Default Organization no longer pays a `sys_organization` read on every authenticated request

Clause-②: no (a per-engine memo of an unchanged read: no accept set, standing verdict or served body moves; owes the seat's review of record before the queue, at `CONTRACT_REVIEW_TIER` because it is the platform-standing anchor)

- **The Default Organization is read once per engine, not once per request.** Under `single`, `resolveUserAuthzGrants` asks for the Default Organization whenever the principal holds an organization-owned `admin_full_access` grant: one `sys_organization` read, or two when the only organization is not slugged `default`. The answer is now kept per engine across requests. On a booted composition the warm `get-session` costs 8 statements and a data read 10, the same as for an organization-less grant. Before, it cost 9 and 11, or 10 and 12.
- **What retires it.** Any `sys_organization` write through the engine (insert, update, delete), observed after it settles. A peer replica's write is seen through the `remote` and `metadata` epoch bumps the `authz.invalidated` and metadata bridges deliver. A 30-second bound covers what no seam sees: a peer's write with no bridge attached, a write that started before the engine's observer registered, and a write inside a transaction that has not committed yet. A Default Organization that is deleted and recreated, or a `default` slug moved to another organization, is read again on the next request.
- **A failed read is not kept.** A read that fails with the authorization store unavailable propagates as before, and the next request reads again. "No Default Organization" (no organization, or several and none `default`) is a real answer and is kept.
- **Unchanged:** the two reads, their filters and limits, and the platform-standing predicate the answer feeds. An engine without the write epoch and `registerMiddleware`, or a registry that does not hold `sys_organization`, keeps reading every time.
