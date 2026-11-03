// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010] The owner-stamp judge, on its own: the verdict table of
 * `collection-item-owner-stamp.ts`'s header, row by row, and the two doors'
 * words. The doors that call it are pinned where they live: the build door in
 * `stack-collection-item-owner-stamp.test.ts`, the registration door in
 * `@objectstack/objectql`'s `collection-item-owner-stamp.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  judgeCollectionItemOwnerStamp,
  OWNER_STAMP_JUDGED_COLLECTIONS,
  type CollectionItemOwnerStampDoor,
} from './collection-item-owner-stamp';
import { PLURAL_TO_SINGULAR } from '../meta-spelling/manifest-collection-spelling';

const PKG = 'com.acme.crm';
const OTHER = 'com.acme.other';
const DOORS: CollectionItemOwnerStampDoor[] = ['build', 'register'];

const judge = (stamp: unknown, owner: string | undefined, door: CollectionItemOwnerStampDoor) =>
  judgeCollectionItemOwnerStamp(
    stamp === undefined ? { name: 'probe_conn' } : { name: 'probe_conn', _packageId: stamp },
    'connector',
    'probe_conn',
    owner,
    door,
  );

describe('[ADR-0010] judgeCollectionItemOwnerStamp: the verdict table', () => {
  it('an absent stamp is accepted, whatever the owner, at both doors', () => {
    for (const door of DOORS) {
      expect(judge(undefined, PKG, door)).toBeUndefined();
      expect(judge(undefined, undefined, door)).toBeUndefined();
    }
  });

  it('a stamp equal to the owner is accepted at both doors', () => {
    for (const door of DOORS) expect(judge(PKG, PKG, door)).toBeUndefined();
  });

  it('a foreign stamp, and `null` and `\'\'` under an owner, are refused at both doors', () => {
    for (const door of DOORS) {
      for (const stamp of [OTHER, null, '']) {
        const refusal = judge(stamp, PKG, door);
        expect(refusal, `${door} · ${JSON.stringify(stamp)}`).toMatchObject({ stamped: stamp, owner: PKG });
      }
    }
  });

  it('any stamp under no owner is refused at both doors', () => {
    for (const door of DOORS) {
      for (const stamp of [OTHER, PKG, null, '']) {
        expect(judge(stamp, undefined, door), `${door} · ${JSON.stringify(stamp)}`).toMatchObject({ owner: undefined });
      }
    }
  });

  it('a non-object item is not judged', () => {
    for (const item of [undefined, null, 'probe', 42]) {
      expect(judgeCollectionItemOwnerStamp(item, 'connector', 'probe_conn', PKG, 'build')).toBeUndefined();
    }
  });
});

describe('[ADR-0010] judgeCollectionItemOwnerStamp: the words', () => {
  it('both doors prescribe first and name both values; only the clause naming the owner differs', () => {
    const register = judge(OTHER, PKG, 'register')!;
    const build = judge(OTHER, PKG, 'build')!;
    for (const refusal of [register, build]) {
      expect(refusal.message.indexOf("Drop `_packageId` from connector 'probe_conn': it carries _packageId \"com.acme.other\", but ")).toBe(0);
      expect(refusal.message.endsWith('; a body never names its own owner.')).toBe(true);
      expect(refusal.message).toContain(refusal.issueMessage);
    }
    expect(register.issueMessage).toBe(`carries _packageId "${OTHER}", but it is registered under package '${PKG}'`);
    expect(build.issueMessage).toBe(`carries _packageId "${OTHER}", but this stack ships it from package '${PKG}'`);
    expect(register.message.replace(register.issueMessage, '')).toBe(build.message.replace(build.issueMessage, ''));
  });

  it('no owner reads as no package, and the build door names the missing `manifest`', () => {
    expect(judge(OTHER, undefined, 'register')!.issueMessage).toBe(`carries _packageId "${OTHER}", but it is registered under no package`);
    expect(judge(OTHER, undefined, 'build')!.issueMessage)
      .toBe(`carries _packageId "${OTHER}", but this stack ships it from no package (the stack declares no \`manifest\`)`);
  });
});

describe('[ADR-0010] OWNER_STAMP_JUDGED_COLLECTIONS', () => {
  it('names each collection once, and every one but the seed `data` folds to a registry type', () => {
    expect(new Set(OWNER_STAMP_JUDGED_COLLECTIONS).size).toBe(OWNER_STAMP_JUDGED_COLLECTIONS.length);
    for (const key of OWNER_STAMP_JUDGED_COLLECTIONS) {
      if (key === 'data') continue;
      expect(Object.prototype.hasOwnProperty.call(PLURAL_TO_SINGULAR, key), key).toBe(true);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(OWNER_STAMP_JUDGED_COLLECTIONS)).toBe(true);
  });
});
