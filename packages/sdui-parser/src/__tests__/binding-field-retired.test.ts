import { describe, expect, it } from 'vitest';

import { compile, manifestFromConfigs, type RegistryConfigLike } from '../index.js';
import type { Manifest, ManifestInput, ValidationResult } from '../types.js';

/**
 * The `binding: 'field'` arm is retired on all THREE faces this package
 * declares it on, and this file is the pin that keeps it retired.
 *
 * objectui retired the same arm from its copy of this package — the
 * maintainer ruling of 2026-09-07 on objectui#6950 (director decision batch
 * #69) on the serializer's input boundary, objectui#8315 on the two faces in
 * `types.ts` — citing enforce-or-remove on a zero-writer measurement. Nothing
 * carried that across to this copy. The narrowing here is that port.
 *
 * ## Why the pins are `@ts-expect-error` and not runtime assertions
 *
 * The retirement is COMPILE-TIME ONLY, deliberately and unavoidably: types are
 * erased, this package runs no validator over a `Manifest` it is handed, and
 * `validateTree` forwards whatever the manifest says. The last test below
 * states that limit on purpose, so a later reader does not mistake the
 * narrowing for a runtime rejection and go looking for the refusal path that
 * would have to exist for it.
 *
 * ## Why this pin goes red in BOTH directions
 *
 * A `@ts-expect-error` that stops being needed is itself a `tsc` error
 * (`ts(2578)`, "Unused '@ts-expect-error' directive"). So widening any of the
 * three declarations back to `'object' | 'field'` fails `pnpm --filter
 * @objectstack/sdui-parser typecheck` on the very line that documents the
 * retirement, rather than leaving a green suite behind. The live
 * `binding: 'object'` control beside each pin is what proves the declaration
 * was not simply deleted: a pin whose positive control does not compile is
 * asserting nothing.
 */
describe("binding: 'field' is retired on every face (objectui#6950, objectui#8315)", () => {
  it('face 1 — RegistryConfigLike, the serializer input boundary, takes only `object`', () => {
    const live: RegistryConfigLike = {
      type: 'object-table',
      inputs: [{ name: 'object', type: 'string', binding: 'object' }],
    };

    const retired: RegistryConfigLike = {
      type: 'object-table',
      // @ts-expect-error — the retired 'field' arm (objectui#6950).
      inputs: [{ name: 'object', type: 'string', binding: 'field' }],
    };

    // The control still serializes, so the key itself is alive, not deleted.
    expect(manifestFromConfigs([live]).components['object-table'].inputs[0].binding).toBe('object');
    expect(retired.type).toBe('object-table');
  });

  it('face 2 — ManifestInput, the manifest reader/producer face, takes only `object`', () => {
    const live: ManifestInput = { name: 'object', type: 'string', binding: 'object' };
    // @ts-expect-error — the retired 'field' arm (objectui#8315).
    const retired: ManifestInput = { name: 'object', type: 'string', binding: 'field' };

    expect(live.binding).toBe('object');
    expect(retired.name).toBe('object');
  });

  it('face 3 — ValidationResult.bindings[].kind, the producer face, emits only `object`', () => {
    const live: ValidationResult['bindings'] = [
      { tag: 'object-table', input: 'object', kind: 'object', value: 'account' },
    ];
    const retired: ValidationResult['bindings'] = [
      // @ts-expect-error — the retired 'field' arm (objectui#8315).
      { tag: 'object-table', input: 'object', kind: 'field', value: 'name' },
    ];

    expect(live[0].kind).toBe('object');
    expect(retired[0].tag).toBe('object-table');
  });

  it('the narrowing is compile-time only — a cast-in `field` manifest still round-trips', () => {
    // Unrepresentable in the type, so it takes a cast to build at all. That IS
    // the limit being pinned: nothing in this package refuses the value at
    // runtime, and a consumer handing us one gets it back verbatim.
    const smuggled = {
      components: {
        'object-table': {
          type: 'object-table',
          namespace: 'plugin-grid',
          isContainer: false,
          inputs: [{ name: 'object', type: 'string', required: true, binding: 'field' }],
        },
      },
    } as unknown as Manifest;

    const r = compile('<object-table object="account" />', smuggled);

    expect(r.ok).toBe(true);
    expect(r.bindings).toEqual([
      { tag: 'object-table', input: 'object', kind: 'field', value: 'account' },
    ]);
  });
});
