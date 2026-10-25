// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-only gates for the permission matrix.
 *
 * The Studio Access pillar embeds `PermissionMatrixEditPage` for the current
 * package; when that package is READ-ONLY the pillar passes `readOnly`, and
 * the matrix must actually lock — before this gate existed the top bar showed
 * the package "Read-only" chip while the matrix below it stayed editable with
 * a live Save button.
 *
 * Two independent gates share one `writable` switch inside the editor:
 *   • host gate — `readOnly` prop (read-only package in Studio), and
 *   • type gate — the metadata type offers NO runtime write channel, i.e.
 *     `allowEnvironmentOverlay` AND `allowRuntimeCreate` are BOTH false.
 * Either one must disable every checkbox / bulk button / input, hide Save,
 * and show a read-only badge — worded for ITS reason, so the badge never
 * contradicts the surrounding surface.
 *
 * ## The type gate is a DISJUNCTION, and this suite used to say otherwise
 *
 * objectui#4446. Until then the switch read `allowEnvironmentOverlay` alone and this
 * header called that flag "environment-level OS_METADATA_WRITABLE". Both were
 * wrong, and in the same way — they collapsed two different doors into one:
 *
 *   • `allowEnvironmentOverlay` = may an ORG OVERLAY a code-shipped item;
 *   • `allowRuntimeCreate` = may an item be AUTHORED at runtime — which is
 *     what this editor's Save actually does under a `packageId`
 *     (`mode: 'draft'` + `packageId`, ADR-0086 P0/P2).
 *
 * The server refuses only when BOTH are false (`!isOverlayAllowed &&
 * !isRuntimeCreateAllowed`, metadata-protocol `protocol.ts`), so gating on the
 * first alone locked a surface the server accepts. `permission` is exactly that
 * shape on a stock boot — `allowEnvironmentOverlay: false` (ADR-0005 forbids per-org
 * overlay of a packaged permission set: silent privilege drift) with
 * `allowRuntimeCreate: true`, which objectstack#6483 kept open on purpose.
 *
 * And `OS_METADATA_WRITABLE` was never the type gate's reason: it does not sit
 * beside `allowEnvironmentOverlay`, it FLIPS it (`getMetaTypes` emits
 * `allowEnvironmentOverlay: base.allowEnvironmentOverlay || isEnvOverridden`). So there is no
 * reachable state in which the old badge text was the honest explanation —
 * whenever the hatch is on for a type, that type is writable and no read-only
 * badge renders at all.
 *
 * What this suite pins, therefore: the HOST gate is unchanged and still
 * dominant (the "Studio 维持包级只读" half of the objectstack#5768 ruling), and
 * the TYPE gate now trips only when the type really has no write channel — and
 * says so.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Fake metadata client (same shape as the scope suite's fixture) ──────────
const server = {
  set: {
    name: 'sales_perms',
    label: 'Sales',
    objects: {
      a_account: { allowRead: true, allowCreate: true },
    },
    fields: {},
  } as Record<string, unknown>,
  saved: [] as Array<Record<string, unknown>>,
};

function makeClient() {
  return {
    layered: async () => ({
      effective: server.set,
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
    get: async (type: string) =>
      type === 'object'
        ? { fields: [{ name: 'name', label: 'Name' }] }
        : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      return payload;
    },
  } as any;
}

// Flipped per-test to drive the TYPE-level gate. Both flags are read straight
// off the server entry, the way DirectoryPage / EmbeddedItemEditor /
// ResourceEditPage read them (objectui#4446).
let allowEnvironmentOverlay = true;
// The other half of the disjunction. `false` is the historical default of this
// suite (the key simply did not exist in the fixture, so it read `undefined`);
// the stock-boot `permission` shape sets it true with allowEnvironmentOverlay false.
let allowRuntimeCreate = false;
// One stable client per test — the editor's load effect depends on the client
// reference, so a fresh object per render would re-trigger it forever.
let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay, allowRuntimeCreate }],
  }),
}));

