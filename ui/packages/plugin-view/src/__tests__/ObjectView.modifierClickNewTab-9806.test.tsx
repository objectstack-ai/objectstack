/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9806 (ruling B) — a Cmd/Ctrl/middle-click on an `ObjectView` row
 * opens the record as a full page in a new browser tab, re-derived rather than
 * described.
 *
 * ## How this file got here
 *
 * It began as the pin for a SENTENCE: PR objectui#9797 wrote a comment on
 * `ObjectView`'s `handleRowClick` saying the hook decides modifier clicks when
 * no host handler is present, and the hook never gets to — its `handleClick`
 * returns EARLY on the `onRowClick` it is handed, ahead of its own modifier
 * branch, and `ObjectView` hands `handleRowClick` down UNCONDITIONALLY. The
 * first version of this file pinned the resulting behaviour (a modifier click
 * indistinguishable from a plain one). The ruling on objectui#9806 then chose
 * B: `ObjectView` implements the browser convention itself, inside
 * `handleRowClick`, and the hook's early return STAYS — it is what lets a host
 * handler decide for itself. The subject cases below are the inversion; the
 * two controls are the original ones, kept.
 *
 * ## What is pinned, and why every case fires a PAIR of clicks
 *
 * "A modifier click opens a tab" is not on its own a reading about modifiers:
 * a subject that opened a tab on EVERY click would pass it. So each subject
 * case is read against the plain click on the same harness:
 *
 *  - SUBJECT (`ObjectView`, no host `onRowClick`): a plain click navigates in
 *    place (`onNavigate(id, 'view')`, no tab); a ⌘ / Ctrl / middle click opens
 *    `window.open(URL, '_blank')` and does NOT navigate in place. The URL is the
 *    one `navigation.mode: 'new_window'` already opens — asserted equal to it
 *    in the same run, so the modifier branch cannot grow a second URL shape.
 *    ⛔ `onNavigate` is never called with `'new_window'`: `ObjectViewSchema`
 *    declares that callback's second parameter as `'view' | 'edit'`.
 *  - INERT ROWS stay inert: `navigation.mode: 'none'`, `preventNavigation`,
 *    and `operations: { read: false }` with no navigation config each ignore a
 *    ⌘-click as they ignore a plain one. A modifier changes WHERE a record
 *    opens, never WHETHER it opens.
 *  - HOST HANDLER: a host `onRowClick` receives the ⌘-click, payload intact,
 *    and no tab opens — the host keeps the whole decision (ruling: option C,
 *    inverting the hook, refused for exactly this reason).
 *  - LIVENESS CONTROL (`ObjectGrid`, no `onRowClick` at all): the same harness
 *    reaches the HOOK's modifier branch — `'view'` and `'new_window'` diverge —
 *    so `metaKey` really is delivered by these clicks.
 *  - ISOLATION CONTROL: the SAME `ObjectGrid` call plus one prop — an
 *    unconditional `onRowClick` — and the hook's modifier branch goes quiet.
 *    That is the reason `ObjectView` has to answer the click itself.
 *
 * ⚠️ The liveness control does NOT vary one thing against the subject: it is a
 * different composition and carries `onNavigate` on the grid node, which
 * `ObjectView` does not relay into the grid schema it builds. It answers "is
 * the probe alive", nothing more. The ISOLATION control is the one-variable
 * pair.
 *
 * ## The source-text cases
 *
 * `ObjectView.tsx` DOCUMENTS the constructs asserted on, so its comments are
 * stripped before any code claim is read, and the stripper is controlled in
 * both directions in the same run (a token present raw, absent stripped). A
 * member DECLARATION survives the strip, so the hook's presence leg is keyed on
 * the READ spelling `event.metaKey`, with the declaration's weaker answer
 * pinned beside it.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock, type MockInstance } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectGrid } from '@object-ui/plugin-grid';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource } from '@object-ui/types';

import { ObjectView } from '../ObjectView';
import { installExplainDouble } from './explainDouble';

