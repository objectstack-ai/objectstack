/**
 * objectui#12345 — the console's `DevLists` dev route renders, and its
 * `element:repeater` reads `showcase_category` through the node-level
 * `dataSource` binding.
 *
 * The route was the last in-repo producer of the flat `properties.object` /
 * `properties.limit` that `@objectstack/spec` 18 retired from the repeater's
 * row (objectstack#11509, ruled A-narrow). It wrote them through an `as any`
 * cast, which is how the types mirror never saw them. It now writes the
 * binding as a typed `DeclaredNode` literal, and the renderer reads the
 * binding alone, so this pins the producer's half: the dev route still lists
 * the categories, capped at ten, from the binding.
 *
 * Rendered through the real `SchemaRenderer` and the registrations
 * `@object-ui/components` installs, with a recording adapter.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '@object-ui/components';
import { DevLists } from '../dev/DevLists';

afterEach(cleanup);

const CATEGORIES = [
  { id: 'c1', name: 'Hardware', color: 'blue' },
  { id: 'c2', name: 'Software', color: 'green' },
];

function mount() {
  const find = vi.fn(async (_object: string, _query: Record<string, unknown>) => ({
    data: CATEGORIES,
    total: CATEGORIES.length,
  }));
  render(
    <AdapterCtx.Provider value={{ find } as never}>
      <DevLists />
    </AdapterCtx.Provider>,
  );
  return find;
}

describe('the DevLists dev route (objectui#12345)', () => {
  it('renders both list primitives', async () => {
    mount();
    expect(screen.getByTestId('definition-list')).toHaveTextContent('Ada Lovelace');
    await waitFor(() => expect(screen.getByTestId('repeater')).toHaveTextContent('Hardware'));
    expect(screen.getByTestId('repeater')).toHaveTextContent('green');
  });

  it('its repeater reads `showcase_category`, capped at ten, from the `dataSource` binding', async () => {
    const find = mount();
    await waitFor(() => expect(find).toHaveBeenCalled());
    expect(find.mock.calls[0]).toEqual(['showcase_category', { $top: 10 }]);
  });
});
