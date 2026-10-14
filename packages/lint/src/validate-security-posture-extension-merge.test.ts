// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23210 · ADR-0055 §1] `security-controlled-by-parent-ambiguous-relation`
 * and `security-controlled-by-parent-no-relation`, judged on the MERGED field
 * set of a `controlled_by_parent` object that an `objectExtensions` entry of
 * the same stack extends (`extensionMergedCbpFindings`).
 *
 * The stack schema refuses the same merged shapes
 * (`applyControlledByParentExtensionGate`, `@objectstack/spec`); this is the
 * door an unparsed intake meets. Every refusal below is pinned by rule id,
 * path and message — the message compared with the finding the same object
 * gets when it is declared directly — and every silence beside a twin that
 * differs in the one variable under test and is reported. The last block
 * holds the two doors to one verdict per shape.
 */
import { describe, it, expect } from 'vitest';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import {
  validateSecurityPosture,
  SECURITY_CBP_AMBIGUOUS_RELATION,
  SECURITY_CBP_NO_RELATION,
} from './validate-security-posture.js';

const HEADER = { type: 'master_detail', reference: 'cbpx_header', required: true };
const OTHER = { type: 'master_detail', reference: 'cbpx_other', required: true };

const OBJECTS = (lineFields: Record<string, unknown> = { header: HEADER }, sharingModel = 'controlled_by_parent') => [
  { name: 'cbpx_header', sharingModel: 'private', fields: { title: { type: 'text' } } },
  { name: 'cbpx_other', sharingModel: 'private', fields: { title: { type: 'text' } } },
  { name: 'cbpx_line', sharingModel, fields: lineFields },
];

const extending = (fields: Record<string, unknown>, extend = 'cbpx_line') => ({
  objects: OBJECTS(),
  objectExtensions: [{ extend, fields }],
});

/** The card's stack: one declared master, a second one added by an extension. */
const CARD_STACK = extending({ other: OTHER });

const cbpFindings = (stack: Record<string, unknown>) =>
  validateSecurityPosture(stack).filter(
    (f) => f.rule === SECURITY_CBP_AMBIGUOUS_RELATION || f.rule === SECURITY_CBP_NO_RELATION,
  );

describe('[#23210] validateSecurityPosture judges a controlled_by_parent object on its merged field set', () => {
  it('the card\'s stack: ambiguous-relation at the extension\'s fields, in the words of the declared control', () => {
    const findings = cbpFindings(CARD_STACK);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SECURITY_CBP_AMBIGUOUS_RELATION,
      where: 'object "cbpx_line"',
      path: 'objectExtensions[0].fields',
    });

    const control = cbpFindings({ objects: OBJECTS({ header: HEADER, other: OTHER }) });
    expect(control.map((f) => [f.rule, f.path])).toEqual([[SECURITY_CBP_AMBIGUOUS_RELATION, 'objects[2].fields']]);
    expect(findings[0].message).toBe(control[0].message);
    expect(findings[0].hint).toBe(control[0].hint);
    expect(findings[0].message).toContain('"header" → cbpx_header, "other" → cbpx_other');
  });

  it('the single-object control is unchanged, and its declared base alone is clean', () => {
    expect(cbpFindings({ objects: OBJECTS({ header: HEADER, other: OTHER }) }).map((f) => f.path)).toEqual([
      'objects[2].fields',
    ]);
    expect(cbpFindings({ objects: OBJECTS() })).toEqual([]);
  });

  it('an extension adding a non-master field is silent; its master-adding twin is reported', () => {
    expect(cbpFindings(extending({ other: { type: 'text' } }))).toEqual([]);
    expect(cbpFindings(extending({ other: { type: 'lookup', reference: 'cbpx_other', required: true } }))).toEqual([]);
    expect(cbpFindings(extending({ other: OTHER })).map((f) => f.path)).toEqual(['objectExtensions[0].fields']);
  });

  it('an extension that demotes the one master is no-relation at the extension, in the words of the declared control', () => {
    for (const demoted of [
      { type: 'master_detail', reference: 'cbpx_header', required: false },
      { type: 'text' },
      { type: 'lookup', reference: 'cbpx_header', required: true },
    ]) {
      const findings = cbpFindings(extending({ header: demoted }));
      expect(findings.map((f) => [f.rule, f.path]), JSON.stringify(demoted)).toEqual([
        [SECURITY_CBP_NO_RELATION, 'objectExtensions[0].fields'],
      ]);
      const control = cbpFindings({ objects: OBJECTS({ header: demoted }) });
      expect(control.map((f) => f.path)).toEqual(['objects[2].sharingModel']);
      expect(findings[0].message).toBe(control[0].message);
    }
  });

  it('an extension whose target the stack does not declare is unjudged; the visible twin is reported', () => {
    expect(cbpFindings(extending({ a: OTHER, b: HEADER }, 'crm_line'))).toEqual([]);
    expect(cbpFindings(extending({ other: OTHER }, 'cbpx__cbpx_line'))).toEqual([]);
    expect(cbpFindings(extending({ other: OTHER }, 'cbpx_line'))).toHaveLength(1);
  });

  it('a target already reported as declared is reported once, at the object', () => {
    const stack = {
      objects: OBJECTS({ header: HEADER, other: OTHER }),
      objectExtensions: [{ extend: 'cbpx_line', fields: { note: { type: 'text' } } }],
    };
    expect(cbpFindings(stack).map((f) => f.path)).toEqual(['objects[2].fields']);
  });

  it('reads the array field form of an extension too', () => {
    const stack = { objects: OBJECTS(), objectExtensions: [{ extend: 'cbpx_line', fields: [{ name: 'other', ...OTHER }] }] };
    expect(cbpFindings(stack).map((f) => f.path)).toEqual(['objectExtensions[0].fields']);
  });

  it('across the packages of one artifact: an extension in one body judges another body\'s object', () => {
    const body = (id: string, extra: Record<string, unknown>) => ({ manifest: { id, name: id, version: '1.0.0', type: 'app', ...extra } });
    const stack = (field: unknown) => ({
      packages: [
        body('com.acme.ext', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: field } }] }),
        body('com.acme.core', { objects: OBJECTS() }),
      ],
    });
    expect(cbpFindings(stack(OTHER)).map((f) => [f.rule, f.path])).toEqual([
      [SECURITY_CBP_AMBIGUOUS_RELATION, 'packages[0].manifest.objectExtensions[0].fields'],
    ]);
    expect(cbpFindings(stack({ type: 'text' }))).toEqual([]);
  });
});

