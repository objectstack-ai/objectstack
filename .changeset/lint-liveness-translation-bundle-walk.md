---
"@objectstack/lint": patch
---

**Fix:** `lintLivenessProperties` walks `stack.translations` as the locale-keyed bundle it is, so the `translation` liveness ledger finally reaches the author (#11288).

`stack.translations` is `z.array(TranslationBundleSchema)` — each item is a `TranslationBundle`, i.e. `z.record(LocaleSchema, TranslationDataSchema)`, whose top-level keys are locale codes. The lint registered `{ type: 'translation', key: 'translations' }` in `TYPE_COLLECTIONS` and then walked those items flat, the way every other collection there is walked: `checkItem` read `bundle['flows']` for the ledger's one `authorWarn` row. A bundle has no `flows` key at any depth reachable that way — the groups live one level down, under each locale — so every warned lookup missed and the whole `translation` ledger was silent for file-authored bundles, the only way apps author translations today.

That is the failure mode the comment above `TYPE_COLLECTIONS` names ("a newly governed type needs its collection registered or its ledger warns nobody"), reached from the other side: the collection *was* registered, and the shape underneath it was the mismatch. Registering a collection is only half the contract — the walk has to match the collection's shape — so the row is now a tombstone comment saying exactly that, and `translation` joins `object`/`field` as a bespoke walk: for each bundle, each locale entry's `TranslationData` is checked, with the finding subject naming the bundle index and the locale (`translation bundle #0 · locale 'zh-CN'`).

Measured on a real app before the fix, as a guarded ablation: injecting a `flows:` section into a locale bundle and re-running `objectstack lint --json` produced **zero** delta — 91 issues before and after, 0 liveness findings naming `flows`. The author who reached for a `planned` translation group got silence, which is strictly worse than the ledger being absent, because the ledger's stated contract is that `authorWarn` is what tells them.

Advisory-only as before: the finding is a warning, and `os lint` exits on errors, never on warnings.

The regression test is pinned on the **bundle** shape, and a `TranslationItem`-shaped anti-fixture is pinned alongside it. That shape — `locale` plus the groups at the top level — is the runtime metadata door, and it *warned on the broken walk*, so a fixture written that way would have been green from the day the bug shipped and pinned nothing. Runtime-authored `translation` items are reached by this lint through no door at all: no stack collection carries them, and the rule is `surfaces: CLI_ONLY`, so it does not run at the runtime publish gate either. The two doors share the group vocabulary, not the container; only the file-authored one is lintable, and now it is linted.
