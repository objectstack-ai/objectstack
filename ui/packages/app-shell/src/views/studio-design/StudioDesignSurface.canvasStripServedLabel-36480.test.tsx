// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36480 — the canvas selection strip names a selected dashboard
 * widget by the text the widget panel's Title box shows beside it: the served,
 * current-language title, through the same `shownLabel` reading the panel uses.
 *
 * The canvas hands the pillar `{ kind: 'widget', id, label }` with `label` the
 * AUTHORED title (`DashboardPreview` resolves the buffer's title), so on a
 * zh-CN session the strip read 「已选中：Pipeline by Stage」 while the panel's
 * Title box read 阶段管道分布.
 *
 * The surface is the real `StudioDesignSurface` with its right slot (the strip
 * draws there only) and the real `DashboardWidgetInspector`, over a mocked
 * metadata client whose `layered('dashboard')` is the authored English layer;
 * the console's metadata store serves the dashboard as the server answers it
 * for the session's language. The canvas is a stub that selects a widget the
 * way `DashboardPreview` does: by id, labelled with the authored title.
 *
 *  - zh: the strip names the widget 阶段管道分布, as the Title box reads it;
 *  - zh: a widget retitled in the draft is named by its authored title, as the
 *    Title box reads it (no served counterpart for that text yet);
 *  - en: the strip reads the English title, as before.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { DashboardSchema } from '@objectstack/spec/ui';
import { resolveI18nLabel } from '@objectstack/spec/ui';

const PACKAGE_ID = 'com.example.crm';
const DASH = 'sales_dashboard';
const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: DASH }];

const widget = (id: string, title: string) => ({
  id,
  type: 'metric',
  title,
  dataset: 'opportunity_metrics',
  values: ['total_amount'],
  layout: { x: 0, y: 0, w: 6, h: 2 },
});

/** The published layer, as `/layers` serves it: authored, never localized. */
const CODE = {
  name: DASH,
  label: 'Sales Performance',
  widgets: [widget('pipeline_by_stage', 'Pipeline by Stage'), widget('won_total', 'Won Total')],
};

/** The same dashboard as the `/meta` list answers a zh-CN request (`translateDashboard`). */
const SERVED_ZH = {
  ...CODE,
  label: '销售业绩',
  widgets: [widget('pipeline_by_stage', '阶段管道分布'), widget('won_total', '赢单总额')],
};

const state: { served: unknown; draft: unknown } = { served: SERVED_ZH, draft: null };

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

const mockClient = {
  save: vi.fn(async () => ({})),
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'crm_app', label: 'CRM' }] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'crm_app', label: 'CRM', navigation: NAV } };
    if (type === 'dashboard') {
      return {
        effective: JSON.parse(JSON.stringify(CODE)),
        draft: state.draft ? JSON.parse(JSON.stringify(state.draft)) : null,
      };
    }
    return { effective: { name } };
  }),
  getDraft: vi.fn(async (type: string) =>
    type === 'dashboard' && state.draft ? { item: JSON.parse(JSON.stringify(state.draft)) } : null,
  ),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  withPreviewDrafts() {
    return this;
  },
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

// A copilot is served, so the surface keeps its one right slot, where the strip draws.
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: ({ onStatusChange }: { onStatusChange?: (s: { available: boolean; planPendingCount: number }) => void }) => {
    React.useEffect(() => {
      onStatusChange?.({ available: true, planPendingCount: 0 });
    }, [onStatusChange]);
    return <div data-testid="copilot-body">conversation</div>;
  },
}));

// Pay the dynamic `@objectstack/lint` load at collection, never inside a case's
// clocked window (`check:test-source-alias`).
import '@objectstack/lint';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';

/** Selects a widget as `DashboardPreview` does: by id, labelled with the buffer's authored title. */
function StubDashboardPreview(props: Record<string, unknown>): React.ReactElement {
  const onSel = props.onSelectionChange as ((s: unknown) => void) | undefined;
  const draft = props.draft as { widgets?: Array<{ id: string; title?: string }> };
  const locale = props.locale as string;
  return (
    <div>
      {(draft.widgets ?? []).map((w) => (
        <button
          key={w.id}
          type="button"
          data-testid={`pick-${w.id}`}
          onClick={() => onSel?.({ kind: 'widget', id: w.id, label: resolveI18nLabel(w.title, locale) || w.id })}
        >
          pick
        </button>
      ))}
    </div>
  );
}

registerMetadataPreview('dashboard', StubDashboardPreview as never);
registerMetadataInspector('dashboard', DashboardWidgetInspector);

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  state.served = SERVED_ZH;
  state.draft = null;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) =>
      String(input) === '/api/v1/packages'
        ? answer({ success: true, data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'CRM' }, writable: true }] } })
        : answer([]),
    ),
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the objectstack#36480 dashboard fixture is what the spec accepts', () => {
  it('the authored layer, the zh-CN answer and the retitled draft all parse against DashboardSchema', () => {
    expect(DashboardSchema.safeParse(CODE).success).toBe(true);
    expect(DashboardSchema.safeParse(SERVED_ZH).success).toBe(true);
    expect(DashboardSchema.safeParse(retitledDraft()).success).toBe(true);
  });
});

function retitledDraft() {
  const draft = JSON.parse(JSON.stringify(CODE)) as typeof CODE;
  draft.widgets[0] = { ...draft.widgets[0], title: 'Stage Pipeline' };
  return draft;
}

