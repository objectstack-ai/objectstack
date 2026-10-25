// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The permission door's package save carries no read decorations
 * (objectui#8181).
 *
 * ## Why this file exists after the strip already landed
 *
 * objectui#8181 asked for a read-decoration strip at three consumers. All
 * three have one on `main`. Two of them — `ObjectHooksPanel` and
 * `StudioDesignSurface` — delegate to the hoisted `extractDraftBody` in
 * `@object-ui/data-objectstack`, so deleting their strip is caught by
 * `draft-envelope.test.ts`. THIS consumer is the exception: it does not call
 * the hoisted reader, it calls `stripReadDecorations` inline at its own unwrap.
 *
 * Measured before this file was written: removing that inline strip — leaving
 * the unwrap, i.e. restoring the exact `((pendingDraft as any).item ??
 * pendingDraft)` shape the card names — turned NOTHING red across
 * `PermissionMatrixEditor.*` and both `data-objectstack` draft suites. A lit
 * control run at the same line (dropping the pending draft entirely) DID turn
 * one test red, so the path is exercised; it was the decorations specifically
 * that nothing asserted. That is what this file closes: the strip was present
 * and unguarded, one edit away from silently coming back.
 *
 * ## Which arm, and why it MOVED (objectui#9420)
 *
 * ⚠️ The everyday arm cannot carry decorations and is not evidence either way.
 * `doSave` re-reads `layered` and merges through `mergePermissionSlice`, which
 * starts from `{ ...base }` and copies only `EDITOR_AUTHORED_KEYS` out of the
 * edited draft — so when the fresh read answers a published layer, `base` is
 * that RAW layer and every decoration is dropped by the merge whether or not
 * the unwrap stripped. A pin written there would pass with the strip deleted.
 *
 * The leak needs the arm where `base` IS the draft body — `fresh?.effective ??
 * payload`, whose `payload` branch spreads the draft wholesale into
 * `client.save`. This file used to reach that branch through the REJECTED
 * re-read, and objectui#9420 closed that entrance: a rejection now REFUSES the
 * save outright, because `payload` has been sliced to this package and merging
 * onto it deletes every other package's permission rows. There is no PUT left
 * on that arm to inspect.
 *
 * The `?? payload` branch itself is untouched and still reachable, through the
 * OTHER entrance: `MetadataClient.layered` resolves a record the server does
 * not hold as `{ effective: null, … }` rather than rejecting — the shape a set
 * that exists only as a package draft answers with, which is why objectui#9420
 * deliberately kept it saving. That is the arm driven below. The subject under
 * test, the assertions and the controls are unchanged; only the way the fake
 * client reaches the fallback moved.
 *
 * ## What the far side does, stated so nobody re-derives it
 *
 * The server does not 400 on this today: `saveMetaItem` strips read decorations
 * on ingress, ahead of its schema gate. That is a mitigation in the framework,
 * not a licence for this client to PUT a body its own spec rejects —
 * `PermissionSetSchema.safeParse(body + _diagnostics)` answers
 * `unrecognized_keys` at the root. AGENTS.md #0.1: fix it at the producer.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** Exactly what the framework attaches to a `?state=draft` read. */
const DECORATIONS = { _diagnostics: { valid: true, errors: [] }, _draft: true };
/**
 * ADR-0010 carriers. They share the underscore spelling, the closed schemas
 * DECLARE them, and `METADATA_READ_DECORATIONS` deliberately omits them — so
 * they must ride through untouched. Asserted here as a live control: they are
 * the proof that an underscore-prefixed key from the draft body really does
 * reach the save on this arm, which is what makes the absence of
 * `_diagnostics` a strip rather than a blanket underscore filter.
 */
const PROTECTION = { _provenance: 'package', _packageId: 'app.a' };

/** Authored in a previous package save, staged in the draft, never published. */
const AUTHORED_POLICY = {
  name: 'qa_st2_rls',
  object: 'a_account',
  operation: 'all',
  using: 'owner_id == current_user.id',
  enabled: true,
};

const PUBLISHED = {
  name: 'sales_perms',
  label: 'Sales',
  objects: {
    a_account: { allowRead: true, allowCreate: true },
    a_contact: { allowRead: true },
  },
  fields: {},
};

interface Server {
  saved: Array<Record<string, unknown>>;
  /** `layered` calls seen so far — #1 is the load, #2 is `doSave`'s re-read. */
  layeredCalls: number;
}

/**
 * A client whose `layered` answers the published record for the LOAD and then
 * the 404 shape (`effective: null`) for `doSave`'s re-read — the arm that still
 * falls back to `base = payload`. Answering it for the load too would leave the
 * editor with no published baseline at all and test a different screen.
 */
function makeClient(server: Server) {
  return {
    layered: async () => {
      server.layeredCalls += 1;
      if (server.layeredCalls >= 2)
        return { effective: null, code: null, overlay: null, overlayScope: null };
      return { effective: PUBLISHED, code: null, overlay: null, overlayScope: null };
    },
    // The decorated envelope, exactly as `decorateMetadataItem` serves it.
    getDraft: async () => ({
      type: 'permission',
      name: 'sales_perms',
      item: {
        ...PUBLISHED,
        rowLevelSecurity: [AUTHORED_POLICY],
        ...PROTECTION,
        ...DECORATIONS,
      },
    }),
    // objectui#11799 — the published set list names this set, as the server's
    // does for a published set, so the load reads its layers exactly as before
    // (call #1 above). A set the list does not hold is not asked while its
    // draft is in hand.
    list: async (type: string) =>
      type === 'object'
        ? [{ item: { name: 'a_account' } }, { item: { name: 'a_contact' } }]
        : type === 'permission'
          ? [{ name: 'sales_perms' }]
          : [],
    get: async () => null,
    save: async (_type: string, _name: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      return payload;
    },
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

describe('PermissionMatrixEditPage — read decorations never reach the save (objectui#8181)', () => {
  it('drops `_diagnostics` / `_draft` when the save-time re-read finds no published layer', async () => {
    const server: Server = { saved: [], layeredCalls: 0 };
    clientImpl = makeClient(server);

    render(
      <MemoryRouter>
        <PermissionMatrixEditPage type="permission" name="sales_perms" packageId="app.a" />
      </MemoryRouter>,
    );
    await screen.findByText('a_account');

    // An ordinary edit — the author is not touching RLS or anything internal.
    const row = screen.getByText('a_account').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'None' }));

    // objectui#11787 — the package door autosaves the edit to its draft after
    // the shared autosave's pause; it has no Save button.
    await waitFor(() => expect(server.saved).toHaveLength(1), { timeout: 4000 });
    const body = server.saved[0] as Record<string, any>;

    // ── CONTROLS. Every absence below is meaningless without these. ──

    // We are on the `?? payload` arm: the re-read was attempted and it came
    // back without a published layer.
    expect(server.layeredCalls).toBe(2);
    // The DRAFT BODY is the merge base, not the published record — proved by a
    // key only the draft carries. Without this the body under test could be the
    // published baseline, which never had decorations to lose.
    expect(body.rowLevelSecurity).toEqual([AUTHORED_POLICY]);
    // The author's edit really is in the body being PUT.
    expect(body.objects.a_account).toEqual({});
    // Underscore-prefixed keys from the draft DO reach the save on this arm…
    expect(body._provenance).toBe('package');
    expect(body._packageId).toBe('app.a');

    // ── THE PIN. Restoring the pre-fix unwrap turns exactly these red. ──
    expect(body).not.toHaveProperty('_diagnostics');
    expect(body).not.toHaveProperty('_draft');
  });
});
