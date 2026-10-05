// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — #21790: "a field reorder made in the object designer
// survives draft save -> publish -> reload", exercised end-to-end through the
// real HTTP + metadata stack on the showcase.
//
// `ObjectSchema.fields` is a name-keyed map whose traversal order the spec
// declares to BE the field order. The content hash sorted every map, so a pure
// reorder hashed equal to the published row, `SysMetadataRepository.put`'s
// no-op short-circuit read the publish as "unchanged", and the draft was
// drained — the publish answered success, the served object kept the old
// order, and the draft was gone. Reproduced on 17.6.0 and the 17.7
// pre-release.
//
// The second block is the upgrade half. Every object row written before the
// fix carries the ORDER-BLIND stamp, and that stamp is the version token its
// readers hold. It is accepted as written: an identical save must record no
// change, a receipt's token must still be honoured by `If-Match`, and a reorder
// INTO sorted order — whose current hash IS the stale stamp — must not be
// dropped.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { hashSpec } from '@objectstack/metadata-core';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const OBJ = 'dogfood_field_reorder';
const SYSTEM_CTX = { isSystem: true };

const FIELDS: Record<string, { type: string; label: string }> = {
  title: { type: 'text', label: 'Title' },
  amount: { type: 'number', label: 'Amount' },
  due: { type: 'date', label: 'Due' },
};
const DECLARED = ['title', 'amount', 'due']; // deliberately not sorted
const MOVED = ['due', 'title', 'amount']; // the designer drag
const SORTED = ['amount', 'due', 'title']; // the order the old hash sorted to

/** The designer's document, its `fields` in `order`. */
const objectBody = (order: readonly string[]) => ({
  name: OBJ,
  label: 'Field Reorder',
  // The runtime object door refuses an unauthored OWD at publish (#8310).
  sharingModel: 'private',
  fields: Object.fromEntries(order.map((k) => [k, FIELDS[k]])),
});

interface Row {
  id: string;
  metadata: string;
  checksum: string | null;
}
interface Ql {
  find(object: string, query: Record<string, unknown>): Promise<Row[]>;
  update(object: string, data: Record<string, unknown>, opts: Record<string, unknown>): Promise<unknown>;
}

describe('dogfood: an object designer field reorder publishes and reads back in the new order (#21790)', () => {
  let stack: VerifyStack;
  let token: string;
  let ql: Ql;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    token = await stack.signIn();
    ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Ql;
  }, 90_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** `GET /meta/object/:name` — the authored fields, in the order served. */
  const servedOrder = async (): Promise<string[]> => {
    const res = await stack.apiAs(token, 'GET', `/meta/object/${OBJ}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type?: string; name?: string; item?: { fields?: object } };
    expect(body).toMatchObject({ type: 'object', name: OBJ });
    // The registry may serve injected system columns beside the authored ones;
    // the order under test is the authored fields' relative order.
    return Object.keys(body.item?.fields ?? {}).filter((k) => k in FIELDS);
  };
  const saveDraft = (order: readonly string[]) =>
    stack.apiAs(token, 'PUT', `/meta/object/${OBJ}?mode=draft`, objectBody(order));
  const publish = () => stack.apiAs(token, 'POST', `/meta/object/${OBJ}/publish`, {});
  const activeRow = async (): Promise<Row> => {
    const rows = await ql.find('sys_metadata', {
      where: { type: 'object', name: OBJ, state: 'active' },
      context: SYSTEM_CTX,
    });
    expect(rows).toHaveLength(1);
    return rows[0]!;
  };
  const historyRows = async () =>
    (await ql.find('sys_metadata_history', { where: { type: 'object', name: OBJ }, context: SYSTEM_CTX })).length;

  describe('the designer round trip', () => {
    it('creates and publishes the object in its declared order', async () => {
      expect((await saveDraft(DECLARED)).status).toBe(200);
      expect((await publish()).status).toBe(200);
      expect(await servedOrder()).toEqual(DECLARED);
    });

    it('a pure reorder, saved as a draft and published, is served — and still served on reload', async () => {
      expect((await saveDraft(MOVED)).status).toBe(200);
      // The defect: this answered 200 and dropped the reorder.
      expect((await publish()).status).toBe(200);
      expect(await servedOrder()).toEqual(MOVED);
      // The designer's reload is a second read of the same door.
      expect(await servedOrder()).toEqual(MOVED);
      // …and the stored row holds it, not just a registry entry.
      const stored = JSON.parse((await activeRow()).metadata) as { fields: object };
      expect(Object.keys(stored.fields)).toEqual(MOVED);
    });
  });

  describe('an object row stamped before the fix (the order-blind stamp)', () => {
    let legacyStamp: string;
    let receipt: string;

    it('rewinds the stored stamp to the one the order-blind rule wrote', async () => {
      const row = await activeRow();
      const stored = JSON.parse(row.metadata) as Record<string, unknown>;
      legacyStamp = hashSpec(stored);
      // A real stale stamp: the current rule hashes these bytes differently.
      expect(row.checksum).toBe(hashSpec(stored, 'object'));
      expect(legacyStamp).not.toBe(row.checksum);
      await ql.update('sys_metadata', { id: row.id, checksum: legacyStamp }, { context: SYSTEM_CTX });
      expect((await activeRow()).checksum).toBe(legacyStamp);
      expect(await servedOrder()).toEqual(MOVED);
    });

    it('an identical save records no change and leaves the stamp as written', async () => {
      const before = await historyRows();
      const stored = JSON.parse((await activeRow()).metadata) as Record<string, unknown>;
      const res = await stack.apiAs(token, 'PUT', `/meta/object/${OBJ}`, stored);
      expect(res.status).toBe(200);
      receipt = ((await res.json()) as { version: string }).version;
      expect(typeof receipt).toBe('string');
      expect(await historyRows()).toBe(before);
      expect((await activeRow()).checksum).toBe(legacyStamp);
    });

    it('the receipt\'s token is honoured by If-Match, and a reorder into sorted order is published', async () => {
      // The trap: the stale stamp IS the sorted form's current hash.
      const stored = JSON.parse((await activeRow()).metadata) as { fields: Record<string, unknown> };
      const sorted = { ...stored, fields: Object.fromEntries(SORTED.map((k) => [k, stored.fields[k]])) };
      expect(hashSpec(sorted, 'object')).toBe(legacyStamp);

      const before = await historyRows();
      const res = await stack.api(`/meta/object/${OBJ}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'If-Match': `"${receipt}"`,
        },
        body: JSON.stringify(sorted),
      });
      expect(res.status).toBe(200);
      expect(await servedOrder()).toEqual(SORTED);
      expect(await historyRows()).toBe(before + 1);
      const written = JSON.parse((await activeRow()).metadata) as { fields: object };
      expect(Object.keys(written.fields)).toEqual(SORTED);
    });
  });
});
