// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Installed Apps list's pins, carried onto the Setup → Packages rows whose
 * Source is marketplace (objectui#12675 moved the list's actions there and
 * retired its body).
 *
 * - objectui#11645 — an install the runtime refused to load still has its row:
 *   it reads NOT LOADED with its reason, keeps Uninstall, and confirms and
 *   reports in not-loaded terms. A code the console has no sentence for is
 *   named, not hidden.
 * - objectui#12610 — the kernel note (`marketplace.installedAdditiveNote`) rides
 *   the Uninstall of a LOADED row as a tooltip and its accessible description;
 *   a not-loaded row's Uninstall carries none; every pack's value is plain text.
 * - objectui#12684 — the note, the confirm and the result lines say what the
 *   server's DELETE does now: the app leaves the running kernel at once, so no
 *   pack tells the operator it stays registered until a restart, or to restart.
 * - objectui#7611 — a walled uninstall refusal reaches the operator with the
 *   door's own sentence, never a bare status, and the row stays.
 *
 * `marketplaceApi` is not mocked: one stubbed `fetch` answers by path over a
 * stateful install-local ledger. Text is the PACK's value for its key through
 * the real `I18nProvider`, never a sentence copied here.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales, en, zh } from '@object-ui/i18n/locales';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { PackagesPage } from '../../../views/metadata-admin/PackagesPage';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';

type Pack = typeof en;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** `{{name}}` interpolation, as i18next applies it to these keys (`escapeValue: false`). */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? `{{${k}}}`);

/** A refused entry as objectstack PR #21833 lists it: `notLoaded`, no `withSampleData`. */
const REFUSED = {
  packageId: 'com.example.crm',
  versionId: 'ver_crm_3',
  manifestId: 'com.example.crm',
  version: '3.2.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: '^16' },
  installedBy: 'admin@objectos.ai',
};
/** The same entry as a narrowed caller reads it: no `installedBy`, marker kept. */
const { installedBy: _operatorOnly, ...REFUSED_NARROWED } = REFUSED;
/** A loaded entry: `withSampleData`, no `notLoaded`. */
const LOADED = {
  packageId: 'com.example.todo',
  versionId: 'ver_todo_1',
  manifestId: 'com.example.todo',
  version: '1.0.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  withSampleData: true,
  installedBy: 'admin@objectos.ai',
};
/** The loaded entry's registry row. A refused entry has none: the runtime holds none of it. */
const LOADED_ROW = {
  manifest: { id: 'com.example.todo', name: 'Todo', version: '1.0.0' },
  enabled: true,
  // As objectstack serves it since objectstack#24010: install-local registers
  // the package and states `source: 'marketplace'` (objectui#12790).
  source: 'marketplace',
  writable: false,
};

const UNINSTALL_PATH = (id: string) => `/api/v1/marketplace/install-local/${id}`;

interface WireCall { path: string; method: string }
let calls: WireCall[] = [];
let ledger: Array<Record<string, unknown>> = [];

const reply = (status: number, body: unknown, statusText = '') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'content-type': 'application/json' } });

/**
 * Boot the runtime with the install-local capability, then serve the package
 * list and the install-local doors over `entries`. DELETE removes the entry, as
 * the server's ledger does — unless `refuseDelete` answers it.
 */
