// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readSpecReleaseChanges } from './spec-release-changes.js';

const dir = mkdtempSync(join(tmpdir(), 'spec-release-changes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let seq = 0;
/** Write a `spec-changes.json` the reader will be pointed at, and return its path. */
function manifest(doc: unknown): string {
  const path = join(dir, `spec-changes-${(seq += 1)}.json`);
  writeFileSync(path, typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  return path;
}

const RELEASE = {
  fromVersion: '17.3.0',
  toVersion: '17.4.0',
  added: [{ surface: './ai: NewThing (const)' }, { surface: './ui: Other (type)' }],
  converted: [{ surface: 's', to: 't', conversionId: 'conv-new', toMajor: 17 }],
  migrated: [],
  removed: [{ surface: './integration: Gone (type)' }],
};

describe('readSpecReleaseChanges (ADR-0087 D4 per-release section)', () => {
  it('reports the installed release delta at package-version resolution', () => {
    const result = readSpecReleaseChanges(manifest({ protocolVersion: '17.0.0', release: RELEASE }));
    expect(result).toMatchObject({
      fromVersion: '17.3.0',
      toVersion: '17.4.0',
      added: 2,
      removed: 1,
      converted: 1,
      migrated: 0,
    });
  });

  it('⛔ reports NOTHING, never zeros, for a manifest with no release section', () => {
    // This is the pre-#17080 artifact, and the whole defect it fixes: a
    // consumer that reads `added: 0` from a release which moved 225 exports
    // concludes the upgrade is safe. Absence must stay distinguishable from a
    // measured empty delta.
    expect(readSpecReleaseChanges(manifest({ protocolVersion: '17.0.0', aggregate: {} }))).toBeNull();
  });

  it('a measured EMPTY delta is reported, with zeros', () => {
    const empty = { ...RELEASE, added: [], converted: [], migrated: [], removed: [] };
    expect(readSpecReleaseChanges(manifest({ release: empty }))).toMatchObject({
      added: 0,
      removed: 0,
      converted: 0,
      migrated: 0,
    });
  });

  it('a half-readable section is no section — never a delta with a hole in it', () => {
    expect(readSpecReleaseChanges(manifest({ release: { ...RELEASE, added: undefined } }))).toBeNull();
    expect(readSpecReleaseChanges(manifest({ release: { ...RELEASE, fromVersion: 17 } }))).toBeNull();
    expect(readSpecReleaseChanges(manifest({ release: { ...RELEASE, removed: 'three' } }))).toBeNull();
  });

  it('an unreadable or absent file is silence, not a throw', () => {
    expect(readSpecReleaseChanges(join(dir, 'does-not-exist.json'))).toBeNull();
    expect(readSpecReleaseChanges(manifest('{ not json'))).toBeNull();
    expect(readSpecReleaseChanges(null)).toBeNull();
  });

  it('names the file it read, so a consumer can read the entries themselves', () => {
    const path = manifest({ release: RELEASE });
    expect(readSpecReleaseChanges(path)?.source).toBe(path);
  });
});
