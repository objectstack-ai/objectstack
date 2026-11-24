// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36901 (epic objectstack#36890 decision 8) — the shared item
 * tabs: which tabs a page offers and in what order, the tab a page opens on,
 * the address each tab has (the retired sheets' `layers` and `audit` still
 * land on their tab), the strip, and the three tool panels it wraps.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockClient = {
  references: vi.fn(async () => [{ fromType: 'view', fromName: 'all_accounts', fromLabel: 'All accounts', path: 'object' }]),
  history: vi.fn(async () => ({ events: [] })),
  audit: vi.fn(async () => ({ events: [] })),
  layered: vi.fn(async () => ({ code: { name: 'x', label: 'Shipped' }, overlay: null, effective: { name: 'x', label: 'Shipped' } })),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../metadata-admin/useMetadata')>()),
  useMetadataClient: () => mockClient,
}));

const confirmSpy = vi.fn((go: () => unknown) => go());
vi.mock('../../chrome/unsavedEdits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../chrome/unsavedEdits')>()),
  confirmUnsavedLeave: (go: () => unknown) => confirmSpy(go),
}));

// Monaco's loader fails (offline), so the JSON source editor is its textarea.
vi.mock('@monaco-editor/react', () => {
  const Editor = () => null;
  return { Editor, default: Editor, loader: { init: () => Promise.reject(new Error('offline')) } };
});
vi.mock('@object-ui/plugin-editor', () => ({ configureBundledMonaco: () => Promise.resolve() }));

import {
  ItemToolTabPanel,
  ItemToolTabStrip,
  defaultItemToolTab,
  itemToolAddress,
  offeredItemToolTabs,
  readItemToolLocation,
  useItemToolTab,
  type ItemToolTab,
} from './ItemToolTabs';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('offeredItemToolTabs — which tabs, in which order', () => {
  it('a plain type with the trail: details, references, history, source', () => {
    expect(offeredItemToolTabs({ trail: true })).toEqual(['details', 'references', 'history', 'source']);
  });

  it('a canvas type with anchors: preview and related take their places', () => {
    expect(offeredItemToolTabs({ preview: true, related: true, trail: true })).toEqual([
      'details',
      'preview',
      'related',
      'references',
      'history',
      'source',
    ]);
  });

  it('no trail: no history (the audit log rides inside it), source still offered', () => {
    expect(offeredItemToolTabs({ trail: false })).toEqual(['details', 'references', 'source']);
  });

  it('no tools (a create draft): details alone', () => {
    expect(offeredItemToolTabs({ trail: true, tools: false })).toEqual(['details']);
  });
});

describe('defaultItemToolTab — decision 4', () => {
  it('opens on the canvas where the type has one, else on the details', () => {
    expect(defaultItemToolTab(['details', 'preview', 'source'])).toBe('preview');
    expect(defaultItemToolTab(['details', 'source'])).toBe('details');
  });
});

describe('the tab address', () => {
  const all: ItemToolTab[] = ['details', 'preview', 'related', 'references', 'history', 'source'];

  it('the retired sheet values open their tab on its second view', () => {
    expect(readItemToolLocation('audit', all)).toEqual({ tab: 'history', view: 'audit' });
    expect(readItemToolLocation('layers', all)).toEqual({ tab: 'source', view: 'layers' });
  });

  it('a tab the page does not offer, an unknown value or none opens nothing', () => {
    expect(readItemToolLocation('history', ['details', 'source'])).toBeNull();
    expect(readItemToolLocation('audit', ['details', 'source'])).toBeNull();
    expect(readItemToolLocation('review', all)).toBeNull();
    expect(readItemToolLocation(null, all)).toBeNull();
  });

  it('round-trips through itemToolAddress', () => {
    for (const raw of ['details', 'preview', 'related', 'references', 'history', 'source', 'audit', 'layers']) {
      expect(itemToolAddress(readItemToolLocation(raw, all)!)).toBe(raw);
    }
  });
});

function Harness({ offered, confirmSwitch }: { offered: ItemToolTab[]; confirmSwitch?: boolean }) {
  const { location, address, select } = useItemToolTab(offered);
  return (
    <div>
      <output data-testid="where">{`${location.tab}:${location.view ?? ''}:${address ?? ''}`}</output>
      <ItemToolTabStrip tabs={offered} active={location.tab} onSelect={(tab) => select(tab)} confirmSwitch={confirmSwitch} counts={{ references: 3 }} />
    </div>
  );
}