async function serve(entries: Array<Record<string, unknown>>, refuseDelete?: () => Response) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  ledger = entries.map((e) => ({ ...e }));
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path === '/api/v1/packages') {
        const loaded = ledger.some((e) => e.manifestId === 'com.example.todo' && !e.notLoaded);
        return reply(200, { success: true, data: { packages: loaded ? [LOADED_ROW] : [] } });
      }
      // Not cloud-bound: the marketplace slice reads the local ledger.
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: ledger, total: ledger.length } });
      }
      const del = /^\/api\/v1\/marketplace\/install-local\/([^/]+)$/.exec(path);
      if (del && method === 'DELETE') {
        if (refuseDelete) return refuseDelete();
        const manifestId = decodeURIComponent(del[1]);
        ledger = ledger.filter((e) => e.manifestId !== manifestId);
        return reply(200, { success: true, data: { manifestId, cleanups: [] } });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

function renderPackages(config: typeof EN | typeof ZH) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/setup/component/developer/packages']}>
        <PackagesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

const row = (manifestId: string) => screen.findByTestId(`pkg-row-${manifestId}`);

/** Whitespace collapsed, as an accessible description reads. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Uninstall, then confirm in the in-app dialog; returns the dialog's question as announced. */
async function uninstallAndConfirm(manifestId: string): Promise<string> {
  fireEvent.click(within(await row(manifestId)).getByTestId(`pkg-row-uninstall-${manifestId}`));
  const dialog = await screen.findByTestId(`pkg-row-uninstall-dialog-${manifestId}`);
  const describedBy = dialog.getAttribute('aria-describedby');
  const question = flat((describedBy && document.getElementById(describedBy)?.textContent) || '');
  fireEvent.click(within(dialog).getByTestId(`pkg-row-uninstall-confirm-${manifestId}`));
  return question;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each([
  ['en', EN, en as Pack],
  ['zh', ZH, zh as unknown as Pack],
])('Packages — a refused marketplace install reads not loaded, with its reason (objectui#11645) [%s]', (_lang, config, pack) => {
  const badge = pack.marketplace.notLoaded.badge;
  const reason = fill(pack.marketplace.notLoaded.protocolIncompatible, { requiredRange: '^16' });

  it('the refused entry has a marketplace row with the badge and the protocol reason, and Uninstall', async () => {
    await serve([REFUSED, LOADED]);
    renderPackages(config);

    const r = await row('com.example.crm');
    expect(within(r).getByTestId('pkg-source')).toHaveAttribute('data-source', 'marketplace');
    expect(within(r).getByText(badge)).toBeInTheDocument();
    expect(within(r).getByText(reason)).toBeInTheDocument();
    expect(within(r).getByRole('button', { name: pack.marketplace.action.uninstall })).toBeEnabled();
  });

  it('a narrowed caller\'s entry (no `installedBy`) still reads not loaded, with its reason', async () => {
    await serve([REFUSED_NARROWED]);
    renderPackages(config);

    const r = await row('com.example.crm');
    expect(within(r).getByText(badge)).toBeInTheDocument();
    expect(within(r).getByText(reason)).toBeInTheDocument();
  });

  it('a loaded entry carries neither the badge nor a reason', async () => {
    await serve([REFUSED, LOADED]);
    renderPackages(config);

    const r = await row('com.example.todo');
    expect(within(r).queryByText(badge)).toBeNull();
    for (const template of [pack.marketplace.notLoaded.protocolIncompatible, pack.marketplace.notLoaded.otherReason]) {
      const head = template.split('{{')[0];
      expect(head.length).toBeGreaterThan(3);
      expect(r.textContent).not.toContain(head);
    }
    expect(within(r).getByRole('button', { name: pack.marketplace.action.uninstall })).toBeEnabled();
  });
});

describe('Packages — Uninstall from a marketplace row (objectui#11645)', () => {
  it('confirms in not-loaded terms, issues DELETE for the manifest id, and the re-read list drops the row', async () => {
    await serve([REFUSED, LOADED]);
    renderPackages(EN);

    const question = await uninstallAndConfirm('com.example.crm');
    expect(question).toBe(flat(fill(en.marketplace.uninstall.confirmNotLoaded, { manifestId: 'com.example.crm', version: '3.2.0' })));
    await waitFor(() => expect(calls).toContainEqual({ path: UNINSTALL_PATH('com.example.crm'), method: 'DELETE' }));
    expect(
      await screen.findByText(fill(en.marketplace.uninstall.successNotLoaded, { manifestId: 'com.example.crm' })),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('pkg-row-com.example.crm')).toBeNull());
    expect(calls.filter((c) => c.path === '/api/v1/marketplace/install-local' && c.method === 'GET')).toHaveLength(2);
    expect(screen.getByTestId('pkg-row-com.example.todo')).toBeInTheDocument();
  });

  it('control: a loaded row keeps the loaded package\'s confirm and result', async () => {
    await serve([REFUSED, LOADED]);
    renderPackages(EN);

    const question = await uninstallAndConfirm('com.example.todo');
    expect(question).toBe(flat(fill(en.marketplace.uninstall.confirm, { manifestId: 'com.example.todo', version: '1.0.0' })));
    await waitFor(() => expect(calls).toContainEqual({ path: UNINSTALL_PATH('com.example.todo'), method: 'DELETE' }));
    expect(
      await screen.findByText(fill(en.marketplace.uninstall.successInList, { manifestId: 'com.example.todo' })),
    ).toBeInTheDocument();
  });

  it('a refusal code the console has no sentence for still reads not loaded and names the code', async () => {
    await serve([{ ...REFUSED, notLoaded: { code: 'OS_SOME_LATER_REFUSAL', requiredRange: '^18' } }]);
    renderPackages(EN);

    const r = await row('com.example.crm');
    expect(within(r).getByText(en.marketplace.notLoaded.badge)).toBeInTheDocument();
    expect(within(r).getByText(fill(en.marketplace.notLoaded.otherReason, { code: 'OS_SOME_LATER_REFUSAL' }))).toBeInTheDocument();
    expect(r.textContent).not.toContain('^18');
    expect(within(r).getByRole('button', { name: en.marketplace.action.uninstall })).toBeEnabled();
  });

  it('a walled uninstall refusal shows the door\'s sentence, never a bare status, and the row stays (objectui#7611)', async () => {
    const message =
      'Uninstalling "com.example.todo" is refused: the package carries security catalog items. '
      + "Creating, changing or deleting a position requires the platform operator: this deployment runs the 'group' tenancy posture.";
    await serve([LOADED], () =>
      reply(403, { success: false, error: { code: 'FORBIDDEN', message, details: { manifestId: 'com.example.todo' } } }, 'Forbidden'),
    );
    renderPackages(EN);

    await uninstallAndConfirm('com.example.todo');
    expect(await screen.findByText(message)).toBeInTheDocument();
    const page = document.body.textContent ?? '';
    expect(page).not.toContain('Forbidden');
    expect(page).not.toContain('HTTP_403');
    expect(screen.queryByText(fill(en.marketplace.uninstall.successInList, { manifestId: 'com.example.todo' }))).toBeNull();
    expect(within(await row('com.example.todo')).getByRole('button', { name: en.marketplace.action.uninstall })).toBeEnabled();
  });
});

describe.each([
  ['en', EN, en as Pack],
  ['zh', ZH, zh as unknown as Pack],
])('Packages — the kernel note is the marketplace Uninstall tooltip (objectui#12610) [%s]', (_lang, config, pack) => {
  const note = pack.marketplace.installedAdditiveNote;

  it('a list with no marketplace install carries no kernel note', async () => {
    await serve([]);
    renderPackages(config);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/marketplace/install-local')).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-testid^="pkg-row-"]')).toBeNull());
    expect(document.body.textContent).not.toContain(note);
  });

  it('a loaded row\'s Uninstall is described by the note, and hovering it opens a tooltip with it', async () => {
    const user = userEvent.setup();
    await serve([LOADED]);
    renderPackages(config);

    const uninstall = within(await row('com.example.todo')).getByRole('button', { name: pack.marketplace.action.uninstall });
    expect(uninstall).toHaveAccessibleDescription(note);
    const described = document.getElementById(uninstall.getAttribute('aria-describedby') as string);
    expect(described).toHaveClass('sr-only');

    await user.hover(uninstall);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(note);
    expect(tooltip.textContent).not.toMatch(/<\/?[a-z]/i);
    expect(tooltip.querySelector('strong')).toBeNull();
  });

  it('a not-loaded row\'s Uninstall carries no note — that package left nothing in the kernel', async () => {
    await serve([REFUSED]);
    renderPackages(config);

    const uninstall = within(await row('com.example.crm')).getByRole('button', { name: pack.marketplace.action.uninstall });
    expect(uninstall).not.toHaveAttribute('aria-describedby');
    expect(document.body.textContent).not.toContain(note);
  });
});

