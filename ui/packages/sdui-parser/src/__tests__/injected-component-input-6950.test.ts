/**
 * The runtime half of the objectui#6950 pin: the input the framework injects
 * still SERIALISES `binding: 'object'` into the manifest, `validateTree` still
 * RECORDS the binding site, and the serializer's boundary refuses the retired
 * `'field'` arm. The type-level half — `InjectedComponentInput`, the authoring
 * face's refusal, and the cast-free splice — is
 * `packages/types/src/__tests__/injected-component-input-6950.test.ts`; it
 * lives there because `@object-ui/types` may import neither this package nor
 * `@object-ui/core`, while this package lists core as a devDependency
 * (`render.test.tsx` already registers through it).
 *
 * ## Why the positive limbs are the half that matters
 *
 * "A registration that authors `binding` fails type-check" is satisfied by
 * deleting the marker. What makes the ruling a shape and not a deletion is
 * that the FRAMEWORK's write keeps working end to end: `Registry.register`
 * splices `ELEMENT_DATA_SOURCE_INPUT` for a renderer marked by
 * `elementDataSourceBlock()`, `manifestFromConfigs` forwards its `binding`,
 * and `validateTree` turns the prop into a binding site the server resolves.
 * The chain is driven through the real registry here — not a hand-built
 * config — so a splice that stopped carrying the marker would be seen where
 * it happens, not inferred from a fixture that never went through it.
 *
 * ## `'field'` (ADR-0049 enforce-or-remove)
 *
 * `RegistryConfigLike.inputs[].binding` was `'object' | 'field'`; every
 * `binding:` literal in `packages/`, `apps/` and `examples/` is `'object'`
 * (7 of 7 at the retiring merge-base) and nothing resolves a field binding.
 * The arm is retired at the boundary a registry config feeds the serializer
 * through. objectui#8315 then retired it on the two faces `types.ts` carries —
 * `ManifestInput.binding` and `ManifestValidationResult.bindings[].kind` —
 * after measuring that the second of those is a PRODUCER face, where the
 * subset relation that licenses a permissive reader does not apply, and that
 * the two are coupled by `validateTree`'s `kind: input.binding` assignment.
 * The pins for those two faces are at the foot of this file. The
 * `@ts-expect-error` directives are real enforcement — this package
 * type-checks its tests through `tsconfig.test.json`.
 */

import { describe, expect, it } from 'vitest';
import {
  ELEMENT_DATA_SOURCE_INPUT,
  ELEMENT_DATA_SOURCE_KEY,
  Registry,
  elementDataSourceBlock,
  type ComponentMeta,
} from '@object-ui/core';
import {
  manifestFromConfigs,
  validateTree,
  type Manifest,
  type ManifestInput,
  type ManifestValidationResult,
  type RegistryConfigLike,
} from '../index.js';

const NS = 'pin6950';
const TYPE = `${NS}:probe`;

/** A registry holding ONE gate-wrapping block, registered the way a plugin does it. */
function registryWithProbe(): Registry {
  const registry = new Registry();
  const Probe = elementDataSourceBlock(() => null);
  registry.register('probe', Probe, {
    namespace: NS,
    tier: 'public',
    skipFallback: true,
    inputs: [{ name: 'object', type: 'string', required: true }],
  });
  return registry;
}

describe("the injected input still serialises `binding: 'object'` into the manifest (objectui#6950)", () => {
  it('reaches the manifest through the real registry, and survives JSON', () => {
    const manifest = manifestFromConfigs(registryWithProbe().getAllConfigs());
    const entry = manifest.components[TYPE];
    expect(entry).toBeDefined();

    const injected = entry.inputs.find((i) => i.name === ELEMENT_DATA_SOURCE_KEY);
    expect(injected).toMatchObject({ name: ELEMENT_DATA_SOURCE_KEY, type: 'object', binding: 'object' });

    // The artifact is JSON on disk — the marker must be a serialisable value,
    // not a type-only fact.
    const roundTripped = JSON.parse(JSON.stringify(manifest)) as typeof manifest;
    expect(
      roundTripped.components[TYPE].inputs.find((i) => i.name === ELEMENT_DATA_SOURCE_KEY)?.binding,
    ).toBe('object');
  });

  it('the marker comes from the injection, not from the authored input beside it', () => {
    const manifest = manifestFromConfigs(registryWithProbe().getAllConfigs());
    const authored = manifest.components[TYPE].inputs.find((i) => i.name === 'object');
    expect(authored).toBeDefined();
    expect(authored?.binding).toBeUndefined();
    // and the constant the splice copies is what carries it
    expect(ELEMENT_DATA_SOURCE_INPUT.binding).toBe('object');
  });
});

