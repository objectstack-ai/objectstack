// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12982 — Setup's DECLARED sharing rules: the environment scope of the
 * `sharing_rule` registry type (`sharing-rule-catalog.ts`; objectstack ADR-0131
 * D6 regime C, ruling A on objectstack#24378).
 *
 * The server answers below are recorded from a showcase boot of objectstack
 * `main` carrying objectstack#24428 (its two declared rules, the ledger rows
 * the door writes, the door's and the data door's refusals), trimmed to the
 * keys the page reads.
 *
 * What is pinned, each against a control:
 *
 *  - the list is the registry's declarations, read-only, with their package:
 *    no create, an edit link that keeps the scope, and a link to the
 *    organization rules page (the `sys_sharing_rule` object) where New lives;
 *  - ⛔ no request reads `GET /sharing/rules` as a list, and no
 *    `sys_sharing_rule` list is read — the page merges no second source;
 *  - Disable / Enable: the ledger's state per rule (a switched-off rule is
 *    still listed), written through the activation door, the door's refusal
 *    shown in its own words;
 *  - Clone: pre-filled from the server's projection of that one rule under a
 *    name no declaration holds, written through the data door; the server's
 *    `409 RESOURCE_CONFLICT` shown as sent; on success the offer to switch the
 *    declared rule off, which goes through the door; a rule switched off (no
 *    projection served) continues in the pre-filled New form;
 *  - the control: the permission-set catalog keeps its create affordance and
 *    shows no Clone column;
 *  - objectui#13091: the row's controls (the Active switch, Clone) are pinned
 *    to the right edge of the table's overflow box, which draws the seam
 *    shadow, so a 1440 or 1024 screen reaches them (the measured reach is
 *    `e2e/live/declared-sharing-rules-reach-13091.spec.ts`); and a principal
 *    the ledger read refuses reads a plain-language state, with the server's
 *    own sentence for why, never a bare "?".
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`; loaded here so the cost lands
// in the import phase (AGENTS.md, test discipline).
import '@objectstack/spec/identity';

/** `GET /api/v1/meta/sharing_rule`, recorded. */
const DECLARED: Record<string, unknown>[] = [
  {
    name: 'share_new_inquiries_with_field_ops',
    label: 'New Inquiries → Field Operations (BU subtree)',
    description: 'Share incoming (status=new) inquiries with the Field Operations business-unit subtree for triage.',
    object: 'showcase_inquiry',
    active: true,
    accessLevel: 'read',
    sharedWith: { type: 'unit_and_subordinates', value: 'bu_field_ops' },
    type: 'criteria',
    condition: { dialect: 'cel', source: "record.status == 'new'" },
    _packageId: 'com.example.showcase',
    _provenance: 'package',
  },
  {
    name: 'share_key_account_qualified_contacts_with_managers',
    label: 'Key-Account Qualified Contacts → Managers',
    object: 'showcase_contact',
    active: true,
    accessLevel: 'read',
    sharedWith: { type: 'position', value: 'manager' },
    type: 'criteria',
    condition: { dialect: 'cel', source: "record.stage == 'qualified' && record.company == 'Northwind'" },
    _packageId: 'com.example.showcase',
    _provenance: 'package',
  },
];

/** `GET /api/v1/sharing/rules/share_key_account_qualified_contacts_with_managers`, recorded. */
const KEY_ACCOUNT_PROJECTION = {
  id: 'share_key_account_qualified_contacts_with_managers',
  organization_id: null,
  name: 'share_key_account_qualified_contacts_with_managers',
  label: 'Key-Account Qualified Contacts → Managers',
  object_name: 'showcase_contact',
  criteria: { $and: [{ stage: 'qualified' }, { company: 'Northwind' }] },
  recipient_type: 'position',
  recipient_id: 'manager',
  access_level: 'read',
  active: true,
  managed_by: 'package',
  customized: false,
};

/** The data door's refusal of a declared name, recorded. */
const DECLARED_NAME_REFUSAL =
  "sharing rule 'share_new_inquiries_with_field_ops' is declared by the application (on object 'showcase_inquiry'), so a new rule cannot take its name. Declared rules are read-only: to customise 'share_new_inquiries_with_field_ops', create your own rule under another name and switch the declared one off (POST /api/v1/security/_activation/sharing_rule/share_new_inquiries_with_field_ops with { \"enabled\": false }).";

/** The activation door's refusal of a walled tenant, worded as the door words it. */
const WALLED_REFUSAL = 'Switching a declared sharing rule on or off is the platform operator’s on this deployment.';

const PERMISSION_SETS: Record<string, unknown>[] = [
  { name: 'showcase_auditor', label: 'Showcase Auditor', _packageId: 'com.example.showcase', _provenance: 'package' },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) =>
    type === 'sharing_rule' ? DECLARED : type === 'permission' ? PERMISSION_SETS : [],
};

// `/meta/types` as the boot serves it: the type advertises a runtime create.
const SHARING_RULE_ENTRY = { type: 'sharing_rule', label: 'sharing_rule', allowEnvironmentOverlay: false, allowRuntimeCreate: true };
const PERMISSION_ENTRY = { type: 'permission', label: 'Permission Set', allowEnvironmentOverlay: false, allowRuntimeCreate: true };

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: [SHARING_RULE_ENTRY, PERMISSION_ENTRY] }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => canAuthor,
}));

vi.mock('../../hooks/useTenancyPosture', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTenancyPosture: () => 'single',
}));

/** The data door, as the console's adapter reaches it. */
const created: Array<{ object: string; record: Record<string, unknown> }> = [];
let createAnswer: (record: Record<string, unknown>) => unknown = (record) => ({ id: 'rec_1', ...record });
const ADAPTER = {
  create: async (object: string, record: Record<string, unknown>) => {
    created.push({ object, record });
    return createAnswer(record);
  },
};
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

/** Whether the caller holds the create grant on `sys_sharing_rule` (Clone's row). */
let canCreateRule = true;
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...mod,
    usePermissions: () => {
      const base = mod.usePermissions();
      return {
        ...base,
        can: (object: string, grant: string) =>
          object === 'sys_sharing_rule' && grant === 'create' ? canCreateRule : base.can(object, grant as never),
      };
    },
  };
});

let ledgerRows: Record<string, unknown>[] = [];
/** The ledger read's answer when it is refused; `null` answers `ledgerRows`. */
let ledgerRefusal: { status: number; body: unknown } | null = null;
let doorAnswer: { status: number; body: unknown } = { status: 200, body: {} };
/** `GET /sharing/rules/:name` per name; a missing name answers the recorded 404. */
let projections: Record<string, unknown> = {};
const requests: Array<{ url: string; method: string; body?: string }> = [];

// Imported AFTER the mocks so the page picks them up.
import { MetadataResourceListPage } from './ResourceListPage';
import { registerBuiltinAnchors } from './anchors';
import { t, tFormat } from './i18n';

registerBuiltinAnchors();

beforeEach(() => {
  canAuthor = true;
  canCreateRule = true;
  ledgerRows = [];
  ledgerRefusal = null;
  doorAnswer = { status: 200, body: { success: true, data: { type: 'sharing_rule', enabled: false } } };
  projections = { share_key_account_qualified_contacts_with_managers: KEY_ACCOUNT_PROJECTION };
  createAnswer = (record) => ({ id: 'rec_1', ...record });
  created.length = 0;
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const u = String(url);
      requests.push({ url: u, method, body: init?.body as string | undefined });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (method === 'GET' && u.startsWith('/api/v1/data/sys_metadata_activation')) {
        if (ledgerRefusal) return json(ledgerRefusal.status, ledgerRefusal.body);
        return json(200, { object: 'sys_metadata_activation', records: ledgerRows, total: ledgerRows.length, hasMore: false });
      }
      if (method === 'POST' && u.startsWith('/api/v1/security/_activation/')) {
        return json(doorAnswer.status, doorAnswer.body);
      }
      const rule = u.match(/^\/api\/v1\/sharing\/rules\/([^/?]+)$/);
      if (method === 'GET' && rule) {
        const row = projections[decodeURIComponent(rule[1])];
        return row ? json(200, row) : json(404, { code: 'RULE_NOT_FOUND' });
      }
      return json(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function mount(type = 'sharing_rule', search = '?scope=environment') {
  return render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}${search}`]}>
      <Routes>
        <Route path="/apps/:appName/metadata/:type" element={<MetadataResourceListPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const KEY = 'share_key_account_qualified_contacts_with_managers';
const INQ = 'share_new_inquiries_with_field_ops';
const ADMIN_LOCALE = 'en-US';

describe('the declared rules are listed read-only, with their provenance (objectui#12982)', () => {
  it('lists both declarations with their package, keeps the scope on each link, and offers no create', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`a[href*="/${KEY}"]`)).not.toBeNull());
    for (const name of [KEY, INQ]) {
      expect(container.querySelector(`a[href*="/${name}"]`)?.getAttribute('href')).toMatch(/\?scope=environment$/);
    }
    expect(screen.getAllByText('com.example.showcase')).toHaveLength(2);
    expect(screen.getByTestId('catalog-declared-only-hint')).toHaveTextContent(
      t('engine.catalog.declaredOnly.hint.sharing_rule', ADMIN_LOCALE),
    );
    // The type entry advertises a runtime create; the declared list still offers none.
    expect(screen.queryByRole('button', { name: new RegExp(t('engine.list.create', ADMIN_LOCALE)) })).toBeNull();
  });

  it('links to the organization rules page, where an organization authors its own', async () => {
    mount();
    const link = await screen.findByTestId('catalog-authored-object-link');
    expect(link).toHaveAttribute('href', '/apps/setup/sys_sharing_rule');
  });

  it('reads no second list: no GET /sharing/rules list and no sys_sharing_rule list', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`a[href*="/${KEY}"]`)).not.toBeNull());
    await screen.findByTestId(`catalog-active-${KEY}`);
    expect(requests.some((r) => /\/sharing\/rules(\?|$)/.test(r.url))).toBe(false);
    expect(requests.some((r) => r.url.includes('sys_sharing_rule'))).toBe(false);
  });

  it('control: the permission-set catalog keeps its create affordance and has no Clone', async () => {
    const { container } = mount('permission');
    await screen.findByRole('button', { name: new RegExp(t('engine.list.create', ADMIN_LOCALE)) });
    expect(container.querySelector('[data-testid^="catalog-clone-"]')).toBeNull();
    expect(screen.queryByTestId('catalog-authored-object-link')).toBeNull();
  });
});

