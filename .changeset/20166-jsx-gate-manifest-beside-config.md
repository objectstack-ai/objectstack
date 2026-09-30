---
'@objectstack/cli': minor
---

fix(cli)!: `objectstack validate`, `objectstack build` and `objectstack lint` read the project's `sdui.manifest.json` beside the config they were given, not in the directory they were run from (#20166)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata changes shape and nothing an author wrote is renamed or removed, so `objectstack migrate meta` has nothing to rewrite. What moves is which manifest file judges a run whose config path names another directory. -->

**BREAKING for runs given a config path in another directory.**

**What changed.** These commands check the `source` of each `kind: 'html'` page
against an SDUI component manifest: the project's own `sdui.manifest.json` first,
then the copy `@objectstack/console` ships. They located everything else about a
project from the directory of its config, but looked for the project's own
manifest in the directory the command was run from. So
`objectstack validate path/to/app/objectstack.config.ts`, run from anywhere else,
never read `path/to/app/sdui.manifest.json`, and a manifest that happened to sit in
the directory it was run from judged a project it does not belong to. They now read
the manifest beside the config.

## Which manifest each run reads

| the run | the project manifest it read | the project manifest it reads now |
|:--|:--|:--|
| `objectstack validate` / `build` / `lint` with no config path, in the project's directory | `./sdui.manifest.json` | `./sdui.manifest.json` (unchanged) |
| the same commands given `path/to/app/objectstack.config.ts`, run from another directory | that other directory's `sdui.manifest.json` | `path/to/app/sdui.manifest.json` |

When the project carries no manifest of its own, both rows then fall back to the
copy `@objectstack/console` ships, as before.

**Which runs change, and which way.** Only runs whose config path names a directory
other than the one they run in. For those, the verdict can move in both directions:

- A page the project's own manifest does not declare is now refused
  (`jsx-forbidden-tag`, `jsx-unknown-component`, `jsx-unknown-prop`, exit 1), where
  the other directory's manifest, or the console's copy, used to admit it.
- A project manifest that is present but not usable is now refused (exit 1), naming
  that file, where the run used to read some other file.
- A project with no manifest of its own is now checked against the console's copy,
  where the other directory's manifest used to decide.
- In the other direction, a page the other directory's manifest refused, and that
  the project's own manifest (or the console's copy) declares, is now admitted.

If such a run now fails, the manifest that belongs to the project is the one to
keep beside its config.

**What is not affected.** A run in the project's own directory, with or without a
config path, reads the same file as before. `objectstack init`'s check of a freshly
generated scaffold keeps reading the directory it was run from.

**A correction to this release's console-fallback entry.** That entry says these
commands "look first for the `sdui.manifest.json` in the directory the command runs
in". From this release they look first beside the config the command was given,
which is the same directory whenever the command runs in the project.
