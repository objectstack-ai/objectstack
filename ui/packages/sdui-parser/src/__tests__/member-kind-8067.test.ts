/**
 * ObjectUI — `ManifestInput.of`, the coarse MEMBER kind (objectui#8067)
 *
 * The mechanism half of the card. The contract half — every declared `of` in
 * the repository compared against what `ComponentPropsMap[type]` accepts at the
 * member position — lives in
 * `apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`.
 *
 * WHY THE KEY EXISTS. `type: 'array'` said a value was a list and stopped
 * there, so a member that drifted from the contract was invisible to every
 * layer that reads a declaration. `page:header.actions` is the measured cost:
 * spec `z.array(z.string())` ("Action IDs"), a renderer reading the members as
 * `ActionDef` OBJECTS, and the repo-wide parity gate green for the whole life of
 * the drift because both sides had the key and neither could say what was
 * inside it.
 *
 * WHAT IS PINNED HERE, and they are different facts:
 *
 *  1. THE READER EXISTS — a member no declared arm accepts is REPORTED. This is
 *     the fact objectui#5905 is the cautionary precedent for: five
 *     `ComponentInput` keys were declared and read by nothing, and every gate
 *     stayed green. A `of` that nothing reads is that defect with a new name.
 *  2. BACKWARD COMPATIBILITY — an input that declares no `of` is validated,
 *     serialized and typed byte-identically to before the key existed. That is
 *     what makes this an extension of `sdui.manifest.json` rather than a new
 *     version of it.
 *  3. THE COARSE CEILING HOLDS ONE LEVEL DOWN — `of` names a KIND, never a
 *     domain and never a member's KEYS, so `of: 'object'` clears every object
 *     whatever it contains. The maintainer ruling of 2026-08-17 quoted on
 *     `ComponentInput.type` ("SPEC IS THE SOLE JUDGE OF VALUES") is untouched.
 *  4. THE OTHER CONSUMERS — the serializer canonicalizes `of` exactly as it
 *     canonicalizes `type`, and the JSX codegen narrows the emitted element
 *     type from it. A member kind the validator honours but the `.d.ts`
 *     contradicts would just move an author's false error one layer over.
 */
import { describe, expect, it } from 'vitest';
import { generateDts, manifestFromConfigs, validateTree } from '../index.js';
import type { Manifest, SchemaElement } from '../types.js';

const one = (inputs: Parameters<typeof manifestFromConfigs>[0][number]['inputs']): Manifest =>
  manifestFromConfigs([{ type: 'probe', namespace: 'ui', inputs }]);

const diags = (manifest: Manifest, node: Record<string, unknown>) =>
  validateTree({ type: 'probe', ...node } as SchemaElement, manifest).diagnostics;

const codes = (manifest: Manifest, node: Record<string, unknown>): string[] =>
  diags(manifest, node).map((d) => d.code);

describe('a declared member kind is READ — the objectui#5905 standard', () => {
  const manifest = one([{ name: 'actions', type: 'array', of: 'string' }]);

  it('clears an array whose members are all of the declared kind', () => {
    expect(codes(manifest, { actions: ['clone', 'convert'] })).toEqual([]);
  });

  it('reports a member of the wrong kind — the drift this key exists to catch', () => {
    // Verbatim the `page:header.actions` drift: spec says action IDs, the value
    // carries `ActionDef` objects. Before `of` this node was clean.
    expect(codes(manifest, { actions: [{ name: 'clone' }] })).toEqual(['member-type-mismatch']);
  });

  it('names every offending position in ONE diagnostic, not one per member', () => {
    const [diagnostic] = diags(manifest, { actions: ['clone', 42, {}, 'convert'] });
    expect(diagnostic.code).toBe('member-type-mismatch');
    expect(diagnostic.severity).toBe('warning');
    expect(diagnostic.message).toBe(
      '<probe> prop "actions" expected every member to be a string — [1], [2] are not',
    );
  });

  it('an empty container conforms — there is no member to refuse', () => {
    expect(codes(manifest, { actions: [] })).toEqual([]);
  });

  it('reads the ARRAY form of `of` the same way it reads the array form of `type`', () => {
    // The rot this pins: a reader that forgot `Array.isArray` would fall through
    // and report NOTHING, which looks exactly like a clean value.
    const union = one([{ name: 'items', type: 'array', of: ['string', 'object'] }]);
    expect(codes(union, { items: ['a', { b: 1 }] })).toEqual([]);
    expect(codes(union, { items: [42] })).toEqual(['member-type-mismatch']);
  });

  it('judges an OBJECT container by its VALUES — the map half of the key', () => {
    const map = one([{ name: 'labels', type: 'object', of: 'string' }]);
    expect(codes(map, { labels: { en: 'Account', 'zh-CN': '客户' } })).toEqual([]);
    const [diagnostic] = diags(map, { labels: { en: 'Account', count: 3 } });
    expect(diagnostic.message).toBe(
      '<probe> prop "labels" expected every member to be a string — [count] is not',
    );
  });
});

