/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36049 — the record header's Edit is an outline button and the
 * desktop header row is one height, 28 (`sm:h-7`).
 *
 * Before: on a record whose object declares no header action, the host's Edit
 * was the row's pick and drew as the one filled button (36 high), louder than
 * the record's name. Now it is outline; the page's own actions keep their
 * pick and their faces (a declared `variant: 'primary'` stays filled), only
 * their height follows the row. An action declaring its own `size` keeps it.
 * The phone's bottom bar is unchanged (`page-header-phone-bar-27058`).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import '../renderers';
import '@object-ui/react-runtime';
import { PanelToggles } from '../custom/panel-toggles';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

const DEAL = { id: 'opp-1', name: 'Acme renewal' };
const HOST_ACTIONS = [
  { name: 'sys_edit', label: 'Edit', icon: 'pencil', order: 100, onClick: vi.fn() },
  { name: 'sys_share', label: 'Share', order: 110, component: 'action:menu', onClick: vi.fn() },
];

function renderHeader(actions: any[]) {
  return render(
    <ActionProvider>
      <RecordContextProvider
        objectName="opportunity"
        recordId={DEAL.id}
        data={DEAL}
        objectSchema={{ name: 'opportunity', label: 'Opportunity' }}
        headerSystemActions={HOST_ACTIONS}
      >
        <PageHeader schema={{ type: 'page:header', actions }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

const act = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'url',
  target: `https://example.com/${name}`,
  locations: ['record_header'],
  ...extra,
});

const button = (name: string) => screen.getByRole('button', { name });
const classes = (b: HTMLElement) => b.className.split(/\s+/);
const isFilled = (b: HTMLElement) => classes(b).includes('bg-primary');
const isOutline = (b: HTMLElement) => classes(b).includes('border-input');
const is28 = (b: HTMLElement) => classes(b).includes('sm:h-7');

describe('page:header — the record Edit is outline, the desktop row 28 high (objectstack#36049)', () => {
  it('a record with no header action: Edit is outline, 28 high, and the ⋯ beside it is 28 too', () => {
    renderHeader([]);
    const edit = button('Edit');
    expect(isFilled(edit)).toBe(false);
    expect(isOutline(edit)).toBe(true);
    expect(is28(edit)).toBe(true);
    expect(is28(button('More actions'))).toBe(true);
  });

  it("a declared `variant: 'primary'` action keeps its filled face; only its height follows the row", () => {
    renderHeader([act('submit_approval', 'Submit for approval', { variant: 'primary' })]);
    const submit = button('Submit for approval');
    expect(isFilled(submit)).toBe(true);
    expect(is28(submit)).toBe(true);
    expect(isOutline(button('Edit'))).toBe(true);
  });

  it('the first page action without a variant is still the filled one (its pick is unchanged)', () => {
    renderHeader([act('convert', 'Convert')]);
    expect(isFilled(button('Convert'))).toBe(true);
    expect(isFilled(button('Edit'))).toBe(false);
  });

  it('an action that declares its own `size` keeps it — no row height is forced on it', () => {
    renderHeader([act('big', 'Big', { size: 'lg' })]);
    expect(is28(button('Big'))).toBe(false);
  });

  it("the trailing panel toggles are 28 high, the row's one height", () => {
    render(
      <PanelToggles
        label="Panels"
        items={[{ id: 'aside', label: 'Right panel', icon: () => null, pressed: true, onPressedChange: () => {} }]}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Right panel' });
    expect(classes(toggle)).toContain('h-7');
    expect(classes(toggle)).not.toContain('h-8');
  });
});
