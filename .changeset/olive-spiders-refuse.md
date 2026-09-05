---
"@objectstack/cli": minor
---

**BREAKING** `os create <type> <name>` now refuses a project name that npm refuses, and refuses it before it writes anything.

`os create plugin "My App"` used to exit 0 having written `./plugin-My App/`, carrying a manifest that read `name: "@objectstack/plugin-My App"`. Nothing failed at scaffold time, so the invalid name surfaced later at `npm publish`, in the terminal of whoever ran it next. `os init` has always refused that same input before touching the disk. The rule set is now shared between the two scaffolders rather than restated in one of them, so they answer the same way.

`os create` also refuses a name whose composed scoped package name exceeds npm's 214-character ceiling. `@objectstack/plugin-` spends 20 of those characters before the name begins, so a name that `os init` accepts can still compose to one npm rejects; that check sits next to the composition rather than in the shared rule set.

A scripted invocation that passed an invalid name now exits 1 with the reason on stderr, where it previously exited 0 and produced a project that could not be published.

<!-- adr-0087: not-required (no-migration-prescription) The change narrows what a CLI argument accepts at invocation time. No metadata surface, stored row or spec declaration is touched, so `objectstack migrate meta` has nothing to carry and the ledger has nothing to record. -->
