/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11168 slice 1 — what `action:group` and `action:menu` PUBLISH, and
 * each published key honoured through the block path.
 *
 * `@objectstack/spec` 17.5.0 gave both blocks a `ComponentPropsMap` row, and
 * the repo-wide parity guard (`apps/console/src/__tests__/registry-inputs-spec-parity.test.ts`)
 * booked every difference to this card (objectui#11111 decision 3 = B). The
 * ruling's terms: each key is declared by its own measurement — declare what
 * the renderer honours, refuse or retire what it does not. This file is the
 * measurement kept as a pin. Every row mounts the block the way a page does,
 * through the REAL `SchemaRenderer` and the real registry, and asserts on what
 * a user sees or what the real `ActionRunner` hands a handler. Every positive
 * row carries its control, so a verdict cannot be "the block never rendered".
 *
 * What moved, per key:
 *
 *   - `action:group.location`, `.visible`; `action:menu.size`, `.visible` —
 *     spec keys the renderers read, now PUBLISHED.
 *   - `action:group.name` — RETIRED from the published inputs. Nothing reads a
 *     group-level `name` (inline mode only leaks it onto the wrapping `<div>`
 *     as a DOM attribute), and the spec refuses it on this row.
 *   - `action:group.actions` / `action:menu.actions` — NARROWED from the
 *     `object` kind the spec refuses to a list of action objects, and their
 *     member shape pinned below (the MEMBER-PIN direction of the guard names
 *     this file for both keys).
 *   - `action:group.size` — NARROWED from `sm`/`md`/`lg` to the Button
 *     primitive's four sizes, the set the spec accepts. `md` is refused; the
 *     renderer's dropdown-mode `md` → `default` mapping stays as a back-compat
 *     read for stored documents.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import type { ActionContext, ActionDef, ActionResult } from '@object-ui/core';
import type { DataSource } from '@object-ui/types';
// These nodes are written the way the runtime reads them, flat on the node,
// which the closed `action:*` node types refuse: measured on objectui#11466,
// typing the fixtures as `DeclaredNode` refuses them line by line. So each
// crosses through the one test helper for undeclared input.
import { undeclaredNode } from '@object-ui/test-support';
import {
  ActionProvider,
  PredicateScopeProvider,
  SchemaRenderer,
  SchemaRendererProvider,
} from '@object-ui/react';
import { ComponentPropsMap } from '@objectstack/spec/ui';
// Module-scope side-effect imports: the registry must hold both renderers when
// `SchemaRenderer` resolves the type, and the light `dom` project does not load
// the components graph. Module scope, not a `beforeAll`, per AGENTS.md 测试纪律.
import '../action-group';
import '../action-menu';
// The leaf the size row below compares a group member with.
import '../action-button';

/** The row every predicate below is evaluated against. */
const DATA = { status: 'draft' };

/** A CEL envelope that holds on {@link DATA}, and its twin that fails. */
const HOLDS = { dialect: 'cel', source: 'has(data.status) && data.status == "draft"' };
const FAILS = { dialect: 'cel', source: 'has(data.status) && data.status == "published"' };

/** The overflow trigger's accessible name, with no i18n bundle loaded. */
const MORE = 'More actions';

let run: Mock<(action: ActionDef, ctx: ActionContext) => Promise<ActionResult>>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  run = vi.fn(async () => ({ success: true }));
  // Radix warns about a missing dialog description in happy-dom; not the subject.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  cleanup();
});

/**
 * Mount one node the way a page does: the real `SchemaRenderer`, a runner
 * whose `run` handler records what it is handed, and the predicate scope the
 * CEL rows read (`data` bound to {@link DATA}; see
 * `action-enablement-cel-envelope.test.tsx` for why both providers).
 */
function mount(schema: Record<string, unknown>) {
  return render(
    <ActionProvider handlers={{ run }} onToast={vi.fn()}>
      <SchemaRendererProvider dataSource={DATA as unknown as DataSource}>
        <PredicateScopeProvider scope={{ data: DATA }}>
          <SchemaRenderer schema={undeclaredNode(schema)} />
        </PredicateScopeProvider>
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** One member action, as an author writes it inside `actions`. */
const member = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name.toUpperCase(),
  type: 'run',
  ...extra,
});

