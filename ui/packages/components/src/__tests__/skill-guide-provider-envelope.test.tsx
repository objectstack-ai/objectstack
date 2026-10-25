/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5372 — the published rules told authors the `properties` / `props`
 * envelope belonged to the `element:*` namespace and nowhere else, and that
 * every other key "lives on the node". Half of that is right and the half that
 * is wrong is the half an author hits when wiring a provider to a table.
 *
 * Two envelopes, two fates (`packages/react/src/SchemaRenderer.tsx`, the
 * `evaluatedSchema` memo):
 *
 *   - `props.*`      — evaluated, then spread as React props. A `ui:*` /
 *                      `page:*` renderer reads `schema.*` and never sees it.
 *   - `properties.*` — evaluated, then HOISTED onto the node by the COMPAT
 *                      hoist (`type` / `id` excepted). It therefore lands
 *                      exactly where every renderer reads, in every namespace.
 *   - a node key     — read, and expression-evaluated only if
 *                      `@objectstack/spec` DECLARES it bindable for that
 *                      component type (objectui#4795 Direction 1, ruled
 *                      2026-08-25). Every other node key is read raw.
 *
 * ⚠️ That third line said a flat "read, but never expression-evaluated" when
 * this file was written, and the reading below said so too. objectui#4795
 * closed the gap for the closed set `title` / `label` / `value` /
 * `description`, per the carriage map in
 * `EXPRESSION_BINDABLE_TEXT_KEYS_BY_COMPONENT` — `card` carries `title` and
 * `description`. The rest of this file's measurement is untouched: the two
 * envelope fates above are exactly what #5372 measured, and the card's
 * question ② (whether `properties` is an official `ui:*` authoring channel)
 * is still open and still not answered here.
 *
 * So the one spelling the rules told an author not to reach for was the only
 * one that reaches a provider's data, and the two the rules endorsed both fail
 * in this repo's most expensive shape: a correct header over an empty state,
 * nothing thrown, nothing logged.
 *
 * ⛔ This file pins the MEASUREMENT and the corrected teaching. It takes no
 * position on the two directions the card ruled out of scope — widening
 * node-level evaluation, and giving `data-table` a `bind` read (declined by the
 * objectui#5125 ruling). Whether `properties` should be an official `ui:*`
 * authoring channel is objectui#4795's open question ②; the guides record it
 * rather than recommend it, and nothing here asserts it should be taught.
 *
 * Three halves, same discipline as the sibling `skill-guide-data-table-binding`:
 * a counter-probe so a zero is a reading, doc-sameness against the real
 * published bytes, and behaviour through the REAL renderer.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SchemaRenderer, SchemaRendererProvider, PredicateScopeProvider } from '@object-ui/react';

// The REAL renderers, at module scope so `data-table` / `card` are registered
// before the first render (AGENTS.md §测试纪律). Relative, not the bare
// specifier: this file lives inside `@object-ui/components`
// (`scripts/check-package-self-import.mjs`).
import '../renderers';
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
const skillsRoot = path.join(repoRoot, 'skills/objectui');

// The DECLARED column keys (`TableColumn`: `header` + `accessorKey`). These
// mirror the two published guides' `data-table` example, which is why they
// moved when the guides did: objectui#5120 retired the adapter's undeclared
// `col.name` alias, so the `{ name, label }` spelling this fixture used to
// carry now resolves no accessor and every cell below would read ''. The rows
// keep `name`/`email` as their own DATA keys — that is what `accessorKey`
// points AT, and it is unrelated to the column vocabulary.
const COLUMNS = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Email', accessorKey: 'email' },
];
const ROWS = [
  { name: 'Ada Lovelace', email: 'ada@example.com' },
  { name: 'Grace Hopper', email: 'grace@example.com' },
];
const PROVIDER = { customers: ROWS, label: 'Evaluated Title' };
const EMPTY_STATE = 'No results foundTry adjusting your filters or search query.';

function renderNode(schema: unknown) {
  return render(
    <PredicateScopeProvider scope={{ data: PROVIDER }}>
      <SchemaRendererProvider dataSource={PROVIDER as unknown as DataSource}>
      <SchemaRenderer schema={schema as never} />
    </SchemaRendererProvider>
    </PredicateScopeProvider>,
  );
}

/** Every rendered body cell's text, row-major. */
function bodyCells(): string[] {
  return Array.from(document.querySelectorAll('tbody td')).map((td) => (td.textContent ?? '').trim());
}

/** Every published file in the skill package, by repo-relative path. */
function publishedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(repoRoot, full));
    }
  };
  walk(skillsRoot);
  return out.sort();
}

