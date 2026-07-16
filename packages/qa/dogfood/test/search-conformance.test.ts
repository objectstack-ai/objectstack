// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0061 §Conformance — the Record-Search Conformance ledger is a CHECKED
// artifact (ADR-0060 `checkLedger`): shared invariants + every enforced row
// must carry an existing proof file. The proof itself
// (`showcase-search.dogfood.test.ts`) asserts the ADR's landing bar over the
// real HTTP API; this test asserts the ledger cannot silently rot (a renamed
// or deleted proof file fails here, closing the declared-but-unenforced loop).

import { describe, expect, it } from 'vitest';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLedger } from '@objectstack/verify';
import { SEARCH_SURFACE } from './search-conformance.ledger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('ADR-0061 record-search conformance ledger', () => {
  it('is sound and every enforced row carries an existing proof', () => {
    const problems = checkLedger(SEARCH_SURFACE, {
      proofRoot: HERE,
      proofRequiredForEnforced: true,
    });
    expect(problems).toEqual([]);
  });

  it('covers the executor surface exactly once', () => {
    const ids = SEARCH_SURFACE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('search-executor');
  });
});
