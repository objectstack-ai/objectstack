// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `judgePicklistReferences` — the walk `os validate` (step 2d) and `os build`
 * (step 3a-bis) run over a field's `picklist` reference and a
 * `picklistExtensions` entry's `extend`.
 *
 * Pinned here: which references are judged (the load path's reading — the top
 * level when there is no `packages[]`, each body's own otherwise), what they
 * resolve against (every picklist the stack declares), and which of the two
 * verdicts an unresolved one gets (refused when the declaring package depends
 * on nothing outside the stack; an `info` notice when it does) — the same two
 * verdicts for a field and for an extension. Asserted by rule id, severity,
 * the field or extension named in `where`, the list named in `message` and the
 * `path` — never by the sentence around them.
 */

import { describe, expect, it } from 'vitest';
import { unclaimedTopLevel } from '@objectstack/metadata';
import { unreferencedResidualPicklists } from '@objectstack/metadata/picklist-references';
import {
  judgePicklistReferences,
  picklistRefusalHeading,
  PICKLIST_REFERENCE_UNKNOWN,
  PICKLIST_REFERENCE_UNVERIFIED,
  PICKLIST_RESIDUAL_UNREFERENCED,
} from './picklist-references.js';

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, version: '1.0.0', type: 'app', ...extra,
});

const industry = {
  name: 'industry',
  label: 'Industry',
  options: [{ label: 'Technology', value: 'technology' }],
};

/** An extension adding one option to the list it names. */
const extension = (extend: string) => ({
  extend,
  options: [{ label: 'Healthcare', value: 'healthcare' }],
});

const account = (picklist: string) => ({
  name: 'pk_account',
  label: 'Account',
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'select', label: 'Industry', picklist },
  },
});

describe('judgePicklistReferences — a one-package stack', () => {
  it('CONTROL: a field naming a picklist the stack declares is neither refused nor reported', () => {
    expect(judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objects: [account('industry')],
    })).toEqual({ refusals: [], notices: [] });
  });

  it('CONTROL: a select with inline options and no `picklist` is not this judge\'s business', () => {
    expect(judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      objects: [{
        name: 'pk_account',
        fields: { tier: { type: 'select', options: [{ label: 'Gold', value: 'gold' }] } },
      }],
    })).toEqual({ refusals: [], notices: [] });
  });

  it('refuses a `picklist` that names no picklist in the stack, naming the field and the list', () => {
    const { refusals, notices } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objects: [account('industy')],
    });
    expect(notices).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      severity: 'error',
      rule: PICKLIST_REFERENCE_UNKNOWN,
      where: 'field "pk_account.industry"',
      path: 'objects[0].fields.industry.picklist',
    });
    expect(refusals[0].message).toContain("'industy'");
    // The lists it could have meant are named, so the typo is visible.
    expect(refusals[0].message).toContain("'industry'");
  });

  it('refuses a dangling reference in a stack that declares no picklist at all', () => {
    const { refusals } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      objects: [account('industry')],
    });
    expect(refusals.map((r) => r.rule)).toEqual([PICKLIST_REFERENCE_UNKNOWN]);
  });

  it('judges the fields an `objectExtensions` entry merges into its target too', () => {
    const { refusals } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objectExtensions: [{ extend: 'crm_account', fields: { segment: { type: 'select', picklist: 'segment' } } }],
    });
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      where: 'field "crm_account.segment"',
      path: 'objectExtensions[0].fields.segment.picklist',
    });
  });

  it('REPORTS, never refuses, when the stack depends on a package it does not carry', () => {
    const { refusals, notices } = judgePicklistReferences({
      manifest: manifest('com.example.pk', { dependencies: { 'com.acme.crm': '^1.0.0' } }),
      objects: [account('industry')],
    });
    expect(refusals).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      severity: 'info',
      rule: PICKLIST_REFERENCE_UNVERIFIED,
      path: 'objects[0].fields.industry.picklist',
    });
    // The notice is printed without its `where`, so it names the field, the
    // list and the dependency it could not read.
    expect(notices[0].message).toContain('pk_account.industry');
    expect(notices[0].message).toContain("'industry'");
    expect(notices[0].message).toContain("'com.acme.crm'");
  });
});

