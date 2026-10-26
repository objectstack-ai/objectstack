/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6246 — a param that declares `@objectstack/spec`'s `carryOver`
 * renders as a collapsed READ-ONLY summary: seeded from the row, submitted
 * verbatim, with no editing affordance.
 *
 * ## Why this file exists
 *
 * `ActionParamSchema.carryOver` (objectstack#12614, the spec half of the
 * objectstack#11753 ruling) says a param is carried through the dialog rather
 * than collected from the user. The platform's permission-set Clone action
 * declares it on its five JSON permission facets, and before this card the
 * console dropped the key on the floor: `resolveActionParam()` builds its
 * output key by key, so `carryOver` never reached the dialog, and every facet
 * was offered as a prefilled JSON textarea. `member_default`'s row-level
 * security is 17+ policy objects in one such box. A hand-edited blob that is
 * still valid JSON clones a set that grants MORE than its base, and the data
 * door accepts it — it validates shape, not intent.
 *
 * Until now only the SEND side of that action was pinned (objectstack#11703's
 * pin 6, in `@objectstack/plugin-security`, which asserts what the action
 * submits). Nothing pinned what the dialog RENDERS. This file does.
 *
 * ## The fixture is the shipped declaration, transcribed and then CHECKED
 *
 * `@objectstack/plugin-security` is not a dependency of this repo, so the
 * Clone action's params cannot be imported. They are transcribed from the
 * `clone_permission_set` action on `SysPermissionSet`
 * (`sys-permission-set.object.ts` in that package) and then parsed through the
 * INSTALLED `ActionParamSchema` below, so a fixture the platform would refuse
 * cannot pass here — the refusal control proves the parse can fail.
 *
 * ## Every read-only claim has a lit control beside it
 *
 * A dialog that renders nothing at all also has "no textarea" for a facet, so
 * each absence is asserted beside the ordinary params of the SAME dialog,
 * which must still render their editable inputs.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionParamSchema } from '@objectstack/spec/ui';
import type { ActionParamDef } from '@object-ui/core';
// Module scope, per AGENTS.md 测试纪律: the dialog's text/textarea widgets sit
// behind `React.lazy`, and this barrel statically re-exports them.
import '@object-ui/fields';

import { ActionParamDialog, serializeParamValues } from './ActionParamDialog';
import { ActionPreview } from './metadata-admin/previews/ActionPreview';
import { resolveActionParams, type RawActionParam } from '@object-ui/fields';

/* ────────────────────────────────────────────────────────────────────────── */
/* The shipped declaration                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/** The five facets the Clone action declares `carryOver` on — by identity. */
const CARRIED = [
  'object_permissions',
  'field_permissions',
  'system_permissions',
  'row_level_security',
  'tab_permissions',
] as const;

/** `clone_permission_set`'s `params`, as `SysPermissionSet` declares them. */
const CLONE_PARAMS: RawActionParam[] = [
  { name: 'label', label: 'New Display Name', type: 'text', required: true },
  {
    name: 'name',
    label: 'New API Name',
    type: 'text',
    required: true,
    helpText: 'snake_case machine name, unique per organization',
  },
  // Prose, not a permission facet: the producer deliberately leaves it editable.
  { field: 'description', defaultFromRow: true },
  { field: 'object_permissions', defaultFromRow: true, carryOver: true },
  { field: 'field_permissions', defaultFromRow: true, carryOver: true },
  { field: 'system_permissions', defaultFromRow: true, carryOver: true },
  { field: 'row_level_security', defaultFromRow: true, carryOver: true },
  { field: 'tab_permissions', defaultFromRow: true, carryOver: true },
];

/** The object the params are field-backed against — the columns the row carries. */
const SYS_PERMISSION_SET = {
  name: 'sys_permission_set',
  fields: {
    label: { type: 'text', label: 'Display Name', required: true },
    name: { type: 'text', label: 'API Name', required: true },
    description: { type: 'textarea', label: 'Description' },
    object_permissions: { type: 'textarea', label: 'Object Permissions' },
    field_permissions: { type: 'textarea', label: 'Field Permissions' },
    system_permissions: { type: 'textarea', label: 'System Permissions' },
    row_level_security: { type: 'textarea', label: 'Row-Level Security' },
    tab_permissions: { type: 'textarea', label: 'Tab Permissions' },
    admin_scope: { type: 'textarea', label: 'Delegated Admin Scope' },
  },
};

const FACET_LABEL: Record<(typeof CARRIED)[number], string> = {
  object_permissions: 'Object Permissions',
  field_permissions: 'Field Permissions',
  system_permissions: 'System Permissions',
  row_level_security: 'Row-Level Security',
  tab_permissions: 'Tab Permissions',
};

