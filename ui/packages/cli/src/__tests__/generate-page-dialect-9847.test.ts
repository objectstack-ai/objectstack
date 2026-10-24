/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9847 — everything `objectui generate` scaffolds spells its child
 * lists `children`.
 *
 * ## Why this pin exists
 *
 * `generatePage` is a PRODUCER in objectui#7181's sense: it writes a
 * `pages/NAME.json` into a project directory that the user then owns and
 * re-authors. It spelled that file's child list `body`, the dialect
 * objectui#6771 retires — and it is the SEVENTH such producer, the one
 * objectui#7181's table never named. Nothing pinned it, which is exactly how it
 * survived a migration round aimed at its own family.
 *
 * The ordering constraint this protects is the family's own: once the authoring
 * tier teaches `children` only, a scaffolder still emitting `body` produces a
 * project that the very next `objectui validate` rejects — a new user's first
 * two commands contradicting each other.
 *
 * ## The assertions run the GENERATOR, they do not read its source
 *
 * A source-text assertion over this file would be satisfied by a comment
 * mentioning the construct — measured on the sibling family and invisible to
 * the assertion's own result. So every claim here is taken off the bytes a user
 * actually receives: the generator runs into a throwaway directory and the
 * written JSON is parsed back.
 *
 * `process.cwd()` is the only input `generate` takes for its target, and
 * `process.chdir()` throws `ERR_WORKER_UNSUPPORTED_OPERATION` under the `unit`
 * project's `pool: 'threads'`, so the cwd is stubbed for the one call and
 * restored immediately — the lever `app-generator.test.ts` already established
 * in this package.
 *
 * ## The type population is DERIVED, never listed here
 *
 * `generate` names its own types in the line it prints for an unknown one. The
 * sweep reads that line rather than repeating it, so a type added tomorrow is
 * covered today (AGENTS.md #9: point at the instrument that re-derives the
 * list, never write the list down).
 *
 * ⚠️ Stated so the sweep's zero is readable: the population is what `generate`
 * ADVERTISES. A branch of its switch that the printed line does not name is
 * outside this sweep by construction, not measured clean by it.
 *
 * ## Both directions, or the zero means nothing
 *
 * "No node spells `body`" is satisfied by a generator that wrote no nodes, or
 * by a walk that visited no file. Every absence assertion below is therefore
 * preceded by a lit control on the same bytes.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { PageTypeSchema } from '@objectstack/spec/ui';
import { describe, expect, it, vi } from 'vitest';

import { generate } from '../commands/generate.js';

/** The spec's page kinds. `PageTypeSchema` is lazy; `.options` is the member list. */
const PAGE_TYPES: readonly string[] = (PageTypeSchema as unknown as { options: readonly string[] }).options;
/** The kinds that draw the page's own `title`: every member except `record`. */
const DRAWING_PAGE_TYPES = PAGE_TYPES.filter((type) => type !== 'record');
/** A markdown ATX level-1 heading line, which plugin-markdown draws as an `h1`. */
const ATX_H1 = /^#\s/m;

/** Run `body` in a throwaway directory that `generate` sees as its cwd. */
async function generatingInto(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'objectui-generate-9847-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await run(dir);
  } finally {
    cwd.mockRestore();
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every file `generate` left behind, as repo-relative-to-`dir` paths. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
}

interface DialectTally {
  body: number;
  children: number;
  nodes: number;
}

/** Walk any parsed JSON value and tally which child-list key each node uses. */
function tallyDialect(value: unknown, tally: DialectTally): DialectTally {
  if (Array.isArray(value)) {
    value.forEach((entry) => tallyDialect(entry, tally));
    return tally;
  }
  if (!value || typeof value !== 'object') return tally;

  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') tally.nodes += 1;
  if ('body' in node) tally.body += 1;
  if ('children' in node) tally.children += 1;

  Object.values(node).forEach((entry) => tallyDialect(entry, tally));
  return tally;
}

