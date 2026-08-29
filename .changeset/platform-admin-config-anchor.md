---
'@objectstack/core': minor
'@objectstack/plugin-auth': minor
---

`PLATFORM_ADMIN` can now be anchored on deployment CONFIGURATION instead of a stored grant row: an account whose `sys_user.email` is on `OS_PLATFORM_OWNER_EMAIL` **and** whose `email_verified` reads verified resolves `PLATFORM_ADMIN` with the declared `admin_full_access` capability set, derived live on each authorization resolution (#11663 leg L2, design accepted 2026-08-25 as bundle 1A/2B/3A/4A/5A/6A/7A).

**Additive — nothing is revoked.** The legacy unscoped `admin_full_access` grant still confers exactly as it did; a holder whose standing rests on the row alone now gets a once-per-process pointer at the configuration line that re-anchors them. A deployment that has declared no administrators resolves byte-identically to before: the config list is empty, the derivation answers "not an admin" before it reads any row, and the pinned batch-equivalence query multiset is unchanged.

**The variable takes a list.** `OS_PLATFORM_OWNER_EMAIL` accepts one address or a comma-separated list of them — one normalization (`trim().toLowerCase()`), duplicates collapsed, blank entries dropped. ⛔ Any entry that is not an address **fails the whole variable closed** with a loud refusal naming it, rather than being skipped: silently dropping a typo would leave a narrower administrator set than the operator declared, with nothing anywhere to notice. Unset, blank or refused all mean **zero** config-derived administrators.

**Verified-email match only.** An unverified account holding a configured address confers nothing, and an ABSENT `email_verified` column reads unverified. The match reads the caller's own **stored** `sys_user` row, never the caller-supplied session email.

New exports from `@objectstack/core`: `resolvePlatformAdminEmails`, `parsePlatformAdminEmails`, `matchesConfiguredPlatformAdmin`, `normalizePlatformAdminEmail`, `PLATFORM_ADMIN_EMAIL_SEPARATOR`, `ADMIN_STANDING_NON_TABLE_INPUTS` and the test hooks beside them. `@objectstack/core` now depends on `@objectstack/types` (measured acyclic: `types` depends only on `spec`).

`@objectstack/plugin-auth`'s break-glass guard follows the derivation, as it must: `ADMIN_STANDING_SURFACE.sys_user` is reclassified `derives`, the last-administrator enumeration counts config-derived administrators through the resolver's own predicate, and a fifth write shape is judged — a change of address or an `email_verified` reset that would leave the environment with no administrator is refused, naming the configuration as the remedy. An ordinary profile write still costs the guard no reads.
