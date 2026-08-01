// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4327 — the flag surface where `os migrate meta`'s two modes meet.
 *
 * One command, two subjects: `--from N` replays the ADR-0087 chain over an
 * **author's source** (a config file, no database in reach), `--stored` replays
 * it over **one deployment's** `sys_metadata` rows (a database, no config in
 * reach). Everything below pins a boundary that a plausible-looking oclif
 * declaration gets wrong.
 */
import { describe, expect, it } from 'vitest';
import MigrateMeta, { storedOnlyFlagsIn } from './meta.js';

describe('storedOnlyFlagsIn (#4327)', () => {
  it('reports the stored-only flags the operator typed', () => {
    expect(storedOnlyFlagsIn(['--from', '16', '--apply'])).toEqual(['apply']);
    expect(storedOnlyFlagsIn(['--from=16', '--type=view', '--force'])).toEqual(['force', 'type']);
    expect(storedOnlyFlagsIn(['--from', '16', '-y'])).toEqual(['yes']);
  });

  it('says nothing about a run that typed none of them', () => {
    expect(storedOnlyFlagsIn(['--from', '16', '--step', '--json'])).toEqual([]);
    expect(storedOnlyFlagsIn([])).toEqual([]);
  });

  it('never double-reports --yes given both spellings', () => {
    expect(storedOnlyFlagsIn(['--stored', '--yes', '-y'])).toEqual(['yes']);
  });

  it('reads argv, not the environment — an exported OS_DATABASE_URL is not a typed flag', () => {
    // The trap that made `dependsOn` unusable: oclif fills `--database-url`
    // from `OS_DATABASE_URL`, so a merely-exported env var would have counted
    // as "provided" and broken `os migrate meta --from N` for anyone who has
    // one set. Provenance comes from argv precisely so it cannot.
    expect(storedOnlyFlagsIn(['--from', '16'])).toEqual([]);
    expect(storedOnlyFlagsIn(['--stored', '--database-url', 'sqlite://x.db'])).toEqual(['database-url']);
  });
});

describe('MigrateMeta flag declarations (#4327)', () => {
  const flags = MigrateMeta.flags as Record<string, any>;

  it('does not declare --from required — that would reject every --stored run', () => {
    expect(flags.from.required).not.toBe(true);
  });

  it('makes the authored-chain flags exclusive with --stored', () => {
    // `--from` names a major an author wrote against; a stored row carries its
    // own history and gets the full chain regardless. Accepting both would
    // imply the stored pass honours a range it does not have.
    for (const name of ['from', 'to', 'step', 'out']) {
      expect(flags[name].exclusive).toContain('stored');
    }
  });

  it('leaves the stored-only flags free of dependsOn', () => {
    // Enforced by `storedOnlyFlagsIn` instead: see the env-var case above.
    for (const name of ['apply', 'yes', 'force', 'type', 'database-url']) {
      expect(flags[name].dependsOn).toBeUndefined();
    }
  });

  it('defaults --apply off — preview is the only mode a bare run can have', () => {
    expect(flags.apply.default).toBe(false);
    expect(flags.stored.default).toBe(false);
  });
});
