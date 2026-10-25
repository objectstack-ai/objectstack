/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5126 / objectui#5337 — three published skill guides taught a
 * `data-table` bound with `bind`, and `data-table` reads no such key.
 *
 * `DataTableRenderer` takes its rows from `data: rawData = EMPTY_ROWS` off the
 * node (`renderers/complex/data-table.tsx`); the file contains neither `bind`
 * nor `useDataScope`. Copying the old example therefore produced no error and
 * no warning — a table with a correct-looking header over the "No results
 * found" empty state, which is the hardest failure shape for an AI author to
 * self-check. The guides also asserted a mechanism that belongs to a different
 * component: "the table component calls `useDataScope("customers")`".
 *
 * Direction was settled by objectui#5125 (merged PR #5338): the only
 * bind-reading table renderer was DELETED under enforce-or-remove rather than
 * promoted, so `data-table` does not gain `bind` — the teaching is what
 * changes. Today `useDataScope` is called by `list` and `tree-view` in this
 * package, plus the `object-*` widgets in the plugin packages.
 *
 * Three halves, and the first two are what make the third mean anything:
 *
 *   - COUNTER-PROBE. Each guide is asserted to still contain a `bind` key in a
 *     JSON block at all. Without it, "no `data-table` block carries `bind`"
 *     would also pass against a file whose fences this extractor cannot see,
 *     or one that stopped teaching `bind` altogether. A zero is not a reading
 *     until a known-present term proves the method works.
 *   - DOC-SAMENESS. The pin is on the guide bytes, not on a copy: the blocks
 *     are lifted out of the real files at run time, so re-introducing the
 *     defect in any of the three sites fails here.
 *   - BEHAVIOUR. The blocks the guides now teach are fed to the REAL
 *     `SchemaRenderer` and asserted to put rows on screen, and the retired
 *     `bind` form is fed to the same renderer and asserted to produce the
 *     empty state. The correction is verified against the renderer rather
 *     than against a reading of it.
 *
 * ⚠️ COLUMN SPELLING — this file is NOT spelling-independent, and an earlier
 * revision of this docblock said it was. It claimed the file "pins the BINDING
 * only … nothing below asserts a column key spelling". That was false and was
 * filed as objectui#5479: the BEHAVIOUR assertions below are on rendered CELL
 * TEXT, and a cell only has text when its column's accessor resolves — so they
 * transitively pin the accessor spelling the guides use. A docblock asserting
 * independence over assertions that were not independent is what made
 * objectui#5120's last step invisible when the family was ruled on.
 *
 * Both aliases have since retired — `label` in objectui#5351, `name` in
 * objectui#5120 — and the two guides' `data-table` columns migrated to the
 * declared `{ header, accessorKey }` in the same commit as the `name`
 * retirement, because these blocks are lifted and rendered at run time and
 * would otherwise go blank. That coupling is the point, not a defect: the
 * guides are executable fixtures, so the instruction corpus cannot drift from
 * the runtime without this file going red. Keep it that way — if a future
 * change makes the adapter's accepted key set narrower again, migrate the
 * guides in the SAME commit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from 'jsonc-parser';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';

// The REAL renderers, imported at module scope so `data-table` / `list` are in
// the registry before the first render (AGENTS.md §测试纪律 — never behind a
// lazy boundary inside a bounded window). The relative path is required: this
// file lives INSIDE `@object-ui/components`, and the bare specifier would be a
// package self-import (`scripts/check-package-self-import.mjs`).
import '../renderers';
import { DATA_TABLE_BIND_DIAGNOSTIC_PREFIX } from '../renderers/complex/dataTableBindDiagnostic';
import type { DataSource } from '@object-ui/types';

