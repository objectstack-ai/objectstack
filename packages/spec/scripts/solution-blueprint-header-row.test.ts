// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin for WHAT the published pointer row for `ai/solution-blueprint.zod.ts`
 * names — plan-first authoring, not a list of the symbols it happens to export.
 *
 * `build-skill-references.ts` describes each source by the module's own doc
 * block (`lib/file-description.ts` selects it: top-level, in the header zone,
 * documenting no symbol), and falls through to `Exports: …` when no block
 * qualifies. This file HAD its header — ADR-0033 §4, the `apply_blueprint`
 * expansion — but a single blank line was all that separated it from
 * `const SNAKE_CASE`, so TSDoc's own attachment rule made it that regex
 * constant's documentation and the selector disqualified it. The published
 * index therefore stated a true fact ABOUT the file and nothing about its
 * SUBJECT, on the very row whose job is to route an agent to the source for
 * exact field shapes.
 *
 * Same root cause as #14441 pointing the other way: there the wrong block was
 * published, here the right one was suppressed and a machine-generated list
 * took its place. Both are the header-zone selector deciding against a header
 * a human wrote — and in this direction the selector was RIGHT under its own
 * rule, so the repair is in the source, not in the selector.
 *
 * No generator can see this class. `check:skill-refs` and `check:docs` compare
 * the artifact against the generator, and the generator reproduced the
 * selector faithfully — a generator-only check PASSES on the defect. So pin
 * the fact the artifact must state, not the pipeline that states it.
 *
 * Two legs that fail DIFFERENTLY, which is why both exist. The SOURCE leg reds
 * the moment the separator between the header and `SNAKE_CASE` is removed —
 * no regeneration needed. The CORPUS leg stays green through that (it reads
 * checked-in bytes, which only move when someone regenerates) and reds on the
 * state this card found: an index regenerated from a file whose header no
 * longer qualifies. MEASURED both ways in the fix's reverse verification.
 */

import fs from 'fs';
import path from 'path';
import url from 'url';

import { describe, expect, it } from 'vitest';

import { findModuleDocBlock } from './lib/file-description';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SKILLS_DIR = path.resolve(REPO_ROOT, 'skills');
const BLUEPRINT_SOURCE = path.resolve(HERE, '../src/ai/solution-blueprint.zod.ts');

/**
 * The module's own opening sentence. Spelled out rather than derived from the
 * source: deriving it would re-assert the generator's rule and say nothing
 * about WHICH subject the row names, which is the whole defect.
 */
const BLUEPRINT_SENTENCE = 'Solution Blueprint Schema (ADR-0033 §4 — plan-first authoring)';

/** The pointer path the generator writes for this source in every index. */
const POINTER = 'node_modules/@objectstack/spec/src/ai/solution-blueprint.zod.ts';

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

describe('ai/solution-blueprint.zod.ts — the module block describes the module', () => {
  it('opens on the plan-first authoring sentence, not on `SNAKE_CASE`', () => {
    const source = fs.readFileSync(BLUEPRINT_SOURCE, 'utf-8');
    expect(firstDescriptionLine(source)).toBe(BLUEPRINT_SENTENCE);
  });

  it('still documents `SNAKE_CASE` — the fix ADDS a symbol doc, it does not delete the header', () => {
    // The cheapest way to satisfy the leg above is to delete the separator's
    // reason for existing. `SNAKE_CASE` is what the header must not be glued
    // to, and what a reader of this file still needs explained.
    const source = fs.readFileSync(BLUEPRINT_SOURCE, 'utf-8');
    const documented = /\/\*\*[^\n]*\*\/\n(?:export )?const SNAKE_CASE\b/.test(source);
    expect(documented).toBe(true);
  });
});

describe('published catalog — every pointer row for the blueprint names its subject', () => {
  /** Every checked-in skill-index row pointing at `ai/solution-blueprint.zod.ts`. */
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

  it('reads the blueprint sentence on every one of them, never the `Exports:` fallback', () => {
    const offenders = publishedRows()
      .filter((row) => row.description !== BLUEPRINT_SENTENCE)
      .map((row) => `${row.file}: ${row.description}`);
    expect(offenders).toEqual([]);
  });
});
