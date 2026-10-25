/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Each audit log filter control is named by its visible label, as the Object
 * filter already was (objectui#13224).
 *
 * Four of the five filters drew a bare `Label` that named nothing: the Action
 * select, the Actor lookup and the From and To date fields. Assistive
 * technology announced them as an unnamed combobox, an unnamed button and two
 * unnamed date fields, and a label query found no control for any of them.
 *
 * The transport is stubbed at the seams the page reads through, as in the
 * Object filter's suite: the console's metadata cache serves the objects (with
 * `sys_audit_log`'s declared `action` options), `fetch` answers
 * `/data/sys_audit_log`, and the console adapter serves `sys_user` to the
 * actor lookup.
 *
 * Pinned:
 *  - each of Action, Object, Actor, From and To names exactly one control, and
 *    it is that filter's own control: the Action select's trigger, the Object
 *    combobox, the Actor lookup's trigger, and the two date fields;
 *  - the controls found by their labels are the live filters: the action, the
 *    From date and the To date each still send the filter they always sent.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER, OBJECTS } = vi.hoisted(() => {
  const ADMIN = { id: 'usr_admin_0001', name: 'Admin User', email: 'admin@objectos.ai' };
  return {
    ADAPTER: {
      find: async (objectName: string) =>
        objectName === 'sys_user' ? { data: [{ ...ADMIN }], total: 1 } : { data: [], total: 0 },
      findOne: async (objectName: string, id: string) =>
        objectName === 'sys_user' && id === ADMIN.id ? { ...ADMIN } : null,
      getObjectSchema: async (objectName: string) =>
        objectName === 'sys_user'
          ? { name: 'sys_user', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } }
          : undefined,
    },
    OBJECTS: Object.freeze([
      { name: 'crm_account', label: 'Accounts' },
      {
        name: 'sys_audit_log',
        label: 'Audit Log',
        fields: {
          action: {
            type: 'select',
            label: 'Action',
            options: [
              { label: 'create', value: 'create' },
              { label: 'update', value: 'update' },
            ],
          },
        },
      },
    ]),
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: OBJECTS }),
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

/** Every `/data/sys_audit_log` request, as the parsed query string. */
let requests: URLSearchParams[] = [];

/** The `$filter` of the latest request, parsed, or null when it sent none. */
function lastFilter(): unknown {
  const raw = requests[requests.length - 1]?.get('$filter');
  return raw == null ? null : JSON.parse(raw);
}

beforeAll(() => {
  // Radix Select drives its trigger off pointer events, which happy-dom does
  // not implement: the shim the console's other Select-driving tests install.
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    constructor(type: string, props: { button?: number; ctrlKey?: boolean; pointerType?: string } & EventInit = {}) {
      super(type, props);
      this.button = props.button ?? 0;
      this.ctrlKey = props.ctrlKey ?? false;
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = MockPointerEvent;
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture = vi.fn();
  proto.releasePointerCapture = vi.fn();
  proto.scrollIntoView = vi.fn();
});

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(new URL(String(input), 'http://console.test').searchParams);
      return new Response(JSON.stringify({ object: 'sys_audit_log', records: [], total: 0 }), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function renderPage(): void {
  render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

/** The one control a visible filter label names; fails unless it names exactly one. */
function controlLabelled(label: string): HTMLElement {
  const controls = screen.queryAllByLabelText(label, { exact: true });
  expect(controls, `the "${label}" label names exactly one control`).toHaveLength(1);
  return controls[0];
}

describe('AuditLogPage — each filter control is named by its visible label (objectui#13224)', () => {
  it('Action, Object, Actor, From and To each name exactly one control, their own', async () => {
    renderPage();
    await settle();

    const action = controlLabelled('Action');
    const object = controlLabelled('Object');
    const actor = controlLabelled('Actor');
    const from = controlLabelled('From');
    const to = controlLabelled('To');

    // The Action select's trigger, which reads the chosen action.
    expect(action).toHaveAttribute('role', 'combobox');
    expect(action).toHaveTextContent('All actions');
    // The Object filter, unchanged: the combobox that reads "Any object".
    expect(object).toHaveAttribute('role', 'combobox');
    expect(object).toHaveTextContent('Any object');
    // The Actor lookup's trigger button.
    expect(actor).toBe(screen.getByTestId('lookup-trigger-user_id'));
    // The two date fields.
    expect(from).toHaveAttribute('type', 'date');
    expect(to).toHaveAttribute('type', 'date');
    expect(new Set([action, object, actor, from, to]).size).toBe(5);

    // The accessible name assistive technology announces is the label's.
    expect(screen.getByRole('combobox', { name: 'Action' })).toBe(action);
    expect(screen.getByRole('combobox', { name: 'Object' })).toBe(object);
    expect(screen.getByRole('button', { name: 'Actor' })).toBe(actor);
  });

  it('the action control found by its label is the live Action filter', async () => {
    renderPage();
    await settle();

    fireEvent.pointerDown(controlLabelled('Action'), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'update' }));
    });
    await settle();

    await waitFor(() => expect(lastFilter()).toEqual({ action: 'update' }));
  });

  it('the date fields found by their labels are the live From and To filters', async () => {
    renderPage();
    await settle();

    await act(async () => {
      fireEvent.change(controlLabelled('From'), { target: { value: '2026-10-01' } });
    });
    await settle();
    await waitFor(() => expect(lastFilter()).toEqual({ created_at: { $gte: '2026-10-01' } }));

    await act(async () => {
      fireEvent.change(controlLabelled('To'), { target: { value: '2026-10-20' } });
    });
    await settle();
    await waitFor(() =>
      expect(lastFilter()).toEqual({ created_at: { $gte: '2026-10-01', $lte: '2026-10-20T23:59:59' } }),
    );
  });
});
