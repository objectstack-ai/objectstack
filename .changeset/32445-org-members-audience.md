---
'@objectstack/service-messaging': minor
'@objectstack/service-automation': minor
'@objectstack/plugin-audit': minor
---

feat(messaging): the `org:members` audience reaches every member of the emitting organization, and `role:` / `team:` read every member instead of the first 10,000

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-automation/SKILL.md (its `notify` example names a recipient by id or envelope only; no audience selector, `org:members` included, is taught there)

An administrator, or a flow, can now address an announcement to the whole organization. Before this, the only spelling was a list of every built-in role (`role:owner`, `role:admin`, `role:delegated_admin`, `role:member`), which missed every member holding no role, or one outside the four, without a word.

- **`@objectstack/service-messaging`: the `org:members` audience.** `emit({ audience: 'org:members', organizationId })` resolves to every `sys_member` of `organizationId`, whatever the member's `role`. The organization is the emit's own, the one `role:` has always scoped to; it is never read from the audience string. An emit that names no organization resolves `org:members` to nobody, with a warning, and reads no membership at all. `org:` is reserved whole: any other value under it (`org:member`, `org:<id>`) resolves to nobody with a warning naming the one spelling, instead of being kept as a bare user id. The resolved count is logged at `info`. `ORGANIZATION_MEMBERS_AUDIENCE` is exported.
- **`@objectstack/service-messaging`: membership expansions page to the end.** `org:members`, `role:` and `team:` read their membership in pages of 1,000 rows (`membershipPageSize` on `RecipientResolver` overrides it), ordered by `id`, until a short page. `role:` and `team:` used to read one page of 10,000 and drop the rest without a word; a larger membership is now reached in full.
- **`@objectstack/service-automation`: a `notify` node passes `org:` recipients to the resolver.** Its written-address screen, which mirrors the resolver, no longer reads an `org:` value as an email address, as it already did not for `role:`, `team:` and `owner_of:`. `recipients: 'org:members'` reaches every member of the notification's organization: the run's, else that of the record the notification is about.
- **`@objectstack/plugin-audit`: the `@mention` gate keeps its list of audience prefixes in step with the resolver.** A mention of an `org:` value names no person and notifies nobody, as a mention of `role:`, `team:` or `owner_of:` already did.

To reach the whole organization from a flow:

```ts
{ id: 'announce', type: 'notify', label: 'Announce', config: {
  recipients: 'org:members',
  title: 'Maintenance window',
  message: 'Saturday 02:00-04:00.',
} }
```
