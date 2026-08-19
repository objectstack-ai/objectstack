// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { validateRecord, normalizeMultiValueFields, coerceBooleanFields, ValidationError } from './record-validator.js';

/**
 * Required-field validation, with the autonumber exemption (#1603).
 *
 * `autonumber` values are runtime-owned — the SQL driver assigns them from a
 * persistent sequence AFTER record-validation runs — so a missing value on an
 * insert must NOT be reported as a client "required" error.
 */
describe('validateRecord — required + autonumber exemption', () => {
  const schema = {
    fields: {
      title: { type: 'text', required: true },
      record_no: { type: 'autonumber', required: true, format: 'REC-{0000}' },
    },
  };

  it('does NOT reject a missing required autonumber on insert', () => {
    // title supplied, record_no omitted → only the autonumber is missing.
    expect(() => validateRecord(schema, { title: 'Hello' }, 'insert')).not.toThrow();
  });

  it('still rejects a missing required NON-autonumber field on insert', () => {
    expect(() => validateRecord(schema, { record_no: 'REC-0001' }, 'insert')).toThrow(/title/i);
  });

  it('accepts an explicitly-provided autonumber value', () => {
    // NOT a licence for clients to supply record numbers — since #5503 the
    // engine strips a non-system caller's value BEFORE this validator runs, so
    // the only writes that still arrive here carrying one are the exempt ones
    // (`isSystem` seed replay / migration, a `preserveAudit` historical import,
    // or a hook-computed stamp). This pins that those are not then rejected by
    // the validator instead. The write-path ownership itself is pinned in
    // `engine-autonumber-runtime-owned.test.ts`.
    expect(() =>
      validateRecord(schema, { title: 'Hello', record_no: 'REC-0042' }, 'insert'),
    ).not.toThrow();
  });
});

/**
 * `Field.time` is a wall-clock time-of-day, not an instant. The old validator
 * reused the date/datetime branch (`Date.parse`), which is `NaN` for every
 * bare time string — so a `time` field rejected ALL valid values (found
 * driving the showcase field-zoo). It must accept `HH:MM` / `HH:MM:SS`.
 */
describe('validateRecord — time field accepts time-of-day', () => {
  const schema = { fields: { at: { type: 'time' } } };

  for (const v of ['14:30', '09:05:30', '23:59', '00:00:00', '14:30:00Z', '14:30:00.500', '08:15:00+02:00']) {
    it(`accepts ${v}`, () => {
      expect(() => validateRecord(schema, { at: v }, 'insert')).not.toThrow();
    });
  }

  it('accepts a full ISO datetime for a time field (lenient)', () => {
    expect(() => validateRecord(schema, { at: '2026-06-17T14:30:00Z' }, 'insert')).not.toThrow();
  });

  for (const v of ['25:00', '14:60', 'not-a-time', '14']) {
    it(`rejects ${v}`, () => {
      expect(() => validateRecord(schema, { at: v }, 'insert')).toThrow(/must be a valid time/i);
    });
  }

  it('does NOT regress date/datetime (still ISO-parsed)', () => {
    const ds = { fields: { d: { type: 'date' }, dt: { type: 'datetime' } } };
    expect(() => validateRecord(ds, { d: '2026-06-17', dt: '2026-06-17T10:00:00Z' }, 'insert')).not.toThrow();
    expect(() => validateRecord(ds, { d: 'not-a-date' }, 'insert')).toThrow(/must be a valid date/i);
  });
});

/**
 * Multi-value field shape enforcement + scalar normalization (#2552).
 *
 * A multiselect (and every other array-shaped field) used to accept a lone
 * scalar and store it VERBATIM — `PATCH { labels: "frontend" }` returned 200
 * and read back as a string, corrupting the column for every consumer that
 * expects an array (found via the console bulk-edit dialog, which pre-#2186
 * sent scalars for multi params). `select`+`multiple` was worse: a legal
 * ARRAY was stringified to "a,b" and rejected as invalid_option.
 */
describe('normalizeMultiValueFields — scalar → single-element array', () => {
  const schema = {
    fields: {
      labels: { type: 'multiselect', options: ['frontend', 'backend', 'design'] },
      tags: { type: 'tags' },
      channels: { type: 'select', multiple: true, options: ['email', 'sms'] },
      team_members: { type: 'lookup', multiple: true },
      // Field.user expands to type 'user' at runtime (NOT 'lookup') — the
      // showcase team_members regression that motivated widening the type set.
      watchers: { type: 'user', multiple: true, reference: 'sys_user' },
      attachments: { type: 'file', multiple: true },
      status: { type: 'select', options: ['active', 'done'] },
      owner: { type: 'lookup' },
      assignee: { type: 'user' },
    },
  };

  it('wraps a scalar for multiselect / tags / select+multiple / lookup+multiple / user+multiple / file+multiple', () => {
    const data: Record<string, unknown> = {
      labels: 'frontend',
      tags: 'urgent',
      channels: 'email',
      team_members: 'user-1',
      watchers: 'user-2',
      attachments: 'file-key-1',
    };
    normalizeMultiValueFields(schema, data);
    expect(data).toEqual({
      labels: ['frontend'],
      tags: ['urgent'],
      channels: ['email'],
      team_members: ['user-1'],
      watchers: ['user-2'],
      attachments: ['file-key-1'],
    });
  });

  it('leaves arrays, null/undefined, and single-value fields untouched', () => {
    const data: Record<string, unknown> = {
      labels: ['frontend', 'design'],
      tags: null,
      status: 'active',
      owner: 'user-1',
      assignee: 'user-2',
    };
    normalizeMultiValueFields(schema, data);
    expect(data).toEqual({
      labels: ['frontend', 'design'],
      tags: null,
      status: 'active',
      owner: 'user-1',
      assignee: 'user-2',
    });
  });

  it('does NOT wrap non-scalar junk (left for validateRecord to reject)', () => {
    const data: Record<string, unknown> = { labels: { nested: true } };
    normalizeMultiValueFields(schema, data);
    expect(data.labels).toEqual({ nested: true });
  });
});