// The CALLER gate (objectui#7611): does this session hold `manage_metadata`?
// `true` is what the unmocked hook answers here (no permission provider, so it
// fails open), so every case above the caller-gate block reads exactly as before.
let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => canAuthor,
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';
import { t } from './i18n';

afterEach(() => {
  cleanup();
  allowEnvironmentOverlay = true;
  allowRuntimeCreate = false;
  canAuthor = true;
  server.saved = [];
});

function renderMatrix(props?: { readOnly?: boolean }) {
  clientImpl = makeClient();
  return render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId="app.a"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('PermissionMatrixEditPage — read-only package gate (host readOnly)', () => {
  it('locks the whole matrix and hides Save when readOnly is set', async () => {
    renderMatrix({ readOnly: true });
    await screen.findByText('Account');

    // Save is gone — a read-only package must not offer a live draft write.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();

    // Every object-level grant checkbox is disabled…
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeDisabled();
    }
    // …and so are the row bulk-set buttons.
    const row = screen.getByText('Account').closest('tr')!;
    for (const name of ['R', 'CRUD', 'All', 'None']) {
      expect(within(row).getByRole('button', { name })).toBeDisabled();
    }

    // Identity inputs collapse by default (objectui#2600 B1) — expand the
    // strip (summary shows the label "Sales"), then confirm they are locked
    // too in a read-only package.
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(screen.getByDisplayValue('sales_perms')).toBeDisabled();
    expect(screen.getByDisplayValue('Sales')).toBeDisabled();

    // Field-level R/W under an expanded row is equally read-only.
    fireEvent.click(screen.getByRole('button', { name: /Account/ }));
    expect(await screen.findByLabelText('a_account.name readable')).toBeDisabled();
    expect(screen.getByLabelText('a_account.name editable')).toBeDisabled();
  });

  it('shows the package read-only badge, not the environment wording', async () => {
    renderMatrix({ readOnly: true });
    await screen.findByText('Account');

    // Same wording as the Studio top-bar package chip — the screen agrees
    // with itself about WHY it is read-only.
    const badge = screen.getByText('Read-only', { exact: true });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Read-only package'));
    expect(screen.queryByText(/OS_METADATA_WRITABLE/)).toBeNull();
  });

  it('stays fully editable when readOnly is not set (regression)', async () => {
    renderMatrix();
    await screen.findByText('Account');

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByText('Read-only', { exact: true })).toBeNull();
    expect(screen.queryByText(/OS_METADATA_WRITABLE/)).toBeNull();
  });
});

