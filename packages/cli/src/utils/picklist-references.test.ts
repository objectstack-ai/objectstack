// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `judgePicklistReferences` — the walk `os validate` (step 2d) and `os build`
 * (step 3a-bis) run over a field's `picklist` reference.
 *
 * Pinned here: which references are judged (the load path's reading — the top
 * level when there is no `packages[]`, each body's own otherwise), what they
 * resolve against (every picklist the stack declares), and which of the two
 * verdicts an unresolved one gets (refused when the declaring package depends
 * on nothing outside the stack; an `info` notice when it does). Asserted by
 * rule id, severity, the field named in `where`, the list named in `message`
 * and the `path` — never by the sentence around them.
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