/**
 * The row an admin clones. Every facet is a NON-EMPTY JSON string — the column
 * shape the platform writes (`JSON.stringify` per facet) — so no assertion
 * below can be satisfied by an empty default.
 */
const RLS = [
  { name: 'own_tasks', object: 'task', operation: 'select', using: 'owner == current_user.id' },
  { name: 'team_projects', object: 'project', operation: 'select', using: 'team_id == current_user.team_id' },
];
const ROW: Record<string, string> = {
  id: 'ps_member_default',
  name: 'member_default',
  label: 'Member (default)',
  description: 'Baseline access for every member.',
  object_permissions: JSON.stringify({ task: { allowRead: true, allowCreate: true } }),
  field_permissions: JSON.stringify({ 'task.budget': { readable: true, editable: false } }),
  system_permissions: JSON.stringify(['setup.access']),
  row_level_security: JSON.stringify(RLS),
  tab_permissions: JSON.stringify({ app_ops: 'default_on' }),
  // The ruled exclusion — present on the row, never declared as a param.
  admin_scope: JSON.stringify({ businessUnit: 'field_ops' }),
};

const resolveClone = (params: RawActionParam[] = CLONE_PARAMS): ActionParamDef[] =>
  resolveActionParams(params, {
    objectName: 'sys_permission_set',
    objects: [SYS_PERMISSION_SET] as never,
    fieldLabel: (_o: string, _f: string, fallback: string) => fallback,
    row: ROW,
  });

function openClone() {
  const resolve = vi.fn();
  render(
    <ActionParamDialog
      state={{ open: true, params: resolveClone(), title: 'Clone', resolve }}
      onOpenChange={() => {}}
    />,
  );
  return resolve;
}

