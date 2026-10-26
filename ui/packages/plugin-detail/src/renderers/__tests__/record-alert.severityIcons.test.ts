/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLucideIconName, toKebabIconName } from '@object-ui/components';
import { iconNames } from 'lucide-react/dynamic.mjs';

/**
 * objectui#7593 — every `SEVERITY_STYLES` icon must RESOLVE, judged on the
 * surface it actually resolves through.
 *
 * ## The defect this exists to catch
 *
 * `SEVERITY_STYLES.success.icon` was `'CheckCircle2'`. That string reaches
 * `<LazyIcon name={iconName} />`, and `lazy-icon.tsx` degrades an unresolvable
 * name to the `Database` glyph — deliberately, because server-driven schemas
 * reference icons from other libraries and it would rather degrade than throw.
 * Right default for an AUTHORED slot; wrong outcome for a hardcoded platform
 * constant. So every `record-alert` with `severity: 'success'` painted a
 * database icon inside an emerald "success" banner, silently.
 *
 * ## Why nothing caught it, in EITHER direction
 *
 * Two blind spots lined up:
 *
 *  1. The icon gate (`scripts/check-lucide-icon-record-names.mjs`) does not
 *     judge dynamic-surface resolvers — its own verdict line says so:
 *     "dynamic surface N sites, 2025 names, not judged here".
 *  2. The renderer's own suite (`record-alert.test.tsx`) MOCKS `LazyIcon` with
 *     a stub that echoes `name` back as `data-name`. Resolution never happens
 *     there, so its assertion could only restate the literal — and it did,
 *     pinning the dead spelling as if it were correct.
 *
 * This file is the half that neither of those can be: it consults the REAL
 * resolver, so it fails when a name stops resolving. It deliberately does not
 * assert that any icon is spelled `'circle-check'`; an assertion like that
 * would only restate the diff and would go green again the next time a dead
 * name is copied in.
 *
 * ## Which surface decides — measured, not remembered
 *
 * `lucide-react@1.31.0`, measured 2026-09-04: the `icons` RECORD holds 1767
 * keys, the DYNAMIC surface (`iconNames`) holds 2025. They disagree, and this
 * file resolves through the dynamic one via `isLucideIconName`.
 *
 *     name            icons record   iconNames    renders?
 *     Info            present        present      yes
 *     AlertTriangle   ABSENT         present      yes
 *     AlertCircle     ABSENT         present      yes
 *     CheckCircle2    ABSENT         ABSENT       NO -> Database glyph
 *
 * That middle pair is why the surface choice is load-bearing rather than
 * pedantic: a pin written against the `icons` record would fail three names
 * that render perfectly well and look thorough while being wrong. Only
 * `CheckCircle2` was dead on the surface that decides, and only it was a
 * defect.
 *
 * ⚠ The last row of that table is a READING TAKEN ON 2026-09-04 and it has
 * since moved — objectui#9414, not a lucide release. `iconNames` always held
 * `check-circle-2`; what could not reach it was the SEAM's tokeniser, which had
 * no `letter -> digit` boundary, so `CheckCircle2` became `check-circle2`. The
 * row is left standing because it is what made the defect legible, and the
 * control at the bottom of this file is where the move is recorded. ⛔ Do not
 * read the row as live — the instrument is `isLucideIconName`, not this table
 * (AGENTS.md #9).
 *
 * ## Why the table is read from source instead of imported
 *
 * `SEVERITY_STYLES` is module-local and stays that way — this is a behaviour
 * fix, not a change to what the package publishes. Re-declaring the table here
 * would put a second copy in the test, which can drift from the one under test
 * and go on passing while it does. Reading the shipped source keeps one copy.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.resolve(HERE, '../record-alert.tsx');
const SRC = fs.readFileSync(RENDERER, 'utf8');

/**
 * The declared severity vocabulary, read from the renderer's own union type.
 * Throws rather than returning empty: a silent miss here would make the
 * coverage assertion below vacuous, and a loud module-load failure is the one
 * outcome a pin may never trade for a quiet pass.
 */
function severityVocabulary(): string[] {
  const m = SRC.match(/type Severity\s*=\s*([^;]+);/);
  if (!m) throw new Error(`could not find the \`Severity\` union in ${RENDERER}`);
  const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (names.length === 0) throw new Error(`\`Severity\` union parsed to nothing in ${RENDERER}`);
  return names;
}

