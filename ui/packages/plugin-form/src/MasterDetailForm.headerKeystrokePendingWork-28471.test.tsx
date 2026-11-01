/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A keystroke in a master-detail header reaches the header's form even when
 * the page has other work pending at that instant (objectstack#28471).
 *
 * The form host's `input` listener (the scrape that feeds the line grids'
 * `parent`) runs BEFORE React's root listener, because the host sits inside
 * the React root. In a browser, the microtask checkpoint between those two
 * listeners flushed the scrape's update, which was sync priority, together
 * with the page's pending default-priority work. That render repainted the
 * header input with its old controlled value, React's value tracker then saw
 * no change, and the keystroke never reached react-hook-form: the live
 * showcase page's Create failed "Project Name is required" with no request.
 *
 * happy-dom runs every listener of a dispatch inside one JS call, with no
 * microtask checkpoint between them, so this file supplies the checkpoint: a
 * listener on the element between the host and the React root calls
 * `flushSync()`, which flushes exactly the work React's microtask would. The
 * pending work is a page re-render scheduled just before the keystroke.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { flushSync } from 'react-dom';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

type Props = React.ComponentProps<typeof MasterDetailForm>;

const INV_SCHEMA = { name: 'inv', fields: { status: { type: 'text', label: 'Status' } } };

const SCHEMA = {
  objectName: 'inv',
  mode: 'create',
  fields: ['status'],
  details: [
    {
      childObject: 'inv_line',
      relationshipField: 'inv',
      columns: [
        { name: 'product', label: 'Product', type: 'text' },
        { name: 'qty', label: 'Qty', type: 'number', readonlyWhen: "parent.status == 'paid'" },
      ],
    },
  ],
} as unknown as Props['schema'];

function dataSource() {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(INV_SCHEMA),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  } as unknown as Props['dataSource'];
}

/** The page around the form; `bump.current()` schedules a re-render of it. */
const bump = { current: () => {} };
function Page({ ds }: { ds: Props['dataSource'] }) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    bump.current = () => setN((x) => x + 1);
  }, []);
  return <MasterDetailForm schema={{ ...SCHEMA, className: `page-${n}` }} dataSource={ds} />;
}

/**
 * Type `value` into `input` the way a browser delivers a keystroke, with the
 * two pieces of browser behaviour happy-dom leaves out:
 *
 * - `window.event` is the event while it is dispatched. React reads it to
 *   price an update scheduled from a non-React listener; without it every
 *   such update is default priority and nothing is flushed mid-dispatch.
 * - A microtask checkpoint runs after each listener, where React flushes its
 *   sync work. `checkpointAt` gets a bubble listener that does that flush,
 *   so it falls after the listeners below it and before those above it.
 *
 * The native value changes first, past React's value tracker (which sees
 * only writes through its own setter), then one bubbling `input` event.
 */
function typeLikeABrowser(input: HTMLInputElement, value: string, checkpointAt: HTMLElement) {
  const before = Object.getOwnPropertyDescriptor(window, 'event');
  const checkpoint = () => flushSync(() => {});
  const ev = new Event('input', { bubbles: true });
  Object.defineProperty(window, 'event', { configurable: true, get: () => ev });
  checkpointAt.addEventListener('input', checkpoint);
  try {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(ev);
  } finally {
    checkpointAt.removeEventListener('input', checkpoint);
    if (before) Object.defineProperty(window, 'event', before);
    else delete (window as { event?: unknown }).event;
  }
}

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const actEnvBefore = actEnv.IS_REACT_ACT_ENVIRONMENT;
afterEach(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = actEnvBefore;
});

describe('MasterDetailForm — a header keystroke is never dropped (objectstack#28471)', () => {
  it('keeps the typed value when the page has default-priority work pending at the keystroke', async () => {
    const { container } = render(<Page ds={dataSource()} />);
    const status = await waitFor(() => {
      const el = container.querySelector('input[name="status"]') as HTMLInputElement | null;
      if (!el) throw new Error('header not ready');
      return el;
    });
    const qty = () => screen.getAllByLabelText('Qty')[0] as HTMLInputElement;
    await waitFor(() => expect(qty().disabled).toBe(false));

    // The element right under the React root container: above the form host,
    // below React's root listener — where the browser's checkpoint fell.
    let checkpointAt: HTMLElement = status;
    while (checkpointAt.parentElement && checkpointAt.parentElement !== container) {
      checkpointAt = checkpointAt.parentElement;
    }

    // The page's pending work is a real default-priority update, the kind a
    // landing fetch schedules, so it is scheduled outside `act`.
    actEnv.IS_REACT_ACT_ENVIRONMENT = false;
    bump.current();
    typeLikeABrowser(status, 'paid', checkpointAt);
    actEnv.IS_REACT_ACT_ENVIRONMENT = actEnvBefore;

    // The keystroke reached the form: the input still shows it once the
    // pending work and the lines' update have rendered…
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(status.value).toBe('paid');
    // …and the lines read the same header the form holds.
    await waitFor(() => expect(qty().disabled).toBe(true));
  });
});
