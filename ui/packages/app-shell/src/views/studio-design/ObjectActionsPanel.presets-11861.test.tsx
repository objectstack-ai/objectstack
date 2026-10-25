/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11861 — the Actions "New" menu opens on a few common actions, in
 * plain words, and keeps the blank action under "Advanced".
 *
 * What is pinned, and against what:
 *
 *   - the menu: the presets first, the blank action (objectui#11820's
 *     skeleton, whose own pin is `newActionPin`) folded under Advanced;
 *   - every preset in the table (the class, not a hand-picked instance) ends
 *     as an action the spec's own `ActionSchema` and `ObjectSchema` accept —
 *     the parse the object-draft save applies — once the author has given
 *     what it waits for, in the REAL action editor;
 *   - a preset whose type needs a `target` is held, not written: listed as not
 *     saved, with the held line naming the editor's input, written by the
 *     first edit that gives it one, and dropped unsent by Delete;
 *   - "Change a picklist field" is written at once, on the author's own
 *     picklist — never a `system`, hidden or read-only one — and is offered
 *     disabled, saying what it needs, when there is none;
 *   - the two tables the preset module writes out instead of importing the
 *     spec at runtime — the types that need a target, and the field-name
 *     grammar a param binds — agree with the spec, in both directions.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { ActionSchema, ActionType } from '@objectstack/spec/ui';
import { ObjectSchema } from '@objectstack/spec/data';

// The action editor reads flows, pages, objects and fields through the shared
// metadata client on mount: answered here, so nothing reaches the network.
const state = vi.hoisted(() => {
  const flows: Array<{ name: string; label?: string }> = [];
  return {
    flows,
    client: {
      get: vi.fn(async () => undefined),
      list: vi.fn(async (type: string) => (type === 'flow' ? flows : [])),
      withPreviewDrafts() {
        return this;
      },
    },
  };
});
vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => state.client };
});

import { ObjectActionsPanel } from './ObjectActionsPanel';
import { ACTION_PRESETS, TARGET_INPUT_KEYS, heldInputKey, type ActionPresetFieldOpt } from './actionPresets';
import { ActionDefaultInspector } from '../metadata-admin/inspectors/ActionDefaultInspector';
import { registerMetadataDefaultInspector } from '../metadata-admin/default-inspector-registry';
import { t } from '../metadata-admin/i18n';

// The real editor, as the console registers it.
registerMetadataDefaultInspector('action', ActionDefaultInspector);

afterEach(() => {
  cleanup();
  state.flows.length = 0;
});

const EN = 'en-US';

const existing = {
  name: 'open_help',
  label: 'Open help',
  objectName: 'invoice',
  locations: ['record_more'],
  type: 'url',
  target: 'https://example.com/help',
};

const STATUS_OPTIONS = [
  { label: 'Open', value: 'open' },
  { label: 'Paid', value: 'paid' },
];

/** A platform picklist declared BEFORE the author's own, which a preset must pass over. */
const draft: Record<string, unknown> = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    name: { type: 'text', label: 'Name' },
    sync_state: { type: 'select', label: 'Sync State', system: true, options: STATUS_OPTIONS },
    status: { type: 'select', label: 'Status', options: STATUS_OPTIONS },
  },
  actions: [existing],
};

/** Picklists only a preset must NOT take: the platform's, a hidden one, a read-only one. */
const bareDraft: Record<string, unknown> = {
  name: 'note',
  label: 'Note',
  fields: {
    name: { type: 'text', label: 'Name' },
    sync_state: { type: 'select', label: 'Sync State', system: true, options: STATUS_OPTIONS },
    priority: { type: 'select', label: 'Priority', hidden: true, options: STATUS_OPTIONS },
    stage: { type: 'select', label: 'Stage', readonly: true, options: STATUS_OPTIONS },
  },
  actions: [],
};

function Harness({ onPatch, initial }: { onPatch: (p: Record<string, unknown>) => void; initial: Record<string, unknown> }) {
  const [d, setD] = React.useState(initial);
  return (
    <ObjectActionsPanel
      draft={d}
      onPatch={(p) => {
        onPatch(p);
        setD((prev) => ({ ...prev, ...p }));
      }}
    />
  );
}

// Exactly "New": the blank action under Advanced is named "New action".
// The empty block's button while no action is listed (objectui#12514).
const openNew = () => fireEvent.click(screen.queryByTestId('actions-empty-new') ?? screen.getByRole('button', { name: 'New' }));
const presetButton = (id: string) => screen.getByTestId(`action-preset-${id}`);

/** The last action the panel wrote, as the save sends it (through the JSON wire). */
function lastWritten(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = onPatch.mock.calls;
  const actions = calls[calls.length - 1][0].actions as Array<Record<string, unknown>>;
  return JSON.parse(JSON.stringify(actions[actions.length - 1])) as Record<string, unknown>;
}

