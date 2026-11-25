// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ObjectExtensionSchema, ObjectSchema } from '@objectstack/spec/data';

import {
  TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED,
  TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE,
  TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER,
  validateTransferCascades,
} from './validate-transfer-cascades.js';
import { AUTHORING_COMMANDS, AUTHORING_RULES } from './authoring-rules.js';

/**
 * [ruling 7000907189 point 4 · ADR-0049] The three `transferBehavior: 'cascade'`
 * declarations that parse and that the Change Owner action can never offer:
 * a parent without Change Owner, an extension's field on an object that
 * cannot take a cascade, a child whose declared exposure does not serve
 * `update`. Every fixture is a full `ObjectSchema` / `ObjectExtensionSchema`
 * parse, so each refusal here is one the parse lets through.
 */

const TITLE = { title: { type: 'text', label: 'Title' } };
const CASCADE_TO = (reference: string) => ({ type: 'lookup', label: 'Parent', reference, transferBehavior: 'cascade' });
const MASTER_OF = (reference: string) => ({ type: 'master_detail', label: 'Master', reference, required: true });

function object(name: string, extra: Record<string, unknown> = {}, fields: Record<string, unknown> = TITLE) {
  const result = ObjectSchema.safeParse({ name, label: name, fields, ...extra });
  expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  return result.success ? result.data : {};
}

function extension(extend: string, fields: Record<string, unknown>) {
  const result = ObjectExtensionSchema.safeParse({ extend, fields });
  expect(result.success, result.success ? '' : JSON.stringify(result.error.issues)).toBe(true);
  return result.success ? result.data : {};
}

/** A child `deal_note` cascading to `parent`, beside the parent as declared. */
function childOf(parent: unknown, childExtra: Record<string, unknown> = {}) {
  return {
    objects: [parent, object('deal_note', childExtra, { ...TITLE, deal: CASCADE_TO('deal') })],
  };
}

const rulesOf = (stack: unknown) => validateTransferCascades(stack).map((f) => f.rule);

describe('case 1 — the parent does not offer Change Owner', () => {
  it.each([
    ['ownership: org', { ownership: 'org' }, "ownership: 'org'"],
    ['ownership: none', { ownership: 'none' }, "ownership: 'none'"],
    ['managedBy: config', { managedBy: 'config' }, "managedBy: 'config'"],
    ['userActions.transfer: false', { userActions: { transfer: false } }, 'userActions.transfer is off'],
  ])('refuses a cascade to a parent with %s, naming why and what to change', (_label, extra, reason) => {
    const findings = validateTransferCascades(childOf(object('deal', extra)));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.severity).toBe('error');
    expect(f!.rule).toBe(TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER);
    expect(f!.where).toBe('field "deal_note.deal"');
    expect(f!.path).toBe('objects[1].fields.deal.transferBehavior');
    expect(f!.message).toContain("'deal' does not offer Change Owner");
    expect(f!.message).toContain(reason);
    expect(f!.hint).toContain("Set transferBehavior to 'none' or remove it");
  });

  it('refuses a cascade to a controlled_by_parent parent left at its default', () => {
    const parent = object('deal', { sharingModel: 'controlled_by_parent' }, { ...TITLE, account: MASTER_OF('account') });
    const findings = validateTransferCascades({ objects: [object('account'), ...childOf(parent).objects] });
    expect(findings.map((f) => f.rule)).toEqual([TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER]);
    expect(findings[0]!.message).toContain('controlled_by_parent detail');
  });

  it('accepts a cascade to a parent that offers Change Owner', () => {
    expect(rulesOf(childOf(object('deal')))).toEqual([]);
    expect(rulesOf(childOf(object('deal', { ownership: 'user' })))).toEqual([]);
    expect(rulesOf(childOf(object('deal', { userActions: { transfer: true } })))).toEqual([]);
  });

  it('does not judge a parent the stack does not declare', () => {
    expect(rulesOf({ objects: [object('deal_note', {}, { ...TITLE, deal: CASCADE_TO('deal') })] })).toEqual([]);
  });

  it('leaves a sys_ parent to the field parse, which refuses it there', () => {
    const field = { type: 'lookup', label: 'Ledger', reference: 'sys_ledger', transferBehavior: 'cascade' };
    expect(ObjectSchema.safeParse({ name: 'deal_note', label: 'n', fields: { ledger: field } }).success).toBe(false);
    // A stack that reached lint unparsed, with the sys_ object declared and off, still reads nothing here.
    const stack = { objects: [{ name: 'sys_ledger', fields: {} }, { name: 'deal_note', fields: { ledger: field } }] };
    expect(rulesOf(stack)).toEqual([]);
  });

  it('judges a cascade field an extension adds as well', () => {
    const stack = {
      objects: [object('deal', { ownership: 'none' }), object('deal_note')],
      objectExtensions: [extension('deal_note', { deal: CASCADE_TO('deal') })],
    };
    const findings = validateTransferCascades(stack);
    expect(findings.map((f) => f.rule)).toEqual([TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER]);
    expect(findings[0]!.path).toBe('objectExtensions[0].fields.deal.transferBehavior');
  });
});

