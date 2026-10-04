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
import {
  judgePicklistReferences,
  PICKLIST_REFERENCE_UNKNOWN,
  PICKLIST_REFERENCE_UNVERIFIED,
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
