---
---

chore(devx): `pnpm check:i18n` now FAILS on an undeclared authoring key, not just on bundle drift

Releases nothing — the change is confined to `scripts/check-i18n-bundles.mjs` and
the root `check:i18n` script. No package source, no published behaviour, and
deliberately **not** the `os i18n extract` exit code (that would write an internal
hygiene rule into the public CLI contract).

#4736 cleaned nine `scripts/i18n-extract.config.ts` files that all opened their
`defineStack({ … })` with the same undeclared `name:` key. Nine, because the same
mistake was copied from the first one — and nothing stopped any of them. The
#4167 unknown-authoring-key lint *saw* every single one: it printed
`stack.name: 'name' is not a declared stack key, so its value is dropped at load`
on stderr, once per package, on every run. But the CLI exited 0 and the gate only
judged bundle drift, so those nine warnings appeared inside a **fully green**
`check:i18n` and were read as noise nine times. A warning that nine authors
filtered out is not a control; #4736 cleaned the symptom, this closes the hole.

**What changed.** The gate now reads the extractor's **stderr** — which it
previously let flow straight through to the terminal, seen by nobody and judged by
nothing — and fails on the unknown-authoring-key signature. Coverage needs no
manifest: `findConfigs` walks `packages/`, so the tenth config is gated the day it
lands.

**The two verdicts stay separate.** Bundle drift keeps its own section and its own
remedy (`--write`); the new class gets its own, naming the package, the config
path, the key, and the consequence that matters — *the value is dropped at load,
so whatever it was meant to configure is not in effect and never was*.
Regenerating bundles does not fix it, and the message says so.

**The gate is proven able to go red**, not merely observed green — the failure
mode of `check:react-declaration-parity` (#4690), which exited 0 with nothing to
check. Two proofs: `node scripts/check-i18n-bundles.mjs --self-test` (now wired
into `check:i18n`, ahead of the real run) drives both classifiers over recorded
CLI output, including a case asserting neither verdict matches the other's output;
and the gate was run against the nine configs restored from `ffab8033b^`, the
commit before #4803 deleted the keys, where it reports all nine and exits 1.

Fixing an offending config means deleting the key at the producer. If a key is
genuinely wanted it gets declared in `packages/spec` deliberately — not
accommodated by a consumer-side fallback, and not silenced by making
`ObjectStackDefinitionSchema` strict (which would mute the lint itself; see
`metadata-authoring-lint.ts`).