describe('validateRecord — multi-value fields must be arrays', () => {
  const schema = {
    fields: {
      labels: { type: 'multiselect', options: ['frontend', 'backend'] },
      tags: { type: 'tags' },
      channels: { type: 'select', multiple: true, options: ['email', 'sms'] },
      team_members: { type: 'lookup', multiple: true },
      watchers: { type: 'user', multiple: true, reference: 'sys_user' },
      attachments: { type: 'file', multiple: true },
      status: { type: 'select', options: ['active', 'done'] },
    },
  };

  it('rejects a raw (un-normalized) scalar with invalid_type', () => {
    for (const payload of [
      { labels: 'frontend' },
      { tags: 'urgent' },
      { channels: 'email' },
      { team_members: 'user-1' },
      { watchers: 'user-1' },
      { attachments: 'file-key-1' },
    ]) {
      expect(() => validateRecord(schema, payload, 'update')).toThrow(/must be an array/i);
    }
  });

  it('rejects a plain-object shape with invalid_type', () => {
    expect(() => validateRecord(schema, { labels: { nested: true } }, 'update')).toThrow(/must be an array/i);
    expect(() => validateRecord(schema, { team_members: { id: 'u1' } }, 'update')).toThrow(/must be an array/i);
  });

  it('accepts arrays (including for select+multiple, previously mis-rejected)', () => {
    expect(() =>
      validateRecord(
        schema,
        { labels: ['frontend'], tags: ['a', 'b'], channels: ['email', 'sms'], team_members: ['u1', 'u2'], watchers: ['u1'], attachments: ['k1', 'k2'] },
        'update',
      ),
    ).not.toThrow();
  });

  it('still validates array ELEMENTS against options', () => {
    expect(() => validateRecord(schema, { labels: ['nope'] }, 'update')).toThrow(/is not one of/i);
    expect(() => validateRecord(schema, { channels: ['fax'] }, 'update')).toThrow(/is not one of/i);
  });

  it('does NOT regress single select / radio', () => {
    expect(() => validateRecord(schema, { status: 'active' }, 'update')).not.toThrow();
    expect(() => validateRecord(schema, { status: 'nope' }, 'update')).toThrow(/must be one of/i);
  });
});

/**
 * The top-level `ValidationError.message` is what generic UI surfaces (the
 * console's save-error toast, CLI output) display verbatim — it must carry
 * the HUMAN per-field messages, not a `field (code)` digest. Regression for
 * the rule-violation case: an author-written localized rule `message`
 * ("最小水深不能大于最大水深。") used to be buried in `fields[]` while the
 * toast showed "Validation failed for 1 field(s): _record (rule_violation)".
 */
describe('ValidationError — top-level message is human-readable', () => {
  it('uses each field error message verbatim', () => {
    const err = new ValidationError([
      { field: '_record', code: 'rule_violation', message: '最小水深不能大于最大水深。' },
    ]);
    expect(err.message).toBe('最小水深不能大于最大水深。');
  });

  it('joins multiple field messages', () => {
    const err = new ValidationError([
      { field: 'title', code: 'required', message: 'title is required' },
      { field: '_record', code: 'rule_violation', message: '最小水深不能大于最大水深。' },
    ]);
    expect(err.message).toBe('title is required; 最小水深不能大于最大水深。');
  });

  it('falls back to `field (code)` when a message is blank', () => {
    const err = new ValidationError([
      { field: '_record', code: 'rule_violation', message: '' },
    ]);
    expect(err.message).toBe('_record (rule_violation)');
  });

  it('still exposes machine-readable fields[] for programmatic handling', () => {
    const err = new ValidationError([
      { field: '_record', code: 'rule_violation', message: 'boom' },
    ]);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toEqual([
      { field: '_record', code: 'rule_violation', message: 'boom' },
    ]);
  });
});

