/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `requiredPermissions` on `record:details`, `record:highlights` and
 * `record:related_list` — the BLOCK-LEVEL gate, on all three sibling blocks at
 * once (objectui#10155).
 *
 * ## What this file pins
 *
 * The key is an **ADR-0066 system capability set** — the one meaning the word
 * carries on `action`, `app`, `field` and `bulkAction` — read through the
 * permission context's capability path and gating **fail-closed**: an unheld
 * or unrecognised capability withholds the block's content, and an
 * insufficient-permissions notice (`role="status"`) renders in its place — the
 * block is not hidden (wording corrected by objectui#10224). objectui#10058
 * settled the capability read for `record:quick_actions`; these three carried
 * the identical call and were untouched by it.
 *
 * All three used to read `perms.can(objectName, name)`, whose second argument
 * is the closed object-action enum. Under the stock `/me/permissions` provider
 * a name outside the eight mapped verbs falls through that provider's
 * `?? 'allowRead'` tail to the object's read bit — so a capability nobody
 * holds passed for every reader of the object, silently.
 *
 * ⭐ Every pin below mounts a REAL stock provider and reads its real verdicts.
 * A mocked `usePermissions` cannot discriminate the two reading paths — it IS
 * whichever path the mock chooses to implement, which is how this family's
 * earlier pins came to pass on a gate that does not gate.
 *
 * ⛔ Not to be confused with an `ActionDef`'s OWN `requiredPermissions`, the
 * per-action field `ActionEngine.getActionsForLocation` filters on, nor with
 * `useCapabilityGate`'s per-action gate in `@object-ui/react`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import {
  MePermissionsProvider,
  PermissionProvider,
  usePermissions,
  type MePermissionsResponse,
} from '@object-ui/permissions';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';
import { RecordRelatedListRenderer } from '../record-related-list';

/**
 * Records what the OBJECT-PERMISSION path was asked, without replacing it.
 *
 * ⭐ A wrapper, not a stub: `usePermissions` still returns the real stock
 * provider's verdicts and every call is delegated. A mock that ANSWERS cannot
 * discriminate the two reading paths — it IS whichever path the mock chose to
 * implement.
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

/* The heavy children each block draws when it is ALLOWED — stubbed to a marker
 * so the verdict, not the body, is what these pins read. */
vi.mock('../../DetailView', () => ({
  DetailView: () => <div data-testid="detail-view" />,
}));
vi.mock('../../HeaderHighlight', () => ({
  HeaderHighlight: () => <div data-testid="header-highlight" />,
}));
vi.mock('../../RelatedList', () => ({
  RelatedList: () => <div data-testid="related-list" />,
}));

const ds = { find: vi.fn(async () => []) };

/**
 * A `/me/permissions` payload.
 *
 * ⭐ The object bits are the LIT CONTROL running through this whole file:
 * `allowRead` is TRUE while the other three are explicitly FALSE. That is what
 * lets the discriminators below fail — a gate still reading the object-action
 * path lands on a different verdict for at least one of them.
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
      // Both objects carry the same bits: `record:related_list` renders the
      // CHILD object's rows and asks its automatic read gate about THAT name,
      // so a parent-only payload would refuse every related-list pin here for
      // a reason that has nothing to do with this card.
      crm_account: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false, ...objectBits },
      crm_contact: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false, ...objectBits },
    },
    fields: {},
  } as MePermissionsResponse;
}

/** Each sibling block: how to mount it, what it draws when allowed, how it refuses. */
interface BlockCase {
  key: string;
  /** `data-testid` of the stubbed child the block draws when the gate is open. */
  shown: string;
  /** The refusal node this block emits when the gate is closed. */
  refusal: RegExp;
  node: (schema: Record<string, unknown>) => React.ReactElement;
  /** The minimum schema this block needs before `requiredPermissions` matters. */
  base: Record<string, unknown>;
}

const BLOCKS: BlockCase[] = [
  {
    key: 'record:details',
    shown: 'detail-view',
    refusal: /insufficient permissions to view details/i,
    node: (schema: Record<string, unknown>) => <RecordDetailsRenderer schema={schema as any} />,
    base: { fields: ['name'] },
  },
  {
    key: 'record:highlights',
    shown: 'header-highlight',
    refusal: /insufficient permissions to view highlights/i,
    node: (schema: Record<string, unknown>) => <RecordHighlightsRenderer schema={schema as any} />,
    base: { fields: ['name'] },
  },
  {
    key: 'record:related_list',
    shown: 'related-list',
    refusal: /insufficient permissions to view related list/i,
    node: (schema: Record<string, unknown>) => <RecordRelatedListRenderer schema={schema as any} />,
    base: { objectName: 'crm_contact', relationshipField: 'account' },
  },
];

function bound(block: BlockCase, schema: Record<string, unknown>, objectName = 'crm_account') {
  return (
    <RecordContextProvider objectName={objectName} recordId="rec-1" data={{ id: 'rec-1' }} dataSource={ds as any}>
      {block.node({ ...block.base, ...schema })}
    </RecordContextProvider>
  );
}

beforeEach(() => {
  canSpy.mockClear();
  cleanup();
});

// ⛔ `$key` must not be followed by `.` — vitest reads `$key.requiredPermissions`
// as a property PATH and interpolates `undefined`, so every failure in this suite
// would name no block at all.
describe.each(BLOCKS)('$key — the `requiredPermissions` capability gate on MePermissionsProvider (objectui#10155)', (block) => {
  const shown = () => screen.findByTestId(block.shown);
  const refused = () => screen.findByText(block.refusal);
  const noBody = () => expect(screen.queryByTestId(block.shown)).not.toBeInTheDocument();
  const noRefusal = () => expect(screen.queryByText(block.refusal)).not.toBeInTheDocument();

  it('puts the notice in place of the WHOLE block when the declared capability is not held (REPORTED-empty capability set)', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bound(block, { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noBody();
  });

  it('renders once the declared capability IS held', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bound(block, { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
    noRefusal();
  });

  it('an UNKNOWN capability name gets the notice, not the block — unrecognised is refused, not waved through', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bound(block, { requiredPermissions: ['not.a.real.capability'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noBody();
  });

  it('an EMPTY array is no gate at all — the block renders on an empty capability set', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bound(block, { requiredPermissions: [] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('CONTROL: an ABSENT key is no gate at all', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bound(block, {})}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('EVERY declared capability must be held — a PARTIAL grant still gates the block', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bound(block, { requiredPermissions: ['crm.manage', 'crm.export'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noBody();
  });

  it('granting ALL declared capabilities renders — the positive control for the partial-grant case', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage', 'crm.export'])}>{bound(block, { requiredPermissions: ['crm.manage', 'crm.export'] })}</MePermissionsProvider>);
    expect(await shown()).toBeInTheDocument();
  });

  it('DISCRIMINATOR ①: holding `allowRead` on the object no longer opens the gate', async () => {
    // `crm.manage` is not one of the provider's eight mapped verbs, so the
    // object-action read resolved it to `allowRead` — TRUE here — and drew the
    // block. The capability read refuses it: nothing reported holds it.
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bound(block, { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noBody();
  });

  it('DISCRIMINATOR ③: an enum member is read as a CAPABILITY too — `manage` is gated, not resolved to the read bit', async () => {
    // `manage`, `admin`, `share`, `configure` and `execute` are members of the
    // closed object-action enum AND absent from the stock provider's map, so
    // the old read sent all five to `allowRead`. On this key they are ordinary
    // capability names with no special standing.
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bound(block, { requiredPermissions: ['manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    noBody();
  });

  it('DETECTOR: the renderer never asks the OBJECT-permission path about a capability name', async () => {
    render(<MePermissionsProvider initialPermissions={me([], { allowRead: true })}>{bound(block, { requiredPermissions: ['crm.manage', 'manage'] })}</MePermissionsProvider>);
    expect(await refused()).toBeInTheDocument();
    // Both names answer TRUE on that path (they fall through to `allowRead`),
    // so a gate that still consulted it would have drawn the block — and these
    // two assertions name WHY it did not. The spy's own wiring is proved by
    // the `record:related_list` object-read pin below, which asserts it FIRES.
    expect(canSpy).not.toHaveBeenCalledWith(expect.anything(), 'crm.manage');
    expect(canSpy).not.toHaveBeenCalledWith(expect.anything(), 'manage');
  });
});

describe.each(BLOCKS)('$key — role-based PermissionProvider, where capabilities are UNREPORTED (objectui#10155)', (block) => {
  /**
   * ⚠️ This provider never fetches `/me/permissions`, so it reports
   * `systemPermissions: undefined` — "no answer", which is NOT a genuinely
   * empty grant (objectui#4656). `hasCapabilities` is fail-open on it by that
   * ruled doctrine, shared with every other capability gate in the tree, and
   * this card does not move it.
   *
   * ⭐ What DID move is that the verdict no longer depends on whether the
   * object happens to carry a permission config. Before the fix the same
   * declared name was refused for everyone when it did and allowed for
   * everyone when it did not — two answers to one declaration, neither of
   * them about capabilities.
   */
  const shown = () => screen.findByTestId(block.shown);
  const gated = { requiredPermissions: ['crm.manage'] };

  it('renders WITH an object permission config present', async () => {
    render(
      <PermissionProvider roles={[]} permissions={[{ object: 'crm_account', roles: {} } as any]} userRoles={['viewer']}>
        {bound(block, gated)}
      </PermissionProvider>,
    );
    expect(await shown()).toBeInTheDocument();
  });

  it('renders WITHOUT an object permission config — the same verdict, which is the point', async () => {
    render(
      <PermissionProvider roles={[]} permissions={[]} userRoles={['viewer']}>
        {bound(block, gated)}
      </PermissionProvider>,
    );
    expect(await shown()).toBeInTheDocument();
  });
});

describe('DISCRIMINATOR ② and the object name — which differs per block (objectui#10155)', () => {
  /**
   * ⭐ ② is ①'s mirror image, so neither can pass on a gate that is simply
   * always-open or always-closed: the two differ in BOTH inputs and land on
   * OPPOSITE verdicts.
   *
   * ⚠️ `record:related_list` is the block where ② cannot be spelled that way,
   * and the reason is its own: an `allowRead: false` object is refused by its
   * AUTOMATIC object-read gate (objectui#2359) before the capability gate is
   * reached. Its ② is therefore pinned on `allowRead: true`, and the
   * `allowRead: false` leg is pinned separately below as the object-read call
   * this card must NOT move.
   */
  it('record:details — ②: holding the capability renders even with `allowRead: false`', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'], { allowRead: false })}>{bound(BLOCKS[0], { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await screen.findByTestId('detail-view')).toBeInTheDocument();
  });

  it('record:highlights — ②: holding the capability renders even with `allowRead: false`', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'], { allowRead: false })}>{bound(BLOCKS[1], { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await screen.findByTestId('header-highlight')).toBeInTheDocument();
  });

  it('record:related_list — ②: holding the capability renders, with the object-read gate satisfied', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'], { allowRead: true })}>{bound(BLOCKS[2], { requiredPermissions: ['crm.manage'] })}</MePermissionsProvider>);
    expect(await screen.findByTestId('related-list')).toBeInTheDocument();
  });

  it('record:details — gates with NO objectName in the record context, a system capability is not object-scoped', async () => {
    // The `&& objectName` conjunct skipped the gate outright when the name was
    // empty, so a declared gate on a block outside a record context did nothing.
    render(<MePermissionsProvider initialPermissions={me([])}>{bound(BLOCKS[0], { requiredPermissions: ['crm.manage'] }, '')}</MePermissionsProvider>);
    expect(await screen.findByText(/insufficient permissions to view details/i)).toBeInTheDocument();
    expect(screen.queryByTestId('detail-view')).not.toBeInTheDocument();
  });

  it('record:highlights — gates with NO objectName in the record context, for the same reason', async () => {
    render(<MePermissionsProvider initialPermissions={me([])}>{bound(BLOCKS[1], { requiredPermissions: ['crm.manage'] }, '')}</MePermissionsProvider>);
    expect(await screen.findByText(/insufficient permissions to view highlights/i)).toBeInTheDocument();
    expect(screen.queryByTestId('header-highlight')).not.toBeInTheDocument();
  });
});

describe('record:related_list — the OBJECT-READ call this card does not move (objectui#10155)', () => {
  /**
   * ⛔ `perms.can(objectName, 'read')` on this renderer is a REAL object read
   * — the automatic child-object read gate (objectui#2359) — and is NOT the
   * defect this card repairs. `read` is one of the stock provider's eight
   * mapped verbs, so it resolves to the object's own `allowRead` bit, which is
   * the question it means to ask. These pins fix that call in place.
   *
   * ⭐ They are also this file's proof that `canSpy` is WIRED: the DETECTOR
   * pins above assert a negative, and a negative alone would pass on a spy
   * that never fires.
   */
  it('a denied object read hides the section entirely — no refusal node, no list', async () => {
    render(
      <MePermissionsProvider initialPermissions={me(['crm.manage'], { allowRead: false })}>
        {bound(BLOCKS[2], {})}
        {/* The block renders NOTHING when refused, so this sibling is what the
            assertions below can wait for — without it the queries would read an
            empty tree that had simply not rendered yet. */}
        <span data-testid="read-gate-probe" />
      </MePermissionsProvider>,
    );
    await screen.findByTestId('read-gate-probe');
    expect(screen.queryByTestId('related-list')).not.toBeInTheDocument();
    expect(screen.queryByText(/insufficient permissions to view related list/i)).not.toBeInTheDocument();
    expect(canSpy).toHaveBeenCalledWith('crm_contact', 'read');
  });

  it('an allowed object read renders the section — the positive control for the pin above', async () => {
    render(<MePermissionsProvider initialPermissions={me(['crm.manage'])}>{bound(BLOCKS[2], {})}</MePermissionsProvider>);
    expect(await screen.findByTestId('related-list')).toBeInTheDocument();
    expect(canSpy).toHaveBeenCalledWith('crm_contact', 'read');
  });

  it('the missing-objectName placeholder still returns BEFORE the capability gate', async () => {
    // This site never carried the `&& objectName` conjunct its siblings did,
    // and never needed one: an unbound related list is refused one branch
    // earlier, so the "second silent fail-open" the siblings had is not a
    // reading that ever applied here.
    render(
      <MePermissionsProvider initialPermissions={me([])}>
        <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }} dataSource={ds as any}>
          <RecordRelatedListRenderer schema={{ relationshipField: 'account', requiredPermissions: ['crm.manage'] } as any} />
        </RecordContextProvider>
      </MePermissionsProvider>,
    );
    expect(await screen.findByText(/missing objectName/i)).toBeInTheDocument();
    expect(screen.queryByText(/insufficient permissions to view related list/i)).not.toBeInTheDocument();
  });
});

describe('CONTROL — `can()` answers exactly what it answered before this card (objectui#10155)', () => {
  /**
   * The three call sites move and no other caller does: `can()`'s own
   * semantics are untouched. These two pins are the whole truth table both
   * stock providers produce, so any drift in `can()` shows up here rather than
   * in a renderer somewhere.
   *
   * ⚠️ Several of these verdicts ARE the defect (`crm.manage` → `true` off
   * `allowRead`). They are pinned as UNCHANGED on purpose — the fix is that
   * these three gates stopped ASKING this question, not that the answer moved.
   * ⭐ They must therefore stay GREEN under an ablation of the renderers,
   * which is the evidence that they pin `can()` and not the gate.
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
      // answer off their own FALSE bits, which proves the fallback tail above
      // them is live rather than an absence the probe invented.
      create: false, update: false, delete: false, import: false,
      execute: true, manage: true, configure: true, share: true, export: true, admin: true,
    });
  });

  it('role-based PermissionProvider: refused for everyone with a config, allowed for everyone without', () => {
    render(<PermissionProvider roles={[]} permissions={[{ object: 'crm_account', roles: {} } as any]} userRoles={['viewer']}><Table object="crm_account" /></PermissionProvider>);
    expect(read()).toEqual(all(false));
    cleanup();
    render(<PermissionProvider roles={[]} permissions={[]} userRoles={['viewer']}><Table object="crm_account" /></PermissionProvider>);
    expect(read()).toEqual(all(true));
  });
});
