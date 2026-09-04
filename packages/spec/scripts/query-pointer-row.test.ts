// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for WHAT the published pointer row for `data/query.zod.ts` names — the
 * query AST, not one sort node.
 *
 * `build-skill-references.ts` describes each source by the module's own doc
 * block (`lib/file-description.ts` selects it: top-level, in the header zone,
 * documenting no symbol). `query.zod.ts` had no block of its own, and
 * `SortNodeSchema`'s block qualified — the file's rationale comments sit
 * between that block and its schema, so nothing attached it to a symbol. Four
 * published indexes (`objectstack-query`, `-data`, `-api`, `-ui`) therefore
 * labelled the file carrying the whole `QueryAST` "Sort Node", and the public
 * reference page `content/docs/references/data/query.mdx` opened on it. The
 * skill tells an agent to Read the source for exact field shapes, so that row
 * cost the one read it exists to route: an agent looking for the query AST
 * skips the only file that has it.
 *
 * No gate could see it. `check:skill-refs` and `check:docs` compare the
 * artifact against the generator, and the generator reproduced the wrong block
 * faithfully — the same blind spot #5059 and #12201 found one layer up, so the
 * answer is the same one: pin the fact the artifact must state, not the
 * pipeline that states it.
 *
 * Two legs, and they fail DIFFERENTLY, which is why both exist. The SOURCE leg
 * reds the moment the file header is deleted or demoted below another block —
 * no regeneration needed. The CORPUS leg stays green through that (it reads
 * checked-in bytes, which only move when someone regenerates) and reds on the
 * state this card actually found: an index regenerated from a file with no
 * header of its own. MEASURED both ways in the fix's reverse verification.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

import { describe, expect, it } from 'vitest';

import { findModuleDocBlock } from './lib/file-description';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SKILLS_DIR = path.resolve(REPO_ROOT, 'skills');
const QUERY_SOURCE = path.resolve(HERE, '../src/data/query.zod.ts');

/**
 * The module's own opening sentence — the one `QueryAST`'s type block already
 * carried further down the file. Spelled out rather than derived from the
 * source: deriving it would re-assert the generator's rule and say nothing
 * about WHICH subject the row names, which is the whole defect.
 */
const QUERY_AST_SENTENCE = 'QueryAST — Abstract Syntax Tree for data queries.';

/** The pointer path the generator writes for this source in every index. */
const POINTER = 'node_modules/@objectstack/spec/src/data/query.zod.ts';

/** First prose line of the block the generator would publish for a source. */
const firstDescriptionLine = (source: string): string | null => {
  const block = findModuleDocBlock(source);
  if (block === null) return null;
  const lines = block
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line && !line.startsWith('@') && !line.startsWith('```'));
  return lines[0] ?? null;
};

describe('data/query.zod.ts — the module block describes the module', () => {
  it('opens on the QueryAST sentence, not on `SortNode`', () => {
    const source = fs.readFileSync(QUERY_SOURCE, 'utf-8');
    expect(firstDescriptionLine(source)).toBe(QUERY_AST_SENTENCE);
  });

  it('still carries `SortNode`s own block — the fix adds a header, it does not move a symbol doc', () => {
    // Passing by deleting the symbol's documentation would satisfy the row and
    // lose what the block says about `direction` vs `order` (#4721).
    expect(fs.readFileSync(QUERY_SOURCE, 'utf-8')).toContain(' * Sort Node');
  });
});

describe('published catalog — every pointer row for the query AST names it', () => {
  /** Every checked-in skill-index row pointing at `data/query.zod.ts`. */
  const publishedRows = (): { file: string; description: string }[] => {
    const rows: { file: string; description: string }[] = [];
    for (const skill of fs.readdirSync(SKILLS_DIR)) {
      const index = path.resolve(SKILLS_DIR, skill, 'references/_index.md');
      if (!fs.existsSync(index)) continue;
      for (const line of fs.readFileSync(index, 'utf-8').split('\n')) {
        const match = /^- `([^`]+)` — (.+)$/.exec(line);
        if (match && match[1] === POINTER) {
          rows.push({ file: path.relative(REPO_ROOT, index), description: match[2].trim() });
        }
      }
    }
    return rows;
  };

  it('finds the rows at all', () => {
    // Nothing parsed means nothing compared, and "no bad row" would read as
    // green — the failure mode this whole file exists to refuse.
    expect(publishedRows().length).toBeGreaterThan(0);
  });

  it('reads the QueryAST sentence on every one of them', () => {
    const offenders = publishedRows()
      .filter((row) => row.description !== QUERY_AST_SENTENCE)
      .map((row) => `${row.file}: ${row.description}`);
    expect(offenders).toEqual([]);
  });
});
