// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23210 · ADR-0055 §1] The stack door judges a `controlled_by_parent`
 * object's master rule on its MERGED field set — the object as the registry
 * runs it, with every `objectExtensions` entry of the same stack folded in
 * (`applyControlledByParentExtensionGate`, `stack.zod.ts`).
 *
 * Before it, an extension adding a second required `master_detail` to a
 * controlled object parsed clean, and the runtime then derived no master and
 * failed closed, while the same merged object declared directly was refused.
 * Each refusal below is pinned with the issue's `code`, path and message at the
 * parse, and with the `STACK_SCHEMA_INVALID` / 422 envelope through
 * `defineStack`; each accepted shape is pinned beside a twin that differs in
 * the one variable under test and IS refused, so a silent pass cannot come from
 * a refinement that never ran.
 */
import { describe, it, expect } from 'vitest';
import { defineStack, ObjectStackDefinitionSchema } from './stack.zod';

type Issue = { code?: string; path?: PropertyKey[]; message?: string };
type Envelope = Error & { code?: string; status?: number; issues?: Issue[] };

const MANIFEST = { id: 'com.acme.cbpx', name: 'cbpx', namespace: 'cbpx', version: '1.0.0', type: 'app' as const };

const HEADER = { type: 'master_detail', reference: 'cbpx_header', required: true };
const OTHER = { type: 'master_detail', reference: 'cbpx_other', required: true };

const line = (fields: Record<string, unknown>, sharingModel = 'controlled_by_parent') => ({
  name: 'cbpx_line',
  sharingModel,
  fields,
});

const OBJECTS = (lineFields: Record<string, unknown> = { header: HEADER }, sharingModel?: string) => [
  { name: 'cbpx_header', sharingModel: 'private', fields: { title: { type: 'text' } } },
  { name: 'cbpx_other', sharingModel: 'private', fields: { title: { type: 'text' } } },
  line(lineFields, sharingModel),
];

/** The card's stack: one declared master, a second one added by an extension. */
const CARD_STACK = {
  manifest: MANIFEST,
  objects: OBJECTS(),
  objectExtensions: [{ extend: 'cbpx_line', fields: { other: OTHER } }],
};

/** The controlled-by-parent issues the parse raises, as `[path, message]`. */
function cbpIssues(config: unknown): Array<[string, string]> {
  const result = ObjectStackDefinitionSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message))
    .map((i) => [i.path.join('.'), i.message]);
}

