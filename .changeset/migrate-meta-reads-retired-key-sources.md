---
"@objectstack/cli": patch
---

fix(cli): `os migrate meta --from N` can finally open the retired-key sources it exists to rewrite (#9418)

The codemod refused its own input class. A retired authorable key is a
`retiredKey()` tombstone — `z.never()` carrying the upgrade prescription — so the
current schema does not strip it, it **rejects** it. And a real
`objectstack.config.ts` runs that schema itself: `os init` scaffolds
`export default defineStack({ … })`, larger projects spread `defineView` /
`defineAgent` / `defineFlow` across per-artifact modules, and every one of those
`define*` helpers is a `Schema.parse()`. The rejection therefore fired while the
config module was being **evaluated**, inside the load, before `os migrate meta`
reached its first conversion — the command exited 1 having rewritten nothing.

The message it printed was the instruction that sent the author there. The
sentence "Run `os migrate meta --from <N>` to rewrite existing sources
automatically." ships **144 times across 39 files** under `packages/spec/src`, so the v17 upgrade path closed
a loop on itself: hit a retired key, get told to run the codemod, watch the
codemod refuse **because of** the retired key.

**The fix is a tolerant load for that one command.** There was no CLI-side
validation step to reorder — the gate lives in the loaded module — so
`loadConfig()` gains an opt-in `authoredSource` mode that replaces each
`@objectstack/spec` entrypoint the config imports (the root **and** the subpaths
the example apps author through, `@objectstack/spec/ui`, `/ai`, `/data`, …) with
a generated shim. The shim re-exports the real module and wraps its `define*`
helpers as try-real-then-authored: the real helper runs first, and only when the
current schema refuses the artifact is it handed on **exactly as authored**, with
the swallowed verdict announced on stderr.

Three properties keep this a restoration rather than a widening of what the
command accepts:

- **A source that loads today loads identically** — the real helper still runs,
  so its defaults and transforms still apply (`defineForm` still moves
  `schemaId` into `data`, `defineStack` still merges actions into objects). Only
  the sources that are refused today take the new path.
- **Validation is moved after the conversion, not skipped.** The command still
  parses the **migrated** stack through `ObjectStackDefinitionSchema` and reports
  `schemaValid`, so a source broken for reasons the chain cannot fix is still
  reported as broken — after the codemod has done the part it can.
- **Every other command still hears the tombstone.** `os build`, `os validate`
  and `os serve` keep the default strict load: the rejection is their upgrade
  channel, and only the codemod is entitled to read past it. Pinned both ways.

`os migrate meta --stored` was probed and is **not** affected: it never reads
`objectstack.config.ts` at all — it boots from the compiled artifact and replays
the chain over `sys_metadata` rows, and it already exits 0 in a project whose
config carries a retired key. The defect was the authored-source arm alone.

The regression proof is shaped like a real project rather than like a test — the
retired keys are authored through `defineStack` **and** through helpers imported
from a spec subpath, which is where a tolerance scoped to `defineStack` alone
would still have refused. The suite that shipped alongside the defect could not
have caught it: its fixture is a bare `export default { … }` object literal, and
a bare literal is validated by nobody at load.
