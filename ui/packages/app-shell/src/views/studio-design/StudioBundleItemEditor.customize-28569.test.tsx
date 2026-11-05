// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28569 (ADR-0146 Consequences, D2) — the All metadata area's form
 * editor of an email template and a translation.
 *
 * Through the mounted editor, its real autosave and version pin, Setup's real
 * form (`SchemaForm` over `default-schemas.ts`'s entries), the real Customize
 * controls and the real ensure-door client (`ensureCustomizationPackage`)
 * over a fetch stub. The metadata client is a server double that keys every
 * row by `(type, name, member)`, as the server does since ruling 6116165299:
 * an email template's member is its locale, a translation has none. The
 * editor is handed what the Studio surface hands it (`StudioBaseCustomization`)
 * by a host that takes the pair's id from the door's answer.
 *
 * Pinned:
 *  - a writable package: an edit writes that package's draft, no door, no declaration;
 *  - a read-only base: Customize and an edit write the pair's draft declaring
 *    the override, for one email template locale and for one translation
 *    bundle; the base is untouched;
 *  - the other locale of the same template is neither read for the badge nor
 *    written, and still serves the base's version;
 *  - the translation says it replaces the whole bundle before the first save;
 *  - Restore deletes the pair's draft and row of that one member, and the
 *    base's version reads back;
 *  - a walled caller sees Customize disabled, and nothing is asked or sent.
 *
 * objectstack#30064 — a read-only base's dataset, in the same editor with the
 * type's registered designer (a probe here): the whole dataset written into
 * the pair, declared; what uses it listed from the references read before
 * anything is published, a failed read said as failed; a designer's blocking
 * issue holding the edit unsent; and a kept publish refusal shown at the item.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const BASE = 'com.example.hotcrm';
const PAIR = 'com.example.hotcrm.custom';
const WRITABLE = 'com.example.crm';

const srv = vi.hoisted(() => ({
  /** `type/name/member` → body, per package. */
  rows: new Map<string, Map<string, Record<string, unknown>>>(),
  drafts: new Map<string, Map<string, Record<string, unknown>>>(),
  pairExists: false,
  ensure: [] as number[],
  saves: [] as Array<{ type: string; name: string; body: Record<string, unknown>; opts: Record<string, unknown> }>,
  resets: [] as Array<{ type: string; name: string; opts: Record<string, unknown> }>,
  reads: [] as Array<{ op: string; type: string; name: string; opts: Record<string, unknown> }>,
  version: 0,
}));

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** The canonical member when none is named, as the server reads a bare name. */
const slot = (type: string, name: string, member?: string) =>
  `${type}/${name}/${type === 'email_template' ? (member ?? 'en-US') : ''}`;
const at = (map: Map<string, Map<string, Record<string, unknown>>>, pkg: string) => {
  if (!map.has(pkg)) map.set(pkg, new Map());
  return map.get(pkg)!;
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  getDraft: vi.fn(async (type: string, name: string, opts: { packageId?: string; member?: string } = {}) => {
    srv.reads.push({ op: 'getDraft', type, name, opts: clone(opts) });
    const draft = srv.drafts.get(opts.packageId ?? '')?.get(slot(type, name, opts.member));
    return draft ? { type, name, item: clone(draft), version: `v${srv.version}` } : null;
  }),
  layered: vi.fn(async (type: string, name: string, opts: { packageId?: string; member?: string } = {}) => {
    srv.reads.push({ op: 'layered', type, name, opts: clone(opts) });
    const key = slot(type, name, opts.member);
    const code = srv.rows.get(opts.packageId ?? '')?.get(key) ?? null;
    // N-10: the pair's declaring row is served over the base's item, member by member.
    const overlay = opts.packageId === BASE ? (srv.rows.get(PAIR)?.get(key) ?? null) : null;
    if (!code && !overlay) throw Object.assign(new Error('Not found'), { status: 404 });
    return {
      code: code ? clone(code) : null,
      overlay: overlay ? clone(overlay) : null,
      overlayScope: overlay ? 'env' : null,
      effective: clone(overlay ?? code),
    };
  }),
  save: vi.fn(async (type: string, name: string, item: unknown, opts: Record<string, unknown> = {}) => {
    srv.saves.push({ type, name, body: clone(item) as Record<string, unknown>, opts: clone(opts) });
    const pkg = String(opts.packageId ?? '');
    if (pkg !== PAIR && pkg !== WRITABLE) {
      throw Object.assign(new Error(`Package '${pkg}' is read-only.`), { status: 403 });
    }
    const body = item as Record<string, unknown>;
    at(srv.drafts, pkg).set(slot(type, name, body.locale as string | undefined), clone(body));
    srv.version += 1;
    return { success: true, version: `v${srv.version}`, state: 'draft' };
  }),
  references: vi.fn(async (_type: string, _name: string): Promise<unknown[]> => []),
  reset: vi.fn(async (type: string, name: string, opts: Record<string, unknown> = {}) => {
    srv.resets.push({ type, name, opts: clone(opts) });
    const map = opts.state === 'draft' ? srv.drafts : srv.rows;
    map.get(String(opts.packageId ?? ''))?.delete(slot(type, name, opts.member as string | undefined));
    return { success: true };
  }),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    // No served schema: the form is `default-schemas.ts`'s, as against a server that serves none.
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { StudioBundleItemEditor } from './StudioBundleItemEditor';
import type { StudioBaseCustomization } from './StudioDesignSurface';
import { ensureCustomizationPackage } from './packages-io';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerDefaultMetadataSchemas } from '../metadata-admin/default-schemas';
import {
  registerMetadataDefaultInspector,
  type MetadataDefaultInspectorProps,
} from '../metadata-admin/default-inspector-registry';
import type { StudioRefusal } from './metadataError';

/**
 * The dataset's designer slot: the draft it is handed, its read-only gate, one
 * edit (the second measure's aggregate) and one blocking report.
 */
function DesignerProbe({ draft, onPatch, onBlockingIssuesChange, readOnly }: MetadataDefaultInspectorProps) {
  const measures = Array.isArray(draft.measures) ? (draft.measures as Array<Record<string, unknown>>) : [];
  return (
    <div data-testid="designer-probe" data-readonly={String(readOnly)}>
      <p data-testid="designer-probe-aggregate">{String(measures[1]?.aggregate ?? '')}</p>
      <button
        type="button"
        data-testid="designer-probe-avg"
        disabled={readOnly}
        onClick={() => onPatch({ measures: measures.map((m, i) => (i === 1 ? { ...m, aggregate: 'avg' } : m)) })}
      >
        avg
      </button>
      <button
        type="button"
        data-testid="designer-probe-blank-dimension"
        disabled={readOnly}
        onClick={() => {
          onPatch({ dimensions: [{ name: 'stage' }] });
          onBlockingIssuesChange?.(1);
        }}
      >
        blank
      </button>
    </div>
  );
}

/** The preview slot, printing the live draft it is handed. */
function PreviewProbe({ draft }: { draft: Record<string, unknown> }) {
  return <p data-testid="preview-probe">{String(draft.subject ?? draft.label ?? '')}</p>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const WELCOME_EN = {
  name: 'welcome',
  label: 'Welcome',
  locale: 'en-US',
  subject: 'Welcome to HotCRM',
  bodyHtml: '<p>Hello {{user.name}}</p>',
  _packageId: BASE,
};
const WELCOME_ZH = { ...WELCOME_EN, locale: 'zh-CN', subject: '欢迎使用 HotCRM', bodyHtml: '<p>你好 {{user.name}}</p>' };
const METRICS = {
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'crm_opportunity',
  dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
    { name: 'total_amount', label: 'Total Amount', aggregate: 'sum', field: 'amount' },
  ],
  _packageId: BASE,
};
/** What the references read answers for the dataset (`client.references`, mapped from the served `references[]`). */
const USED_BY = [
  {
    fromType: 'dashboard',
    fromName: 'pipeline_dashboard',
    fromLabel: 'Pipeline Dashboard',
    path: 'widgets[].dataset',
    kind: 'dashboard dataset',
    value: 'opportunity_metrics',
  },
  {
    fromType: 'dashboard',
    fromName: 'pipeline_dashboard',
    fromLabel: 'Pipeline Dashboard',
    path: 'widgets[].compare.dataset',
    kind: 'dashboard dataset',
    value: 'opportunity_metrics',
  },
  { fromType: 'report', fromName: 'won_by_stage', path: 'dataset', kind: 'report dataset', value: 'opportunity_metrics' },
];
const BUNDLE_ZH = {
  name: 'hotcrm_zh',
  label: 'HotCRM zh-CN',
  locale: 'zh-CN',
  strings: { greeting: '你好', farewell: '再见' },
  _packageId: BASE,
};

beforeAll(() => {
  registerDefaultMetadataSchemas();
  registerMetadataPreview('email_template', PreviewProbe as never);
  registerMetadataPreview('translation', PreviewProbe as never);
  registerMetadataDefaultInspector('dataset', DesignerProbe);
});

beforeEach(() => {
  srv.rows.clear();
  srv.drafts.clear();
  at(srv.rows, BASE).set(slot('email_template', 'welcome', 'en-US'), clone(WELCOME_EN));
  at(srv.rows, BASE).set(slot('email_template', 'welcome', 'zh-CN'), clone(WELCOME_ZH));
  at(srv.rows, BASE).set(slot('translation', 'hotcrm_zh'), clone(BUNDLE_ZH));
  at(srv.rows, WRITABLE).set(slot('email_template', 'welcome', 'zh-CN'), { ...clone(WELCOME_ZH), _packageId: WRITABLE });
  at(srv.rows, BASE).set(slot('dataset', 'opportunity_metrics'), clone(METRICS));
  srv.pairExists = false;
  srv.ensure.length = 0;
  srv.saves.length = 0;
  srv.resets.length = 0;
  srv.reads.length = 0;
  srv.version = 0;
  for (const fn of Object.values(mockClient)) fn.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path === `/api/v1/packages/${BASE}/ensure-customization` && init?.method === 'POST') {
        const created = !srv.pairExists;
        srv.pairExists = true;
        srv.ensure.push(created ? 201 : 200);
        return json(
          {
            success: true,
            data: { basePackageId: BASE, packageId: PAIR, namespace: 'hotcrm_custom', dependencyRange: '^4', created, writable: true },
          },
          created ? 201 : 200,
        );
      }
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** What the Studio surface hands the editor on a read-only base: the pair's id comes from the door's answer. */
function Host({
  type,
  name,
  member,
  packageId = BASE,
  walled = false,
  listedPair = null,
  publishRefusal = null,
}: {
  type: string;
  name: string;
  member?: string;
  packageId?: string;
  walled?: boolean;
  listedPair?: string | null;
  publishRefusal?: StudioRefusal | null;
}) {
  const readOnly = packageId === BASE;
  const [pairId, setPairId] = React.useState<string | null>(listedPair);
  const ensurePackage = React.useCallback(async () => {
    const answer = await ensureCustomizationPackage(BASE);
    setPairId(answer.packageId);
    return answer;
  }, []);
  const ensure = React.useCallback(async () => (await ensurePackage()).packageId, [ensurePackage]);
  const customization = React.useMemo<StudioBaseCustomization | null>(
    () =>
      readOnly
        ? { base: BASE, baseLabel: 'HotCRM', basedOn: '4.0.0', walled, pairId, ensure, ensurePackage, marks: { status: 'off' } }
        : null,
    [readOnly, walled, pairId, ensure, ensurePackage],
  );
  return (
    <StudioBundleItemEditor
      packageId={packageId}
      type={type}
      name={name}
      member={member}
      readOnly={readOnly}
      customization={customization}
      basePath={`/studio/${packageId}/metadata`}
      publishRefusal={publishRefusal}
    />
  );
}

function mount(props: React.ComponentProps<typeof Host>) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${props.packageId ?? BASE}/metadata/${props.type}/${props.name}`]}>
      <Host {...props} />
    </MemoryRouter>,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A form field by its label; a required one carries a mark after its title. */
const labelled = (title: string) => new RegExp(`^${title}\\b`);
async function field(title: string): Promise<HTMLInputElement> {
  return (await screen.findByLabelText(labelled(title), undefined, { timeout: 8000 })) as HTMLInputElement;
}

async function customize(): Promise<void> {
  fireEvent.click(await screen.findByTestId('studio-customize', undefined, { timeout: 8000 }));
  await waitFor(() => expect(screen.queryByTestId('studio-customize')).toBeNull());
}

/** objectstack#29692 — Restore is asked from the override mark's popover. */
async function restore(): Promise<void> {
  fireEvent.click(await screen.findByTestId('studio-override-chip', undefined, { timeout: 8000 }));
  const popover = await screen.findByTestId('studio-override-popover');
  await waitFor(() => expect(within(popover).getByTestId('studio-override-restore')).toBeEnabled(), { timeout: 8000 });
  fireEvent.click(within(popover).getByTestId('studio-override-restore'));
  const dialog = await screen.findByTestId('studio-restore-original-dialog');
  fireEvent.click(within(dialog).getByTestId('studio-restore-original-confirm'));
}

describe('a writable package (objectstack#28569)', () => {
  it('an edit writes that package’s draft of the member, with no door and no declaration', async () => {
    mount({ type: 'email_template', name: 'welcome', member: 'zh-CN', packageId: WRITABLE });
    const subject = await field('Subject');
    expect(subject).toHaveValue('欢迎使用 HotCRM');
    expect(subject).not.toHaveAttribute('readonly');
    // The member is the item: the form never offers it.
    expect(screen.queryByLabelText(labelled('Locale'))).toBeNull();
    expect(screen.getByTestId('studio-bundle-editor-locale')).toHaveTextContent('zh-CN');
    expect(screen.queryByTestId('studio-customize')).toBeNull();

    fireEvent.change(subject, { target: { value: '欢迎！' } });
    // The preview is handed the live draft.
    expect(screen.getByTestId('preview-probe')).toHaveTextContent('欢迎！');
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 5000 });

    const [save] = srv.saves;
    expect(save).toMatchObject({ type: 'email_template', name: 'welcome' });
    expect(save.opts).toMatchObject({ mode: 'draft', packageId: WRITABLE, ifNoneMatch: '*' });
    expect(save.body).toMatchObject({ locale: 'zh-CN', subject: '欢迎！' });
    expect(save.body).not.toHaveProperty('overrides');
    expect(Object.keys(save.body).filter((key) => key.startsWith('_'))).toEqual([]);
    expect(srv.ensure).toEqual([]);
    expect(await screen.findByTestId('studio-bundle-editor-status')).toHaveTextContent('Unpublished draft');
  });
});

describe('Customize a read-only base’s email template, one locale (objectstack#28569)', () => {
  it('Customize unlocks the form and writes nothing; the first saved edit asks the door once and writes the pair’s draft of that locale', async () => {
    mount({ type: 'email_template', name: 'welcome', member: 'zh-CN' });
    const subject = await field('Subject');
    expect(subject).toHaveAttribute('readonly');
    expect(screen.getByTestId('studio-bundle-editor-one-locale')).toHaveTextContent('zh-CN');

    await customize();
    expect(await field('Subject')).not.toHaveAttribute('readonly');
    await sleep(2000);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
    expect(screen.queryByTestId('studio-override-chip')).toBeNull();

    fireEvent.change(await field('Subject'), { target: { value: '欢迎加入' } });
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 5000 });
    expect(srv.ensure).toEqual([201]);
    const [save] = srv.saves;
    expect(save.opts).toMatchObject({ mode: 'draft', packageId: PAIR, ifNoneMatch: '*' });
    expect(save.body).toEqual({
      name: 'welcome',
      label: 'Welcome',
      locale: 'zh-CN',
      subject: '欢迎加入',
      bodyHtml: '<p>你好 {{user.name}}</p>',
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    // The badge reads the declaration the server now serves for this member.
    expect(await screen.findByTestId('studio-override-chip')).toHaveTextContent('Overrides HotCRM');
    expect(screen.queryByTestId('studio-bundle-editor-one-locale')).toBeNull();
    // The base is untouched.
    expect(srv.rows.get(BASE)?.get(slot('email_template', 'welcome', 'zh-CN'))).toEqual(WELCOME_ZH);

    // The pair's draft is asked for this member, never the canonical one.
    const pairDraftReads = srv.reads.filter((r) => r.op === 'getDraft' && r.opts.packageId === PAIR);
    expect(pairDraftReads.length).toBeGreaterThan(0);
    expect(pairDraftReads.every((r) => r.opts.member === 'zh-CN')).toBe(true);
  });

  it('the other locale of the same template is untouched: no badge, the base’s version, nothing written', async () => {
    // zh-CN is customized and published in the pair; en-US is not.
    at(srv.rows, PAIR).set(slot('email_template', 'welcome', 'zh-CN'), {
      ...clone(WELCOME_ZH),
      subject: '欢迎加入',
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    delete at(srv.rows, PAIR).get(slot('email_template', 'welcome', 'zh-CN'))!._packageId;
    srv.pairExists = true;

    mount({ type: 'email_template', name: 'welcome', member: 'en-US', listedPair: PAIR });
    expect(await field('Subject')).toHaveValue('Welcome to HotCRM');
    await sleep(500);
    expect(screen.queryByTestId('studio-override-chip')).toBeNull();
    expect(screen.getByTestId('studio-customize')).toBeEnabled();
    const memberReads = srv.reads.filter((r) => r.opts.packageId === BASE || r.opts.packageId === PAIR);
    expect(memberReads.every((r) => r.opts.member === 'en-US')).toBe(true);

    cleanup();
    mount({ type: 'email_template', name: 'welcome', member: 'zh-CN', listedPair: PAIR });
    expect(await field('Subject')).toHaveValue('欢迎加入');
    expect(await screen.findByTestId('studio-override-chip')).toBeInTheDocument();
    expect(srv.saves).toEqual([]);
  });

  it('Restore deletes the pair’s draft and row of that locale alone, and the base’s version reads back', async () => {
    at(srv.rows, PAIR).set(slot('email_template', 'welcome', 'zh-CN'), {
      name: 'welcome',
      label: 'Welcome',
      locale: 'zh-CN',
      subject: '欢迎加入',
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    at(srv.drafts, PAIR).set(slot('email_template', 'welcome', 'zh-CN'), {
      name: 'welcome',
      label: 'Welcome',
      locale: 'zh-CN',
      subject: '欢迎回来',
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    srv.pairExists = true;

    mount({ type: 'email_template', name: 'welcome', member: 'zh-CN', listedPair: PAIR });
    expect(await field('Subject')).toHaveValue('欢迎回来');
    expect(await screen.findByTestId('studio-override-chip')).toBeInTheDocument();
    // objectstack#29692 — one door: the editor's ⋯ menu offers no Restore.
    fireEvent.pointerDown(screen.getByTestId('studio-bundle-editor-more'), { button: 0, ctrlKey: false });
    await screen.findByTestId('studio-bundle-editor-history');
    expect(screen.queryByTestId('studio-restore-original')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('studio-bundle-editor-history'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('studio-bundle-editor-history')).toBeNull());

    await restore();
    await waitFor(() => expect(srv.resets).toHaveLength(2));
    expect(srv.resets).toEqual([
      { type: 'email_template', name: 'welcome', opts: { state: 'draft', packageId: PAIR, member: 'zh-CN' } },
      { type: 'email_template', name: 'welcome', opts: { packageId: PAIR, member: 'zh-CN' } },
    ]);
    await waitFor(() => expect(screen.getByLabelText(labelled('Subject'))).toHaveValue('欢迎使用 HotCRM'));
    await waitFor(() => expect(screen.queryByTestId('studio-override-chip')).toBeNull());
    expect(screen.getByTestId('studio-customize')).toBeInTheDocument();
    expect(srv.saves).toEqual([]);
  });

  it('a walled caller sees Customize disabled with its reason, and nothing is asked or sent', async () => {
    mount({ type: 'email_template', name: 'welcome', member: 'zh-CN', walled: true });
    expect(await field('Subject')).toHaveAttribute('readonly');
    const blocked = await screen.findByTestId('studio-customize-blocked');
    expect(blocked).toHaveAttribute('data-block', 'walled');
    expect(within(blocked).getByTestId('studio-customize')).toBeDisabled();
    fireEvent.click(within(blocked).getByTestId('studio-customize'));
    await sleep(2000);
    expect(screen.getByLabelText(labelled('Subject'))).toHaveAttribute('readonly');
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });
});

describe('Customize a read-only base’s translation bundle (objectstack#28569)', () => {
  it('says the bundle is replaced whole before the first save, then writes the whole bundle into the pair, declared', async () => {
    mount({ type: 'translation', name: 'hotcrm_zh' });
    const label = await field('Label');
    expect(label).toHaveValue('HotCRM zh-CN');
    expect(screen.getByTestId('studio-bundle-editor-whole-bundle')).toHaveTextContent(
      'Customizing a translation replaces HotCRM’s whole zh-CN bundle',
    );

    await customize();
    expect(screen.getByTestId('studio-bundle-editor-whole-bundle')).toBeInTheDocument();
    fireEvent.change(await field('Label'), { target: { value: 'HotCRM 中文' } });
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 5000 });
    expect(srv.ensure).toEqual([201]);
    const [save] = srv.saves;
    expect(save.opts).toMatchObject({ mode: 'draft', packageId: PAIR });
    // The whole bundle, every string included, as one replacement.
    expect(save.body).toEqual({
      name: 'hotcrm_zh',
      label: 'HotCRM 中文',
      locale: 'zh-CN',
      strings: { greeting: '你好', farewell: '再见' },
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    // A translation has no member: no read or write names one.
    expect(srv.reads.every((r) => !('member' in r.opts))).toBe(true);
    expect(await screen.findByTestId('studio-override-chip')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('studio-bundle-editor-whole-bundle')).toBeNull());
  });
});

describe('Customize a read-only base’s dataset (objectstack#30064)', () => {
  beforeEach(() => {
    mockClient.references.mockImplementation(async () => clone(USED_BY));
  });

  it('opens the designer read-only, says the whole dataset is copied, and lists what uses it before anything is published', async () => {
    mount({ type: 'dataset', name: 'opportunity_metrics' });
    const probe = await screen.findByTestId('designer-probe', undefined, { timeout: 8000 });
    expect(probe).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('designer-probe-aggregate')).toHaveTextContent('sum');
    expect(screen.getByTestId('studio-bundle-editor-whole-dataset')).toHaveTextContent(
      'Customizing a dataset copies HotCRM’s whole dataset into your customization',
    );
    const usedBy = await screen.findByTestId('studio-bundle-editor-used-by');
    await waitFor(() => expect(usedBy).toHaveAttribute('data-state', 'loaded'));
    expect(mockClient.references).toHaveBeenCalledWith('dataset', 'opportunity_metrics');
    // One entry per referring item: the dashboard binding it twice is one dashboard.
    const items = within(usedBy).getAllByTestId('studio-bundle-editor-used-by-item');
    expect(items.map((el) => [el.getAttribute('data-type'), el.getAttribute('data-name')])).toEqual([
      ['dashboard', 'pipeline_dashboard'],
      ['report', 'won_by_stage'],
    ]);
    expect(items[0]).toHaveTextContent('Pipeline Dashboard');
    expect(items[1]).toHaveTextContent('won_by_stage');
    expect(usedBy).toHaveTextContent('reaches the 2 items built on this dataset');
    expect(srv.saves).toEqual([]);
  });

  it('Customize and an edit in the designer write the whole dataset into the pair’s draft, declared; the base is untouched', async () => {
    mount({ type: 'dataset', name: 'opportunity_metrics' });
    await screen.findByTestId('designer-probe', undefined, { timeout: 8000 });
    await customize();
    await waitFor(() => expect(screen.getByTestId('designer-probe')).toHaveAttribute('data-readonly', 'false'));
    fireEvent.click(screen.getByTestId('designer-probe-avg'));
    await waitFor(() => expect(srv.saves).toHaveLength(1), { timeout: 5000 });
    expect(srv.ensure).toEqual([201]);
    const [save] = srv.saves;
    expect(save).toMatchObject({ type: 'dataset', name: 'opportunity_metrics' });
    expect(save.opts).toMatchObject({ mode: 'draft', packageId: PAIR, ifNoneMatch: '*' });
    const { _packageId: _dropped, ...whole } = clone(METRICS);
    expect(save.body).toEqual({
      ...whole,
      measures: [whole.measures[0], { ...whole.measures[1], aggregate: 'avg' }],
      overrides: { package: BASE, basedOn: '4.0.0' },
    });
    expect(await screen.findByTestId('studio-override-chip')).toHaveTextContent('Overrides HotCRM');
    await waitFor(() => expect(screen.queryByTestId('studio-bundle-editor-whole-dataset')).toBeNull());
    // What uses it stays in view until the change is published.
    expect(screen.getByTestId('studio-bundle-editor-used-by')).toBeInTheDocument();
    expect(srv.rows.get(BASE)?.get(slot('dataset', 'opportunity_metrics'))).toEqual(METRICS);
  });

  it('holds an edit the designer reports as blocking: nothing is sent', async () => {
    mount({ type: 'dataset', name: 'opportunity_metrics' });
    await screen.findByTestId('designer-probe', undefined, { timeout: 8000 });
    await customize();
    await waitFor(() => expect(screen.getByTestId('designer-probe')).toHaveAttribute('data-readonly', 'false'));
    fireEvent.click(screen.getByTestId('designer-probe-blank-dimension'));
    await sleep(2500);
    expect(srv.ensure).toEqual([]);
    expect(srv.saves).toEqual([]);
  });

  it('a references read that failed says so and asks again; it never reads as nothing using the dataset', async () => {
    mockClient.references.mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { status: 503 }));
    mount({ type: 'dataset', name: 'opportunity_metrics' });
    const usedBy = await screen.findByTestId('studio-bundle-editor-used-by', undefined, { timeout: 8000 });
    await waitFor(() => expect(usedBy).toHaveAttribute('data-state', 'error'));
    expect(within(usedBy).getByRole('alert')).toHaveTextContent('could not be read');
    expect(usedBy).not.toHaveTextContent('Nothing uses this dataset');
    fireEvent.click(within(usedBy).getByTestId('studio-bundle-editor-used-by-retry'));
    await waitFor(() => expect(usedBy).toHaveAttribute('data-state', 'loaded'));
    expect(within(usedBy).getAllByTestId('studio-bundle-editor-used-by-item')).toHaveLength(2);
  });

  it('a read that answers no reference says nothing uses the dataset', async () => {
    mockClient.references.mockImplementation(async () => []);
    mount({ type: 'dataset', name: 'opportunity_metrics' });
    const usedBy = await screen.findByTestId('studio-bundle-editor-used-by', undefined, { timeout: 8000 });
    await waitFor(() => expect(usedBy).toHaveAttribute('data-state', 'loaded'));
    expect(usedBy).toHaveTextContent('Nothing uses this dataset yet');
  });

  it('shows the refusal the header’s Publish kept for the dataset at the item, with the server’s text under Details', async () => {
    mount({
      type: 'dataset',
      name: 'opportunity_metrics',
      listedPair: PAIR,
      publishRefusal: {
        message: 'Not published. Check Aggregate of the measure “Total Amount”: Details say what to change.',
        target: null,
        input: 'Aggregate',
        detail: 'datasets.opportunity_metrics.measures[1].aggregate — aggregate "sum" over field "expected_revenue" is refused',
      },
    });
    const strip = await screen.findByTestId('studio-bundle-editor-publish-refusal', undefined, { timeout: 8000 });
    expect(within(strip).getByRole('alert')).toHaveTextContent('Check Aggregate of the measure “Total Amount”');
    expect(within(strip).getByTestId('studio-refusal-detail')).toHaveTextContent('expected_revenue');
  });
});
