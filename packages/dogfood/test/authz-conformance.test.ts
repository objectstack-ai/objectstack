// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D10 — the conformance matrix is a CHECKED artifact. These assertions
// make "every authorization primitive is in exactly one honest state, and every
// claimed proof exists" a green CI gate. A new fail-open (enforced row with no
// site/proof) or a deleted proof file breaks the build.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AUTHZ_CONFORMANCE, type AuthzPrimitive } from './authz-conformance.matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALID = new Set(['enforced', 'experimental', 'removed']);

describe('ADR-0056 D10 — authorization conformance matrix', () => {
  it('has no duplicate primitive ids', () => {
    const ids = AUTHZ_CONFORMANCE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every primitive is in exactly one honest state', () => {
    for (const p of AUTHZ_CONFORMANCE) {
      expect(VALID.has(p.state), `${p.id} has invalid state '${p.state}'`).toBe(true);
    }
  });

  it('every ENFORCED primitive declares an enforcement site (no silent claims)', () => {
    const missing = AUTHZ_CONFORMANCE.filter((p) => p.state === 'enforced' && !p.enforcement).map((p) => p.id);
    expect(missing, `enforced primitives missing an enforcement site: ${missing.join(', ')}`).toEqual([]);
  });

  it('every experimental/removed primitive carries a note (honest rationale)', () => {
    const missing = AUTHZ_CONFORMANCE.filter((p) => p.state !== 'enforced' && !p.note).map((p) => p.id);
    expect(missing, `non-enforced primitives missing a note: ${missing.join(', ')}`).toEqual([]);
  });

  it('every referenced dogfood proof FILE EXISTS (the ratchet)', () => {
    const broken: string[] = [];
    for (const p of AUTHZ_CONFORMANCE as AuthzPrimitive[]) {
      if (p.proof && !existsSync(join(HERE, p.proof))) broken.push(`${p.id} → ${p.proof}`);
    }
    expect(broken, `conformance proofs missing on disk: ${broken.join(', ')}`).toEqual([]);
  });

  it('the high-risk owner/derived OWD primitives each carry an end-to-end proof', () => {
    const highRisk = ['owd-private', 'owd-public-read', 'controlled-by-parent', 'anonymous-deny', 'default-profile'];
    for (const id of highRisk) {
      const p = AUTHZ_CONFORMANCE.find((x) => x.id === id);
      expect(p, `missing matrix entry: ${id}`).toBeTruthy();
      expect(p!.proof, `${id} must carry a dogfood proof`).toBeTruthy();
    }
  });
});