describe('judgePicklistReferences — a `packages[]` stack', () => {
  it('resolves a picklist a SIBLING package in the same artifact declares', () => {
    expect(judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core'), picklists: [industry] } },
        {
          manifest: {
            ...manifest('com.example.orders', { dependencies: { 'com.example.core': '^1.0.0' } }),
            objects: [account('industry')],
          },
        },
      ],
    })).toEqual({ refusals: [], notices: [] });
  });

  it('refuses when every declared dependency is inside the artifact — none of them declares the list', () => {
    const { refusals, notices } = judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core'), picklists: [industry] } },
        {
          manifest: {
            ...manifest('com.example.orders', { dependencies: { 'com.example.core': '^1.0.0' } }),
            objects: [account('region')],
          },
        },
      ],
    });
    expect(notices).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      rule: PICKLIST_REFERENCE_UNKNOWN,
      path: 'packages[1].manifest.objects[0].fields.industry.picklist',
    });
  });

  it('reads the declaring package\'s OWN dependencies: an outside dependency of a sibling does not soften it', () => {
    const { refusals, notices } = judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core', { dependencies: { 'com.acme.crm': '^1.0.0' } }) } },
        { manifest: { ...manifest('com.example.orders'), objects: [account('region')] } },
        {
          manifest: {
            ...manifest('com.example.billing', { dependencies: { 'com.acme.crm': '^1.0.0' } }),
            objects: [account('segment')],
          },
        },
      ],
    });
    expect(refusals.map((r) => r.path)).toEqual(['packages[1].manifest.objects[0].fields.industry.picklist']);
    expect(notices.map((n) => n.path)).toEqual(['packages[2].manifest.objects[0].fields.industry.picklist']);
  });
});

describe('judgePicklistReferences — a `picklistExtensions[].extend` in a one-package stack', () => {
  it('CONTROL: an extension naming a picklist the stack declares is neither refused nor reported', () => {
    expect(judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      picklistExtensions: [extension('industry')],
    })).toEqual({ refusals: [], notices: [] });
  });

  it('refuses an `extend` that names no picklist in the stack, naming the extension and the list', () => {
    const { refusals, notices } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      picklistExtensions: [extension('industry'), extension('industy')],
    });
    expect(notices).toEqual([]);
    // Only the second entry: the first resolves.
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      severity: 'error',
      rule: PICKLIST_REFERENCE_UNKNOWN,
      where: 'picklist extension "industy"',
      path: 'picklistExtensions[1].extend',
    });
    expect(refusals[0].message).toContain("'industy'");
    // The lists it could have meant are named, so the typo is visible.
    expect(refusals[0].message).toContain("'industry'");
  });

  it('refuses a dangling `extend` in a stack that declares no picklist at all', () => {
    const { refusals } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklistExtensions: [extension('industry')],
    });
    expect(refusals.map((r) => r.rule)).toEqual([PICKLIST_REFERENCE_UNKNOWN]);
    expect(refusals[0].path).toBe('picklistExtensions[0].extend');
  });

  it('judges a field and an extension in one pass: each dangling reference is its own refusal', () => {
    const { refusals } = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objects: [account('industy')],
      picklistExtensions: [extension('regoin')],
    });
    expect(refusals.map((r) => r.path)).toEqual([
      'objects[0].fields.industry.picklist',
      'picklistExtensions[0].extend',
    ]);
    expect(new Set(refusals.map((r) => r.rule))).toEqual(new Set([PICKLIST_REFERENCE_UNKNOWN]));
  });

  it('a resolving extension does not hide a dangling field reference, nor the reverse', () => {
    const fieldOnly = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objects: [account('industy')],
      picklistExtensions: [extension('industry')],
    });
    expect(fieldOnly.refusals.map((r) => r.where)).toEqual(['field "pk_account.industry"']);

    const extensionOnly = judgePicklistReferences({
      manifest: manifest('com.example.pk'),
      picklists: [industry],
      objects: [account('industry')],
      picklistExtensions: [extension('industy')],
    });
    expect(extensionOnly.refusals.map((r) => r.where)).toEqual(['picklist extension "industy"']);
  });

  it('REPORTS, never refuses, when the stack depends on a package it does not carry', () => {
    const { refusals, notices } = judgePicklistReferences({
      manifest: manifest('com.example.pk', { dependencies: { 'com.acme.crm': '^1.0.0' } }),
      picklistExtensions: [extension('industry')],
    });
    expect(refusals).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      severity: 'info',
      rule: PICKLIST_REFERENCE_UNVERIFIED,
      path: 'picklistExtensions[0].extend',
    });
    // The notice is printed without its `where`, so it names the extension, the
    // list and the dependency it could not read.
    expect(notices[0].message).toContain('picklist extension "industry"');
    expect(notices[0].message).toContain("'industry'");
    expect(notices[0].message).toContain("'com.acme.crm'");
  });
});