function readSkillFile(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

describe('#5372 behaviour — a provider `dataSource` into a `data-table`', () => {
  it('a node-level `data` expression renders the empty state, silently', () => {
    renderNode({ type: 'data-table', data: '${data.customers}', columns: COLUMNS });

    // The raw `${…}` string is not an array, so DataTableRenderer falls back to
    // EMPTY_ROWS. No throw and no console line is the whole defect.
    expect(bodyCells()).toEqual([EMPTY_STATE]);
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('a `props` envelope renders the empty state — evaluated, then not read', () => {
    renderNode({ type: 'data-table', props: { data: '${data.customers}' }, columns: COLUMNS });

    expect(bodyCells()).toEqual([EMPTY_STATE]);
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
  });

  it('a `properties` envelope puts the provider rows on screen — evaluated, then hoisted', () => {
    renderNode({ type: 'data-table', properties: { data: '${data.customers}' }, columns: COLUMNS });

    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    expect(bodyCells()).toEqual([
      'Ada Lovelace',
      'ada@example.com',
      'Grace Hopper',
      'grace@example.com',
    ]);
  });

  it('the route the guides teach — host-resolved rows on the node — renders', () => {
    renderNode({ type: 'data-table', data: ROWS, columns: COLUMNS });

    expect(bodyCells()).toEqual([
      'Ada Lovelace',
      'ada@example.com',
      'Grace Hopper',
      'grace@example.com',
    ]);
  });
});

describe('#5372 behaviour — the hoist is not `element:*`-only', () => {
  // `card` is a `ui:*` renderer reading `schema.title` (renderers/layout/card.tsx).
  // If the envelope really were an `element:*` exception, the `properties` leg
  // here would render no header. It renders one.
  const header = () => (document.querySelector('[data-obj-type="card"]')?.textContent ?? '').trim();
  const hasHeaderEl = () => !!document.querySelector('[data-obj-type="card"]')?.firstElementChild;

  it('`props.title` on a `ui:*` card renders no header at all', () => {
    renderNode({ type: 'card', props: { title: 'Customer Summary' } });
    expect(hasHeaderEl()).toBe(false);
    expect(header()).toBe('');
  });

  it('`properties.title` on the same card renders the header', () => {
    renderNode({ type: 'card', properties: { title: 'Customer Summary' } });
    expect(header()).toBe('Customer Summary');
  });

  // objectui#4795 Direction 1 flipped this reading. It used to assert the
  // literal `${data.label}` on screen — a node key was read but never
  // evaluated — and that is the defect the 2026-08-25 ruling retired for the
  // spec-DECLARED keys. Kept as a pair so the file still states both halves:
  // a declared key now evaluates, an undeclared one on the same node does not.
  it('a node-level `title` is read AND evaluated — `card` declares it', () => {
    renderNode({ type: 'card', title: '${data.label}' });
    expect(header()).toBe('Evaluated Title');
  });

  it('a node key `card` does NOT declare is still read raw (`value`)', () => {
    renderNode({ type: 'card', title: 'Fixed', value: '${data.label}' });
    expect(header()).toBe('Fixed');
  });

  it('the same expression under `properties` is evaluated AND read', () => {
    renderNode({ type: 'card', properties: { title: '${data.label}' } });
    expect(header()).toBe('Evaluated Title');
  });
});

describe('#5372 doc-sameness — the published rules record what was measured', () => {
  const PROTOCOL = 'skills/objectui/rules/protocol.md';

  it('counter-probe: the rules file is readable and still carries the node rule', () => {
    const md = readSkillFile(PROTOCOL);
    // A known-present term. The assertions below are only readings because
    // this one passes: a moved or renamed file would fail here first.
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain('Rule: Keys Live on the Node');
  });

  it('the retired `element:*`-only claim is gone from the rules', () => {
    const md = readSkillFile(PROTOCOL);
    // The exact sentence the measurement rules false, and the instruction that
    // followed from it.
    expect(md).not.toMatch(/The one exception is the `element:\*` namespace/);
    expect(md).not.toMatch(/do not apply either shape everywhere/);
  });

  it('the rules state the hoist, which is the fact that makes the rest true', () => {
    // Newline-tolerant: the claim is wrapped prose, not a fixed line.
    expect(readSkillFile(PROTOCOL)).toMatch(/hoists every key onto\s+the node/);
  });
});

describe('#5372 class guard — no published skill prescribes a dead envelope', () => {
  it('counter-probe: the published tree is enumerable and non-empty', () => {
    const files = publishedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('skills/objectui/rules/protocol.md');
  });

  it('no guide tells an author to move an expression "instead of" onto `props`', () => {
    // The shape the prose carried in two places with none of the searchable
    // envelope tokens: a Common-Mistakes bullet prescribing the envelope that
    // renders nothing.
    for (const rel of publishedFiles().filter((f) => f.endsWith('.md'))) {
      expect(readSkillFile(rel), `${rel} prescribes the retired \`props.*\` workaround`)
        .not.toMatch(/instead of\s+`props\./);
    }
  });

  it('no published eval REQUIRES a `props.*` spelling in a correct answer', () => {
    // The graded form of the same false rule. `must_contain` is the assertion
    // that decides whether an answer passes, so a `props.` entry there marks
    // the silently-blank spelling as correct.
    const evals = publishedFiles().filter((f) => f.includes('/evals/') && f.endsWith('.json'));
    expect(evals.length).toBeGreaterThan(0);

    let graded = 0;
    for (const rel of evals) {
      const doc = JSON.parse(readSkillFile(rel)) as {
        evals?: { assertions?: { must_contain?: string[] } }[];
      };
      for (const item of doc.evals ?? []) {
        const must = item.assertions?.must_contain ?? [];
        graded += must.length;
        expect(must.filter((t) => /^props\./.test(t)), `${rel} requires a dead \`props.*\` spelling`)
          .toEqual([]);
      }
    }
    // Counter-probe: a per-entry loop over empty assertion lists passes
    // vacuously.
    expect(graded).toBeGreaterThan(0);
  });
});