/** The published inputs of one block, by name. */
const inputsOf = (type: string) =>
  new Map((ComponentRegistry.getConfig(type)?.inputs ?? []).map((input) => [input.name, input]));

/** The installed spec row for one block, as a parser. */
interface SpecIssue { code: string; path: PropertyKey[]; keys?: string[] }
const specRow = (type: string) =>
  (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: { issues: SpecIssue[] } } }>)[type];

/**
 * The refusal the spec row gives one value, as `{ code, path }` pairs — so a
 * refusal row asserts WHICH key was refused and HOW (by name, by kind, by
 * value), never a bare `success: false` a sibling key could have produced.
 */
const refusal = (type: string, value: unknown) =>
  (specRow(type).safeParse(value).error?.issues ?? []).map((issue) => ({
    code: issue.code,
    path: issue.path.join('.'),
    ...(issue.keys ? { keys: issue.keys } : {}),
  }));

/** Radix opens a dropdown on `pointerdown` and mounts its content in a portal. */
async function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
}

// ── action:group ────────────────────────────────────────────────────────────

describe('action:group — the published inputs (objectui#11168)', () => {
  it('publishes `location` and `visible`, and no longer publishes `name`', () => {
    const inputs = inputsOf('action:group');
    expect(inputs.has('location')).toBe(true);
    expect(inputs.has('visible')).toBe(true);
    expect(inputs.has('name')).toBe(false);
    // The two published keys are keys the spec row accepts, `name` is not.
    expect(specRow('action:group').safeParse({ location: 'list_toolbar', visible: true }).success).toBe(true);
  });

  it('`name` is RETIRED: the spec refuses it, and nothing the group renders reads it', () => {
    // Refused BY NAME — the row's unknown-key refusal, naming exactly `name`.
    expect(refusal('action:group', { name: 'grp' })).toEqual([
      { code: 'unrecognized_keys', path: '', keys: ['name'] },
    ]);

    // Same members, with and without a group `name`: identical buttons, in
    // both display modes — the key changes nothing a user can see or run.
    const actions = [member('alpha'), member('beta')];
    for (const display of ['inline', 'dropdown'] as const) {
      mount({ type: 'action:group', display, actions });
      const without = screen.getAllByRole('button').map((b) => b.textContent);
      cleanup();
      mount({ type: 'action:group', display, name: 'grp', actions });
      const withName = screen.getAllByRole('button').map((b) => b.textContent);
      cleanup();
      expect(withName).toEqual(without);
      expect(without.length).toBeGreaterThan(0);
    }
  });

  it('`actions` is published as a LIST of objects — the `object` kind the spec refuses is gone', () => {
    const actions = inputsOf('action:group').get('actions');
    expect(actions?.type).toBe('array');
    expect(actions?.of).toBe('object');
    // The narrowing is the contract's: an object is refused by kind, a list of
    // action objects is accepted.
    expect(refusal('action:group', { actions: { a: member('a') } })).toEqual([
      { code: 'invalid_type', path: 'actions' },
    ]);
    expect(specRow('action:group').safeParse({ actions: [member('a')] }).success).toBe(true);
  });

  it('`size` publishes exactly the sizes the spec accepts — `md` is refused and no longer offered', () => {
    const size = inputsOf('action:group').get('size');
    expect([...(size?.enum ?? [])].sort()).toEqual(['default', 'icon', 'lg', 'sm']);
    for (const value of size?.enum ?? []) {
      expect(specRow('action:group').safeParse({ size: value }).success, `size ${String(value)}`).toBe(true);
    }
    expect(refusal('action:group', { size: 'md' })).toEqual([{ code: 'invalid_value', path: 'size' }]);
  });
});

