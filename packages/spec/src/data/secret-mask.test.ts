// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7572] The credential read mask's two load-bearing properties, pinned where
 * the mask is now declared: its BYTES and its SPELLING.
 *
 * Hoisting the constant into `spec` removed the drift *between* the two former
 * copies — objectql's `SECRET_MASK` and service-settings' `SETTINGS_SECRET_MASK`
 * are the same declaration now, so they cannot desynchronise. What a single
 * declaration does NOT remove is an edit to that declaration, and this mask has
 * a wider blast radius than its one line suggests: a console renders
 * "configured vs not configured" from it, echoes it back unchanged on save, and
 * both write paths read that echo as "unchanged" (ADR-0100 §B3). Change the
 * bytes and every already-rendered form's echo stops being recognised — it
 * becomes a genuine write of eight bullets over a live credential.
 *
 * So this file keeps its OWN copy of the literal and compares. That restatement
 * is the point: a pin that imported the constant to check the constant would be
 * green by construction. The far-side pins in plugin-audit and driver-memory
 * restate it for the same reason and are deliberately left alone (#7572).
 *
 * The spelling half is not decoration either. #7572 records it as a property to
 * preserve: the mask is written as the literal — not `'•'.repeat(8)`, not
 * an escape — so that someone who greps for the eight bullets a client actually
 * received lands on the declaration. Nothing but a source read can hold that,
 * since every spelling produces the identical value.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { describe, it, expect } from 'vitest';

import { SECRET_MASK } from './secret-mask';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, 'secret-mask.ts');

describe('SECRET_MASK — the credential read mask (ADR-0100 / #7572)', () => {
  it('is exactly eight U+2022 BULLET characters', () => {
    // Restated on purpose — see the module header.
    expect(SECRET_MASK).toBe('••••••••');
    expect([...SECRET_MASK]).toHaveLength(8);
    expect(new Set([...SECRET_MASK].map((c) => c.codePointAt(0)))).toEqual(new Set([0x2022]));
    // No surrogate pairs, so the UTF-16 length matches the code-point count —
    // the property every `value.length === 8` reader downstream relies on.
    expect(SECRET_MASK).toHaveLength(8);
  });

  it('is spelled as the literal in source, so a grep for the mask finds it', () => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    expect(source).toContain("export const SECRET_MASK = '••••••••';");
  });
});
