---
"@objectstack/plugin-security": patch
---

The seed-ownership claim now runs whenever a seed settles, on every boot, not only on the boot that promotes the first platform admin.

Clause-②: no

- **Before:** a later boot whose seed replay inserted rows into a database that already had a platform admin left those rows `owner_id` NULL for good. An in-budget seed settles before `kernel:ready`, and the bootstrap that runs there finds the existing admin (`already_have_admin`) and promotes nobody, so neither path reached the claim. A `readScope: 'own'` grant never saw those rows.
- **Now:** when a seed settles (`app:seeded`) before this boot's bootstrap has named a claim target, the handler resolves the target itself: the existing platform admin, by the bootstrap's own `already_have_admin` rule. The claim then hands the replayed rows to that admin. The handler subscribes in `init()`, so a seed that settles before this plugin's `start()` is heard too. That happens on any composition that registers the app first.
- Unchanged: the claim's predicates (`owner_id` NULL or `usr_system`), its object filter and the first-boot promotion path. A row someone else owns is never touched. Under a walled tenancy posture no claim runs, as before.
- Log lines: the claim report reads `handed N seeded record(s) to platform admin USER_ID`, where it used to say `first admin`. Its provisional and failure lines now say when the claim actually runs next: the next seed settle, on this boot or a later one, or the next platform-admin promotion. `os meta resync` is not such a run.
