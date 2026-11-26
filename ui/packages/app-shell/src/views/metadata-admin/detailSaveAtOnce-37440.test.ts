// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37440 — the generic item page's Save (`publishDetailSave`)
 * pins its publish to the draft the Save itself wrote (`target.draftVersion`,
 * its receipt), guarded or not. A draft another writer changed in between is
 * refused and kept pending, never published and never taken back; with no
 * write in between, the Save goes live as before.
 */

import { describe, expect, it, vi } from 'vitest';
import { publishDetailSave } from './detailSaveAtOnce';
import { DraftVersionGuard, draftReceiptVersion, isPublishDraftMoved } from './DraftConflictDialog';
import { draftPublishDoor } from '../__tests__/draftPublishDoor-37440';

const PKG = 'com.acme.crm';
const TARGET = { type: 'flow', name: 'acme_flow', packageId: PKG };

async function savedDraft(door: ReturnType<typeof draftPublishDoor>): Promise<string | undefined> {
  return draftReceiptVersion(await door.client.save(TARGET.type, TARGET.name, { label: 'mine' }, { mode: 'draft', packageId: PKG }));
}

function guardOver(door: ReturnType<typeof draftPublishDoor>) {
  const ask = vi.fn(async () => 'cancel' as const);
  const guard = new DraftVersionGuard({
    client: () => door.client as never,
    ask,
    reload: vi.fn(),
    notSaved: () => new Error('not saved'),
  });
  return { guard, ask };
}

describe("the item page's Save publishes only the draft it wrote (objectstack#37440)", () => {
  it("PIN (unguarded): another writer's draft write before the publish is refused, published by nobody, and kept", async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door);
    door.interleave(TARGET.type, TARGET.name, PKG, { label: 'theirs' });
    const outcome = await publishDetailSave(door.client, { ...TARGET, draftVersion }, false);
    expect(outcome).toMatchObject({ kind: 'refused', draftDiscarded: false });
    expect(door.liveOf(TARGET.type, TARGET.name, PKG)).toBeUndefined();
    expect(door.draftOf(TARGET.type, TARGET.name, PKG)).toEqual({ label: 'theirs' });
    expect(door.calls.some(([c]) => c === 'reset')).toBe(false);
  });

  it("PIN (guarded): the same, with nothing asked — the refusal is the draft's, not a live change", async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door);
    const { guard, ask } = guardOver(door);
    door.interleave(TARGET.type, TARGET.name, PKG, { label: 'theirs' });
    const outcome = await publishDetailSave(door.client, { ...TARGET, draftVersion }, false, guard.publish);
    expect(outcome.kind).toBe('refused');
    expect(outcome.kind === 'refused' && isPublishDraftMoved(outcome.error)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(door.draftOf(TARGET.type, TARGET.name, PKG)).toEqual({ label: 'theirs' });
    expect(door.calls.some(([c]) => c === 'reset')).toBe(false);
  });

  it('CONTROL: with no write in between, the same pinned publish takes the Save live, guarded and not', async () => {
    for (const guarded of [false, true]) {
      const door = draftPublishDoor();
      const draftVersion = await savedDraft(door);
      const pinned = guarded ? guardOver(door).guard.publish : undefined;
      expect(await publishDetailSave(door.client, { ...TARGET, draftVersion }, false, pinned)).toEqual({ kind: 'published' });
      expect(door.liveOf(TARGET.type, TARGET.name, PKG)).toEqual({ label: 'mine' });
      expect(door.calls.find(([c]) => c === 'publish')?.[3]).toEqual({ packageId: PKG, draftVersion });
    }
  });
});
