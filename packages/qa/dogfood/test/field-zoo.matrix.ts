// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The field-zoo capability MATRIX — the executable oracle of what each
// authorable FieldType stores on the wire. Extracted from
// field-zoo-roundtrip.dogfood.test.ts (which drives it over real HTTP) so the
// ADR-0104 value-shape contract test can assert against the SAME vectors
// without booting a stack: the contract (@objectstack/spec valueSchemaFor)
// and this oracle cannot drift apart without a test going red.

// A field-type coverage entry. `write` is the value POSTed; `expect` describes
// how the value must come back. `equal` = exact (or set-equal for arrays);
// `computed`/`present` cover server-owned fields you don't write; `masked`
// covers `secret`, which is encrypt-on-write and masked on read.
export type Check =
  | { kind: 'equal'; write: unknown }
  | { kind: 'setEqual'; write: unknown[] }
  | { kind: 'present'; write?: unknown } // written but only asserted non-null (e.g. one-way/opaque)
  | { kind: 'masked'; write: unknown } // secret: POSTed plaintext must read back as SECRET_MASK
  | { kind: 'computed'; expected: unknown }; // derived, asserted not written

/**
 * Stand-in for a reference id the suite only knows at runtime.
 *
 * The three relational entries below name a target object but cannot name a
 * ROW: nothing exists until the suite creates one. The HTTP suite creates a row
 * in each target and substitutes its real id — keyed on the field appearing in
 * {@link REFERENCE_TARGETS}, which is the authoritative list, so this value is
 * documentation rather than a control signal and can never leak to the wire.
 *
 * It is a STRING, deliberately. This table has two consumers: the HTTP suite,
 * which substitutes, and `field-zoo-value-shape.test.ts`, which parses every
 * `write` vector against the spec's `valueSchemaFor(type, 'stored')` WITHOUT
 * booting a stack and therefore never substitutes. A `Symbol` placeholder
 * satisfied the first and broke the second (`expected string, received
 * symbol`) — and because the two live in different FILES, and dogfood shards by
 * file, that surfaced as "shard 2 fixed, shard 1 regressed". A reference's
 * stored form is an id string, so the placeholder is one.
 */
export const REFERENCE_PLACEHOLDER = 'zoo_reference_id_resolved_at_runtime';

/**
 * Reference field → the object whose row supplies its id, and the minimal body
 * that creates one. Consumed by the HTTP round-trip suite; the value-shape
 * contract test ignores these entries (it never writes).
 *
 * ORDERED, and `body` is a factory, because the targets reference each other:
 * `showcase_project` declares a REQUIRED lookup to `showcase_account`, so the
 * account has to exist first and the project has to be given its real id. That
 * dependency is itself a small proof of #4441 — seeding these in the wrong
 * order now fails loudly instead of writing a project that points at nothing.
 */
export const REFERENCE_TARGETS: ReadonlyArray<{
  field: string;
  object: string;
  body: (seeded: Readonly<Record<string, string>>) => Record<string, unknown>;
}> = [
  {
    field: 'f_lookup',
    object: 'showcase_account',
    body: () => ({ name: 'zoo-ref-account', status: 'active' }),
  },
  {
    field: 'f_master_detail',
    object: 'showcase_project',
    body: (seeded) => ({
      name: 'zoo-ref-project',
      // `planned` is the state machine's declared initial state — anything else
      // is refused with `invalid_initial_state`.
      status: 'planned',
      account: seeded.f_lookup,
    }),
  },
  {
    field: 'f_tree',
    object: 'showcase_category',
    body: () => ({ name: 'zoo-ref-category' }),
  },
];

export interface FieldCase {
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
export const MATRIX: FieldCase[] = [
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
  // media — the STORED form is an opaque sys_file id (ADR-0104 D3 wave 2); the
  // inline `{url, …}` blob is the expanded READ form, derived by the resolver
  // rather than written. These ids match no sys_file row here, which is the
  // point: the round-trip must return the stored id verbatim when there is
  // nothing to expand it into.
  { field: 'f_video', type: 'video', check: { kind: 'equal', write: 'file_zoo_video' } },
  { field: 'f_audio', type: 'audio', check: { kind: 'equal', write: 'file_zoo_audio' } },
  { field: 'f_composite', type: 'composite', check: { kind: 'equal', write: { label: 'x', n: 1 } } },
  { field: 'f_repeater', type: 'repeater', check: { kind: 'equal', write: [{ a: 1 }, { a: 2 }] } },
  { field: 'f_location', type: 'location', check: { kind: 'equal', write: { lat: 37.77, lng: -122.42 } } },
  { field: 'f_address', type: 'address', check: { kind: 'equal', write: { street: '1 Main', city: 'SF', country: 'US' } } },
  { field: 'f_image', type: 'image', check: { kind: 'equal', write: 'file_zoo_image' } },
  { field: 'f_file', type: 'file', check: { kind: 'equal', write: 'file_zoo_doc' } },
  { field: 'f_avatar', type: 'avatar', check: { kind: 'equal', write: 'file_zoo_avatar' } },
  // relational — store a reference id as a string and read it back verbatim.
  // This asserts value fidelity (id string → id string), not `$expand`, which
  // is covered elsewhere. The point here is that the stored type doesn't drift.
  //
  // The `write` values below are PLACEHOLDERS: the suite creates a real row in
  // each target object and substitutes its id before the create, then asserts
  // against that same id (see REFERENCE_TARGETS in the spec file). They used to
  // be synthetic ids (`acc_synthetic_0001`, …) under a comment reading "FK
  // enforcement is off in this harness" — which described a HOLE that #4441
  // closed: a lookup pointing at a row that does not exist is now refused.
  // Round-tripping a REAL id proves the same fidelity and stops the matrix
  // depending on a defect.
  { field: 'f_lookup', type: 'lookup', check: { kind: 'equal', write: REFERENCE_PLACEHOLDER } },
  { field: 'f_master_detail', type: 'master_detail', check: { kind: 'equal', write: REFERENCE_PLACEHOLDER } },
  { field: 'f_tree', type: 'tree', check: { kind: 'equal', write: REFERENCE_PLACEHOLDER } },
  // security — both credential types mask on read (plaintext never echoes back
  // over HTTP). `secret` is encrypted at rest; `password` on a generic object is
  // plaintext at rest but masked to SECRET_MASK on read (ADR-0100 / #2036 — the
  // generic path does NOT hash it; auth owns hashing for its identity tables).
  { field: 'f_secret', type: 'secret', check: { kind: 'masked', write: 'topsecret-value' } },
  { field: 'f_password', type: 'password', check: { kind: 'masked', write: 'p@ssw0rd!' } },
  // NB: f_summary (roll-up) is intentionally absent — it's a computed
  // aggregate over related records, null on a childless fixture row; its
  // semantics are covered by dedicated roll-up tests, not value fidelity.
  // computed / system — not written, must materialize
  { field: 'f_autonumber', type: 'autonumber', check: { kind: 'present' } },
  // f_number(42) * f_percent(75) / 100 = 31.5
  { field: 'f_formula', type: 'formula', check: { kind: 'computed', expected: 31.5 } },
];
