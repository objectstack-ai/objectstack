/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A protocol placeholder never takes a key a pending lazy stub owns
 * (objectui#11680).
 *
 * The console declares `view:calendar` and `view:timeline` as `registerLazy`
 * stubs and then calls `registerPlaceholders()`, after every real registration,
 * as its `main.tsx` requires. The placeholder registrar's guard asked `get()`,
 * which answers for LOADED registrations only, so both keys read as free. The
 * placeholder took them, the registry cleared the stubs under those keys, and
 * every boot logged the registry's race warning once for each key. An authored
 * `view:calendar` then drew the dashed placeholder until some other node
 * happened to load the calendar chunk.
 *
 * The stubs here are declared with the console's arguments and land the way
 * the two plugins register, `register(NAME, R, { namespace: 'view' })`. A chunk
 * lands only when the test says so, so "before the chunk has loaded" and
 * "after" are both observable, through the real registrar and the real
 * `SchemaRenderer`.
 *
 * Both load orders are replayed. The console's boot order (stub still pending
 * when the placeholders register) is the one that failed. The other order
 * (chunk already loaded) is the control: the loaded-only guard always handled
 * it, and the stub-aware guard must not change it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
import type { BaseSchema } from '@object-ui/types';
import { PlaceholderRenderer, registerPlaceholders } from '../renderers/placeholders';

/**
 * The two node types this file's stand-in plugins register, declared to
 * `@object-ui/types` the way an application declares a type it registers
 * (objectui#11466): `SchemaRenderer`'s `schema` prop takes declared node types
 * only.
 */
declare module '@object-ui/types' {
  interface CustomNodeRegistry {
    'view:calendar': BaseSchema;
    'view:timeline': BaseSchema;
  }
}

/** The two protocol keys a console stub declares: [authored key, registered name]. */
const CONTESTED: Array<[authored: 'view:calendar' | 'view:timeline', name: string]> = [
  ['view:calendar', 'calendar'],
  ['view:timeline', 'timeline'],
];

/** The registry's own race detector, the warning objectui#11680 reported. */
const RACE_WARNING = 'bare-name fallback is being overwritten';

function raceWarnings(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls
    .map((args: unknown[]) => (typeof args[0] === 'string' ? args[0] : ''))
    .filter((text: string) => text.includes(RACE_WARNING));
}

/**
 * Declare `name` the way the console does, behind a chunk that lands on
 * command and then registers the plugin's renderer the way the plugin does.
 */
function declareGatedStub(name: string) {
  let land!: () => void;
  const gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  const Plugin = () => <div data-testid={`plugin-${name}`} />;
  ComponentRegistry.registerLazy(
    name,
    async () => {
      await gate;
      ComponentRegistry.register(name, Plugin, { namespace: 'view', category: 'view' });
    },
    { namespace: 'view', category: 'view' },
  );
  return { land, Plugin };
}

afterEach(() => {
  // Unmount first: an unregister notifies the registry's subscribers, and a
  // renderer still mounted would re-render outside act().
  cleanup();
  // Every key either generation of the guard can leave behind, on both tables.
  for (const [authored, name] of CONTESTED) {
    ComponentRegistry.unregister(name, 'view');
    ComponentRegistry.unregister(name);
    ComponentRegistry.unregister(authored, 'protocol-placeholder');
    ComponentRegistry.unregister(authored);
  }
});

describe('a protocol placeholder never takes a key a pending lazy stub owns (objectui#11680)', () => {
  it.each(CONTESTED)(
    '%s stays with its pending stub when the placeholders register (the console boot order)',
    async (authored, name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { land, Plugin } = declareGatedStub(name);
        registerPlaceholders();
        expect(raceWarnings(warn), 'registering the placeholders raced the stub').toEqual([]);

        // Before the chunk loads, the key is still the stub's.
        expect(ComponentRegistry.get(authored)).not.toBe(PlaceholderRenderer);
        expect(ComponentRegistry.hasLazy(authored)).toBe(true);

        // An authored node goes through the stub, which loads the plugin.
        const before = render(<SchemaRenderer schema={{ type: authored }} />);
        expect(before.container.textContent).not.toContain('Component Placeholder');
        land();
        expect(await before.findByTestId(`plugin-${name}`)).toBeTruthy();

        // After the chunk has loaded, the same renderer answers directly.
        expect(ComponentRegistry.get(authored)).toBe(Plugin);
        const after = render(<SchemaRenderer schema={{ type: authored }} />);
        expect(within(after.container).getByTestId(`plugin-${name}`)).toBeTruthy();

        // Nor does the chunk landing: its registration names the stub's own type.
        expect(raceWarnings(warn), 'the registry reported a race over the key').toEqual([]);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it.each(CONTESTED)(
    '%s keeps the plugin when its chunk loaded before the placeholders registered (control)',
    async (authored, name) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { land, Plugin } = declareGatedStub(name);
        land();
        await ComponentRegistry.loadLazy(authored);
        expect(ComponentRegistry.get(authored)).toBe(Plugin);

        registerPlaceholders();

        expect(ComponentRegistry.get(authored)).toBe(Plugin);
        const view = render(<SchemaRenderer schema={{ type: authored }} />);
        expect(within(view.container).getByTestId(`plugin-${name}`)).toBeTruthy();
        expect(raceWarnings(warn), 'the registry reported a race over the key').toEqual([]);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('still registers the placeholder for a protocol key nothing owns (control)', () => {
    // `view:kanban` has no stub and no renderer in this file, so the guard must
    // let the placeholder in: owning nothing is not the same as owned.
    registerPlaceholders();
    expect(ComponentRegistry.get('view:kanban')).toBe(PlaceholderRenderer);
  });
});
