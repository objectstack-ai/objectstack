// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37858 — the report builder keeps its own Save at the top end
 * corner, the corner the shell's Ask AI fallback takes on a page that draws
 * no button group. The builder replaces the whole page (the new-report page,
 * and the report page's Edit), so its host draws the shell's group at the
 * end of the builder's own header: Discard, Save, then help and Ask AI. The
 * group counts itself, so the corner fallback is not drawn over Save.
 *
 * Real subjects: `ReportBuilderHost`, the real `ReportBuilder`,
 * `ShellPageActionsScope`, `ShellAssistantFallback`, `AssistantTopBarButton`.
 * Fakes: the metadata client (the dataset catalog), the AI surface's answer
 * and the help menu (each pinned in its own file); `t` echoes the inline
 * English default.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';

const client = vi.hoisted(() => {
  const c: Record<string, any> = {
    list: vi.fn(async () => []),
    get: vi.fn(async () => null),
  };
  c.withPreviewDrafts = () => c;
  return c;
});
vi.mock('./metadata-admin/useMetadata.js', () => ({ useMetadataClient: () => client }));
vi.mock('../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: true, loading: false }),
  resolveAiApiBase: () => '/api/v1/ai',
}));
vi.mock('../layout/HelpMenu', () => ({
  HelpMenu: ({ triggerTestId }: { triggerTestId?: string }) => (
    <button type="button" data-testid={triggerTestId ?? 'help'}>
      ?
    </button>
  ),
}));
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => String(o?.defaultValue ?? k),
    language: 'en',
  }),
}));
vi.mock('../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'crm', label: 'CRM' }], objects: [], pages: [] }),
}));

import { ReportBuilderHost } from './ReportBuilderHost';
import { ShellAssistantFallback, ShellPageActionsScope } from '../layout/ShellPageActions';
import { ChatDockControlProvider, type ChatDockControl } from '../layout/chatDockControl';

const CONTROL: ChatDockControl = { expanded: false, fullWindow: false, toggle: () => {}, open: () => {} };
const NEW_REPORT = { name: '', label: '', type: 'summary', dataset: '', values: [], chart: { type: 'metric', xAxis: '', yAxis: '' } };
const setWidth = (value: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });

function builder() {
  return <ReportBuilderHost initial={NEW_REPORT} onSave={async () => true} onClose={() => {}} />;
}

function inShell(node: React.ReactNode) {
  return (
    <MemoryRouter initialEntries={['/apps/crm/reports/new']}>
      <ChatDockControlProvider value={CONTROL}>
        <ShellPageActionsScope on>
          <ShellAssistantFallback />
          {node}
        </ShellPageActionsScope>
      </ChatDockControlProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  ComponentRegistry.register('chart', () => <div data-testid="chart-stub" />);
  setWidth(1280);
});

afterEach(() => {
  cleanup();
  setWidth(1024);
  vi.clearAllMocks();
});

describe('the report builder draws Ask AI in its own header (objectstack#37858)', () => {
  it('Save, then help and Ask AI, at the end of the header; no corner fallback over Save', () => {
    render(inShell(builder()));
    expect(screen.queryByTestId('shell-assistant-fallback')).toBeNull();
    const entries = screen.getAllByTestId('topbar-ai-assistant');
    expect(entries).toHaveLength(1);

    const save = screen.getByTestId('report-builder-save');
    const header = save.closest('header') as HTMLElement;
    expect(within(header).getByTestId('topbar-ai-assistant')).toBe(entries[0]);
    expect(entries[0]).toHaveAccessibleName('Ask AI');

    // The end cluster in order: Discard, Save, the hairline, then the group.
    const cluster = save.parentElement as HTMLElement;
    const order = Array.from(cluster.children).map((c) => c.getAttribute('data-testid'));
    expect(order).toEqual(['report-builder-discard', 'report-builder-save', 'report-builder-shell-divider', 'shell-page-actions']);
  });

  it('outside the shell (a bare mount) the header ends with Save, as before', () => {
    render(<MemoryRouter>{builder()}</MemoryRouter>);
    const cluster = screen.getByTestId('report-builder-save').parentElement as HTMLElement;
    expect(cluster.lastElementChild).toBe(screen.getByTestId('report-builder-save'));
    expect(screen.queryByTestId('topbar-ai-assistant')).toBeNull();
  });
});
