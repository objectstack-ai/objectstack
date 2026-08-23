---
"@objectstack/service-settings": patch
---

`loadRows` user-keyed engine loads now include tenant/global rows (`$or` over `user_id`/upper scopes), mirroring the in-memory branch. Fixes the user→tenant→global read cascade dying at the user level and upper-scope locks never firing on user-scope writes, on engine-bound deployments (#11228).