// `ObjectGrid` batches a record-grained write verdict for the rows on screen.
// With no host `apiFetch` it falls back to the global one, which under
// happy-dom is a REAL socket — the package's own double answers it so an
// escape to any OTHER endpoint stays observable.
//
// `window.open` is spied on in every case — the subject's new-tab destination
// is read off it, and a control that opened a tab would otherwise escape into
// happy-dom unobserved.
let openSpy: MockInstance<typeof window.open>;
beforeEach(() => {
  installExplainDouble();
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
});
afterEach(() => {
  openSpy.mockRestore();
  vi.unstubAllGlobals();
});

const rows = [
  { id: 'r1', name: 'Alice', amount: 100 },
  { id: 'r2', name: 'Bob', amount: 200 },
];

const objectSchema = {
  name: 'test_object',
  label: 'Test object',
  fields: {
    id: { name: 'id', type: 'text', label: 'Id' },
    name: { name: 'name', type: 'text', label: 'Name' },
    amount: { name: 'amount', type: 'number', label: 'Amount' },
  },
};

function makeDataSource(): DataSource {
  return {
    // `{ data, total }`, which is the shape `ObjectGrid` reads (`result.data`).
    // A bare array resolves fine and renders ZERO rows — a silent empty grid,
    // not an error.
    find: vi.fn().mockResolvedValue({ data: rows, total: rows.length }),
    findOne: vi.fn().mockResolvedValue(rows[0]),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  } as unknown as DataSource;
}

/**
 * The one observable both halves share. `onNavigate` is the non-author function
 * slot every navigation destination on this path funnels through, and its
 * SECOND argument is the whole question: `'view'` is navigation in place,
 * `'new_window'` is the hook's modifier branch. Same spy, same shape, so the
 * subject and the control are literally the same assertion pointed at two
 * compositions.
 */
type NavigateSpy = Mock<(recordId: string | number, action: string) => void>;

function navigateActions(spy: NavigateSpy): string[] {
  return spy.mock.calls.map((call) => String(call[1]));
}

/** The row element a user clicks, in either composition. */
async function firstDataRow(container: HTMLElement): Promise<Element> {
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  const row = container.querySelector('tbody tr');
  expect(
    row,
    'no data row rendered — the harness is broken, so nothing below is a reading about clicks',
  ).not.toBeNull();
  return row as Element;
}

/**
 * SUBJECT — the default content branch, which is where an authored
 * `object-view` with no host `renderListView` actually lands. `layout: 'page'`
 * plus `onNavigate` is what makes a plain click observable (`handleView` hands
 * it to `onNavigate(id, 'view')` instead of opening an internal overlay), so
 * the plain/modifier pair is read on one spy and one `window.open` spy.
 * `extra` adds exactly one node key (`navigation` or `operations`) or exactly
 * one prop (`onRowClick`), so each variant differs from the base subject by one
 * thing.
 */
function renderView(
  onNavigate: NavigateSpy,
  extra: {
    navigation?: Record<string, unknown>;
    operations?: Record<string, unknown>;
    onRowClick?: (record: Record<string, unknown>, event?: unknown) => void;
  } = {},
) {
  const dataSource = makeDataSource();
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectView
          schema={{
            type: 'object-view',
            objectName: 'test_object',
            layout: 'page',
            onNavigate,
            table: { columns: ['name', 'amount'] },
            ...(extra.navigation ? { navigation: extra.navigation } : {}),
            ...(extra.operations ? { operations: extra.operations } : {}),
          } as any}
          dataSource={dataSource}
          {...(extra.onRowClick ? { onRowClick: extra.onRowClick } : {})}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** The `[url, target]` pairs every `window.open` call in this case received. */
function openedTabs(): Array<[string, string]> {
  return openSpy.mock.calls.map((call) => [String(call[0]), String(call[1])]);
}

/**
 * CONTROL rig — the same grid the subject renders underneath, reached directly.
 * `onRowClick` is the ONE prop the two control cases differ by, which is what
 * makes the pair an attribution rather than an observation. Inline data keeps
 * the controls independent of the subject's fetch path.
 */
function renderGrid(onNavigate: NavigateSpy, onRowClick?: (...args: any[]) => void) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{
          type: 'object-grid',
          objectName: 'test_object',
          columns: [
            { field: 'name', label: 'Name' },
            { field: 'amount', label: 'Amount', type: 'number' },
          ],
          data: { provider: 'value', items: rows },
          onNavigate,
        } as any}
        {...(onRowClick ? { onRowClick } : {})}
      />
    </ActionProvider>,
  );
}

