// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// CAPABILITY-MATRIX golden test — every authorable field type must survive a
// real HTTP write → read round-trip.
//
// @proof: field-type-roundtrip
// ADR-0054 runtime proof for the field-type high-risk class. Referenced by the
// liveness ledger entry `field.type` (packages/spec/liveness/field.json); the
// spec liveness gate fails if this tag is removed. See proof-registry.mts.
//
// `showcase_field_zoo` carries one field of (almost) every protocol FieldType.
// Until now it was only *static*-checked (the metadata bundle registers it);
// nothing wrote a record and read it back. But the platform's value is that an
// AI can author ANY field and it works at runtime — so each field type needs a
// runtime proof, not a shape assertion. This is the first block of that matrix
// and the direct guard for #2004 (array-typed fields silently failed to persist;
// Field.time rejected time-of-day).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { SECRET_MASK } from '@objectstack/objectql';
import { bootStack, type VerifyStack } from '@objectstack/verify';

// A field-type coverage entry. `write` is the value POSTed; `expect` describes
// how the value must come back. `equal` = exact (or set-equal for arrays);
// `computed`/`present` cover server-owned fields you don't write; `masked`
// covers `secret`, which is encrypt-on-write and masked on read.
type Check =
  | { kind: 'equal'; write: unknown }
  | { kind: 'setEqual'; write: unknown[] }
  | { kind: 'present'; write?: unknown } // written but only asserted non-null (e.g. one-way/opaque)
  | { kind: 'masked'; write: unknown } // secret: POSTed plaintext must read back as SECRET_MASK
  | { kind: 'computed'; expected: unknown }; // derived, asserted not written

interface FieldCase {
  field: string;
  type: string;
  check: Check;
  // KNOWN GAP: the schema→SQL-column mapping / read coercion doesn't yet cover
  // this type, so it round-trips with the wrong JS type (e.g. '4' not 4). The
  // value persists (no data loss), but fidelity leaks. Quarantined via it.fails
  // so it stays visible AND auto-flags the day it's fixed. Tracked separately.
  xfail?: boolean;
}

// The #2004 headliners are the three array types + f_time. The rest broaden the
// matrix across scalars, temporals, structured JSON, and computed/system fields.
const MATRIX: FieldCase[] = [
  // text-ish
  { field: 'f_textarea', type: 'textarea', check: { kind: 'equal', write: 'line1\nline2' } },
  { field: 'f_email', type: 'email', check: { kind: 'equal', write: 'zoo@example.com' } },
  { field: 'f_url', type: 'url', check: { kind: 'equal', write: 'https://objectstack.ai' } },
  { field: 'f_phone', type: 'phone', check: { kind: 'equal', write: '+14155550123' } },
  // numbers
  { field: 'f_number', type: 'number', check: { kind: 'equal', write: 42 } },
  { field: 'f_currency', type: 'currency', check: { kind: 'equal', write: 1234.56 } },
  { field: 'f_percent', type: 'percent', check: { kind: 'equal', write: 75 } },
  { field: 'f_rating', type: 'rating', check: { kind: 'equal', write: 4 } },
  { field: 'f_slider', type: 'slider', check: { kind: 'equal', write: 25 } },
  // temporal — f_time is a #2004 fix (time-of-day)
  { field: 'f_date', type: 'date', check: { kind: 'equal', write: '2024-03-15' } },
  { field: 'f_time', type: 'time', check: { kind: 'equal', write: '14:30:00' } },
  // logic
  { field: 'f_boolean', type: 'boolean', check: { kind: 'equal', write: true } },
  { field: 'f_toggle', type: 'toggle', check: { kind: 'equal', write: true } },
  // scalar selection
  { field: 'f_select', type: 'select', check: { kind: 'equal', write: 'high' } },
  { field: 'f_radio', type: 'radio', check: { kind: 'equal', write: 'yes' } },
  // ── #2004 array headliners — these silently dropped before the fix ──
  { field: 'f_multiselect', type: 'multiselect', check: { kind: 'setEqual', write: ['red', 'blue'] } },
  { field: 'f_checkboxes', type: 'checkboxes', check: { kind: 'setEqual', write: ['email', 'push'] } },
  { field: 'f_tags', type: 'tags', check: { kind: 'setEqual', write: ['alpha', 'beta', 'gamma'] } },
  // numeric scalar — same fidelity class as rating/slider (was TEXT-affinity)
  { field: 'f_progress', type: 'progress', check: { kind: 'equal', write: 60 } },
  // rich text — all plain strings on the wire
  { field: 'f_markdown', type: 'markdown', check: { kind: 'equal', write: '# Heading\n\nbody' } },
  { field: 'f_html', type: 'html', check: { kind: 'equal', write: '<p>hi</p>' } },
  { field: 'f_richtext', type: 'richtext', check: { kind: 'equal', write: '<b>rich</b>' } },
  { field: 'f_code', type: 'code', check: { kind: 'equal', write: '{\n  "a": 1\n}' } },
  { field: 'f_signature', type: 'signature', check: { kind: 'equal', write: 'data:image/png;base64,AAAA' } },
  { field: 'f_qrcode', type: 'qrcode', check: { kind: 'equal', write: 'https://objectstack.ai' } },
  // temporal — instant
  { field: 'f_datetime', type: 'datetime', check: { kind: 'equal', write: '2024-03-15T14:30:00.000Z' } },
  // structured JSON
  { field: 'f_json', type: 'json', check: { kind: 'equal', write: { a: 1, b: [2, 3] } } },
  { field: 'f_color', type: 'color', check: { kind: 'equal', write: '#FF8800' } },
  { field: 'f_vector', type: 'vector', check: { kind: 'equal', write: [0.1, 0.2, 0.3] } },
  // object-valued types that must store/parse as JSON, not stringify to TEXT
  { field: 'f_record', type: 'record', check: { kind: 'equal', write: { home: '+1', work: '+2' } } },
  { field: 'f_video', type: 'video', check: { kind: 'equal', write: { url: 'https://cdn/v.mp4', duration: 12 } } },
  { field: 'f_audio', type: 'audio', check: { kind: 'equal', write: { url: 'https://cdn/a.mp3', duration: 30 } } },
  { field: 'f_composite', type: 'composite', check: { kind: 'equal', write: { label: 'x', n: 1 } } },
  { field: 'f_repeater', type: 'repeater', check: { kind: 'equal', write: [{ a: 1 }, { a: 2 }] } },
  { field: 'f_location', type: 'location', check: { kind: 'equal', write: { lat: 37.77, lng: -122.42 } } },
  { field: 'f_address', type: 'address', check: { kind: 'equal', write: { street: '1 Main', city: 'SF', country: 'US' } } },
  { field: 'f_image', type: 'image', check: { kind: 'equal', write: { url: 'https://cdn/i.png', alt: 'i' } } },
  { field: 'f_file', type: 'file', check: { kind: 'equal', write: { url: 'https://cdn/f.pdf', name: 'f.pdf', size: 1024 } } },
  { field: 'f_avatar', type: 'avatar', check: { kind: 'equal', write: { url: 'https://cdn/a.png' } } },
  // relational — store a reference id as a string and read it back verbatim.
  // FK enforcement is off in this harness, so this asserts value fidelity
  // (id string → id string), not referential integrity / $expand (covered
  // elsewhere). The point here is the stored type doesn't drift.
  { field: 'f_lookup', type: 'lookup', check: { kind: 'equal', write: 'acc_synthetic_0001' } },
  { field: 'f_master_detail', type: 'master_detail', check: { kind: 'equal', write: 'proj_synthetic_0001' } },
  { field: 'f_tree', type: 'tree', check: { kind: 'equal', write: 'cat_synthetic_0001' } },
  // security — `secret` encrypts on write and masks on read; `password` is a
  // credential type the generic CRUD path stores opaquely (auth owns hashing),
  // so assert it merely persists rather than asserting a plaintext contract.
  { field: 'f_secret', type: 'secret', check: { kind: 'masked', write: 'topsecret-value' } },
  { field: 'f_password', type: 'password', check: { kind: 'present', write: 'p@ssw0rd!' } },
  // NB: f_summary (roll-up) is intentionally absent — it's a computed
  // aggregate over related records, null on a childless fixture row; its
  // semantics are covered by dedicated roll-up tests, not value fidelity.
  // computed / system — not written, must materialize
  { field: 'f_autonumber', type: 'autonumber', check: { kind: 'present' } },
  // f_number(42) * f_percent(75) / 100 = 31.5
  { field: 'f_formula', type: 'formula', check: { kind: 'computed', expected: 31.5 } },
];

