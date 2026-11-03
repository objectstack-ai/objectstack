// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29705 — one word per item state across the Studio pillars, the
 * All metadata area and Access. A tile's word answers "what can I do here" in
 * the package's context, from the pillars' vocabulary.
 *
 * Pinned over the real directory page and the real header, each against a
 * control:
 *
 *  - a read-only package (the code-provided showcase): its overlay types read
 *    "can be customized" (可定制), never 可写; its create-only type reads
 *    read-only, because the area withholds every create door there; the list
 *    header draws the same word as the tile; the `OS_METADATA_WRITABLE` hatch
 *    opens nothing on it;
 *  - CONTROL, a writable package: an overlay type reads 可写, a create-only type
 *    reads 可新增;
 *  - the lead sentence says what a person can do, with no count of protocol
 *    types and no "protocol"/"runtime override" wording;
 *  - the census: each state and its one key, no retired key or second spelling
 *    left in either catalogue, and Access's zh values carry no English doublet
 *    or bare "OWD".
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { en as CONSOLE_EN, zh as CONSOLE_ZH } from '@object-ui/i18n/locales';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';
import type { RichMetadataTypeEntry } from './useMetadata';

const EN = await loadStudioCatalogue('en');
const ZH = await loadStudioCatalogue('zh');

const PKG = 'com.example.showcase';

const entry = (
  type: string,
  allowEnvironmentOverlay: boolean,
  allowRuntimeCreate: boolean,
  overrideSource: 'registry' | 'env' = 'registry',
): RichMetadataTypeEntry => ({ type, label: type, domain: 'ui', allowEnvironmentOverlay, allowRuntimeCreate, overrideSource });

/** The showcase's shapes: three overlay types, a create-only type, a closed type, a hatched type. */
const ENTRIES: RichMetadataTypeEntry[] = [
  entry('dashboard', true, true),
  entry('report', true, true),
  entry('view', true, true),
  entry('page', false, true),
  entry('api', false, false),
  entry('agent', true, false, 'env'),
];

