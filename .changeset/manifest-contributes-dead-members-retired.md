---
"@objectstack/spec": minor
---

feat(spec): retire the nine dead members of the plugin-manifest `contributes` block — `events` / `menus` / `themes` / `translations` / `actions` / `drivers` / `fieldTypes` / `functions` / `commands` (#10724, ADR-0049 enforce-or-remove)

<!-- adr-0087: registered plugin-manifest-contributes-dead-members-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The census behind it (#10627, controlled and re-verified at claim time across
objectstack, objectui and cloud) measured that the ENTIRE monorepo contains
exactly one non-test read of `manifest.contributes`, and it reads `kinds`
(`packages/objectql/src/engine.ts` → `registry.registerKind`). The other nine
members parsed, entered the manifest, and changed nothing — while published
material kept teaching them: `commands` documented Commander.js runtime
resolution the CLI dropped for oclif auto-discovery, `fieldTypes` advertised a
registration seam that has never existed, and `events` was decorative even for
its only in-repo author, which already subscribes imperatively.

**What is refused:** authoring any of the nine keys. Each is a `retiredKey()`
tombstone (the `manifest.loading` precedent — neither `ManifestSchema` nor the
`contributes` object is `.strict()`, so a plain deletion would have silently
stripped the keys), so authoring one is a `tsc` error and a parse error
carrying the per-key prescription.

**FROM → TO, per member** (each tombstone carries its own one-line fix):

- `contributes.events` → subscribe in plugin code (`ctx.hook('kernel:ready', …)`
  from `init`/`start`); delete the key.
- `contributes.menus` → app `navigation` / `manifest.navigationContributions`
  (ADR-0029 D7); delete the key.
- `contributes.themes` → the stack-level `themes` metadata collection (an
  unrelated `ThemeSchema` surface); delete the key.
- `contributes.translations` → the `translation` metadata type:
  `defineTranslationBundle` in `defineStack({ translations })`; delete the key.
- `contributes.actions` → the stack `actions` collection or
  `engine.registerAction`; delete the key.
- `contributes.drivers` → register a kernel service named `driver.*`; delete
  the key.
- `contributes.fieldTypes` → nothing (no registration seam exists; the
  vocabulary is the spec `FieldType` enum); delete the key.
- `contributes.functions` → `defineStack({ functions })`; delete the key.
- `contributes.commands` → oclif native plugin auto-discovery (an `oclif`
  section in the plugin's own `package.json`; see `cli-extension.zod.ts`);
  delete the key.

**What stays:** `contributes.kinds` (the block's one live member) and
`contributes.routes` (an open enforce-or-remove fork, #10726 — deliberately
untouched here). Runtime behaviour is unchanged: nothing ever read the nine
members, so removing them removes no behaviour; a stored manifest still
carrying one degrades to a single `[metadata_spec_invalid]` log line at
registration rather than a boot failure.

D3 semantic entry `plugin-manifest-contributes-dead-members-retired`; no D2
conversion, because a package manifest is not a stack collection member
(`PLURAL_TO_SINGULAR` has no `packages`/`plugins` entry) and a conversion
would be a transform with no seam that ever runs.