describe('dogfood: field-type capability matrix round-trips over HTTP (#2004)', () => {
  let stack: VerifyStack;
  let record: Record<string, unknown>;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    const token = await stack.signIn();

    // Build the create body from every entry that carries a `write` value
    // (+ required name). `present`/`computed` server-owned fields are skipped.
    const body: Record<string, unknown> = { name: 'zoo-roundtrip' };
    for (const c of MATRIX) {
      if ('write' in c.check && c.check.write !== undefined) body[c.field] = c.check.write;
    }

    const created = await stack.apiAs(token, 'POST', '/data/showcase_field_zoo', body);
    expect(created.status, `create failed: ${created.status} ${await created.clone().text()}`).toBeLessThan(300);
    const createdJson = (await created.json()) as { id?: string; record?: { id?: string } };
    const id = createdJson.id ?? createdJson.record?.id;
    expect(id, 'no id returned from create').toBeTruthy();

    const got = await stack.apiAs(token, 'GET', `/data/showcase_field_zoo/${id}`);
    expect(got.status).toBe(200);
    const gotJson = (await got.json()) as { record?: Record<string, unknown> } & Record<string, unknown>;
    record = (gotJson.record ?? gotJson) as Record<string, unknown>;
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  for (const c of MATRIX) {
    // xfail entries are KNOWN type-fidelity gaps: `it.fails` passes while the
    // assertion throws and turns RED the moment the gap is fixed — forcing the
    // quarantine to be lifted rather than silently rotting.
    const runner = c.xfail ? it.fails : it;
    runner(`${c.type} (${c.field}) round-trips`, () => {
      const actual = record[c.field];
      switch (c.check.kind) {
        case 'equal':
          expect(actual).toEqual(c.check.write);
          break;
        case 'setEqual': {
          // Array-typed fields: persisted as a JSON array; order is not
          // guaranteed, so compare as sets (the #2004 break returned null/[]).
          expect(Array.isArray(actual), `${c.field} not an array: ${JSON.stringify(actual)}`).toBe(true);
          expect([...(actual as unknown[])].sort()).toEqual([...c.check.write].sort());
          break;
        }
        case 'present':
          expect(actual ?? null, `${c.field} should be persisted`).not.toBeNull();
          break;
        case 'masked':
          // secret never leaves the engine as plaintext — the write value is
          // encrypted into sys_secret and the read path returns the mask.
          expect(actual, `${c.field} should not echo plaintext`).not.toEqual(c.check.write);
          expect(actual).toEqual(SECRET_MASK);
          break;
        case 'computed':
          expect(Number(actual)).toBeCloseTo(Number(c.check.expected), 5);
          break;
      }
    });
  }
});
