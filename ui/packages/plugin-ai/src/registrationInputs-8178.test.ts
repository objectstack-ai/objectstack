/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every designer input the three AI registrations advertise names a key the
 * component beneath it actually reads (objectui#8178, ADR-0049, director
 * decision batch #78, 2026-09-07).
 *
 * ## What this closes
 *
 * The finding's sharpest half was not the declaration — it was the PUSH. Seven
 * `inputs` entries across the three registrations (five distinct names:
 * `formId`, `objectName`, `fields`, `autoFill`, `maxResults`) offered keys the
 * renderers never read, so the field designer put them in a list for an author
 * to pick, the JSON validated, and the runtime dropped the value in silence. An
 * author who chose `maxResults: 5` against a fifty-item list got fifty rows and
 * no diagnostic.
 *
 * ## Two assertions, and why the second one exists
 *
 * The absence pin alone would go green if the whole registration disappeared,
 * and it says nothing about the NEXT key someone adds. So the second block
 * derives the property the retirement was really about — a declared input names
 * a key its component reads — from the component sources themselves, with a
 * name no component reads as the control that the derivation is a real reading.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import './index';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

/**
 * This file is `.test.ts` (the node project) rather than `.test.tsx`, on
 * purpose: it reads sibling sources off disk, and under the happy-dom project
 * `import.meta.url` is not a `file:` URL — `new URL('./x', import.meta.url)`
 * resolves against the document base and the read fails. The behavioural half
 * of this card's third pin, which needs a DOM, is
 * `AIRecommendations.rendersEveryItem-8178.test.tsx`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The seven entries this card removed, by registration. */
const RETIRED: Record<string, readonly string[]> = {
  'ai-form-assist': ['formId', 'objectName', 'fields', 'autoFill'],
  'ai-recommendations': ['objectName', 'maxResults'],
  'nl-query': ['objectName'],
};

/** The component each registration renders, for the read census below. */
const SOURCE: Record<string, string> = {
  'ai-form-assist': 'AIFormAssist.tsx',
  'ai-recommendations': 'AIRecommendations.tsx',
  'nl-query': 'NLQueryInput.tsx',
};

const inputNamesOf = (type: string): string[] =>
  (ComponentRegistry.getMeta(type)?.inputs ?? []).map((input) => input.name);

/**
 * The component's CODE, with comments stripped.
 *
 * Load-bearing: each of these files now names the retired keys in its docblock,
 * on purpose — that is where the retirement is explained to the next reader.
 * A census over raw source would read those sentences as reads and report the
 * exact opposite of the truth.
 */
const readSource = (file: string): string => readFileSync(join(HERE, file), 'utf8');

const stripComments = (src: string): string =>
  mask(src);

const codeOf = (type: string): string => stripComments(readSource(SOURCE[type]));

describe.each(Object.keys(RETIRED))('`%s` no longer advertises its retired keys', (type) => {
  it('offers none of them to the designer', () => {
    const names = inputNamesOf(type);
    // Lit control FIRST: an empty list would satisfy the absence check below
    // for the wrong reason — a registration that failed to load reads as clean.
    expect(names.length, `\`${type}\` declares no inputs at all — the reading is vacuous`)
      .toBeGreaterThan(0);
    expect(names).toEqual(expect.not.arrayContaining([...RETIRED[type]]));
  });

  it('still offers exactly the keys its component reads — the census, not a snapshot', () => {
    const src = codeOf(type);
    const undeclared = inputNamesOf(type).filter((name) => !new RegExp(`\\b${name}\\b`).test(src));
    expect(undeclared, `advertised to the designer but unread by ${SOURCE[type]}`).toEqual([]);
  });

  it('CONTROL — the same instrument reports an unread name as unread', () => {
    // Without this, the census above would pass on a matcher that matches
    // everything (a source that failed to read, a stripper that ate the code).
    const src = codeOf(type);
    expect(new RegExp('\\bbogusUnreadKey\\b').test(src)).toBe(false);
    // …and it still sees the code: a key the component DOES read is found.
    const live = inputNamesOf(type)[0];
    expect(new RegExp(`\\b${live}\\b`).test(src), `the stripped code lost \`${live}\``).toBe(true);
    for (const retired of RETIRED[type]) {
      // …and every key this card retired is genuinely absent from the source
      // too, `autoFill`'s dead destructure included. This is the read half of
      // the retirement, measured rather than assumed.
      expect(new RegExp(`\\b${retired}\\b`).test(src), `${retired} still appears in ${SOURCE[type]}`)
        .toBe(false);
    }
  });
});

describe('the registrations themselves are intact', () => {
  it('registers all three components with their labels', () => {
    expect(Object.keys(RETIRED).map((type) => ComponentRegistry.getMeta(type)?.label)).toEqual([
      'AI Form Assist',
      'AI Recommendations',
      'Natural Language Query',
    ]);
  });

  it('keeps the live inputs each designer needs', () => {
    expect(inputNamesOf('ai-form-assist')).toEqual([
      'suggestions',
      'showConfidence',
      'showReasoning',
    ]);
    expect(inputNamesOf('ai-recommendations')).toEqual([
      'recommendations',
      'showScores',
      'layout',
      'emptyMessage',
    ]);
    expect(inputNamesOf('nl-query')).toEqual(['placeholder', 'suggestions', 'showHistory']);
  });
});

describe('`AIRecommendations` states what it does instead of promising a cap', () => {
  // The behavioural half — fifty items in, fifty rendered, both layouts — is
  // pinned next door in `AIRecommendations.rendersEveryItem-8178.test.tsx`.
  // This half is the sentence, and both are owed: a contributor who implements
  // a cap breaks that file, one who deletes the sentence breaks this one.
  const source = readSource('AIRecommendations.tsx');
  const docblock =
    /\/\*\*[\s\S]*?\*\/\s*export const AIRecommendations/.exec(source)?.[0] ?? '';

  it('found the component docblock — the lit control for the reads below', () => {
    expect(docblock).toContain('AIRecommendations - AI-powered recommendation component');
  });

  it('says every item is rendered, and that there is no cap', () => {
    expect(docblock).toContain('Renders EVERY item');
    expect(docblock).toContain('There is no cap');
  });

  it('carries no surviving cap in the code', () => {
    const code = stripComments(source);
    expect(/\bmaxResults\b/.test(code)).toBe(false);
    expect(/\.slice\(/.test(code)).toBe(false);
    // Lit control: the stripper left the code intact.
    expect(/\brecommendations\b/.test(code)).toBe(true);
  });
});