describe('every pack\'s kernel note is plain text (objectui#12610)', () => {
  const packs = Object.entries(builtInLocales) as Array<[string, Pack]>;

  it('the walk below reads all ten packs', () => {
    expect(packs.map(([lang]) => lang).sort()).toEqual(
      ['ar', 'de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh'],
    );
  });

  it.each(packs)('%s: `marketplace.installedAdditiveNote` carries no markup', (_lang, pack) => {
    const note = pack.marketplace.installedAdditiveNote;
    expect(note.length).toBeGreaterThan(20);
    expect(note).not.toMatch(/<\/?[a-z][^>]*>/i);
  });
});

/**
 * objectui#12684 — objectstack's `DELETE /api/v1/marketplace/install-local/ID`
 * withdraws the package from the running kernel at once (objectstack#21576),
 * runs the uninstall cleanups that revoke its permission sets and their grants,
 * and removes its cached manifest; the rows in its tables stay. The note, the
 * confirm and the result lines used to tell the operator the running kernel
 * keeps the app until a restart, or to restart the runtime. These pins read the
 * CLAIMS those texts make, not their wording: the retired claim is absent from
 * every pack, and the measured ones are present in the text a loaded row's
 * Uninstall shows.
 */
const RETIRED_RESTART_CLAIM: Record<string, RegExp> = {
  en: /until you restart|until the next restart|keeps the app registered|remain loaded|restart the runtime|additive only/i,
  zh: /直到下次重启|仍会保留该应用|仅支持新增|重启运行时/,
  ja: /再起動するまで|次の再起動まで|再起動して|追加のみ/,
  ko: /재시작될 때까지|재시작하세요|추가 전용/,
  de: /bis zum Neustart|Laufzeitsystem neu|nur additiv/,
  es: /hasta reiniciar|Reinicie el runtime|solo aditiva/,
  fr: /jusqu'au redémarrage|Redémarrez le runtime|uniquement additive/,
  pt: /até reiniciar|Reinicie o runtime|apenas aditiva/,
  ru: /до перезапуска|Перезапустите рантайм|только аддитивный/,
  ar: /حتى إعادة التشغيل|أعد تشغيل|إضافية فقط/,
};