/** Readable failure text: the spec's own issues, not a bare `false`. */
function issuesOf(result: { success: boolean; error?: { issues: readonly unknown[] } }): string {
  if (result.success) return '(accepted)';
  return (result.error?.issues ?? [])
    .map((raw) => {
      const i = raw as { code?: unknown; path?: unknown; message?: unknown };
      return `${String(i.code)}@${JSON.stringify(i.path)}: ${String(i.message)}`;
    })
    .join(' | ');
}

function expectSpecAccepts(action: unknown, what: string) {
  expect(`${what} :: ${issuesOf(ActionSchema.safeParse(action))}`).toBe(`${what} :: (accepted)`);
  expect(`${what} :: ${issuesOf(ObjectSchema.safeParse({ ...draft, actions: [existing, action] }))}`).toBe(
    `${what} :: (accepted)`,
  );
}

/** The editor's target input, by the label the held line names. */
const targetInput = (type: string) => screen.getByLabelText(`${t(TARGET_INPUT_KEYS[type], EN)} *`);

/** What the author types into each held preset's target, per action type. */
const TARGETS: Record<string, string> = {
  flow: 'notify_owner',
  url: 'https://example.com/pay',
  modal: 'invoice_quick_view',
};

describe('the Actions New menu opens on presets (objectui#11861)', () => {
  it('offers 3–5 presets first, in plain words, and folds the blank action under Advanced', () => {
    expect(ACTION_PRESETS.length).toBeGreaterThanOrEqual(3);
    expect(ACTION_PRESETS.length).toBeLessThanOrEqual(5);

    render(<Harness onPatch={vi.fn()} initial={draft} />);
    openNew();
    for (const preset of ACTION_PRESETS) {
      expect(screen.getByRole('button', { name: t(preset.labelKey, EN) })).toBeInTheDocument();
    }
    // The blank action is not what the menu opens on.
    expect(screen.queryByRole('button', { name: 'New action' })).toBeNull();

    const advanced = screen.getByRole('button', { name: 'Advanced' });
    expect(advanced).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(advanced.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual(['New action']);
  });

  it('opens folded again on every opening', () => {
    render(<Harness onPatch={vi.fn()} initial={draft} />);
    openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    openNew(); // close
    openNew();
    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'false');
  });

  // The class: every preset in the table, whichever way its plan goes.
  it.each(ACTION_PRESETS.map((p) => [p.id, p] as const))(
    'the %s preset ends as an action the spec accepts',
    (id, preset) => {
      const onPatch = vi.fn();
      render(<Harness onPatch={onPatch} initial={draft} />);
      openNew();
      fireEvent.click(presetButton(preset.id));
      if (onPatch.mock.calls.length === 0) {
        // Held: its target is the author's to give, in the editor's own input.
        expect(screen.getByTestId('action-not-saved')).toBeInTheDocument();
        const plan = preset.plan([], EN);
        const type = plan.ready ? String(plan.keys.type) : '';
        expect(TARGETS[type], `no TARGETS row for the ${id} preset's type`).toBeDefined();
        fireEvent.change(targetInput(type), { target: { value: TARGETS[type] } });
      }
      expect(onPatch).toHaveBeenCalledTimes(1);
      const written = lastWritten(onPatch);
      expect(written).toMatchObject({ name: 'invoice_action_2', objectName: 'invoice', locations: ['record_header'] });
      expectSpecAccepts(written, `${id} preset`);
      expect(screen.queryByTestId('action-not-saved')).toBeNull();
    },
  );

  it('“Change a picklist field” is written at once, asking for the author’s own picklist', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    // The row says which field it asks about before it is picked: Status, not
    // the platform's Sync State declared before it.
    expect(presetButton('change_choice')).toHaveAccessibleDescription('Asks for a new “Status”, then saves it.');
    fireEvent.click(presetButton('change_choice'));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastWritten(onPatch)).toStrictEqual({
      name: 'invoice_action_2',
      label: 'Change Status',
      objectName: 'invoice',
      locations: ['record_header'],
      operation: 'update',
      params: [{ field: 'status' }],
    });
    expect(screen.queryByTestId('action-held')).toBeNull();
  });

  it('“Run a flow” is held, not written, until the editor gives it a flow', async () => {
    state.flows.push({ name: 'notify_owner', label: 'Notify owner' });
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    // Its label says it all: no second line (every line is first-load bytes).
    expect(presetButton('run_flow')).not.toHaveAttribute('aria-describedby');
    fireEvent.click(presetButton('run_flow'));

    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByTestId('action-not-saved')).toHaveTextContent('Not saved — needs “Flow name”');
    expect(screen.getByTestId('action-held')).toHaveTextContent(
      'Not saved yet: the action “New action” needs “Flow name”. Your changes are kept here and saved once it is filled in.',
    );

    // The editor offers the app's flows by name: picked there, it is written.
    const picker = await screen.findByRole('combobox', { name: /Flow name/ });
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('option', { name: /notify_owner/ }));

    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastWritten(onPatch)).toStrictEqual({
      name: 'invoice_action_2',
      label: 'New action',
      objectName: 'invoice',
      locations: ['record_header'],
      type: 'flow',
      target: 'notify_owner',
    });
    expect(screen.queryByTestId('action-not-saved')).toBeNull();
    expect(screen.queryByTestId('action-held')).toBeNull();
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });

  it('Delete drops a held action unsent', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={draft} />);
    openNew();
    fireEvent.click(presetButton('open_url'));
    expect(screen.getByTestId('action-not-saved')).toHaveTextContent('Not saved — needs “URL”');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('action-not-saved')).toBeNull();
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('a held action stays on the object it was started on', () => {
    const onPatch = vi.fn();
    const { rerender } = render(<ObjectActionsPanel draft={draft} onPatch={onPatch} />);
    openNew();
    fireEvent.click(presetButton('open_page'));
    expect(screen.getByTestId('action-not-saved')).toBeInTheDocument();

    rerender(<ObjectActionsPanel draft={bareDraft} onPatch={onPatch} />);
    expect(screen.queryByTestId('action-not-saved')).toBeNull();
    expect(screen.getByText('No actions on this object.')).toBeInTheDocument();

    // Control: back on its own object, it is still there, still unsent.
    rerender(<ObjectActionsPanel draft={draft} onPatch={onPatch} />);
    expect(screen.getByTestId('action-not-saved')).toHaveTextContent('Not saved — needs “Modal / page name”');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('“Change a picklist field” is disabled, saying what it needs, when no picklist is the author’s to change', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={bareDraft} />);
    openNew();
    const change = presetButton('change_choice');
    // `sync_state`, `priority` and `stage` are picklists — but the platform's,
    // hidden and read-only.
    expect(change).toBeDisabled();
    expect(change).toHaveAccessibleDescription('Needs a picklist field on this object.');
    fireEvent.click(change);
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText('No actions on this object.')).toBeInTheDocument();
    // A preset that needs no field is still offered.
    expect(presetButton('run_flow')).toBeEnabled();
  });
});

