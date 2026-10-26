/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6761 — "is this a real config bag?" is asked in ONE place.
 *
 * ## Why a pin, and why this one is the point of the card
 *
 * The six occurrences this replaced all AGREED. Convergence alone therefore
 * fixes today and not tomorrow: nothing stops a seventh from being written
 * next week, and nothing would report it if it drifted — each spelling is a
 * boolean expression, so a disagreement produces no error, only a different
 * answer on one channel. `hasDeclaredPredicate` (`@object-ui/core`) is the
 * repo's precedent for both halves of that lesson: three spellings with three
 * different scopes, ended by one definition (objectui#3850).
 *
 * ## What it measures
 *
 * Every production source in `packages/react/src` (tests excluded — a test
 * asserting on shapes is not a runtime answer that can drift on a channel),
 * scanned for the `typeof x === 'object'` + `Array.isArray(x)` conjunction on
 * the SAME operand, in either order and either polarity. That is the family
 * every spelling of this question has been written in here — four of them
 * across six occurrences, measured on `b98352a15`. A genuinely novel
 * construction (`Object.prototype.toString.call`, a `constructor` test) would
 * evade it; the job is to make the CHEAP path fail — copying a line that
 * already exists — not to be a theorem about object-ness.
 *
 * ## The allowlist is a decision, not an escape hatch
 *
 * Two entries survive, and they are the SHAPE question asked about a data ROW
 * rather than a config bag: "did a row bind?", whose answer carries its own
 * pinned meaning (binding NOTHING rather than an empty row is what keeps a
 * host-supplied `record` from being shadowed — `usePredicateRecordContext`).
 * If "config bag" ever narrows, those two must not follow. Adding an entry
 * here is how you say a new site asks a different question; importing
 * {@link isConfigBag} is how you say it asks this one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(here, '..');

/** Every production `.ts`/`.tsx` under `packages/react/src`. */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * The conjunction, on one operand, in either operand order. `[\s\S]*?` inside
 * a bounded window rather than `\s*` so a multi-line `&&` chain with a comment
 * between the halves still matches.
 */
const SPELLINGS: RegExp[] = [
  /typeof\s+([A-Za-z_$][\w$.]*)\s*[!=]==\s*['"]object['"]\s*(?:&&|\|\|)\s*!?\s*Array\.isArray\(\s*\1\s*\)/g,
  /!?\s*Array\.isArray\(\s*([A-Za-z_$][\w$.]*)\s*\)\s*(?:&&|\|\|)\s*typeof\s+\1\s*[!=]==\s*['"]object['"]/g,
];

/** `<path relative to packages/react/src>: <matched text, whitespace collapsed>` */
function findSpellings(): string[] {
  const found: string[] = [];
  for (const file of collectSources(SRC_ROOT).sort()) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of SPELLINGS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
        found.push(`${rel}: ${match[0].replace(/\s+/g, ' ')}`);
      }
    }
  }
  return found.sort();
}

/**
 * The definition, plus the two ROW sites. Every entry names the question it
 * answers; a new line here without one is the drift this file exists to stop.
 */
const ALLOWED = [
  // THE definition. Everything asking "is this a config bag?" reads this.
  "utils/configBag.ts: typeof value === 'object' && !Array.isArray(value)",
  // A data ROW, not a config bag: whether the node's bound record is a row to
  // put in the evaluator scope at all (binding `{}` would SHADOW a
  // host-supplied `record`).
  "SchemaRenderer.tsx: typeof boundRecord === 'object' && !Array.isArray(boundRecord)",
  // The same row question, one layer down — `usePredicateRecordContext`'s
  // "no row → bind NOTHING" rule.
  "hooks/useExpression.ts: typeof record !== 'object' || Array.isArray(record)",
].sort();

describe('objectui#6761 — one config-bag predicate', () => {
  it('has no spelling outside the definition and the two row sites', () => {
    expect(findSpellings()).toEqual(ALLOWED);
  });

  it('is read by every module that asks the question', () => {
    for (const rel of [
      'SchemaRenderer.tsx',
      'utils/propsBagDiagnostic.ts',
      'utils/unevaluatedExpression.ts',
    ]) {
      const source = readFileSync(path.resolve(SRC_ROOT, rel), 'utf8');
      expect(source, `${rel} no longer imports the shared predicate`).toMatch(
        /import \{ isConfigBag \} from '\.(?:\/utils)?\/configBag\.js';/
      );
    }
  });
});