describe('action:group — each published key is honoured through `SchemaRenderer`', () => {
  it('`location` renders only the members whose `locations` include it', () => {
    const actions = [
      member('here', { locations: ['list_toolbar'] }),
      member('there', { locations: ['record_header'] }),
    ];
    mount({ type: 'action:group', location: 'list_toolbar', actions });
    expect(screen.getByRole('button', { name: 'HERE' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'THERE' })).toBeNull();
    cleanup();
    // Control: the same members with no `location` — both render.
    mount({ type: 'action:group', actions });
    expect(screen.getByRole('button', { name: 'HERE' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'THERE' })).toBeInTheDocument();
  });

  it.each([
    ['a boolean', true, false],
    ['a bare CEL expression', 'data.status == "draft"', 'data.status == "published"'],
    ['the `{ dialect, source }` envelope', HOLDS, FAILS],
  ])('`visible` as %s hides the whole group when it fails', (_arm, holds, fails) => {
    const actions = [member('alpha')];
    mount({ type: 'action:group', visible: holds, actions });
    expect(screen.getByRole('button', { name: 'ALPHA' })).toBeInTheDocument();
    cleanup();
    mount({ type: 'action:group', visible: fails, actions });
    expect(screen.queryByRole('button', { name: 'ALPHA' })).toBeNull();
  });

  it('`size` sizes every inline member that sets none, and the dropdown trigger', () => {
    mount({ type: 'action:group', size: 'lg', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: 'ALPHA' }).className).toContain('h-11');
    cleanup();
    // Control: no group size — the inline member falls back to `sm`.
    mount({ type: 'action:group', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: 'ALPHA' }).className).toContain('h-9');
    cleanup();
    mount({ type: 'action:group', display: 'dropdown', label: 'Group', size: 'icon', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: /Group/ }).className).toContain('w-10');
    cleanup();
    mount({ type: 'action:group', display: 'dropdown', label: 'Group', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: /Group/ }).className).not.toContain('w-10');
  });
});