describe('coerceBooleanFields — SQLite 0/1 → real booleans', () => {
  const schema = {
    fields: {
      is_escalated: { type: 'boolean' },
      is_closed: { type: 'boolean' },
      active: { type: 'boolean' },
      name: { type: 'text' },
      priority: { type: 'select', options: ['low', 'critical'] },
      count: { type: 'number' },
    },
  };

  it('coerces integer 0/1 on boolean fields, leaves others untouched', () => {
    const row = { is_escalated: 1, is_closed: 0, name: 'Case', priority: 'critical', count: 5 };
    const out = coerceBooleanFields(schema, row);
    expect(out.is_escalated).toBe(true);
    expect(out.is_closed).toBe(false);
    expect(out.name).toBe('Case');
    expect(out.priority).toBe('critical');
    expect(out.count).toBe(5);
  });

  it('fixes the incident predicate: `is_escalated != true` after coercion', () => {
    const raw = { is_escalated: 1 };
    // Pre-coercion: an int 1 is NOT === true (the bug).
    expect((raw.is_escalated as unknown) !== true).toBe(true);
    const out = coerceBooleanFields(schema, raw);
    // Post-coercion: the guard correctly suppresses re-fire.
    expect(out.is_escalated !== true).toBe(false);
  });

  it('coerces string forms too', () => {
    expect(coerceBooleanFields(schema, { active: '1' }).active).toBe(true);
    expect(coerceBooleanFields(schema, { active: 'true' }).active).toBe(true);
    expect(coerceBooleanFields(schema, { active: '0' }).active).toBe(false);
    expect(coerceBooleanFields(schema, { active: 'false' }).active).toBe(false);
  });

  it('preserves null/undefined (nullable boolean stays null, not false)', () => {
    const out = coerceBooleanFields(schema, { is_escalated: null, is_closed: undefined });
    expect(out.is_escalated).toBe(null);
    expect(out.is_closed).toBe(undefined);
  });

  it('leaves real booleans and unrecognised strings as-is; no copy when nothing changes', () => {
    expect(coerceBooleanFields(schema, { active: true }).active).toBe(true);
    expect(coerceBooleanFields(schema, { active: 'maybe' }).active).toBe('maybe');
    const noBool = { name: 'x', count: 2 };
    expect(coerceBooleanFields(schema, noBool)).toBe(noBool); // same ref — untouched
  });

  it('is null/empty-safe', () => {
    expect(coerceBooleanFields(undefined, { a: 1 } as any)).toEqual({ a: 1 });
    expect(coerceBooleanFields(schema, null as any)).toBe(null);
  });
});

/**
 * `url` fields (e.g. `sys_user.image`, a Field.url) must accept relative and
 * authority-less URLs, not just `scheme://`.
 *
 * The load-bearing case is the root-relative form the platform's OWN storage
 * service returns for an uploaded file: the console avatar uploader writes
 * `sys_user.image = /api/v1/storage/files/<id>`. Before the fix that failed
 * `invalid_url` and, on the better-auth `update-user` path, surfaced as a raw
 * HTTP 500 — the exact avatar-upload bug users hit. `data:`/`blob:` inline
 * forms are accepted too.
 */
