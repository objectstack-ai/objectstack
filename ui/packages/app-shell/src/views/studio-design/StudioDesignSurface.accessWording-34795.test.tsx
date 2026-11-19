// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34795 — the Studio permissions page in business wording (zh-CN):
 *
 *   • an accepted member-access suggestion reads as one sentence, and its
 *     action reads 「取消默认授予」 while it makes the same call 撤销 made
 *     (the dismiss door on the accepted row, ADR-0090 D5/D9 unchanged);
 *   • the open set's title is the set's label alone (objectstack#35018: the
 *     app's name is the top bar's, not repeated); the set's machine name is
 *     the title's tooltip, not page text, and the rail row's too;
 *   • every object row draws 「全选 · 只读 · 清空」 (and the CRUD arm as a
 *     fourth) without a hover, and each writes what All / R / None / CRUD
 *     wrote before;
 *   • an object row shows its label; its machine name is the tooltip;
 *   • the page text carries no internal set name, no 「Everyone 岗位」, no
 *     「OWD」 and no 「CRUD」.
 *
 * Harness: `StudioDesignSurface.accessSuggestionsReadOnly-33158`'s — the
 * metadata client doubled, the suggested-bindings API doubled at its module,
 * the real `SuggestedBindingsPanel` and the real matrix — mounted in zh the
 * way `AutomationsPillar.newSimilar-28567` mounts its zh pins.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/lint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, createI18n } from '@object-ui/i18n';
// The zh pins read the studio zh catalogue, which loads lazily.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const PKG = 'app.ti8v.meeting_notes';
const SET = 'app_ti8v_member_access';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  dismiss: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock('../../services/suggestedBindingsApi', () => ({
  listSuggestedBindings: api.list,
  confirmSuggestedBinding: api.confirm,
  dismissSuggestedBinding: api.dismiss,
  reopenSuggestedBinding: api.reopen,
}));

const client = {
  withPreviewDrafts() {
    return this;
  },
  list: vi.fn(async (type: string) => {
    if (type === 'permission') return [{ name: SET, label: '组织成员', isDefault: true }];
    if (type === 'object') {
      return [
        { name: 'ti8v_meeting', label: '会议' },
        { name: 'ti8v_todo', label: '待办事项' },
      ];
    }
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    effective: { name: SET, label: '组织成员', isDefault: true, objects: {}, fields: {} },
    code: null,
    overlay: null,
    overlayScope: null,
  })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => ({ fields: [] })),
  save: vi.fn(async (_t: string, _n: string, payload: Record<string, unknown>) => payload),
  reset: vi.fn(),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));

import { t } from '../metadata-admin/i18n';
import { AccessPillar } from './StudioDesignSurface';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const zh = (key: string) => t(key, 'zh-CN');

const ACCEPTED = {
  id: 'sug_member',
  package_id: PKG,
  permission_set_name: SET,
  anchor: 'everyone' as const,
  status: 'confirmed' as const,
  deployment_decision: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mountZh(withSuggestion = true) {
  const i18n = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter>
        <AccessPillar packageId={PKG} />
      </MemoryRouter>
    </I18nProvider>,
  );
  await screen.findByTestId('perm-row-ti8v_meeting');
  if (withSuggestion) await screen.findByTestId(`suggested-binding-${SET}`);
}

describe('objectstack#34795 — the accepted suggestion reads as one business sentence', () => {
  it('reads the card sentence, and its action reads 取消默认授予', async () => {
    api.list.mockResolvedValue([ACCEPTED]);
    await mountZh();
    const row = screen.getByTestId(`suggested-binding-${SET}`);
    expect(row).toHaveAttribute('data-state', 'accepted');
    expect(row).toHaveTextContent('所有成员默认拥有这个权限集，新加入的人也会自动拥有。');
    expect(within(row).getByRole('button', { name: '取消默认授予' })).toBeInTheDocument();
  });

  it('取消默认授予 makes the call 撤销 made: the dismiss door, once, on the accepted row', async () => {
    api.list.mockResolvedValue([ACCEPTED]);
    api.dismiss.mockResolvedValue({ ...ACCEPTED, status: 'dismissed' });
    await mountZh();
    fireEvent.click(screen.getByRole('button', { name: '取消默认授予' }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledTimes(1));
    expect(api.dismiss).toHaveBeenCalledWith('sug_member');
    expect(api.confirm).not.toHaveBeenCalled();
    expect(api.reopen).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId(`suggested-binding-${SET}`)).toHaveAttribute('data-state', 'dismissed'),
    );
  });

  it('a pending suggestion names the set by its label, never by its machine name', async () => {
    api.list.mockResolvedValue([{ ...ACCEPTED, status: 'pending' as const, deployment_decision: false }]);
    await mountZh();
    const row = screen.getByTestId(`suggested-binding-${SET}`);
    expect(row).toHaveTextContent('「组织成员」');
    expect(row.textContent).not.toContain(SET);
  });
});

