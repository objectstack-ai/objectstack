---
'@object-ui/data-objectstack': patch
---

fix(data-objectstack): a user-preference save waits for the adapter's in-flight load instead of reading its row again

Clause-②: no
Metadata-protocol: none

The user-state adapters (`createObjectStackUserStateAdapter`) load their `sys_user_preference` rows through one shared read and remember each row's id for later writes. A save issued before that read answered (for example the recent-items flush shortly after a page opens) found no remembered id and sent its own `sys_user_preference` read for the same key before writing, one extra request per page open on a slow connection. A save now waits for the adapter's load if one is in flight, then updates the row that load returned. When no load is in flight, or the load failed or found no row, a save behaves as before: it reads its own row, then updates it or creates it, and recovers from a lost create race by reading again and updating. Saves still run one at a time. The key-family adapter (`createObjectStackUserPreferenceFamily`) had the same gap and gets the same wait.
