/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8285 — `quickAdd` is RETIRED on `object-kanban`, and the board stops
 * forwarding it (director-seat ruling B, decision batch #91, 2026-09-08:
 * "The board does not grow an inline record-creation write path").
 *
 * ## What this file replaced, and why
 *
 * It was `quickAddIsDiagnosedNotDropped-8285.test.ts`, the pin of the interim
 * html-tier diagnostic. Its row 5 was written as a TRIPWIRE — "red the day
 * option B retires the key" — and it stayed GREEN after that day. objectui
 * resolved `@objectstack/spec` 17.5.0, which tombstones the key, with that row
 * still passing. The reason is in its helper: it collected refused names from
 * `issue.keys`, and zod fills `keys` only on an `unrecognized_keys` issue. A
 * tombstone does not produce one — it declares the key as `never`, so the
 * refusal is an `invalid_type` issue whose PATH names the key and whose `keys`
 * is absent. The helper therefore read `[]` for a refused `quickAdd` whether
 * the spec published the key or retired it, and its control (`bogusProp`,
 * which IS an `unrecognized_keys` issue) could not fail for that reason. The
 * helper below reads both shapes, and its controls cover both.
 *
 * ## Which rows are readings, and of what
 *
 *   1. THE CUT — through the real registry, `SchemaRenderer` and the real board,
 *      an `object-kanban` document carrying BOTH halves of the pair (an
 *      authored `quickAdd: true` and a host-supplied `onQuickAdd` function —
 *      the one combination that used to draw the control) renders no Quick Add
 *      control. Red before the change: that document drew one per lane.
 *   2. THE PAIR THAT STAYS — `KanbanRenderer` mounted directly by a host, the
 *      same two keys: the control renders and a submitted title reaches the
 *      host's function. This is the same instrument finding the control, so
 *      row 1's absence is a reading, and it is the ruling's "`kanban-ui` keeps
 *      the pair" held on the component that pair now lives on.
 *   3. THE SPEC — the installed `@objectstack/spec` refuses `quickAdd` on
 *      `object-kanban` BY NAME, with a live key accepted and an unknown key
 *      refused on the same call. It reddens if the reversal path (a named
 *      consumer reopening option A) ever puts the key back.
 *   4. THE HTML TIER — on a manifest built from the live registry, the tier
 *      answers `unknown-prop`: the interim `inert-quick-add` is gone, and "has
 *      no prop quickAdd" is now true on every face. The rule over a fixture
 *      manifest is `packages/sdui-parser/src/__tests__/kanban-quick-add-8285.test.ts`.
 *   5. THE REGISTRATION does not declare the key, and the one tag this renderer
 *      is registered under is the one the cut covers.
 *
 * ⭐ objectui#11234 retired the OTHER half, `onQuickAdd`, on `object-kanban`,
 * and moved the cut rows 1 and 2 read. `ObjectKanban` used to write
 * `quickAdd: undefined` onto the schema it handed `KanbanRenderer`. It now
 * renders the internal `KanbanBoardCore`, which takes the pair only as
 * explicit props, and passes neither. Rows 1 and 2 are unchanged, and they are
 * that card's end-to-end pins as well: row 1 is the `object-kanban` node that
 * draws no control, and row 2 is the host pair on `KanbanRenderer` that still
 * draws and calls. Which half reaches the board is measured per key in
 * `handlerKeyDispositionsMeasured-7804.test.tsx`.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
import { KanbanRenderer, ObjectKanbanRenderer } from '../index';
// Pay the board's lazy chunk at import time; the specifier must stay
// byte-identical to `../index`'s so its own `React.lazy` factory resolves at once.
import '../KanbanImpl';

const INDEX_TSX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx');

const COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'doing', title: 'Doing' },
];
const DATA = [
  { id: 'r1', title: 'Alpha', status: 'todo' },
  { id: 'r2', title: 'Beta', status: 'doing' },
];
/** The accessible name of the Quick Add button (`kanban.addCard`'s English fallback). */
const ADD_CARD = 'Add card';

/** Every key `index.tsx` registers `ObjectKanbanRenderer` under. */
const registeredKeys = (): string[] => {
  const re = /ComponentRegistry\.register\(\s*'([^']+)'\s*,\s*ObjectKanbanRenderer\b/g;
  return [...readFileSync(INDEX_TSX, 'utf8').matchAll(re)].map((m) => m[1]).sort();
};

/**
 * The top-level key names a strict parse of the block's spec schema refuses BY
 * NAME, in BOTH shapes zod reports it: an `unrecognized_keys` issue lists them
 * in `keys`, while a declared-`never` tombstone reports `invalid_type` at a
 * path that IS the key. Reading only the first shape is how the old tripwire
 * stayed green over a retired key.
 */
