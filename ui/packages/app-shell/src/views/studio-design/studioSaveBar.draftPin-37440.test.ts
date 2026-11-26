// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37440 — the Studio Save's publish (`publishSavedItem`) is
 * pinned to the draft the Save itself wrote (`item.draftVersion`, its
 * receipt), on both of its publish doors: the unpinned door (no buffer
 * guard) and a create's `publishCreated`. A draft another writer changed in
 * between is refused and kept pending, never published and never discarded;
 * with no write in between, the Save goes live as before. The guarded door
 * (`DraftSaveGuard.publish`) is pinned in `DraftConflictDialog.test.tsx`.
 */

import { describe, expect, it } from 'vitest';
import { publishCreated, publishSavedItem } from './studioSaveBar';
import { draftReceiptVersion, isDraftVersionConflict } from '../metadata-admin/DraftConflictDialog';
import { draftPublishDoor } from '../__tests__/draftPublishDoor-37440';

const PKG = 'com.acme.crm';
const ITEM = { type: 'app', name: 'acme_app', packageId: PKG };

/** The Save's own draft write, through the door, answering its receipt's version. */
async function savedDraft(door: ReturnType<typeof draftPublishDoor>, body: unknown): Promise<string | undefined> {
  return draftReceiptVersion(await door.client.save(ITEM.type, ITEM.name, body, { mode: 'draft', packageId: PKG, ifNoneMatch: '*' }));
}

describe('publishSavedItem, unpinned door: the publish names the draft the Save wrote (objectstack#37440)', () => {
  it("PIN: another writer's draft write before the publish is refused; nothing goes live, and their draft is kept", async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door, { label: 'mine' });
    door.interleave(ITEM.type, ITEM.name, PKG, { label: 'theirs' });
    const live = await publishSavedItem(door.client, { ...ITEM, draftVersion }, false);
    expect(live.ok).toBe(false);
    expect(!live.ok && isDraftVersionConflict(live.error)).toBe(true);
    expect(!live.ok && live.draftDiscarded).toBe(false);
    expect(door.liveOf(ITEM.type, ITEM.name, PKG)).toBeUndefined();
    expect(door.draftOf(ITEM.type, ITEM.name, PKG)).toEqual({ label: 'theirs' });
    expect(door.calls.some(([c]) => c === 'reset')).toBe(false);
    expect(door.calls.find(([c]) => c === 'publish')?.[3]).toEqual({ packageId: PKG, draftVersion });
  });

  it('a refusal for another reason takes back only the draft this Save wrote, pinned to its receipt', async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door, { label: 'mine' });
    const refusing = { ...door.client, publish: async () => Promise.reject(Object.assign(new Error('rule'), { status: 422 })) };
    const live = await publishSavedItem(refusing, { ...ITEM, draftVersion }, false);
    expect(!live.ok && live.draftDiscarded).toBe(true);
    expect(door.calls.find(([c]) => c === 'reset')?.[3]).toEqual({ state: 'draft', packageId: PKG, ifMatch: draftVersion });
    expect(door.draftOf(ITEM.type, ITEM.name, PKG)).toBeUndefined();
  });

  it('CONTROL: with no write in between, the same pinned publish takes the Save live', async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door, { label: 'mine' });
    expect(await publishSavedItem(door.client, { ...ITEM, draftVersion }, false)).toEqual({ ok: true });
    expect(door.liveOf(ITEM.type, ITEM.name, PKG)).toEqual({ label: 'mine' });
  });
});

describe('publishSavedItem, a create (`publishCreated`): the publish names the draft the create wrote (objectstack#37440)', () => {
  it("PIN: another writer's draft write before the publish is refused; nothing goes live, and their draft is kept", async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door, { label: 'mine' });
    door.interleave(ITEM.type, ITEM.name, PKG, { label: 'theirs' });
    const live = await publishSavedItem(door.client, { ...ITEM, draftVersion }, false, publishCreated);
    expect(live.ok).toBe(false);
    expect(!live.ok && 'draftDiscarded' in live && live.draftDiscarded).toBe(false);
    expect(door.liveOf(ITEM.type, ITEM.name, PKG)).toBeUndefined();
    // The pinned take-back was refused by the door: the moved draft is not the create's.
    expect(door.draftOf(ITEM.type, ITEM.name, PKG)).toEqual({ label: 'theirs' });
    expect(door.calls.find(([c]) => c === 'publish')?.[3]).toEqual({ packageId: PKG, draftVersion, ifNoneMatch: '*' });
  });

  it('CONTROL: with no write in between, the create goes live', async () => {
    const door = draftPublishDoor();
    const draftVersion = await savedDraft(door, { label: 'mine' });
    expect(await publishSavedItem(door.client, { ...ITEM, draftVersion }, false, publishCreated)).toEqual({ ok: true });
    expect(door.liveOf(ITEM.type, ITEM.name, PKG)).toEqual({ label: 'mine' });
  });
});
