import { describe, expect, it } from 'vitest';
import { Environment } from '@marcbachmann/cel-js';

import { CEL_ENV_OPTIONS, buildEnv } from './cel-engine';
import { registerStdLib } from './stdlib';
import { CEL_STDLIB_FUNCTIONS } from './validate';

/**
 * Drift pin for `CEL_STDLIB_FUNCTIONS` (#13831).
 *
 * The two pins that already exist check an entry against something OTHER than
 * the environment: `cel-engine.test.ts` evaluates each entry, and
 * `skill-catalog-sync.test.ts` looks each up in the authoring skill. Neither
 * could see the census that motivated this file — the catalog advertised 35
 * names while the real `Environment` resolved 72 — because neither ever asks
 * the environment what it registered.
 *
 * This one does, through `buildEnv` (the same constructor `celEngine.evaluate`
 * uses) and cel-js's `Environment.getDefinitions()`. It asserts the catalog is
 * a *deliberate* subset rather than a stale one, in all three directions the
 * census found drift in:
 *
 *   A. every advertised name is registered AND bare-callable   (nothing stale)
 *   B. every bare-callable name WE register is advertised      (nothing missed)
 *   C. the withheld bare-callables are exactly a declared list (nothing silent)
 *
 * ## Why "bare-callable", and why the catalog can NEVER be "all 72"
 *
 * A catalog entry is spent as a bare call: objectui's Studio predicate editor
 * inserts a suggestion as `name(` verbatim, and the runtime guard in
 * `cel-engine.test.ts` probes each entry with a bare-call expression. cel-js
 * registers a large receiver-method set (`s.split(',')`, `list.map(...)`) whose
 * names are NOT bare-callable, so flattening them into the catalog would
 * autocomplete `split(` into an author's predicate and fault. Test D pins that
 * the receiver-only set is real and disjoint, so the claim stays measured
 * rather than remembered.
 */

/** The instant the pinned environment is built at — any fixed instant will do. */
const FIXED_NOW = () => new Date('2026-01-01T00:00:00Z');

interface CelFunctionDefinition {
  name: string;
  receiverType: string | null;
}

function definitionsOf(env: Environment): CelFunctionDefinition[] {
  return (env as unknown as { getDefinitions(): { functions: CelFunctionDefinition[] } })
    .getDefinitions().functions;
}

/** Names callable as `fn(x)` — a definition with no receiver type. */
function bareCallableNames(env: Environment): Set<string> {
  return new Set(definitionsOf(env).filter((f) => !f.receiverType).map((f) => f.name));
}

/** Every registered function name, bare-callable or receiver-only. */
function allRegisteredNames(env: Environment): Set<string> {
  return new Set(definitionsOf(env).map((f) => f.name));
}

const sorted = (names: Iterable<string>) => [...names].sort();

/**
 * cel-js built-ins that ARE bare-callable and are deliberately NOT advertised.
 *
 * All four resolve today — this is an authoring decision, not an availability
 * fact. They are CEL's remaining type primitives, and the catalog already
 * carries the six an author has a reason to reach for (`int`, `string`, `bool`,
 * `double`, `timestamp`, `duration`).
 *
 * ⚠️ A cel-js upgrade that adds a bare-callable built-in turns test C red. That
 * is the point: the new name gets advertised or gets an entry here, and either
 * way a human decides. Never widen this list to make a red test green.
 */
const WITHHELD_BARE_CALLABLE_BUILTINS = [
  'bytes', // byte-string conversion; no authorable field type produces or consumes it
  'dyn',   // type-erasure escape hatch; widens what an author can emit unusably
  'type',  // reflection (`type(x) == string`); no authoring surface asks for it
  'uint',  // unsigned ints are not an ObjectStack field type
] as const;

describe('CEL_STDLIB_FUNCTIONS ↔ the real Environment (#13831)', () => {
  const env = buildEnv(FIXED_NOW, 'UTC');
  const advertised = new Set(CEL_STDLIB_FUNCTIONS);

  it('A. advertises no name the environment does not register, or cannot call bare', () => {
    const registered = allRegisteredNames(env);
    const bare = bareCallableNames(env);

    expect(
      CEL_STDLIB_FUNCTIONS.filter((fn) => !registered.has(fn)),
      'advertised to authors but NOT registered in the evaluation environment — ' +
        'these fault at runtime',
    ).toEqual([]);

    expect(
      CEL_STDLIB_FUNCTIONS.filter((fn) => !bare.has(fn)),
      'advertised as a bare-callable function but registered ONLY as a receiver ' +
        'method — consumers insert/probe these as `name(`, which faults. Remove ' +
        'it, or teach the catalog to carry a call form.',
    ).toEqual([]);
  });

  it('B. advertises every bare-callable function `registerStdLib` adds', () => {
    // Diff the SAME environment shape before and after our registrations, so
    // "ours" is measured rather than transcribed from the registration sites.
    const withoutStdLib = bareCallableNames(new Environment(CEL_ENV_OPTIONS));
    const withStdLib = bareCallableNames(
      registerStdLib(new Environment(CEL_ENV_OPTIONS), FIXED_NOW, 'UTC'),
    );
    const ours = sorted([...withStdLib].filter((fn) => !withoutStdLib.has(fn)));

    expect(ours.length, 'registerStdLib added no bare-callable function — the ' +
      'measurement seam is broken, not the catalog').toBeGreaterThan(0);

    expect(
      ours.filter((fn) => !advertised.has(fn)),
      'registered by registerStdLib but NOT advertised — an author (and every AI ' +
        'author) is never told these exist. Add them to CEL_STDLIB_FUNCTIONS and ' +
        'to skills/objectstack-formula/SKILL.md.',
    ).toEqual([]);
  });

  it('C. withholds exactly the declared bare-callable built-ins — nothing silently', () => {
    const withheld = sorted([...bareCallableNames(env)].filter((fn) => !advertised.has(fn)));

    expect(
      withheld,
      'the set of bare-callable functions the environment resolves but the catalog ' +
        'does not advertise has changed. A NEW name here (likely a cel-js upgrade) ' +
        'is a decision to take: advertise it, or add it to ' +
        'WITHHELD_BARE_CALLABLE_BUILTINS with the reason. Do not widen that list to ' +
        'silence this.',
    ).toEqual([...WITHHELD_BARE_CALLABLE_BUILTINS]);
  });

  it('D. keeps receiver-only names out — the catalog can never be "all registered"', () => {
    const bare = bareCallableNames(env);
    const receiverOnly = sorted([...allRegisteredNames(env)].filter((fn) => !bare.has(fn)));

    // The hazard is live, not theoretical: cel-js really does register names
    // that are unreachable in bare-call position.
    expect(
      receiverOnly.length,
      'no receiver-only functions found — cel-js changed shape, so re-derive ' +
        'whether the bare-callable membership rule still means anything',
    ).toBeGreaterThan(0);

    expect(
      CEL_STDLIB_FUNCTIONS.filter((fn) => receiverOnly.includes(fn)),
      'receiver-only names leaked into the catalog',
    ).toEqual([]);
  });
});
