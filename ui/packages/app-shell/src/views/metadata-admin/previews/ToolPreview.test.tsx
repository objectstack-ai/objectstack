// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ToolPreview must not advertise retired `ToolSchema` flags (objectui#3236).
 *
 * `tool.requiresConfirmation` (objectstack#3715, ADR-0033 §2) and
 * `tool.category` / `tool.active` / `tool.builtIn` (objectstack#3896 audit
 * close-out) were removed from `@objectstack/spec`. `ToolSchema` is now
 * `.strict()` and rejects each by name, so no *new* tool metadata can carry
 * them — but stored rows authored before the removal still do, and the
 * preview kept reading them off the raw draft and painting pills.
 *
 * That is the objectui#2962 shape: a UI badge advertising a capability the
 * runtime never had. `Requires confirmation` promised a pause that no
 * execution path performs (the real gate is `action.ai.requiresConfirmation`
 * plus the HITL approval queue), and `Disabled` claimed a withdrawal while
 * `ToolRegistry.getAll()` kept handing the tool to the LLM and
 * `POST /ai/tools/:name/execute` kept running it.
 *
 * These tests feed the preview a STALE draft that still carries all four keys
 * and assert nothing renders from them. They are the pin that stops the pills
 * growing back: the names survive in the spec's tombstone guidance, so the
 * next reader has a plausible reason to "restore" them.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ToolPreview } from './ToolPreview';
import { componentRefToUrlSegments } from '../../../services/componentRegistry';

afterEach(cleanup);

/** A draft as an author wrote it *before* the spec removals — every retired key present. */
const STALE_DRAFT = {
  name: 'delete_all_orders',
  label: 'Delete All Orders',
  description: 'Permanently removes every order matching the filter.',
  category: 'data',
  active: false,
  builtIn: true,
  requiresConfirmation: true,
  objectName: 'sales_order',
  parameters: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', description: 'Filter by status' },
    },
  },
} satisfies Record<string, unknown>;

function renderPreview(draft: Record<string, unknown>) {
  return render(
    <ToolPreview type="tool" name="delete_all_orders" draft={draft} />,
  );
}

describe('ToolPreview does not render retired ToolSchema flags', () => {
  it('renders no confirmation badge for a stale draft with requiresConfirmation: true', () => {
    renderPreview(STALE_DRAFT);
    // The badge claimed a safety pause that no execution path has ever
    // performed — never show it, whatever the stored row says.
    expect(screen.queryByText(/requires confirmation/i)).toBeNull();
    expect(screen.queryByText(/confirm/i)).toBeNull();
  });

  it('renders no Active/Disabled badge — `active` withdrew nothing', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText(/^Disabled$/)).toBeNull();
    expect(screen.queryByText(/^Active$/)).toBeNull();
  });

  it('renders no built-in or category badge', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.queryByText(/built-in/i)).toBeNull();
    expect(screen.queryByText(/^data$/)).toBeNull();
  });

  it('an `active: true` draft gets no badge either — the key is gone, not inverted', () => {
    renderPreview({ ...STALE_DRAFT, active: true, requiresConfirmation: false, builtIn: false });
    expect(screen.queryByText(/^Active$/)).toBeNull();
    expect(screen.queryByText(/requires confirmation/i)).toBeNull();
  });
});

describe('ToolPreview still renders everything the spec accepts', () => {
  it('keeps label, machine name, description and the live objectName pill', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.getByText('Delete All Orders')).toBeTruthy();
    expect(screen.getByText('delete_all_orders')).toBeTruthy();
    expect(
      screen.getByText('Permanently removes every order matching the filter.'),
    ).toBeTruthy();
    // `objectName` is NOT residue — ToolSchema still accepts it.
    expect(screen.getByText('sales_order')).toBeTruthy();
  });

  it('still renders the parameters table and the example LLM call', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.getByText('Input Parameters')).toBeTruthy();
    expect(screen.getByText('status')).toBeTruthy();
    expect(screen.getByText('Example LLM Call')).toBeTruthy();
  });

  it('drops the pill row entirely when objectName is absent', () => {
    const noObject: Record<string, unknown> = { ...STALE_DRAFT };
    delete noObject.objectName;
    renderPreview(noObject);
    expect(screen.queryByText('sales_order')).toBeNull();
    expect(screen.getByText('Delete All Orders')).toBeTruthy();
  });
});

