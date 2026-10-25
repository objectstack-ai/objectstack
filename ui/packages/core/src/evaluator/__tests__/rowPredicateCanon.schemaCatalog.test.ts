/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5741 — the in-repo authored corpus carries no retired row-predicate
 * spelling (Phase 2 of the objectui#5330 canon; the objectui#5738 sweep, kept).
 *
 * PR #5758 (Phase 0) swept the repo key-agnostically — every string literal
 * carrying a comparison / boolean operator, classified by CEL root with
 * `@objectstack/formula`'s own oracles and by `detectNonCanonicalRowSpelling` —
 * and reported the schema-catalog clean. That sweep was a one-shot. This pin is
 * the part of it that is MECHANICAL: the catalog is JSON, every string in it is
 * authored metadata or display text, and a predicate-shaped string rooted at
 * `data` or at a bare undeclared identifier is exactly the retired spelling an
 * author (or an AI author) would copy from here. The prose corpus (`content/docs`,
 * `apps`, `skills`, package READMEs) is deliberately NOT pinned: there the same
 * scan needs tier judgement — flow-tier conditions, formula-field expressions,
 * view filters, JS expressions in test files — and stays a PR-body reading.
 *
 * Reads are rooted at this file (objectui#7799), never at the cwd, and the
 * corpus is enumerated from disk rather than listed here, so a new catalog
 * document is in scope the day it lands.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCelRootIdentifiers, firstUndeclaredReference } from '@objectstack/formula';
import { detectNonCanonicalRowSpelling } from '../rowPredicateCanon.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..');
const CATALOG = join(REPO_ROOT, 'examples', 'schema-catalog', 'src', 'schemas');

/** A string that could be a predicate at all: it carries an operator. */
const PREDICATE_SHAPED = /(==|!=|<=|>=|<|>|&&|\|\||\bin\b|^!)/;

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(p);
  }
  return out.sort();
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
}

interface Sweep {
  files: number;
  strings: number;
  predicateShaped: number;
  parsedAsCel: number;
  /** `file: "source" → kind`, one per retired spelling found. */
  hits: string[];
}

function sweep(): Sweep {
  const files = jsonFiles(CATALOG);
  const result: Sweep = { files: files.length, strings: 0, predicateShaped: 0, parsedAsCel: 0, hits: [] };
  for (const file of files) {
    const strings: string[] = [];
    collectStrings(JSON.parse(readFileSync(file, 'utf8')), strings);
    result.strings += strings.length;
    for (const source of strings) {
      if (source.length < 3 || !PREDICATE_SHAPED.test(source)) continue;
      result.predicateShaped++;
      const where = `${relative(REPO_ROOT, file)}: ${JSON.stringify(source)}`;
      // Legacy `${…}` strings are not CEL; on a row surface `${data.x}` retired
      // with the CEL spellings (objectui#5741 Q3), so a `data.`-rooted one is a
      // hit by inspection. A bare name inside a template cannot be classified
      // without a JS parser and is left to the CEL arm below.
      if (source.includes('${')) {
        if (/\bdata\./.test(source)) result.hits.push(`${where} → legacy data.*`);
        continue;
      }
      const roots = collectCelRootIdentifiers(source);
      if (!roots || roots.ok !== true) continue; // display text, not a predicate
      result.parsedAsCel++;
      const finding = detectNonCanonicalRowSpelling(source, {}, true);
      if (finding) result.hits.push(`${where} → ${finding.kind}`);
      const bare = firstUndeclaredReference(source);
      if (typeof bare === 'string') result.hits.push(`${where} → bare root ${JSON.stringify(bare)}`);
    }
  }
  return result;
}

describe('[#5741] the schema-catalog corpus carries no retired row-predicate spelling', () => {
  const result = sweep();

  it('reaches the corpus (positive control): hundreds of documents, and real CEL predicates among them', () => {
    // Measured on landing: 432 documents, 7302 strings, 20 predicate-shaped,
    // 5 parsed as CEL (`record.*` and `current_user.*`). A zero below would be
    // a scanner that never arrived, not a clean corpus.
    expect(result.files).toBeGreaterThan(300);
    expect(result.strings).toBeGreaterThan(1000);
    expect(result.parsedAsCel).toBeGreaterThan(0);
  });

  it('finds no `data.*`, no legacy `${data.x}`, and no bare-field predicate-shaped string', () => {
    expect(result.hits).toEqual([]);
  });

  it('control: the same classifier does report the retired spellings, and stands down on the canon', () => {
    expect(detectNonCanonicalRowSpelling("data.status == 'x'", {}, true)?.kind).toBe('metadata-layer-root');
    expect(firstUndeclaredReference("status == 'x'")).toBe('status');
    expect(detectNonCanonicalRowSpelling("record.status == 'x'", {}, true)).toBeNull();
    expect(typeof firstUndeclaredReference("record.status == 'x' && current_user.id == 'u1'")).not.toBe('string');
  });
});
