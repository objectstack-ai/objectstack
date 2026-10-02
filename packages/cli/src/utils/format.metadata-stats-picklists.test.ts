// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN: the metadata summary `os validate`, `os build` and `os info` print
 * counts the picklists a stack declares.
 *
 * ## What was measured before the row existed
 *
 * On `origin/main` 58a77dbde2, a blank starter with one picklist wired under
 * `picklists` and one select field naming it printed, through `os validate`:
 *
 *     Data: 1 Objects  3 Fields
 *
 * The list was declared, loaded and resolved, and the summary that answers
 * "what does this stack declare" said nothing about it. With `os generate
 * picklist` on the roster, an author who runs it and then `os validate` reads
 * that summary to see the scaffold arrive.
 *
 * ## What is pinned
 *
 * - the READER (`collectMetadataStats`) counts `picklists`, in both ADR-0130
 *   D4 shapes, through the one fold every other member goes through;
 * - the PRINTER renders the count in the `Data:` row, the domain the kind
 *   belongs to (`kernel/metadata-plugin.zod.ts` files it under `data`);
 * - a stack with no picklists prints the `Data:` row it printed before,
 *   because a zero item is filtered like every other one;
 * - a `picklistExtensions` entry is not a list: it adds options to a list
 *   another package owns, so it is not counted as one.
 */

import { describe, expect, it } from 'vitest';
import { collectMetadataStats, printMetadataStats, type MetadataStats } from './format.js';

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

function dataRow(stats: MetadataStats): string | undefined {
  const captured: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    printMetadataStats(stats);
  } finally {
    console.log = original;
  }
  return stripAnsi(captured.join('\n')).split('\n').find((l) => l.trim().startsWith('Data:'))?.trim();
}

const manifest = {
  id: 'com.example.pk',
  name: 'pk',
  version: '1.0.0',
  type: 'app',
  namespace: 'pk',
};

const INDUSTRY = { name: 'industry', label: 'Industry', options: [{ label: 'Tech', value: 'tech' }] };
const REGION = { name: 'region', label: 'Region', options: [{ label: 'EMEA', value: 'emea' }] };

const ACCOUNT = {
  name: 'pk_account',
  label: 'Account',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'select', label: 'Industry', picklist: 'industry' },
  },
};

describe('collectMetadataStats counts the picklists a stack declares', () => {
  it('a top-level stack', () => {
    expect(collectMetadataStats({ manifest, picklists: [INDUSTRY, REGION], objects: [ACCOUNT] }).picklists).toBe(2);
  });

  it('an option-B stack, every definition inside `packages[]`', () => {
    const optionB = { manifest, packages: [{ manifest: { ...manifest, picklists: [INDUSTRY], objects: [ACCOUNT] } }] };
    expect(collectMetadataStats(optionB).picklists).toBe(1);
  });

  it('a `picklistExtensions` entry is not a list', () => {
    const extending = { manifest, picklistExtensions: [{ extend: 'industry', options: [{ label: 'Bio', value: 'bio' }] }] };
    expect(collectMetadataStats(extending).picklists).toBe(0);
  });

  it('a stack that declares none counts zero', () => {
    expect(collectMetadataStats({ manifest, objects: [ACCOUNT] }).picklists).toBe(0);
  });
});

describe('printMetadataStats renders the count in the Data: row', () => {
  it('beside the objects and fields that name the lists', () => {
    const stats = collectMetadataStats({ manifest, picklists: [INDUSTRY], objects: [ACCOUNT] });
    expect(dataRow(stats)).toBe('Data: 1 Objects  2 Fields  1 Picklists');
  });

  it('control: a stack with no picklists prints the row it printed before', () => {
    const stats = collectMetadataStats({ manifest, objects: [ACCOUNT] });
    expect(dataRow(stats)).toBe('Data: 1 Objects  2 Fields');
  });
});