describe('the container verdict comes first', () => {
  const manifest = one([{ name: 'actions', type: 'array', of: 'string' }]);

  it('a wrong CONTAINER draws one diagnostic, not two', () => {
    // One mistake, one report. A member walk over a value that is not even the
    // declared container would name positions of a shape the author never wrote.
    expect(codes(manifest, { actions: 'clone' })).toEqual(['type-mismatch']);
  });

  it('a value that satisfied a NON-container arm of a union is not member-judged', () => {
    const union = one([{ name: 'actions', type: ['string', 'array'], of: 'string' }]);
    expect(codes(union, { actions: 'clone' })).toEqual([]);
    expect(codes(union, { actions: [42] })).toEqual(['member-type-mismatch']);
  });
});

describe('the coarse ceiling holds one level down', () => {
  it('`of: \'object\'` clears every object, whatever keys it carries', () => {
    // `of` is a KIND, never a member's KEYS. Which keys an element must have is
    // spec's question and a per-block pin's, exactly as the value DOMAIN of a
    // `number` arm is (`ComponentInput.type`, maintainer ruling 2026-08-17).
    const manifest = one([{ name: 'sections', type: 'array', of: 'object' }]);
    expect(codes(manifest, { sections: [{ anything: 'at all' }, {}] })).toEqual([]);
    expect(codes(manifest, { sections: ['sales_info'] })).toEqual(['member-type-mismatch']);
  });

  it('an `enum` member arm raises its severity to error, as it does one level up', () => {
    const manifest = one([
      { name: 'types', type: 'array', of: 'enum', enum: ['comment', 'task'] },
    ]);
    expect(codes(manifest, { types: ['comment', 'task'] })).toEqual([]);
    const [diagnostic] = diags(manifest, { types: ['comment', 'email'] });
    expect(diagnostic.code).toBe('member-type-mismatch');
    expect(diagnostic.severity).toBe('error');
  });
});

describe('an input that declares no member kind is unchanged', () => {
  // The backward-compatibility half. Every input published before this key
  // existed says exactly this, so anything that moves here moves for all of
  // them.
  const manifest = one([{ name: 'actions', type: 'array' }]);

  it('draws no member diagnostic on any member', () => {
    expect(codes(manifest, { actions: [42, {}, 'clone', null] })).toEqual([]);
  });

  it('publishes no `of` at all — the serialized entry is byte-identical', () => {
    expect(JSON.stringify(manifest.components.probe.inputs[0])).toBe(
      '{"name":"actions","type":"array"}',
    );
  });

  it('emits the unnarrowed element type', () => {
    expect(generateDts(manifest)).toContain('actions?: unknown[];');
  });
});

describe('the serializer canonicalizes `of` exactly as it canonicalizes `type`', () => {
  it('collapses a one-element array to the bare kind', () => {
    expect(one([{ name: 'a', type: 'array', of: ['string'] }]).components.probe.inputs[0].of).toBe(
      'string',
    );
  });

  it('drops an off-vocabulary arm rather than inventing `string` for it', () => {
    expect(
      one([{ name: 'a', type: 'array', of: ['string', 'nonsense'] }]).components.probe.inputs[0].of,
    ).toBe('string');
  });

  it('dedupes a repeated arm', () => {
    expect(
      one([{ name: 'a', type: 'array', of: ['string', 'object', 'string'] }]).components.probe
        .inputs[0].of,
    ).toEqual(['string', 'object']);
  });

  it('does NOT invent a member kind for an undeclared `of`', () => {
    // `canonicalizeInputType`'s no-arms fallback is `'string'`, so routing an
    // undefined through it would make every array in every manifest claim
    // string members it was never told it had.
    expect(one([{ name: 'a', type: 'array' }]).components.probe.inputs[0].of).toBeUndefined();
  });
});

describe('the JSX authoring surface narrows with it', () => {
  it('types the elements rather than emitting `unknown[]`', () => {
    const dts = generateDts(one([{ name: 'actions', type: 'array', of: 'string' }]));
    expect(dts).toContain('actions?: string[];');
    expect(dts).not.toContain('actions?: unknown[];');
  });

  it('types an object map\'s values', () => {
    expect(generateDts(one([{ name: 'labels', type: 'object', of: 'string' }]))).toContain(
      'labels?: Record<string, string>;',
    );
  });

  it('emits a parenthesised union for a multi-arm member declaration', () => {
    expect(generateDts(one([{ name: 'items', type: 'array', of: ['string', 'object'] }]))).toContain(
      'items?: (string | Record<string, unknown>)[];',
    );
  });

  it('a `slot`-only member declaration types no member — never a silent `string`', () => {
    expect(generateDts(one([{ name: 'items', type: 'array', of: 'slot' }]))).toContain(
      'items?: unknown[];',
    );
  });
});
