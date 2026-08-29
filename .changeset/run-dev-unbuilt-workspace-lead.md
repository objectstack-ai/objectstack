---
"@objectstack/cli": patch
---

fix(cli): name the missing build output instead of reporting "command not found" (#12964)

In a checkout where a workspace dependency has no `dist/`, `@oclif/core` `import()`s
every command module while it builds its manifest, every one of them fails, and the run
ends on

```
Error: command i18n:extract:… not found
```

with exit 2 — while the command file is right there in `src/commands/`. A command whose
module will not load is indistinguishable, to `Config.runCommand`, from one that does not
exist, so the only cause the reader is handed is the one cause that is definitely not
true.

`packages/cli/bin/run-dev.js` — this repo's SOURCE entry point, run through `tsx` by its
own gates and e2e suites, and not part of the published package — now collects oclif's
module-load warnings and, when that failure was caused by a package this repo builds,
prints the attribution and the single command that fixes it ahead of oclif's report:

```
objectstack: NOT A MISSING COMMAND — @oclif/core reports a command module that failed to
LOAD as "not found", and one did: Cannot find module '…/@objectstack/spec/dist/index.mjs'.
The unmet precondition is @objectstack/spec's build output, not the invocation.
objectstack: Fix: pnpm exec turbo run build --filter=@objectstack/spec
```

Both the classification and the remedy come from `scripts/cli-build-prerequisite.mjs`, the
module that already answers this question for the gates that shell out to the CLI, so
there is no second verdict to keep in sync. Nothing is added to a run that succeeds, and a
command that really is missing keeps oclif's reporting exactly as it was — the diagnosis
requires BOTH oclif's "not found" and a module-load failure naming a workspace package.
