---
"@objectstack/cli": minor
---

feat(cli)!: retire `os create example` — it was a weaker `os init` plus a README, and the refusal now names `os init` (#16483, #15531)

**BREAKING** — a published CLI surface is removed. `os create example <name>` is a
command a user can run today and cannot run after this release. Graded `minor`
rather than `major` under this repo's lockstep launch-window convention (no
package here has ever shipped a `major` changeset); the break is stated here
instead of in the number.

<!-- adr-0087: not-required (no-migration-prescription) the retired surface is a CLI subcommand, not authored metadata: no Zod schema, no `packages/spec` declaration, no authorable key and no stored `sys_metadata` shape changes, so `objectstack migrate meta` has nothing to rewrite and the ledger has no step to carry. The channel that reaches every affected caller is the command itself, which now exits non-zero naming `os init`. -->

**No alias and no deprecation window.** `os create example` will not come back,
so change the command rather than pinning an older CLI. (Those terms are recorded
on card #16483 and are pending maintainer confirmation — the removal itself is
settled by the #15531 batch entry below. The behaviour ships either way, and it is
the same shape `os g agent` already shipped.)

#15531 rendered the real emission of both scaffolder families and hashed it file
by file. The only template-level duplication left between them was this one
template: `os create example` wrote a **subset** of what `os init` writes, plus
one README. The two families' emission policy is already unified through four
shared exports, so the remaining duplicate was the template itself — and the
ruling (decision batch #66, option B) is that it goes, not that the two command
families merge. They emit two different artifacts: a kernel code `Plugin` is not
a declarative app, and collapsing them would make that collision structural.

**What to run instead**

```bash
os init <name>             # a full application project
os init <name> -t empty    # config only, no src/objects
```

`os init` writes the same `tsconfig.json` the retired template did (byte-identical,
measured) and an **equivalent** `objectstack.config.ts` — both manifests are
`ManifestSchema`-valid but they are not the same bytes: the retired template wrote
`name: '<name>'`, `description: '<name> example application'` and commented-out
barrels, where `os init` writes a title-cased `name`, an empty `description` and no
barrels. On top of that `os init` adds `src/objects`, a `.gitignore` and the
dependency install the retired template never had.

**`os create plugin` is unaffected.** It scaffolds the kernel code `Plugin`
contract — `src/index.ts` exporting a `Plugin` with `init` / `destroy`, built by
`tsc`, publishable as `@objectstack/plugin-<name>` — which `os init` does not
emit. `os create`'s flags and its standalone emission policy are unchanged for
`plugin`. ⚠️ `--in-repo` is narrowed rather than untouched: the flag survives, but
its `examples/<name>` placement is removed with the template and gets no
replacement — `--in-repo` now only ever lands in `packages/plugins/plugin-<name>`.

**The removal is a signpost, not a deletion.** `os create example` still answers:
it exits **1** and names `os init`, rather than falling through to the generic
`Unknown type:` roster. A reader arriving from an older tutorial or a CI script
that still calls it learns what replaced it instead of learning only that their
spelling is off the list. Pinned end-to-end by driving the real CLI in
`packages/cli/test/create-example-retired.e2e.test.ts`, which asserts both halves
— the non-zero exit **and** the message naming `os init`. The four public doc
pages are held to the same promise by a SEPARATE pin,
`packages/cli/test/create-example-retired-docs-parity.test.ts`: it spawns nothing,
so unlike the `.e2e` file it runs in the per-PR tier rather than the nightly one.
