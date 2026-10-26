// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WIDGETS, resolveStoredViewRef } from './widgets';
import { loaded } from './loadState';

afterEach(cleanup);

const ViewRef = WIDGETS['view-ref'];

/**
 * ADR-0047 `view-ref` widget — picks `interfaceConfig.sourceView` from the
 * source object's views (context.objectViews) instead of a free-text name the
 * author could mistype. Radix Select portals its option list on open (flaky in
 * jsdom), so these tests cover the parts that render eagerly: the registry
 * wiring, the closed trigger, and graceful degradation with no views.
 */
describe('view-ref widget', () => {
  it('is registered in the WIDGETS map', () => {
    expect(ViewRef).toBeTypeOf('function');
  });

  it('renders a combobox trigger when views are available', () => {
    render(
      <ViewRef
        value="default"
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', objectViews: loaded([
          { name: 'default', label: 'All records' },
          { name: 'mine', label: 'My records' },
        ]) }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders (does not crash) when no source object / views are bound', () => {
    render(
      <ViewRef
        value={undefined}
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', objectViews: loaded([]) }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders with an out-of-catalog value without throwing (stale value survives)', () => {
    render(
      <ViewRef
        value="renamed_view"
        onChange={() => {}}
        schema={{ type: 'string' }}
        context={{ conditionScope: 'flattened', objectViews: loaded([{ name: 'default', label: 'All records' }]) }}
      />,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});


/**
 * resolveStoredViewRef mirrors the runtime InterfaceListPage.resolveSourceView so
 * the editor doesn't mislabel a working stored value (e.g. bare `default`) as
 * "(not in object)". View metadata names are object-prefixed FQNs.
 */
describe('resolveStoredViewRef', () => {
  const views = [
    { name: 'showcase_task.default', label: 'All Tasks' },
    { name: 'showcase_task.board', label: 'Board (Kanban)' },
  ];

  it('resolves a bare name via the `<object>.<name>` suffix and exposes the matched view', () => {
    const r = resolveStoredViewRef(views, 'board');
    expect(r.resolves).toBe(true);
    expect(r.suffixMatch?.name).toBe('showcase_task.board');
    expect(r.showStored).toBe(true); // not an exact catalog entry → synthesize an item
  });

  it('resolves an exact FQN without needing a synthesized item', () => {
    const r = resolveStoredViewRef(views, 'showcase_task.default');
    expect(r.exact?.name).toBe('showcase_task.default');
    expect(r.resolves).toBe(true);
    expect(r.showStored).toBe(false);
  });

  it('treats `default`/`list` as special-case resolvable even without a suffix match', () => {
    expect(resolveStoredViewRef([], 'default').resolves).toBe(true);
    expect(resolveStoredViewRef([], 'list').resolves).toBe(true);
  });

  it('flags a truly unknown value as unresolved (gets the not-in-object tag)', () => {
    const r = resolveStoredViewRef(views, 'typo_view');
    expect(r.resolves).toBe(false);
    expect(r.suffixMatch).toBeUndefined();
    expect(r.showStored).toBe(true);
  });

  it('an empty value resolves to nothing and needs no synthesized item', () => {
    const r = resolveStoredViewRef(views, '');
    expect(r.resolves).toBe(false);
    expect(r.showStored).toBe(false);
  });
});
