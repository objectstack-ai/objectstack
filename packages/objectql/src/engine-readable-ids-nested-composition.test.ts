// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D6, as amended — the nested master chain] A `ReadableIds` leaf
 * that sits INSIDE a composed scope — the scope `getReadFilter(P)` answers for
 * a parent whose own read scope is derived from ITS master — is composed by
 * the engine too, before the leaf that encloses it, with the same caller
 * context at every level. The driver receives one composed leaf whose scope
 * holds composed leaves, never an uncomposed leaf (which it would refuse, D3).
 *
 * What is pinned, against the recording driver (this package's witness shape):
 *
 * - the composed chain itself: each read verb hands its driver ONE call; the
 *   outer leaf's scope is the service's answer rewritten copy-on-write, its
 *   nested `$in` a composed leaf whose scope is the service's answer for the
 *   grandparent by reference, marked `'policy'`; each parent is asked once per
 *   read, outermost first, every half with the caller's context as it stands
 *   (a delegated context included);
 * - the closed doors at the nested level — `canReadObject` false, the deny
 *   sentinel, a throw on either half, a parent the registry does not hold —
 *   answer `$in: []` INSIDE the composed scope, the outer leaf still composed;
 * - D5's two classes at the nested level (a middleware-gated or federated
 *   grandparent) refuse by name — code and status — with no driver call;
 * - a nested leaf outside a `$in` comparand, and a composed leaf the engine
 *   did not compose inside a scope, are refused by the same walk;
 * - a chain that returns to a parent on its branch (a cycle), and one deeper
 *   than the bound, are refused by name, not composed partway;
 * - a parent that appears at two levels is asked once, and its composed scope
 *   is reused by reference.
 *
 * Evaluating the composed chain — one statement, the subqueries nested — is
 * measured on the real stack in `@objectstack/plugin-security`
 * (`readable-ids-nested-compose.test.ts`).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReadableIds,
  RLS_DENY_FILTER,
  isComposedReadableIds,
  filterSubtreeProvenanceOf,
} from '@objectstack/spec/data';
import { ObjectQL, SECURITY_SERVICE_SOURCE_SLOT } from './engine.js';

interface SeenCall { verb: string; object: string; ast: any }

