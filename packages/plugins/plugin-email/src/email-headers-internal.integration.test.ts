// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8149 — `sys_email.headers_json` must not be readable over the generic data
 * API, and every authored header must still reach the transport VERBATIM.
 *
 * The gap: the #5172/#5177 attachments/headers work gave `sys_email` a
 * `headers_json` column so a QUEUED message could carry its custom headers
 * durably — and custom headers are the ordinary place a credential goes (an
 * SMTP relay's `Authorization`, a provider token). `sys_email` is readable
 * over the ordinary data API (`enable.apiMethods: ['get', 'list']`), so the
 * column served those credentials to every caller the data API admits. Same
 * shape as `sys_http_delivery.headers_json`; this card adopts the remedy
 * #8118 ruled and PR #8348 landed rather than deciding it a second time.
 *
 * The fix under test: `headers_json` is declared `internal: true`, so the
 * ENGINE omits it from every generic read with no system carve-out (#7728),
 * and the delivery paths — the readers that must see the map — recover it
 * through ObjectQL's purpose-built privileged accessor
 * (`resolveInternalField`, the remedy #7728 named).
 *
 * These run the REAL engine — `ObjectQL` + `@objectstack/driver-memory`, the
 * real `SysEmail` schema, the real `EmailService` with the same persistence
 * seam `EmailServicePlugin` wires — because both halves of this card live in
 * one hand-off: what the data API serves, and what the transport was actually
 * handed after the row was re-read. A fake engine could not show the strip at
 * all, and the strip is the fix.
 *
 * Every redaction pin is PAIRED with its wire pin. That pairing is the point:
 * a "fix" that merely dropped the headers would satisfy every read-path
 * assertion here and silently break every authenticated relay in production —
 * a missing header is not self-announcing, so the mail is accepted while the
 * delivery deviates from the authored configuration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysEmail } from '@objectstack/platform-objects/audit';
import { EmailService, type EmailPersistence } from './email-service.js';
import { readInternalHeadersJson, isHeadersColumnRedacted } from './internal-header-readback.js';
import type { IEmailTransport, TransportSendResult } from '@objectstack/spec/contracts';

/** A credential a real deployment would put in `headers`. Distinctive on purpose. */
const RELAY_TOKEN = 'Bearer prod_relay_tok_8149_do_not_serve';

const SYSTEM_CTX = { isSystem: true, userId: 'system' } as any;

/**
 * Minimal stub driver — the same shape `objectql/src/internal-fields.test.ts`
 * pins the flag itself against, including the `$in` batch form
 * `resolveInternalField` reads by. A stub rather than a real storage driver on
 * purpose: what is under test is ENGINE behaviour (the strip, and the
 * privileged dereference), so the driver only has to store and hand back
 * copies. Rows leave as COPIES, as a real driver's do — handing out the live
 * stored object would let the engine's own strip mutate storage, which reads
 * exactly like an engine bug.
 */
function makeStubDriver() {
  const stores = new Map< string, Map< string, Record< string, unknown > > >();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        const members = (v as any).$in;
        if (!Array.isArray(members) || !members.includes(row[k] ?? null)) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const copy = < T, >(r: T): T => (r == null ? r : ({ ...r } as T));
  const project = (row: any, fields?: string[]) => {
    if (!row || !Array.isArray(fields) || fields.length === 0) return copy(row);
    const out: Record< string, unknown > = {};
    for (const f of fields) if (f in row) out[f] = row[f];
    return out;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values())
        .filter((r) => matches(r, ast?.where))
        .map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return project(r, ast?.fields);
      return null;
    },
    async create(object: string, data: Record< string, unknown >) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record< string, unknown >) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Record< string, unknown >) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record< string, unknown >[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

/** Records exactly what the transport was handed. */
function recordingTransport(): {
  transport: IEmailTransport;
  sent: Array< { subject: string; headers?: Record< string, string > } >;
} {
  const sent: Array< { subject: string; headers?: Record< string, string > } > = [];
  const transport: IEmailTransport = {
    async send(message): Promise< TransportSendResult > {
      sent.push({ subject: message.subject, headers: message.headers });
      return { messageId: `< sent-${sent.length}@test >` };
    },
  };
  return { transport, sent };
}

describe('sys_email.headers_json — authored headers vs the data API (#8149)', () => {
  let engine: ObjectQL | undefined;
  let stores: Map< string, Map< string, Record< string, unknown > > >;

  beforeEach(async () => {
    const stub = makeStubDriver();
    stores = stub.stores;
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(SysEmail as any, '@objectstack/platform-objects');
  });

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
    engine = undefined;
  });

  /** The persistence seam EmailServicePlugin wires, verbatim in shape. */
  function persistenceFor(eng: ObjectQL): EmailPersistence {
    return {
      async insert(row) {
        const created: any = await (eng as any).insert('sys_email', row, { context: SYSTEM_CTX });
        return created?.id ? { id: String(created.id) } : { id: String(row.id) };
      },
      async update(id, patch) {
        await (eng as any).update('sys_email', { id, ...patch }, { context: SYSTEM_CTX });
      },
      async readHeadersJson(rowIds) {
        return readInternalHeadersJson(eng as any, rowIds);
      },
    };
  }

  async function insertQueuedRow(eng: ObjectQL, headers?: Record<string, string>) {
    const created: any = await (eng as any).insert('sys_email', {
      id: `em_${Math.random().toString(36).slice(2, 10)}`,
      from_address: 'noreply@example.com',
      to_addresses: 'user@example.com',
      subject: 'Quarterly report',
      body_text: 'hello',
      status: 'queued',
      ...(headers ? { headers_json: JSON.stringify(headers) } : {}),
      created_at: new Date().toISOString(),
    }, { context: SYSTEM_CTX });
    return String(created.id);
  }

  it('the column is declared internal — the seam probe agrees with the engine', () => {
    // The probe the delivery path uses to decide "did the engine redact?" is
    // the SCHEMA FLAG, never the absence of the key from a row. Pinned here
    // because the distinction is what keeps this seam safe on an OPTIONAL
    // column: `headers_json` is `required: false`, so a row legitimately
    // lacking it is the ordinary case, not evidence of a strip.
    expect(isHeadersColumnRedacted(engine as any)).toBe(true);
    expect((SysEmail as any).fields.headers_json.internal).toBe(true);
    expect((SysEmail as any).fields.headers_json.required).toBe(false);
  });

  it('a queued message: redacted on the data API, verbatim to the transport', async () => {
    const eng = engine!;
    const rowId = await insertQueuedRow(eng, { Authorization: RELAY_TOKEN, 'X-Campaign': 'q3' });

    // ── The read path an ordinary GET /api/v1/data/sys_email takes ──
    const viaApi: any[] = await (eng as any).find('sys_email', {});
    expect(viaApi).toHaveLength(1);
    // The KEY is absent — omitted, not masked, not nulled (#7728 (b)).
    expect(Object.keys(viaApi[0])).not.toContain('headers_json');
    expect(JSON.stringify(viaApi)).not.toContain(RELAY_TOKEN);
    // Falsifiability: this is the real row, not an emptied one.
    expect(viaApi[0].subject).toBe('Quarterly report');

    // An EXPLICIT projection naming the column does not bypass the omit —
    // `?select=headers_json` is served without it, not refused (#7823).
    const named: any[] = await (eng as any).find('sys_email', {
      fields: ['id', 'subject', 'headers_json'],
    });
    expect(Object.keys(named[0])).not.toContain('headers_json');
    expect(named[0].subject).toBe('Quarterly report');

    // …and SYSTEM context does not reopen it: #7728 has no system carve-out,
    // which is exactly why the delivery paths need the accessor rather than
    // an elevated read.
    const viaSystem: any[] = await (eng as any).find('sys_email', { context: SYSTEM_CTX });
    expect(Object.keys(viaSystem[0])).not.toContain('headers_json');

    // ── The wire: every authored header reaches the transport verbatim ──
    const { transport, sent } = recordingTransport();
    const svc = new EmailService({ transport, persistence: persistenceFor(eng) });
    // Deliver the way the durable paths do: re-read the row (redacted!), then
    // hand THAT row to deliverPersistedRow.
    const row = (await (eng as any).find('sys_email', {
      where: { id: rowId }, limit: 1, context: SYSTEM_CTX,
    }))[0];
    expect(Object.keys(row)).not.toContain('headers_json'); // the input really is stripped
    const result = await svc.deliverPersistedRow(row);

    expect(result.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].headers).toEqual({ Authorization: RELAY_TOKEN, 'X-Campaign': 'q3' });
  });

  it('a message authored WITHOUT headers still delivers — the optional-column trap', async () => {
    // The regression PR #8675 measured on a sibling card: `headers_json` is
    // `required: false`, and the overwhelming majority of real rows have no
    // custom headers at all. A seam that inferred "key missing ⇒ the strip
    // ran" would treat every ordinary email as a redacted row. This pins that
    // the ordinary case is untouched — and delivers.
    const eng = engine!;
    const rowId = await insertQueuedRow(eng);

    const { transport, sent } = recordingTransport();
    const svc = new EmailService({ transport, persistence: persistenceFor(eng) });
    const row = (await (eng as any).find('sys_email', {
      where: { id: rowId }, limit: 1, context: SYSTEM_CTX,
    }))[0];
    const result = await svc.deliverPersistedRow(row);

    expect(result.status).toBe('sent');
    expect(sent).toHaveLength(1);
    // No headers authored ⇒ none synthesised. `undefined`/`null` must never
    // become a header map.
    expect(sent[0].headers).toBeUndefined();
  });

  it('FAIL-CLOSED: a redacting engine that cannot dereference refuses to send', async () => {
    const eng = engine!;
    const rowId = await insertQueuedRow(eng, { Authorization: RELAY_TOKEN });

    // An engine that REDACTS (the REAL ObjectQL `getSchema` underneath, so
    // `headers_json` is genuinely flagged and the rows genuinely came back
    // without it) but exposes no `resolveInternalField`. Not a shape ObjectQL
    // can produce — the flag and the accessor ship together — but exactly the
    // shape a foreign or version-skewed engine would take, and the one
    // combination in which "keep going" means sending a message that silently
    // deviates from its authored configuration.
    //
    // Deliberately NOT an engine double: the seam's whole surface is
    // `getSchema` + `resolveInternalField`, so this stub declares exactly the
    // one member it needs. Adding CRUD verbs it never calls would make it a
    // second fake engine to keep in contract-sync for no test value.
    const noAccessor = { getSchema: (o: string) => (eng as any).getSchema(o) };

    const { transport, sent } = recordingTransport();
    const svc = new EmailService({
      transport,
      persistence: {
        ...persistenceFor(eng),
        async readHeadersJson(rowIds) { return readInternalHeadersJson(noAccessor as any, rowIds); },
      },
    });
    const row = (await (eng as any).find('sys_email', {
      where: { id: rowId }, limit: 1, context: SYSTEM_CTX,
    }))[0];

    await expect(svc.deliverPersistedRow(row)).rejects.toThrow(/resolveInternalField/);
    // Nothing went out missing its headers.
    expect(sent).toHaveLength(0);

    // …and no work was lost: the row is still `queued`, NOT `failed`, so the
    // queue's retry or the next boot's outbox sweep delivers it intact. This
    // is the analogue of #8118's claim-TTL revert, and the reason the
    // recovery sits outside the catch that marks rows failed.
    const after: any[] = await (eng as any).find('sys_email', {
      where: { id: rowId }, limit: 1, context: SYSTEM_CTX,
    });
    expect(after[0].status).toBe('queued');
    expect(after[0].error ?? null).toBeNull();
  });

  it('the privileged accessor refuses a field that is not flagged', async () => {
    // The guard that makes the accessor safe rather than a generic
    // read-protection bypass (#8118 step 3). Pinned from the consumer side
    // too: this card consumes that guard, so it must keep holding here.
    const eng = engine!;
    await insertQueuedRow(eng, { Authorization: RELAY_TOKEN });
    const err = await (eng as any)
      .resolveInternalField('sys_email', ['whatever'], 'subject')
      .then(() => null, (e: any) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
  });

  it('at rest the bytes are unchanged — the ruled posture, pinned deliberately', async () => {
    // #8149 adopts #8118's decision, which narrows the READ surface only:
    // the row still holds the map in cleartext. `Field.secret()` was measured
    // and rejected there. Stated so the next reader is not misled, and so a
    // future card that changes the at-rest story flips this pin deliberately
    // rather than by accident.
    const eng = engine!;
    await insertQueuedRow(eng, { Authorization: RELAY_TOKEN });

    // Scanned straight out of STORAGE, not through the accessor — an at-rest
    // claim read back through the privileged reader would only be restating
    // that the reader works.
    const rows = [...(stores.get('sys_email')?.values() ?? [])];
    expect(rows.length).toBeGreaterThan(0); // a scan of nothing proves nothing
    const dump = rows.map((r) => Object.values(r).map((v) => String(v ?? '')).join(' ')).join(' ');
    expect(dump).toContain(RELAY_TOKEN);
    expect(dump).toContain('Quarterly report'); // guard the guard
  });
});
