/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * "A `defaultValues` reset is not a user edit" must hold for EVERY caller —
 * memoized or not (#5235).
 *
 * The renderer publishes three notification channels around a reset, and until
 * this card they were driven two different ways:
 *
 *   - `onDirtyChange` — driven EXPLICITLY: the reset effect computes dirtiness
 *     against the baseline it just installed and calls the callback outright.
 *     Identity-independent by construction.
 *   - `onChange` and `onAction({ type: 'form_change' })` — rode on React's
 *     effect ordering. Every layout DESTROY runs before any layout CREATE, so a
 *     caller passing a FRESH callback each render had its subscription torn
 *     down before the reset and re-established after. The guarantee was
 *     delivered by the callback's IDENTITY CHANGING — so a caller who wrapped
 *     the same callback in `React.useCallback` (taught everywhere as a pure
 *     performance optimization) kept one identity, the effect never re-ran, the
 *     subscription stayed live across the reset, and the record landing came
 *     back to the host as if the user had edited every field it filled — the
 *     exact failure #2968 was filed about.
 *
 * Both shapes are exercised below against the same script — mount, user edit,
 * record lands, user edit — and asserted on the same expected sequences. That
 * symmetry IS the pin: the two runs may not disagree.
 *
 * ⛔ Out of scope, and deliberately not asserted here: whether these channels
 * SHOULD report a programmatic reset. That is a contract change and #5235 left
 * it open. These tests pin the answer the file already gave (they do not) and
 * only remove its dependence on caller identity.
 *
 * Note on `onDirtyChange`: its PAYLOAD is identity-independent (always `false`
 * for a reset that carried nothing) but its call COUNT is not — a memoized
 * caller also hears the reset through the unconditional dirty subscription,
 * with the same `false`. That duplicate is pre-existing, harmless and outside
 * this card, so these tests assert the payloads rather than freezing a count
 * that differs by caller shape.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

type Rec = Record<string, unknown>;
type Channel = 'onChange' | 'form_change' | 'onDirtyChange';
type Ev = { channel: Channel; payload: unknown };

const FIELDS = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'note', label: 'Note', type: 'input' },
];

const nameInput = (root: ParentNode) =>
  root.querySelector('input[name="name"]') as HTMLInputElement | null;

/**
 * One host, two caller shapes. `memoized` passes callbacks with a STABLE
 * identity (`useCallback(fn, [])` — the shape that silently turned the
 * guarantee off); `inline` passes a fresh arrow each render (the shape the
 * effect ordering happened to serve). Everything else is byte-identical, so a
 * behavioural difference between the two runs can only be caller identity.
 */
function mountHost(shape: 'memoized' | 'inline') {
  const events: Ev[] = [];
  const push = (channel: Channel, payload: unknown) => { events.push({ channel, payload }); };
  let setDefaults!: (v: Rec) => void;

  const Host = () => {
    const [defaults, setD] = React.useState<Rec>({});
    setDefaults = setD;
    const memoOnChange = React.useCallback((values: Rec) => { push('onChange', values); }, []);
    const memoOnDirtyChange = React.useCallback((dirty: boolean) => { push('onDirtyChange', dirty); }, []);
    const memoOnAction = React.useCallback((action: { type?: string; data?: Rec }) => {
      if (action?.type === 'form_change') push('form_change', action.data);
    }, []);
    const Form = ComponentRegistry.get('form') as React.ComponentType<Rec>;
    return (
      <Form
        schema={{
          type: 'form',
          fields: FIELDS,
          defaultValues: defaults,
          showSubmit: false,
          onChange:
            shape === 'memoized'
              ? memoOnChange
              : (values: Rec) => { push('onChange', values); },
          onDirtyChange:
            shape === 'memoized'
              ? memoOnDirtyChange
              : (dirty: boolean) => { push('onDirtyChange', dirty); },
        }}
        onAction={
          shape === 'memoized'
            ? memoOnAction
            : (action: { type?: string; data?: Rec }) => {
                if (action?.type === 'form_change') push('form_change', action.data);
              }
        }
      />
    );
  };

  const utils = render(<Host />);
  const on = (channel: Channel, from = 0) =>
    events.slice(from).filter((e) => e.channel === channel).map((e) => e.payload);
  return { ...utils, events, on, setDefaults: (v: Rec) => setDefaults(v) };
}

describe.each(['memoized', 'inline'] as const)(
  'form renderer — a defaultValues reset is not a user edit (%s callbacks)',
  (shape) => {
    it('reports the user edit, stays silent through the record landing, then reports the next edit', async () => {
      const { container, events, on, setDefaults } = mountHost(shape);
      await waitFor(() => {
        if (!nameInput(container)) throw new Error('not ready');
      });
      await act(async () => {});
      events.length = 0;

      // ── 1. The user edits a field. All three channels report it. ──────────
      fireEvent.change(nameInput(container)!, { target: { value: 'Typed' } });
      await waitFor(() => expect(on('onChange').length).toBeGreaterThan(0));

      // `toStrictEqual` so an extra key in the payload is a failure: the
      // declared contract hands the host the FORM VALUES, and `note` is
      // present-but-unset (`undefined`), not absent.
      expect(on('onChange')).toStrictEqual([{ name: 'Typed', note: undefined }]);
      expect(on('form_change')).toStrictEqual([{ name: 'Typed', note: undefined }]);
      expect(on('onDirtyChange')).toStrictEqual([true]);

      // ── 2. The record finishes loading and the form resets to it. ─────────
      // The host's own data arriving, not the user typing.
      const beforeReset = events.length;
      await act(async () => { setDefaults({ name: 'Loaded', note: 'from server' }); });

      // The reset really happened — this pins the ordering, not the absence of
      // the reset.
      await waitFor(() => expect(nameInput(container)!.value).toBe('Loaded'));

      // ...and NOTHING about it reached the two value channels, for either
      // caller shape. Pre-fix the memoized run collects
      // `[{ name: 'Loaded', note: 'from server' }]` on both.
      expect(on('onChange', beforeReset)).toEqual([]);
      expect(on('form_change', beforeReset)).toEqual([]);

      // The dirty channel is the one that IS driven explicitly, and it says the
      // form is pristine against the record it just received. Payload-exact;
      // see the header note on why the count is not frozen here.
      const dirtyDuringReset = on('onDirtyChange', beforeReset);
      expect(dirtyDuringReset.length).toBeGreaterThan(0);
      expect(dirtyDuringReset.every((d) => d === false)).toBe(true);

      // No event of any other kind slipped through in that window.
      expect(
        events.slice(beforeReset).every((e) => e.channel === 'onDirtyChange'),
      ).toBe(true);

      // ── 3. The channels are not left muted — the next real edit reports. ──
      const beforeEdit = events.length;
      fireEvent.change(nameInput(container)!, { target: { value: 'Edited' } });
      await waitFor(() => expect(on('onChange', beforeEdit).length).toBeGreaterThan(0));

      expect(on('onChange', beforeEdit)).toStrictEqual([{ name: 'Edited', note: 'from server' }]);
      expect(on('form_change', beforeEdit)).toStrictEqual([{ name: 'Edited', note: 'from server' }]);
      expect(on('onDirtyChange', beforeEdit)).toStrictEqual([true]);
    });
  },
);
