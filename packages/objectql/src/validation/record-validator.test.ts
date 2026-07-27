// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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
