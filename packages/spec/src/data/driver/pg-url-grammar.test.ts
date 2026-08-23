// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the #11072 grammar-arm seam — the module pair the browser tsup
 * pass swaps (`pg-url-grammar.server` → `pg-url-grammar.browser`).
 *
 * What each half holds:
 *   - the SERVER twin still asks `pg`'s own parser, so the #9091 refusals
 *     `postgres.test.ts` pins keep flowing from the schema (Node behaviour
 *     unchanged is the ruling's pinned requirement);
 *   - the BROWSER twin answers "no findings" for exactly the values the
 *     server twin refuses — the degradation the maintainer's 2026-08-22
 *     ruling (Option A) prescribes. If someone "fixes" the browser twin by
 *     re-adding a parse, the bundle gate refuses the dependency; if someone
 *     makes it throw or refuse instead of degrade, THIS file refuses.
 */

import { describe, expect, it } from 'vitest';

import { pgUrlGrammarFindings as browserFindings } from './pg-url-grammar.browser';
import { pgUrlGrammarFindings as serverFindings } from './pg-url-grammar.server';

/** Values the server twin measurably refuses (#9091's own fixtures). */
const REFUSED_ON_SERVER = [
  // libpq's multi-host form — `pg` throws ERR_INVALID_URL on it.
  'postgresql://h1:5432,h2:5433/mydb',
  // A non-numeric port.
  'postgresql://host:notaport/mydb',
  // A scheme-less non-URL — "parses" only against the placeholder base.
  'host=localhost dbname=mydb',
];

/** Values both twins accept (shapes `pg` genuinely opens). */
const ACCEPTED_EVERYWHERE = [
  'postgresql://localhost:5432/mydb',
  'postgres://user@db.example.com/app?sslmode=require',
];

describe('pg-url-grammar server twin (#9091 arm)', () => {
  it('refuses each measured-bad DSN with the pg-grammar prescription', () => {
    for (const value of REFUSED_ON_SERVER) {
      const findings = serverFindings(value, 'url');
      expect(findings, value).toHaveLength(1);
      expect(findings[0], value).toMatch(/not a (connection )?URL/);
    }
  });

  it('accepts every shape `pg` genuinely opens', () => {
    for (const value of ACCEPTED_EVERYWHERE) {
      expect(serverFindings(value, 'url'), value).toEqual([]);
    }
  });
});

describe('pg-url-grammar browser twin (#11072 degradation)', () => {
  it('answers no findings for the very values the server twin refuses', () => {
    for (const value of [...REFUSED_ON_SERVER, ...ACCEPTED_EVERYWHERE]) {
      expect(browserFindings(value, 'url'), value).toEqual([]);
    }
  });

  it('keeps the shared contract shape: string[] in, never a throw', () => {
    expect(() => browserFindings('', 'url')).not.toThrow();
    expect(browserFindings('', 'url')).toEqual([]);
  });
});