/** The `severity -> icon` literals, read from the shipped `SEVERITY_STYLES`. */
function severityIcons(): Array<{ severity: string; icon: string }> {
  const start = SRC.indexOf('const SEVERITY_STYLES');
  if (start < 0) throw new Error(`could not find \`SEVERITY_STYLES\` in ${RENDERER}`);
  // Slice from the initialiser, so the `Record<Severity, { … }>` annotation's
  // own braces cannot be mistaken for a table row.
  const open = SRC.indexOf('= {', start);
  const end = SRC.indexOf('\n};', open);
  if (open < 0 || end <= open) {
    throw new Error(`could not delimit the \`SEVERITY_STYLES\` table in ${RENDERER}`);
  }
  const block = SRC.slice(open, end);
  const rows = [...block.matchAll(/(\w+):\s*\{[^}]*?icon:\s*'([^']+)'/g)].map((m) => ({
    severity: m[1],
    icon: m[2],
  }));
  if (rows.length === 0) throw new Error(`\`SEVERITY_STYLES\` parsed to no rows in ${RENDERER}`);
  return rows;
}

const VOCABULARY = severityVocabulary();
const ROWS = severityIcons();

const DYNAMIC_SURFACE = new Set(iconNames as unknown as string[]);

describe('record-alert SEVERITY_STYLES icons resolve (objectui#7593)', () => {
  it('the table is read successfully and covers the whole severity vocabulary', () => {
    // Anti-vacuity. Without this, a regex that silently matched nothing would
    // leave the per-severity cases below registering ZERO tests — a green that
    // means "we checked no icons", which is the failure mode a pin like this
    // dies of.
    expect(ROWS.length).toBeGreaterThan(0);
    expect(ROWS.map((r) => r.severity).sort()).toEqual([...VOCABULARY].sort());
  });

  // One case PER SEVERITY, deliberately. A single loop would collapse to one
  // red the moment any name died, and the useful signal here is WHICH ones did:
  // three of these four names are absent from lucide's `icons` record and still
  // render perfectly, so a pin that reddened all four would look thorough while
  // being wrong about three of them.
  it.each(ROWS)('$severity: `$icon` resolves through the LazyIcon seam', ({ severity, icon }) => {
    // The property under test: NOT "is it spelled X", but "does it resolve".
    expect({ severity, icon, resolves: isLucideIconName(icon) }).toEqual({
      severity,
      icon,
      resolves: true,
    });
  });

  it.each(ROWS)('$severity: `$icon` is on the DYNAMIC surface, the one that decides', ({ severity, icon }) => {
    // `isLucideIconName` is the seam the renderer goes through; this states
    // outright which inventory it reads, so a future change of surface shows up
    // here instead of silently changing what the cases above mean.
    const kebab = toKebabIconName(icon);
    expect({ severity, kebab, onDynamicSurface: DYNAMIC_SURFACE.has(kebab) }).toEqual({
      severity,
      kebab,
      onDynamicSurface: true,
    });
  });

  it('controls — the assertions above can actually fail', () => {
    // LIT: names that must resolve, in both spellings the seam accepts.
    expect(isLucideIconName('circle-check')).toBe(true);
    expect(isLucideIconName('CircleCheck')).toBe(true);

    // The tripwire this file armed FIRED, and this is the look it asked for.
    //
    // It used to read `expect(isLucideIconName('CheckCircle2')).toBe(false)`,
    // with the note: "Should lucide ever add `check-circle2` to the dynamic
    // surface, this line goes red — deliberately, because that would be worth
    // a look." It went red for a cause the note did not anticipate and which
    // is worth exactly the same look: lucide added nothing, and objectui#9414
    // taught the SEAM the `letter -> digit` boundary it never had. The dynamic
    // surface held `check-circle-2` the whole time; `toKebabIconName` produced
    // `check-circle2` and missed it. ⇒ `CheckCircle2` moves from DARK to LIT,
    // and it is a LIT case now rather than a deleted one because the spelling
    // that shipped the defect resolving is the whole outcome of that card.
    expect(isLucideIconName('CheckCircle2')).toBe(true);

    // DARK: names that must NOT resolve. `LucideCheckCircle2` keeps this half
    // of the control on the SAME footing the old line stood on — a live NAMED
    // EXPORT of `lucide-react` that is dead for NAME-BASED lookup, which is the
    // route `SEVERITY_STYLES` takes — so a seam that started accepting
    // anything at all still reds here. ⛔ It is a lucide PREFIX ALIAS, not a
    // canonical key, which is why #9414 did not and must not reach it.
    expect(isLucideIconName('LucideCheckCircle2')).toBe(false);
    expect(isLucideIconName('no-such-glyph-xyz')).toBe(false);
  });
});