describe('judgePicklistReferences — a `picklistExtensions[].extend` in a `packages[]` stack', () => {
  it('resolves an extension against a picklist a SIBLING package in the same artifact declares', () => {
    expect(judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core'), picklists: [industry] } },
        {
          manifest: {
            ...manifest('com.example.orders', { dependencies: { 'com.example.core': '^1.0.0' } }),
            picklistExtensions: [extension('industry')],
          },
        },
      ],
    })).toEqual({ refusals: [], notices: [] });
  });

  it('refuses when every declared dependency is inside the artifact — none of them declares the list', () => {
    const { refusals, notices } = judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core'), picklists: [industry] } },
        {
          manifest: {
            ...manifest('com.example.orders', { dependencies: { 'com.example.core': '^1.0.0' } }),
            picklistExtensions: [extension('region')],
          },
        },
      ],
    });
    expect(notices).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      rule: PICKLIST_REFERENCE_UNKNOWN,
      where: 'picklist extension "region"',
      path: 'packages[1].manifest.picklistExtensions[0].extend',
    });
  });

  it('reads the declaring package\'s OWN dependencies: an outside dependency of a sibling does not soften it', () => {
    const { refusals, notices } = judgePicklistReferences({
      packages: [
        { manifest: { ...manifest('com.example.core', { dependencies: { 'com.acme.crm': '^1.0.0' } }) } },
        { manifest: { ...manifest('com.example.orders'), picklistExtensions: [extension('region')] } },
        {
          manifest: {
            ...manifest('com.example.billing', { dependencies: { 'com.acme.crm': '^1.0.0' } }),
            picklistExtensions: [extension('segment')],
          },
        },
      ],
    });
    expect(refusals.map((r) => r.path)).toEqual(['packages[1].manifest.picklistExtensions[0].extend']);
    expect(notices.map((n) => n.path)).toEqual(['packages[2].manifest.picklistExtensions[0].extend']);
  });

  it('does not judge a TOP-LEVEL `picklistExtensions` once `packages[]` carries the bodies: the load path does not register from it', () => {
    expect(judgePicklistReferences({
      packages: [{ manifest: { ...manifest('com.example.core'), picklists: [industry] } }],
      picklistExtensions: [extension('industy')],
    })).toEqual({ refusals: [], notices: [] });
  });
});

/**
 * [ADR-0130 D4] A composed stack's top-level picklist that no package body
 * declares and no object field the boot registers names: the boot refuses the
 * stack (`INVALID_METADATA`), so this door refuses it too, as
 * `picklist-residual-unreferenced`, in the boot's words. Both read the one
 * judgement, `unreferencedResidualPicklists`; the last pin below holds the door
 * to it, and `picklist-references.boot-parity.test.ts` smoke-checks the boot.
 */
