// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StandardErrorCode } from './errors.zod';

/**
 * ADR-0112 D7 guard: the hand-written error catalog page and the enum can
 * never disagree about which codes exist. The page keeps its hand-written
 * Cause/Fix prose (that part cannot be generated), but every `### \`CODE\``
 * heading must be a `StandardErrorCode` member and every member must have a
 * heading — the exact drift #3841 was filed about.
 */
describe('error-catalog.mdx ↔ StandardErrorCode', () => {
  const page = readFileSync(
    resolve(__dirname, '../../../../content/docs/api/error-catalog.mdx'),
    'utf8'
  );
  // Only SCREAMING headings are catalog entries — lowercase headings (if any
  // ever appear) would be field-level docs, which live in #3977's catalog.
  const headings = [...page.matchAll(/^### `([A-Z][A-Z0-9_]*)`$/gm)].map(m => m[1]);

  it('every catalog heading is a StandardErrorCode member', () => {
    const members = new Set<string>(StandardErrorCode.options);
    for (const heading of headings) {
      expect(members.has(heading), `docs heading \`${heading}\` is not in StandardErrorCode`).toBe(true);
    }
  });

  it('every StandardErrorCode member has a catalog heading', () => {
    const documented = new Set(headings);
    for (const member of StandardErrorCode.options) {
      expect(documented.has(member), `StandardErrorCode member \`${member}\` has no docs entry`).toBe(true);
    }
  });

  it('the advertised member count matches the enum', () => {
    const claim = page.match(/\*\*(\d+) standardized error codes\*\*/);
    expect(claim, 'catalog page no longer states its member count').toBeTruthy();
    expect(Number(claim![1])).toBe(StandardErrorCode.options.length);
  });
});