/** Put a security-service source in the engine's slot, as `ObjectQLPlugin.init` does. */
function wire(engine: ObjectQL, source: unknown): void {
  (engine as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = source;
}

function makeRecordingDriver(name = 'recording', supports: Record<string, unknown> = {}) {
  const calls: SeenCall[] = [];
  const driver: any = {
    name, version: '0.0.0', supports,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { calls.push({ verb: 'find', object, ast }); return []; },
    async findOne(object: string, ast: any) { calls.push({ verb: 'findOne', object, ast }); return null; },
    async count(object: string, ast: any) { calls.push({ verb: 'count', object, ast }); return 0; },
    async aggregate(object: string, ast: any) { calls.push({ verb: 'aggregate', object, ast }); return []; },
    async create(object: string, data: Record<string, unknown>) { calls.push({ verb: 'create', object, ast: data }); return data; },
    async update(object: string, _id: string, data: Record<string, unknown>) { calls.push({ verb: 'update', object, ast: data }); return data; },
    async updateMany(object: string, ast: any) { calls.push({ verb: 'updateMany', object, ast }); return 0; },
    async delete(object: string) { calls.push({ verb: 'delete', object, ast: null }); return true; },
    async deleteMany(object: string, ast: any) { calls.push({ verb: 'deleteMany', object, ast }); return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

/** The chain: child → parent (by `record_id`) → grand (by the parent's `grand`). */
const CHILD = {
  name: 'rid_child',
  label: 'ReadableIds child',
  fields: {
    object_name: { name: 'object_name', type: 'text' },
    record_id: { name: 'record_id', type: 'text' },
    note: { name: 'note', type: 'text' },
  },
};
const PARENT = { name: 'rid_parent', label: 'Parent', fields: { title: { name: 'title', type: 'text' }, grand: { name: 'grand', type: 'text' } } };
const GRAND = { name: 'rid_grand', label: 'Grandparent', fields: { owner: { name: 'owner', type: 'text' } } };
const OTHER = { name: 'rid_other', label: 'Other parent', fields: { title: { name: 'title', type: 'text' } } };
const GATED = { name: 'rid_gated', label: 'Middleware-gated grandparent', fields: { title: { name: 'title', type: 'text' } } };
const FAR = { name: 'rid_far', label: 'Federated grandparent', datasource: 'far', fields: { title: { name: 'title', type: 'text' } } };

type Thrown = (Error & { code?: string; status?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });
const REFUSED = { code: 'INTERNAL_ERROR', status: 500 };

const branch = (object = 'rid_parent') => ({ object_name: object, record_id: { $in: ReadableIds.of(object) } });
/** The scope a `controlled_by_parent` parent's read is derived from: a leaf over its master. */
const derivedFrom = (master: string) => ({ grand: { $in: ReadableIds.of(master) } });
const COUNT_AGG = [{ function: 'count', alias: 'n' }];

/** A security service double answering per object, recording which half it was asked and with which context. */
function makeSecurity(opts: {
  canRead?: (object: string, context?: unknown) => boolean | Promise<boolean>;
  scope?: (object: string, context?: unknown) => unknown;
} = {}) {
  const asked: string[] = [];
  const contexts: Array<{ half: string; object: string; context: unknown }> = [];
  const svc: any = {
    async canReadObject(object: string, context?: unknown) {
      asked.push(`canReadObject:${object}`);
      contexts.push({ half: 'canReadObject', object, context });
      return opts.canRead ? opts.canRead(object, context) : true;
    },
    async getReadFilter(object: string, context?: unknown) {
      asked.push(`getReadFilter:${object}`);
      contexts.push({ half: 'getReadFilter', object, context });
      return opts.scope ? opts.scope(object, context) : undefined;
    },
  };
  return { svc, asked, contexts };
}

/** The `$in` comparand the driver received at `where.record_id`, under any `$and` the chain wrapped around it. */
function inComparandOf(where: any): unknown {
  if (where?.record_id) return where.record_id.$in;
  for (const arm of where?.$and ?? []) {
    const found = inComparandOf(arm);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe('[ADR-0139 D6 as amended] a leaf inside a composed scope is composed too — the nested master chain', () => {
  let engine: ObjectQL;
  let calls: SeenCall[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    const farRec = makeRecordingDriver('far');
    calls = rec.calls;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    engine.registerDriver(farRec.driver);
    await engine.init();
    for (const def of [CHILD, PARENT, GRAND, OTHER, GATED, FAR]) engine.registry.registerObject(def as any, 'test');
    engine.registerMiddleware(async (_ctx, next) => next(), { object: 'rid_gated' });
    calls.length = 0;
  });

  // The context value is the cast, never the options object: the
  // query-options-erasure ratchet counts an erased options argument.
  const readVerbs = (where: Record<string, unknown>, context?: unknown) => [
    ['find', () => engine.find('rid_child', { where, context: context as any })],
    ['findOne', () => engine.findOne('rid_child', { where, context: context as any })],
    ['count', () => engine.count('rid_child', { where, context: context as any })],
    ['aggregate', () => engine.aggregate('rid_child', { where, aggregations: COUNT_AGG as any, context: context as any })],
  ] as const;

  /** The service of a two-level chain: the parent's scope carries a leaf over the grandparent, whose scope is plain. */
  const chainSecurity = (grandScope: unknown = { owner: 'u1' }) => makeSecurity({
    scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : object === 'rid_grand' ? grandScope : undefined),
  });

  it('each read verb hands its driver ONE call whose composed leaf carries a composed leaf: the chain asked outermost first, each parent once, both halves with the caller context as it stands', async () => {
    const grandScope = { owner: 'u1' };
    const context = { userId: 'u1', principalKind: 'human' };
    const { svc, asked, contexts } = chainSecurity(grandScope);
    wire(engine, () => svc);
    for (const [verb, run] of readVerbs(branch(), context)) {
      calls.length = 0;
      asked.length = 0;
      contexts.length = 0;
      await run();
      expect(calls.map((c) => c.verb), verb).toEqual([verb]);
      expect(asked, verb).toEqual([
        'canReadObject:rid_parent', 'getReadFilter:rid_parent',
        'canReadObject:rid_grand', 'getReadFilter:rid_grand',
      ]);
      // One context for the whole chain: every half at every level received
      // the same object the outer level did, and it is the caller's.
      expect((contexts[0].context as any).userId, verb).toBe('u1');
      for (const seen of contexts) expect(seen.context, `${verb}: ${seen.half}(${seen.object})`).toBe(contexts[0].context);
      const outer = inComparandOf(calls[0].ast.where) as any;
      expect(isComposedReadableIds(outer), verb).toBe(true);
      expect(outer.object, verb).toBe('rid_parent');
      // The outer scope is the parent's answer rewritten copy-on-write: its
      // nested `$in` is the composed leaf over the grandparent, whose scope is
      // the grandparent's answer BY REFERENCE, marked policy — and the
      // rewritten scope keeps the mark the parent's answer was given.
      const nested = outer.scope.grand.$in;
      expect(isComposedReadableIds(nested), verb).toBe(true);
      expect(nested.object, verb).toBe('rid_grand');
      expect(nested.scope, verb).toBe(grandScope);
      expect(filterSubtreeProvenanceOf(outer.scope), verb).toBe('policy');
      expect(filterSubtreeProvenanceOf(nested.scope), verb).toBe('policy');
    }
  });

  it('a delegated (on-behalf-of) caller: every level is asked with the delegated context as it stands, onBehalfOf intact', async () => {
    const delegated = { userId: 'usr_owner', principalKind: 'agent', onBehalfOf: { userId: 'usr_owner', principalKind: 'human' } };
    const { svc, contexts } = chainSecurity();
    wire(engine, () => svc);
    await engine.find('rid_child', { where: branch(), context: delegated as any });
    expect(contexts.map((c) => `${c.half}:${c.object}`)).toEqual([
      'canReadObject:rid_parent', 'getReadFilter:rid_parent', 'canReadObject:rid_grand', 'getReadFilter:rid_grand',
    ]);
    for (const seen of contexts) {
      expect((seen.context as any).onBehalfOf, `${seen.half}(${seen.object})`).toEqual(delegated.onBehalfOf);
      expect((seen.context as any).userId, `${seen.half}(${seen.object})`).toBe('usr_owner');
      expect((seen.context as any).principalKind, `${seen.half}(${seen.object})`).toBe('agent');
    }
    const outer = inComparandOf(calls[0].ast.where) as any;
    expect(isComposedReadableIds(outer.scope.grand.$in)).toBe(true);
  });

  it("the grandparent's scope undefined ⇒ the nested leaf composes with no row restriction; the outer leaf's scope is still the rewritten copy", async () => {
    const { svc } = makeSecurity({ scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : undefined) });
    wire(engine, () => svc);
    await engine.find('rid_child', { where: branch() });
    const outer = inComparandOf(calls[0].ast.where) as any;
    const nested = outer.scope.grand.$in;
    expect(isComposedReadableIds(nested)).toBe(true);
    expect(nested.scope).toBeUndefined();
  });

  it('a leaf written by an object-scoped middleware on the child composes the same chain', async () => {
    const { svc, asked } = chainSecurity();
    wire(engine, () => svc);
    engine.registerMiddleware(async (ctx, next) => {
      if (ctx.ast && ['find', 'findOne', 'count', 'aggregate'].includes(ctx.operation)) {
        ctx.ast.where = ctx.ast.where ? { $and: [ctx.ast.where, branch()] } : branch();
      }
      await next();
    }, { object: 'rid_child' });
    await engine.count('rid_child', { where: { note: 'x' } });
    expect(asked).toEqual([
      'canReadObject:rid_parent', 'getReadFilter:rid_parent', 'canReadObject:rid_grand', 'getReadFilter:rid_grand',
    ]);
    const outer = inComparandOf(calls[0].ast.where) as any;
    expect(isComposedReadableIds(outer.scope.grand.$in)).toBe(true);
  });

  it('the closed doors at the nested level answer $in: [] INSIDE the composed scope — the outer leaf still composed, no row of the parent whose master is unreadable', async () => {
    const doors: ReadonlyArray<readonly [string, ReturnType<typeof makeSecurity>]> = [
      ['canReadObject(grand) false', makeSecurity({
        canRead: (object) => object !== 'rid_grand',
        scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : { owner: 'u1' }),
      })],
      ['the deny sentinel for grand, by identity', makeSecurity({
        scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : RLS_DENY_FILTER),
      })],
      ['canReadObject throws for grand', makeSecurity({
        canRead: (object) => { if (object === 'rid_grand') throw new Error('canReadObject is down'); return true; },
        scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : { owner: 'u1' }),
      })],
      ['getReadFilter throws for grand', makeSecurity({
        scope: (object) => { if (object === 'rid_grand') throw new Error('getReadFilter is down'); return derivedFrom('rid_grand'); },
      })],
      ['a grandparent the registry does not hold', makeSecurity({
        scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_unregistered') : { owner: 'u1' }),
      })],
    ];
    for (const [label, { svc, asked }] of doors) {
      wire(engine, () => svc);
      for (const [verb, run] of readVerbs(branch())) {
        calls.length = 0;
        asked.length = 0;
        await run();
        expect(calls.map((c) => c.verb), `${label}: ${verb}`).toEqual([verb]);
        const outer = inComparandOf(calls[0].ast.where) as any;
        expect(isComposedReadableIds(outer), `${label}: ${verb}`).toBe(true);
        expect(Object.keys(outer.scope), `${label}: ${verb}`).toEqual(['grand']);
        expect(outer.scope.grand.$in, `${label}: ${verb}`).toEqual([]);
        if (label === 'a grandparent the registry does not hold') {
          expect(asked, `${label}: ${verb}`).toEqual(['canReadObject:rid_parent', 'getReadFilter:rid_parent']);
        }
      }
    }
  });

  it("the parent's own door closed ⇒ $in: [] at the outer level, and the grandparent is never asked", async () => {
    const { svc, asked } = makeSecurity({
      canRead: (object) => object !== 'rid_parent',
      scope: (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : { owner: 'u1' }),
    });
    wire(engine, () => svc);
    await engine.find('rid_child', { where: branch() });
    expect(inComparandOf(calls[0].ast.where)).toEqual([]);
    expect(asked).toEqual(['canReadObject:rid_parent']);
  });

  it('D5.2 and D5.3 at the nested level refuse by name — code and status, no driver call, the grandparent unasked', async () => {
    for (const [grand, fragment] of [
      ['rid_gated', "'rid_gated', whose rows an object-scoped read middleware narrows"],
      ['rid_far', "'rid_far', which is bound to datasource 'far'"],
    ] as const) {
      const { svc, asked } = makeSecurity({ scope: (object) => (object === 'rid_parent' ? derivedFrom(grand) : undefined) });
      wire(engine, () => svc);
      calls.length = 0;
      for (const [verb, run] of readVerbs(branch())) {
        asked.length = 0;
        const err = await refusalOf(run());
        expect(envelopeOf(err), `${grand}: ${verb}`).toEqual(REFUSED);
        expect(err!.message, `${grand}: ${verb}`).toContain(`${verb}('rid_child'): where.record_id.$in.scope.grand.$in holds a ReadableIds leaf`);
        expect(err!.message, `${grand}: ${verb}`).toContain(fragment);
        expect(asked, `${grand}: ${verb}`).toEqual(['canReadObject:rid_parent', 'getReadFilter:rid_parent']);
      }
      expect(calls, grand).toHaveLength(0);
    }
  });

  it('inside a scope, a leaf outside a $in comparand and a composed leaf the engine did not compose are refused by name', async () => {
    const shapes: ReadonlyArray<readonly [string, unknown, string]> = [
      ['implicit equality', { grand: ReadableIds.of('rid_grand') }, 'where.record_id.$in.scope.grand holds a ReadableIds leaf'],
      ['a $nin comparand', { grand: { $nin: ReadableIds.of('rid_grand') } }, 'where.record_id.$in.scope.grand.$nin holds a ReadableIds leaf'],
      ['a list member', { grand: { $in: ['g1', ReadableIds.of('rid_grand')] } }, 'where.record_id.$in.scope.grand.$in[1] holds a ReadableIds leaf'],
      ['a forged composed leaf', { grand: { $in: ReadableIds.compose(ReadableIds.of('rid_grand'), undefined) } }, 'where.record_id.$in.scope.grand.$in holds a COMPOSED ReadableIds leaf'],
    ];
    for (const [label, parentScope, fragment] of shapes) {
      const { svc } = makeSecurity({ scope: (object) => (object === 'rid_parent' ? parentScope : undefined) });
      wire(engine, () => svc);
      calls.length = 0;
      const err = await refusalOf(engine.find('rid_child', { where: branch() }));
      expect(envelopeOf(err), label).toEqual(REFUSED);
      expect(err!.message, label).toContain(fragment);
      expect(calls, label).toHaveLength(0);
    }
  });

  it('a chain that returns to a parent on its branch is refused by name — a cycle, not composed partway', async () => {
    const cycles: ReadonlyArray<readonly [string, (object: string) => unknown, string]> = [
      ['parent → grand → parent', (object) => (object === 'rid_parent' ? derivedFrom('rid_grand') : object === 'rid_grand' ? { grand: { $in: ReadableIds.of('rid_parent') } } : undefined),
        "rid_child -> rid_parent -> rid_grand -> rid_parent returns to 'rid_parent', a cycle"],
      ['parent → parent', (object) => (object === 'rid_parent' ? derivedFrom('rid_parent') : undefined),
        "rid_child -> rid_parent -> rid_parent returns to 'rid_parent', a cycle"],
    ];
    for (const [label, scope, fragment] of cycles) {
      const { svc } = makeSecurity({ scope });
      wire(engine, () => svc);
      calls.length = 0;
      const err = await refusalOf(engine.find('rid_child', { where: branch() }));
      expect(envelopeOf(err), label).toEqual(REFUSED);
      expect(err!.message, label).toContain(fragment);
      expect(calls, label).toHaveLength(0);
    }
  });

  it('a chain deeper than the bound is refused by name; one at the bound composes whole', async () => {
    // rid_l0 … rid_l8: each level's scope is a leaf over the next. The scope
    // composed for rid_lk is the chain's scope number k + 1; the engine
    // composes a chain at most 8 scopes deep, so a chain ending at rid_l7
    // composes whole (eight scopes) and one reaching rid_l8 is refused — the
    // same cut as plugin-security's controlled_by_parent derivation: a detail
    // with seven derived masters above it resolves, an eighth is refused.
    const levels = Array.from({ length: 9 }, (_, k) => `rid_l${k}`);
    for (const name of levels) engine.registry.registerObject({ name, label: name, fields: { next: { name: 'next', type: 'text' } } } as any, 'test');
    const chainTo = (last: number) => makeSecurity({
      scope: (object) => {
        const k = levels.indexOf(object);
        return k >= 0 && k < last ? { next: { $in: ReadableIds.of(levels[k + 1]) } } : undefined;
      },
    });
    const whole = chainTo(7);
    wire(engine, () => whole.svc);
    await engine.find('rid_child', { where: { record_id: { $in: ReadableIds.of('rid_l0') } } });
    expect(whole.asked.filter((a) => a.startsWith('getReadFilter:'))).toEqual(levels.slice(0, 8).map((l) => `getReadFilter:${l}`));
    let leaf: any = calls[0].ast.where.record_id.$in;
    for (let k = 0; k < 8; k++) {
      expect(isComposedReadableIds(leaf), `level ${k}`).toBe(true);
      expect(leaf.object, `level ${k}`).toBe(levels[k]);
      leaf = leaf.scope?.next?.$in;
    }
    expect(leaf).toBeUndefined();

    const tooDeep = chainTo(8);
    wire(engine, () => tooDeep.svc);
    calls.length = 0;
    const err = await refusalOf(engine.find('rid_child', { where: { record_id: { $in: ReadableIds.of('rid_l0') } } }));
    expect(envelopeOf(err)).toEqual(REFUSED);
    expect(err!.message).toContain('rid_child -> rid_l0 -> rid_l1 -> rid_l2 -> rid_l3 -> rid_l4 -> rid_l5 -> rid_l6 -> rid_l7 -> rid_l8 is 9 scopes deep');
    expect(err!.message).toContain('composes a chain at most 8 scopes deep');
    expect(calls).toHaveLength(0);
    // The ninth scope's parent was never asked: the bound is judged before the service is.
    expect(tooDeep.asked).not.toContain('canReadObject:rid_l8');
  });

  it('a parent that appears at the outer level and inside another parent\'s scope is asked once, its composed scope reused by reference', async () => {
    const grandScope = { owner: 'u1' };
    const { svc, asked } = chainSecurity(grandScope);
    wire(engine, () => svc);
    await engine.find('rid_child', { where: { $or: [branch('rid_grand'), branch('rid_parent')] } });
    expect(asked).toEqual([
      'canReadObject:rid_grand', 'getReadFilter:rid_grand',
      'canReadObject:rid_parent', 'getReadFilter:rid_parent',
    ]);
    const arms = calls[0].ast.where.$or;
    const direct = inComparandOf(arms[0]) as any;
    const viaParent = (inComparandOf(arms[1]) as any).scope.grand.$in;
    expect(direct.object).toBe('rid_grand');
    expect(viaParent.object).toBe('rid_grand');
    expect(direct.scope).toBe(grandScope);
    expect(viaParent.scope).toBe(grandScope);
  });

  it('CONTROL — a scope that carries no leaf is composed exactly as before: the service\'s answer by reference, one level asked', async () => {
    const scope = { title: 'open' };
    const { svc, asked } = makeSecurity({ scope: () => scope });
    wire(engine, () => svc);
    await engine.find('rid_child', { where: branch() });
    expect(asked).toEqual(['canReadObject:rid_parent', 'getReadFilter:rid_parent']);
    const outer = inComparandOf(calls[0].ast.where) as any;
    expect(outer.scope).toBe(scope);
  });
});