const refusedByName = (props: Record<string, unknown>): string[] => {
  const parsed = (ComponentPropsMap as Record<string, any>)['object-kanban'].safeParse(props);
  if (parsed.success) return [];
  return parsed.error.issues.flatMap((issue: any) =>
    issue.code === 'unrecognized_keys' ? (issue.keys ?? []) : issue.path.length === 1 ? [String(issue.path[0])] : [],
  );
};

/** A manifest built from the live registry, the way the page compiler builds its own. */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Diagnostic codes a one-node page draws that NAME the given prop. */
const codesFor = (props: Record<string, unknown>, key: string): string[] =>
  validateTree({ type: 'object-kanban', objectName: 'task', ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.message.includes(`"${key}"`))
    .map((d) => d.code);

describe('objectui#8285 — `object-kanban` no longer forwards `quickAdd`', () => {
  it('row 1 — the real registered board draws NO Quick Add control, even with both halves supplied', async () => {
    const onQuickAdd = vi.fn();
    render(
      <SchemaRendererProvider dataSource={undefined}>
        <SchemaRenderer
          schema={
            {
              type: 'object-kanban',
              groupBy: 'status',
              cardTitle: 'title',
              columns: COLUMNS,
              data: DATA,
              quickAdd: true,
              onQuickAdd,
            } as never
          }
        />
      </SchemaRendererProvider>,
    );
    // The board is on screen, lanes and cards both, so the absence below is
    // not "nothing rendered".
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'To Do cards' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: ADD_CARD })).toHaveLength(0);
    expect(onQuickAdd).not.toHaveBeenCalled();
  });

  it('row 2 — `KanbanRenderer` mounted by a host keeps the pair: the control renders and calls the host', async () => {
    const onQuickAdd = vi.fn();
    render(
      <KanbanRenderer
        schema={{
          type: 'object-kanban',
          groupBy: 'status',
          columns: COLUMNS,
          data: DATA,
          quickAdd: true,
          onQuickAdd,
        }}
      />,
    );
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    // One control per lane — the same query that finds none in row 1.
    expect(screen.getAllByRole('button', { name: ADD_CARD })).toHaveLength(COLUMNS.length);

    const doing = screen.getByRole('group', { name: 'Doing' });
    act(() => {
      within(doing).getByRole('button', { name: ADD_CARD }).click();
    });
    const input = await within(doing).findByRole('textbox');
    fireEvent.change(input, { target: { value: 'Gamma' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickAdd).toHaveBeenCalledWith('doing', 'Gamma');
  });

  it('row 3 — the installed spec refuses `quickAdd` on `object-kanban` BY NAME', () => {
    expect(refusedByName({ objectName: 'task', quickAdd: true })).toContain('quickAdd');
    // Controls for both issue shapes the helper reads, on the same schema: an
    // unknown key is refused through `keys`, a live key is accepted outright.
    expect(refusedByName({ objectName: 'task', bogusProp: 'x' })).toContain('bogusProp');
    expect(refusedByName({ objectName: 'task', groupBy: 'status' })).toEqual([]);
  });

  it('row 4 — the html tier answers `unknown-prop` from the live registry; the interim warning is gone', () => {
    expect(codesFor({ quickAdd: true }, 'quickAdd')).toEqual(['unknown-prop']);
    // Non-vacuity: the live manifest resolves the block and walks its props,
    // so a declared key draws nothing and an undeclared one is reported.
    expect(codesFor({ groupBy: 'status' }, 'groupBy')).toEqual([]);
    expect(codesFor({ bogusProp: 'x' }, 'bogusProp')).toEqual(['unknown-prop']);
  });

  it('row 5 — the registration does not declare the key, and serves exactly the one tag the cut covers', () => {
    const declared = ((ComponentRegistry.getConfig('object-kanban', 'plugin-kanban') as any)?.inputs ?? []).map(
      (i: any) => i.name,
    );
    // Non-vacuity: an empty read (wrong type or namespace) would satisfy the
    // `not.toContain` below for the wrong reason.
    expect(declared).toContain('objectName');
    expect(declared).not.toContain('quickAdd');

    expect(registeredKeys()).toEqual(['object-kanban']);
    expect(ComponentRegistry.get('object-kanban')).toBe(ObjectKanbanRenderer);
    expect(ComponentRegistry.has('kanban')).toBe(false);
    expect(ComponentRegistry.has('kanban-ui')).toBe(false);
  });
});
