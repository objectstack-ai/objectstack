/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:quick_actions.requiredPermissions` — the BLOCK-LEVEL gate
 * (objectui#8071 slice 4). Since objectstack#18159 the contract describes it
 * with the one record-block describe this key shares with `record:details`,
 * `record:highlights` and `record:related_list`: ALL the named capabilities
 * must be held, and when one is missing "an insufficient-permissions notice
 * takes its place". The registration publishes that describe verbatim, and the
 * last block below re-reads it off the installed spec (objectui#10224). Before
 * objectstack#18159 the contract said "Hide the whole bar unless the current
 * user holds every named permission on this object", and the registration said
 * "Hide the whole bar unless the user holds these permissions"; neither named
 * the notice the renderer draws.
 *
 * ## What this file pins, and why it was rewritten (objectui#10058)
 *
 * The key is an **ADR-0066 system capability set** — the one meaning the word
 * carries on `action`, `app`, `field` and `bulkAction` (ruling batch #192 item
 * 5 letter B). The renderer reads it through the permission context's
 * capability path and gates fail-closed: an unheld or unrecognised capability
 * puts a `role="status"` insufficient-permissions notice in place of the whole
 * bar, so no action is drawn.
 *
 * It used to read `perms.can(objectName, name)`, whose second argument is the
 * closed object-action enum. Under the stock `/me/permissions` provider a name
 * outside the eight mapped verbs falls through that provider's `?? 'allowRead'`
 * tail to the object's read bit — so a capability nobody holds passed for every
 * reader of the object, silently. These pins were rewritten with it, because
 * the previous ones mocked `usePermissions` down to a `can` stub and therefore
 * pinned the defect: they passed on a gate that does not gate.
 *
 * ⭐ Every gate pin below mounts a REAL stock provider and reads its real
 * verdicts. A mocked `usePermissions` cannot discriminate the two reading
 * paths — it IS whichever path the mock chooses to implement. The one gate pin
 * that mounts no provider does so on purpose: no provider at all is the case
 * it pins.
 *
 * Not to be confused with an `ActionDef`'s OWN `requiredPermissions` — a
 * per-action field the `gated` fixture in
 * `record-quick-actions.declared-action-ids-7182.test.tsx` exercises through
 * `ActionEngine.getActionsForLocation`'s per-action filter.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { MetadataCtx, RecordContextProvider } from '@object-ui/react';
import type { MetadataContextValue } from '@object-ui/react';
import { MePermissionsProvider, PermissionProvider, usePermissions, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordQuickActionsProps } from '@objectstack/spec/ui';
import { RecordQuickActionsRenderer } from '../record-quick-actions';
// Registers `record:quick_actions` and its three sibling record blocks, whose
// published `inputs` the last describe block reads.
import '../../index';

/**
 * Records what the OBJECT-PERMISSION path was asked, without replacing it.
 *
 * ⭐ This is a wrapper, not a stub: `usePermissions` still returns the real
 * stock provider's verdicts and every call is delegated. A mock that ANSWERS
 * cannot discriminate the two reading paths — it IS whichever path the mock
 * chose to implement, which is exactly how the previous version of this file
 * came to pin the defect as correct behaviour.
 */
const canSpy = vi.fn();
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return {
        ...real,
        can: (object: string, action: any) => { canSpy(object, action); return real.can(object, action); },
        cannot: (object: string, action: any) => { canSpy(object, action); return real.cannot(object, action); },
      };
    },
  };
});

/** Declared on the object, at the location this bar renders by default. */
const APPROVE = {
  name: 'approve',
  label: 'Approve',
  type: 'script',
  locations: ['record_header'],
};

const OBJECT_META = { name: 'crm_account', actions: [APPROVE] };

const getItem = vi.fn(async (type: string, name: string) =>
  type === 'object' && name === 'crm_account' ? OBJECT_META : null,
);

/**
 * Held at MODULE level on purpose: `getItem` is an effect dependency of
 * `useMetadataItem`, so a value rebuilt per render spins that hook forever
 * (the same reason `recordQuickActionsInputs.actionNamesFallback.test.tsx`
 * does this).
 */
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_META] as any,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: getItem as unknown as MetadataContextValue['getItem'],
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

/**
 * A `/me/permissions` payload.
 *
 * ⭐ The object bits are the LIT CONTROL that runs through this whole file:
 * `allowRead` is TRUE while the other three are explicitly FALSE. That is what
 * makes the discriminators below able to fail — a provider that answered every
 * name off one bit, or a gate still reading the object action path, lands on a
 * different verdict for at least one of them.
 */
function me(systemPermissions: string[] | undefined, objectBits?: Record<string, unknown>): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 't1',
    roles: [],
    permissionSets: [],
    ...(systemPermissions === undefined ? {} : { systemPermissions }),
    objects: {
      crm_account: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false, ...objectBits },
    },
    fields: {},
  } as MePermissionsResponse;
}

function bar(schema: Record<string, unknown>, objectName = 'crm_account') {
  return (
    <MetadataCtx.Provider value={METADATA}>
      <RecordContextProvider objectName={objectName} recordId="rec-1" data={{ id: 'rec-1' }}>
        <RecordQuickActionsRenderer schema={schema as any} />
      </RecordContextProvider>
    </MetadataCtx.Provider>
  );
}

/** `actionNames` resolves through the object's metadata, so it needs an objectName. */
const BY_NAME = { actionNames: ['approve'] };
/** Inline defs, so the bar can be mounted with NO objectName at all. */
const INLINE = { actions: [APPROVE] };

const shown = () => screen.findByRole('button', { name: 'Approve' });
const refused = () => screen.findByText(/insufficient permissions to view quick actions/i);
const noButton = () => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
const noRefusal = () => expect(screen.queryByText(/insufficient permissions/i)).not.toBeInTheDocument();

beforeEach(() => {
  getItem.mockClear();
  canSpy.mockClear();
});

describe('record:quick_actions.requiredPermissions — capability gate on MePermissionsProvider (objectui#10058)', () => {
  it('puts the notice in place of the WHOLE bar when the declared capability is not held (REPORTED-empty capability set)', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('renders once the declared capability IS held', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });

  it('an UNKNOWN capability name gets the notice, not the bar — unrecognised is refused, not waved through', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bar({ ...BY_NAME, requiredPermissions: ['not.a.real.capability'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('an EMPTY array is no gate at all — the bar renders on an empty capability set', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bar({ ...BY_NAME, requiredPermissions: [] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('CONTROL: an ABSENT key is no gate at all', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bar({ ...BY_NAME })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('EVERY declared capability must be held — a PARTIAL grant still gates the bar', async () => {
    // A verdict driven by `required[0]` alone (or by "any", not "every") would
    // pass this — reading the whole array is the member shape this pin exists
    // to discriminate.
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage', 'crm.export'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('granting ALL declared capabilities renders the bar — the positive control for the partial-grant case', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage', 'crm.export'])}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage', 'crm.export'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('gates even with NO objectName in the record context — a system capability is not object-scoped', async () => {
    // The object-scoped read skipped the gate outright when `objectName` was
    // empty, so a declared gate on a bar outside a record context did nothing.
    render(<MePermissionsProvider initialPermissions={me([])}>{bar({ ...INLINE, requiredPermissions: ['crm.manage'] }, '')}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });
});

describe('the reading path is the capability set, NOT `perms.can()` (objectui#10058)', () => {
  it('DISCRIMINATOR ①: holding `allowRead` on the object no longer opens the gate', async () => {
    // `crm.manage` is not one of the provider's eight mapped verbs, so the
    // object-action read resolved it to `allowRead` — TRUE here — and drew the
    // bar. The capability read refuses it: nothing reported holds it.
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('DISCRIMINATOR ②: holding the capability renders the bar even with `allowRead: false`', async () => {
    // The mirror image, so neither pin can pass by accident on a gate that is
    // simply always-closed or always-open: the two differ in BOTH inputs and
    // land on OPPOSITE verdicts.
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'], { allowRead: false })}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });

  it('DISCRIMINATOR ③: an enum member is read as a CAPABILITY too — `manage` is gated, not resolved to the read bit', async () => {
    // `manage`, `admin`, `share`, `configure` and `execute` are members of the
    // closed object-action enum AND absent from the stock provider's map, so
    // the old read sent all five to `allowRead`. On this key they are ordinary
    // capability names with no special standing.
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bar({ ...BY_NAME, requiredPermissions: ['manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  // DISCRIMINATOR ④ (objectui#10224): the published describe says in as many
  // words that `read` and `update` here are ordinary capability names, not the
  // object's read or edit permission. They are the stock provider's MAPPED
  // verbs, a different leg from ③'s unmapped `manage`: the object-action read
  // answered each off its own bit, TRUE in its row, and would have drawn the bar.
  it('DISCRIMINATOR ④a: `read` is a capability name — `allowRead` on the object does not open the gate', async () => {
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bar({ ...BY_NAME, requiredPermissions: ['read'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('DISCRIMINATOR ④b: `update` is a capability name — `allowEdit` on the object does not open the gate', async () => {
    render(<MePermissionsProvider initialPermissions={me([], { allowEdit: true })}>{bar({ ...BY_NAME, requiredPermissions: ['update'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noButton();
  });

  it('DETECTOR: the renderer never asks the OBJECT-permission path about a capability name', async () => {
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage', 'manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    // Both names answer TRUE on that path (they fall through to `allowRead`),
    // so a gate that still consulted it would have drawn the bar — and these
    // two assertions name WHY it did not.
    expect(canSpy).not.toHaveBeenCalledWith(expect.anything(), 'crm.manage');
    expect(canSpy).not.toHaveBeenCalledWith(expect.anything(), 'manage');
  });
});

describe('role-based PermissionProvider — capabilities are UNREPORTED here (objectui#10058)', () => {
  /**
   * ⚠️ This provider never fetches `/me/permissions`, so it reports
   * `systemPermissions: undefined` — "no answer", which is NOT the same as a
   * genuinely empty grant (objectui#4656). `hasCapabilities` is fail-open on
   * it by that ruled doctrine, shared with every other capability gate in the
   * tree, and this card does not move it: the console mounts
   * `MePermissionsProvider`, which wires the real reported set.
   *
   * ⭐ What DID move here is that the verdict no longer depends on whether the
   * object happens to carry a permission config. Before this fix the same
   * declared name was refused for everyone when it did and allowed for
   * everyone when it did not — two different answers to one declaration,
   * neither of them about capabilities.
   */
  const WITH_CONFIG = [{ object: 'crm_account', roles: {} }] as any;

  it('renders WITH an object permission config present', async () => {
    render(<PermissionProvider roles={[]} permissions={WITH_CONFIG} userRoles={['viewer']}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</PermissionProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });

  it('renders WITHOUT an object permission config — the same verdict, which is the point', async () => {
    render(<PermissionProvider roles={[]} permissions={[]} userRoles={['viewer']}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</PermissionProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });
});

describe('a client that cannot resolve capabilities fails OPEN — the describe\'s last clause (objectui#10224)', () => {
  /**
   * The published describe names two such clients: "no permission provider,
   * or one that does not report `systemPermissions`". The role-based provider
   * above is one of the second kind; these two rows are the other two shapes
   * a real page meets. The lit control is the first block's opening row: the
   * SAME stock provider reporting an EMPTY set gates the same declaration, so
   * the open verdict here is driven by "unreported", not by a gate that never
   * closes.
   */
  it('renders with NO permission provider mounted at all', async () => {
    render(bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] }));
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });

  it('renders under the stock provider when the backend does not report `systemPermissions`', async () => {
    render(<MePermissionsProvider initialPermissions={me(undefined)}>{bar({ ...BY_NAME, requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });
});

describe('the published description is the contract\'s shared record-block describe, verbatim (objectui#10224)', () => {
  /**
   * The registration's `inputs` are the published authoring surface:
   * `gen-manifest.ts` serializes them into `sdui.manifest.json`, descriptions
   * included. The generated JSX authoring types take only each input's name
   * and value type (`generateDts` reads no `description`), so the manifest and
   * the runtime registry are where this text is published. The describe is
   * the text of record, read off the
   * INSTALLED spec every run rather than restated, so a spec that rewords it
   * turns this row red instead of leaving the manifest to drift. Every clause
   * of that text is a row above: ALL capabilities required (the partial-grant
   * pair), capability names rather than object actions (④), the notice in
   * place of the bar, and fail-open when capabilities are unreported.
   */
  const shapeOf = () =>
    (RecordQuickActionsProps.shape as Record<string, { description?: string; def?: { innerType?: { description?: string } } }>)
      .requiredPermissions;
  const contractText = () => shapeOf()?.description ?? shapeOf()?.def?.innerType?.description;
  const publishedText = (type: string) =>
    ComponentRegistry.getConfig(type)?.inputs?.find((i) => i.name === 'requiredPermissions')?.description;

  it('`record:quick_actions` publishes the installed describe text, verbatim', () => {
    // Non-vacuity: an undefined describe would compare equal to a missing one.
    expect(contractText() ?? '', 'the contract carries no describe to publish').not.toBe('');
    expect(publishedText('record:quick_actions')).toBe(contractText());
  });

  it('the text is the one the three sibling record blocks publish — one describe, four blocks', () => {
    for (const type of ['record:details', 'record:highlights', 'record:related_list']) {
      expect(publishedText(type), type).toBe(publishedText('record:quick_actions'));
    }
  });
});

describe('CONTROL — `can()` answers exactly what it answered before this card (objectui#10058)', () => {
  /**
   * The ruling moves this ONE call site and no other caller: `can()`'s own
   * semantics are untouched. These two pins are the whole truth table both
   * stock providers produced BEFORE the fix, transcribed verbatim from the
   * reproduction probe, so any drift in `can()` shows up here rather than in a
   * renderer somewhere.
   *
   * ⚠️ Several of these verdicts are the defect itself (`crm.manage` → `true`
   * off `allowRead`). They are pinned as UNCHANGED on purpose — the fix is
   * that the quick-actions gate stopped ASKING this question, not that the
   * answer moved.
   */
  const NAMES = ['crm.manage', 'manage_users', 'read', 'create', 'update', 'delete', 'execute', 'manage', 'configure', 'share', 'export', 'import', 'admin'];

  function Table({ object }: { object: string }) {
    const { can } = usePermissions();
    return <span data-testid="t">{JSON.stringify(Object.fromEntries(NAMES.map((n) => [n, can(object, n as any)])))}</span>;
  }
  const read = () => JSON.parse(screen.getByTestId('t').textContent!);
  const all = (v: boolean) => Object.fromEntries(NAMES.map((n) => [n, v]));

  it('MePermissionsProvider: unmapped names still resolve to the object read bit, mapped verbs still to their own', () => {
    render(<MePermissionsProvider initialPermissions={me([])}><Table object="crm_account" /></MePermissionsProvider>);
    expect(read()).toEqual({
      'crm.manage': true, manage_users: true, read: true,
      // The lit control: these four are the provider's own mapped verbs and
      // answer off their own FALSE bits, which is what proves the fallback
      // tail above them is live rather than an absence the probe invented.
      create: false, update: false, delete: false, import: false,
      execute: true, manage: true, configure: true, share: true, export: true, admin: true,
    });
  });

  it('role-based PermissionProvider: refused for everyone with a config, allowed for everyone without', () => {
    render(<PermissionProvider roles={[]} permissions={[{ object: 'crm_account', roles: {} } as any]} userRoles={['viewer']}><Table object="crm_account" /></PermissionProvider>);
    expect(read()).toEqual(all(false));
    render(<PermissionProvider roles={[]} permissions={[]} userRoles={['viewer']}><Table object="crm_account" /></PermissionProvider>);
    expect(JSON.parse(screen.getAllByTestId('t')[1].textContent!)).toEqual(all(true));
  });
});
