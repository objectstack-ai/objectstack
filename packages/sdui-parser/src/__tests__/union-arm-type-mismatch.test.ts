/**
 * Union-arm coarse type checking — the objectui#3832 ruling, ported into this
 * copy in lockstep (objectstack#12814, measured on objectstack#12810).
 *
 * `ManifestInput.type` carries ONE coarse kind, or an ARRAY of kinds when the
 * key's contract is a union. Before this port, this copy's `checkType` was the
 * older single-arm `switch (input.type)`: a union-typed input fell through
 * `default: return null` and drew NO diagnostic at all — the exact
 * "reports nothing, which looks like it validated cleanly" failure the
 * `input-type.ts` header names. objectui's copy has checked every arm since
 * objectui#3832 landed there, so the same authored page produced diagnostics
 * on one surface and silence on the other — the dialect split the #12719
 * invariant forbids (both copies agree on the accepted grammar AND on
 * diagnostic codes).
 *
 * WHY THESE PINS EXIST HERE. Two copies of this parser exist — objectui's
 * `packages/sdui-parser` and this hoisted one. These pins are the objectstack
 * half of the lockstep for the coarse type check; the ported functions are
 * byte-equal to objectui's. The properties pinned below are objectui#3832's
 * deliberate ones:
 *
 *  - ANY declared arm accepting the value clears the prop;
 *  - when NO arm accepts, a multi-arm input draws ONE `type-mismatch` naming
 *    every arm, at the STRICTEST arm's severity — `error` when an `enum` arm
 *    is present, `warning` otherwise;
 *  - a single-arm input produces the byte-identical diagnostic it always did,
 *    `invalid-enum` included — the port adds a form, it does not restate the
 *    old one.
 */
import { describe, expect, it } from 'vitest';
import { compile, generateDts, manifestFromConfigs } from '../index.js';
import { validateTree } from '../validate.js';
import type { Manifest } from '../types.js';

// A manifest with union-typed inputs, written directly (not through
// `manifestFromConfigs`) because production manifests arrive as JSON —
// `sdui.manifest.json` is serialized on the objectui side, where unions
// already exist. The adapter's own union handling is pinned separately below.
const manifest: Manifest = {
  components: {
    'stat-card': {
      type: 'stat-card',
      namespace: 'ui',
      inputs: [
        // a real union: string | number (e.g. a formatted or raw metric)
        { name: 'value', type: ['string', 'number'] },
        // enum arm + object arm: a named preset or an inline definition
        {
          name: 'variant',
          type: ['enum', 'object'],
          enum: ['compact', { value: 'detailed', label: 'Detailed' }],
        },
        // a slot arm in a union accepts anything (a slot names a child
        // position, not a value)
        { name: 'footer', type: ['slot', 'string'] },
        // single arms, unchanged by the port
        { name: 'label', type: 'string' },
        { name: 'align', type: 'enum', enum: ['left', 'right'] },
      ],
    },
  },
};

describe('union-arm type-mismatch: any arm accepting clears the prop', () => {
  it('a value accepted by the FIRST arm draws nothing', () => {
    const r = compile(`<stat-card value="42" />`, manifest);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('a value accepted only by the SECOND arm draws nothing — the union widens, it does not pick one arm', () => {
    const r = compile(`<stat-card value={42} />`, manifest);
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('an enum arm clears its listed values; the object arm clears an inline object', () => {
    expect(compile(`<stat-card variant="compact" />`, manifest).diagnostics).toEqual([]);
    expect(compile(`<stat-card variant="detailed" />`, manifest).diagnostics).toEqual([]);
    expect(
      compile(`<stat-card variant={{"density":"high"}} />`, manifest).diagnostics,
    ).toEqual([]);
  });

  it('a slot arm accepts everything — those inputs never drew a diagnostic and must not start now', () => {
    expect(compile(`<stat-card footer={42} />`, manifest).diagnostics).toEqual([]);
  });
});

describe('union-arm type-mismatch: no arm accepting draws ONE diagnostic naming every arm', () => {
  // Before this port, BOTH cases below compiled with zero diagnostics: the
  // union fell through the single-arm switch's `default: return null`. That
  // silence is the drift this file closes — do not restore it.
  it('non-enum union → ONE warning-severity `type-mismatch` naming both arms', () => {
    const r = compile(`<stat-card value={true} />`, manifest);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'type-mismatch',
        message: '<stat-card> prop "value" expected a string or a number',
        tag: 'stat-card',
      },
    ]);
    // warning does not move the save gate's pass/fail
    expect(r.ok).toBe(true);
  });

  it('enum arm present → the ONE diagnostic is ERROR severity, code `type-mismatch` (not `invalid-enum`), and carries the allowed values', () => {
    const r = compile(`<stat-card variant="ultra" />`, manifest);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'type-mismatch',
        message: '<stat-card> prop "variant" expected one of ["compact","detailed"] or an object',
        tag: 'stat-card',
      },
    ]);
    // the strictest arm's severity gates the save
    expect(r.ok).toBe(false);
  });
});

