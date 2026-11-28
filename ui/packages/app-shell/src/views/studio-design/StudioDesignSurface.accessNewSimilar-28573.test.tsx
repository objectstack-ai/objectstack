// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28573 (ADR-0146 D6, N-20b) — "New similar" on a read-only base's
 * permission set, on the set's full-screen page (objectstack#36905: in its ⋯
 * menu; the Access pillar that drew it is gone).
 *
 * The clone door (`POST /security/permission-sets/:name/clone`) decides where
 * the copy lands: since #28563 a set a read-only package X ships is copied into
 * X's paired `X.custom`, and the answer names that package. This suite pins
 * that the pillar:
 *
 *  - offers "New similar" on a read-only base's open set, and posts exactly
 *    `{ name, label }` (no package, no facet);
 *  - opens the copy where the answer says it landed: the copy's metadata
 *    address in that package, the server's notice shown as sent;
 *  - opens nothing on an answer that names no package (absent or `null`), and
 *    says so;
 *  - shows a refusal (409) in the server's words, staying on the base;
 *  - draws the action disabled, in the console's own sentence, under a walled
 *    posture and for a caller without `manage_metadata`;
 *  - draws no override gesture on a base set, and no "New similar" on a
 *    writable package's set.
 *
 * The REAL `StudioPermissionSetPage`, `PermissionMatrixEditPage` and
 * `PermissionSetCloneDialog`, routed the way the "All metadata" area mounts the
 * page (`/studio/:packageId/metadata/permission/:name`, keyed by item). The door's answer is
 * the shape `packages/runtime/src/domains/permission-set-clone.ts` sends:
 * `{ permissionSet, package, notice }`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
// The pillar reaches `@objectstack/lint`'s dynamic imports; their first load is
// paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import { I18nProvider, createI18n } from '@object-ui/i18n';
// objectstack#29727 — the zh pins read the studio zh catalogue, which loads lazily.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const BASE_PKG = 'hotcrm';
const CUSTOM_PKG = 'hotcrm.custom';
const BASE_SET = 'hotcrm_sales_rep';
const COPY_NAME = 'my_sales_rep';
const COPY_LABEL = 'My sales rep';
const DOOR = `/api/v1/security/permission-sets/${BASE_SET}/clone`;

/** `permissionSetCloneNotice` for a copy that landed in a freshly ensured pair. */
const NOTICE =
  `The copy was saved in package '${CUSTOM_PKG}', created for it to hold your changes to the package the set came from, `
  + 'beside the original rather than in place of it, and travels with that package. Not copied: delegated-admin scope '
  + '(`adminScope`) and the everyone-baseline suggestion (`isDefault`) — grant either deliberately on the copy if it needs one.';

/** The door's 409 for a taken name. */
const NAME_TAKEN =
  `Permission set '${COPY_NAME}' already exists — a clone must take a NEW machine name. Retry with a name no permission set uses (for example '${COPY_NAME}_copy').`;

type Row = { pkg: string; body: Record<string, unknown> };

const BASE_BODY = { name: BASE_SET, label: 'Sales rep', objects: { crm_lead: { allowRead: true } }, fields: {} };

let clientImpl: ReturnType<typeof makeClient>;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: false, allowRuntimeCreate: true }],
    }),
  };
});
let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
}));
let walled = false;
vi.mock('../metadata-admin/catalog-scope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWalledCatalogReadOnly: () => walled,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));

import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n';
import { StudioPermissionSetPage } from './StudioPermissionSetPage';

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

const en = (key: string) => t(key, 'en');

/** A metadata door double: published rows, each owned by a package. */
function makeClient(published: Record<string, Row>) {
  return {
    published,
    save: vi.fn(async (_t: string, _n: string, body: Record<string, unknown>) => body),
    reset: vi.fn(async () => ({})),
    withPreviewDrafts() { return this; },
    list: vi.fn(async (type: string, opts: { packageId?: string } = {}) => {
      if (type === 'object') return [{ name: 'crm_lead', label: 'Lead' }];
      if (type !== 'permission') return [];
      return Object.values(published)
        .filter((r) => !opts.packageId || r.pkg === opts.packageId)
        .map((r) => ({ name: r.body.name, label: r.body.label }));
    }),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (_type: string, name: string) => ({
      effective: published[name]?.body ?? null,
      code: null,
      overlay: null,
      overlayScope: null,
    })),
    getDraft: vi.fn(async () => null),
    get: vi.fn(async () => ({ fields: [] })),
  };
}