function mountHarness(search: string, offered: ItemToolTab[], confirmSwitch?: boolean) {
  window.history.replaceState({}, '', `/studio/x/metadata/hook/h${search}`);
  render(
    <MemoryRouter initialEntries={[`/studio/x/metadata/hook/h${search}`]}>
      <Harness offered={offered} confirmSwitch={confirmSwitch} />
    </MemoryRouter>,
  );
}

const tabParam = () => new URLSearchParams(window.location.search).get('tab');

describe('useItemToolTab + ItemToolTabStrip', () => {
  it('seeds from ?tab=, keeps the value in the address, and a click writes the new tab', async () => {
    mountHarness('?tab=audit', ['details', 'references', 'history', 'source']);
    expect(screen.getByTestId('where')).toHaveTextContent('history:audit:audit');
    expect(screen.getByTestId('item-tab-history')).toHaveAttribute('aria-pressed', 'true');
    expect(tabParam()).toBe('audit');
    fireEvent.click(screen.getByTestId('item-tab-source'));
    expect(screen.getByTestId('where')).toHaveTextContent('source::source');
    await waitFor(() => expect(tabParam()).toBe('source'));
  });

  it('the default tab has no address: choosing it drops ?tab=', async () => {
    mountHarness('?tab=references', ['details', 'references', 'source']);
    fireEvent.click(screen.getByTestId('item-tab-details'));
    expect(screen.getByTestId('where')).toHaveTextContent('details::');
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('a value this page does not offer opens the default tab and is dropped from the address', async () => {
    mountHarness('?tab=history', ['details', 'references', 'source']);
    expect(screen.getByTestId('where')).toHaveTextContent('details::');
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it('draws a count beside a tab', () => {
    mountHarness('', ['details', 'references', 'source']);
    expect(screen.getByTestId('item-tab-references')).toHaveTextContent('3');
  });

  it('a switch asks nothing on a shared buffer, and the leave guard with confirmSwitch', () => {
    mountHarness('', ['details', 'references', 'source']);
    fireEvent.click(screen.getByTestId('item-tab-source'));
    expect(confirmSpy).not.toHaveBeenCalled();
    cleanup();
    mountHarness('', ['details', 'references', 'source'], true);
    fireEvent.click(screen.getByTestId('item-tab-source'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('where')).toHaveTextContent('source::source');
  });
});

describe('ItemToolTabPanel — the panels the sheets held, as tab bodies', () => {
  function Panel(props: Partial<React.ComponentProps<typeof ItemToolTabPanel>> & { tab: 'references' | 'history' | 'source' }) {
    const [view, setView] = React.useState(props.view);
    return (
      <MemoryRouter>
        <ItemToolTabPanel type="hook" name="h" onViewChange={setView} {...props} view={view} />
      </MemoryRouter>
    );
  }

  it('References runs its own scan when the host holds none', async () => {
    render(<Panel tab="references" />);
    expect(await screen.findByText('all_accounts')).toBeInTheDocument();
    expect(mockClient.references).toHaveBeenCalledWith('hook', 'h');
  });

  it('History reads the versions, and its second view is the audit log', async () => {
    render(<Panel tab="history" />);
    await waitFor(() => expect(mockClient.history).toHaveBeenCalled());
    expect(screen.getByTestId('item-tab-view-versions')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('item-tab-view-audit'));
    await waitFor(() => expect(mockClient.audit).toHaveBeenCalled());
  });

  it('Source shows the host buffer read-only without onChange, and the layered view to the same caller', async () => {
    render(<Panel tab="source" source={{ value: { name: 'h', label: 'Mine' } }} layered={null} />);
    expect(screen.getByTestId('item-tab-source-readonly')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('item-tab-view-layers'));
    expect(screen.getByTestId('item-tab-view-layers')).toHaveAttribute('aria-pressed', 'true');
    // The host's layered answer is used as it is: no second read.
    expect(mockClient.layered).not.toHaveBeenCalled();
  });

  it('Source without a host buffer reads the served body, read-only', async () => {
    render(<Panel tab="source" packageId="crm" />);
    await waitFor(() => expect(mockClient.layered).toHaveBeenCalledWith('hook', 'h', { packageId: 'crm' }));
    expect(screen.getByTestId('item-tab-source-readonly')).toBeInTheDocument();
  });
});