/**
 * NOTE (objectui#7912): `SchemaRendererProvider.dataSource` — and the context
 * it feeds — declare the published `DataSource` adapter contract. The values
 * this file injects are deliberately NOT adapters —
 * they are the `data` ROOT of the expression scope — the renderer binds
 * `SchemaRendererContext.dataSource` as `data` for every predicate, which is
 * the second meaning this one key carries.
 * Each injection therefore crosses the contract with an explicit
 * `as unknown as DataSource`. Every injected value is byte-for-byte what it
 * was before: this marks the crossing, it changes no assertion.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const GUIDES = {
  'skills/objectui/guides/schema-expressions.md': 'schema-expressions',
  'skills/objectui/rules/protocol.md': 'protocol',
  'skills/objectui/guides/data-integration.md': 'data-integration',
} as const;

const GUIDE_PATHS = Object.keys(GUIDES) as (keyof typeof GUIDES)[];

function readGuide(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

/**
 * Every fenced ```json OR ```jsonc block body in a markdown file, in document
 * order. Both tags are read on purpose: the guides tag their comment-carrying
 * examples ```jsonc, and `parseBlock` below already strips those `//` comments
 * before parsing. Reading only ```json would let a retag silently hide an
 * example from every assertion here — which is a pass, not a failure.
 */