describe('case 2 — an extension field cascades onto an object that cannot take a cascade', () => {
  it.each([
    ['ownership: none', { ownership: 'none' }, {}, "ownership: 'none'"],
    ['a controlled_by_parent detail', { sharingModel: 'controlled_by_parent' }, { account: MASTER_OF('account') }, 'controlled_by_parent'],
    ['userActions.transfer: false', { userActions: { transfer: false } }, {}, 'userActions.transfer is off'],
  ])('refuses it on a target that is %s', (_label, extra, fields, reason) => {
    const stack = {
      objects: [object('account'), object('deal'), object('deal_note', extra, { ...TITLE, ...fields })],
      objectExtensions: [extension('deal_note', { deal: CASCADE_TO('deal') })],
    };
    const findings = validateTransferCascades(stack);
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.severity).toBe('error');
    expect(f!.rule).toBe(TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE);
    expect(f!.where).toBe('field "deal_note.deal"');
    expect(f!.path).toBe('objectExtensions[0].fields.deal.transferBehavior');
    expect(f!.message).toContain("'deal_note' cannot take a Change Owner cascade");
    expect(f!.message).toContain(reason);
    expect(f!.hint).toContain("remove it from the extension's field");
  });

  it('accepts it on a target that offers Change Owner', () => {
    const stack = {
      objects: [object('deal'), object('deal_note')],
      objectExtensions: [extension('deal_note', { deal: CASCADE_TO('deal') })],
    };
    expect(rulesOf(stack)).toEqual([]);
  });

  it('does not judge a target the stack does not declare', () => {
    const stack = { objects: [object('deal')], objectExtensions: [extension('crm_note', { deal: CASCADE_TO('deal') })] };
    expect(rulesOf(stack)).toEqual([]);
  });

  it('reads extensions in the packages[] artifact shape', () => {
    const stack = {
      objects: [object('deal'), object('deal_note', { ownership: 'none' })],
      packages: [{ manifest: { objectExtensions: [extension('deal_note', { deal: CASCADE_TO('deal') })] } }],
    };
    const findings = validateTransferCascades(stack);
    expect(findings.map((f) => f.rule)).toEqual([TRANSFER_CASCADE_EXTENSION_CHILD_INELIGIBLE]);
    expect(findings[0]!.path).toBe('packages[0].manifest.objectExtensions[0].fields.deal.transferBehavior');
  });

  it('has no fieldPatches arm to judge: a field patch cannot carry the key', () => {
    const result = ObjectExtensionSchema.safeParse({ extend: 'deal_note', fieldPatches: { deal: { transferBehavior: 'cascade' } } });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('leaves a field the object declares itself to the ObjectSchema refinement', () => {
    // Unparsed (os lint never parses): the object-level half is the parse's, so no case-2 finding here.
    const stack = { objects: [object('deal'), { name: 'deal_note', ownership: 'none', fields: { deal: CASCADE_TO('deal') } }] };
    expect(rulesOf(stack)).toEqual([]);
  });
});

describe('case 3 — the child\'s declared API exposure does not serve update', () => {
  it('refuses it when enable.apiMethods leaves update out', () => {
    const findings = validateTransferCascades(childOf(object('deal'), { enable: { apiMethods: ['get', 'list', 'create'] } }));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f!.severity).toBe('error');
    expect(f!.rule).toBe(TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED);
    expect(f!.path).toBe('objects[1].fields.deal.transferBehavior');
    expect(f!.message).toContain('enable.apiMethods does not include update');
    expect(f!.hint).toContain("add 'update' to enable.apiMethods of 'deal_note'");
  });

  it('refuses it when enable.apiEnabled is false', () => {
    const findings = validateTransferCascades(childOf(object('deal'), { enable: { apiEnabled: false } }));
    expect(findings.map((f) => f.rule)).toEqual([TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED]);
    expect(findings[0]!.message).toContain('enable.apiEnabled is false');
    expect(findings[0]!.hint).toContain('turn enable.apiEnabled on');
  });

  it('refuses it on an extension field\'s target too', () => {
    const stack = {
      objects: [object('deal'), object('deal_note', { enable: { apiMethods: ['get', 'list'] } })],
      objectExtensions: [extension('deal_note', { deal: CASCADE_TO('deal') })],
    };
    expect(rulesOf(stack)).toEqual([TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED]);
  });

  it('accepts it when update is served (no enable block, or update granted)', () => {
    expect(rulesOf(childOf(object('deal')))).toEqual([]);
    expect(rulesOf(childOf(object('deal'), { enable: { apiMethods: ['get', 'list', 'update'] } }))).toEqual([]);
  });

  it('reports each failed case of one field, since each has its own fix', () => {
    const stack = childOf(object('deal', { ownership: 'org' }), { enable: { apiMethods: ['get'] } });
    expect(rulesOf(stack)).toEqual([TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER, TRANSFER_CASCADE_CHILD_UPDATE_UNEXPOSED]);
  });
});

describe('scope and wiring', () => {
  it('judges nothing on a field whose transferBehavior is none, absent, or a multi-value reference', () => {
    const stack = {
      objects: [
        object('deal', { ownership: 'none' }),
        object('deal_note', { enable: { apiMethods: ['get'] } }, {
          ...TITLE,
          a: { type: 'lookup', label: 'A', reference: 'deal', transferBehavior: 'none' },
          b: { type: 'lookup', label: 'B', reference: 'deal' },
        }),
        // Unparsed: the field parse refuses 'cascade' on a multi-value reference.
        { name: 'deal_tag', fields: { c: { type: 'lookup', reference: 'deal', multiple: true, transferBehavior: 'cascade' } } },
      ],
    };
    expect(rulesOf(stack)).toEqual([]);
  });

  it('runs as a gating rule on all three commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateTransferCascades');
    expect(entry).toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect([...entry!.commands]).toEqual([...AUTHORING_COMMANDS]);
    const findings = entry!.run(childOf(object('deal', { ownership: 'none' })) as Record<string, unknown>, {});
    expect(findings.map((f) => f.rule)).toEqual([TRANSFER_CASCADE_PARENT_WITHOUT_CHANGE_OWNER]);
  });
});