describe('objectui#9806 — SUBJECT: an ObjectView row with no host handler opens a modifier click in a new tab', () => {
  it('a plain click navigates in place and opens no tab', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate);

    fireEvent.click(await firstDataRow(container));

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(navigateActions(onNavigate)).toEqual(['view']);
    expect(onNavigate.mock.calls[0][0]).toBe('r1');
    expect(openedTabs(), 'a PLAIN click opened a tab — the branch no longer reads the modifier, it fires on every click').toEqual([]);
  });

  it('a ⌘-click DIVERGES — the record opens in a new tab and the view does not navigate in place', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate);

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(
      openedTabs(),
      'a ⌘-click on an ObjectView row with no host `onRowClick` did not open the record in a new tab — the objectui#9806 ruling-B branch in `handleRowClick` is gone',
    ).toEqual([['/test_object/r1', '_blank']]);
    expect(
      navigateActions(onNavigate),
      "the ⌘-click ALSO reached `onNavigate` — either it navigated in place as well as opening a tab, or it passed 'new_window' to a callback declared `'view' | 'edit'`",
    ).toEqual([]);
  });

  it('a Ctrl-click and a middle-click diverge the same way — all three spellings of the payload', async () => {
    for (const modifier of [{ ctrlKey: true }, { button: 1 }]) {
      const onNavigate = vi.fn() as NavigateSpy;
      openSpy.mockClear();
      const { container, unmount } = renderView(onNavigate);

      fireEvent.click(await firstDataRow(container), modifier);

      await waitFor(() => expect(openSpy).toHaveBeenCalled());
      expect(openedTabs(), JSON.stringify(modifier)).toEqual([['/test_object/r1', '_blank']]);
      expect(navigateActions(onNavigate), JSON.stringify(modifier)).toEqual([]);
      unmount();
    }
  });

  it("the tab it opens is the SAME url `navigation.mode: 'new_window'` opens — one new-tab URL per component", async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate, { navigation: { mode: 'new_window' } });

    // A PLAIN click, on purpose: this is the authored new-tab mode, the
    // component's existing route builder, read as the reference.
    fireEvent.click(await firstDataRow(container));

    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openedTabs()).toEqual([['/test_object/r1', '_blank']]);
  });
});

describe('objectui#9806 — BOUNDARIES: a modifier changes WHERE a record opens, never WHETHER, and never over a host', () => {
  it("an inert row (`navigation.mode: 'none'`) stays inert under a ⌘-click", async () => {
    // One node key away from the SUBJECT's ⌘-click case, which opens a tab on
    // this same harness — that case is what makes the silence below a reading.
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate, { navigation: { mode: 'none' } });

    const row = await firstDataRow(container);
    fireEvent.click(row, { metaKey: true });
    fireEvent.click(row, { button: 1 });
    fireEvent.click(row);

    expect(openedTabs(), "`mode: 'none'` rows are documented inert, and a modifier click opened a tab anyway").toEqual([]);
    expect(navigateActions(onNavigate)).toEqual([]);
  });

  it('a row made inert by `navigation.preventNavigation` stays inert under a ⌘-click', async () => {
    // Same harness as the SUBJECT ⌘-click case, one node key added.
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate, { navigation: { preventNavigation: true } });

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    expect(openedTabs(), '`preventNavigation` rows are documented inert, and a ⌘-click opened a tab anyway').toEqual([]);
    expect(navigateActions(onNavigate)).toEqual([]);
  });

  it('with no navigation config, `operations: { read: false }` keeps the row inert under a ⌘-click', async () => {
    // Same harness as the SUBJECT ⌘-click case, one node key added — and no
    // `navigation`, which is the path this guard sits on.
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderView(onNavigate, { operations: { read: false } });

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    expect(openedTabs(), 'reading is switched off, and a ⌘-click opened the record in a tab anyway').toEqual([]);
    expect(navigateActions(onNavigate)).toEqual([]);
  });

  it('a host `onRowClick` receives the ⌘-click with its payload, and no tab opens — the host keeps the decision', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const onRowClick = vi.fn();
    const { container } = renderView(onNavigate, { onRowClick });

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    await waitFor(() => expect(onRowClick).toHaveBeenCalled());
    expect(onRowClick.mock.calls[0][1], 'the modifier payload stopped reaching the host — that is objectui#9462').toMatchObject({ metaKey: true });
    expect(
      openedTabs(),
      'a tab opened although a host handler was supplied — the view took the decision away from the host, which is the option the ruling refused',
    ).toEqual([]);
    expect(navigateActions(onNavigate)).toEqual([]);
  });
});

