---
'@objectstack/cli': minor
---

fix(cli)!: a project with no `sdui.manifest.json` of its own has its `kind: 'html'` pages checked against the manifest `@objectstack/console` ships, so `div` and every other undeclared tag or prop is refused (#19922)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. The CLI's JSX page gate now reads the component manifest the console package already ships, so an html page's source is judged against a vocabulary it was never judged against. `objectstack migrate meta` does not rewrite page source, and the refusal names the page and the tag; for `div` the repair is `box`. -->

**BREAKING for `kind: 'html'` pages in projects without their own manifest.**

**What changed.** `objectstack validate`, `objectstack compile` / `build` (which
`dev` and `start` run first) and `objectstack lint` check the `source` of a
`kind: 'html'` page against an SDUI component manifest: the `sdui.manifest.json`
in the directory the command runs in, then the copy `@objectstack/console` ships
as `dist/sdui.manifest.json`. The second lookup asked for that file by a subpath
the console package does not export, so it always failed, and a project with no
manifest of its own had its html pages checked at parse level only: syntax and
structure, never which components and props they use. The lookup now reaches the
shipped copy, and those pages get full component and prop validation. A tag or
prop the manifest does not declare is refused (`jsx-forbidden-tag`,
`jsx-unknown-component`, `jsx-unknown-prop`), naming the page and the tag, and
the command exits 1. Nothing refused these before: the parse-level check does
not know the component set, and the html-tier renderer still renders `div`,
deprecated there in favour of `box`.

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
