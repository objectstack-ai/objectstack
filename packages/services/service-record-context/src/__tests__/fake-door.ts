// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveObjectSortability } from '@objectstack/spec/api';
import type { RecordContextDoor } from '../door.js';

/**
 * A door over an in-memory app, bound to one caller, that records every
 * object it is asked about. It answers as the record tools answer:
 *
 * - `hiddenFields` are not in the caller's served schema (ADR-0106) and never
 *   in a row it reads;
 * - `withheldFields` are in the served schema and left out by
 *   `getReadableFields` (an exempt caller, #35137) — never in a row either;
 * - `unservedObjects` are not served at all; `guardedObjects` are refused by
 *   the read guard; `unexposedObjects` are refused by API exposure;
 * - `unreadableRows` are filtered out by row-level security;
 * - `unpublishedObjects` make the published-definition read THROW a coded
 *   error naming the object, as a door's package gate renders it;
 * - a `where` is read as the engine reads it: a bare value is equality,
 *   `$and` / `$or` combine, and the operators are a related list's ten plus
 *   `$contains` on an array value; any other operator or combinator is
 *   refused, never read as a field; `orderBy` sorts the rows;
 * - `unqueryableFields` are served and readable but not queryable (served
 *   masked, say): `queryableFieldsOf` leaves them out, and a `where` or
 *   `orderBy` naming one — or any field the caller cannot query on — is
 *   refused by the read, as the security plugin's engine guard refuses it;
 *   `noQueryableAnswer` makes the door carry no `queryableFieldsOf`;
 * - an `orderBy` on a field the object's sortability projection calls
 *   unsortable (a formula, or `sortable: false`) refuses the read with
 *   `INVALID_SORT`, as the Data API ingress (`assertSortFieldsExist`, the
 *   HTTP MCP door) and the stdio door (`unofferedSortRefusal`) refuse it;
 * - a lookup is expanded to `{ id, name }` when its target is readable and the
 *   target row is readable, else left as the bare id.
 */
export interface FakeApp {
  objects: Record<string, Record<string, unknown>>;
  records: Record<string, Array<Record<string, unknown>>>;
  packs: unknown[];
  hiddenFields?: Record<string, string[]>;
  withheldFields?: Record<string, string[]>;
  unservedObjects?: string[];
  guardedObjects?: string[];
  unexposedObjects?: string[];
  unreadableRows?: string[];
  unpublishedObjects?: string[];
  unqueryableFields?: Record<string, string[]>;
  noQueryableAnswer?: boolean;
  narrowed?: Record<string, string>;
  locales?: string[];
  /**
   * [ADR-0150 D6] The manifest namespace of each installed package, by id —
   * the door's `packageNamespace`. Absent: the door has no such member.
   */
  namespaces?: Record<string, string>;
}

export interface FakeDoor extends RecordContextDoor {
  /** Every object the door was asked about, in order, with the member that asked. */
  asked: Array<{ member: string; object: string }>;
  /** The record and list reads made, in order. */
  reads: Array<{ member: 'get' | 'query'; object: string; opts?: unknown }>;
  listCalls: number;
}

const coded = (code: string, status: number, message: string) => Object.assign(new Error(message), { code, status });

/** One operator applied to a stored value, as the engine applies it. */
function applies(value: unknown, op: string, comparand: unknown): boolean {
  switch (op) {
    case '$eq': return value === comparand;
    case '$ne': return value !== comparand;
    case '$in': return (comparand as unknown[]).includes(value);
    case '$nin': return !(comparand as unknown[]).includes(value);
    case '$gt': return (value as number) > (comparand as number);
    case '$gte': return (value as number) >= (comparand as number);
    case '$lt': return (value as number) < (comparand as number);
    case '$lte': return (value as number) <= (comparand as number);
    case '$null': return (value == null) === comparand;
    case '$exists': return (value !== undefined) === comparand;
    case '$contains': return Array.isArray(value) && value.includes(comparand);
    default: throw new Error(`fake door: unsupported where operator '${op}'`);
  }
}

/** Whether `row` matches `where`. */
function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$and') return (v as Array<Record<string, unknown>>).every((m) => matches(row, m));
    if (k === '$or') return (v as Array<Record<string, unknown>>).some((m) => matches(row, m));
    if (k.startsWith('$')) throw new Error(`fake door: unsupported where combinator '${k}'`);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v as Record<string, unknown>).every(([op, c]) => applies(row[k], op, c));
    }
    return row[k] === v;
  });
}