/* ── The door ────────────────────────────────────────────────────────────── */

let doorAnswer: { status: number; body: unknown };
const calls: Array<{ url: string; method: string; body: unknown }> = [];

/** The door's 200: it saved the copy in `pkg`, which the double then lists; `noticeCode` only when given. */
function landedIn(pkg: string | null | 'absent', noticeCode?: string) {
  const data: Record<string, unknown> = { permissionSet: { ...BASE_BODY, name: COPY_NAME, label: COPY_LABEL }, notice: NOTICE };
  if (pkg !== 'absent') data.package = pkg;
  if (noticeCode !== undefined) data.noticeCode = noticeCode;
  return { status: 200, body: { success: true, data } };
}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      calls.push({ url: String(url), method: init?.method ?? 'GET', body });
      const answer = doorAnswer.body as { success?: boolean; data?: { package?: unknown } } | null;
      if (doorAnswer.status === 200 && answer?.success && typeof answer.data?.package === 'string') {
        clientImpl.published[COPY_NAME] = {
          pkg: answer.data.package,
          body: { ...BASE_BODY, name: COPY_NAME, label: COPY_LABEL },
        };
      }
      return new Response(JSON.stringify(doorAnswer.body), {
        status: doorAnswer.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

/** The area's mount of the page: one route, keyed by item. */
function StudioAccessRoute() {
  const { packageId = '', name = '' } = useParams<{ packageId?: string; name?: string }>();
  const { pathname, search } = useLocation();
  return (
    <>
      <span data-testid="route">{pathname + search}</span>
      <StudioPermissionSetPage key={`${packageId}/${name}`} packageId={packageId} name={name} readOnly={packageId === BASE_PKG} />
    </>
  );
}

/** A package's set at its metadata address: the base's own set, or the copy in the pair. */
function renderAccess(pkg = BASE_PKG, lang: 'en' | 'zh' = 'en') {
  const set = pkg === BASE_PKG ? BASE_SET : COPY_NAME;
  const tree = (
    <MemoryRouter initialEntries={[`/studio/${pkg}/metadata/permission/${set}?package=${pkg}`]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/permission/:name" element={<StudioAccessRoute />} />
      </Routes>
    </MemoryRouter>
  );
  if (lang === 'en') {
    render(tree);
    return;
  }
  const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
  render(<I18nProvider instance={zh}>{tree}</I18nProvider>);
}

/** The header's ⋯ menu, opened. */
async function openMore() {
  const more = await screen.findByTestId('studio-detail-more', undefined, { timeout: 8000 });
  fireEvent.pointerDown(more, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}
/** "New similar" in the open ⋯ menu. */
const newSimilar = async (label = en('perm.clone.action')) => {
  await openMore();
  return screen.findByRole('menuitem', { name: label }, { timeout: 8000 });
};
const route = () => screen.getByTestId('route').textContent ?? '';
/** The copy's metadata address in `pkg`. */
const copyAt = (pkg: string) => `/studio/${pkg}/metadata/permission/${COPY_NAME}`;
const baseAt = `/studio/${BASE_PKG}/metadata/permission/${BASE_SET}`;

async function fillAndCreate() {
  fireEvent.click(await newSimilar());
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(en('perm.clone.name')), { target: { value: COPY_NAME } });
  fireEvent.change(within(dialog).getByLabelText(en('perm.clone.label')), { target: { value: COPY_LABEL } });
  fireEvent.click(within(dialog).getByRole('button', { name: en('perm.clone.confirm') }));
  return dialog;
}

beforeEach(() => {
  clientImpl = makeClient({ [BASE_SET]: { pkg: BASE_PKG, body: BASE_BODY } });
  canAuthor = true;
  walled = false;
  doorAnswer = landedIn(CUSTOM_PKG);
  calls.length = 0;
  stubFetch();
  window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('objectstack#28573 — New similar on a read-only base permission set', () => {
  it('reads "New similar" (en) and draws no override gesture on the base set', async () => {
    renderAccess();
    expect(await newSimilar()).not.toHaveAttribute('aria-disabled', 'true');
    expect(en('perm.clone.action')).toBe('New similar');
    expect(screen.queryByRole('button', { name: /customi[sz]e|override/i })).toBeNull();
  });

  it('posts exactly { name, label } and opens the copy in the package the answer names, selected', async () => {
    renderAccess();
    await fillAndCreate();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: DOOR, method: 'POST', body: { name: COPY_NAME, label: COPY_LABEL } });

    // The copy's own address, in the pair.
    await waitFor(() => expect(new URL(route(), 'http://x').pathname).toBe(copyAt(CUSTOM_PKG)));
    expect(new URL(route(), 'http://x').searchParams.get('package')).toBe(CUSTOM_PKG);
    expect(await screen.findByRole('heading', { level: 1, name: COPY_LABEL }, { timeout: 8000 })).toBeInTheDocument();
    expect(clientImpl.list).toHaveBeenCalledWith('permission', { packageId: CUSTOM_PKG });
    // Where it went and what was not copied, in the server's words.
    const strip = screen.getByTestId('access-new-similar-strip');
    expect(strip).toHaveTextContent(
      tFormat('engine.studio.access.newSimilar.done', 'en', { name: COPY_NAME, package: CUSTOM_PKG }),
    );
    expect(strip).toHaveTextContent(NOTICE);
  });

  it("objectstack#32774 — clones the base's set by its package where the environment holds the name too", async () => {
    // The published list the matrix reads its holder from serves two holders
    // of the name: the environment's own set and the base's.
    const list = clientImpl.list.getMockImplementation()!;
    clientImpl.list.mockImplementation(async (type: string, opts: { packageId?: string } = {}) =>
      type === 'permission' && !opts.packageId
        ? [
            { name: BASE_SET, label: 'Sales rep', _packageId: 'sys_metadata' },
            { name: BASE_SET, label: 'Sales rep', _packageId: BASE_PKG },
          ]
        : list(type, opts),
    );
    renderAccess();
    await fillAndCreate();
    await waitFor(() => expect(calls).toHaveLength(1));
    // CONTROL (the case above): one holder posts to the door by the name alone.
    expect(calls[0]).toEqual({ url: `${DOOR}?package=${BASE_PKG}`, method: 'POST', body: { name: COPY_NAME, label: COPY_LABEL } });
  });

  for (const pkg of ['absent', null] as const) {
    it(`an answer whose package is ${pkg === null ? 'null' : 'absent'} opens nothing and says so`, async () => {
      doorAnswer = landedIn(pkg);
      renderAccess();
      await fillAndCreate();

      const strip = await screen.findByTestId('access-new-similar-strip');
      expect(strip).toHaveTextContent(tFormat('engine.studio.access.newSimilar.noPackage', 'en', { name: COPY_NAME }));
      expect(strip).toHaveTextContent(NOTICE);
      expect(route()).toBe(`${baseAt}?package=${BASE_PKG}`);
      expect(clientImpl.layered.mock.calls.every((c: unknown[]) => c[1] === BASE_SET)).toBe(true);
    });
  }

  it('an answer that names no copy opens nothing and says so', async () => {
    doorAnswer = { status: 200, body: { success: true, data: { package: CUSTOM_PKG, notice: NOTICE } } };
    renderAccess();
    await fillAndCreate();

    expect(await screen.findByTestId('access-new-similar-strip')).toHaveTextContent(en('perm.clone.noName'));
    expect(new URL(route(), 'http://x').pathname).toBe(baseAt);
  });

  it('409: the server\'s sentence in the dialog, which stays open on the base', async () => {
    doorAnswer = {
      status: 409,
      body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: NAME_TAKEN, httpStatus: 409 } },
    };
    renderAccess();
    const dialog = await fillAndCreate();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(NAME_TAKEN);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(new URL(route(), 'http://x').pathname).toBe(baseAt);
  });

  it('walled posture: disabled, in the console\'s own words, and nothing is sent', async () => {
    walled = true;
    renderAccess();
    const button = await newSimilar();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(
      tFormat('engine.catalog.readOnly.walled', 'en', { type: translateMetadataType('permission', 'en') }),
    );
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('a caller without manage_metadata: disabled, with the capability sentence', async () => {
    canAuthor = false;
    renderAccess();
    const button = await newSimilar();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(en('engine.edit.capabilityReadOnly'));
  });

  it('a writable package\'s set offers no New similar', async () => {
    clientImpl = makeClient({ [COPY_NAME]: { pkg: CUSTOM_PKG, body: { ...BASE_BODY, name: COPY_NAME, label: COPY_LABEL } } });
    renderAccess(CUSTOM_PKG);
    expect(await screen.findByRole('heading', { level: 1, name: COPY_LABEL }, { timeout: 8000 })).toBeInTheDocument();
    await openMore();
    await screen.findByRole('menuitem', { name: en('perm.basics.editHint') });
    expect(screen.queryByRole('menuitem', { name: en('perm.clone.action') })).toBeNull();
  });
});

/**
 * objectstack#29727 — the door names its notice by a code, one per landing
 * (`PERMISSION_SET_CLONE_ENVIRONMENT_WIDE`, `_IN_PACKAGE`,
 * `_IN_CREATED_PACKAGE`), and the package the sentence names is `data.package`.
 * A zh screen shows each landing's sentence in zh, with that package; the wire
 * `notice` stays the sentence for a code this console does not know, and for
 * an answer that sends none (CONTROL).
 */
describe('objectstack#29727 — New similar on a permission set: the notice in the reader\'s language', () => {
  const zh = (key: string) => t(key, 'zh-CN');

  async function cloneInZh(): Promise<HTMLElement> {
    renderAccess(BASE_PKG, 'zh');
    fireEvent.click(await newSimilar(zh('perm.clone.action')));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(zh('perm.clone.name')), { target: { value: COPY_NAME } });
    fireEvent.change(within(dialog).getByLabelText(zh('perm.clone.label')), { target: { value: COPY_LABEL } });
    fireEvent.click(within(dialog).getByRole('button', { name: zh('perm.clone.confirm') }));
    return screen.findByTestId('access-new-similar-strip', undefined, { timeout: 8000 });
  }

  const landings = [
    { code: 'PERMISSION_SET_CLONE_IN_CREATED_PACKAGE', key: 'perm.clone.notice.inCreatedPackage', pkg: CUSTOM_PKG },
    { code: 'PERMISSION_SET_CLONE_IN_PACKAGE', key: 'perm.clone.notice.inPackage', pkg: CUSTOM_PKG },
    { code: 'PERMISSION_SET_CLONE_ENVIRONMENT_WIDE', key: 'perm.clone.notice.environmentWide', pkg: null },
  ] as const;

  for (const { code, key, pkg } of landings) {
    it(`zh: ${code} shows its zh sentence${pkg ? ', naming the package the answer names' : ''}, not the wire English`, async () => {
      doorAnswer = landedIn(pkg, code);
      const strip = await cloneInZh();
      if (pkg !== null) {
        // The copy opens in the package the answer names: the code rides the navigation there.
        await waitFor(() => expect(new URL(route(), 'http://x').pathname).toBe(copyAt(pkg)));
      }
      expect(strip).not.toHaveTextContent(NOTICE);
      expect(zh(key)).not.toBe(key);
      expect(strip).toHaveTextContent(pkg === null ? zh(key) : tFormat(key, 'zh-CN', { package: pkg }));
      if (pkg !== null) expect(strip).toHaveTextContent(pkg);
    });
  }

  it('CONTROL zh: a code this console does not know shows the wire notice as sent', async () => {
    doorAnswer = landedIn(CUSTOM_PKG, 'PERMISSION_SET_CLONE_SOMEWHERE_NEWER');
    expect(await cloneInZh()).toHaveTextContent(NOTICE);
  });

  it('CONTROL zh: an answer with no code shows the wire notice as sent', async () => {
    doorAnswer = landedIn(CUSTOM_PKG);
    expect(await cloneInZh()).toHaveTextContent(NOTICE);
  });
});
