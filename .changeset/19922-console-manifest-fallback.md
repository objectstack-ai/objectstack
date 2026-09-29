---
'@objectstack/cli': minor
---

fix(cli)!: a project with no `sdui.manifest.json` of its own has its `kind: 'html'` pages checked against the manifest `@objectstack/console` ships, so `div` and every other undeclared tag or prop is refused (#19922)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (already-registered ui-html-page-div-refused) The semantic ledger entry for this narrowing landed on main before this change, in its own pull request, so this diff adds none. `objectstack migrate meta --from 17` lists it among the manual changes, with `box` as the replacement for `div`. -->

**BREAKING for `kind: 'html'` pages in projects without their own manifest.**

**What changed.** `objectstack validate`, `objectstack compile` / `build` and
`objectstack lint` check the `source` of a `kind: 'html'` page against an SDUI
component manifest. (`dev` and `start` run `compile` before they boot when
`dist/objectstack.json` is missing or `--compile` is passed, and `dev`'s default
watch mode reruns it when a watched file changes.) They look first for the
`sdui.manifest.json` in the directory the command runs in, then for the copy
`@objectstack/console` ships as `dist/sdui.manifest.json`. The second lookup asked for that file by a subpath
the console package does not export, so it always failed, and a project with no
manifest of its own had its html pages checked at parse level only: syntax and
structure, never which components and props they use. The lookup now reaches the
shipped copy, and those pages get full component and prop validation. A tag or
prop the manifest does not declare is refused (`jsx-forbidden-tag`,
`jsx-unknown-component`, `jsx-unknown-prop`), naming the page and the tag, and
the command exits 1.

**What was refused before, and what is new.** The console has refused a `div` on
a `kind: 'html'` page since `@objectstack/console` 17.5.0: when the page renders,
its in-browser html compile answers `forbidden-tag`, naming `box`. These commands
now give that answer while you author. What they refuse that nothing refused
before is every other tag the manifest does not declare. The console's html
compile accepts every component its registry knows that is not deprecated there,
while the published manifest declares only the public component contract and the
html tier's intrinsic tags. So a page using, for example, `avatar` or `checkbox`
renders in the console and is refused here.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `<div>` … `</div>` in a `kind: 'html'` page | `<box>` … `</box>`, which takes the same `className` and children |
| any other tag or prop the command names | a component and prop the manifest declares |

**What is not affected.** A project that keeps its own `sdui.manifest.json` is
checked against that file, as before. `kind: 'react'` pages and pages authored
as regions are not read by this gate. With no manifest reachable at all, the
pages are still checked at parse level, and the notice that says so is
unchanged.

**A damaged install is refused, not skipped.** A shipped copy that is present
but cannot be read or parsed stops the command with exit 1, naming the file,
with the remedy: reinstall `@objectstack/console`.

**A correction to the 17.5.0 note on this manifest.** The `@objectstack/console`
17.5.0 patch entry `28ce612`, the one that says the prebuilt Console dist now
ships `dist/sdui.manifest.json`, ends with a paragraph that this release changes,
sentence by sentence:

- "For now the file is only present in the tarball." No longer true: the CLI
  reads it, as described above.
- "This package's `exports` map exposes `./package.json` and nothing else, so
  resolving `@objectstack/console/dist/sdui.manifest.json` through `exports`
  fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`." Still true: the `exports` map is
  unchanged.
- "Anything that resolves through `exports` cannot read the file yet." Still
  true. To read the file, resolve `@objectstack/console/package.json` and join
  `dist/sdui.manifest.json` to its directory.
- "That includes the CLI's JSX-page manifest fallback, which catches the error
  and keeps parse-level validation, as before." True of the 17.5.0 CLI, false
  from this release: the fallback now reads the file that way, so a project
  without its own manifest is checked against the shipped copy.