/** Every element a user could type into, anywhere under `root`. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

afterEach(() => cleanup());

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg A — the declaration reaches the dialog                                 */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#6246 leg A — `carryOver` survives resolution', () => {
  it('the fixture is a declaration the installed spec ACCEPTS, and the parse keeps `carryOver`', () => {
    for (const param of CLONE_PARAMS) {
      const parsed = ActionParamSchema.safeParse(param);
      expect(parsed.success, `spec parse of ${param.name ?? param.field}`).toBe(true);
    }
    const carriedByParse = CLONE_PARAMS
      .map((p) => ActionParamSchema.parse(p))
      .filter((p) => p.carryOver === true)
      .map((p) => p.field);
    expect(carriedByParse).toEqual([...CARRIED]);
  });

  it('CONTROL — the same parse refuses a carry-over with no row seed, so it is able to fail', () => {
    const refused = ActionParamSchema.safeParse({ field: 'row_level_security', carryOver: true });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path.join('.'))).toContain('carryOver');
  });

  it('⭐ every carried facet resolves WITH the declaration and the row value as its seed', () => {
    const byName = new Map(resolveClone().map((p) => [p.name, p]));
    for (const facet of CARRIED) {
      const param = byName.get(facet);
      expect(param?.carryOver, `${facet} carries the declaration`).toBe(true);
      expect(param?.defaultValue, `${facet} is seeded from the row`).toBe(ROW[facet]);
    }
  });

  it('CONTROL — the params that do not declare it resolve without it', () => {
    const byName = new Map(resolveClone().map((p) => [p.name, p]));
    for (const name of ['label', 'name', 'description']) {
      expect(byName.get(name)?.carryOver, name).not.toBe(true);
    }
    expect(byName.get('description')?.defaultValue).toBe(ROW.description);
  });

  it('the inline and the unresolved-field branches carry it too', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [inline, unresolved] = resolveClone([
      { name: 'snapshot', type: 'textarea', defaultFromRow: true, carryOver: true },
      { field: 'not_on_the_object', defaultFromRow: true, carryOver: true },
    ]);
    expect(inline.carryOver).toBe(true);
    expect(unresolved.unresolvedField).toBe('sys_permission_set.not_on_the_object');
    expect(unresolved.carryOver).toBe(true);
    warn.mockRestore();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg B — what Clone RENDERS                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#6246 leg B — the Clone dialog renders each carried facet read-only', () => {
  it('⭐ each carried facet is a collapsed summary with NO control a user could type into', async () => {
    openClone();
    // Let the lazy widgets of the ordinary params land first, so an absence
    // below is not read off a Suspense fallback.
    await screen.findByLabelText(/New Display Name/);

    for (const facet of CARRIED) {
      const summary = screen.getByTestId(`param-carry-over-${facet}`);
      expect(summary, facet).toHaveTextContent(FACET_LABEL[facet]);
      expect(summary.querySelectorAll(EDITABLE), `${facet}: no editable element`).toHaveLength(0);
      expect(within(summary).queryAllByRole('textbox'), `${facet}: no textbox`).toHaveLength(0);
      // No control is labelled by the facet anywhere in the dialog.
      expect(screen.queryByLabelText(FACET_LABEL[facet])).toBeNull();
      // Collapsed by default: the disclosure is closed and the value is not shown.
      const toggle = within(summary).getByRole('button');
      expect(toggle, `${facet}: collapsed`).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByText(/own_tasks/)).toBeNull();

    // Dialog-wide, by identity: the ONLY editable controls are the three
    // params that do not declare the key.
    const dialog = screen.getByRole('dialog');
    const editableIds = Array.from(dialog.querySelectorAll(EDITABLE)).map((el) => el.id).sort();
    expect(editableIds).toEqual(['description', 'label', 'name']);
  });

  it('CONTROL — the ordinary params of the SAME dialog are still editable inputs', async () => {
    openClone();
    const label = await screen.findByLabelText(/New Display Name/);
    const name = await screen.findByLabelText(/New API Name/);
    const description = await screen.findByLabelText(/Description/);
    expect(label.tagName).toBe('INPUT');
    expect(name.tagName).toBe('INPUT');
    expect(description.tagName).toBe('TEXTAREA');
    expect(description).toHaveValue(ROW.description);
  });

  it('expanding a summary shows the carried value, and still offers nothing to edit', async () => {
    openClone();
    await screen.findByLabelText(/New Display Name/);
    const summary = screen.getByTestId('param-carry-over-row_level_security');
    fireEvent.click(within(summary).getByRole('button'));

    expect(within(summary).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(summary).toHaveTextContent('own_tasks');
    expect(summary).toHaveTextContent('team_projects');
    expect(summary.querySelectorAll(EDITABLE)).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg C — what Clone SUBMITS                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#6246 leg C — every carried facet is submitted verbatim', () => {
  it('⭐ Confirm sends each facet as the row value, byte for byte', async () => {
    const resolve = openClone();
    fireEvent.change(await screen.findByLabelText(/New Display Name/), {
      target: { value: 'Member (local)' },
    });
    fireEvent.change(await screen.findByLabelText(/New API Name/), {
      target: { value: 'member_local' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    const sent = resolve.mock.calls[0][0] as Record<string, unknown>;
    for (const facet of CARRIED) {
      expect(sent[facet], `${facet} verbatim`).toBe(ROW[facet]);
    }
    expect(sent.label).toBe('Member (local)');
    expect(sent.name).toBe('member_local');
    expect(sent.description).toBe(ROW.description);
    // The ruled exclusion stays excluded.
    expect(Object.keys(sent)).not.toContain('admin_scope');
  });

  it('a carried upload value is not reduced to its id — verbatim means verbatim', () => {
    const rich = { file_id: 'f_1', name: 'policy.pdf', url: '/files/f_1' };
    const out = serializeParamValues(
      [
        { name: 'carried_file', label: 'Carried', type: 'file', carryOver: true },
        { name: 'picked_file', label: 'Picked', type: 'file' },
      ],
      { carried_file: rich, picked_file: rich },
    );
    expect(out.carried_file).toBe(rich);
    // CONTROL — an ordinary upload param is still reduced to its storage id.
    expect(out.picked_file).toBe('f_1');
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* Leg D — the designer's dialog mock draws what the dialog draws             */
/* ────────────────────────────────────────────────────────────────────────── */

describe('objectui#6246 leg D — the action designer previews a carry-over as read-only', () => {
  it('a carry-over param previews as the read-only summary, and an ordinary one as its widget', () => {
    render(
      <ActionPreview
        type="action"
        name="clone_permission_set"
        draft={{
          name: 'clone_permission_set',
          label: 'Clone',
          type: 'script',
          target: 'true',
          params: [
            { name: 'label', label: 'New Display Name', type: 'text' },
            { field: 'row_level_security', label: 'Row-Level Security', type: 'textarea', defaultFromRow: true, carryOver: true },
          ],
        }}
      />,
    );
    const carried = screen.getAllByTestId('action-preview-carry-over');
    expect(carried).toHaveLength(1);
    expect(carried[0].querySelectorAll(EDITABLE)).toHaveLength(0);
    // Its declared widget (`textarea`) is NOT drawn for it…
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    // …while the ordinary param beside it still previews its text box.
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(1);
  });
});
