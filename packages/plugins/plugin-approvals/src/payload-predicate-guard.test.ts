// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21154] A query over the approval snapshot column on the GENERIC data door,
 * by a reader the security service does not serve every field of the subject.
 *
 * The generic-door redaction (#10749 / #20964) narrows what a request row
 * SERVES; a filter, a sort or a group key over the snapshot is evaluated at
 * rest, before it. So for a reader withheld a subject field, a matching probe
 * and a non-matching probe are both refused, in the engine's own refusal
 * shape; a reader served every field of the subject queries it as before.
 *
 * ## The composition
 *
 * A real `ObjectQL` engine on a real SQL driver, with the guard mounted by
 * `ApprovalsServicePlugin.start` itself — the same call that mounts the
 * redaction — so a guard that stops being mounted fails here like one that was
 * never written. The one stand-in is the `security` service, answering the two
 * contract members the serve seam asks per reader: a field served MASKED is
 * readable and not queryable; a field not served is in neither. The three
 * declaration classes are pinned on a real boot, at the HTTP door, in
 * `packages/qa/dogfood/test/activity-text-predicate.dogfood.test.ts`.
 *
 * ⚠️ Disclosure discipline: no test title states a value or a column.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineAggregateOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { ApprovalsServicePlugin } from './approvals-plugin.js';
import { SysApprovalRequest } from './sys-approval-request.object.js';
import { namedSnapshotColumn, pinnedSubjectObject } from './payload-predicate-guard.js';

const REQUEST_OBJECT = 'sys_approval_request';
const SUBJECT = 'ppg_subject';
/** A subject of which every reader is served every field. */
const OPEN_SUBJECT = 'ppg_open';
const HARNESS_PACKAGE = 'com.objectstack.test.payload-predicate-guard';
const SYS = { isSystem: true } as const;

type Ctx = EngineQueryOptions['context'];
const MASKED_READER: Ctx = { userId: 'u_ppg_masked', positions: ['org_member'] };
const UNSERVED_READER: Ctx = { userId: 'u_ppg_unserved', positions: ['org_member'] };
const CONTROL: Ctx = { userId: 'u_ppg_control', positions: ['org_member'] };

/** Synthetic values. */
const V = { masked: 'PPGMASKED51', unserved: 'PPGUNSERVED52', open: 'PPGOPEN53', none: 'PPGNOMATCH54' };
const SUBJECT_FIELDS = ['id', 'name', 'f_masked', 'f_unserved'];
const OPEN_FIELDS = ['id', 'name', 'f_open'];

const subjectObject = {
  name: SUBJECT,
  label: 'Guard Subject',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_masked: { name: 'f_masked', label: 'Masked', type: 'text' as const },
    f_unserved: { name: 'f_unserved', label: 'Unserved', type: 'text' as const },
  },
};
const openSubject = {
  name: OPEN_SUBJECT,
  label: 'Guard Open Subject',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    f_open: { name: 'f_open', label: 'Open', type: 'text' as const },
  },
};

const predicateWords = `[Security] Access denied: query on '${REQUEST_OBJECT}' references field(s) not readable by the caller: payload_json.`;
const aggregateWords = `[Security] Field read denied: not permitted to aggregate [payload_json] on '${REQUEST_OBJECT}'.`;
const firstSentence = (message: string) => {
  const end = message.indexOf('. ');
  return end < 0 ? message : message.slice(0, end + 1);
};

async function expectRefused(probe: Promise<unknown>, words: string): Promise<void> {
  let thrown: any = null;
  try {
    await probe;
  } catch (err) {
    thrown = err;
  }
  expect(thrown, 'the probe was answered instead of refused').not.toBeNull();
  expect(thrown.code).toBe('PERMISSION_DENIED');
  expect(thrown.status).toBe(403);
  expect(thrown.statusCode).toBe(403);
  expect(firstSentence(String(thrown.message))).toBe(words);
}

