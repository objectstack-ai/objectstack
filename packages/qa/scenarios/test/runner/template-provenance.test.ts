// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A verified build's provenance names the card file it was verified against
 * (`builds/F.provenance.json` `cardSha256`, the scenarios README's Verified
 * builds); `run --template F` warns when it names another card file
 * than the one the run grades (`templateProvenanceWarning`, `src/runner/cli.ts`).
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { templateProvenancePath, templateProvenanceWarning } from '../../src/runner/cli.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const card = { id: 'travel_expense', sha256: A };
const reading = (text: string | undefined) => () => text;

describe('templateProvenanceWarning — run --template F against a card', () => {
  it('reads the provenance beside the template', () => {
    expect(templateProvenancePath('cards/builds/x.json')).toBe('cards/builds/x.provenance.json');
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

  it('reads the provenance file from disk beside the template by default', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scenario-provenance-'));
    const template = join(dir, 'travel_expense.json');
    writeFileSync(template, '{}');
    expect(templateProvenanceWarning(template, card)).toBeUndefined();
    writeFileSync(join(dir, 'travel_expense.provenance.json'), JSON.stringify({ card: 'travel_expense', cardSha256: B }));
    expect(templateProvenanceWarning(template, card)).toContain(B.slice(0, 12));
  });
});