// ── [#33696 · ruling record 6893666857] step 5: the required master's leaf over an unrestricted master ──
//
// A leaf over the REQUIRED master of a `controlled_by_parent` object, the whole
// comparand of a `$in` on that master field in an AND position, is dropped when
// the master's answered scope is unrestricted AND the caller holds View All on
// that object (the security service's effective object-permission map); a
// scope left empty by the drop is unrestricted itself, so a chain drops whole
// only when every hop is. Every other position, an optional master, a
// restricted hop, a caller without View All, a delegated caller, a service
// without the map or one whose map throws, and a leaf on an object that is not
// `controlled_by_parent` compose exactly as before. The rows this
// serves are measured on the real stack in `@objectstack/plugin-security`
// (`security-plugin-cbp-read-filter.test.ts`).
describe('[#33696 ruling 6893666857] the required master\'s leaf over an unrestricted master is dropped, nowhere else', () => {
  let engine: ObjectQL;
  let calls: SeenCall[];

  const cbp = (name: string, fk: string, master: string, required: boolean) => ({
    name,
    label: name,
    sharingModel: 'controlled_by_parent',
    fields: {
      name: { name: 'name', type: 'text' },
      [fk]: { name: fk, type: 'master_detail', reference: master, required },
    },
  });
  const ACCOUNT = { name: 'rid_r4_account', label: 'Account', fields: { owner: { name: 'owner', type: 'text' } } };
  const OPP = cbp('rid_r4_opp', 'account', 'rid_r4_account', true);
  const LINE = cbp('rid_r4_line', 'opp', 'rid_r4_opp', true);
  const NOTE = cbp('rid_r4_note', 'opp', 'rid_r4_opp', false);
  /** The leaf the controlled-by-parent derivation answers for a detail over `master` on `fk`. */
  const leafOn = (fk: string, master: string) => ({ [fk]: { $in: ReadableIds.of(master) } });
  /** View All on every detail: the effective map a security service answers for an administrator. */
  const VIEW_ALL_DETAILS = { rid_r4_opp: { viewAllRecords: true }, rid_r4_line: { viewAllRecords: true }, rid_r4_note: { modifyAllRecords: true } };
  /**
   * The service of the chain: the opportunity's scope is its leaf over the
   * account; the account's is `accountScope`; the caller's effective map is
   * `effective` (`null`: the service has no such member; a function: its answer).
   */
  const chain = (accountScope: unknown, effective: unknown = VIEW_ALL_DETAILS) => {
    const security = makeSecurity({
      scope: (object) => (object === 'rid_r4_opp' ? leafOn('account', 'rid_r4_account') : object === 'rid_r4_account' ? accountScope : undefined),
    });
    if (effective !== null) {
      security.svc.getEffectiveObjectPermissions = async (context?: unknown) => {
        security.asked.push('getEffectiveObjectPermissions');
        return typeof effective === 'function' ? (effective as (c: unknown) => unknown)(context) : effective;
      };
    }
    return security;
  };
  const whereOf = async (object: string, where: Record<string, unknown>, context: unknown = { userId: 'u1' }) => {
    calls.length = 0;
    await engine.find(object, { where, context: context as any });
    expect(calls.map((c) => c.verb)).toEqual(['find']);
    return calls[0].ast.where;
  };

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    calls = rec.calls;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    for (const def of [ACCOUNT, OPP, LINE, NOTE, CHILD, PARENT]) engine.registry.registerObject(def as any, 'test');
    calls.length = 0;
  });

  it('every hop unrestricted: the leaf at the root, and as an `$and` member, is dropped; the masters are still asked', async () => {
    const { svc, asked } = chain(undefined);
    wire(engine, () => svc);
    expect(await whereOf('rid_r4_line', leafOn('opp', 'rid_r4_opp'))).toEqual({});
    // The effective map is asked once per read, and only once a leaf could be dropped.
    expect(asked).toEqual([
      'canReadObject:rid_r4_opp', 'getReadFilter:rid_r4_opp', 'canReadObject:rid_r4_account', 'getReadFilter:rid_r4_account',
      'getEffectiveObjectPermissions',
    ]);
    expect(await whereOf('rid_r4_line', { $and: [{ name: 'x' }, leafOn('opp', 'rid_r4_opp')] })).toEqual({ $and: [{ name: 'x' }] });
    expect(await whereOf('rid_r4_line', { name: 'x', ...leafOn('opp', 'rid_r4_opp') })).toEqual({ name: 'x' });
  });

  it('a restricted hop keeps the whole chain: the outer leaf composed, the inner one too', async () => {
    const accountScope = { owner: 'u1' };
    const { svc } = chain(accountScope);
    wire(engine, () => svc);
    const outer = (await whereOf('rid_r4_line', leafOn('opp', 'rid_r4_opp'))).opp.$in;
    expect(isComposedReadableIds(outer)).toBe(true);
    expect(outer.object).toBe('rid_r4_opp');
    expect(isComposedReadableIds(outer.scope.account.$in)).toBe(true);
    expect(outer.scope.account.$in.scope).toBe(accountScope);
  });

  it('an `$or` position, an OPTIONAL master and an object that is not controlled_by_parent compose as before', async () => {
    const { svc } = chain(undefined);
    wire(engine, () => svc);
    const or = await whereOf('rid_r4_line', { $or: [leafOn('opp', 'rid_r4_opp'), { name: 'x' }] });
    expect(isComposedReadableIds(or.$or[0].opp.$in)).toBe(true);
    const optional = await whereOf('rid_r4_note', leafOn('opp', 'rid_r4_opp'));
    expect(isComposedReadableIds(optional.opp.$in)).toBe(true);
    // The master's own leaf was dropped, so its composed scope is unrestricted.
    expect(optional.opp.$in.scope).toBeUndefined();
    const plain = await whereOf('rid_child', branch('rid_parent'));
    expect(isComposedReadableIds(plain.record_id.$in)).toBe(true);
  });

  it('a caller without View All on the detail keeps the whole chain, whatever the hops answer', async () => {
    for (const [label, effective, context] of [
      ['no View All on any detail', { rid_r4_line: { allowRead: true }, rid_r4_opp: { allowRead: true } }, { userId: 'u1' }],
      ['View All on the read detail only', { rid_r4_line: { viewAllRecords: true } }, { userId: 'u1' }],
      ['a service without the effective map', null, { userId: 'u1' }],
      ['an effective map that throws', () => { throw new Error('resolution is down'); }, { userId: 'u1' }],
      ['a delegated caller', VIEW_ALL_DETAILS, { userId: 'agent', onBehalfOf: { userId: 'u1' } }],
    ] as const) {
      const { svc } = chain(undefined, effective);
      wire(engine, () => svc);
      const outer = (await whereOf('rid_r4_line', leafOn('opp', 'rid_r4_opp'), context)).opp.$in;
      expect(isComposedReadableIds(outer), label).toBe(true);
      expect(isComposedReadableIds(outer.scope.account.$in), label).toBe(true);
      expect(outer.scope.account.$in.scope, label).toBeUndefined();
    }
  });

  it('a condition the caller writes on the required master, in the same read, is never dropped with the master\'s own leaf', async () => {
    // A driver the nested-relation lowering plans a subquery for (it declares
    // the `readableIdsLeaf` bit, [#33876]): the caller's `{ opp: { name: 'x' } }`
    // becomes a leaf over the same master.
    const rec = makeRecordingDriver('com.objectstack.driver.sql', { readableIdsLeaf: true });
    const planned = new ObjectQL();
    planned.registerDriver(rec.driver, true);
    await planned.init();
    for (const def of [ACCOUNT, OPP, LINE]) planned.registry.registerObject(def as any, 'test');
    const { svc } = chain(undefined);
    wire(planned, () => svc);
    rec.calls.length = 0;
    await planned.find('rid_r4_line', { where: { $and: [leafOn('opp', 'rid_r4_opp'), { opp: { name: 'x' } }] }, context: { userId: 'u1' } as any });
    // One driver call: the related read was planned, not run.
    expect(rec.calls.map((c) => c.verb)).toEqual(['find']);
    const where = rec.calls[0].ast.where;
    // The master's own leaf is dropped for this View All reader; the caller's condition stays, as its subquery.
    expect(where.$and).toHaveLength(1);
    const leaf = where.$and[0].opp.$in;
    expect(isComposedReadableIds(leaf)).toBe(true);
    expect(leaf.object).toBe('rid_r4_opp');
    expect(leaf.scope).toEqual({ name: 'x' });
  });

  it('a master the caller may not read keeps the leaf, answered `$in: []`', async () => {
    const { svc } = makeSecurity({ canRead: (object) => object !== 'rid_r4_opp' });
    wire(engine, () => svc);
    expect(await whereOf('rid_r4_line', leafOn('opp', 'rid_r4_opp'))).toEqual({ opp: { $in: [] } });
  });
});