describe('action:group — the member shape of `actions` (the MEMBER-PIN direction)', () => {
  it('inline: `label` is the text, `visible` / `disabled` gate THAT member, `variant` / `size` / `className` style it', () => {
    mount({
      type: 'action:group',
      size: 'sm',
      actions: [
        member('shown'),
        member('hidden', { visible: false }),
        member('greyed', { disabled: true }),
        member('loud', { variant: 'destructive', size: 'lg', className: 'member-class' }),
      ],
    });
    expect(screen.getByRole('button', { name: 'SHOWN' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'HIDDEN' })).toBeNull();
    expect(screen.getByRole('button', { name: 'GREYED' })).toBeDisabled();
    const loud = screen.getByRole('button', { name: 'LOUD' });
    expect(loud.className).toContain('bg-destructive');
    // A member's own `size` outranks the group's.
    expect(loud.className).toContain('h-11');
    expect(loud.className).toContain('member-class');
    expect(screen.getByRole('button', { name: 'SHOWN' }).className).toContain('h-9');
  });

  it.each(['default', 'sm', 'lg', 'icon', 'md'] as const)(
    'a member at `size: %s` draws exactly as an `action:button` at that size (the `UIActionSchema.size` changeset\'s claim)',
    (size) => {
      // The variant is held equal (`default`, the leaf's own default; a
      // member's is `outline`), so the class lists differ only if the SIZE is
      // drawn differently. `md` is mapped to `default` on both.
      mount({ type: 'action:group', actions: [member('alpha', { size, variant: 'default' })] });
      const drawnAsMember = screen.getByRole('button', { name: 'ALPHA' }).className.split(' ').sort();
      cleanup();
      mount({ type: 'action:button', name: 'alpha', label: 'ALPHA', size });
      const drawnAsLeaf = screen.getByRole('button', { name: 'ALPHA' }).className.split(' ').sort();
      expect(drawnAsMember).toEqual(drawnAsLeaf);
    },
  );

  it('CONTROL: with NO size the two differ — a member falls back to `sm`, a leaf to `default` — so the rows above can fail', () => {
    mount({ type: 'action:group', actions: [member('alpha', { variant: 'default' })] });
    const drawnAsMember = screen.getByRole('button', { name: 'ALPHA' }).className.split(' ').sort();
    cleanup();
    mount({ type: 'action:button', name: 'alpha', label: 'ALPHA' });
    const drawnAsLeaf = screen.getByRole('button', { name: 'ALPHA' }).className.split(' ').sort();
    expect(drawnAsMember).not.toEqual(drawnAsLeaf);
  });

  it('a click runs the member through the runner by its OWN `type`, carrying its own keys', async () => {
    mount({
      type: 'action:group',
      actions: [member('go', { target: 'member-target', objectName: 'account' })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'GO' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const def = run.mock.calls[0][0];
    expect(def).toMatchObject({ type: 'run', name: 'go', target: 'member-target', objectName: 'account' });
  });

  it('dropdown: a member with no `label` falls back to its `name`, and `tags: [separator-before]` draws a divider', async () => {
    mount({
      type: 'action:group',
      display: 'dropdown',
      label: 'Group',
      actions: [
        member('first'),
        { name: 'nameonly', type: 'run', tags: ['separator-before'] },
      ],
    });
    const menu = await openMenu(screen.getByRole('button', { name: /Group/ }));
    expect(within(menu).getByRole('menuitem', { name: 'FIRST' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'nameonly' })).toBeInTheDocument();
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });
});

// ── action:menu ─────────────────────────────────────────────────────────────

describe('action:menu — the published inputs (objectui#11168)', () => {
  it('publishes `size` and `visible` with the arms the spec accepts', () => {
    const inputs = inputsOf('action:menu');
    expect([...(inputs.get('size')?.enum ?? [])].sort()).toEqual(['default', 'icon', 'lg', 'sm']);
    expect(inputs.get('visible')?.type).toEqual(['boolean', 'string', 'object']);
    for (const value of inputs.get('size')?.enum ?? []) {
      expect(specRow('action:menu').safeParse({ size: value }).success, `size ${String(value)}`).toBe(true);
    }
  });

  it('`actions` is published as a LIST of objects — the `object` kind the spec refuses is gone', () => {
    const actions = inputsOf('action:menu').get('actions');
    expect(actions?.type).toBe('array');
    expect(actions?.of).toBe('object');
    expect(refusal('action:menu', { actions: { a: member('a') } })).toEqual([
      { code: 'invalid_type', path: 'actions' },
    ]);
    expect(specRow('action:menu').safeParse({ actions: [member('a')] }).success).toBe(true);
  });
});

describe('action:menu — each published key is honoured through `SchemaRenderer`', () => {
  it('`size` sizes the trigger; without it the trigger is icon-sized', () => {
    mount({ type: 'action:menu', size: 'lg', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: MORE }).className).toContain('h-11');
    cleanup();
    mount({ type: 'action:menu', actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: MORE }).className).toContain('h-8 w-8');
  });

  it.each([
    ['a boolean', true, false],
    ['a bare CEL expression', 'data.status == "draft"', 'data.status == "published"'],
    ['the `{ dialect, source }` envelope', HOLDS, FAILS],
  ])('`visible` as %s hides the whole menu when it fails', (_arm, holds, fails) => {
    mount({ type: 'action:menu', visible: holds, actions: [member('alpha')] });
    expect(screen.getByRole('button', { name: MORE })).toBeInTheDocument();
    cleanup();
    mount({ type: 'action:menu', visible: fails, actions: [member('alpha')] });
    expect(screen.queryByRole('button', { name: MORE })).toBeNull();
  });
});

describe('action:menu — the member shape of `actions` (the MEMBER-PIN direction)', () => {
  it('each member is one item: `label` (else `name`), its own `visible` / `disabled`, `tags`, `variant`', async () => {
    mount({
      type: 'action:menu',
      actions: [
        member('shown'),
        member('hidden', { visible: false }),
        member('greyed', { disabled: true }),
        { name: 'nameonly', type: 'run', tags: ['separator-before'], variant: 'destructive' },
      ],
    });
    const menu = await openMenu(screen.getByRole('button', { name: MORE }));
    expect(within(menu).getByRole('menuitem', { name: 'SHOWN' })).not.toHaveAttribute('data-disabled');
    expect(within(menu).queryByRole('menuitem', { name: 'HIDDEN' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'GREYED' })).toHaveAttribute('data-disabled');
    const tail = within(menu).getByRole('menuitem', { name: 'nameonly' });
    expect(tail.className).toContain('text-destructive');
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);
  });

  it('selecting an item runs the member through the runner by its OWN `type`, carrying its own keys', async () => {
    mount({ type: 'action:menu', actions: [member('go', { target: 'member-target', objectName: 'account' })] });
    const menu = await openMenu(screen.getByRole('button', { name: MORE }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'GO' }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0][0]).toMatchObject({ type: 'run', name: 'go', target: 'member-target', objectName: 'account' });
  });
});
