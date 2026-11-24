// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32714] The package-slotted store's rules on their own (`package-slotted-store.ts`).
 *
 * The manager, the artifact door's `MemoryLoader` and `DatabaseLoader` all ask
 * these rules; their suites pin what each layer serves. This file pins the
 * rules themselves, over plain maps keyed the way those layers key them
 * (`storeSlotKey`), so a rule that changes is red here first, whichever layer
 * would have noticed.
 */

import { describe, it, expect } from 'vitest';
import { PackageScopedNameRefusedError } from '@objectstack/core';
import {
  inheritStoreWriteOrder,
  isPlatformOrigin,
  lastWrittenKeyOf,
  latestMemberOf,
  newSlotView,
  readPlatformEntry,
  recordStoreWrite,
  refuseSeveralSlots,
  refuseSlotNotHeld,
  slotOfKey,
  storePlatformRemovalKeys,
  storeRemovalKeys,
  storeRowWriteKey,
  storeSlotKey,
  storeWriteKey,
  withoutPlatformOrigin,
  withPlatformOrigin,
} from './package-slotted-store.js';

const TYPE = 'email_template';
const NAME = 'welcome';
const ALPHA = 'com.alpha.app';
const BETA = 'com.beta.app';

/** A member of the bundle: `packageId` undefined is the environment's own item. */
const member = (packageId: string | undefined, locale: string, subject = `${packageId ?? 'env'}:${locale}`) => ({
  name: NAME,
  locale,
  subject,
  ...(packageId === undefined ? {} : { _packageId: packageId, _provenance: 'package' }),
});
type Member = ReturnType<typeof member>;

const keyOf = (item: Member) => storeSlotKey(TYPE, NAME, (item as { _packageId?: string })._packageId, item);

/** A store written the way the registry and the `MemoryLoader` write: the key the write rule picks, its write recorded. */
function written(...items: Member[]): Map<string, Member> {
  const store = new Map<string, Member>();
  for (const item of items) {
    const { key, replaces } = storeWriteKey(store, TYPE, NAME, item);
    for (const replaced of replaces) store.delete(replaced);
    store.set(key, item);
    recordStoreWrite(store, key);
  }
  return store;
}

const subjects = (store: ReadonlyMap<string, Member>) => [...store.values()].map((item) => item.subject).sort();

describe('[#32714] a view is declared where it is made: `latestMemberOf` never infers one from a missing write order', () => {
  const EN = member(ALPHA, 'en-US');
  const FR = member(ALPHA, 'fr-FR');
  const SLOT = slotOfKey(keyOf(EN));

  it('the two members share one slot (the premise of every case below)', () => {
    expect(slotOfKey(keyOf(FR))).toBe(SLOT);
    expect(keyOf(FR)).not.toBe(keyOf(EN));
  });

  it('a VIEW with no write order answers its first member of the slot: its sources hand the member written last first', () => {
    const view = newSlotView<Member>();
    view.set(keyOf(FR), FR);
    view.set(keyOf(EN), EN);
    expect(latestMemberOf(view, SLOT)).toBe(keyOf(FR));
  });

  it('a store that is NOT a view, with no write recorded, answers by its write order as `lastWrittenKeyOf` does: the last member in store order (BASE: read as a view, its first member)', () => {
    const store = new Map<string, Member>([[keyOf(FR), FR], [keyOf(EN), EN]]);
    expect(latestMemberOf(store, SLOT)).toBe(keyOf(EN));
    expect(latestMemberOf(store, SLOT)).toBe(lastWrittenKeyOf(store, [keyOf(FR), keyOf(EN)]));
  });

  it('a written store answers the member written last, whatever the store\'s order (the registry, the door\'s `MemoryLoader`)', () => {
    const store = written(EN, FR, member(ALPHA, 'en-US', 'en again'));
    expect([...store.keys()]).toEqual([keyOf(EN), keyOf(FR)]);
    expect(store.get(latestMemberOf(store, SLOT))!.subject).toBe('en again');
    expect(store.get(latestMemberOf(written(EN, FR), SLOT))!.subject).toBe(`${ALPHA}:fr-FR`);
  });

  it('a view that inherited a store\'s write order answers by it for a slot that store holds, and its first member for a slot only the view holds', () => {
    const registry = written(EN, FR, member(ALPHA, 'en-US', 'en again'));
    const loaderOnly = [member(BETA, 'fr-FR'), member(BETA, 'en-US')];
    const view = newSlotView<Member>();
    for (const [key, item] of registry) view.set(key, item);
    for (const item of loaderOnly) view.set(keyOf(item), item);
    inheritStoreWriteOrder(view, registry);
    expect(view.get(latestMemberOf(view, SLOT))!.subject).toBe('en again');
    expect(latestMemberOf(view, slotOfKey(keyOf(loaderOnly[0]!)))).toBe(keyOf(loaderOnly[0]!));
  });
});

