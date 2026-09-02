// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The MEASUREMENT behind `detect-free-identifiers.ts`'s two-set split (#14301).
 *
 * ## Why this pin exists rather than a comment saying the lists were checked
 *
 * The defect it closes was a list written from memory. `GLOBALS` allowlisted
 * `Intl` beside `JSON` under the comment "Web-ish that the sandbox / Node
 * commonly provide" — true of Node, false of the sandbox — so a handler calling
 * `Intl.DateTimeFormat` had no free identifier, lowered into `body.source`, and
 * threw `ReferenceError` in production while `validate`, `typecheck`, `test`
 * and `build` were all green (the in-process test runs the RAW function in
 * Node, where `Intl` exists). A second hand-written list would fail the same
 * way, silently, the first time the sandbox's globals moved.
 *
 * So membership is not asserted from knowledge here — it is READ OUT of the
 * shipped QuickJS build and the two sets are required to equal what it says.
 * A name added to either set from memory reddens this file.
 *
 * ## What "the same sandbox the runtime uses" means concretely
 *
 * `QuickJSScriptRunner` is the `ScriptRunner` `AppPlugin` wires for hook and
 * action bodies, and `runScript` here takes the identical path a lowered body
 * takes: a fresh `newQuickJSWASMModule()` per invocation, the same
 * `(async (ctx) => { … })(ctx)` wrapper, the same empty capability set a body
 * with no inferred capabilities is evaluated under. Anything the runner
 * installs into the VM therefore counts as provided, and anything it does not
 * counts as absent — which is the question the allowlist is answering.
 *
 * ⚠️ `@objectstack/runtime` resolves through its `exports` to **dist** from this
 * package (it is one of the registered entries in
 * `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']`), so
 * `pnpm --filter '@objectstack/cli^...' build` is a precondition for running
 * this file. That does not weaken the reading: what is being measured is the
 * global object of the `quickjs-emscripten` WASM build resolved from
 * `node_modules`, which is the same artifact whether the thin runner wrapper
 * around it came from `src` or `dist`.
 *
 * ## Why the probe asks two questions per name
 *
 * `typeof X !== 'undefined'` alone would report the one global whose VALUE is
 * `undefined` — `undefined` itself — as absent, and quietly demand it be listed
 * as host-only. `'X' in globalThis` answers existence instead of value, so the
 * two limbs together say "does this name resolve", which is the question a free
 * identifier actually poses. Names that are not globals at all (`arguments`,
 * an implicit binding that the arrow-function wrapper does not provide) answer
 * `false` on both limbs — correctly: a lowered body naming one throws.
 */

import { describe, it, expect } from 'vitest';
import { QuickJSScriptRunner } from '@objectstack/runtime';
import type { ScriptContext } from '@objectstack/runtime';
import { SANDBOX_GLOBALS, NODE_ONLY_GLOBALS } from './detect-free-identifiers.js';

const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/**
 * Anti-vacuity controls. Without them a probe that answered `true` for
 * everything (or crashed into an empty object) would still satisfy the
 * partition assertions whenever one side happened to be empty.
 */
const CONTROL_PRESENT = 'Math';
const CONTROL_ABSENT = '__objectstack_probe_control_absent__';

function probeSource(names: readonly string[]): string {
  const entry = (n: string): string =>
    `${JSON.stringify(n)}: ((typeof ${n} !== 'undefined') || ` +
    `(typeof globalThis !== 'undefined' && ${JSON.stringify(n)} in globalThis))`;
  return `return { ${names.map(entry).join(', ')} };`;
}

/** Evaluate the `typeof`/`in globalThis` probe INSIDE the real hook sandbox. */
async function probe(names: readonly string[]): Promise<Record<string, boolean>> {
  // A generous CPU budget: the probe itself is trivial, but every invocation
  // instantiates a fresh WASM module and a loaded box can blow the stock 250ms
  // hook budget on that fixed cost alone.
  const runner = new QuickJSScriptRunner({ hookTimeoutMs: 20_000 });
  const result = await runner.runScript(
    { language: 'js', source: probeSource(names), capabilities: [] },
    { input: {} } as ScriptContext,
    { origin: { kind: 'hook', name: 'sandbox-globals-probe' } },
  );
  return result.value as Record<string, boolean>;
}

describe('sandbox global probe (#14301 — the allowlist is measured, not recalled)', () => {
  it('answers both ways — the control pair', async () => {
    const readings = await probe([CONTROL_PRESENT, CONTROL_ABSENT]);
    expect(readings[CONTROL_PRESENT]).toBe(true);
    expect(readings[CONTROL_ABSENT]).toBe(false);
  }, 60_000);

  it('the two sets are exactly the sandbox present/absent partition', async () => {
    const names = sorted([...SANDBOX_GLOBALS, ...NODE_ONLY_GLOBALS]);
    // Disjoint and non-empty, asserted before the partition so a set-union
    // mistake reads as itself rather than as a measurement disagreement.
    expect(names.length).toBe(SANDBOX_GLOBALS.size + NODE_ONLY_GLOBALS.size);
    expect(SANDBOX_GLOBALS.size).toBeGreaterThan(0);
    expect(NODE_ONLY_GLOBALS.size).toBeGreaterThan(0);

    const readings = await probe(names);
    // Every probed name came back with a boolean — a missing key would
    // otherwise be silently counted as "absent".
    expect(Object.keys(readings).sort()).toEqual(names);

    const measuredPresent = names.filter((n) => readings[n] === true);
    const measuredAbsent = names.filter((n) => readings[n] === false);

    expect(measuredPresent).toEqual(sorted(SANDBOX_GLOBALS));
    expect(measuredAbsent).toEqual(sorted(NODE_ONLY_GLOBALS));
  }, 60_000);

  it("the card's named case and its positive control", () => {
    // Implied by the partition above; spelled out because these two names are
    // what the report was about, and a reader should not have to re-derive
    // them from a measurement to see the verdict.
    expect(NODE_ONLY_GLOBALS.has('Intl')).toBe(true);
    expect(SANDBOX_GLOBALS.has('JSON')).toBe(true);
  });
});