describe('PermissionMatrixEditPage — type-level gate keeps its own wording', () => {
  it('no write channel at all (both flags false) hides Save and names the TYPE as the reason', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = false;
    renderMatrix();
    await screen.findByText('Account');

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeDisabled();

    // Type-gate reason, untouched by the package gate — and it names the type,
    // not a deployment env var (objectui#4446). The old wording claimed
    // "OS_METADATA_WRITABLE not enabled", which no reachable state supports:
    // that hatch FLIPS allowEnvironmentOverlay to true, so when it is on this badge
    // does not render.
    expect(screen.queryByText(/OS_METADATA_WRITABLE/)).toBeNull();
    const badge = screen.getByText(/no runtime write channel/);
    expect(badge).toBeInTheDocument();
    // The env var survives as the documented REMEDY, in the hint only.
    expect(badge).toHaveAttribute('title', expect.stringContaining('allowRuntimeCreate'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('OS_METADATA_WRITABLE'));
    // Package wording must NOT be borrowed for a type-gate lock.
    expect(screen.queryByText('Read-only', { exact: true })).toBeNull();
  });

  /**
   * ── The defect objectui#4446 was filed for ────────────────────────────────
   *
   * The stock-boot `permission` shape, measured on a live QA run
   * (objectstack#7637): the registry declares `allowEnvironmentOverlay: false` and
   * `allowRuntimeCreate: true`, and the server ACCEPTS the package-door write
   * (`PUT /api/v1/meta/permission/<n>?package=<pkg>` → 200). Pre-fix the editor
   * disabled all 207 checkboxes and hid Save anyway, then blamed
   * `OS_METADATA_WRITABLE`.
   *
   * RED-FIRST: this case fails on `origin/main` — Save is absent and every
   * control disabled.
   */
  it('stock-boot permission shape (allowRuntimeCreate only) is EDITABLE — the server accepts this write', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = true;
    renderMatrix();
    await screen.findByText('Account');

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();

    // Row bulk-set buttons are live too — `writable` drives all of them.
    const row = screen.getByText('Account').closest('tr')!;
    for (const name of ['R', 'CRUD', 'All', 'None']) {
      expect(within(row).getByRole('button', { name })).toBeEnabled();
    }

    // …and no read-only badge of EITHER wording is claiming otherwise.
    expect(screen.queryByText(/OS_METADATA_WRITABLE/)).toBeNull();
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
    expect(screen.queryByText('Read-only', { exact: true })).toBeNull();
  });

  it('MUST NOT CHANGE — the package gate still wins over allowRuntimeCreate', async () => {
    // The "Studio 维持包级只读" half of the objectstack#5768 ruling: a
    // code-defined package stays locked no matter what the type permits.
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = true;
    renderMatrix({ readOnly: true });
    await screen.findByText('Account');

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    // …and it is still the PACKAGE that is named as the reason.
    const badge = screen.getByText('Read-only', { exact: true });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Read-only package'));
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
  });

  it('MUST NOT CHANGE — an allowEnvironmentOverlay package is byte-identical to before', async () => {
    allowEnvironmentOverlay = true;
    allowRuntimeCreate = false;
    renderMatrix();
    await screen.findByText('Account');

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByText('Read-only', { exact: true })).toBeNull();
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
  });
});

/**
 * objectui#13011 — the badge names the gate that actually closed. A caller who
 * is not walled and lacks `manage_metadata`, on a type whose tier is open (the
 * stock-boot `permission` shape), used to fall through to the type-tier
 * sentence, "this metadata type has no runtime write channel", beside a
 * banner giving the capability reason. The type has a channel; the caller
 * may not use it. The type-tier sentence stays for a type that has none.
 */
describe('PermissionMatrixEditPage — the caller gate names the capability, not the type', () => {
  const CAPABILITY_BADGE = t('perm.readOnly.capability', 'en-US');

  it('an open type and a caller without manage_metadata: the badge gives the capability reason', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = true;
    canAuthor = false;
    renderMatrix();
    await screen.findByText('Account');

    expect(screen.getByLabelText('a_account Read')).toBeDisabled();
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
    const badge = screen.getByText(CAPABILITY_BADGE);
    expect(badge).toHaveTextContent(/manage_metadata/);
    // Badge and banner give one reason: the hint is the banner's sentence.
    expect(badge).toHaveAttribute('title', t('engine.edit.capabilityReadOnly', 'en-US'));
    expect(screen.getByTestId('perm-capability-readonly')).toHaveTextContent(/manage_metadata/);
  });

  it('CONTROL: a closed type keeps the type-tier sentence for the same caller', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = false;
    canAuthor = false;
    renderMatrix();
    await screen.findByText('Account');

    expect(screen.getByText(/no runtime write channel/)).toBeInTheDocument();
    expect(screen.queryByText(CAPABILITY_BADGE)).toBeNull();
  });

  it('CONTROL: the host readOnly still names the package for the same caller', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = true;
    canAuthor = false;
    renderMatrix({ readOnly: true });
    await screen.findByText('Account');

    const badge = screen.getByText('Read-only', { exact: true });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Read-only package'));
    expect(screen.queryByText(CAPABILITY_BADGE)).toBeNull();
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
  });

  it('CONTROL: a holder on the same open type gets no read-only badge at all', async () => {
    allowEnvironmentOverlay = false;
    allowRuntimeCreate = true;
    renderMatrix();
    await screen.findByText('Account');

    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(screen.queryByText(CAPABILITY_BADGE)).toBeNull();
    expect(screen.queryByText(/no runtime write channel/)).toBeNull();
  });
});