describe('[#32714] `refuseSlotNotHeld` names each holder once, as `packageSlotsOf` and `refuseSeveralSlots` count them', () => {
  const refusalOf = (store: ReadonlyMap<string, unknown>, packageId: string | null): PackageScopedNameRefusedError => {
    try {
      refuseSlotNotHeld(store, TYPE, NAME, packageId);
    } catch (err) {
      return err as PackageScopedNameRefusedError;
    }
    throw new Error('refuseSlotNotHeld returned');
  };

  it('one package\'s two locales are ONE candidate, and the environment\'s two locales one more (BASE: one candidate per member)', () => {
    const store = written(member(undefined, 'en-US'), member(undefined, 'fr-FR'));
    for (const item of [member(ALPHA, 'en-US'), member(ALPHA, 'fr-FR')]) store.set(keyOf(item), item);
    const err = refusalOf(store, BETA);
    expect(err).toBeInstanceOf(PackageScopedNameRefusedError);
    expect([err.code, err.status, err.refusal.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'not-held-by-qualifier']);
    expect(err.refusal.callerPackageId).toBe(BETA);
    expect(err.refusal.candidates).toEqual([{ kind: 'package', packageId: ALPHA }, { kind: 'environment' }]);
  });

  it('one package\'s action bound to two objects is ONE candidate', () => {
    const bound = (objectName: string) => ({ name: 'ping', objectName, _packageId: ALPHA });
    const store = new Map<string, unknown>();
    for (const item of [bound('o1'), bound('o2')]) store.set(storeSlotKey('action', 'ping', ALPHA, item), item);
    expect(store.size).toBe(2);
    let err: PackageScopedNameRefusedError | undefined;
    try {
      refuseSlotNotHeld(store, 'action', 'ping', null);
    } catch (e) {
      err = e as PackageScopedNameRefusedError;
    }
    expect(err?.refusal.candidates).toEqual([{ kind: 'package', packageId: ALPHA }]);
  });

  it('CONTROL — `refuseSeveralSlots` counts slots, never members: one package\'s two locales are not refused, a package beside the environment is', () => {
    expect(() => refuseSeveralSlots(written(member(ALPHA, 'en-US'), member(ALPHA, 'fr-FR')), TYPE, NAME)).not.toThrow();
    const both = new Map<string, Member>();
    for (const item of [member(undefined, 'en-US'), member(ALPHA, 'en-US'), member(ALPHA, 'fr-FR')]) both.set(keyOf(item), item);
    let err: PackageScopedNameRefusedError | undefined;
    try {
      refuseSeveralSlots(both, TYPE, NAME);
    } catch (e) {
      err = e as PackageScopedNameRefusedError;
    }
    expect(err?.refusal.candidates).toEqual([{ kind: 'environment' }, { kind: 'package', packageId: ALPHA }]);
  });
});

/**
 * [#32714 item 2] A package's first item of a bundled name the environment
 * already holds takes over the bare slot's SAME member only. The bare slot's
 * other members stay where they are, the environment's: no member moves
 * without being written. `DatabaseLoader` leaves those members' package-less
 * rows the same way (pinned beside its storage pins,
 * `metadata-manager-match-endpoint.test.ts`).
 */