describe('Disable / Enable, through the activation door', () => {
  it('shows the ledger state per rule — a switched-off rule is still listed — and switches it through the door', async () => {
    ledgerRows = [{ metadata_type: 'sharing_rule', name: INQ, package_id: 'com.example.showcase', active: false }];
    mount();
    const off = await screen.findByTestId(`catalog-active-${INQ}`);
    const on = await screen.findByTestId(`catalog-active-${KEY}`);
    await waitFor(() => expect(off).toHaveAttribute('aria-checked', 'false'));
    expect(on).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(on);
    await waitFor(() => expect(on).toHaveAttribute('aria-checked', 'false'));
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.url).toBe(`/api/v1/security/_activation/sharing_rule/${KEY}`);
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ enabled: false });
  });

  it("shows the door's refusal in its own words and leaves the switch as it was", async () => {
    doorAnswer = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: WALLED_REFUSAL } } };
    mount();
    const sw = await screen.findByTestId(`catalog-active-${KEY}`);
    await waitFor(() => expect(sw).not.toBeDisabled());
    fireEvent.click(sw);
    expect(await screen.findByText(new RegExp(WALLED_REFUSAL))).toBeInTheDocument();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('a caller without manage_metadata gets the switch disabled, with the reason', async () => {
    canAuthor = false;
    mount();
    const sw = await screen.findByTestId(`catalog-active-${KEY}`);
    await waitFor(() => expect(sw).toBeDisabled());
    expect(screen.getByTestId('catalog-readonly-reason')).toHaveTextContent(
      t('engine.catalog.declaredOnly.switchReadOnly', ADMIN_LOCALE),
    );
  });
});

