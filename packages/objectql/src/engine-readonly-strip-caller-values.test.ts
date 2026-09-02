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

// ───────────────────────────────────────────────────────────────────────────
// #14088 — the SAME sentence failing a second time, one rung further along.
//
// #5591 (above) retired the key SET because it made the contract
// ("hook-written keys are NOT caller-supplied") true only BY ACCIDENT. Value
// equality is accidental in precisely the same way, and this is the accident:
// `Object.is(payload[k], supplied[k])` cannot separate *the hook deliberately
// wrote the value the caller also sent* from *the hook never touched the key*.
//
// Measured downstream (published 17.2.0, `duly_task`): a `readonly`
// `completed_at` stamped by a `beforeUpdate` hook on the transition INTO `done`
// and CLEARED on the transition out. Reopening works — until the caller ALSO
// sends `completed_at: null`, which is what a form round-trip of the whole
// record does. `Object.is(null, null)` is true, the hook's clear dies with the
// caller's null, and the row commits `status = in_progress` still carrying its
// OLD completion timestamp. No error. Nothing downstream can tell that row from
// one that really was completed — the corruption is the exact inverse of what a
// validation rule can express ("a completed task must carry a timestamp" has no
// purchase on a NON-completed task that carries one), so every on-time metric
// reading `completed_at` counts it.
//
// ⛔ THE FIX IS PROVENANCE, NOT A `null` CASE, and this suite is written to
// fail if anyone narrows it to one: the `0` case below collides identically,
// and so would `''`, `false` and a shared object reference. The strip now reads
// a RECORD of the keys the hook chain actually assigned
// (`recordHookPayloadWrites`, sealed at the engine's post-hook confluence).
//
// ⛔ AND IT IS NOT "STOP STRIPPING READONLY FIELDS". The discriminator pair is
// the point of this suite: the same payload (`completed_at: null` over a stored
// timestamp) must CLEAR when a hook wrote the null and must be STRIPPED when no
// hook did. Two opposite verdicts on byte-identical caller input — which is
// exactly what value equality cannot deliver and a record can.
describe('the strip reads hook-write PROVENANCE, not value equality (#14088)', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let warns: string[];
  /** The completion instant already ON the stored row — the value a lost clear leaves behind. */
  const STAMPED = '2026-08-01T09:00:00.000Z';

  const registerTransitionHook = (e: ObjectQL) => {
    // `duly_task`'s hook, reproduced: stamp on the way INTO `done`, clear on
    // the way out. The clear is the direction the card measured.
    e.registerHook('beforeUpdate', async (ctx: any) => {
      const next = ctx.input.data.status;
      if (next === undefined) return;
      const wasDone = ctx.previous?.status === 'done';
      if (next === 'done' && !wasDone) {
        ctx.input.data.completed_at = NOW;
        ctx.input.data.elapsed_minutes = 42;
      } else if (next !== 'done' && wasDone) {
        ctx.input.data.completed_at = null;
        ctx.input.data.elapsed_minutes = 0;
      }
    }, { object: 'duly_task', priority: 50 });
  };

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

    engine.registry.registerObject({
      name: 'duly_task',
      fields: {
        title: { type: 'text' },
        status: { type: 'text' },
        completed_at: { type: 'datetime', readonly: true },
        // The `0` twin of the same collision — proof the repair is provenance
        // and not a `null` sentinel.
        elapsed_minutes: { type: 'number', readonly: true },
      },
    } as any);

    // The kernel `previous` binder (`object: '*'`, priority 5), replicated —
    // a transition cannot be expressed in a hook without it.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (!ctx.previous && ctx.input?.id) {
        const priorQuery: EngineQueryOptionsParsed = { where: { id: ctx.input.id }, limit: 1 };
        ctx.previous = await engine.findOne(ctx.object, priorQuery);
      }
    }, { priority: 5 });
  });

  const task = (id: string) => storeFor('duly_task').get(id);
  const seedDone = (id: string) => storeFor('duly_task').set(id, {
    id, title: 'T', status: 'done', completed_at: STAMPED, elapsed_minutes: 42,
  });
  const seedOpen = (id: string) => storeFor('duly_task').set(id, {
    id, title: 'T', status: 'in_progress', completed_at: null, elapsed_minutes: null,
  });

  // ── The card's exact failure ──────────────────────────────────────────────

  it("THE REPORT: a reopen that also sends completed_at: null lands the hook's CLEAR", async () => {
    // The reported call, byte for byte: reopen a completed task while echoing
    // the field the form round-trips. Before the repair the row kept STAMPED
    // and nothing errored.
    registerTransitionHook(engine);
    seedDone('t_1');

    await engine.update('duly_task', {
      id: 't_1', title: 'T', status: 'in_progress', completed_at: null,
    });

    expect(task('t_1').status).toBe('in_progress');
    // The regression, stated as the value it must NOT be.
    expect(task('t_1').completed_at).not.toBe(STAMPED);
    expect(task('t_1').completed_at).toBeNull();
  });

  it('the same collision on `0` — so the repair cannot be a `null` sentinel', async () => {
    // `elapsed_minutes` is reset to 0 by the same hook while the caller also
    // sent 0. `Object.is(0, 0)` is true for exactly the reason
    // `Object.is(null, null)` is, and a fix that reads `null` specially leaves
    // this one corrupt. (`-0` is why the test uses a plain 0: `Object.is`
    // separates the two, and relying on that would be the same accident again.)
    registerTransitionHook(engine);
    seedDone('t_2');

    await engine.update('duly_task', {
      id: 't_2', status: 'in_progress', completed_at: null, elapsed_minutes: 0,
    });

    expect(task('t_2').elapsed_minutes).toBe(0);
    expect(task('t_2').completed_at).toBeNull();
  });

  // ── The STAMP direction — the card measures only the CLEAR ────────────────

  it('the STAMP direction is broken by the same mechanism, and is fixed with it', async () => {
    // The card measures the clear. The stamp collides identically whenever the
    // caller's echoed value happens to equal what the hook writes — the ordinary
    // way being a whole-record write-back of a value some other client already
    // stamped, or an idempotent retry of the very same request. Same verdict,
    // opposite direction: before the repair the hook's stamp was deleted and
    // the row committed `status = done` with `completed_at = null`.
    registerTransitionHook(engine);
    seedOpen('t_3');

    await engine.update('duly_task', {
      id: 't_3', title: 'T', status: 'done', completed_at: NOW, elapsed_minutes: 42,
    });

    expect(task('t_3').status).toBe('done');
    expect(task('t_3').completed_at).toBe(NOW);
    expect(task('t_3').elapsed_minutes).toBe(42);
  });

  // ── Both update branches, off the one record ──────────────────────────────

  it('the PREDICATE branch clears on the same terms (both call sites, one record)', async () => {
    // `stripReadonlyFields` runs on both update branches, so a repair that
    // reaches only the by-id one is a divergence, not a fix — the #3106 / #4441
    // shape. Both matched rows are already `done`, so the batch's single
    // payload is correct for every row it touches and this measures the strip
    // rather than the batch-hook question (#14099).
    registerTransitionHook(engine);
    seedDone('t_4');
    seedDone('t_5');

    await engine.update(
      'duly_task',
      { status: 'in_progress', completed_at: null },
      { where: { status: 'done' }, multi: true } as any,
    );

    expect(task('t_4').completed_at).toBeNull();
    expect(task('t_5').completed_at).toBeNull();
    expect(task('t_4').status).toBe('in_progress');
  });

  it('the PREDICATE branch stamps on the same terms', async () => {
    registerTransitionHook(engine);
    seedOpen('t_6');

    await engine.update(
      'duly_task',
      { status: 'done', completed_at: NOW },
      { where: { status: 'in_progress' }, multi: true } as any,
    );

    expect(task('t_6').completed_at).toBe(NOW);
  });

  // ── The discriminator: same payload, no hook write, OPPOSITE verdict ──────

  it('⛔ THE FORGERY FACE: the identical payload with NO hook write is still STRIPPED', async () => {
    // The one test that separates "provenance" from "stopped stripping". Byte
    // for byte the caller input of THE REPORT above — `completed_at: null` over
    // a stored timestamp — but no hook writes the key (no transition: the task
    // is already `in_progress`). Nobody authorised the clear, so the stored
    // timestamp must survive and the caller must be told.
    registerTransitionHook(engine);
    storeFor('duly_task').set('t_7', {
      id: 't_7', title: 'T', status: 'in_progress', completed_at: STAMPED, elapsed_minutes: 42,
    });

    await engine.update('duly_task', {
      id: 't_7', title: 'T2', status: 'in_progress', completed_at: null,
    });

    expect(task('t_7').title).toBe('T2');
    expect(task('t_7').completed_at).toBe(STAMPED);
    expect(warns.some((w) => w.includes("Field 'completed_at'"))).toBe(true);
  });

  it('⛔ a hook that runs but writes some OTHER key confers nothing on this one', async () => {
    // Provenance is per KEY, never "a hook ran on this write". A hook touching
    // `title` must not make a caller's forged `completed_at` hook-owned.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.title = 'rewritten-by-hook';
    }, { object: 'duly_task', priority: 50 });
    seedDone('t_8');

    await engine.update('duly_task', {
      id: 't_8', title: 'T', completed_at: '1999-01-01T00:00:00.000Z',
    });

    expect(task('t_8').title).toBe('rewritten-by-hook');
    expect(task('t_8').completed_at).toBe(STAMPED);
  });

  it('⛔ #2948 UNCHANGED: a plain forge with no hook at all is still stripped', async () => {
    seedDone('t_9');
    await engine.update('duly_task', {
      id: 't_9', completed_at: '1999-01-01T00:00:00.000Z',
    });
    expect(task('t_9').completed_at).toBe(STAMPED);
    expect(warns.some((w) => w.includes("Field 'completed_at'"))).toBe(true);
  });

  it('⛔ the PREDICATE branch strips a forge no hook wrote, too', async () => {
    registerTransitionHook(engine);
    storeFor('duly_task').set('t_10', {
      id: 't_10', title: 'T', status: 'archived', completed_at: STAMPED, elapsed_minutes: 42,
    });
    await engine.update(
      'duly_task',
      { title: 'T2', completed_at: null },
      { where: { status: 'archived' }, multi: true } as any,
    );
    expect(task('t_10').title).toBe('T2');
    expect(task('t_10').completed_at).toBe(STAMPED);
  });

  // ── The two "common paths" the card says are unaffected — negative controls ─

  it('NEGATIVE CONTROL: the bare { status } reopen is unaffected', async () => {
    // The card's own explanation for why this survived casual testing: the hook
    // ADDS the key, so it was never in the caller's snapshot and the old
    // key/value test already kept it. It must still be kept, and for a reason
    // the repair did not have to invent.
    registerTransitionHook(engine);
    seedDone('t_11');

    await engine.update('duly_task', { id: 't_11', status: 'in_progress' });

    expect(task('t_11').status).toBe('in_progress');
    expect(task('t_11').completed_at).toBeNull();
    expect(task('t_11').elapsed_minutes).toBe(0);
  });

  it('NEGATIVE CONTROL: a partial patch that touches no transition is unaffected', async () => {
    registerTransitionHook(engine);
    seedDone('t_12');

    await engine.update('duly_task', { id: 't_12', title: 'renamed' });

    expect(task('t_12').title).toBe('renamed');
    expect(task('t_12').status).toBe('done');
    expect(task('t_12').completed_at).toBe(STAMPED);
    expect(task('t_12').elapsed_minutes).toBe(42);
  });

  it('NEGATIVE CONTROL: an isSystem caller still bypasses the strip entirely', async () => {
    seedDone('t_13');
    await engine.update(
      'duly_task',
      { id: 't_13', completed_at: '1999-01-01T00:00:00.000Z' },
      { context: { isSystem: true } } as any,
    );
    expect(task('t_13').completed_at).toBe('1999-01-01T00:00:00.000Z');
  });

  // ── The observability seams move with the verdict, not against it ──────────

  it('a hook-written clear is NOT reported to onFieldsDropped', async () => {
    // `DroppedFieldsEvent` means "dropped, and the write completed WITHOUT
    // them" (#3407). The column IS written now — with the platform's null — so
    // reporting it would make the seam lie, exactly as #5591 argued for the
    // differing-value case one describe up.
    registerTransitionHook(engine);
    seedDone('t_14');
    const events: any[] = [];

    await engine.update(
      'duly_task',
      { id: 't_14', status: 'in_progress', completed_at: null },
      { onFieldsDropped: (e: any) => events.push(e) } as any,
    );

    expect(events).toEqual([]);
    expect(task('t_14').completed_at).toBeNull();
  });

  it('strictReadonlyWrites does not REFUSE a write whose only "drop" was a hook clear', async () => {
    // The loud half of the same seam (#5126). Before the repair this write was
    // refused outright for a field the caller never successfully wrote — the
    // strict caller's punishment for its own hook's clear.
    registerTransitionHook(engine);
    seedDone('t_15');

    await engine.update(
      'duly_task',
      { id: 't_15', status: 'in_progress', completed_at: null },
      { strictReadonlyWrites: true } as any,
    );

    expect(task('t_15').completed_at).toBeNull();
  });

  it('strictReadonlyWrites still REFUSES a real forge', async () => {
    registerTransitionHook(engine);
    seedDone('t_16');

    await expect(engine.update(
      'duly_task',
      { id: 't_16', completed_at: '1999-01-01T00:00:00.000Z' },
      { strictReadonlyWrites: true } as any,
    )).rejects.toThrow();
    expect(task('t_16').completed_at).toBe(STAMPED);
  });

  // ── The declared limit, pinned so nobody "fixes" it into an escalation ─────

  it('KNOWN LIMIT: a hook that REPLACES the payload leaves no record, and falls back', async () => {
    // `ctx.input.data = { …ctx.input.data, completed_at: null }` produces a
    // fresh object whose keys are indistinguishable from the caller's — because
    // most of them ARE the caller's, spread across. So there is no record for
    // this call and the pre-#14088 value test decides, i.e. the clear is still
    // lost here.
    //
    // Pinned as the FAIL-SAFE direction on purpose. The alternative — reading a
    // replacement's keys as hook-owned — would launder a caller's forged
    // `created_by` into a platform write on any object carrying such a hook.
    // Keeping the old over-strip is strictly better than opening the lock, and
    // this test exists so that trade is re-argued rather than quietly inverted.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      if (ctx.input.data.status !== 'done' && ctx.previous?.status === 'done') {
        ctx.input.data = { ...ctx.input.data, completed_at: null };
      }
    }, { object: 'duly_task', priority: 50 });
    seedDone('t_17');

    await engine.update('duly_task', {
      id: 't_17', status: 'in_progress', completed_at: null,
    });

    expect(task('t_17').status).toBe('in_progress');
    expect(task('t_17').completed_at).toBe(STAMPED);
  });

  it('...but a REPLACING hook still lands a key the caller did NOT send', async () => {
    // The fallback is the pre-#14088 behaviour in full, not a new hole: with no
    // record, a replaced payload is judged by the #5591 test, and a key absent
    // from the caller's snapshot is kept exactly as it always was.
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data = { ...ctx.input.data, completed_at: null };
    }, { object: 'duly_task', priority: 50 });
    seedDone('t_18');

    await engine.update('duly_task', { id: 't_18', status: 'in_progress' });

    expect(task('t_18').completed_at).toBeNull();
  });

  it('the recording is transparent to a hook reading its own payload', async () => {
    // Hooks read `ctx.input.data` for diagnostics (plugin-auth's identity write
    // guard NAMES the keys it found). The recording view must be indistinguishable
    // from the payload for every read shape a hook uses.
    const seen: any[] = [];
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      seen.push({
        keys: Object.keys(ctx.input.data),
        spread: { ...ctx.input.data },
        json: JSON.stringify(ctx.input.data),
        has: 'completed_at' in ctx.input.data,
        own: Object.prototype.hasOwnProperty.call(ctx.input.data, 'title'),
      });
    }, { object: 'duly_task', priority: 1 });
    seedDone('t_19');

    await engine.update('duly_task', { id: 't_19', title: 'T', completed_at: null });

    expect(seen).toHaveLength(1);
    expect(seen[0].keys).toEqual(['id', 'title', 'completed_at']);
    expect(seen[0].spread).toEqual({ id: 't_19', title: 'T', completed_at: null });
    expect(seen[0].json).toBe(JSON.stringify({ id: 't_19', title: 'T', completed_at: null }));
    expect(seen[0].has).toBe(true);
    expect(seen[0].own).toBe(true);
  });

  it('no recording view reaches the driver — the seal puts the RAW payload back', async () => {
    // A driver handed the recording view would be writing into a recorder the
    // engine has stopped reading, and on a driver that keeps the object it is
    // given, engine-internal machinery ends up on a row.
    //
    // A `Proxy` is invisible to `typeof` and `instanceof`, so the assertion has
    // to be IDENTITY against the caller's own object — the recorder's target.
    // The predicate branch is chosen deliberately: with no `id` key and nothing
    // stripped, every pass returns the SAME reference, so `updateMany` receives
    // `hookContext.input.data` verbatim and the identity is decisive rather
    // than laundered through one of the copies the by-id path makes.
    const seenByDriver: any[] = [];
    const d2 = makeDriver();
    const e2 = new ObjectQL({});
    const wrapped: any = {
      ...d2.driver,
      async updateMany(object: string, ast: any, data: Record<string, unknown>) {
        seenByDriver.push(data);
        return d2.driver.updateMany(object, ast, data, undefined as any);
      },
    };
    e2.registerDriver(wrapped, true);
    await e2.init();
    e2.registry.registerObject({
      name: 'duly_task',
      fields: {
        title: { type: 'text' }, status: { type: 'text' },
        completed_at: { type: 'datetime', readonly: true },
      },
    } as any);
    e2.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data.completed_at = NOW;
    }, { object: 'duly_task', priority: 50 });
    d2.storeFor('duly_task').set('t_20', { id: 't_20', title: 'T', status: 'open', completed_at: null });

    const payload: Record<string, unknown> = { status: 'done', completed_at: null };
    await e2.update('duly_task', payload as any, { where: { status: 'open' }, multi: true } as any);

    expect(seenByDriver).toHaveLength(1);
    expect(seenByDriver[0]).toBe(payload);
    expect(seenByDriver[0].completed_at).toBe(NOW);
    expect(d2.storeFor('duly_task').get('t_20').completed_at).toBe(NOW);
  });
});
