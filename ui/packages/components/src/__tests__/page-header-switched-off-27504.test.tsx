/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27504 — a packaged action the installation switched off is not
 * offered on the record header (`page:header`) or in an `action:bar`.
 *
 * The platform serves the switched-off names beside the object document and
 * the data layer stamps those entries (`markSwitchedOffActions`); both
 * surfaces ask `isActionSwitchedOff` beside their capability gate. Before this,
 * the button stayed live and a click only met the door's 409.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry, markSwitchedOffActions } from '@object-ui/core';
import { ActionProvider } from '@object-ui/react';
// The renderers register on import; this file is not in the dom-heavy set.
import '../renderers';

function Node({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get(schema.type);
  if (!Component) throw new Error(`${schema.type} not registered`);
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

const served = (switchedOff: string[]) =>
  markSwitchedOffActions(
    {
      name: 'showcase_task',
      actions: [
        { name: 'showcase_mark_done', label: 'Mark Done', type: 'script', locations: ['record_header'] },
        { name: 'showcase_log_time', label: 'Log Time', type: 'script', locations: ['record_header'] },
      ],
    },
    switchedOff,
  ).actions;

const renderIn = (schema: any) =>
  render(<ActionProvider context={{ user: { id: 'u1' } } as any}><Node schema={schema} /></ActionProvider>);

const markDone = () => screen.queryByRole('button', { name: /Mark Done/i });

describe.each([
  ['page:header', (actions: any[]) => ({ type: 'page:header', title: 'Task', actions })],
  ['action:bar', (actions: any[]) => ({ type: 'action:bar', location: 'record_header', actions })],
])('%s — switched-off packaged action (objectstack#27504)', (_type, schemaOf) => {
  it('does not offer an action the platform served as switched off', () => {
    renderIn(schemaOf(served(['showcase_mark_done'])));
    expect(markDone()).toBeNull();
    // A filter, not a blank bar: its sibling still renders.
    expect(screen.getByRole('button', { name: /Log Time/i })).toBeTruthy();
  });

  it('offers it again once the served state no longer names it', () => {
    renderIn(schemaOf(served([])));
    expect(markDone()).toBeTruthy();
  });
});
