// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StandardErrorCode } from './errors.zod';
import { deriveWireFace } from '../../../../scripts/check-error-status-conformance.mjs';

/**
 * ADR-0112 D7 guard: the hand-written error catalog page and the codes that
 * actually exist can never disagree. The page keeps its hand-written Cause/Fix
 * prose (that part cannot be generated), but its entries and the code set are
 * held equal in both directions — the drift #3841 was filed about.
 *
 * ## What this compares against, and why it is no longer the ENUM (#15631)
 *
 * It used to be `StandardErrorCode`, and that premise broke in two places at
 * once:
 *
 *   - **A translated code is not on the wire.** `DuplicateRecordError` declares
 *     `code = 'DUPLICATE_RECORD'`, and the REST door translates that envelope at
 *     the boundary, so every route answers `UNIQUE_VIOLATION` (#14723). The enum
 *     keeps the in-process spelling; the wire never carries it. Demanding a
 *     `### \`DUPLICATE_RECORD\`` heading on a page that documents the wire is
 *     demanding the page publish a code no client can ever receive — which is
 *     this card's original defect, and is refused.
 *   - **A ledger code IS on the wire.** `INVALID_REQUEST` is not an enum member,
 *     yet the catalog publishes two `/meta` entries for it with a `400`. The old
 *     guard's "every heading is an enum member" should have failed on them and
 *     did not: its regex was anchored (`/^### \`CODE\`$/`) and both headings
 *     carry a descriptive suffix. They passed by ACCIDENT, not by design.
 *
 * The maintainer ruling on #15631 (2026-09-07) settles both with one rule: the
 * catalog page catalogs the **wire face**, and the guard compares headings
 * against it in both directions. The wire face is `deriveWireFace()`'s
 * `wireCodes` — the reconciled vocabulary (enum members plus the ledger codes
 * the docs have reached) minus the codes a door translates away.
 *
 * ## Why the derivation is IMPORTED rather than repeated
 *
 * `scripts/check-error-status-conformance.mjs` already derives the translation
 * census from the door's own source, and its header argues at length against the
 * second hand-written copy of a table. A list of translated codes maintained
 * here would be exactly that copy, and would go stale in silence the day a door
 * gains or loses an arm — so the ruling requires this guard to read the set from
 * that one place. Matching headings by that module's `ENTRY_HEADING_SHAPES` (via
 * `catalogEntries`) rather than by a regex of this file's own is the same move,
 * and it is what closes the `INVALID_REQUEST` suffix accident: an unread heading
 * is an UNCHECKED heading.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const page = readFileSync(join(REPO_ROOT, 'content/docs/api/error-catalog.mdx'), 'utf8');
const face = deriveWireFace(REPO_ROOT);

/** The lines of the entry opening at 1-based `line`, up to the next heading. */
function entryBody(line: number): string {
  const lines = page.split('\n');
  const out: string[] = [];
  for (let i = line; i < lines.length && !/^#{1,3}\s/.test(lines[i]); i++) out.push(lines[i]);
  return out.join('\n');
}

const lineOf = (where: string): number => Number(where.slice(where.lastIndexOf(':') + 1));

describe('error-catalog.mdx ↔ the published wire face', () => {
  // The instrument must be SEEING something. Every assertion below is a
  // universal over a derived collection, so all three pass vacuously on a
  // derivation that went blind — a moved anchor in the scanned source, a page
  // whose heading level changed — and a blind run is not a clean one.
  it('the derivation is not empty, and it agrees with the enum it parsed', () => {
    expect(face.catalogEntries.length).toBeGreaterThan(40);
    expect(face.wireCodes.length).toBeGreaterThan(40);
    expect([...face.members].sort()).toEqual([...StandardErrorCode.options].sort());
  });

  it('every catalog heading is a wire code', () => {
    for (const entry of face.catalogEntries) {
      expect(
        face.wireCodes.includes(entry.code),
        `${entry.where}: heading \`${entry.code}\` is not a code this platform puts on the wire`
          + `${face.translatedCodes.has(entry.code)
            ? ` — the door translates it away, so the page must document its WIRE spelling `
              + `(${face.translated.find((t) => t.code === entry.code)?.toCode}) instead and name `
              + `\`${entry.code}\` in that entry's cross-reference sentence`
            : ''}`,
      ).toBe(true);
    }
  });

  it('every wire code has a catalog heading', () => {
    const documented = new Set(face.catalogEntries.map((e) => e.code));
    for (const code of face.wireCodes) {
      expect(documented.has(code), `wire code \`${code}\` has no catalog entry`).toBe(true);
    }
  });

  // The other half of the exemption. A translated member drops out of
  // `wireCodes` and is therefore exempt from the heading demand above — so
  // without this, its in-process spelling could vanish from the page entirely
  // and every assertion here would still pass. The ruling requires it to stay
  // FINDABLE, under the wire code that replaced it.
  it('every translated code is named under its wire code’s entry', () => {
    expect(face.translated.length).toBeGreaterThan(0);
    for (const t of face.translated) {
      const entry = face.catalogEntries.find((e) => e.code === t.toCode);
      expect(
        entry,
        `the door translates \`${t.code}\` to \`${t.toCode}\` (${t.arm}), but the catalog has no `
          + `\`${t.toCode}\` entry to cross-reference it from`,
      ).toBeTruthy();
      expect(
        entryBody(lineOf(entry!.where)).includes(t.code),
        `${entry!.where}: the \`${t.toCode}\` entry does not name \`${t.code}\`. The door translates `
          + `that envelope at the boundary (${t.arm}), so the in-process spelling has no entry of its `
          + `own and this cross-reference is the only place a reader can find it.`,
      ).toBe(true);
    }
  });

  it('the advertised code count matches the wire face', () => {
    const claim = page.match(/\*\*(\d+) error codes reachable on the wire\*\*/);
    expect(claim, 'catalog page no longer states how many wire codes it documents').toBeTruthy();
    expect(Number(claim![1])).toBe(face.wireCodes.length);
  });
});