describe('[#21154] a query over the approval snapshot by a reader withheld a subject field is refused', () => {
  let engine: ObjectQL;

  const fieldsOf = (object: string) => (object === SUBJECT ? SUBJECT_FIELDS : object === OPEN_SUBJECT ? OPEN_FIELDS : undefined);
  const security: {
    getReadableFields?: (object: string, context?: any) => Promise<string[] | undefined>;
    getQueryableFields: (object: string, context?: any) => Promise<string[] | undefined>;
  } = {
    async getReadableFields(object: string, context?: any) {
      const all = fieldsOf(object);
      if (!all || context?.isSystem) return all;
      if (context?.userId === UNSERVED_READER.userId && object === SUBJECT) return all.filter((f) => f !== 'f_unserved');
      return all;
    },
    async getQueryableFields(object: string, context?: any) {
      const readable = await security.getReadableFields!(object, context);
      if (!readable) return readable;
      if (context?.userId === MASKED_READER.userId && object === SUBJECT) return readable.filter((f) => f !== 'f_masked');
      return readable;
    },
  };

  const find = (context: Ctx, where: Record<string, unknown>, extra: EngineQueryOptions = {}) =>
    engine.find(REQUEST_OBJECT, { where, context, ...extra }) as Promise<Array<Record<string, any>>>;
  const contains = (value: string, subject: string | null = SUBJECT) =>
    subject ? { object_name: subject, payload_json: { $contains: value } } : { payload_json: { $contains: value } };
  const grouped = (context: Ctx) => {
    const options: EngineAggregateOptions = {
      where: { object_name: SUBJECT },
      groupBy: ['payload_json'],
      aggregations: [{ function: 'count', alias: 'n' }],
      context,
    };
    return engine.aggregate(REQUEST_OBJECT, options);
  };

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [SysApprovalRequest, subjectObject, openSubject]) {
      engine.registry.registerObject(o as any, HARNESS_PACKAGE);
    }
    await engine.syncSchemas();

    const snapshot = (subject: string, row: Record<string, unknown>) => ({
      object_name: subject, record_id: String(row.id), status: 'pending',
      process_name: 'flow:ppg', submitter_id: 'u_ppg_submitter', payload_json: JSON.stringify(row),
    });
    await engine.insert(REQUEST_OBJECT, snapshot(SUBJECT, { id: 's1', name: 'subject', f_masked: V.masked, f_unserved: V.unserved }), { context: SYS });
    await engine.insert(REQUEST_OBJECT, snapshot(OPEN_SUBJECT, { id: 'o1', name: 'open', f_open: V.open }), { context: SYS });

    // The plugin mounts its own generic-door seams onto this engine.
    const services: Record<string, unknown> = { objectql: engine, security };
    const ctx: any = {
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
        return services[name];
      },
      registerService: (name: string, svc: unknown) => { services[name] = svc; },
      hook: () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    };
    await new ApprovalsServicePlugin().start(ctx);
  }, 60_000);

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('control: at rest, the matching probes match a row and the non-matching probe matches none', async () => {
    expect(await find(SYS, contains(V.masked))).toHaveLength(1);
    expect(await find(SYS, contains(V.unserved))).toHaveLength(1);
    expect(await find(SYS, contains(V.none))).toHaveLength(0);
  });

  for (const [name, reader, stored] of [
    ['served masked', MASKED_READER, V.masked],
    ['not served', UNSERVED_READER, V.unserved],
  ] as const) {
    describe(`a reader withheld a subject field (${name})`, () => {
      it('a matching and a non-matching filter are both refused', async () => {
        await expectRefused(find(reader, contains(stored)), predicateWords);
        await expectRefused(find(reader, contains(V.none)), predicateWords);
      });

      it('a count under a matching and a non-matching filter is refused', async () => {
        await expectRefused(engine.count(REQUEST_OBJECT, { where: contains(stored), context: reader }), predicateWords);
        await expectRefused(engine.count(REQUEST_OBJECT, { where: contains(V.none), context: reader }), predicateWords);
      });

      it('a grouping by the snapshot is refused in the aggregate words', async () => {
        await expectRefused(grouped(reader), aggregateWords);
      });

      it('a sort by the snapshot is refused', async () => {
        await expectRefused(find(reader, { object_name: SUBJECT }, { orderBy: [{ field: 'payload_json', order: 'asc' }] }), predicateWords);
      });

      it('the same reader queries the snapshot of a subject it is served in full, as before', async () => {
        expect(await find(reader, contains(V.open, OPEN_SUBJECT))).toHaveLength(1);
        expect(await find(reader, contains(V.none, OPEN_SUBJECT))).toHaveLength(0);
      });

      it('a query naming no snapshot column answers as before', async () => {
        expect(await find(reader, { object_name: SUBJECT })).toHaveLength(1);
      });
    });
  }

  it('a filter that pins no subject object is refused for a reader withheld a field of any object a snapshot can concern', async () => {
    for (const reader of [MASKED_READER, UNSERVED_READER]) {
      await expectRefused(find(reader, contains(V.masked, null)), predicateWords);
      await expectRefused(find(reader, contains(V.none, null)), predicateWords);
    }
  });

  it('control: a reader served every field of every object a snapshot can concern filters it with no subject named, as before', async () => {
    expect(await find(CONTROL, contains(V.masked, null))).toHaveLength(1);
    expect(await find(CONTROL, contains(V.none, null))).toHaveLength(0);
  });

  it('control: the unrestricted reader filters and groups by the snapshot of a pinned subject, as before', async () => {
    expect(await find(CONTROL, contains(V.masked))).toHaveLength(1);
    expect(await find(CONTROL, contains(V.none))).toHaveLength(0);
    expect(await grouped(CONTROL)).toHaveLength(1);
  });

  it('a system read is not judged, pinned or not', async () => {
    expect(await find(SYS, contains(V.masked, null))).toHaveLength(1);
  });

  it('without a security service the snapshot is served whole, so a filter over it answers as before', async () => {
    const readable = security.getReadableFields;
    delete security.getReadableFields;
    try {
      expect(await find(UNSERVED_READER, contains(V.unserved, null))).toHaveLength(1);
      expect(await find(UNSERVED_READER, contains(V.none, null))).toHaveLength(0);
    } finally {
      security.getReadableFields = readable;
    }
  });
});

