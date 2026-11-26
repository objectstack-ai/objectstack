---
'@objectstack/service-messaging': patch
---

fix(messaging): the one-time digest conversion rewrites only the rows that held `none` when it started

Clause-②: no
Metadata-protocol: none

The one-time conversion of the old default digest `none` to empty now reads the ids of every row holding `none` first, in pages, then records itself in `sys_migration`, then rewrites exactly those rows. It no longer reads the rows again while it runs. The deployment is already serving during that boot pass, so a `none` someone picks during the pass (a new preference, a member switching to "No digest", a node still on the earlier release in a rolling upgrade) is that person's own choice and is kept. If the conversion cannot record itself in `sys_migration`, it rewrites nothing and runs again on the next start.