describe('the preset module’s written-out tables agree with the spec (objectui#11861)', () => {
  const seed = { name: 'invoice_action_2', label: 'New action', objectName: 'invoice', locations: ['record_header'] };
  const refusedAt = (action: unknown, path: string) => {
    const parsed = ActionSchema.safeParse(action);
    return !parsed.success && parsed.error.issues.some((i) => i.path.join('.') === path);
  };

  it.each(ActionType.options.map((type) => [type] as const))(
    '%s: held for its target exactly when the spec refuses it without one',
    (type) => {
      const needs = refusedAt({ ...seed, type }, 'target');
      expect(heldInputKey({ ...seed, type }) !== null).toBe(needs);
      // With a target, the spec has nothing to say at `target`, and nothing is held.
      // A `url` target is a path since `@objectstack/spec` 18, which refuses a bare
      // relative one at `target` (objectui#12030); every other type takes a name.
      const target = type === 'url' ? '/x_target' : 'x_target';
      expect(refusedAt({ ...seed, type, target }, 'target')).toBe(false);
      expect(heldInputKey({ ...seed, type, target })).toBeNull();
    },
  );

  it('every type the table names is an ActionType, and names an input the editor labels', () => {
    for (const [type, key] of Object.entries(TARGET_INPUT_KEYS)) {
      expect(ActionType.options as readonly string[]).toContain(type);
      expect(t(key, EN)).not.toBe(key);
    }
    // Control: the spec's default type, and the declarative write on it, need none.
    expect(heldInputKey({ ...seed, operation: 'update', patch: {} })).toBeNull();
    expect(refusedAt({ ...seed, operation: 'update', patch: {} }, 'target')).toBe(false);
  });

  it.each(['status', 'st', 's', 'Status', '_status', 'status_2', '2status', 'sta-tus'].map((n) => [n] as const))(
    'a picklist named %s is offered exactly when the spec accepts it as a param field',
    (name) => {
      const change = ACTION_PRESETS.find((p) => p.id === 'change_choice')!;
      const fields: ActionPresetFieldOpt[] = [{ name, type: 'select', label: 'Status' }];
      const accepted = !refusedAt({ ...seed, operation: 'update', params: [{ field: name }] }, 'params.0.field');
      expect(change.plan(fields, EN).ready).toBe(accepted);
    },
  );
});
