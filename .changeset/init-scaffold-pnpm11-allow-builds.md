---
"@objectstack/cli": patch
---

`objectstack init` now writes both build-approval keys into the scaffolded
`pnpm-workspace.yaml`, so a brand-new project's first `pnpm install` succeeds
on pnpm 11 (#10405).

The renderer emitted only `onlyBuiltDependencies`. pnpm 11 does not read that
key at all, and it turned an unapproved dependency build script from a warning
into a hard error — so `objectstack init my-app && cd my-app && pnpm install`
exited 1 with `ERR_PNPM_IGNORED_BUILDS`, on the very first command after
scaffolding. The rendered file now also carries `allowBuilds`, built from the
same source list, which is the only key pnpm 11 reads. Measured one clean
install per pnpm version, each with its own store: pnpm 10.0.0-10.25.0 read
`onlyBuiltDependencies`, 10.26.0-10.34.x read either key, and 11.x reads
`allowBuilds` only — so both keys are load-bearing and neither is redundant.

Build permission is still granted to exactly the two packages that need it and
nothing else: `esbuild` (a `postinstall` that installs its platform binary,
used to compile `objectstack.config.ts`) and `better-sqlite3` (ships a
`binding.gyp`, which pnpm treats as a native build; without it `objectstack
serve` can fail with "Could not locate the bindings file"). No wildcard.

Existing scaffolds are unaffected — `init` never overwrites a
`pnpm-workspace.yaml` that is already there. To fix a project scaffolded by an
earlier CLI, add to its `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
```
