// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `MetadataService` is the third writer into the `/meta/view` rows the adapter
 * caches, and it names the wrong key for them (objectui#4373's dormant sibling).
 *
 * `saveMetadataItem` / `deleteMetadataItem` invalidate `${category}:${name}` —
 * exactly right for the adapter's generic metadata read, and wrong for one
 * category. A `view` row is ALSO read back under two OBJECT-scoped keys
 * (`view:{object}:{name}` via `getView`, `view-overrides:{object}` via
 * `listViewOverrides`), and `view:{name}` is neither of them. So a caller
 * passing `'view'` would leave the object page's override map stale for
 * `MetadataCache`'s 5-minute TTL — the same defect this card fixes on the
 * console's create/publish flow, on a third door.
 *
 * ## What was measured before wiring it
 *
 * The card left the choice open — wire it, or document it as unreachable,
 * whichever is honest. Measured:
 *
 * - **No in-repo caller passes `'view'`.** In fact no production code calls
 *   either method at all; the only call anywhere is one `'flow'` save in
 *   `MetadataService.saveAdvisories.test.ts`.
 * - **But the class is public API.** `useMetadataService()` is exported from
 *   `packages/app-shell/src/index.ts`, so a consumer outside this repo can hold
 *   a `MetadataService` and call `saveMetadataItem('view', …)` today. "No
 *   caller" is a fact about this repo; "unreachable" would have been an
 *   unmeasured claim about consumers we do not own.
 *
 * So the save half is wired. The delete half is NOT, and that is structural
 * rather than an oversight — see the case at the bottom, which pins the reason
 * so the asymmetry reads as a decision.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { MetadataService } from './MetadataService';

function makeAdapter() {
  const invalidatedKeys: string[] = [];
  const viewSeamCalls: Array<[string, string]> = [];
  const saveItem = vi.fn(
    async (_category: string, _name: string, _data: Record<string, unknown>) => ({ success: true }),
  );
  const deleteItem = vi.fn(async (type: string, name: string) => ({ type, name, deleted: true }));

  const adapter = {
    getClient: () => ({ meta: { saveItem, deleteItem } }),
    invalidateCache: (key: string) => invalidatedKeys.push(key),
    invalidateViewKeys: (objectName: string, viewName: string) => {
      viewSeamCalls.push([objectName, viewName]);
    },
  };

  return { adapter, invalidatedKeys, viewSeamCalls, saveItem, deleteItem };
}

describe('MetadataService routes view writes through the adapter seam (#4373)', () => {
  it('saveMetadataItem("view", ...) calls invalidateViewKeys with the object from the body', async () => {
    const { adapter, viewSeamCalls } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).saveMetadataItem('view', 'account.mine', {
      name: 'account.mine',
      object: 'account',
      viewKind: 'list',
    });

    expect(viewSeamCalls).toEqual([['account', 'account.mine']]);
  });

  it('reads the object binding the same way listViewOverrides narrows those rows', async () => {
    // Not "any spelling of object" — the SAME spelling. `viewItemObjectName`
    // (exported from the adapter for exactly this) reads
    // `data.object ?? object` off the row (no `objectName` leg since
    // objectui#11013), and it is the accessor
    // `listViewOverrides` itself narrows those rows by. Using it here is what
    // makes the key this names provably the map that write invalidates; a
    // fourth private copy of "which object is this?" is the drift it prevents.
    //
    // This body is the adapter's own `createView` shape (top-level `data`),
    // which the previous case's `object` covers by a different limb.
    const { adapter, viewSeamCalls } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).saveMetadataItem('view', 'account.mine', {
      name: 'account.mine',
      data: { provider: 'object', object: 'account' },
    });

    expect(viewSeamCalls).toEqual([['account', 'account.mine']]);
  });

  it('does not invent a limb the shared accessor lacks — a nested config.data is NOT a binding', async () => {
    // Measured, not assumed: `viewItemObjectName` reads `data.object` off the
    // ROW, not `config.data.object`. So a body that only nests its provider
    // target under `config` names no object here — and that is correct rather
    // than a gap, because `listViewOverrides` reads those rows through the very
    // same accessor and would not have matched such a row into the map either.
    // Adding a `config.data.object` limb HERE (and only here) is precisely the
    // consumer-side leniency AGENTS.md #0.1 forbids: it would key an
    // invalidation to a map entry that does not exist.
    const { adapter, viewSeamCalls } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).saveMetadataItem('view', 'account.mine', {
      name: 'account.mine',
      config: { data: { provider: 'object', object: 'account' } },
    });

    expect(viewSeamCalls).toEqual([]);
  });

  it('leaves every other category exactly as it was', async () => {
    const { adapter, invalidatedKeys, viewSeamCalls } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).saveMetadataItem('flow', 'nightly_purge', {
      name: 'nightly_purge',
    });

    expect(invalidatedKeys).toEqual(['flow:nightly_purge']);
    expect(viewSeamCalls).toEqual([]);
  });

  it('a view body with no object binding names nothing object-scoped', async () => {
    // Both keys are object-scoped. With no object in the body there is nothing
    // to derive one from, and splitting `name` on `.` would be a second,
    // silently-wrong identity rule (a source-declared view's name is not
    // qualified). The generic key still drops, as before.
    const { adapter, invalidatedKeys, viewSeamCalls } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).saveMetadataItem('view', 'account.mine', {
      name: 'account.mine',
    });

    expect(viewSeamCalls).toEqual([]);
    expect(invalidatedKeys).toEqual(['view:account.mine']);
  });

  it('deleteMetadataItem cannot name the view keys, and the reason is its payload', async () => {
    // Pinned as a decision, not left as an absence — and objectui#6238 made the
    // reason STRONGER rather than obsolete. This method used to PUT a tombstone
    // `{ name, enabled: false, _deleted: true }`, whose defect was that it
    // carried no object binding to derive the two object-scoped view keys from;
    // it now issues `DELETE /meta/view/:name`, which carries no body at all.
    // The signature still has no object parameter, so there is still nothing
    // here to derive the keys from, and inventing an object argument for a
    // method with no callers would still be guessing at a surface. If a
    // `'view'` caller ever appears, give it the object it already knows and
    // call `adapter.invalidateViewKeys(objectName, name)` here.
    const { adapter, invalidatedKeys, viewSeamCalls, saveItem, deleteItem } = makeAdapter();

    await new MetadataService(adapter as unknown as ObjectStackAdapter).deleteMetadataItem('view', 'account.mine');

    expect(deleteItem).toHaveBeenCalledWith('view', 'account.mine');
    // The delete door takes `(type, name)` and nothing else, so there is no
    // body to read an object out of — this is the measurement, not a wish.
    expect(deleteItem.mock.calls[0]).toHaveLength(2);
    // And no tombstone PUT rides along beside it.
    expect(saveItem).not.toHaveBeenCalled();
    expect(viewSeamCalls).toEqual([]);
    expect(invalidatedKeys).toEqual(['view:account.mine']);
  });
});