describe('objectui#9806 — LIVENESS CONTROL: with no onRowClick in the way, the same harness DOES reach the hook\'s modifier branch', () => {
  it('a plain click on a bare ObjectGrid navigates in place', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderGrid(onNavigate);

    fireEvent.click(await firstDataRow(container));

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(navigateActions(onNavigate)).toEqual(['view']);
  });

  it('a ⌘-click on the same grid DIVERGES — so the subject\'s equivalence is a reading, not a dead probe', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    const { container } = renderGrid(onNavigate);

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(
      navigateActions(onNavigate),
      'the CONTROL is red — `metaKey` is not reaching the hook at all, so every SUBJECT case above measures nothing',
    ).toEqual(['new_window']);
  });
});

describe('objectui#9806 — ISOLATION CONTROL: adding ONE prop to that same grid is what swallows the modifier', () => {
  it('an unconditional onRowClick takes the ⌘-click away from the hook and receives the payload itself', async () => {
    const onNavigate = vi.fn() as NavigateSpy;
    // Unconditional, exactly as `ObjectView` hands `handleRowClick` down: the
    // handler does not consult the event before deciding to exist.
    const onRowClick = vi.fn();
    const { container } = renderGrid(onNavigate, onRowClick);

    fireEvent.click(await firstDataRow(container), { metaKey: true });

    await waitFor(() => expect(onRowClick).toHaveBeenCalled());
    expect(
      navigateActions(onNavigate),
      "the hook still reached 'new_window' despite an `onRowClick` being present — its early return is gone, and every host handler just lost the decision the ruling kept for it",
    ).not.toContain('new_window');
    // The payload still ARRIVES — objectui#9462's repair is untouched. What the
    // handler does with it is the handler's; `ObjectView`'s own answer is the
    // SUBJECT block above.
    expect(onRowClick.mock.calls[0][1], 'the modifier payload stopped arriving — that is objectui#9462, not this card').toMatchObject({ metaKey: true });
  });
});

/* ------------------------------------------------------------------ *
 * SOURCE-TEXT half. Rooted on THIS FILE and never on `process.cwd()`,
 * which differs between the repo-root and package-level invocations.
 * ------------------------------------------------------------------ */

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/plugin-view/src/__tests__  ->  repo root.
const repoRoot = path.resolve(here, '../../../..');

const VIEW_SRC = 'packages/plugin-view/src/ObjectView.tsx';
const HOOK_SRC = 'packages/react/src/hooks/useNavigationOverlay.ts';

const readRaw = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/**
 * Whole-line comments removed, nothing else. Same shape as the `readCode`
 * helper `scripts/__tests__/body-dialect-census.test.ts` uses for this exact
 * class of problem — an assertion whose subject is a file that talks ABOUT the
 * construct being asserted on.
 */
const readCode = (rel: string) =>
  readRaw(rel)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');

/**
 * `handleRowClick`'s own body — "the branches below" the comment names, and
 * nothing else in this 2000-line file. A missing anchor returns null so a
 * rename REDS here instead of quietly answering about the whole file.
 */
