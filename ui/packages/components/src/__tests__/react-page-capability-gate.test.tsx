/**
 * The `kind:'react'` page tier is off unless the host turns it on.
 *
 * A react page's source runs in the application with no sandbox, so
 * `CAP_REACT_PAGES` defaults off in `@object-ui/core`. These cases render a
 * real react page through the real `type:'home'` PageRenderer, with nothing
 * but the capability changed: by default it draws the notice that names the
 * server switch and never runs the source; once the host enables the
 * capability (the global the ObjectStack server writes, or
 * `enableCapability`), the same source runs.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { CAP_REACT_PAGES, disableCapability, enableCapability } from '@object-ui/core';
import { SchemaRenderer, AdapterCtx } from '@object-ui/react';
import type { PageDocumentNode } from '@object-ui/types';
// Registers PageRenderer for `type:'home'`, which dispatches kind:'react'.
import '../renderers';
// The runtime chunk the page loads once enabled, imported here so its cold
// transform is not billed to a `findBy` window.
import '@object-ui/react-runtime';

const adapter = { find: async () => [] } as any;

const SCHEMA: PageDocumentNode = {
  type: 'home',
  kind: 'react',
  name: 'gate_page',
  label: 'Gate page',
  source: `function Page() { return <p data-testid="ran">ran</p>; }`,
};

function Host() {
  return (
    <AdapterCtx.Provider value={adapter}>
      <SchemaRenderer schema={SCHEMA} />
    </AdapterCtx.Provider>
  );
}

afterEach(() => cleanup());

describe('the react-pages capability gate', () => {
  it('is closed by default: the page draws the notice naming the switch and never runs', async () => {
    const { findByText, queryByTestId, container } = render(<Host />);
    expect(await findByText('React pages are disabled on this deployment')).toBeTruthy();
    expect(container.textContent).toContain('OS_PAGE_REACT_ENABLED=true');
    expect(queryByTestId('ran')).toBeNull();
  });

  it('runs the same page once the host enables the capability, and closes again when it is disabled', async () => {
    enableCapability(CAP_REACT_PAGES);
    const first = render(<Host />);
    expect((await first.findByTestId('ran')).textContent).toBe('ran');
    first.unmount();

    disableCapability(CAP_REACT_PAGES);
    const second = render(<Host />);
    expect(await second.findByText('React pages are disabled on this deployment')).toBeTruthy();
    expect(second.queryByTestId('ran')).toBeNull();
  });
});
