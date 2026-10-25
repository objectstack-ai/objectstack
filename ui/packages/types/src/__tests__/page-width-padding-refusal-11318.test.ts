/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `maxWidth` and `padding` on a `page` NODE are refused at parse, by name and
 * with the door that works, and `content/docs/guide/layout.md` teaches those
 * doors instead (objectui#11318, ADR-0049 enforce-or-remove).
 *
 * ## The defect
 *
 * Both keys are `container` members. The guide taught them on a `page` node, in
 * four fences: `maxWidth` three times and `padding: false` once. `PageNodeSchema`
 * declared neither, so on the tolerant face (`safeValidateSchema`) the fences
 * parsed green with the key kept by `.passthrough()`, and the strict authoring
 * face refused them only as a bare `unrecognized_keys`. `PageRenderer` has no
 * read for either key: its max-width class comes from `pageType` through
 * `getPageMaxWidth`, and its wrapper inset is fixed. An author following the
 * guide got a green validation and an unchanged page.
 *
 * ## The shape
 *
 * The one objectui#7926 (`actions`) and objectui#8871 (`breadcrumbs`) set on
 * this same node: a `retirementTombstone` arm in `zod/layout.zod.ts` and a
 * `?: never` twin in `layout.ts`. No new accepted key — the triage direction
 * on objectui#11318 rules that out — and no `.strict()` node, because
 * `page-app-dashboard-spec-parity.test.ts` pins the envelope open.
 *
 * ## The two halves below
 *
 * The contract half asserts each refusal on BOTH faces, because they are two
 * different doors: `safeValidateSchema` is the tolerant one, and the strict
 * one is what `objectui validate` runs and the doc gates are ruled to run. The guide half runs every
 * `type: "page"` JSON fence in the guide through both faces, so a corrected
 * snippet that only one face accepts goes red here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PageNodeSchema } from '../zod/layout.zod.js';
import { safeValidateSchema, StrictAnyComponentSchema } from '../zod/index.zod.js';
import type { PageNodeSchema as TsPageNodeSchema } from '../layout.js';

const REPO_ROOT = resolve(__dirname, '../../../..');
const GUIDE_PATH = resolve(REPO_ROOT, 'content/docs/guide/layout.md');

interface Issue {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
}

/** Both faces, side by side — the pair the triage direction pins. */
const FACES = {
  tolerant: (doc: unknown) => safeValidateSchema(doc),
  strict: (doc: unknown) => StrictAnyComponentSchema.safeParse(doc),
} as const;

const issuesOf = (r: { success: boolean; error?: { issues: unknown[] } }): Issue[] =>
  r.success ? [] : (r.error!.issues as Issue[]);

/** One case per refused key: the document the guide used to teach, and the remedy it now teaches. */
const CASES = [
  {
    key: 'maxWidth',
    retired: {
      type: 'page',
      title: 'Settings',
      maxWidth: 'lg',
      children: { type: 'form', fields: [] },
    },
    remedy: {
      type: 'page',
      pageType: 'utility',
      title: 'Settings',
      children: { type: 'container', maxWidth: '2xl', children: { type: 'form', fields: [] } },
    },
    // What the message must name: the key, the page's own door, and the container door.
    names: ['maxWidth', 'pageType', 'container', 'children'],
  },
  {
    key: 'padding',
    retired: {
      type: 'page',
      padding: false,
      children: { type: 'container', className: 'p-8', children: [] },
    },
    remedy: {
      type: 'page',
      children: { type: 'container', maxWidth: false, padding: 8, children: [] },
    },
    names: ['padding', 'container', 'children'],
  },
] as const;

describe.each(CASES)('objectui#11318 — the `page` node refuses `$key` (contract half)', (c) => {
  it('the key is DECLARED, which is what makes the refusal loud rather than a strip', () => {
    // An undeclared key on a `.passthrough()` object is kept in silence; a
    // refusal has to be declared. There was nothing to delete.
    expect(Object.keys(PageNodeSchema.shape)).toContain(c.key);
  });

  it.each(Object.keys(FACES) as (keyof typeof FACES)[])(
    'the %s face refuses the retired document AT the key, with the tombstone code',
    (face) => {
      const issue = issuesOf(FACES[face](c.retired)).find((i) => i.path.join('.') === c.key);
      expect(issue).toBeDefined();
      // `retirementTombstone` is a `z.never` arm: the code and path are a bare
      // `z.never()`'s; only the message is customised.
      expect(issue!.code).toBe('invalid_type');
    },
  );

  it.each(Object.keys(FACES) as (keyof typeof FACES)[])(
    'the %s face names the remedy, not just the key',
    (face) => {
      const issues = issuesOf(FACES[face](c.retired));
      const issue = issues.find((i) => i.path.join('.') === c.key);
      expect(issue).toBeDefined();
      // Named subjects, not the sentence (assert the subject, not the copy).
      for (const word of c.names) expect(issue!.message).toContain(word);
      expect(issue!.message).toContain('objectui#11318');
      // Zod's own default for a `never` arm says none of this.
      expect(issue!.message).not.toMatch(/^Invalid input: expected never/);
      // ⭐ The strict face used to answer with a bare `unrecognized_keys`
      // naming the key and no door. That reading must be gone on both faces.
      const bare = issues.filter((i) => i.code === 'unrecognized_keys' && i.keys?.includes(c.key));
      expect(bare).toEqual([]);
    },
  );

  it.each(Object.keys(FACES) as (keyof typeof FACES)[])(
    'POSITIVE CONTROL — the %s face accepts the same document without the key',
    (face) => {
      // Without this leg, a schema that refused EVERY page document would pass
      // the assertions above.
      const { [c.key]: dropped, ...rest } = c.retired as Record<string, unknown>;
      expect(dropped).toBeDefined();
      expect(FACES[face](rest).success).toBe(true);
    },
  );

  it.each(Object.keys(FACES) as (keyof typeof FACES)[])(
    'the remedy the message names parses on the %s face',
    (face) => {
      expect(issuesOf(FACES[face](c.remedy))).toEqual([]);
    },
  );
});