describe('[#32714 item 2] a package taking over a bundled name moves the member it writes, and no other', () => {
  it('the package\'s canonical member replaces the bare canonical member; the bare `fr-FR` stays bare', () => {
    const store = written(member(undefined, 'en-US'), member(undefined, 'fr-FR'));
    const EN = member(ALPHA, 'en-US');
    const write = storeWriteKey(store, TYPE, NAME, EN);
    expect(write).toEqual({ key: keyOf(EN), replaces: [keyOf(member(undefined, 'en-US'))] });
    const after = written(member(undefined, 'en-US'), member(undefined, 'fr-FR'), EN);
    expect(subjects(after)).toEqual([`${ALPHA}:en-US`, 'env:fr-FR']);
    expect([...after.keys()]).toEqual([keyOf(member(undefined, 'fr-FR')), keyOf(EN)]);
  });

  it('the package\'s write of that member later takes the bare member over in turn: nothing is left beside it', () => {
    const FR = member(ALPHA, 'fr-FR');
    const before = written(member(undefined, 'en-US'), member(undefined, 'fr-FR'), member(ALPHA, 'en-US'));
    expect(storeWriteKey(before, TYPE, NAME, FR)).toEqual({ key: keyOf(FR), replaces: [keyOf(member(undefined, 'fr-FR'))] });
    expect(subjects(written(member(undefined, 'en-US'), member(undefined, 'fr-FR'), member(ALPHA, 'en-US'), FR)))
      .toEqual([`${ALPHA}:en-US`, `${ALPHA}:fr-FR`]);
  });

  it('CONTROL — beside a second package nothing is taken over: the bare members stay, each package fills its own slot', () => {
    const store = written(member(undefined, 'en-US'), member(BETA, 'en-US'));
    expect(storeWriteKey(store, TYPE, NAME, member(ALPHA, 'en-US')).replaces).toEqual([]);
  });
});