/**
 * "Open in API Console" (objectui#10591).
 *
 * The link was the bare `/developer/api-console?path=…`. The console declares
 * no root `/developer` route, so its catch-all sent the author home. It now
 * points at the `developer:api-console` registry key inside the app the author
 * is in, carrying the request preset `ApiConsolePage` reads on mount. That the
 * URL reaches the page through the console's real route table, pre-filled, is
 * pinned beside `ApiConsolePage` in `apps/console`; these pins hold the link.
 *
 * The preview runs inside a real `MemoryRouter`, under the same
 * `/apps/:appName/*` shape the console mounts `ResourceEditPage` at.
 */
describe('ToolPreview "Open in API Console" link (objectui#10591)', () => {
  function renderAt(
    url: string,
    { basename, name = 'delete_all_orders' }: { basename?: string; name?: string } = {},
  ) {
    const preview = <ToolPreview type="tool" name={name} draft={{ ...STALE_DRAFT, name }} />;
    return render(
      <MemoryRouter basename={basename} initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:appName/*" element={preview} />
          <Route path="*" element={preview} />
        </Routes>
      </MemoryRouter>,
    );
  }

  const link = () => screen.getByRole('link', { name: /open in api console/i });
  const target = () => new URL(link().getAttribute('href') ?? '', 'http://console.test');

  it('points at the API console registry key inside the current app', () => {
    renderAt('/apps/studio/metadata/tool/delete_all_orders');
    expect(target().pathname).toBe('/apps/studio/component/developer/api-console');
  });

  it('is the component URL of the `developer:api-console` key, the one Studio navigation names', () => {
    renderAt('/apps/studio/metadata/tool/delete_all_orders');
    expect(target().pathname).toBe(
      `/apps/studio/component/${componentRefToUrlSegments('developer:api-console').join('/')}`,
    );
  });

  it('stays in whichever app the author is in', () => {
    renderAt('/apps/com.acme.crm/metadata/tool/delete_all_orders');
    expect(target().pathname).toBe('/apps/com.acme.crm/component/developer/api-console');
  });

  it("carries the tool's execute path and the POST verb as the request preset", () => {
    renderAt('/apps/studio/metadata/tool/delete_all_orders');
    expect(target().searchParams.get('path')).toBe('/api/v1/ai/tools/delete_all_orders/execute');
    expect(target().searchParams.get('method')).toBe('POST');
  });

  it('round-trips a tool name that needs escaping exactly', () => {
    renderAt('/apps/studio/metadata/tool/x', { name: 'odd name&x=1' });
    expect(target().searchParams.get('path')).toBe(
      `/api/v1/ai/tools/${encodeURIComponent('odd name&x=1')}/execute`,
    );
    expect(target().searchParams.get('x')).toBeNull();
  });

  it("applies the router's basename, so a console mounted under /_console stays inside it", () => {
    renderAt('/_console/apps/studio/metadata/tool/delete_all_orders', { basename: '/_console' });
    expect(target().pathname).toBe('/_console/apps/studio/component/developer/api-console');
  });

  it('still opens in a new tab', () => {
    renderAt('/apps/studio/metadata/tool/delete_all_orders');
    expect(link().getAttribute('target')).toBe('_blank');
    expect(link().getAttribute('rel')).toBe('noreferrer');
  });

  it('draws no link on a route that names no app', () => {
    renderAt('/somewhere/else');
    expect(screen.getByText('Delete All Orders')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open in api console/i })).toBeNull();
  });

  it('draws no link, and does not throw, with no router above it (the designer gallery)', () => {
    renderPreview(STALE_DRAFT);
    expect(screen.getByText('Delete All Orders')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /open in api console/i })).toBeNull();
  });
});