/** The field keys a `where` names, through `$and` / `$or`. */
function whereKeys(where: Record<string, unknown>): string[] {
  return Object.entries(where).flatMap(([k, v]) =>
    k === '$and' || k === '$or' ? (v as Array<Record<string, unknown>>).flatMap(whereKeys) : [k],
  );
}

export function fakeDoor(app: FakeApp): FakeDoor {
  const hidden = (o: string) => new Set(app.hiddenFields?.[o] ?? []);
  const withheld = (o: string) => new Set(app.withheldFields?.[o] ?? []);
  const unserved = new Set(app.unservedObjects ?? []);
  const guarded = new Set(app.guardedObjects ?? []);
  const unexposed = new Set(app.unexposedObjects ?? []);
  const unreadable = new Set(app.unreadableRows ?? []);

  const served = (object: string): Record<string, unknown> | null => {
    const def = app.objects[object];
    if (!def || unserved.has(object)) return null;
    const fields = Object.fromEntries(
      Object.entries(def.fields as Record<string, unknown>).filter(([name]) => !hidden(object).has(name)),
    );
    return { ...def, fields };
  };
  const readableRow = (object: string, row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => !hidden(object).has(k) && !withheld(object).has(k)));
  const canRead = (object: string) => !guarded.has(object) && served(object) !== null;
  const queryable = (object: string): string[] => {
    const def = served(object);
    if (!def) return [];
    const out = new Set(app.unqueryableFields?.[object] ?? []);
    return Object.keys(def.fields as Record<string, unknown>).filter((n) => !withheld(object).has(n) && !out.has(n));
  };

  const door: FakeDoor = {
    asked: [],
    reads: [],
    listCalls: 0,
    async readGuard(object) {
      door.asked.push({ member: 'readGuard', object });
      return guarded.has(object) ? `Object "${object}" is a system object and is not exposed via MCP` : undefined;
    },
    async assertApiExposed(object, action) {
      door.asked.push({ member: 'assertApiExposed', object });
      if (unexposed.has(object)) {
        throw coded('OBJECT_API_DISABLED', 404, `API access is disabled for object '${object}' (${action})`);
      }
    },
    async servedObjectDefinitionOf(object) {
      door.asked.push({ member: 'servedObjectDefinitionOf', object });
      return served(object);
    },
    async publishedObjectDefinitionOf(object) {
      door.asked.push({ member: 'publishedObjectDefinitionOf', object });
      if (app.unpublishedObjects?.includes(object)) {
        throw coded('OBJECT_PACKAGE_DISABLED', 404, `Object '${object}' belongs to a disabled package`);
      }
      return app.objects[object] ?? null;
    },
    async listContextPacks() {
      door.listCalls += 1;
      return app.packs;
    },
    async get(object, id) {
      door.asked.push({ member: 'get', object });
      door.reads.push({ member: 'get', object });
      if (!served(object)) throw coded('OBJECT_NOT_FOUND', 404, `Object '${object}' not found`);
      const row = (app.records[object] ?? []).find((r) => r.id === id);
      if (!row || unreadable.has(String(row.id))) return null;
      return readableRow(object, row);
    },
    async query(object, opts) {
      door.asked.push({ member: 'query', object });
      door.reads.push({ member: 'query', object, opts });
      const def = served(object);
      if (!def) throw coded('OBJECT_NOT_FOUND', 404, `Object '${object}' not found`);
      const sortability = resolveObjectSortability(app.objects[object]).fields;
      for (const { field } of opts.orderBy ?? []) {
        if (sortability[field]?.sortable === false) {
          throw coded('INVALID_SORT', 400, `Query parameter 'orderBy' sorts by '${field}', a field on '${object}' that is not offered as a sort`);
        }
      }
      // The security plugin's engine guard: a filter or sort on a field the
      // caller cannot query on is refused, naming it.
      const allowed = new Set(['id', ...queryable(object)]);
      for (const f of [...whereKeys(opts.where), ...(opts.orderBy ?? []).map((n) => n.field)]) {
        if (!allowed.has(f)) throw coded('PERMISSION_DENIED', 403, `Field '${f}' cannot be filtered or sorted on`);
      }
      let rows = (app.records[object] ?? []).filter((r) => !unreadable.has(String(r.id)));
      rows = rows.filter((r) => matches(r, opts.where));
      for (const { field, order } of [...(opts.orderBy ?? [])].reverse()) {
        const sign = order === 'desc' ? -1 : 1;
        rows = [...rows].sort((a, b) => {
          const x = a[field] as number | string;
          const y = b[field] as number | string;
          return x === y ? 0 : x < y ? -sign : sign;
        });
      }
      const out = rows.slice(0, opts.limit ?? rows.length).map((r) => {
        const row = readableRow(object, r);
        for (const f of opts.expand ?? []) {
          const fdef = (def.fields as Record<string, Record<string, unknown>>)[f];
          const target = fdef?.reference as string | undefined;
          if (!target || row[f] == null) continue;
          door.asked.push({ member: 'expand', object: target });
          const targetRow = (app.records[target] ?? []).find((t) => t.id === row[f]);
          if (canRead(target) && targetRow && !unreadable.has(String(targetRow.id))) {
            row[f] = readableRow(target, targetRow);
          }
        }
        return row;
      });
      return { records: out, total: out.length };
    },
    async fieldVisibilityOf(object) {
      const def = served(object);
      if (!def) return undefined;
      const names = Object.keys(def.fields as Record<string, unknown>);
      return { served: names, readable: names.filter((n) => !withheld(object).has(n)) };
    },
    ...(app.noQueryableAnswer
      ? {}
      : {
          async queryableFieldsOf(object: string) {
            return served(object) ? queryable(object) : undefined;
          },
        }),
    async diagnoseDelegation(object) {
      const statement = app.narrowed?.[object];
      return statement ? { narrowed: true, statement } : { narrowed: false };
    },
    async userTextLocales() {
      return app.locales ?? [];
    },
    ...(app.namespaces
      ? { packageNamespace: (packageId: string) => app.namespaces![packageId] }
      : {}),
  };
  return door;
}