/** The loaded package's uninstall texts the walk below reads, in every pack. */
const UNINSTALL_TEXTS: Array<[string, (pack: Pack) => string]> = [
  ['installedAdditiveNote', (pack) => pack.marketplace.installedAdditiveNote],
  ['uninstall.confirm', (pack) => pack.marketplace.uninstall.confirm],
  ['uninstall.successInList', (pack) => pack.marketplace.uninstall.successInList],
  ['uninstall.successInDetail', (pack) => pack.marketplace.uninstall.successInDetail],
];

/** Withdrawn at once; not loaded at the next start; records kept. */
const MEASURED_CLAIMS: Record<string, RegExp[]> = {
  en: [/\bat once\b/, /\bdoes not load at the next start\b/, /\bstay in the database\b/],
  zh: [/立即/, /下次启动时不再加载/, /保留在数据库中/],
};

/** The confirm (before the DELETE) and the result line (after it), per language. */
const MEASURED_UNINSTALL_CLAIMS: Record<string, { confirm: RegExp[]; result: RegExp[] }> = {
  en: {
    confirm: [/\bat once\b/, /\bpermission sets\b/, /\bstay in the database\b/],
    result: [/\bhas left the running kernel\b/, /\bpermission sets\b/, /\bstay in the database\b/],
  },
  zh: {
    confirm: [/立即/, /权限集/, /保留在数据库中/],
    result: [/已从运行中的内核中移除/, /权限集/, /保留在数据库中/],
  },
};

describe.each([
  ['en', EN, en as Pack],
  ['zh', ZH, zh as unknown as Pack],
])('Packages — the uninstall texts say the app leaves the running kernel at once (objectui#12684) [%s]', (lang, config, pack) => {
  it('a loaded row\'s Uninstall describes the live withdrawal, and no restart', async () => {
    const user = userEvent.setup();
    await serve([LOADED]);
    renderPackages(config);

    const uninstall = within(await row('com.example.todo')).getByRole('button', { name: pack.marketplace.action.uninstall });
    const described = flat(document.getElementById(uninstall.getAttribute('aria-describedby') as string)?.textContent ?? '');
    await user.hover(uninstall);
    const tooltip = flat((await screen.findByRole('tooltip')).textContent ?? '');

    for (const shown of [described, tooltip]) {
      expect(shown).not.toMatch(RETIRED_RESTART_CLAIM[lang]);
      for (const claim of MEASURED_CLAIMS[lang]) expect(shown).toMatch(claim);
    }
  });

  it('a loaded row\'s Uninstall confirms and reports the live withdrawal, and no restart', async () => {
    await serve([LOADED]);
    renderPackages(config);

    const question = await uninstallAndConfirm('com.example.todo');
    await waitFor(() => expect(calls).toContainEqual({ path: UNINSTALL_PATH('com.example.todo'), method: 'DELETE' }));
    const result = flat((await screen.findByTestId('pkg-marketplace-result')).textContent ?? '');

    expect(question).toContain('com.example.todo');
    expect(question).toContain('1.0.0');
    expect(result).toContain('com.example.todo');
    const claims = MEASURED_UNINSTALL_CLAIMS[lang];
    for (const [shown, measured] of [[question, claims.confirm], [result, claims.result]] as const) {
      expect(shown).not.toMatch(RETIRED_RESTART_CLAIM[lang]);
      for (const claim of measured) expect(shown).toMatch(claim);
    }
  });
});

describe('no pack\'s uninstall texts say the app stays until a restart (objectui#12684)', () => {
  const packs = Object.entries(builtInLocales) as Array<[string, Pack]>;
  const rows = packs.flatMap(([lang, pack]) =>
    UNINSTALL_TEXTS.map(([key, read]) => [lang, key, read(pack)] as [string, string, string]),
  );

  it('the retired-claim table names every pack, and the walk reads four texts in each', () => {
    expect(Object.keys(RETIRED_RESTART_CLAIM).sort()).toEqual(packs.map(([lang]) => lang).sort());
    expect(rows).toHaveLength(packs.length * 4);
  });

  it.each(rows)('%s: `marketplace.%s` carries no restart claim', (lang, _key, value) => {
    expect(typeof value).toBe('string');
    expect(value).not.toMatch(RETIRED_RESTART_CLAIM[lang]);
  });

  const enByKey = new Map(UNINSTALL_TEXTS.map(([key, read]) => [key, read(en as Pack)]));
  it.each(rows.filter(([lang]) => lang !== 'en'))('%s: `marketplace.%s` is translated, not the en text', (_lang, key, value) => {
    expect(enByKey.get(key)).toEqual(expect.any(String));
    expect(value).not.toBe(enByKey.get(key));
  });
});