describe("Clone reads the authored object's create grant (`declarationClone`)", () => {
  it('a caller without the sys_sharing_rule create grant is offered no Clone; the list and switch stay', async () => {
    canCreateRule = false;
    const { container } = mount();
    await screen.findByTestId(`catalog-active-${KEY}`);
    expect(container.querySelector('[data-testid^="catalog-clone-"]')).toBeNull();
    expect(container.querySelector(`a[href*="/${INQ}"]`)).not.toBeNull();
  });

  it('control: holding it, each declared rule offers Clone', async () => {
    mount();
    await screen.findByTestId(`catalog-clone-${KEY}`);
    expect(screen.getByTestId(`catalog-clone-${INQ}`)).toBeInTheDocument();
  });
});

describe('Clone: a new-named organization rule pre-filled from the declaration', () => {
  async function openClone(name: string) {
    mount();
    fireEvent.click(await screen.findByTestId(`catalog-clone-${name}`));
    return screen.findByTestId('sharing-rule-clone-dialog');
  }

  it('pre-fills from the server projection under a name no declaration holds, and writes it through the data door', async () => {
    const dialog = await openClone(KEY);
    const nameInput = within(dialog).getByLabelText(t('engine.sharingRule.clone.name', ADMIN_LOCALE)) as HTMLInputElement;
    expect(nameInput.value).toBe(`${KEY}_copy`);
    expect(DECLARED.map((d) => d.name)).not.toContain(nameInput.value);
    await waitFor(() =>
      expect(within(dialog).getByTestId('sharing-rule-clone-criteria')).toHaveTextContent(
        JSON.stringify(KEY_ACCOUNT_PROJECTION.criteria),
      ),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.sharingRule.clone.confirm', ADMIN_LOCALE) }));
    await screen.findByTestId('sharing-rule-clone-created');
    expect(created).toEqual([
      {
        object: 'sys_sharing_rule',
        record: {
          name: `${KEY}_copy`,
          label: tFormat('engine.sharingRule.clone.copyLabel', ADMIN_LOCALE, { label: String(DECLARED[1].label) }),
          object_name: 'showcase_contact',
          criteria_json: JSON.stringify(KEY_ACCOUNT_PROJECTION.criteria),
          recipient_type: 'position',
          recipient_id: 'manager',
          access_level: 'read',
        },
      },
    ]);
  });

  it("shows the server's 409 RESOURCE_CONFLICT for a declared name, as sent", async () => {
    createAnswer = () => {
      throw Object.assign(new Error(DECLARED_NAME_REFUSAL), { error: DECLARED_NAME_REFUSAL, code: 'RESOURCE_CONFLICT' });
    };
    const dialog = await openClone(KEY);
    const nameInput = within(dialog).getByLabelText(t('engine.sharingRule.clone.name', ADMIN_LOCALE));
    fireEvent.change(nameInput, { target: { value: INQ } });
    const confirm = await within(dialog).findByRole('button', { name: t('engine.sharingRule.clone.confirm', ADMIN_LOCALE) });
    fireEvent.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(DECLARED_NAME_REFUSAL);
    expect(created[0]?.record.name).toBe(INQ);
    expect(screen.queryByTestId('sharing-rule-clone-created')).toBeNull();
  });

  it('then offers to switch the declared rule off, through the door, and the list shows it off', async () => {
    const dialog = await openClone(KEY);
    await waitFor(() =>
      expect(within(dialog).getByTestId('sharing-rule-clone-criteria')).toHaveTextContent('Northwind'),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.sharingRule.clone.confirm', ADMIN_LOCALE) }));
    fireEvent.click(await screen.findByTestId('sharing-rule-clone-disable-source'));
    await screen.findByTestId('sharing-rule-clone-source-off');
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.url).toBe(`/api/v1/security/_activation/sharing_rule/${KEY}`);
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ enabled: false });
    expect(screen.getByTestId(`catalog-active-${KEY}`)).toHaveAttribute('aria-checked', 'false');
  });

  it('a rule switched off (no projection served) continues in the New form, pre-filled', async () => {
    ledgerRows = [{ metadata_type: 'sharing_rule', name: INQ, active: false }];
    const dialog = await openClone(INQ);
    await within(dialog).findByTestId('sharing-rule-clone-no-criteria');
    fireEvent.click(within(dialog).getByRole('button', { name: t('engine.sharingRule.clone.continueInForm', ADMIN_LOCALE) }));
    const where = await screen.findByTestId('where');
    const url = new URL(`http://x${where.textContent}`);
    expect(url.pathname).toBe('/apps/setup/sys_sharing_rule/new');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: `${INQ}_copy`,
      label: tFormat('engine.sharingRule.clone.copyLabel', ADMIN_LOCALE, { label: String(DECLARED[0].label) }),
      description: String(DECLARED[0].description),
      object_name: 'showcase_inquiry',
      recipient_type: 'unit_and_subordinates',
      recipient_id: 'bu_field_ops',
      access_level: 'read',
    });
    expect(created).toEqual([]);
  });
});

