// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5591 — the static `readonly` strip on the UPDATE path must delete the value
// the CALLER SUBMITTED, never whatever value happens to sit on the key at the
// moment the strip runs.
//
// The strip executes AFTER `beforeUpdate`, so those two are different facts the
// instant a hook writes to a read-only column. The guard used to be a key SET
// snapshotted at engine entry, which can answer only "did the caller name this
// key?" — so `delete data[name]` took the hook's value with it whenever the
// caller's payload happened to carry the same key.
//
// The measured downstream shape (objectstack#5591, from hotcrm#788, reproduced
// below verbatim): "read the whole record → change one field → write the whole
// record back" is an ordinary REST/integration idiom, and a whole-record
// write-back necessarily echoes the read-only columns it just read. A publish
// hook stamped `published_at` on the draft→published transition; the strip then
// deleted the stamp because `published_at` was in the caller's payload. The row
// committed as `status = "published"` with `published_at = null` — a state every
// view that sorts or filters by `published_at` is undefined on. The console UI
// never triggered it because its forms do not submit read-only fields.
//
// The asymmetry that proves it was never deliberate is in ONE write: the same
// hook also stamped `last_reviewed_at`, an equally read-only column the caller
// had NOT echoed — and that one landed. Two hook-derived writes in one
// transaction, one alive and one dead, decided by nothing but whether the
// caller's payload carried a same-named key.
//
// What this suite is NOT: a relaxation of #2948 / #3003 / #3015. A
// caller-supplied read-only value that no hook overwrote is still stripped, and
// the case is pinned here next to the fix so the two verdicts are read together.

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineQueryOptionsParsed } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const NOW = '2026-08-05T10:00:00.000Z';