describe('judgePicklistReferences — a composed stack\'s residual picklist that nothing names', () => {
  const STACK_ID = 'com.example.release';
  const status = { name: 'status_list', label: 'Status', options: [{ label: 'Open', value: 'open' }] };
  const unused = { name: 'unused_list', label: 'Unused', options: [{ label: 'A', value: 'a' }] };
  const statusField = { status: { type: 'select', label: 'Status', picklist: 'status_list' } };
  const caseObj = (fields: Record<string, unknown> = { subject: { type: 'text', label: 'Subject' } }) =>
    ({ name: 'pk_case', label: 'Case', fields });
  const noteObj = (fields: Record<string, unknown> = { title: { type: 'text', label: 'Title' } }) =>
    ({ name: 'pk_note', label: 'Note', fields });
  /** Two bodies, a manifest naming neither, and `top` on the top level. */
  const composed = (top: Record<string, unknown>, coreExtra: Record<string, unknown> = {}) => ({
    manifest: manifest(STACK_ID),
    ...top,
    packages: [
      { manifest: { ...manifest('com.example.core'), objects: [caseObj()], ...coreExtra } },
      { manifest: { ...manifest('com.example.app'), objects: [account('industry')], picklists: [industry] } },
    ],
  });
  const residualRefusals = (parsed: Record<string, unknown>) =>
    judgePicklistReferences(parsed).refusals.filter((r) => r.rule === PICKLIST_RESIDUAL_UNREFERENCED);

  it('refuses one, naming the list, the stack and the boot\'s prescription, located at its top-level index', () => {
    const { refusals, notices } = judgePicklistReferences(composed({ picklists: [industry, unused] }));
    expect(notices).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      severity: 'error',
      rule: PICKLIST_RESIDUAL_UNREFERENCED,
      where: 'picklist "unused_list"',
      path: 'picklists[1]',
    });
    expect(refusals[0].message).toContain(`Picklist 'unused_list' is declared on the top level of stack '${STACK_ID}'`);
    expect(refusals[0].message).toContain('no package body declares it and no object field the engine registers names it');
    expect(refusals[0].hint).toContain('Declare it inside the `packages[]` entry of the package whose objects use it');
    expect(refusals[0].hint).toContain('name it from a field of the object meant to use it');
    expect(refusals[0].hint).toContain('remove it from the top level');
  });

  it('refuses each such list as its own finding', () => {
    expect(residualRefusals(composed({ picklists: [unused, { ...unused, name: 'spare_list' }] })).map((r) => r.where))
      .toEqual(['picklist "unused_list"', 'picklist "spare_list"']);
  });

  it('refuses one that only a top-level `objectExtensions` entry names — no door registers it in a composed stack', () => {
    expect(residualRefusals(composed({ picklists: [status], objectExtensions: [{ extend: 'pk_case', fields: statusField }] })))
      .toHaveLength(1);
  });

  it('refuses one that only a top-level copy of a body-declared object names, its fields diverging from the body\'s', () => {
    expect(residualRefusals(composed({ picklists: [status], objects: [caseObj(statusField)] }))).toHaveLength(1);
  });

  it('refuses one that only a top-level `plugins[]` entry\'s object names', () => {
    expect(residualRefusals(composed({ picklists: [status], plugins: [{ name: 'p', objects: [noteObj(statusField)] }] })))
      .toHaveLength(1);
  });

  it('refuses one that only a body\'s `picklistExtensions` entry extends', () => {
    expect(residualRefusals(composed({ picklists: [status] }, {
      picklistExtensions: [{ extend: 'status_list', options: [{ label: 'Closed', value: 'closed' }] }],
    }))).toHaveLength(1);
  });

  it('CONTROL: one a residual object\'s field names is not this refusal (the boot lists that object and does not serve it)', () => {
    expect(judgePicklistReferences(composed({ picklists: [status], objects: [noteObj(statusField)] })))
      .toEqual({ refusals: [], notices: [] });
  });

  it('CONTROL: one a body object\'s field names is not this refusal — that field is `picklist-reference-unknown`, as before', () => {
    const { refusals } = judgePicklistReferences(composed({ picklists: [status] }, { objects: [caseObj(statusField)] }));
    expect(refusals.map((r) => r.rule)).toEqual([PICKLIST_REFERENCE_UNKNOWN]);
  });

  it('CONTROL: a body-declared picklist, repeated on the top level or not, is not residual', () => {
    for (const top of [{ picklists: [industry] }, {}]) {
      expect(judgePicklistReferences(composed(top))).toEqual({ refusals: [], notices: [] });
    }
  });

  it('CONTROL: a stack without `packages[]` has no residual — its unnamed picklist is not refused', () => {
    expect(judgePicklistReferences({ manifest: manifest('com.example.pk'), picklists: [industry, unused], objects: [account('industry')] }))
      .toEqual({ refusals: [], notices: [] });
  });

  it('reports the one judgement the boot throws — its lists, their locations and its words, one finding per list', () => {
    const stack = composed({ picklists: [industry, unused, { ...unused, name: 'spare_list' }] });
    const judged = unreferencedResidualPicklists(
      unclaimedTopLevel(stack),
      stack.packages.map((entry) => entry.manifest),
    );
    expect(judged?.picklists).toHaveLength(2);
    expect(residualRefusals(stack)).toEqual(judged!.picklists.map((list) => ({
      severity: 'error',
      rule: PICKLIST_RESIDUAL_UNREFERENCED,
      where: `picklist "${list.name}"`,
      path: `${list.field}[${list.index}]`,
      message: list.wording.judgement,
      hint: list.wording.prescription,
    })));
  });
});

describe('picklistRefusalHeading — the text face\'s heading names what each rule refused', () => {
  const finding = (rule: string) => ({ severity: 'error' as const, rule, where: 'w', path: 'p', message: 'm', hint: 'h' });

  it('CONTROL: reference refusals alone keep the heading they always had', () => {
    expect(picklistRefusalHeading([finding(PICKLIST_REFERENCE_UNKNOWN), finding(PICKLIST_REFERENCE_UNKNOWN)]))
      .toBe('A picklist reference names a picklist this stack does not declare (2 references)');
  });

  it('a residual refusal is headed as the boot\'s refusal, not as a reference', () => {
    const heading = picklistRefusalHeading([finding(PICKLIST_RESIDUAL_UNREFERENCED)]);
    expect(heading).toBe('A top-level picklist of this composed stack is one the boot refuses: no package body declares it '
      + 'and no object field the engine registers names it (1 picklist)');
  });

  it('both kinds together are both named', () => {
    const heading = picklistRefusalHeading([finding(PICKLIST_REFERENCE_UNKNOWN), finding(PICKLIST_RESIDUAL_UNREFERENCED)]);
    expect(heading).toContain('(1 reference)');
    expect(heading).toContain('(1 picklist)');
  });
});