/** The data door's refusal of a ledger read to a principal without read on it. */
const LEDGER_READ_REFUSAL = "Permission denied: you cannot read 'sys_metadata_activation'.";

describe('a principal the ledger read refuses (objectui#13091)', () => {
  it("reads a plain-language state per rule, with the server's sentence for why — never a bare '?'", async () => {
    ledgerRefusal = { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: LEDGER_READ_REFUSAL } } };
    mount();
    const cell = await screen.findByTestId(`catalog-active-unreadable-${KEY}`);
    expect(cell).toHaveTextContent(t('engine.catalog.active.notVisible', ADMIN_LOCALE));
    expect(cell.getAttribute('title')).toContain(LEDGER_READ_REFUSAL);
    expect(cell.getAttribute('title')).toContain(t('engine.catalog.active.unknown', ADMIN_LOCALE));
    expect(screen.getByTestId(`catalog-active-unreadable-${INQ}`)).toHaveTextContent(
      t('engine.catalog.active.notVisible', ADMIN_LOCALE),
    );
    expect(screen.queryByText('?')).toBeNull();
    // No switch is drawn on a state nobody read.
    expect(screen.queryByTestId(`catalog-active-${KEY}`)).toBeNull();
  });

  it('a refusal without a sentence still reads in words, with the status for why', async () => {
    ledgerRefusal = { status: 403, body: {} };
    mount();
    const cell = await screen.findByTestId(`catalog-active-unreadable-${KEY}`);
    expect(cell).toHaveTextContent(t('engine.catalog.active.notVisible', ADMIN_LOCALE));
    expect(cell.getAttribute('title')).toContain('HTTP 403');
  });

  it('control: a readable ledger draws the switch, and no unreadable state', async () => {
    mount();
    await screen.findByTestId(`catalog-active-${KEY}`);
    expect(screen.queryByTestId(`catalog-active-unreadable-${KEY}`)).toBeNull();
  });
});