describe('`validateTree` still records the injected input as a binding site (objectui#6950)', () => {
  it('reports the `dataSource` prop as an object binding, with no `unknown-prop` beside it', () => {
    const manifest = manifestFromConfigs(registryWithProbe().getAllConfigs());
    const value = { object: 'account', view: 'all_accounts' };
    const result = validateTree(
      { type: TYPE, object: 'account', [ELEMENT_DATA_SOURCE_KEY]: value },
      manifest,
    );

    expect(result.bindings).toContainEqual({
      tag: TYPE,
      input: ELEMENT_DATA_SOURCE_KEY,
      kind: 'object',
      value,
    });
    // objectui#6678's defect was exactly this diagnostic on the one key that works.
    expect(result.diagnostics.filter((d) => d.code === 'unknown-prop')).toEqual([]);
    expect(result.requires).toEqual([NS]);
  });
});

describe("the serializer's boundary accepts 'object' and refuses the retired 'field' arm (ADR-0049, objectui#6950)", () => {
  it("forwards 'object' unchanged", () => {
    const config: RegistryConfigLike = {
      type: 'object-table',
      namespace: 'plugin-grid',
      inputs: [{ name: 'object', type: 'string', required: true, binding: 'object' }],
    };
    expect(manifestFromConfigs([config]).components['object-table'].inputs[0].binding).toBe('object');
  });

  it("is a type error on 'field'", () => {
    const config: RegistryConfigLike = {
      type: 'object-table',
      inputs: [
        {
          name: 'field',
          type: 'string',
          // @ts-expect-error `'field'` had zero writers and is retired (ADR-0049, objectui#6950)
          binding: 'field',
        },
      ],
    };
    expect(config.inputs).toHaveLength(1);
  });
});

describe('a registration that authors `binding` itself fails type-check at the registration door (objectui#6950)', () => {
  it("is an excess-property error on `register()`'s `meta.inputs`", () => {
    const registry = new Registry();
    const meta: ComponentMeta = {
      namespace: NS,
      skipFallback: true,
      inputs: [
        {
          name: 'object',
          type: 'string',
          // @ts-expect-error `binding` is not a `ComponentInput` member — the framework injects it (objectui#6950)
          binding: 'object',
        },
      ],
    };
    registry.register('authored', () => null, meta);
    expect(registry.getAllConfigs()).toHaveLength(1);
  });
});

/* ── the manifest READER/PRODUCER faces, retired in objectui#8315 ──────── */

describe("the manifest faces spell the vocabulary 'object' too (objectui#8315)", () => {
  /**
   * Each refusal below is paired with a well-formed control that still passes,
   * so "it refused" cannot be satisfied by a face that refuses everything.
   */

  it("`ManifestInput.binding` accepts 'object' — the control", () => {
    const input: ManifestInput = { name: 'object', type: 'string', binding: 'object' };
    expect(input.binding).toBe('object');
  });

  it("`ManifestInput.binding` refuses the retired 'field' arm", () => {
    const input: ManifestInput = {
      name: 'object',
      type: 'string',
      // @ts-expect-error `'field'` is retired on the manifest face too (objectui#8315)
      binding: 'field',
    };
    expect(input.name).toBe('object');
  });

  it("`bindings[].kind` accepts 'object' — the control", () => {
    const site: ManifestValidationResult['bindings'][number] = {
      tag: 'object-table',
      input: 'object',
      kind: 'object',
      value: 'account',
    };
    expect(site.kind).toBe('object');
  });

  it("`bindings[].kind` refuses 'field' — it is a PRODUCER face, so width obliges consumers", () => {
    const site: ManifestValidationResult['bindings'][number] = {
      tag: 'object-table',
      input: 'field',
      // @ts-expect-error `validateTree` writes this key and cannot emit 'field' (objectui#8315)
      kind: 'field',
      value: 'revenue',
    };
    expect(site.tag).toBe('object-table');
  });

  it('the two faces are coupled: `validateTree` copies `binding` into `kind`', () => {
    // The coupling is why neither could be narrowed alone without a cast at
    // the conversion site. Driven through the real function, not asserted of
    // the source text.
    const manifest: Manifest = {
      components: {
        'object-table': {
          type: 'object-table',
          namespace: NS,
          inputs: [{ name: 'object', type: 'string', binding: 'object' }],
        },
      },
    };
    const result = validateTree({ type: 'object-table', object: 'account' }, manifest);
    expect(result.bindings).toEqual([
      { tag: 'object-table', input: 'object', kind: 'object', value: 'account' },
    ]);
  });

  it('the narrowing is COMPILE-TIME only — a manifest parsed from JSON still forwards what it says', () => {
    // Stated as a pin so a later reader does not mistake the retirement for a
    // runtime rejection. `validateTree` reads `input.binding` truthily and
    // copies it; this package has no runtime validator for the manifest
    // itself, so a hand-rolled JSON manifest carrying the retired arm still
    // produces a binding site nothing downstream resolves. Closing THAT would
    // be a new diagnostic, not a type change — deliberately not in
    // objectui#8315's scope.
    const rogue = JSON.parse(
      '{"components":{"t":{"type":"t","inputs":[{"name":"f","type":"string","binding":"field"}]}}}',
    ) as Manifest;
    const result = validateTree({ type: 't', f: 'revenue' }, rogue);
    expect(result.bindings).toEqual([{ tag: 't', input: 'f', kind: 'field', value: 'revenue' }]);
  });
});