function jsonBlocks(md: string): string[] {
  const out: string[] = [];
  const fence = /```jsonc?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(md)) !== null) out.push(m[1]);
  return out;
}

/**
 * Parse a doc block that may carry comments (the guides annotate their examples
 * inline). Returns undefined for blocks that are illustrative rather than
 * complete (e.g. `"columns": [...]`).
 *
 * objectui#9323 — the comment strip is `jsonc-parser`'s, not a regex private to
 * this file. This tree had already ruled on who answers "is this span a jsonc
 * comment"; `packages/cli/src/commands/check.ts` states the ruling verbatim:
 * "The reader is `jsonc-parser` ... NOT a comment-stripping regex: a `//`
 * inside a string value — say a URL — is not a comment, and a stripper that
 * cannot tell the difference corrupts valid files instead of reading them."
 *
 * The regex this replaced cut every `//` that followed whitespace — including
 * one INSIDE a string value — and left any `//` glued to a non-whitespace byte
 * (`"a": 1,// note`) in place. Both shapes end the same way: `JSON.parse`
 * throws, the `catch` returns `undefined`, and the block leaves this file's
 * population without failing anything. ⚠️ Neither shape is reachable in today's
 * corpus — over the 47 fenced blocks these three guides carry, the old regex
 * and this reader parse all 47 to byte-identical values. This closes a latent
 * hazard; it does not repair a live wrong answer.
 *
 * ⛔ NOT `scripts/js-comment-mask.mjs`. That module answers the same question
 * for JAVASCRIPT and is graded against a JavaScript parser; its narrowness is a
 * decision, not a gap, and aiming it at jsonc would substitute a fresh guess
 * for a graded answer.
 */
function parseBlock(body: string): unknown {
  try {
    return JSON.parse(stripComments(body, ' ')) as unknown;
  } catch {
    return undefined;
  }
}

function blocksOfType(md: string, type: string): Record<string, unknown>[] {
  return jsonBlocks(md)
    .map(parseBlock)
    .filter(
      (node): node is Record<string, unknown> =>
        !!node && typeof node === 'object' && (node as Record<string, unknown>).type === type,
    );
}

/** Every rendered body cell's text, row-major. */
function bodyCells(): string[] {
  return Array.from(document.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/**
 * objectui#6575 — every `[ObjectUI] DataTable bind:` line this render emitted.
 *
 * Filtered by the diagnostic's own prefix rather than by call count: these
 * renders go through the REAL `SchemaRenderer` and the real registry, so an
 * unrelated warning from some other component must not be able to satisfy —
 * or break — an assertion about this one.
 */
function bindWarnings(): string[] {
  const spy = console.warn as unknown as { mock?: { calls: unknown[][] } };
  return (spy.mock?.calls ?? [])
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith(DATA_TABLE_BIND_DIAGNOSTIC_PREFIX));
}

function renderNode(schema: unknown, dataSource: unknown) {
  return render(
    <PredicateScopeProvider scope={(dataSource ?? {}) as Record<string, unknown>}>
      <SchemaRendererProvider dataSource={dataSource as unknown as DataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>
    </PredicateScopeProvider>,
  );
}

describe('skill guides — counter-probe before the zero (#5126)', () => {
  it.each(GUIDE_PATHS)('%s still teaches `bind` in a JSON block', (rel) => {
    const md = readGuide(rel);
    const blocks = jsonBlocks(md);

    // The extractor sees this file at all...
    expect(blocks.length).toBeGreaterThan(0);
    // ...and a `bind` key is present in one of the blocks it sees. This is the
    // known-present term: the "no `data-table` block binds" assertion below is
    // only a reading because this one passes.
    expect(blocks.some((b) => /"bind"\s*:/.test(b))).toBe(true);
  });
});

describe('skill guides — no `data-table` example is bound with `bind` (#5126, #5337)', () => {
  it.each(GUIDE_PATHS)('%s', (rel) => {
    const md = readGuide(rel);
    const offenders = jsonBlocks(md).filter(
      (b) => /"type"\s*:\s*"data-table"/.test(b) && /"bind"\s*:/.test(b),
    );
    expect(offenders).toEqual([]);
  });

  it('no `data-table` example spells a column with the retired `name` (#5120)', () => {
    // objectui#5120 retired `accessorKey: col.accessorKey || col.name` on the
    // adapter. These blocks are RENDERED below, so a guide that regressed to
    // `name` would already fail — but only as "expected [] to equal
    // ['Ada Lovelace', …]", which names neither the key nor the card. This
    // assertion is here to make the failure SAY what broke, and to hold the
    // corpus even if the behaviour legs are ever narrowed.
    for (const rel of GUIDE_PATHS) {
      const md = readGuide(rel);
      for (const node of blocksOfType(md, 'data-table')) {
        const columns = (node.columns ?? []) as Record<string, unknown>[];
        for (const col of columns) {
          expect(
            'name' in col,
            `${rel}: a data-table column spells the retired \`name\`; the declared key is \`accessorKey\` (objectui#5120)`,
          ).toBe(false);
          expect(
            'accessorKey' in col,
            `${rel}: a data-table column is missing the declared \`accessorKey\` (objectui#5120)`,
          ).toBe(true);
        }
      }
    }
  });

  it('no guide claims a table component calls useDataScope', () => {
    for (const rel of GUIDE_PATHS) {
      const md = readGuide(rel);
      // The exact retired sentence and its shape: a `data-table` cannot be the
      // subject of a useDataScope claim, because it never calls it.
      expect(md).not.toMatch(/table component calls\s+`?useDataScope/i);
    }
  });
});

describe('skill guides — the taught `data-table` form renders rows (#5126, #6575)', () => {
  // A decoy dataSource: it holds exactly the path the retired example bound to.
  // Rows appearing while this is in scope proves they came from the node's
  // inline `data`, not from the provider.
  const DECOY = { customers: [{ name: 'Should Not Appear', email: 'decoy@example.com' }] };

  // objectui#6575 added a render-time diagnostic on the ignored `bind`. Both
  // legs below now read it, in opposite directions, off the SAME renders that
  // already pin the behaviour — so "the table is still empty" and "the author
  // is now told why" cannot drift apart into two trees.
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['skills/objectui/guides/schema-expressions.md', 'skills/objectui/guides/data-integration.md'] as const)(
    '%s: the inline-`data` table puts its rows on screen',
    (rel) => {
      const [node, ...extra] = blocksOfType(readGuide(rel), 'data-table');
      expect(node, 'the guide must carry a parseable data-table example').toBeTruthy();
      expect(extra).toEqual([]);

      renderNode(node, DECOY);

      expect(screen.queryByText('No results found')).not.toBeInTheDocument();
      expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument();
      expect(bodyCells()).toEqual([
        'Ada Lovelace',
        'ada@example.com',
        'Grace Hopper',
        'grace@example.com',
      ]);

      // objectui#6575, the SILENT direction. This node carries no `bind`, so
      // the diagnostic must not fire — a warning that fires on every table is
      // worse than no warning at all. The zero is a reading because the
      // sibling test below finds a line through this same helper, on the same
      // channel, one `bind` key apart.
      expect(bindWarnings()).toEqual([]);
    },
  );

  it('the retired `bind` form renders the empty state — the defect this card closes', () => {
    // Same node, `data` swapped for the `bind` the guides used to teach, and a
    // provider that really does hold the array. This is the measurement that
    // rules the old teaching false; it is not a claim about the docs.
    const [taught] = blocksOfType(readGuide('skills/objectui/guides/schema-expressions.md'), 'data-table');
    const { data: _rows, ...withoutData } = taught;
    const bound = { ...withoutData, bind: 'customers' };

    renderNode(bound, { customers: _rows });

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    // One body row, and it is the empty state spanning the table — measured,
    // not assumed: the bound array never reaches the renderer at all.
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(bodyCells()).toEqual(['No results foundTry adjusting your filters or search query.']);

    // objectui#6575 — the trap stops being silent (maintainer ruling
    // 2026-08-27, option A). THIS is the load-bearing half of the update:
    // every assertion above passes identically against the tree before the
    // diagnostic existed, so only the lines below can tell the two apart.
    //
    // Behaviour is unchanged and stays pinned above: the rows still do not
    // arrive. What is new is that the author is told so.
    const warnings = bindWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("`bind: 'customers'` is ignored");
    // The sentence the ruling names, matching what
    // `skills/objectui/rules/protocol.md` already teaches.
    expect(warnings[0]).toContain(
      'data-table does not read `bind`; it reads its rows from the inline `data` array on the node',
    );
    // The consequence, measured rather than asserted: this table really is
    // empty, and the message says so only because of that.
    expect(warnings[0]).toContain('renders its header over an empty body');
    // And the way out.
    expect(warnings[0]).toContain('Put the rows in `data`');
  });
});

describe('skill guides — the taught `bind` form renders bound entries (#5126)', () => {
  it.each(GUIDE_PATHS)('%s: its `list` example renders one entry per bound item', (rel) => {
    // Selected by its bound path, not by document order: these guides carry
    // several `list` examples (the data-as-nodes section adds more).
    const node = blocksOfType(readGuide(rel), 'list').find((n) => n.bind === 'customerNames');
    expect(node, 'the guide must carry a parseable list example bound with `bind`').toBeTruthy();

    renderNode(node, { customerNames: ['Ada Lovelace', 'Grace Hopper'] });

    const items = Array.from(document.querySelectorAll('li')).map((li) => (li.textContent ?? '').trim());
    expect(items).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });
});

/**
 * The guides name seven `object-*` widgets as `bind` readers. That list is a
 * claim about the registry, and a wrong entry there is the same silent failure
 * this card exists to close — an author writes the type, nothing is registered
 * under it, and the red "Unknown component type" box is the *good* case.
 *
 * Caught one on the way in: the widget file is `ObjectPivotTable.tsx`, but the
 * key it registers is `object-pivot`.
 *
 * Granularity: the key must be registered by exactly one package, and that
 * package must read `schema.bind` through `useDataScope`. Package-level rather
 * than file-level on purpose — `object-pivot` and `object-data-table` are
 * registered in their package's `index.tsx` around a component that lives in a
 * sibling file, so a same-file assertion would fail on correct code.
 */
describe('skill guides — the `object-*` reader list is not stale (#5126)', () => {
  const pluginRoots = fs
    .readdirSync(path.join(repoRoot, 'packages'))
    .filter((name) => name.startsWith('plugin-'))
    .map((name) => ({ pkg: name, dir: path.join(repoRoot, 'packages', name, 'src') }))
    .filter(({ dir }) => fs.existsSync(dir));

  function sourceText(dir: string): string {
    let out = '';
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        out += sourceText(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out += fs.readFileSync(full, 'utf8');
      }
    }
    return out;
  }

  const PACKAGE_TEXT = new Map(pluginRoots.map(({ pkg, dir }) => [pkg, sourceText(dir)]));

  it.each([
    'skills/objectui/guides/schema-expressions.md',
    'skills/objectui/guides/data-integration.md',
  ] as const)('%s names only registered widgets that read `bind`', (rel) => {
    const md = readGuide(rel);
    const paragraph = /the plugin packages register \(([^)]*)\)/.exec(md);
    expect(paragraph, 'the guide must carry the reader list this test judges').toBeTruthy();

    const listed = [...paragraph![1].matchAll(/`(object-[a-z-]+)`/g)].map((m) => m[1]);
    // Counter-probe: a per-key loop over an empty list passes vacuously.
    expect(listed.length).toBeGreaterThan(0);

    for (const key of listed) {
      const registrar = new RegExp(`ComponentRegistry\\.register\\(\\s*'${key}'`);
      const owners = [...PACKAGE_TEXT.entries()].filter(([, text]) => registrar.test(text));
      expect(owners.map(([pkg]) => pkg), `\`${key}\` must be registered by exactly one plugin package`).toHaveLength(1);
      expect(owners[0][1], `\`${key}\`'s package must read schema.bind`).toContain('useDataScope(schema.bind)');
    }
  });
});