/** The fixture app: a policy with an owner account, revisions, and a markdown body. */
export function policyApp(overrides: Partial<FakeApp> = {}): FakeApp {
  return {
    objects: {
      account: {
        name: 'account',
        label: 'Account',
        nameField: 'name',
        fields: {
          name: { name: 'name', type: 'text', label: 'Account name' },
          industry: { name: 'industry', type: 'select', label: 'Industry' },
        },
      },
      policy: {
        name: 'policy',
        label: 'Policy',
        nameField: 'title',
        fields: {
          title: { name: 'title', type: 'text', label: 'Title' },
          status: {
            name: 'status',
            type: 'select',
            label: 'Status',
            options: [{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }],
          },
          owner: { name: 'owner', type: 'lookup', reference: 'account', label: 'Owner' },
          secret_terms: { name: 'secret_terms', type: 'text', label: 'Secret terms' },
          premium: { name: 'premium', type: 'currency', label: 'Premium' },
          content: { name: 'content', type: 'markdown', label: 'Content' },
        },
      },
      policy_revision: {
        name: 'policy_revision',
        label: 'Policy revision',
        nameField: 'version',
        fields: {
          version: { name: 'version', type: 'text', label: 'Version' },
          policy: { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
          reviewer: { name: 'reviewer', type: 'lookup', reference: 'account', label: 'Reviewer' },
          note: { name: 'note', type: 'text', label: 'Note' },
        },
      },
      claim: {
        name: 'claim',
        label: 'Claim',
        nameField: 'number',
        fields: {
          number: { name: 'number', type: 'text', label: 'Number' },
          policy: { name: 'policy', type: 'lookup', reference: 'policy', label: 'Policy' },
        },
      },
    },
    records: {
      account: [{ id: 'a1', name: 'Acme', industry: 'tech' }],
      policy: [
        {
          id: 'p1',
          title: 'Fire cover',
          status: 'active',
          owner: 'a1',
          secret_terms: 'S3CRET-TERMS',
          premium: 1200,
          content: '# Scope\nCovers fire.\n## Exclusions\nArson.\n# Claims\nCall us.',
        },
      ],
      policy_revision: [
        { id: 'r1', version: 'v1', policy: 'p1', reviewer: 'a1', note: 'first' },
        { id: 'r2', version: 'v2', policy: 'p1', reviewer: 'a1', note: 'second' },
        { id: 'r9', version: 'v9', policy: 'p2', reviewer: 'a1', note: 'other policy' },
      ],
      claim: [{ id: 'c1', number: 'CL-1', policy: 'p1' }],
    },
    packs: [
      {
        name: 'policy_document',
        label: 'Policy document',
        object: 'policy',
        fields: ['title', 'status', 'owner', 'secret_terms', 'premium'],
        related: [{ object: 'policy_revision', field: 'policy', fields: ['version', 'reviewer', 'note'] }],
        body: { field: 'content' },
      },
    ],
    ...overrides,
  };
}
