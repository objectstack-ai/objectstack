---
"@objectstack/service-automation": patch
---

Clause-②: no

fix(service-automation): a resume refused because the run's flow or parked node is gone now settles the run's `sys_automation_run` row

- **What changed.** A resume refused with `RUN_NOT_FOUND` because the run's flow is no longer registered, or because the node it parked on was edited away, now settles the run in the same call. The paused row is consumed and a `failed` history row records the refusal's own text in `error`. Before, the row kept `status: 'paused'` through every later resume, an uninstall and a cold restart. Run lists and paused-run counts kept showing a run the engine already knew could never continue, and retention never aged the row out, because it prunes terminal statuses only.
- **Unchanged:** the answer. It has the same code and the same text, and a transport still answers 404. A second resume answers `RUN_NOT_FOUND` again (`No suspended run`) and writes nothing. Retention is unchanged: `failed` was already in its scope, and paused rows are still never pruned.
- **When nothing is recorded.** Before the host seals the boot, a missing flow may be one that is not registered yet. `AutomationServicePlugin` re-arms overdue wait timers in `start()`, before flows bound at `kernel:ready` arrive. So before the seal the refusal records nothing, as before. The host seals with `sealNodeTypeVocabulary()`, which the plugin calls at `kernel:bootstrapped`. An embedded host that never calls it keeps the previous behaviour.
- **Concurrency.** The settle consumes the row through the same compare-and-set a resume takes. If a concurrent resume or cancel consumed the row first, the call writes nothing. If the store cannot answer the compare-and-set, the resume answers `STORE_UNAVAILABLE` (503), and a retry settles the run.
