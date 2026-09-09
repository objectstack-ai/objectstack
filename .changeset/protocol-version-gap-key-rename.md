---
"@objectstack/cli": minor
---

<!-- adr-0087: not-required (no-migration-prescription) the renamed member is a CLI `--json` OUTPUT key emitted from an inline object literal — no Zod schema, no `packages/spec` declaration, no stored representation, so `objectstack migrate meta` has nothing to reach. The affected party is a script reading stdout (ADR-0087 D8). -->

feat(cli)!: the `--json` payload key `specVersionGap` is renamed to `protocolVersionGap` (#14261)

**BREAKING** — a published machine surface changes a key name. `os validate --json` and
`os build --json` emit **`protocolVersionGap`** where they emitted `specVersionGap`. A
consumer reading `specVersionGap` reads `undefined` after this release and must switch to
the new name. There is **no alias and no dual-key transition window**: one axis, one name.

The value shape is unchanged — `null` when the app's declared compatibility range admits
the installed `@objectstack/spec`, otherwise the same advisory record with the same
members. Nothing else on either payload moves: no other key is added, removed or
reshaped, and the text faces of both commands are byte-identical.

## Why the name had to move

The axis this advisory reports moved in **#13860**: it used to read the undeclared
`manifest.specVersion` and now reads `manifest.engines.protocol`, which is declared
(`PluginEnginesSchema`), stamped by every scaffold, and enforced at boot. The published
key name stayed behind for one release, deliberately — renaming a machine face with
pinned consumers is a break, and no ruling covered it at the time.

Leaving it is a correctness problem, not untidiness. A key spelled `specVersion*` invites
the reader — an AI agent above all — to infer that a writable `manifest.specVersion`
exists. `ManifestSchema` is not `.strict()` and **silently drops unknown keys** (#14192),
so acting on that inference does not produce an error: it produces a manifest that looks
entirely normal and whose `specVersion` line never took effect. That is the same
ghost-key breadcrumb mechanism that caused #13860 in the first place, left standing on
the output side.

## What a consumer should do

```diff
- if (payload.specVersionGap) { … }
+ if (payload.protocolVersionGap) { … }
```

The breaking surface was measured before the rename and is closed inside this repository:
the only consumers of the old key were three in-repo e2e suites, which move in this same
change; **zero external consumers were found**. Graded `minor` by the maintainer's
explicit grading of 2026-09-02; the banner above carries the breaking-ness the level
cannot.