// ── The two doors, one verdict per shape ───────────────────────────────────
//
// The stack schema and this rule each read the merge (`@objectstack/lint`
// imports no runtime and the schema's reader is internal to the spec), so the
// table below holds them to the same answer on the same stacks: the path of
// every refusal, schema-side dotted and lint-side bracketed.
describe('[#23210] the parse and the lint agree on the merged shape', () => {
  const body = (id: string, extra: Record<string, unknown>) => ({ manifest: { id, name: id, version: '1.0.0', type: 'app', ...extra } });

  it.each<[string, Record<string, unknown>, string[]]>([
    ['the card\'s stack', CARD_STACK, ['objectExtensions.0.fields']],
    ['a non-master field', extending({ other: { type: 'text' } }), []],
    ['a demoted master', extending({ header: { type: 'master_detail', reference: 'cbpx_header', required: false } }), ['objectExtensions.0.fields']],
    ['an unseen target', extending({ other: OTHER }, 'crm_line'), []],
    ['a non-controlled target', { ...CARD_STACK, objects: OBJECTS({ header: HEADER }, 'private') }, []],
    [
      'a cross-package extension',
      {
        packages: [
          body('com.acme.ext', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: OTHER } }] }),
          body('com.acme.core', { objects: OBJECTS() }),
        ],
      },
      ['packages.0.manifest.objectExtensions.0.fields'],
    ],
    [
      'a later writer restoring one master',
      {
        packages: [
          body('com.acme.adder', { objectExtensions: [{ extend: 'cbpx_line', priority: 200, fields: { other: OTHER } }] }),
          body('com.acme.fixer', { objectExtensions: [{ extend: 'cbpx_line', priority: 300, fields: { other: { type: 'text' } } }] }),
          body('com.acme.core', { objects: OBJECTS() }),
        ],
      },
      [],
    ],
    [
      'two packages tied on one key',
      {
        packages: [
          body('com.acme.adder', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: OTHER } }] }),
          body('com.acme.fixer', { objectExtensions: [{ extend: 'cbpx_line', fields: { other: { type: 'text' } } }] }),
          body('com.acme.core', { objects: OBJECTS() }),
        ],
      },
      [],
    ],
  ])('%s', (_label, stack, refusedAt) => {
    const parsed = ObjectStackDefinitionSchema.safeParse(stack);
    const parseIssues = parsed.success
      ? []
      : parsed.error.issues
        .filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message))
        .map((i) => i.path.join('.'));
    expect(parseIssues).toEqual(refusedAt);
    // An accepted shape parses WHOLE, so a silence is the rule's and not a
    // refinement skipped behind some other refusal.
    if (refusedAt.length === 0) expect(parsed.success).toBe(true);

    const lintPaths = cbpFindings(stack).map((f) => f.path.replace(/\[(\d+)\]/g, '.$1'));
    expect(lintPaths).toEqual(refusedAt);
  });
});
