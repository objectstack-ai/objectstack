// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A verified build's provenance names the card file it was verified against
 * (`builds/F.provenance.json` `cardSha256`, `docs/qa/scenarios/README.md`
 * Verified builds); `run --template F` warns when it names another card file
 * than the one the run grades (`templateProvenanceWarning`, `src/runner/cli.ts`).
 * The committed fixtures are read too: a card edit that does not refresh its
 * build's provenance fails here, in the PR that made it.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadScenarioFile, readCapabilityAreas } from '../../src/index.js';
import { loadedCardStamp, templateProvenancePath, templateProvenanceWarning } from '../../src/runner/cli.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CARDS = resolve(HERE, '../../../../../docs/qa/scenarios');
const BUILDS = join(CARDS, 'builds');
const AREAS = readCapabilityAreas(resolve(HERE, '../../../../../docs/qa/platform-checklist/areas'));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const card = { id: 'travel_expense', sha256: A };
const reading = (text: string | undefined) => () => text;

describe('templateProvenanceWarning — run --template F against a card', () => {
  it('reads the provenance beside the template', () => {
    expect(templateProvenancePath('docs/qa/scenarios/builds/travel_expense.json')).toBe('docs/qa/scenarios/builds/travel_expense.provenance.json');
  });

  it('says nothing when the provenance names the card file the run grades', () => {
    expect(templateProvenanceWarning('t.json', card, reading(JSON.stringify({ card: 'travel_expense', cardSha256: A })))).toBeUndefined();
  });

  it('warns, naming both hashes, when the provenance names another card file', () => {
    const line = templateProvenanceWarning('t.json', card, reading(JSON.stringify({ card: 'travel_expense', cardSha256: B })));
    expect(line).toBeDefined();
    expect(line).toContain('t.provenance.json');
    expect(line).toContain(A.slice(0, 12));
    expect(line).toContain(B.slice(0, 12));
  });

  it('warns when the provenance is unreadable as JSON or names no card hash', () => {
    expect(templateProvenanceWarning('t.json', card, reading('{'))).toBeDefined();
    expect(templateProvenanceWarning('t.json', card, reading(JSON.stringify({ card: 'travel_expense' })))).toBeDefined();
  });

  it("says nothing for a template with no provenance, or one verified on another card", () => {
    expect(templateProvenanceWarning('t.json', card, reading(undefined))).toBeUndefined();
    expect(templateProvenanceWarning('t.json', card, reading(JSON.stringify({ card: 'order_to_cash', cardSha256: B })))).toBeUndefined();
  });
});

describe('the committed verified builds (docs/qa/scenarios/builds/)', () => {
  const provenances = readdirSync(BUILDS).filter((f) => f.endsWith('.provenance.json'));

  it('has a provenance for each build', () => {
    expect(provenances.length).toBeGreaterThan(0);
  });

  it.each(provenances)('%s names the card file as the loader reads it, and the build file as it is', (file) => {
    const provenance = JSON.parse(readFileSync(join(BUILDS, file), 'utf8')) as { card: string; cardSha256: string; build: string; sha256: string };
    const { card: loaded, refusals } = loadScenarioFile(join(CARDS, `${provenance.card}.json`), { areas: AREAS, library: 'open' });
    expect(refusals).toEqual([]);
    const stamp = loadedCardStamp(loaded!);
    expect(provenance.cardSha256).toBe(stamp.sha256);
    expect(templateProvenanceWarning(join(BUILDS, provenance.build), stamp)).toBeUndefined();
    expect(provenance.sha256).toBe(createHash('sha256').update(readFileSync(join(BUILDS, provenance.build))).digest('hex'));
  });
});