/** Ask `generate` itself which types it offers. */
async function discoverGenerateTypes(): Promise<string[]> {
  const printed: string[] = [];
  const log = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
  // `generate` ends its unknown-type branch with `process.exit(1)`, which would
  // take the worker down with it. Stubbed for the probe only.
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  try {
    await generate('__no_such_type__', 'probe');
  } finally {
    log.mockRestore();
    exit.mockRestore();
  }

  const match = /Available types:\s*(.+)$/m.exec(printed.join('\n'));
  expect(
    match,
    '`generate` no longer prints its type list for an unknown type — this pin can no ' +
      'longer discover the population it is supposed to cover'
  ).not.toBeNull();

  const types = match![1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  expect(types.length, 'no generate types discovered').toBeGreaterThan(0);
  return types;
}

describe('objectui#9847 — `objectui generate` scaffolds the `children` spelling', () => {
  it('`generate page` writes a page whose child list is spelled `children`', async () => {
    await generatingInto(async (dir) => {
      await generate('page', 'Reports');

      const written = join(dir, 'pages', 'reports.json');
      expect(
        existsSync(written),
        `\`generate page\` wrote no pages/reports.json — it left ${JSON.stringify(filesUnder(dir))}`
      ).toBe(true);

      // The whole scaffold, because this file is the user's starting point and
      // every key in it is one they inherit.
      expect(JSON.parse(readFileSync(written, 'utf8'))).toEqual({
        type: 'page',
        pageType: 'app',
        title: 'Reports',
        children: [{ type: 'markdown', content: 'Welcome to Reports' }]
      });
    });
  });

  it('no type `generate` offers scaffolds a `body` child list anywhere', async () => {
    const types = await discoverGenerateTypes();
    const sweep: DialectTally = { body: 0, children: 0, nodes: 0 };

    for (const type of types) {
      await generatingInto(async (dir) => {
        await generate(type, `probe${type}`);

        // Lit control per type: the generator has to have produced SOMETHING,
        // or the absence assertion below holds over an empty directory.
        const files = filesUnder(dir);
        expect(files.length, `\`generate ${type}\` wrote no file at all`).toBeGreaterThan(0);

        const perType: DialectTally = { body: 0, children: 0, nodes: 0 };
        for (const file of files.filter((name) => name.endsWith('.json'))) {
          const text = readFileSync(join(dir, file), 'utf8');
          let parsed: unknown;
          expect(
            () => {
              parsed = JSON.parse(text);
            },
            `\`generate ${type}\` wrote ${file}, which is not parseable JSON — a scaffolded ` +
              'project would not load'
          ).not.toThrow();
          tallyDialect(parsed, perType);
        }

        expect(
          perType.body,
          `\`generate ${type}\` still emits the retired \`body\` child-list dialect`
        ).toBe(0);

        sweep.body += perType.body;
        sweep.children += perType.children;
        sweep.nodes += perType.nodes;
      });
    }

    // Sweep-level lit control. Per-type it would be wrong — `generate plugin`
    // writes TypeScript and no typed node at all — but across the population at
    // least one node, spelling `children`, has to have been visited, or every
    // zero above was taken over nothing.
    expect(sweep.nodes, 'the sweep visited no typed node in any scaffold').toBeGreaterThan(0);
    expect(
      sweep.children,
      'no scaffold spells `children` — every `body` absence above would be vacuous'
    ).toBeGreaterThan(0);
  });
});

// objectui#11450. The shape half of the heading rule. The RENDER half -- the
// page draws exactly one `h1`, with `title`, and draws none without its
// `pageType` -- is asserted on this generator's real output by
// `packages/components/src/__tests__/page-node-headings-drawn-11436.test.tsx`,
// which renders every taught page node. This package's `.test.ts` files run in
// the node-environment `unit` project, which renders nothing.
describe('objectui#11450 — `objectui generate page` scaffolds a page that draws its title', () => {
  it('names a page type that draws `title`, and opens its body with no second h1', async () => {
    await generatingInto(async (dir) => {
      await generate('page', 'Reports');
      const page = JSON.parse(readFileSync(join(dir, 'pages', 'reports.json'), 'utf8'));

      // A page with no `pageType` is a `record` page, which leaves its `h1` to
      // a `page:header` block and never draws `title`. Every other member of
      // the spec's `PageTypeSchema` draws it.
      expect(page.title).toBe('Reports');
      expect(DRAWING_PAGE_TYPES).toContain(page.pageType);

      // The page draws `title` as its one `h1`, so no markdown child may open
      // a `#` (ATX level-1) heading: under plugin-markdown it would draw a
      // second `h1` beneath the first. Lit controls first, so the absence below
      // is read over real markdown with a probe that does match an h1.
      const markdown = (page.children as Array<{ type: string; content?: string }>).filter(
        (node) => node.type === 'markdown'
      );
      expect(markdown.length, '`generate page` wrote no markdown child to read').toBeGreaterThan(0);
      expect(ATX_H1.test('# Welcome to Reports'), 'the ATX h1 probe no longer matches an h1').toBe(true);
      for (const node of markdown) expect(ATX_H1.test(node.content ?? '')).toBe(false);
    });
  });
});