describe('objectui#11318 — the refusals are targeted, and the TypeScript twin agrees', () => {
  it('the node is NOT strict — an unknown renderer prop still passes the tolerant face', () => {
    // The cheap way to refuse two more keys is `.strict()`; the parity ledger
    // pins the envelope open, which is why these are named refusals.
    expect(PageNodeSchema.safeParse({ type: 'page', someRendererProp: 42 }).success).toBe(true);
  });

  it('the TypeScript twin refuses both keys', () => {
    // `?: never` — the pair `zod-mirror-parity.test.ts` compares. Each
    // `@ts-expect-error` IS an assertion: `type-check` fails if the key ever
    // becomes assignable again.
    const page: TsPageNodeSchema = {
      type: 'page',
      title: 'Settings',
      // @ts-expect-error `maxWidth` is refused by name on the page node (objectui#11318)
      maxWidth: 'lg',
      // @ts-expect-error `padding` is refused by name on the page node (objectui#11318)
      padding: false,
    };
    expect(page.type).toBe('page');
  });
});

/** One `json` fence of the guide that carries a `type: "page"` document, with the `###` section it sits in. */
interface PageFence {
  heading: string;
  doc: Record<string, unknown>;
}

function pageFences(src: string): PageFence[] {
  const lines = src.split('\n');
  const out: PageFence[] = [];
  let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{2,3} (.+)$/.exec(lines[i]);
    if (h) {
      heading = h[1];
      continue;
    }
    if (lines[i] !== '```json') continue;
    const end = lines.indexOf('```', i + 1);
    if (end === -1) break;
    let doc: unknown;
    try {
      doc = JSON.parse(lines.slice(i + 1, end).join('\n'));
    } catch {
      doc = undefined;
    }
    if (doc && typeof doc === 'object' && (doc as Record<string, unknown>).type === 'page') {
      out.push({ heading, doc: doc as Record<string, unknown> });
    }
    i = end;
  }
  return out;
}

describe('objectui#11318 — the guide teaches the doors that work', () => {
  const guide = readFileSync(GUIDE_PATH, 'utf8');
  const fences = pageFences(guide);

  it('LIT CONTROL — the guide is readable and its page fences are found', () => {
    // A broken reader would hand every assertion below an empty list.
    expect(guide.length).toBeGreaterThan(1000);
    expect(fences.length).toBeGreaterThan(4);
  });

  it('the four corrected sections each still carry a page fence', () => {
    // The sections that taught the keys, found by heading text rather than by
    // line. A section that loses its fence reddens here instead of shrinking
    // the population below to something vacuous.
    const headings = new Set(fences.map((f) => f.heading));
    for (const heading of [
      'Content Width',
      'Settings Page with Tabs',
      'Page Padding',
      '4. Constrained Width for Forms',
    ]) {
      expect({ heading, present: headings.has(heading) }).toEqual({ heading, present: true });
    }
  });

  it.each(Object.keys(FACES) as (keyof typeof FACES)[])(
    'every page fence in the guide passes the %s face',
    (face) => {
      const failing = fences
        .map((f) => ({ heading: f.heading, issues: issuesOf(FACES[face](f.doc)) }))
        .filter((f) => f.issues.length > 0)
        .map((f) => `${f.heading}: ${f.issues.map((i) => `${i.code} at ${i.path.join('.')}`).join('; ')}`);
      expect(failing).toEqual([]);
    },
  );

  it('no page fence writes `maxWidth` or `padding` on the page node itself', () => {
    // Redundant with the faces while the tombstones stand, and kept for the day
    // one of them is removed: then both faces would accept the key again, and
    // only this read would still say the guide teaches it.
    const offenders = fences
      .filter((f) => 'maxWidth' in f.doc || 'padding' in f.doc)
      .map((f) => f.heading);
    expect(offenders).toEqual([]);
  });

  it('LIT CONTROL — the container door is what the guide teaches instead', () => {
    // The scan above cannot see a fence that stopped teaching width at all; this
    // reads the remedy itself, one level down, where it is a declared member.
    const containerKeys = fences.flatMap((f) => {
      const child = f.doc.children as Record<string, unknown> | undefined;
      return child && child.type === 'container' ? Object.keys(child) : [];
    });
    expect(containerKeys).toContain('maxWidth');
    expect(containerKeys).toContain('padding');
    expect(fences.some((f) => f.doc.pageType === 'utility')).toBe(true);
  });

  it('the Schema API block no longer declares either key on the page shape', () => {
    // That block is a `typescript` fence, a fence language the JSON reader above
    // never visits — the blind spot objectui#8871 recorded for `breadcrumbs`.
    const start = guide.indexOf("  type: 'page',");
    expect(start).toBeGreaterThan(-1);
    const block = guide.slice(start, guide.indexOf('```', start));
    expect(block).toContain('pageType?:');
    expect(block).not.toMatch(/^\s*(maxWidth|padding)\?\s*:/m);
  });

  it('the retirement is EXPLAINED where it was taught, not silently dropped', () => {
    expect(guide).toContain('`maxWidth` on a `page` node is refused by name');
    expect(guide).toContain('`padding` on a `page` node is refused by name');
    expect(guide).toContain('objectui#11318');
  });
});
