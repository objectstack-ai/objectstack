---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): Setup pages for position holders and permission set assignment

Clause-②: no
Metadata-protocol: none

An administrator can now manage who holds a position, and who holds a permission set, without opening the position's or the set's own page:

- **Position holders** (`security:position-holders`): pick a position from the environment's catalog, then list, add and remove its holders.
- **Permission set assignment** (`security:permission-set-assignment`): pick a permission set, then list its users (direct grants and holders through a position), and assign or unassign direct grants.

Each page renders the same section the item page renders, so who may add or remove, and every refusal the server answers (the delegated-administration gate's included), are unchanged and shown in the server's own words. The picked item rides the page's URL (`?position=` / `?set=`), so a shared or refreshed link opens it again. A failed read of the catalog says so and offers a retry instead of showing an empty list. The sections inside the position and permission set pages keep working as before.

The pages are registered as component refs and open at `/apps/setup/component/security/position-holders` and `/apps/setup/component/security/permission-set-assignment`. No Setup navigation entry names them yet: those entries are contributed by the server's security plugin and follow separately. New copy is translated in all ten console languages.