describe('[#21154] the snapshot query guard: its pin rule and its clause walk', () => {
  it('reads a pin only from an equality at the root or inside a root conjunction', () => {
    expect(pinnedSubjectObject({ object_name: 'acct' })).toBe('acct');
    expect(pinnedSubjectObject({ object_name: { $eq: 'acct' } })).toBe('acct');
    expect(pinnedSubjectObject({ $and: [{ status: 'pending' }, { $and: [{ object_name: 'acct' }] }] })).toBe('acct');
    expect(pinnedSubjectObject({ object_name: 'acct', $and: [{ object_name: 'lead' }] })).toBeNull();
    expect(pinnedSubjectObject({ $or: [{ object_name: 'acct' }] })).toBeNull();
    expect(pinnedSubjectObject({ $not: { object_name: 'acct' } })).toBeNull();
    expect(pinnedSubjectObject({ object_name: { $in: ['acct'] } })).toBeNull();
    expect(pinnedSubjectObject({ object_name: '  ' })).toBeNull();
    expect(pinnedSubjectObject(undefined)).toBeNull();
  });

  it('finds the column in every row-shaping clause, a cross-field comparand included, and not in the projection', () => {
    expect(namedSnapshotColumn({ fields: ['payload_json'] })).toEqual({ aggregate: false, predicate: false });
    expect(namedSnapshotColumn({ where: { status: { $eq: { $field: 'payload_json' } } } }).predicate).toBe(true);
    expect(namedSnapshotColumn({ where: { $or: [{ status: 'x' }, { $not: { payload_json: 'y' } }] } }).predicate).toBe(true);
    expect(namedSnapshotColumn({ having: { payload_json: 'x' } }).predicate).toBe(true);
    expect(namedSnapshotColumn({ orderBy: [{ field: 'payload_json' }] }).predicate).toBe(true);
    expect(namedSnapshotColumn({ groupBy: ['payload_json'] }).aggregate).toBe(true);
    expect(namedSnapshotColumn({ aggregations: [{ function: 'count', field: '*', filter: { payload_json: 'x' } }] }))
      .toEqual({ aggregate: false, predicate: true });
    expect(namedSnapshotColumn({ where: { object_name: 'acct', status: 'pending' } })).toEqual({ aggregate: false, predicate: false });
  });
});