describe('objectstack#34795 — the open set: title, tooltip, terms', () => {
  it('the title reads the set label alone — no app name; the machine name is its tooltip and the rail row tooltip', async () => {
    api.list.mockResolvedValue([ACCEPTED]);
    await mountZh();
    const title = within(screen.getByTestId('access-item-header')).getByTestId('perm-studio-title');
    // objectstack#35018 — the app's name is the top bar's; the title is the set's label, whole.
    expect(title.textContent).toBe('组织成员');
    expect(screen.getByTestId('access-item-header').textContent).not.toContain('会议纪要');
    // CONTROL: the machine name stays reachable — on the title's tooltip and the rail row's.
    expect(title).toHaveAttribute('title', SET);
    expect(screen.getByTestId(`access-rail-set-${SET}`)).toHaveAttribute('title', SET);
    // The three labels are the line under the title.
    const note = screen.getByTestId('perm-studio-title-note');
    expect(note).toHaveTextContent(zh('engine.studio.access.origin.app'));
    expect(note).toHaveTextContent(zh('perm.badge.default'));
  });

  it('objectstack#35018 — the note and the tab row say it in the builder words: no 包内置, no 本包', async () => {
    api.list.mockResolvedValue([ACCEPTED]);
    await mountZh();
    const header = screen.getByTestId('access-item-header');
    expect(within(header).getByTestId('perm-studio-title-note')).toHaveTextContent(
      `${zh('engine.studio.access.origin.app')}·${zh('perm.badge.default')}`,
    );
    expect(header.textContent).not.toContain('包内置');
    expect(header.textContent).not.toContain('本包');
  });

  it('the tabs read in the card words', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    expect(screen.getByTestId('perm-tab-objects')).toHaveTextContent('对象权限');
    expect(screen.getByTestId('perm-tab-capabilities')).toHaveTextContent('系统功能');
    expect(screen.getByTestId('perm-tab-rls')).toHaveTextContent('数据范围规则');
    expect(screen.getByTestId('perm-tab-tabs')).toHaveTextContent('菜单可见');
  });

  it('the page text carries no machine set name, no Everyone 岗位, no OWD and no CRUD', async () => {
    api.list.mockResolvedValue([ACCEPTED]);
    await mountZh();
    // The text a reader sees: closed tab panels (`hidden`) are left out.
    const parts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement?.closest('[hidden]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? '');
    const text = parts.join('');
    expect(text).not.toContain(SET);
    expect(text).not.toContain('Everyone');
    expect(text).not.toContain('OWD');
    expect(text).not.toContain('CRUD');
    // CONTROL: the scan reads the rendered page — the sentence and the title are in it.
    expect(text).toContain('所有成员默认拥有这个权限集');
    expect(text).toContain('组织成员');
    expect(text).toContain('谁能看到哪些记录');
  });
});

describe('objectstack#34795 — object rows: the label alone, the bulk strip always drawn', () => {
  it('an object row shows its label; its machine name is the tooltip, not text', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    const name = screen.getByTestId('perm-object-name-ti8v_meeting');
    expect(name).toHaveTextContent('会议');
    expect(name.textContent).not.toContain('ti8v_meeting');
    expect(name).toHaveAttribute('title', 'ti8v_meeting');
  });

  it('every row draws 全选 · 只读 · 清空 (then the CRUD arm) with no hover or focus', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    for (const obj of ['ti8v_meeting', 'ti8v_todo']) {
      const strip = screen.getByTestId(`perm-bulk-${obj}`);
      expect(within(strip).getAllByRole('button').map((b) => b.textContent)).toEqual([
        '全选',
        '只读',
        '清空',
        zh('perm.bulk.crud'),
      ]);
    }
    expect(screen.getByTestId('perm-row-ti8v_meeting')).not.toHaveAttribute('data-active');
  });

  const ACTIONS = ['create', 'read', 'edit', 'delete', 'export', 'transfer', 'viewAll', 'modifyAll'] as const;
  const checkedOf = (row: HTMLElement) =>
    ACTIONS.filter((a) => (within(row).getByRole('checkbox', { name: `ti8v_todo ${zh(`perm.action.${a}`)}` }) as HTMLElement).getAttribute('data-state') === 'checked');

  it('全选 writes what All wrote: every column but Export', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    const row = screen.getByTestId('perm-row-ti8v_todo');
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: '全选' }));
    await waitFor(() =>
      expect(checkedOf(row)).toEqual(['create', 'read', 'edit', 'delete', 'transfer', 'viewAll', 'modifyAll']),
    );
  });

  it('只读 writes what R wrote: Read alone', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    const row = screen.getByTestId('perm-row-ti8v_todo');
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: '全选' }));
    await waitFor(() => expect(checkedOf(row)).toContain('modifyAll'));
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: '只读' }));
    await waitFor(() => expect(checkedOf(row)).toEqual(['read']));
  });

  it('清空 writes what None wrote: nothing', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    const row = screen.getByTestId('perm-row-ti8v_todo');
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: '全选' }));
    await waitFor(() => expect(checkedOf(row)).toContain('create'));
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: '清空' }));
    await waitFor(() => expect(checkedOf(row)).toEqual([]));
  });

  it('the fourth button writes what CRUD wrote: the four CRUD columns', async () => {
    api.list.mockResolvedValue([]);
    await mountZh(false);
    const row = screen.getByTestId('perm-row-ti8v_todo');
    fireEvent.click(within(screen.getByTestId('perm-bulk-ti8v_todo')).getByRole('button', { name: zh('perm.bulk.crud') }));
    await waitFor(() => expect(checkedOf(row)).toEqual(['create', 'read', 'edit', 'delete']));
  });
});
