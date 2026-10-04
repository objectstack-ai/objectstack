// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { isNarrowedRun, narrowedFlagNote, refuseUndeclaredObjects } from './migrate-object-scope.js';

const DECLARED = ['os_site', 'os_account', 'sys_user'];

function refusal(requested: string[] | undefined, declared: string[] = DECLARED) {
  try {
    refuseUndeclaredObjects(requested, declared);
  } catch (error) {
    return error as Error & { code?: string; status?: number; object?: string };
  }
  return null;
}

describe('[#21644] refuseUndeclaredObjects: an unknown --object is refused, never narrowed to nothing', () => {
  it('a misspelled name answers the OBJECT_NOT_FOUND envelope, naming it and the declared objects', () => {
    const error = refusal(['os_sitee']);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('OBJECT_NOT_FOUND');
    expect(error?.status).toBe(404);
    expect(error?.object).toBe('os_sitee');
    expect(error?.message).toContain("'os_sitee'");
    // Every declared object, sorted, so the operator can correct the spelling.
    expect(error?.message).toContain('os_account, os_site, sys_user');
  });

  it('names every unknown name once, and keeps the first on the envelope', () => {
    const error = refusal(['os_site', 'nope', 'also_nope', 'nope']);
    expect(error?.code).toBe('OBJECT_NOT_FOUND');
    expect(error?.object).toBe('nope');
    expect(error?.message).toContain("Objects 'nope', 'also_nope' not found");
    expect(error?.message.match(/'nope'/g)).toHaveLength(1);
  });

  it('a deployment that declares nothing says so', () => {
    expect(refusal(['os_site'], [])?.message).toContain('This deployment declares no object.');
  });

  it('declared names, a full-scope run and an empty list pass', () => {
    expect(refusal(['os_site'])).toBeNull();
    expect(refusal(['os_site', 'sys_user'])).toBeNull();
    expect(refusal(undefined)).toBeNull();
    expect(refusal([])).toBeNull();
  });
});

describe('[#21644] isNarrowedRun: any --object narrows', () => {
  it('a list narrows, even an empty one or one naming every declared object; no list does not', () => {
    expect(isNarrowedRun(['os_site'])).toBe(true);
    expect(isNarrowedRun([...DECLARED])).toBe(true);
    expect(isNarrowedRun([])).toBe(true);
    expect(isNarrowedRun(undefined)).toBe(false);
  });

  it('the note names the objects, whether a flag was skipped, and the full-scope command', () => {
    const applied = narrowedFlagNote('value-shapes', ['os_site'], true);
    expect(applied).toContain('os_site');
    expect(applied).toContain('no deployment flag was recorded');
    expect(applied).toContain('"os migrate value-shapes --apply"');
    expect(narrowedFlagNote('files-to-references', ['os_site'], false)).not.toContain('was recorded');
  });
});