describe('validateRecord — url field accepts relative + inline URLs', () => {
  const schema = { fields: { image: { type: 'url', required: false } } };

  it('accepts a root-relative storage URL (the real avatar-upload value)', () => {
    expect(() =>
      validateRecord(
        schema,
        { image: '/api/v1/storage/files/cb02e85b-33f3-4bd1-88e4-b7b706ff856a' },
        'update',
      ),
    ).not.toThrow();
  });

  it('accepts a protocol-relative URL', () => {
    expect(() =>
      validateRecord(schema, { image: '//cdn.example/a.png' }, 'update'),
    ).not.toThrow();
  });

  it('accepts a base64 data: URI', () => {
    expect(() =>
      validateRecord(
        schema,
        { image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
        'update',
      ),
    ).not.toThrow();
  });

  it('accepts a blob: object-URL', () => {
    expect(() =>
      validateRecord(schema, { image: 'blob:https://app.example/8f3c-1a2b' }, 'update'),
    ).not.toThrow();
  });

  it('still accepts a normal scheme:// URL', () => {
    expect(() =>
      validateRecord(schema, { image: 'https://cdn.example/a.png' }, 'update'),
    ).not.toThrow();
  });

  it('still rejects a bare non-URL string (no scheme, no leading slash)', () => {
    expect(() => validateRecord(schema, { image: 'notaurl' }, 'update')).toThrow(/valid URL/i);
  });
});

/**
 * ADR-0104 D1 — value-shape contract for previously-opaque types.
 *
 * Warn-first rollout: a shape violation on reference/file/structured-JSON
 * types logs (once per field) and passes; `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1`
 * turns it into a normal invalid_type rejection.
 */
describe('validateRecord — ADR-0104 value shapes (warn-first / strict)', () => {
  const schema = {
    fields: {
      account: { type: 'lookup', reference: 'accounts' },
      geo: { type: 'location' },
      doc: { type: 'file' },
      dims: { type: 'vector' },
    },
  };

  const withStrict = (fn: () => void) => {
    process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED = '1';
    try { fn(); } finally { delete process.env.OS_DATA_VALUE_SHAPE_STRICT_ENABLED; }
  };

  it('accepts contract-conformant values in both modes', () => {
    const data = {
      account: 'acc_0001',
      geo: { lat: 37.77, lng: -122.42 },
      // The STORED form of a media field is an opaque sys_file id (ADR-0104 D3
      // wave 2); the inline blob is now the expanded READ form.
      doc: 'file_01HXYZ',
      dims: [0.1, 0.2],
    };
    expect(() => validateRecord(schema, { ...data }, 'update')).not.toThrow();
    withStrict(() => expect(() => validateRecord(schema, { ...data }, 'update')).not.toThrow());
  });

  it('warn-first keeps a legacy inline blob writable until strict is opted into', () => {
    // The migration path that makes narrowing the stored form safe to ship: a
    // not-yet-backfilled row still saves and the author gets a value-shape
    // warning naming the field, rather than the write failing on data that was
    // valid when it was written.
    const legacy = { doc: { url: 'https://cdn/f.pdf', name: 'f.pdf', size: 1024 } };
    expect(() => validateRecord(schema, { ...legacy }, 'update')).not.toThrow();
    withStrict(() => expect(() => validateRecord(schema, { ...legacy }, 'update')).toThrow());
  });

  it('warn-first: malformed shapes pass by default (legacy rows must not strand records)', () => {
    expect(() => validateRecord(schema, { geo: { latitude: 1, longitude: 2 } }, 'update')).not.toThrow();
    expect(() => validateRecord(schema, { account: { id: 'acc_1' } }, 'update')).not.toThrow();
  });

  it('strict: malformed shapes reject with invalid_type', () => {
    withStrict(() => {
      try {
        validateRecord(schema, { geo: { latitude: 37.77, longitude: -122.42 } }, 'update');
        expect.unreachable('expected ValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(ValidationError);
        const err = e as ValidationError;
        expect(err.fields[0]?.field).toBe('geo');
        expect(err.fields[0]?.code).toBe('invalid_type');
      }
      // expanded-form object at a stored-form position (unexpanded write)
      expect(() => validateRecord(schema, { account: { id: 'acc_1', name: 'Acme' } }, 'update')).toThrow(ValidationError);
      // scalar at a vector
      expect(() => validateRecord(schema, { dims: 'not-a-vector' }, 'update')).toThrow(ValidationError);
      // file: id/url string AND inline object both remain legal pre-D3
      expect(() => validateRecord(schema, { doc: 'file_01HXYZ' }, 'update')).not.toThrow();
      expect(() => validateRecord(schema, { doc: 42 }, 'update')).toThrow(ValidationError);
    });
  });
});

/**
 * #3617 / #3438 — media value shapes enforce per DEPLOYMENT, not per release.
 *
 * A verified deployment has RUN the file-as-reference migration and had its
 * ownership ledger reconciled, so it has been shown to hold no legacy media
 * values. Nothing about that migration vouches for a `lookup` or `location`
 * value, so those classes keep their own (unchanged) warn-first rollout —
 * gating them on this flag would borrow evidence for a fact it does not cover.
 */
describe('validateRecord — media value shapes gate on the deployment flag (#3617)', () => {
  const schema = {
    fields: {
      doc: { type: 'file' },
      cover: { type: 'image' },
      account: { type: 'lookup', reference: 'accounts' },
      geo: { type: 'location' },
    },
  };
  // A legacy inline blob — precisely what the migration converts.
  const legacyMedia = { doc: { url: 'https://cdn/f.pdf', name: 'f.pdf' } };
  const malformedNonMedia = { geo: { latitude: 1, longitude: 2 } };

  const strict = { mediaValueShapeStrict: true };

  const withEnv = (key: string, fn: () => void) => {
    process.env[key] = '1';
    try { fn(); } finally { delete process.env[key]; }
  };

  it('unverified deployment (the default): media stays warn-first', () => {
    expect(() => validateRecord(schema, { ...legacyMedia }, 'update')).not.toThrow();
    expect(() => validateRecord(schema, { ...legacyMedia }, 'update', {})).not.toThrow();
    expect(() =>
      validateRecord(schema, { ...legacyMedia }, 'update', { mediaValueShapeStrict: false }),
    ).not.toThrow();
  });

  it('verified deployment: a malformed media value rejects with invalid_type', () => {
    try {
      validateRecord(schema, { ...legacyMedia }, 'update', strict);
      expect.unreachable('expected ValidationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.fields[0]?.field).toBe('doc');
      expect(err.fields[0]?.code).toBe('invalid_type');
    }
    // and the conformant reference form still passes
    expect(() => validateRecord(schema, { doc: 'file_01HXYZ', cover: 'file_02' }, 'update', strict)).not.toThrow();
  });

  /**
   * The whole reason for splitting #3438: a verified file migration is not
   * evidence about lookup/location values, so it must not start rejecting them.
   */
  it('verified deployment does NOT flip non-media classes', () => {
    expect(() => validateRecord(schema, { ...malformedNonMedia }, 'update', strict)).not.toThrow();
    expect(() => validateRecord(schema, { account: { id: 'acc_1' } }, 'update', strict)).not.toThrow();
  });

  it('the blanket opt-in still forces media strict on an unverified deployment', () => {
    withEnv('OS_DATA_VALUE_SHAPE_STRICT_ENABLED', () => {
      expect(() => validateRecord(schema, { ...legacyMedia }, 'update')).toThrow(ValidationError);
    });
  });

  it('OS_ALLOW_LAX_MEDIA_VALUES re-opens media on a verified deployment', () => {
    withEnv('OS_ALLOW_LAX_MEDIA_VALUES', () => {
      expect(() => validateRecord(schema, { ...legacyMedia }, 'update', strict)).not.toThrow();
    });
  });

  /**
   * A contradictory configuration lands on the lenient side: a warning nobody
   * reads costs less than an app that stops writing.
   */
  it('opt-out beats opt-in when both are set', () => {
    withEnv('OS_DATA_VALUE_SHAPE_STRICT_ENABLED', () => {
      withEnv('OS_ALLOW_LAX_MEDIA_VALUES', () => {
        expect(() => validateRecord(schema, { ...legacyMedia }, 'update', strict)).not.toThrow();
      });
    });
  });

  it('applies on insert too, not only update', () => {
    expect(() => validateRecord(schema, { ...legacyMedia }, 'insert', strict)).toThrow(ValidationError);
    expect(() => validateRecord(schema, { ...legacyMedia }, 'insert')).not.toThrow();
  });
});

/**
 * ADR-0113 — `required` is a write-time contract with non-regression update
 * semantics: an insert must provide the value; an update may not null it OUT;
 * an update that omits the field entirely never 400s (legacy null rows rest).
 */
describe('validateRecord — ADR-0113 required write contract on update', () => {
  const schema: any = {
    fields: {
      title: { type: 'text', required: true },
      notes: { type: 'textarea' },
    },
  };

  it('rejects an explicit null-out of a required field on update', () => {
    expect(() => validateRecord(schema, { title: null }, 'update')).toThrow(/required and cannot be cleared/);
  });
  it('rejects an explicit empty-string clear too', () => {
    expect(() => validateRecord(schema, { title: '' }, 'update')).toThrow(/required and cannot be cleared/);
  });
  it('an update that omits the required field passes — legacy rows rest', () => {
    expect(() => validateRecord(schema, { notes: 'touched only this' }, 'update')).not.toThrow();
  });
  it('an update that provides a value passes', () => {
    expect(() => validateRecord(schema, { title: 'fixed' }, 'update')).not.toThrow();
  });
  it('autonumber stays exempt on update as on insert', () => {
    const s: any = { fields: { rec_no: { type: 'autonumber', required: true, format: 'R-{0000}' } } };
    expect(() => validateRecord(s, { rec_no: null }, 'update')).not.toThrow();
  });
});

/**
 * #9476 — the enforcement half of the #9447 maintainer ruling (2026-08-18):
 * `required` on a multi-value field means NON-EMPTY array. The empty set is
 * representable — it reads back as `[]`, never `null` — so `required` judges
 * emptiness: an explicit `[]` is an empty value exactly as `null` / `''` are.
 *
 * Scope is the spec's own multi-value predicate (`isMultiValueField`,
 * ADR-0104 D1): inherently-multi option types, plus multi-capable types
 * flagged `multiple: true`. Structured-JSON types stay OUT — `[]` there is a
 * legitimate document, not an emptied set (pinned below).
 *
 * Envelope: `ValidationError` (`code: 'VALIDATION_FAILED'`) carrying a
 * `fields[]` entry with `code: 'required'` — the class the REST layer maps
 * to HTTP 400 (packages/rest `error-response.ts`), exactly as every other
 * required refusal already travels.
 */
describe('validateRecord — required judges array emptiness on multi-value fields (#9476)', () => {
  const schema: any = {
    fields: {
      members: { type: 'lookup', reference: 'sys_user', multiple: true, required: true },
    },
  };

  it('INSERT: `[]` on a required `multiple: true` lookup is rejected — full envelope pin', () => {
    let err: any;
    try {
      validateRecord(schema, { members: [] }, 'insert');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_FAILED'); // → HTTP 400 via rest error-response mapping
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'members', code: 'required' });
    expect(err.fields[0].message).toMatch(/is required/);
  });

  it('UPDATE: supplying `[]` for a required multi-value field is an explicit clear — rejected', () => {
    let err: any;
    try {
      validateRecord(schema, { members: [] }, 'update');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'members', code: 'required' });
    // The clear-out case keeps its DISTINCT sentence (`required_cleared`).
    expect(err.fields[0].message).toMatch(/required and cannot be cleared/);
  });

  it('control: a populated array still lands on insert AND update — the check must not over-fire', () => {
    expect(() => validateRecord(schema, { members: ['u1'] }, 'insert')).not.toThrow();
    expect(() => validateRecord(schema, { members: ['u1', 'u2'] }, 'update')).not.toThrow();
  });

  it('control: `null` keeps its two existing reasons — `required` on insert, `required_cleared` on update', () => {
    let ins: any;
    let upd: any;
    try {
      validateRecord(schema, { members: null }, 'insert');
    } catch (e) {
      ins = e;
    }
    try {
      validateRecord(schema, { members: null }, 'update');
    } catch (e) {
      upd = e;
    }
    expect(ins).toBeInstanceOf(ValidationError);
    expect(ins.fields[0]).toMatchObject({ field: 'members', code: 'required' });
    expect(ins.fields[0].message).toMatch(/is required/);
    expect(ins.fields[0].message).not.toMatch(/cannot be cleared/);
    expect(upd).toBeInstanceOf(ValidationError);
    expect(upd.fields[0]).toMatchObject({ field: 'members', code: 'required' });
    expect(upd.fields[0].message).toMatch(/required and cannot be cleared/);
  });

  it('an inherently-multi option type (`multiselect`) is judged the same way', () => {
    const s: any = { fields: { labels: { type: 'multiselect', required: true, options: ['a', 'b'] } } };
    expect(() => validateRecord(s, { labels: [] }, 'insert')).toThrow(/is required/);
    expect(() => validateRecord(s, { labels: ['a'] }, 'insert')).not.toThrow();
  });

  it('control: `[]` on a NON-required multi-value field still passes — emptiness is only judged under `required`', () => {
    const s: any = { fields: { accounts: { type: 'lookup', reference: 'acct', multiple: true } } };
    expect(() => validateRecord(s, { accounts: [] }, 'insert')).not.toThrow();
    expect(() => validateRecord(s, { accounts: [] }, 'update')).not.toThrow();
  });

  it('control: an UPDATE that omits the required multi-value field never 400s — legacy rows rest', () => {
    const s: any = { fields: { members: schema.fields.members, notes: { type: 'textarea' } } };
    expect(() => validateRecord(s, { notes: 'touched only this' }, 'update')).not.toThrow();
  });

  it('control: structured JSON stays out — `[]` on a required `json` field is a document, not an emptied set', () => {
    const s: any = { fields: { payload: { type: 'json', required: true } } };
    expect(() => validateRecord(s, { payload: [] }, 'insert')).not.toThrow();
    expect(() => validateRecord(s, { payload: [] }, 'update')).not.toThrow();
  });
});

/**
 * #3957 — a rejected write must name the field the way the USER knows it, in
 * the language they read, and must hand a client the constraint as data.
 *
 * Before this, `validateOne` string-concatenated the API field name into a
 * hardcoded English template: a `zh-CN` user importing a bad row read
 * `penalty_amount must be ≥ 0` for a field declared `label: '处罚金额'`. The
 * form layer localized the SAME constraint correctly (native `min`), so the
 * language flipped depending on which layer caught the value.
 */
describe('validateRecord — messages name the field by its label (#3957)', () => {
  const schema = {
    fields: {
      penalty_amount: { type: 'currency', label: '处罚金额', min: 0 },
      remark: { type: 'text', label: '备注', maxLength: 512 },
    },
  };

  const fieldsOf = (data: Record<string, unknown>, mode: 'insert' | 'update' = 'update', options = {}) => {
    try {
      validateRecord(schema, data, mode, options);
    } catch (e) {
      return (e as ValidationError).fields;
    }
    throw new Error('expected a ValidationError');
  };

  it('uses the declared label, not the API name, even with no locale', () => {
    const [err] = fieldsOf({ penalty_amount: -5 });
    expect(err.message).toBe('处罚金额 must be ≥ 0');
    expect(err.message).not.toContain('penalty_amount');
    // The API name stays available for the UI to focus the right input.
    expect(err.field).toBe('penalty_amount');
    expect(err.label).toBe('处罚金额');
  });

  it('renders the whole sentence in the caller’s locale', () => {
    const [err] = fieldsOf({ penalty_amount: -5 }, 'update', {
      messages: { locale: 'zh-CN', objectName: 'mes_settlement' },
    });
    expect(err.message).toBe('处罚金额必须大于或等于 0');
  });

  it('falls back to the API name only when no label is declared', () => {
    const bare = { fields: { qty: { type: 'number', min: 1 } } };
    try {
      validateRecord(bare, { qty: 0 }, 'update');
    } catch (e) {
      const [err] = (e as ValidationError).fields;
      expect(err.message).toBe('qty must be ≥ 1');
      expect(err.label).toBe('qty');
    }
  });

  /**
   * Option 2 of the issue: the bound as a discrete value, so a custom client
   * formats its own text instead of parsing the sentence. Rides ADR-0114's
   * `constraint` position rather than a second parallel bag.
   */
  it('carries the constraint as discrete values', () => {
    expect(fieldsOf({ penalty_amount: -5 })[0]).toMatchObject({
      code: 'min_value',
      constraint: { min: 0 },
    });
    expect(fieldsOf({ remark: 'x'.repeat(3000) })[0]).toMatchObject({
      code: 'max_length',
      constraint: { maxLength: 512, actual: 3000 },
    });
  });

  it('localizes the whole built-in catalog, not just the range codes', () => {
    const zoo = {
      fields: {
        title: { type: 'text', label: '标题', required: true },
        email: { type: 'email', label: '邮箱' },
        site: { type: 'url', label: '网址' },
        tel: { type: 'phone', label: '电话' },
        qty: { type: 'number', label: '数量' },
        flag: { type: 'boolean', label: '标记' },
        due: { type: 'date', label: '截止日' },
        at: { type: 'datetime', label: '发生时间' },
        clock: { type: 'time', label: '打卡时间' },
        stage: { type: 'select', label: '阶段', options: ['a', 'b'] },
        tags: { type: 'multiselect', label: '标签', options: ['a', 'b'] },
      },
    };
    const msgs = { locale: 'zh-CN', objectName: 'zoo' };
    const one = (data: Record<string, unknown>, mode: 'insert' | 'update' = 'update') => {
      try {
        validateRecord(zoo, data, mode, { messages: msgs });
      } catch (e) {
        return (e as ValidationError).fields[0];
      }
      throw new Error('expected a ValidationError');
    };

    expect(one({}, 'insert').message).toBe('标题不能为空');
    expect(one({ email: 'nope' }).message).toBe('邮箱必须是有效的电子邮件地址');
    expect(one({ site: 'notaurl' }).message).toBe('网址必须是有效的 URL(scheme://...)');
    expect(one({ tel: 'x' }).message).toBe('电话必须是有效的电话号码');
    expect(one({ qty: 'abc' }).message).toBe('数量必须是数字');
    expect(one({ flag: 'maybe' }).message).toBe('标记必须是 true 或 false');
    expect(one({ due: 'not-a-date' }).message).toBe('截止日必须是有效的日期(ISO-8601)');
    // Same wire code as `date`, different sentence.
    expect(one({ at: 'not-a-date' }).message).toBe('发生时间必须是有效的日期时间(ISO-8601)');
    expect(one({ at: 'not-a-date' }).code).toBe('invalid_date');
    expect(one({ clock: '99:99' }).message).toBe('打卡时间必须是有效的时间(HH:MM 或 HH:MM:SS)');
    expect(one({ stage: 'z' }).message).toBe('阶段必须是以下值之一:a, b');
    expect(one({ tags: ['a', 'z'] }).message).toBe('标签:“z”不在允许的取值范围内:a, b');
    expect(one({ tags: 'a,b' as unknown as string[] }).message).toBe('标签必须是数组');
  });

  /**
   * The declared label is only the SOURCE language. An app whose metadata is
   * authored in English but shipped with a `zh-CN` bundle must read Chinese —
   * the case the issue reported as "has a zh-CN translation. Neither is used".
   */
  it('prefers the translated label over the declared one', () => {
    const en = { fields: { penalty_amount: { type: 'currency', label: 'Penalty Amount', min: 0 } } };
    const translate = (key: string, locale: string) =>
      key === 'objects.mes_settlement.fields.penalty_amount.label' && locale === 'zh-CN'
        ? '处罚金额'
        : key;
    try {
      validateRecord(en, { penalty_amount: -5 }, 'update', {
        messages: { locale: 'zh-CN', objectName: 'mes_settlement', translate },
      });
    } catch (e) {
      const [err] = (e as ValidationError).fields;
      expect(err.message).toBe('处罚金额必须大于或等于 0');
      expect(err.label).toBe('处罚金额');
    }
  });

  it('survives a throwing i18n service instead of 500-ing the write', () => {
    const translate = () => { throw new Error('i18n exploded'); };
    const [err] = fieldsOf({ penalty_amount: -5 }, 'update', {
      messages: { locale: 'zh-CN', objectName: 'mes_settlement', translate },
    });
    expect(err.message).toBe('处罚金额必须大于或等于 0');
  });

  /**
   * The top-level `ValidationError.message` is what a toast shows. It joins the
   * per-field messages, so localizing them localizes it — no separate path.
   */
  it('the top-level message is localized too', () => {
    try {
      validateRecord(schema, { penalty_amount: -5, remark: 'x'.repeat(3000) }, 'update', {
        messages: { locale: 'zh-CN', objectName: 'mes_settlement' },
      });
    } catch (e) {
      expect((e as ValidationError).message).toBe(
        '处罚金额必须大于或等于 0; 备注长度不能超过 512 个字符(当前 3000 个)',
      );
    }
  });
});

/**
 * #7501 — a number field's declared `scale` is ENFORCED, by rejection.
 *
 * `scale` sat in the field contract next to `precision`/`min`/`max` (all
 * constraints) but had no validator branch at all: `{ scale: 0 }` accepted
 * `11.5` and stored it verbatim. Maintainer ruling 2026-08-11: enforce by
 * refusing (`max_scale`), NEVER by rounding — silent rounding is silently
 * altering data. Applies to new writes only; stored legacy values rest.
 *
 * The fixture is the issue's own repro declaration (`work_hours`).
 */
describe('validateRecord — number `scale` is enforced by rejection (#7501)', () => {
  const schema = {
    fields: {
      work_hours: {
        type: 'number', label: 'Max hours per shift',
        precision: 5, scale: 0, min: 1, max: 12,
      },
      rate: { type: 'number', label: 'Rate', scale: 2 },
      free: { type: 'number', label: 'Free' }, // no scale — unconstrained
    },
  };

  const fieldsOf = (data: Record<string, unknown>, mode: 'insert' | 'update' = 'insert', options = {}) => {
    try {
      validateRecord(schema, data, mode, options);
    } catch (e) {
      return (e as ValidationError).fields;
    }
    throw new Error('expected a ValidationError');
  };

  it('rejects the issue repro: 11.5 into scale: 0 — with the envelope, not just a throw', () => {
    const [err] = fieldsOf({ work_hours: 11.5 });
    expect(err).toMatchObject({
      field: 'work_hours',
      code: 'max_scale',
      constraint: { scale: 0, actual: 1 },
    });
    expect(err.message).toBe('Max hours per shift must have at most 0 decimal places (got 1)');
    // The thrown error is the VALIDATION_FAILED envelope REST maps to 400.
    try {
      validateRecord(schema, { work_hours: 11.5 }, 'insert');
      throw new Error('expected a ValidationError');
    } catch (e) {
      expect((e as ValidationError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('scale: 0 does NOT start refusing integers (the repro declaration keeps working)', () => {
    expect(() => validateRecord(schema, { work_hours: 12 }, 'insert')).not.toThrow();
    expect(() => validateRecord(schema, { work_hours: 1 }, 'update')).not.toThrow();
  });

  it('a value within a non-zero scale still writes; one past it is refused', () => {
    expect(() => validateRecord(schema, { rate: 3.25 }, 'insert')).not.toThrow();
    expect(() => validateRecord(schema, { rate: 3.2 }, 'insert')).not.toThrow();
    expect(() => validateRecord(schema, { rate: 3 }, 'insert')).not.toThrow();
    const [err] = fieldsOf({ rate: 3.256 });
    expect(err).toMatchObject({ code: 'max_scale', constraint: { scale: 2, actual: 3 } });
  });

  it('rejects on update too — the same branch runs for both modes', () => {
    const [err] = fieldsOf({ work_hours: 2.5 }, 'update');
    expect(err).toMatchObject({ field: 'work_hours', code: 'max_scale' });
  });

  it('string-carried numbers (a CSV cell) are judged after coercion, same as min/max', () => {
    const [err] = fieldsOf({ work_hours: '11.5' });
    expect(err).toMatchObject({ code: 'max_scale', constraint: { scale: 0, actual: 1 } });
    expect(() => validateRecord(schema, { work_hours: '11' }, 'insert')).not.toThrow();
  });

  it('exponent forms are normalized, not read as zero decimals', () => {
    const [err] = fieldsOf({ rate: 1e-7 }); // 0.0000001 — 7 places
    expect(err).toMatchObject({ code: 'max_scale', constraint: { scale: 2, actual: 7 } });
    // A positive exponent means an INTEGER — must not be refused.
    expect(() => validateRecord(schema, { work_hours: 1.2e1 }, 'insert')).not.toThrow();
  });

  it('min/max on the same field are unchanged — and outrank scale in report order', () => {
    // -1 violates min AND scale is fine (integer): still min_value, as before.
    const [minErr] = fieldsOf({ work_hours: -1 });
    expect(minErr).toMatchObject({ code: 'min_value', constraint: { min: 1 } });
    const [maxErr] = fieldsOf({ work_hours: 13 });
    expect(maxErr).toMatchObject({ code: 'max_value', constraint: { max: 12 } });
  });

  it('a field with no declared scale accepts any precision (no new default)', () => {
    expect(() => validateRecord(schema, { free: 0.123456789 }, 'insert')).not.toThrow();
  });

  it('a malformed declaration (non-integer or negative scale) is refused at AUTHORING time (#8321)', () => {
    // FLIPPED by #8321 (was: "stays unenforced"). `scale: 2.5` has no defined
    // meaning; inventing floor/round semantics here would be consumer-side
    // guessing (PD #12), so the runtime branch deliberately guarded on
    // `Number.isInteger && >= 0` — which left a typo'd declaration silently
    // inert. The producer now refuses it: FieldSchema rejects non-integer and
    // negative scale/precision at parse, so a malformed declaration can no
    // longer reach this validator through authored metadata.
    for (const [key, value, code] of [
      ['scale', 2.5, 'invalid_type'],
      ['scale', -1, 'too_small'],
      ['precision', 2.5, 'invalid_type'],
      ['precision', -1, 'too_small'],
    ] as const) {
      const result = FieldSchema.safeParse({ name: 'x', label: 'X', type: 'number', [key]: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.find((i) => i.path[0] === key)?.code).toBe(code);
      }
    }
    // Defense-in-depth is UNCHANGED: handed a raw malformed def that bypassed
    // the schema (a hand-built runtime schema object, not authored metadata),
    // the runtime still refuses to invent semantics — the declaration enforces
    // nothing rather than something the author never wrote.
    const bad = { fields: { x: { type: 'number', scale: 2.5 }, y: { type: 'number', scale: -1 } } };
    expect(() => validateRecord(bad, { x: 1.234, y: 5.5 }, 'insert')).not.toThrow();
  });

  it('renders the refusal fully localized (no half-translated sentence)', () => {
    const [err] = fieldsOf({ work_hours: 11.5 }, 'insert', {
      messages: { locale: 'zh-CN', objectName: 'shift' },
    });
    expect(err.message).toBe('Max hours per shift的小数位数不能超过 0 位(当前 1 位)');
  });
});
