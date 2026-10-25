// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ARTIFACT tier of the permission matrix's write gate — objectui#4518.
 *
 * ## The two tiers
 *
 * The server's metadata write gate is TWO tiers, and objectui#4446 (PR #4519)
 * modelled only the first. From metadata-protocol `protocol.ts`:
 *
 *   1. TYPE tier — refuse when BOTH flags are false:
 *      `if (!overlayAllowed && !runtimeCreateAllowed) { … }`
 *   2. ARTIFACT tier — for an item a code package SHIPS, `allowRuntimeCreate`
 *      is not enough:
 *      `if (this.environmentId !== undefined) {`
 *      `    const artifactBacked = this.isArtifactBacked(request.type, request.name);`
 *      `    if (artifactBacked && !overlayAllowed) { … status 403 not_overridable }`
 *      `}`
 *
 * The method's own doc states the split: "overlaying a packaged item" (requires
 * `allowEnvironmentOverlay`) vs "authoring a DB-only item" (requires only
 * `allowRuntimeCreate`). `permission` sits exactly in the gap — `false` /
 * `true` — so after #4446 opened the type tier, an environment-scope edit of a
 * CODE-DECLARED set rendered 207 live checkboxes and a Save button that failed
 * at the end with a 403 instead of a surface that explains itself up front.
 *
 * `ResourceEditPage:1332` has modelled both tiers all along, `sys_metadata`
 * sentinel included. This suite pins that same model here.
 *
 * ## The scoping condition, and why it is `packageId`
 *
 * The server's artifact tier is `environmentId !== undefined`-scoped, and that
 * key is NOT visible to a client: it is a server-side row-scoping property of
 * the kernel, the console never passes one to `useMetadataClient`, and
 * `MetadataClient` bakes it into a private base URL. Reading it would mean a
 * new `GET /discovery` probe, which the #4518 ruling forbids.
 *
 * The condition used instead is the one the filing names and this component
 * already holds: `packageId`. Under a `packageId` the write is a package-door
 * DRAFT (ADR-0086 P0/P2) and the measured behaviour is 200 — that is #4446's
 * own headline case (a code-declared set on the single-kernel showcase,
 * `PUT /api/v1/meta/permission/<n>?package=<pkg>` → 200), which this must NOT
 * re-lock, and the cases below pin that it does not. The artifact case under a
 * `packageId` is covered by the host `readOnly` prop the Studio Access pillar
 * passes for a code-defined package, which dominates every other gate anyway.
 *
 * ## Red-first
 *
 * The first case fails on `origin/main` (172c73e6e, PR #4519 merged): Save is
 * offered and every checkbox is live for a set the server refuses.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Fake metadata client ────────────────────────────────────────────────────
//
// `codeLayer` is the whole point of this suite: it is what the server's
// `isArtifactBacked` answers from, mirrored into the layered envelope's `code`
// slot the editor already fetches.
//
//   • `null`                              → runtime-created (DB-only) set
//   • `{ _packageId: 'sys_metadata' }`    → published ORG set (the sentinel)
//   • `{ _packageId: 'com.example.…' }`   → shipped by a code package
let codeLayer: Record<string, unknown> | null = null;
// The envelope's ADR-0010 `provenance` (objectui#4526). `undefined` = the key
// absent, which is what every case above the #4526 block serves: an older
// server, or an unstamped item — "no opinion".
let provenance: 'package' | 'org' | 'env-forced' | undefined;

const SET = {
  name: 'showcase_contributor',
  label: 'Contributor',
  objects: { a_account: { allowRead: true, allowCreate: true } },
  fields: {},
} as Record<string, unknown>;

function makeClient() {
  return {
    layered: async () => ({
      effective: SET,
      code: codeLayer,
      overlay: null,
      overlayScope: null,
      ...(provenance !== undefined ? { provenance } : {}),
    }),
    getDraft: async () => null,
    list: async (type: string) =>
      type === 'object' ? [{ item: { name: 'a_account', label: 'Account' } }] : [],
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

// The stock-boot `permission` shape (objectstack#6483) unless a case says
// otherwise: no per-org overlay, but runtime authoring is open.
let typeFlags: { allowEnvironmentOverlay?: boolean; allowRuntimeCreate?: boolean } = {
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
};
let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', ...typeFlags }],
  }),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(() => {
  cleanup();
  codeLayer = null;
  provenance = undefined;
  typeFlags = { allowEnvironmentOverlay: false, allowRuntimeCreate: true };
});

async function renderMatrix(props?: { packageId?: string; readOnly?: boolean }) {
  clientImpl = makeClient();
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage
        type="permission"
        name="showcase_contributor"
        {...props}
      />
    </MemoryRouter>,
  );
  await screen.findByText('Account');
}

