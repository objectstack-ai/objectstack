---
'@objectstack/service-settings': patch
---

fix(service-settings): a `map` setting refuses every key when its key source answers an empty list

Clause-②: no (narrowing)
Metadata-protocol: none

A `map` specifier's keys are judged against the key's option source (`registerOptionSource`), the list the running system answers, such as the lifecycle-declared objects for `lifecycle.quotas` and `lifecycle.retention_overrides`. When that source answered an empty list, the key check was skipped and any key was saved and put in force from `OS_*`. It now refuses each key with `invalid_option` at the save door and logs the override as not in force at the env door, as for any key the list does not hold. This narrows what is accepted: on a host with no lifecycle-declared object, a non-empty value for those keys, saved or set in `OS_LIFECYCLE_*`, was accepted before and is refused now; no such key could name an object the sweep reads. An empty map still saves. A key whose source could not answer, or which has no source, is still judged against its declared options and admits any key when it declares none.