function handleRowClickBody(code: string): string | null {
  const open = code.indexOf('const handleRowClick = useCallback(');
  if (open < 0) return null;
  const close = code.indexOf('}, [onRowClick', open);
  if (close < 0) return null;
  return code.slice(open, close);
}

describe('objectui#9806 — the comment\'s claim about the CODE, with the stripper controlled both ways', () => {
  it('the stripper is live: this pin\'s own name is in the file raw, and gone once comments are stripped', () => {
    // BOTH directions, because either alone is worthless. The token chosen is
    // one that lives ONLY in a comment — the citation of this file — so the
    // stripped absence is the stripper's doing and not the token's.
    const myName = path.basename(fileURLToPath(import.meta.url));
    expect(readRaw(VIEW_SRC), 'the citation is gone, so this control has no anchor — see the handshake case').toContain(myName);
    expect(readCode(VIEW_SRC)).not.toContain(myName);
  });

  it('`handleRowClick` hands a host handler the click BEFORE it reads any modifier — the host keeps the decision', () => {
    const body = handleRowClickBody(readCode(VIEW_SRC));
    expect(body, `${VIEW_SRC} — \`handleRowClick\` anchor not found; this case answered about nothing`).not.toBeNull();
    const forward = body!.indexOf('onRowClick(record, event)');
    const firstRead = Math.min(
      ...['.metaKey', '.ctrlKey', '.button'].map((read) => {
        const at = body!.indexOf(read);
        expect(at, `\`handleRowClick\` no longer reads \`${read}\` — the ruling-B branch is gone`).toBeGreaterThan(-1);
        return at;
      }),
    );
    expect(forward, 'the forward to a host `onRowClick` is gone (objectui#9462)').toBeGreaterThan(-1);
    expect(
      forward,
      '`handleRowClick` reads the modifier payload BEFORE handing the click to a host `onRowClick` — the view would be deciding over the host',
    ).toBeLessThan(firstRead);
  });

  it('the hook returns EARLY on that handler, AHEAD of its modifier branch — the ordering the comment rests on', () => {
    const hook = readCode(HOOK_SRC);
    const earlyReturn = hook.indexOf('onRowClick(record, event)');
    const modifierRead = hook.indexOf('event.metaKey');
    expect(earlyReturn, `${HOOK_SRC} — the forwarding call is gone`).toBeGreaterThan(-1);
    expect(modifierRead, `${HOOK_SRC} — the modifier read is gone`).toBeGreaterThan(-1);
    expect(
      earlyReturn,
      'the hook now reads the modifier payload BEFORE handing the click to `onRowClick` — option C, which the objectui#9806 ruling refused, has landed; `ObjectView` would answer a modifier click twice and its comment must be amended with this pin',
    ).toBeLessThan(modifierRead);
  });

  it('pins why the presence leg is keyed on the READ spelling and not on a bare identifier', () => {
    const hook = readCode(HOOK_SRC);
    // A DECLARATION survives the strip. `metaKey?: boolean` on the payload type
    // is code, so a bare-identifier probe is satisfied by a hook that reads
    // nothing at all — which is the exact failure this file must be able to
    // see. The two answers are pinned side by side so they are never confused.
    expect(hook, 'the declaration is code and survives the strip').toContain('metaKey?: boolean');
    expect(hook, 'the READ is the spelling that carries the claim').toContain('event.metaKey');
  });
});

describe('objectui#9806 — the handshake: the comment cites THIS pin, by a name derived rather than typed', () => {
  it('ObjectView.tsx names this file, so a rename or a rewrite that drops the citation reds', () => {
    const myName = path.basename(fileURLToPath(import.meta.url));
    // ⚠️ Deliberately read off the RAW bytes: the citation lives in the comment,
    // and the comment is the subject here. This is the one case in the file for
    // which prose is the point rather than the hazard.
    expect(
      readRaw(VIEW_SRC),
      `\`${VIEW_SRC}\`'s comment no longer cites \`${myName}\` — either this pin was renamed, or the comment was rewritten without its instrument, and AGENTS.md #9 forbids the second`,
    ).toContain(myName);
  });
});
