---
'@objectstack/service-automation': minor
---

fix(service-automation)!: a `runAs: 'user'` hook fired by a user-triggered `runAs: 'system'` flow's write runs on that user's own grants

Clause-②: no (narrowing) — a `runAs: 'user'` hook fired by a write of a `runAs: 'system'` flow that names a user now runs on that user's own grants instead of the member baseline, so for a user whose own grants admit less than the baseline its reads narrow; the published `RunIdentityContext` / `RunDataContext` types make `positions` and `permissions` optional, and no published schema or export moves.

<!-- adr-0087: not-required (no-migration-prescription) A runtime semantics change of the data context a runAs 'system' flow run hands ObjectQL when it names a user, not a metadata shape change. No spec key, enum value, export, option, config field, response field or stored shape is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite. What narrows is whose grants a runAs 'user' hook fired by such a run's write carries: the named user's own, resolved in the run's organization, instead of the member baseline, so for a user whose own grants admit less than the baseline that hook reads less. The run's own operations keep full system privileges. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this behaviour and this diff adds none (not registered / already-registered); and the change is a behaviour change, not only an interface or type change (not runtime-interface-only / type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `runAs: 'system'` flow run that names a user (a manual run, a record change fired by a user's write, and every post-decision node of a `runAs: 'system'` approval flow, where the user is the decider) handed ObjectQL `{ isSystem: true, userId, tenantId, positions: [], permissions: [] }`. Its own operations never read the two arrays: elevation short-circuits every gate before they are read. But a `runAs: 'user'` hook fired by one of its writes de-elevates to that context, and the engine keeps the arrays a context carries, resolving the user's grants only when none are carried. So that hook ran on the member baseline, whoever the user was.

- **Now:** a `runAs: 'system'` run that names a user carries no `positions` or `permissions` in its data context. A `runAs: 'user'` hook its writes fire resolves the named user's own positions, permission sets and organization peers in the run's organization, exactly as that user's own request resolves them. After an approval decision that user is the decider, so the hooks the post-decision writes fire run on the decider's grants.
- **Wider:** for a user granted more than the baseline, such a hook now reads and writes what the user may, where it was refused on objects the baseline does not grant.
- **Narrower:** for a user whose own grants admit less than the baseline, such a hook now reads only what that user's own request reads.
- **Unchanged:** the run's own elevation, `isSystem`, its `actor` label, its `userId` and its `tenantId`; a user-less `runAs: 'system'` run (a schedule), which keeps `positions: []` and `permissions: []`, and a `runAs: 'user'` hook it fires is still refused for want of a user; hooks declaring `runAs: 'system'` or `'inherit'`; and `runAs: 'user'` flows.

The published `RunIdentityContext` and `RunDataContext` types of `@objectstack/service-automation` declare `positions` and `permissions` optional, because a `runAs: 'system'` envelope that names a user no longer carries them. Code that reads either member from `resolveRunDataContext`'s answer must allow for its absence.

What changes for you: a `runAs: 'user'` hook that a user-triggered `runAs: 'system'` flow fires now sees exactly what that user sees. If such a hook must read or write something the user may not, declare it `runAs: 'system'`.