const CLIENT = { list: async () => [] };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
  useGlobalDiagnostics: () => ({
    loading: false,
    error: null,
    summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
    byType: {},
    warnByType: {},
    countsByType: {},
    lockedByType: {},
    packagesByType: Object.fromEntries(ENTRIES.map((e) => [e.type, [PKG]])),
    allPackages: [PKG],
    reload: () => {},
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'zh-CN',
}));
// The area reads the base's customizations; this package has none to serve.
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { packages: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

import { MetadataDirectoryPage } from './DirectoryPage';
import { PageShell, TYPE_STATE_WORD_KEY, typeStateWord, type TypeStateWord } from './PageShell';

afterEach(() => {
  cleanup();
});

const host = (readOnly: boolean): MetadataAreaHost => ({ packageId: PKG, readOnly, basePath: `/studio/${PKG}/metadata` });

function renderDirectory(readOnly: boolean) {
  return render(
    <MetadataAreaHostContext.Provider value={host(readOnly)}>
      <MemoryRouter>
        <MetadataDirectoryPage />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

/** The word a type's tile draws in its state slot. */
async function tileWord(type: string): Promise<string> {
  const code = await screen.findByText(type, { selector: 'code' });
  const tile = code.closest('a') as HTMLElement;
  const slot = tile.querySelector('[data-state-word]');
  expect(slot, `${type} tile draws a state word`).not.toBeNull();
  return (slot?.textContent ?? '').trim();
}

describe('All metadata tiles: one state word, in the package context (objectstack#29705)', () => {
  it('a read-only package: overlay types can be customized, never 可写; the create-only and closed types are read-only', async () => {
    renderDirectory(true);

    for (const type of ['dashboard', 'report', 'view']) {
      expect(await tileWord(type)).toBe('可定制');
    }
    expect(await tileWord('page')).toBe('只读');
    expect(await tileWord('api')).toBe('只读');
    // The hatch opens only the items no package ships; a read-only package ships them all.
    expect(await tileWord('agent')).toBe('只读');
    expect(screen.queryByText('可写')).toBeNull();
    expect(screen.queryByText('仅可新建')).toBeNull();
    // The filter hides what the words mark read-only and counts the rest.
    expect(screen.getByRole('button', { name: '隐藏只读 (3)' })).toBeInTheDocument();
  });

  it('CONTROL — a writable package: an overlay type is 可写, a create-only type 可新增', async () => {
    renderDirectory(false);

    for (const type of ['dashboard', 'report', 'view']) {
      expect(await tileWord(type)).toBe('可写');
    }
    expect(await tileWord('page')).toBe('可新增');
    expect(await tileWord('api')).toBe('只读');
    expect(await tileWord('agent')).toBe('可写');
    expect(screen.queryByText('可定制')).toBeNull();
    expect(screen.getByRole('button', { name: '隐藏只读 (5)' })).toBeInTheDocument();
  });

  it('the lead sentence says what a person can do, with no protocol-type count', async () => {
    renderDirectory(true);
    await tileWord('view');
    const lead = screen.getByTestId('directory-description').textContent ?? '';
    expect(lead).toBe(ZH['engine.directory.description']);
    expect(lead).not.toMatch(/\d/u);
    expect(lead).not.toMatch(/协议|运行时覆盖/u);
    for (const word of ['只读', '可定制', '可新增', '可写']) expect(lead).toContain(word);
    expect(EN['engine.directory.description']).not.toMatch(/\d|protocol|runtime|override/iu);
  });
});

describe('the list header draws the tile word (objectstack#29705)', () => {
  function renderHeader(type: string, readOnly: boolean) {
    const e = ENTRIES.find((x) => x.type === type);
    return render(
      <MetadataAreaHostContext.Provider value={host(readOnly)}>
        <MemoryRouter>
          <PageShell entry={e}>
            <div />
          </PageShell>
        </MemoryRouter>
      </MetadataAreaHostContext.Provider>,
    );
  }

  it('a read-only package: the view list header reads 可定制, the page list header 只读', () => {
    renderHeader('view', true);
    expect(within(document.querySelector('h1')!.parentElement!).getByText('可定制')).toHaveAttribute(
      'title',
      ZH['engine.studio.customize.availableTitle'],
    );
    cleanup();
    renderHeader('page', true);
    expect(within(document.querySelector('h1')!.parentElement!).getByText('只读')).toBeInTheDocument();
  });

  it('CONTROL — a writable package: the view list header reads 可写', () => {
    renderHeader('view', false);
    expect(within(document.querySelector('h1')!.parentElement!).getByText('可写')).toBeInTheDocument();
  });
});

/**
 * The vocabulary, one key per state. The tiles and the headers draw the first
 * four through {@link TYPE_STATE_WORD_KEY}; the rail marks and the landing draw
 * customized, added and switched off.
 */
const VOCABULARY: ReadonlyArray<{ state: string; key: string; en: string; zh: string }> = [
  { state: 'read-only', key: 'engine.studio.pkg.readonly', en: 'Read-only', zh: '只读' },
  { state: 'writable', key: 'engine.studio.pkg.writable', en: 'Writable', zh: '可写' },
  { state: 'can be customized', key: 'engine.studio.customize.available', en: 'Can be customized', zh: '可定制' },
  { state: 'can be added', key: 'engine.studio.customize.addable', en: 'Can be added', zh: '可新增' },
  { state: 'customized', key: 'engine.customizationMark.customized', en: 'Customized ({baseName})', zh: '已定制（{baseName}）' },
  { state: 'added', key: 'engine.customizationMark.added', en: 'Added', zh: '新增' },
  { state: 'switched off', key: 'engine.studio.auto.off', en: 'Switched off', zh: '已停用' },
  { state: 'switched on', key: 'engine.studio.auto.on', en: 'Switched on', zh: '已启用' },
];

/** Every other key that draws one of the states, and the word it must carry. */
const SAME_WORD: ReadonlyArray<{ key: string; en: string; zh: string }> = [
  { key: 'engine.directory.customizations.tile', en: 'customized', zh: '已定制' },
  { key: 'engine.studio.landing.customizations.customized', en: 'customized', zh: '已定制' },
  { key: 'engine.studio.landing.customizations.switchedOff', en: 'switched off', zh: '已停用' },
  { key: 'engine.directory.hideReadOnly', en: 'read-only', zh: '只读' },
];

const RETIRED_KEYS = ['engine.badge.readOnly', 'engine.badge.writable', 'engine.badge.createOnly', 'engine.directory.writableOnly'];
const RETIRED_SPELLINGS = { en: ['create-only', 'Writable only'], zh: ['仅可新建', '仅显示可写'] };

describe('the state vocabulary census (objectstack#29705)', () => {
  it.each(VOCABULARY)('$state: one key, one word in each catalogue', ({ key, en, zh }) => {
    expect(EN[key]).toBe(en);
    expect(ZH[key]).toBe(zh);
  });

  it('the tile and header words read the vocabulary keys', () => {
    const words: TypeStateWord[] = ['readOnly', 'writable', 'customizable', 'addable'];
    expect(words.map((w) => TYPE_STATE_WORD_KEY[w])).toEqual(VOCABULARY.slice(0, 4).map((v) => v.key));
    expect(Object.keys(TYPE_STATE_WORD_KEY).sort()).toEqual([...words].sort());
  });

  it.each(SAME_WORD)('$key spells its state the vocabulary way', ({ key, en, zh }) => {
    expect(EN[key]).toContain(en);
    expect(ZH[key]).toContain(zh);
  });

  it('no retired key or second spelling is left in either catalogue', () => {
    for (const key of RETIRED_KEYS) {
      expect(EN[key], key).toBeUndefined();
      expect(ZH[key], key).toBeUndefined();
    }
    for (const value of Object.values(EN)) for (const s of RETIRED_SPELLINGS.en) expect(value).not.toBe(s);
    for (const value of Object.values(ZH)) for (const s of RETIRED_SPELLINGS.zh) expect(value).not.toBe(s);
  });

  it('typeStateWord: the mapping in every context', () => {
    const [dashboard, , , page, api, agent] = ENTRIES;
    expect([dashboard, page, api, agent].map((e) => typeStateWord(e, true))).toEqual([
      'customizable',
      'readOnly',
      'readOnly',
      'readOnly',
    ]);
    expect([dashboard, page, api, agent].map((e) => typeStateWord(e, false))).toEqual([
      'writable',
      'addable',
      'readOnly',
      'writable',
    ]);
    // `permission` is never overridable (ADR-0146 D6), whatever an entry says.
    expect(typeStateWord(entry('permission', true, true), true)).toBe('readOnly');
  });
});

describe('Access: sharing settings in zh carry no English doublet or bare OWD (objectstack#29705)', () => {
  const ACCESS_ZH_KEYS = [
    'perm.owd.defaultPrivate',
    'perm.owd.private',
    'perm.owd.public_read',
    'perm.owd.public_read_write',
    'engine.studio.settings.sharingPrivate',
    'engine.studio.settings.sharingPublicRead',
    'engine.studio.settings.sharingPublicReadWrite',
    'engine.studio.settings.sharingControlledByParent',
  ];

  it.each(ACCESS_ZH_KEYS)('%s: no Latin word in the zh value', (key) => {
    expect(ZH[key]).toBeTruthy();
    expect(ZH[key]).not.toMatch(/\p{Script=Latin}/u);
  });

  it('the matrix column and the explain rule name the sharing model in Chinese', () => {
    expect(ZH['engine.studio.access.colOwd']).toBe('记录共享模型');
    expect(ZH['engine.studio.access.explain.ruleKind.owd_baseline']).toMatch(/^\p{Script=Han}/u);
    // The prose that names the Private option names it the way the picker does.
    expect(ZH['engine.studio.settings.sharingDescUnset']).not.toMatch(/Private/u);
    expect(ZH['engine.studio.data.owdHint']).not.toMatch(/Private/u);
    // en is untouched.
    expect(EN['perm.owd.private']).toBe('Private');
    expect(EN['engine.studio.access.colOwd']).toBe('OWD');
  });
});

/**
 * objectstack#29729 — the words #29705 left with a second spelling outside its
 * diff. A switched-on or switched-off flow or action reads 启用 / 停用 in zh and
 * "Switched on" / "Switched off" in en wherever Studio and Setup name that
 * state; the Customize act reads 定制 (its state is 已定制, its offer 可定制);
 * a permission set no package ships reads 新增 / "Added", not 自定义.
 */
describe('one word per state, the second pass (objectstack#29729)', () => {
  const SWITCHED_ON = ['engine.studio.auto.on', 'engine.studio.auto.enabled', 'engine.studio.auto.ledger.on', 'engine.studio.auto.ledger.notRunning', 'engine.studio.auto.ledger.switchedOn'];
  const SWITCHED_OFF = ['engine.studio.auto.off', 'engine.studio.auto.offTitle', 'engine.studio.auto.disabled', 'engine.studio.auto.disabledToast', 'engine.studio.auto.ledger.off', 'engine.studio.auto.ledger.switchedOff'];
  const LEDGER_PROSE = ['engine.studio.auto.ledger.hint', 'engine.studio.auto.ledger.walled'];

  it.each(SWITCHED_ON)('%s: switched on is 启用 / "Switched on" (or "switched on")', (key) => {
    expect(ZH[key]).toContain('启用');
    expect(EN[key]).toMatch(/switched on/i);
  });

  it.each(SWITCHED_OFF)('%s: switched off is 停用 / "Switched off" (or "switched off")', (key) => {
    expect(ZH[key]).toContain('停用');
    expect(EN[key]).toMatch(/switched off/i);
  });

  it.each([...SWITCHED_ON, ...SWITCHED_OFF, ...LEDGER_PROSE])('%s: no 开启 / 关闭 in zh, no On/Off/Enabled/Disabled in en', (key) => {
    expect(ZH[key]).not.toMatch(/开启|关闭/u);
    // The old state labels: a bare word, or the word before "for this deployment" / " — …".
    expect(EN[key]).not.toMatch(/^(On|Off|Enabled|Disabled)( for | — |,|$)/u);
  });

  it("Setup's packaged actions name the same state the same way", () => {
    const zh = (CONSOLE_ZH as any).packagedAutomation;
    expect(zh.on).toBe('已启用');
    expect(zh.off).toBe('已停用');
    expect(zh.actionsSubtitle).toContain('停用后');
    expect(zh.actionsSubtitle).not.toMatch(/关闭/u);
    // CONTROL: en keeps its own pair for this page.
    expect((CONSOLE_EN as any).packagedAutomation.off).toBe('Off');
  });

  const CUSTOMIZE_ACT = [
    'engine.studio.customize.action',
    'engine.studio.customize.actionTitle',
    'engine.studio.customize.walled',
    'engine.studio.customize.noVersion',
    'engine.studio.customize.draftFooter',
    'engine.studio.customize.restoreBody',
    'engine.studio.customize.restoreFlowBody',
    'engine.edit.resetConfirmBody',
    'engine.studio.landing.description',
    'engine.studio.landing.readonlyHint',
    'engine.studio.area.formEditor.oneLocale',
    'engine.studio.area.formEditor.translationWhole',
  ];

  it.each(CUSTOMIZE_ACT)('%s: the Customize act reads 定制, never 自定义', (key) => {
    expect(ZH[key]).toContain('定制');
    expect(ZH[key]).not.toContain('自定义');
  });

  it('the Customize button and the landing lines that quote it agree', () => {
    expect(ZH['engine.studio.customize.action']).toBe('定制');
    expect(ZH['engine.studio.landing.description']).toContain('「定制」');
    expect(ZH['engine.studio.landing.readonlyHint']).toContain('「定制」');
  });

  // CONTROL: 自定义 meaning "user-defined" (a custom value, key, renderer, page
  // or code) is another sense and keeps its word.
  it.each([
    'engine.inspector.action.mode.custom',
    'engine.inspector.flowNode.advancedHint',
    'engine.inspector.flowEdge.branchCustom',
    'engine.inspector.combo.noMatch',
    'engine.form.fallbackJson',
    'engine.studio.if.kindDesc.page',
    'engine.flowNode.script.hint',
  ])('CONTROL — %s keeps 自定义 (user-defined, not the Customize act)', (key) => {
    expect(ZH[key]).toContain('自定义');
  });

  it('a permission set no package ships reads the added word, not 自定义 / "Custom"', () => {
    expect(ZH['perm.badge.custom']).toBe(ZH['engine.customizationMark.added']);
    expect(EN['perm.badge.custom']).toBe(EN['engine.customizationMark.added']);
    // CONTROL: the shipped answer is untouched.
    expect(EN['perm.badge.package']).toBe('Package');
  });
});