/** The identity-strip read-only badge, or null when the surface is writable. */
function lockBadge(): HTMLElement | null {
  return (
    screen.queryByText(/^Read-only \(/) ??
    screen.queryByText('Read-only', { exact: true })
  );
}

const ARTIFACT_CAPTION = /provided by a code package/;
const TYPE_CAPTION = /no runtime write channel/;

/* ────────────────────────────────────────────────────────────────────────── */

describe('PermissionMatrixEditPage — the ARTIFACT tier locks an env-scope overlay (#4518)', () => {
  /**
   * RED-FIRST. Environment scope (no `packageId`) + a set a code package ships
   * + `allowEnvironmentOverlay: false`. The server answers this write with
   * 403 `not_overridable`; pre-fix the editor offered Save anyway.
   */
  it('code-declared set at environment scope is READ-ONLY — the server refuses this write', async () => {
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    await renderMatrix();

    // No Save that would 403.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();

    // Every grant control is locked…
    expect(screen.getByLabelText('a_account Read')).toBeDisabled();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    const row = screen.getByText('Account').closest('tr')!;
    for (const n of ['R', 'CRUD', 'All', 'None']) {
      expect(within(row).getByRole('button', { name: n })).toBeDisabled();
    }
  });

  it('…and the caption names the ARTIFACT tier, not the type and not the package', async () => {
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix();

    const badge = screen.getByText(ARTIFACT_CAPTION);
    expect(badge).toBeInTheDocument();

    // NOT the type-tier wording: this type DOES have a runtime write channel —
    // a brand-new set authored here saves fine. Blaming the type would be the
    // mirror-image lie of the one #4446 removed.
    expect(screen.queryByText(TYPE_CAPTION)).toBeNull();
    // NOT the package wording either — no read-only PACKAGE is involved.
    expect(screen.queryByText('Read-only', { exact: true })).toBeNull();

    // The hint carries the server's own reason, the same place the 403 text
    // puts it. It names the env hatch only to say the hatch does not open a set
    // a package ships (ADR-0131 D6, objectui#12141): offered as a remedy here,
    // it would send the operator to a door the server keeps shut.
    expect(badge).toHaveAttribute('title', expect.stringContaining('allowEnvironmentOverlay'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('not_overridable'));
    expect(badge).toHaveAttribute(
      'title',
      expect.stringContaining('OS_METADATA_WRITABLE escape hatch does not open a set a package ships'),
    );
    // …and never in the label (objectui#4446's rule for this badge slot).
    expect(screen.queryByText(/OS_METADATA_WRITABLE/)).toBeNull();
  });

  /**
   * The header hero badge is NOT re-litigated here, and it is not a
   * contradiction: `PageShell`'s `WritabilityBadge` renders "create-only" for
   * this shape, whose tooltip already reads "Code-shipped items are locked; new
   * items can be created at runtime". That is exactly what the artifact tier
   * says, so the two renderings agree — unlike the #4036 divergence, where
   * "create-only" sat over dead checkboxes for a set that was NOT code-shipped.
   */
  it('the header hero badge stays "create-only" and never claims "writable"', async () => {
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix();

    expect(screen.getByText('create-only')).toBeInTheDocument();
    expect(screen.queryByText('writable')).toBeNull();
  });

  it('an overlay-allowed type is still writable even when code-declared', async () => {
    // `allowEnvironmentOverlay: true` IS permission to overlay a packaged item — the
    // artifact tier's own condition (`artifactBacked && !overlayAllowed`) is
    // then false and the server accepts the write.
    typeFlags = { allowEnvironmentOverlay: true, allowRuntimeCreate: false };
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });

  it('both flags false + code-declared still names the TYPE — the broader refusal', async () => {
    // The server reaches `!overlayAllowed && !runtimeCreateAllowed` FIRST, and
    // "this type accepts no runtime write at all" is the honest reason; the
    // artifact tier is only the DECIDING gate where the type tier said yes.
    typeFlags = { allowEnvironmentOverlay: false, allowRuntimeCreate: false };
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix();

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByText(TYPE_CAPTION)).toBeInTheDocument();
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
  });
});

describe('PermissionMatrixEditPage — MUST NOT CHANGE: what the artifact tier may not re-lock (#4518)', () => {
  /**
   * The binding constraint of the #4518 ruling. #4446's headline case, measured
   * on a live QA run (objectstack#7637) as `PUT /api/v1/meta/permission/<n>
   * ?package=<pkg>` → 200 on the single-kernel showcase: a code-declared set
   * under the PACKAGE door. The artifact tier must not touch it.
   */
  it('code-declared set under a packageId stays EDITABLE — measured 200 (#4446 headline)', async () => {
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix({ packageId: 'com.example.showcase' });

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    const row = screen.getByText('Account').closest('tr')!;
    for (const n of ['R', 'CRUD', 'All', 'None']) {
      expect(within(row).getByRole('button', { name: n })).toBeEnabled();
    }
    expect(lockBadge()).toBeNull();
  });

  it('runtime-created set stays EDITABLE at environment scope', async () => {
    codeLayer = null;
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });

  it('runtime-created set stays EDITABLE under a packageId', async () => {
    codeLayer = null;
    await renderMatrix({ packageId: 'com.example.showcase' });

    // objectui#11787 — the package door autosaves: no Save button; the live controls are the writability read.
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });

  /**
   * The `sys_metadata` provenance sentinel, mirrored from the server's
   * `isArtifactBacked` ("`lookupArtifactItem` only returns items whose
   * `_packageId` marks a genuine code package (the `'sys_metadata'`
   * rehydration sentinel is excluded)"). A PUBLISHED org set surfaces its
   * active version in `code` too — dropping the sentinel would lock every
   * org-authored set the moment it was published.
   */
  it('a published ORG set (sys_metadata sentinel) stays EDITABLE at environment scope', async () => {
    codeLayer = { _packageId: 'sys_metadata', name: 'showcase_contributor' };
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });

  it('a code layer with no _packageId at all is treated as artifact-backed', async () => {
    // Only the sentinel is carved out. An untagged `code` layer is a code layer:
    // the fail-safe direction for a shape neither side has seen.
    codeLayer = { name: 'showcase_contributor' };
    await renderMatrix();

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.getByText(ARTIFACT_CAPTION)).toBeInTheDocument();
  });

  it('a failed layered read does NOT invent a lock (fail-open, as the sibling does)', async () => {
    clientImpl = {
      ...makeClient(),
      layered: async () => {
        throw new Error('boom');
      },
    };
    render(
      <MemoryRouter>
        <PermissionMatrixEditPage type="permission" name="showcase_contributor" />
      </MemoryRouter>,
    );
    await screen.findByText('Account');

    // `layered?.code != null` is exactly how `ResourceEditPage:1332` fails too,
    // and it is the pre-#4518 behaviour. The save still meets the server's gate.
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });

  it('the readOnly prop still wins, and still names the PACKAGE', async () => {
    // "Studio 维持包级只读" (objectstack#5768 A2) — the host gate dominates every
    // other gate, and the badge must not borrow the artifact wording for it.
    codeLayer = { _packageId: 'com.example.showcase' };
    await renderMatrix({ packageId: 'com.example.showcase', readOnly: true });

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    const badge = screen.getByText('Read-only', { exact: true });
    expect(badge).toHaveAttribute('title', expect.stringContaining('Read-only package'));
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
    expect(screen.queryByText(TYPE_CAPTION)).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('PermissionMatrixEditPage — the artifact verdict asks ADR-0010 provenance (#4526)', () => {
  /**
   * The artifact predicate reads the SAME source `ResourceEditPage` reads for
   * its `isArtifactItem`: the layered envelope's `code` layer AND its
   * `provenance`. The `sys_metadata` sentinel alone holds only on the save
   * path — boot-time rehydration of `sys_metadata` re-registers each row under
   * its REAL package id (cloud#970), so a tenant's own set reads back with a
   * code-looking `_packageId`. Environment scope throughout (no `packageId`):
   * the door where the artifact tier decides.
   */
  it("a tenant's own set (provenance 'org') is EDITABLE at environment scope", async () => {
    codeLayer = { _packageId: 'sys_metadata', name: 'showcase_contributor' };
    provenance = 'org';
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
  });

  /**
   * RED on the sentinel-only predicate. The rehydration shape: the served
   * `code` layer carries a real package id, and only `provenance` says the
   * tenant authored it. The sentinel-only predicate called this an artifact,
   * and `permission`'s `allowEnvironmentOverlay: false` then locked the whole matrix.
   */
  it("a tenant's own set rehydrated under a REAL package id (provenance 'org') is EDITABLE", async () => {
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    provenance = 'org';
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    const row = screen.getByText('Account').closest('tr')!;
    for (const n of ['R', 'CRUD', 'All', 'None']) {
      expect(within(row).getByRole('button', { name: n })).toBeEnabled();
    }
    expect(lockBadge()).toBeNull();
    expect(screen.queryByText(ARTIFACT_CAPTION)).toBeNull();
  });

  it("a code-declared set (provenance 'package') stays READ-ONLY and names the ARTIFACT tier", async () => {
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    provenance = 'package';
    await renderMatrix();

    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByText(ARTIFACT_CAPTION)).toBeInTheDocument();
  });

  it("a code-declared set (provenance 'package') is writable only where the type allows overlay", async () => {
    typeFlags = { allowEnvironmentOverlay: true, allowRuntimeCreate: false };
    codeLayer = { _packageId: 'com.example.showcase', name: 'showcase_contributor' };
    provenance = 'package';
    await renderMatrix();

    expect(screen.getByRole('button', { name: /^Save$/ })).toBeEnabled();
    expect(screen.getByLabelText('a_account Read')).toBeEnabled();
    expect(lockBadge()).toBeNull();
  });
});