function refusal(config: unknown): Envelope | null {
  try {
    defineStack(config as never);
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

describe('[#23210] defineStack judges a controlled_by_parent object on its merged field set', () => {
  it('the card\'s stack: refused at the extension\'s `fields`, in the words of the declared control', () => {
    const issues = cbpIssues(CARD_STACK);
    expect(issues.map(([path]) => path)).toEqual(['objectExtensions.0.fields']);

    // The control — the same merged object declared directly — is refused with
    // the same message, at its own path.
    const control = cbpIssues({ manifest: MANIFEST, objects: OBJECTS({ header: HEADER, other: OTHER }) });
    expect(control.map(([path]) => path)).toEqual(['objects.2.fields']);
    expect(issues[0][1]).toBe(control[0][1]);
    expect(issues[0][1]).toContain(
      "Object 'cbpx_line' declares sharingModel 'controlled_by_parent' with 2 required `master_detail` fields (`header`, `other`)",
    );

    const result = ObjectStackDefinitionSchema.safeParse(CARD_STACK);
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues.find((i) => i.path.join('.') === 'objectExtensions.0.fields');
    expect(issue).toMatchObject({ code: 'custom' });
  });

  it('through defineStack: STACK_SCHEMA_INVALID / 422, carrying the located issue', () => {
    const error = refusal(CARD_STACK);
    expect(error, 'the stack must be refused').not.toBeNull();
    expect(error).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
    expect(error!.issues!.find((i) => i.path?.join('.') === 'objectExtensions.0.fields')).toMatchObject({ code: 'custom' });
  });

  it('the single-object control is unchanged: one issue, at the object, none at an extension', () => {
    expect(cbpIssues({ manifest: MANIFEST, objects: OBJECTS({ header: HEADER, other: OTHER }) }).map(([p]) => p)).toEqual([
      'objects.2.fields',
    ]);
    // …and its declared base, alone, parses whole.
    expect(ObjectStackDefinitionSchema.safeParse({ manifest: MANIFEST, objects: OBJECTS() }).success).toBe(true);
  });

  it('an extension adding a non-master field passes; its master-adding twin is refused', () => {
    const withField = (field: unknown) => ({
      manifest: MANIFEST,
      objects: OBJECTS(),
      objectExtensions: [{ extend: 'cbpx_line', fields: { other: field } }],
    });
    expect(ObjectStackDefinitionSchema.safeParse(withField({ type: 'text' })).success).toBe(true);
    expect(ObjectStackDefinitionSchema.safeParse(withField({ type: 'lookup', reference: 'cbpx_other', required: true })).success).toBe(true);
    expect(() => defineStack(withField({ type: 'text' }) as never)).not.toThrow();
    expect(cbpIssues(withField(OTHER)).map(([p]) => p)).toEqual(['objectExtensions.0.fields']);
  });

  it('an extension that demotes the one master is refused, in the words of the declared control', () => {
    for (const demoted of [
      { type: 'master_detail', reference: 'cbpx_header', required: false },
      { type: 'text' },
      { type: 'lookup', reference: 'cbpx_header', required: true },
    ]) {
      const stack = { manifest: MANIFEST, objects: OBJECTS(), objectExtensions: [{ extend: 'cbpx_line', fields: { header: demoted } }] };
      const issues = cbpIssues(stack);
      expect(issues.map(([p]) => p), JSON.stringify(demoted)).toEqual(['objectExtensions.0.fields']);
      const control = cbpIssues({ manifest: MANIFEST, objects: OBJECTS({ header: demoted }) });
      expect(control.map(([p]) => p)).toEqual(['objects.2.sharingModel']);
      expect(issues[0][1]).toBe(control[0][1]);
    }
  });

  it('an extension whose target the stack does not declare is unjudged; the visible twin is refused', () => {
    // Another package's object (or the platform's): nothing to merge into here.
    const unseen = { manifest: MANIFEST, objects: OBJECTS(), objectExtensions: [{ extend: 'crm_line', fields: { a: OTHER, b: HEADER } }] };
    expect(ObjectStackDefinitionSchema.safeParse(unseen).success).toBe(true);
    // The registry keys an extension by `extend` verbatim, so a prefixed
    // spelling merges into no declared object and is not this object.
    const prefixed = { ...CARD_STACK, objectExtensions: [{ extend: 'cbpx__cbpx_line', fields: { other: OTHER } }] };
    expect(ObjectStackDefinitionSchema.safeParse(prefixed).success).toBe(true);
    expect(cbpIssues(CARD_STACK).map(([p]) => p)).toEqual(['objectExtensions.0.fields']);
  });

  it('a target whose sharingModel is not controlled_by_parent owes no master; its controlled twin is refused', () => {
    expect(ObjectStackDefinitionSchema.safeParse({ ...CARD_STACK, objects: OBJECTS({ header: HEADER }, 'private') }).success).toBe(true);
    expect(cbpIssues(CARD_STACK)).toHaveLength(1);
  });

  it('a target already refused as declared is reported once, at the object, not again at its extension', () => {
    const stack = {
      manifest: MANIFEST,
      objects: OBJECTS({ header: HEADER, other: OTHER }),
      objectExtensions: [{ extend: 'cbpx_line', fields: { note: { type: 'text' } } }],
    };
    expect(cbpIssues(stack).map(([p]) => p)).toEqual(['objects.2.fields']);
  });

  it('only the extension that wrote a master-relevant key is located', () => {
    // `note` is innocent; `other` is the second master.
    const stack = {
      manifest: MANIFEST,
      objects: OBJECTS(),
      objectExtensions: [{ extend: 'cbpx_line', fields: { note: { type: 'text' }, other: OTHER } }],
    };
    expect(cbpIssues(stack).map(([p]) => p)).toEqual(['objectExtensions.0.fields']);
  });
});

describe('[#23210] across the packages of one artifact (ADR-0130 D4)', () => {
  const body = (id: string, extra: Record<string, unknown>) => ({
    manifest: { id, name: id, version: '1.0.0', type: 'app', ...extra },
  });

  it('an extension in one package judges a target another package of the artifact declares', () => {
    const stack = {
      packages: [
        body('com.acme.ext', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: OTHER } }] }),
        body('com.acme.core', { objects: OBJECTS() }),
      ],
    };
    expect(cbpIssues(stack).map(([p]) => p)).toEqual(['packages.0.manifest.objectExtensions.0.fields']);
    // Twin: the same extension adding a plain field passes.
    const plain = {
      packages: [
        body('com.acme.ext', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: { type: 'text' } } }] }),
        body('com.acme.core', { objects: OBJECTS() }),
      ],
    };
    expect(ObjectStackDefinitionSchema.safeParse(plain).success).toBe(true);
  });

  it('priority decides the winner: a later writer that restores one master clears the refusal', () => {
    const stack = (adderPriority: number, fixerPriority: number) => ({
      packages: [
        body('com.acme.adder', { objectExtensions: [{ extend: 'cbpx_line', priority: adderPriority, fields: { other: OTHER } }] }),
        body('com.acme.fixer', {
          objectExtensions: [{ extend: 'cbpx_line', priority: fixerPriority, fields: { other: { type: 'lookup', reference: 'cbpx_other' } } }],
        }),
        body('com.acme.core', { objects: OBJECTS() }),
      ],
    });
    // The lookup writes last: one master survives.
    expect(ObjectStackDefinitionSchema.safeParse(stack(200, 300)).success).toBe(true);
    // The master writes last: two masters, located at the package that wrote it.
    expect(cbpIssues(stack(300, 200)).map(([p]) => p)).toEqual(['packages.0.manifest.objectExtensions.0.fields']);
  });

  it('two packages writing one key at one priority are left unjudged: registration order decides, not this parse', () => {
    const tied = {
      packages: [
        body('com.acme.adder', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: OTHER } }] }),
        body('com.acme.fixer', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: { type: 'text' } } }] }),
        body('com.acme.core', { objects: OBJECTS() }),
      ],
    };
    expect(ObjectStackDefinitionSchema.safeParse(tied).success).toBe(true);
  });
});
