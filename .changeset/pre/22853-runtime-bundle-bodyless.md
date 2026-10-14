---
"@objectstack/cli": minor
---

fix(cli)!: `objectstack build` writes the runtime module whenever a callable still needs it, and its warning counts each refused handler once (#22853)

Clause-②: no (narrowing)

`objectstack build` decided whether to write `objectstack-runtime.*.mjs` from the number of callables minus the number of slots lowered into a metadata body. The first counts each callable once and the second counts each slot, so a callable lowered at two slots cancelled a `functions` entry beside it. The build then printed `Skipping legacy runtime bundle (all 2 callables are body-only)`, exited 0 and wrote `dist/objectstack.json` alone, and the `functions` entry shipped with no implementation. Three shapes reached it:

- the same hook at the top level and inside a `packages[i].manifest` body, beside a `functions` entry;
- one handler shared by two hooks, beside a `functions` entry;
- one function bound both as a hook handler and as a `functions` entry.

The module is now decided from the list `--strict-body` counts: one row per callable the runtime module has to carry, each callable once. A slot that has no body, which is a `functions` entry or a hook or action whose extraction was refused, keeps its callable on that list even when another slot lowered the same function. The default build's warning (`N handlers could not be lowered to a metadata body`) and its summary line now count the refused handlers on that list, each once.

**BREAKING: what moves for consumers.**

- **`objectstack build`.** It now writes the runtime module for the three shapes above, and for a function bound at a refused slot and at a slot that lowered it. Every stack it wrote the module for before still gets one.
- **`objectstack build --no-runtime-bundle`.** Those stacks are now refused (exit 1). They passed at exit 0 while the `functions` entry, or the refused hook, had no implementation. The message's first number counts the callables that lack a body, and its second counts the refused handlers, each once.
- **`objectstack build --strict-body`.** A stack that binds one function at a slot that lowered it AND as a `functions` entry or at a refused slot is now refused, and the row names the `functions` entry or the refused slot. It passed before. For a function bound at several slots, the row in `--json` `issues` is the extractor's refusal when any slot refused it, then the `functions` entry's row, then the authored-`body` row. Before, it was the first such slot's row.
- **The default build's warning count.** A refused handler shared by two hooks, or carried at the top level and in a package body, counts as one handler. It counted once per slot.

**The one-line fix**, for a CI step that runs `--no-runtime-bundle` on a stack carrying a `functions` entry: drop the flag. A `functions` entry has no metadata body, so it runs only from the runtime module.

**Unchanged.** For a stack in which each callable is bound at one slot and walked once, the module decision, `--no-runtime-bundle` and `--strict-body` give the same verdicts as before. Exit codes and `error` strings are the same. `--json` `bodyExtractionWarnings` still carries one record per refused slot. No spec key, export, type or stored shape moves.

<!-- adr-0087: not-required (no-migration-prescription) a CLI build verdict: the runtime module is now written for stacks whose `functions` entry needed it, and `--no-runtime-bundle` / `--strict-body` refuse those stacks where a miscount let them pass. No authorable key, spelling, export or stored shape moves, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to derive. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this verdict (not already-registered); and it is a build verdict, not a runtime TS interface or a type surface (not runtime-interface-only or type-surface-only). -->