describe('[#37013] the platform\'s record of a name keeps the bare slot beside a package\'s same-named item', () => {
  const SKILL = 'skill';
  const ASK = 'data_explorer';
  const platform = (label: string) => withPlatformOrigin({ name: ASK, label }) as Record<string, unknown>;
  const shippedBy = (packageId: string, label: string) => ({ name: ASK, label, _packageId: packageId, _provenance: 'package' });
  const environment = (label: string) => ({ name: ASK, label });

  /** Written the way the registry writes: the key the rule picks, the keys it replaces dropped. */
  function writtenSkills(...items: unknown[]): Map<string, unknown> {
    const store = new Map<string, unknown>();
    for (const item of items) {
      const { key, replaces } = storeWriteKey(store, SKILL, ASK, item);
      for (const replaced of replaces) store.delete(replaced);
      store.set(key, item);
      recordStoreWrite(store, key);
    }
    return store;
  }
  const labels = (store: ReadonlyMap<string, unknown>) => [...store.entries()].map(([key, item]) => [key.replace('\u0000', '/'), (item as { label: string }).label]);

  it('the stamp is positive, and a body naming a package is that package\'s item whatever it says', () => {
    expect(isPlatformOrigin(platform('p'))).toBe(true);
    expect(isPlatformOrigin(environment('e')), 'a missing package stamp is not the platform').toBe(false);
    expect(isPlatformOrigin({ ...shippedBy(ALPHA, 'a'), _provenance: 'platform' })).toBe(false);
  });

  it('platform first, then a package: both stay, each in its own slot (BASE: the package took over the bare slot)', () => {
    const store = writtenSkills(platform('platform'), shippedBy(ALPHA, 'alpha'));
    expect(labels(store)).toEqual([[ASK, 'platform'], [`${ALPHA}/${ASK}`, 'alpha']]);
  });

  it('a package first, then the platform: the platform fills the bare slot and the package\'s slot is untouched (BASE: folded into the holder\'s slot as its customization)', () => {
    const alpha = shippedBy(ALPHA, 'alpha');
    const store = writtenSkills(alpha, platform('platform'));
    expect(store.get(`${ALPHA}\u0000${ASK}`)).toBe(alpha);
    expect(labels(store)).toEqual([[`${ALPHA}/${ASK}`, 'alpha'], [ASK, 'platform']]);
  });

  it('the platform re-registering rewrites its own slot only', () => {
    const alpha = shippedBy(ALPHA, 'alpha');
    const store = writtenSkills(platform('v1'), alpha, platform('v2'));
    expect(store.get(`${ALPHA}\u0000${ASK}`)).toBe(alpha);
    expect(labels(store)).toEqual([[ASK, 'v2'], [`${ALPHA}/${ASK}`, 'alpha']]);
  });

  it('CONTROL — the environment\'s own item in the bare slot is still taken over by a package\'s first item, and a package-less write beside one holder is still its customization (D4)', () => {
    expect(labels(writtenSkills(environment('env'), shippedBy(ALPHA, 'alpha')))).toEqual([[`${ALPHA}/${ASK}`, 'alpha']]);
    expect(labels(writtenSkills(shippedBy(ALPHA, 'alpha'), environment('env')))).toEqual([[`${ALPHA}/${ASK}`, 'env']]);
  });

  it('a row store reads the platform\'s row through the loader\'s predicate: never taken over by a package\'s first row', () => {
    const rows = new Map<string, unknown>([[ASK, { id: 'r1' }]]);
    expect(storeRowWriteKey(rows, SKILL, ASK, shippedBy(ALPHA, 'alpha'), (key) => key === ASK).replaces).toEqual([]);
    expect(storeRowWriteKey(rows, SKILL, ASK, shippedBy(ALPHA, 'alpha')).replaces, 'CONTROL — the environment\'s row is').toEqual([ASK]);
  });

  it('the platform\'s removal takes its own slot only, whatever packages hold the name; a package\'s removal takes the package\'s only', () => {
    const store = writtenSkills(platform('platform'), shippedBy(ALPHA, 'alpha'), shippedBy(BETA, 'beta'));
    expect(storePlatformRemovalKeys(store, SKILL, ASK)).toEqual({ keys: [ASK], platformOnly: true });
    expect(storeRemovalKeys(store, SKILL, ASK, ALPHA).keys).toEqual([`${ALPHA}\u0000${ASK}`]);
  });

  it('the platform\'s removal leaves the environment\'s own item in the bare slot: it takes its own record only', () => {
    expect(storePlatformRemovalKeys(writtenSkills(environment('env')), SKILL, ASK)).toEqual({ keys: [], platformOnly: true });
  });

  it('a platform read answers the platform\'s record only: never a package\'s, never the environment\'s own', () => {
    expect(readPlatformEntry(writtenSkills(shippedBy(ALPHA, 'alpha'), platform('platform')), SKILL, ASK)).toEqual({ found: true, data: platform('platform') });
    expect(readPlatformEntry(writtenSkills(shippedBy(ALPHA, 'alpha')), SKILL, ASK)).toEqual({ found: false });
    expect(readPlatformEntry(writtenSkills(environment('env')), SKILL, ASK)).toEqual({ found: false });
  });

  it('stamping and stripping copy: the caller\'s object is never changed, and an unstamped item passes through as the same object', () => {
    const body = environment('env');
    expect(withPlatformOrigin(body)).not.toBe(body);
    expect(body).toEqual(environment('env'));
    expect(withoutPlatformOrigin(body)).toBe(body);
    const stamped = platform('p');
    expect(withoutPlatformOrigin(stamped)).toEqual({ name: ASK, label: 'p' });
    expect(stamped._provenance).toBe('platform');
    const wrapped = { packageId: undefined, metadata: { name: ASK, _provenance: 'platform' } };
    expect(withoutPlatformOrigin(wrapped)).toEqual({ packageId: undefined, metadata: { name: ASK } });
  });
});