describe('single-arm inputs are byte-identical to the pre-port diagnostics', () => {
  it('single string arm → the same warning `type-mismatch` as always', () => {
    const r = compile(`<stat-card label={42} />`, manifest);
    expect(r.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'type-mismatch',
        message: '<stat-card> prop "label" expected a string',
        tag: 'stat-card',
      },
    ]);
  });

  it('single enum arm → still `invalid-enum` at error severity, same message shape', () => {
    const r = compile(`<stat-card align="center" />`, manifest);
    expect(r.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'invalid-enum',
        message: '<stat-card> prop "align"="center" is not one of ["left","right"]',
        tag: 'stat-card',
      },
    ]);
  });

  it('an off-vocabulary arm accepts everything (the old `default: return null`, preserved)', () => {
    const loose: Manifest = {
      components: {
        x: {
          type: 'x',
          inputs: [{ name: 'p', type: 'mystery' as never }],
        },
      },
    };
    expect(validateTree({ type: 'x', p: 42 }, loose).diagnostics).toEqual([]);
  });
});

describe('manifestFromConfigs canonicalizes union declarations (input-type.ts)', () => {
  const built = manifestFromConfigs([
    {
      type: 'w',
      inputs: [
        { name: 'union', type: ['string', 'number'] },
        { name: 'oneArm', type: ['number'] },
        { name: 'dropped', type: ['number', 'mystery'] },
        { name: 'emptied', type: ['mystery'] },
        { name: 'coerced', type: 'mystery' },
        { name: 'deduped', type: ['string', 'string', 'number'] },
      ],
    },
  ]);
  const types = Object.fromEntries(built.components.w.inputs.map((i) => [i.name, i.type]));

  it('a real union survives as an array', () => {
    expect(types.union).toEqual(['string', 'number']);
  });

  it('a one-element array collapses to the bare string — already-published entries serialize byte-identically', () => {
    expect(types.oneArm).toBe('number');
  });

  it('an unrecognized arm INSIDE an array is dropped, not coerced — no invented widening', () => {
    expect(types.dropped).toBe('number');
  });

  it('dropping every arm falls back to the single-arm coercion', () => {
    expect(types.emptied).toBe('string');
  });

  it('a single unrecognized kind still coerces to string (pre-union behaviour, kept exactly)', () => {
    expect(types.coerced).toBe('string');
  });

  it('duplicate arms are deduplicated', () => {
    expect(types.deduped).toEqual(['string', 'number']);
  });
});

describe('generateDts emits a TS union for a union declaration', () => {
  it('the .d.ts accepts exactly the arms the manifest gate accepts', () => {
    const dts = generateDts(manifest);
    expect(dts).toContain('value?: string | number;');
  });

  it('arms collapsing to the same TS type are de-duplicated', () => {
    const m: Manifest = {
      components: {
        y: { type: 'y', inputs: [{ name: 'tone', type: ['string', 'color'] }] },
      },
    };
    expect(generateDts(m)).toContain('tone?: string;');
  });

  it('a slot+value union is typed from its non-slot arms (the old `!== slot` test would have passed the array through)', () => {
    const dts = generateDts(manifest);
    expect(dts).toContain('footer?: string;');
  });
});
