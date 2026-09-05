---
"@objectstack/driver-memory": minor
---

feat(driver-memory)!: the file-persistence auto-save interval names its unit (#15680, ruling B on #14478)

**BREAKING** — `InMemoryDriverOptions.persistence.autoSaveInterval` and
`FileSystemPersistenceAdapter`'s `autoSaveInterval` constructor option are both
renamed to **`autoSaveIntervalMs`**, following the `@objectstack/spec` rename of
the authored keys on both persistence arms.

Same value, same milliseconds, same 2000 default, same `setInterval` cadence. The
option was always milliseconds — it is passed straight to `setInterval` — and the
spec's `min(100)` bound is what made the bare name dangerous rather than untidy:
100 reads as a plausible number of seconds, so an author who guessed the unit
wrong cleared the bound, was refused nowhere, and saved a thousand times more
often than intended.

Both persistence arms move together: `type: 'auto'` resolves to this same file
adapter and forwards the same field, so this package reads exactly one spelling
rather than two.

```diff
- new InMemoryDriver({ persistence: { type: 'file', autoSaveInterval: 5000 } })
+ new InMemoryDriver({ persistence: { type: 'file', autoSaveIntervalMs: 5000 } })
```
