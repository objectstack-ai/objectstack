---
"@objectstack/spec": patch
---

Three duration keys now name their unit in the `.describe()` prose that reaches the published output, not only in the key name and the JSDoc above them: `PluginLoadingEvent.durationMs` (`kernel/plugin-loading.zod.ts`), `AppInstallResult.durationMs` (`system/app-install.zod.ts`) and `MigrationPlan.estimatedDurationMs` (`system/deploy-bundle.zod.ts`).

The first carried no `.describe()` at all, so the generated reference row for `durationMs` rendered an empty description cell; the other two said `Installation duration` and `Estimated execution time`, naming a duration with no unit. All three JSDoc blocks already said milliseconds, and all three key names already carry `Ms`. Only the channel an author — very often a model (ADR-0033) — actually reads was missing it.

⛔ Not a rename, and no key moves: the unit is already in the key name, which is what the #14478 rule asks for. This is the describe-only remediation of Ruling A on #15939, and it is the one of the seven remediations that needs no ADR-0087 conversion, no tombstone and no published-key rename.

**The published surface was measured rather than assumed**, because a changeset is owed only if the changed text actually ships. Measured after `pnpm --filter @objectstack/spec build`, over the paths this package's `files[]` actually publishes:

- **The changed text ships.** `Duration in milliseconds` reads 24 occurrences across 12 `dist/` bundle files and 6 across `json-schema/`; the other two read 8 in `dist/` and 2 in `json-schema/` each. The generated reference pages under `content/docs/references/**` render all three rows and are regenerated in this change.
- **Positive control that ships**: the neighbouring describe `Objects created/updated` — `dist` 4, `json-schema` 2.
- **Negative control that does not ship**: `no exemption by blindness`, a sentence that exists only in `packages/spec/scripts/`, a path outside `files[]` — 0 across every published path, 1 in its own unpublished file.
- **Dark control**: a fabricated needle reads 0 everywhere, so a zero above is a reading rather than a broken instrument.

One measured refinement worth recording for the next author, since it cuts against the obvious reading of "published output": **`dist/` alone does not discriminate the two prose channels.** JSDoc text and even a `//` line comment ride into the emitted bundles verbatim (`Objects created or updated`, JSDoc-only, reads 4 in `dist/`). What separates the channels is `json-schema/`, which carries describe prose and 0 comment prose. So `dist` presence is necessary and not sufficient evidence that a string reached the governed channel; the `json-schema/` reading is the one that decides it.
