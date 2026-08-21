---
"@objectstack/cli": patch
---

Remove the abandoned tsup build path from `packages/cli` (#10185): the
`tsup.config.ts`, the orphaned `src/bin.ts` it was the only referrer of, and
the now-unused `tsup` devDependency.

The package has built with `tsc -p tsconfig.build.json` since the oclif
migration, which also introduced `oclif.commands.target: "./dist/commands"`
and moved the `bin` field onto `bin/run.js`. The tsup config was left behind
by that commit and never invoked again — but it was not inert. It declared
`clean: true` with only `src/bin.ts` and `src/index.ts` as entries, so anyone
running the obvious `tsup` next to a `tsup.config.ts` would wipe `dist/` and
emit no `dist/commands/**` at all, leaving a CLI that resolves zero commands.
Deleting it removes the trap rather than documenting it.

No published behaviour changes: the resolved oclif command surface is
identical before and after (60 commands, 68 topics). The only build-output
difference is that `dist/bin.js` — a re-export of `execute` from
`@oclif/core` that nothing imported — is no longer emitted.