describe("the row's controls stay in reach on a narrow screen (objectui#13091)", () => {
  /** The cell (`td` / `th`) holding `el`. */
  const cellOf = (el: Element) => el.closest('td, th') as HTMLElement;

  it('Clone and the Active switch sit in cells pinned to the right edge of the overflow box', async () => {
    mount();
    const clone = cellOf(await screen.findByTestId(`catalog-clone-${KEY}`));
    const active = cellOf(await screen.findByTestId(`catalog-active-${KEY}`));
    const scroller = screen.getByTestId('metadata-list-scroller');
    expect(scroller).toContainElement(clone);
    // Clone holds the right edge at its fixed width; Active sits just left of it.
    expect(clone).toHaveClass('sticky', 'right-0', 'w-28');
    expect(active).toHaveClass('sticky', 'right-28');
    // The pinned pair is the row's trailing pair, Active then Clone.
    const row = clone.parentElement!;
    expect(row.lastElementChild).toBe(clone);
    expect(clone.previousElementSibling).toBe(active);
    // Their header cells are pinned the same way, so the column heads stay with them.
    const headers = Array.from(scroller.querySelectorAll('thead th'));
    expect(headers[headers.length - 1]).toHaveClass('sticky', 'right-0');
    expect(headers[headers.length - 2]).toHaveClass('sticky', 'right-28');
    // Separated borders: in a collapsed-border table Chrome lets the text
    // scrolling beneath a sticky cell show through its edge (measured live).
    expect(scroller.querySelector('table')).toHaveClass('border-separate', 'border-spacing-0');
  });

  it('the first pinned cell draws the seam shadow, and the box leaves the shadow to it', async () => {
    mount();
    const active = cellOf(await screen.findByTestId(`catalog-active-${KEY}`));
    const clone = cellOf(screen.getByTestId(`catalog-clone-${KEY}`));
    expect(active.className).toContain('group-data-[overflow-right=true]/hscroll:before:opacity-100');
    expect(clone.className).not.toContain('group-data-[overflow-right=true]/hscroll:before:opacity-100');
    // `seam="pinned"`: no edge overlay competes with the seam.
    expect(screen.getByTestId('metadata-list-scroller')).toHaveClass('group/hscroll');
    expect(screen.queryByTestId('horizontal-overflow-shadow')).toBeNull();
  });

  it('without Clone, the Active column alone holds the right edge and draws the seam', async () => {
    canCreateRule = false;
    mount();
    const active = cellOf(await screen.findByTestId(`catalog-active-${KEY}`));
    expect(active).toHaveClass('sticky', 'right-0');
    expect(active).not.toHaveClass('right-28');
    expect(active.className).toContain('group-data-[overflow-right=true]/hscroll:before:opacity-100');
    expect(active.parentElement!.lastElementChild).toBe(active);
  });
});
