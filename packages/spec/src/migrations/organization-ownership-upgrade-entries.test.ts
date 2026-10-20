// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 18.0 upgrade-guide entries that send an operator to the ADR-0131 D10
 * ownership ceremony (#24581). The ceremony is open on this line: `os migrate
 * organization-ownership` writes a plan and `--apply --plan-file PLAN
 * --backup-taken` applies it, on a v17 database and on one an 18.0 install
 * created. So each of the seven entries #24661 re-worded for the closed 18.0
 * command now prescribes the ceremony's steps again, and none tells the
 * operator to keep a database on 17.x or that the command refuses.
 */

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_BY_MAJOR } from './registry.js';

const CEREMONY_ENTRIES = [
  'cli-organization-ownership-apply-plan-file-required',
  'sharing-rule-declared-mirror-retired',
  'sys-metadata-audit-organization-column-retired',
  'sys-metadata-commit-organization-column-retired',
  'sys-metadata-history-organization-column-retired',
  'sys-metadata-organization-column-retired',
  'ups-permission-set-id-column-retired',
] as const;

/** What the closed 18.0 command's wording said; an open ceremony says none of it. */
const CLOSED_COMMAND = /fresh installs only|NOT_IMPLEMENTED|on a 17\.x release|carries the upgrade path|18\.0 refuses/;

const semantic18 = MIGRATIONS_BY_MAJOR[18]!.semantic;
const prose = (e: (typeof semantic18)[number]): string => `${e.replacement}\n${e.reason}\n${e.acceptanceCriteria}`;

describe('[#24581] the 18.0 upgrade-guide entries prescribe the open ceremony', () => {
  it.each(CEREMONY_ENTRIES)('%s names the ceremony and none of the closed command\'s wording', (id) => {
    const entry = semantic18.find((e) => e.id === id);
    expect(entry, id).toBeDefined();
    expect(prose(entry!)).toContain('os migrate organization-ownership');
    expect(prose(entry!)).not.toMatch(CLOSED_COMMAND);
  });

  it('⭐ no 18 entry that names the ceremony says it is closed', () => {
    const naming = semantic18.filter((e) => prose(e).includes('os migrate organization-ownership'));
    expect(naming.map((e) => e.id)).toEqual(expect.arrayContaining([...CEREMONY_ENTRIES]));
    expect(naming.filter((e) => CLOSED_COMMAND.test(prose(e))).map((e) => e.id)).toEqual([]);
  });
});