describe('update strip acts on CALLER-submitted values (#5591)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();

    // The downstream object, trimmed to the fields the report turns on.
    engine.registry.registerObject({
      name: 'crm_knowledge_article',
      fields: {
        title: { type: 'text' },
        status: { type: 'text' },
        published_at: { type: 'datetime', readonly: true },
        last_reviewed_at: { type: 'datetime', readonly: true },
      },
    } as any);
    storeFor('crm_knowledge_article').set('ka_1', {
      id: 'ka_1', title: 'A', status: 'draft', published_at: null, last_reviewed_at: null,
    });

    // `sys_fetch_previous_update` (the kernel builtin, `object: '*'`,
    // priority 5) replicated: it binds `previous` before any authored
    // before-hook runs, which is how a transition is expressed in one.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (!ctx.previous && ctx.input?.id) {
        // Typed, not `as any`: the #4918 ratchet counts an erased engine
        // query-options bag even in test code.
        const priorQuery: EngineQueryOptionsParsed = { where: { id: ctx.input.id }, limit: 1 };
        ctx.previous = await engine.findOne(ctx.object, priorQuery);
      }
    }, { priority: 5 });

    // `knowledge_article_publish_timestamps`: stamp both read-only columns on
    // the draft→published transition.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (ctx.input.data.status === 'published' && ctx.previous?.status !== 'published') {
        ctx.input.data.published_at = NOW;
        ctx.input.data.last_reviewed_at = NOW;
      }
    }, { object: 'crm_knowledge_article', priority: 50 });
  });

  const ka = (id = 'ka_1') => storeFor('crm_knowledge_article').get(id);

  it('THE REPORT: a whole-record write-back lands the hook stamp, not null', async () => {
    // Exactly the reported call: the caller read the record, flipped `status`,
    // and PUT everything back — `published_at: null` included, because that is
    // what it had just read. Non-system context.
    await engine.update('crm_knowledge_article', {
      id: 'ka_1', title: 'A', status: 'published',
      published_at: null, last_reviewed_at: null,
    });

    expect(ka().status).toBe('published');
    // The regression, stated as the value it must NOT be.
    expect(ka().published_at).not.toBeNull();
    expect(ka().published_at).toBe(NOW);
    // ...and the field that always worked still works, so the fix closed the
    // asymmetry rather than inverting it.
    expect(ka().last_reviewed_at).toBe(NOW);
  });

  it('the two read-only columns of one write now agree (the asymmetry is gone)', async () => {
    // The proof the old behaviour was accidental: echo ONE of the two keys and
    // watch only that one die. After the fix both stamps land either way.
    await engine.update('crm_knowledge_article', {
      id: 'ka_1', status: 'published', published_at: null, // last_reviewed_at NOT echoed
    });
    expect(ka().published_at).toBe(ka().last_reviewed_at);
    expect(ka().published_at).toBe(NOW);
  });

  it('#2948 UNCHANGED: an explicit forge with no hook overwrite is still stripped', async () => {
    // No transition, so the publish hook does not fire and nothing overwrites
    // the key — the caller's value is the value on the key, and it goes.
    await engine.update('crm_knowledge_article', {
      id: 'ka_1', title: 'B', published_at: '1999-01-01T00:00:00.000Z',
    });
    expect(ka().title).toBe('B');
    expect(ka().published_at).toBeNull();
    expect(warns.some((w) => w.includes("Field 'published_at'") && w.includes('COMMITTED WITHOUT IT'))).toBe(true);
  });

  it('#2948 UNCHANGED: a forge on a field the hook stamps but for a DIFFERENT record state', async () => {
    // The article is already published, so the transition guard is false and
    // the hook writes nothing. A caller forging `published_at` in that state
    // gets it stripped — the hook's existence is not a blanket exemption for
    // the column, only for the writes it actually makes.
    storeFor('crm_knowledge_article').set('ka_2', {
      id: 'ka_2', title: 'B', status: 'published', published_at: NOW, last_reviewed_at: NOW,
    });
    await engine.update('crm_knowledge_article', {
      id: 'ka_2', status: 'published', published_at: '1999-01-01T00:00:00.000Z',
    });
    expect(ka('ka_2').published_at).toBe(NOW);
  });

  it('#4903 CONTROL still holds: a read-only key the hook ADDS lands', async () => {
    // The control face the report names. It passed before the fix and must
    // keep passing — the fix makes the overwrite case agree with it, and is
    // worthless if it moved this one.
    await engine.update('crm_knowledge_article', { id: 'ka_1', status: 'published' });
    expect(ka().published_at).toBe(NOW);
    expect(ka().last_reviewed_at).toBe(NOW);
  });

  it('the BULK path is fixed on the same terms', async () => {
    // `stripReadonlyFields` runs on both update branches off one snapshot, so
    // the predicate write must not need its own fix — pinned, because "both
    // call sites" is exactly the #3106 / #4441 shape that gets missed.
    storeFor('crm_knowledge_article').set('ka_3', {
      id: 'ka_3', title: 'C', status: 'draft', published_at: null, last_reviewed_at: null,
    });
    await engine.update(
      'crm_knowledge_article',
      { status: 'published', published_at: null },
      { where: { status: 'draft' }, multi: true } as any,
    );
    expect(ka('ka_3').status).toBe('published');
    expect(ka('ka_3').published_at).toBe(NOW);
  });

  it('the BULK path still strips a forge no hook overwrote', async () => {
    storeFor('crm_knowledge_article').set('ka_4', {
      id: 'ka_4', title: 'D', status: 'archived', published_at: null, last_reviewed_at: null,
    });
    await engine.update(
      'crm_knowledge_article',
      { title: 'D2', published_at: '1999-01-01T00:00:00.000Z' },
      { where: { status: 'archived' }, multi: true } as any,
    );
    expect(ka('ka_4').title).toBe('D2');
    expect(ka('ka_4').published_at).toBeNull();
  });

  it('a hook-overwritten key is NOT reported as dropped to onFieldsDropped', async () => {
    // `DroppedFieldsEvent` is contracted as "dropped, and the write completed
    // WITHOUT them" (#3407). After the fix the column IS written — with the
    // platform's value — so reporting it as dropped would make the observability
    // seam lie. The forge case below proves the listener still fires when a
    // value really is discarded.
    const events: any[] = [];
    await engine.update(
      'crm_knowledge_article',
      { id: 'ka_1', status: 'published', published_at: null },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([]);
    expect(ka().published_at).toBe(NOW);
  });

  it('onFieldsDropped still fires for a value that really is discarded', async () => {
    const events: any[] = [];
    await engine.update(
      'crm_knowledge_article',
      { id: 'ka_1', title: 'B', published_at: '1999-01-01T00:00:00.000Z' },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );
    expect(events).toEqual([
      { object: 'crm_knowledge_article', fields: ['published_at'], reason: 'readonly' },
    ]);
  });

  it('strictReadonlyWrites refuses the forge and admits the hook write', async () => {
    // #5126 refuses a write rather than committing it without the stripped
    // columns. A hook-overwritten key is not stripped, so there is nothing to
    // refuse — the strict caller's contract is about columns that would be
    // MISSING, and none are.
    await expect(engine.update(
      'crm_knowledge_article',
      { id: 'ka_1', title: 'B', published_at: '1999-01-01T00:00:00.000Z' },
      { strictReadonlyWrites: true } as any,
    )).rejects.toThrow();

    await engine.update(
      'crm_knowledge_article',
      { id: 'ka_1', status: 'published', published_at: null },
      { strictReadonlyWrites: true } as any,
    );
    expect(ka().published_at).toBe(NOW);
  });

  it('a hook that reads the caller-submitted read-only value can still SEE it', async () => {
    // Why the fix compares values instead of stripping before the hooks: a
    // `beforeUpdate` guard that rejects or reports on what the caller
    // submitted (plugin-auth's ADR-0092 identity write guard is the in-repo
    // instance — its error text NAMES the non-whitelisted keys it found) reads
    // `ctx.input.data`. Stripping ahead of the hooks would empty that out and
    // silently degrade every such diagnostic, so the caller's payload still
    // reaches the hooks unchanged.
    const seen: unknown[] = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      seen.push(Object.keys(ctx.input.data));
    }, { object: 'crm_knowledge_article', priority: 1 });

    await engine.update('crm_knowledge_article', {
      id: 'ka_1', title: 'B', published_at: '1999-01-01T00:00:00.000Z',
    });
    expect(seen).toEqual([['id', 'title', 'published_at']]);
  });

  it('an isSystem caller is untouched by any of this', async () => {
    await engine.update(
      'crm_knowledge_article',
      { id: 'ka_1', published_at: '1999-01-01T00:00:00.000Z' },
      { context: { isSystem: true } } as any,
    );
    expect(ka().published_at).toBe('1999-01-01T00:00:00.000Z');
  });

  it('INSERT is unaffected — a caller-seeded runtime-owned field still goes', async () => {
    // The insert path keeps its own, narrower strip (`stripRuntimeOwnedFields`,
    // #5503) and its own snapshot; #5591 did not touch either. Pinned as a
    // regression boundary, not as a claim about insert semantics.
    engine.registry.registerObject({
      name: 'crm_case', fields: { title: { type: 'text' }, case_number: { type: 'autonumber' } },
    } as any);
    const row: any = await engine.insert('crm_case', { title: 'x', case_number: 'FORGED-9' });
    expect(row.case_number).not.toBe('FORGED-9');
  });
});
