/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  getRecordDisplayName,
  deriveTitleField,
  isTitleEligibleField,
  formatTitleTemplate,
} from '../record-title';

describe('getRecordDisplayName — ADR-0079 repro', () => {
  // The exact repro from the bug: an object whose records carry their name in
  // `activity_name`, declaring NO displayNameField and NO titleFormat, plus a
  // non-title date field. Must derive the name via the `*_name` affix rule and
  // NOT render "Untitled".
  const activityObject = {
    fields: {
      activity_name: { type: 'text' },
      start_date: { type: 'date' },
    },
  };

  it('derives `activity_name` via the *_name affix rule (not "Untitled")', () => {
    const record = { id: 'x', activity_name: '夏日城市骑行夜' };
    expect(getRecordDisplayName(activityObject, record)).toBe('夏日城市骑行夜');
  });

  it('falls to `Record #<id>` (never bare "Untitled") when no title field resolves', () => {
    expect(getRecordDisplayName(activityObject, { id: 'x' })).toBe('Record #x');
  });

  it('yields bare "Untitled" only for a truly id-less record', () => {
    expect(getRecordDisplayName(activityObject, {})).toBe('Untitled');
  });
});

describe('getRecordDisplayName — *_name on the RECORD when objectDef is unusable (live gallery repro)', () => {
  // Browser test caught this: ObjectGallery calls getRecordDisplayName with an
  // objectDef whose `.fields` did NOT drive type-aware derivation (async-null,
  // a different fetched shape, …) AND a record without an obvious name-ish key,
  // so the resolver fell straight to bare "Untitled" — the `*_name` value was
  // sitting right there on the record. The record-key affix fallback fixes it.
  it('finds `activity_name` from the record when objectDef has no usable fields', () => {
    expect(getRecordDisplayName({}, { id: '1', activity_name: '夏日城市骑行夜', city: '上海' })).toBe('夏日城市骑行夜');
  });
  it('works with no objectDef at all (null) and even a record with no id', () => {
    expect(getRecordDisplayName(null, { activity_name: '西湖晨跑团' })).toBe('西湖晨跑团');
  });
  it('never lets a `*_id` / system key win the affix scan', () => {
    expect(
      getRecordDisplayName(null, { id: '1', owner_id: 'u1', organization_id: 'o1', activity_name: '外滩摄影漫步' }),
    ).toBe('外滩摄影漫步');
  });
  it('still floors to `Record #<id>` when the record has no name-ish key at all', () => {
    expect(getRecordDisplayName({}, { id: '7', amount: 100, created_at: '2026-01-01' })).toBe('Record #7');
  });
});

describe('getRecordDisplayName — precedence', () => {
  // ADR-0079 Phase 2: an explicitly-declared field outranks the legacy
  // render-only `titleFormat` template. The object declares BOTH a
  // `displayNameField` and a `titleFormat`; the declared field wins.
  it('1. declared displayNameField wins over a legacy titleFormat', () => {
    const obj = {
      titleFormat: '{first} {last}',
      displayNameField: 'name',
      fields: { name: { type: 'text' }, first: { type: 'text' }, last: { type: 'text' } },
    };
    const rec = { id: '1', name: 'Declared', first: 'Ada', last: 'Lovelace' };
    expect(getRecordDisplayName(obj, rec)).toBe('Declared');
  });

  // titleFormat is still honored when no declared field resolves (back-compat).
  it('1b. titleFormat still renders when no nameField/displayNameField is declared', () => {
    const obj = {
      titleFormat: '{first} {last}',
      fields: { first: { type: 'text' }, last: { type: 'text' } },
    };
    const rec = { id: '1', first: 'Ada', last: 'Lovelace' };
    expect(getRecordDisplayName(obj, rec)).toBe('Ada Lovelace');
  });

  it('2. displayNameField wins when no titleFormat', () => {
    const obj = {
      displayNameField: 'activity_name',
      fields: { activity_name: { type: 'text' }, title: { type: 'text' } },
    };
    // `title` would win derivation, but the declared field takes precedence.
    const rec = { id: '1', activity_name: 'Declared', title: 'Derived' };
    expect(getRecordDisplayName(obj, rec)).toBe('Declared');
  });

  it('2b. NAME_FIELD_KEY is accepted as an alias for displayNameField', () => {
    const obj = { NAME_FIELD_KEY: 'activity_name', fields: { activity_name: { type: 'text' } } };
    expect(getRecordDisplayName(obj, { id: '1', activity_name: 'Via alias' })).toBe('Via alias');
  });

  it('2c. skips displayNameField when empty on the record and derives instead', () => {
    const obj = {
      displayNameField: 'code',
      fields: { code: { type: 'text' }, subject: { type: 'text' } },
    };
    const rec = { id: '1', code: '   ', subject: 'Real Subject' };
    expect(getRecordDisplayName(obj, rec)).toBe('Real Subject');
  });

  it('0. explicit titleField option overrides object-level precedence', () => {
    const obj = { titleFormat: '{name}', fields: { name: { type: 'text' }, headline: { type: 'text' } } };
    const rec = { id: '1', name: 'FromFormat', headline: 'FromView' };
    expect(getRecordDisplayName(obj, rec, { titleField: 'headline' })).toBe('FromView');
  });

  it('0b. falls through when explicit titleField is empty on the record', () => {
    const obj = { fields: { name: { type: 'text' } } };
    const rec = { id: '1', name: 'Fallback', headline: '' };
    expect(getRecordDisplayName(obj, rec, { titleField: 'headline' })).toBe('Fallback');
  });

  it('4. custom fallback honored for id-less records', () => {
    expect(getRecordDisplayName({}, {}, { fallback: 'No name' })).toBe('No name');
  });

  it('handles a missing objectDef.fields gracefully (skips derivation)', () => {
    // displayNameField points at a field the record lacks → floor.
    expect(getRecordDisplayName({ displayNameField: 'name' }, { id: '7' })).toBe('Record #7');
    // No fields to derive from, but the record carries a standard `name` → the
    // record-level name probe (step 4b) resolves it (better than `Record #7`).
    expect(getRecordDisplayName(undefined, { id: '7', name: 'X' })).toBe('X');
    // …and with neither, it floors.
    expect(getRecordDisplayName(undefined, { id: '7' })).toBe('Record #7');
  });

  it('uses _id when id is absent', () => {
    expect(getRecordDisplayName({}, { _id: 'abc' })).toBe('Record #abc');
  });

  // Regression: a lightweight object (search candidate) that carries no
  // `fields` map must still resolve a standard `name`/`full_name` record
  // value, NOT fall to `Record #<id>`.
  //
  // objectui#6531 — this pin used to be spelled
  // `{ name: 'account', label: 'Account', titleField: 'name' }` under the name
  // "honors objectDef.titleField when set". It never measured that: `name` is
  // also a {@link NAME_ISH_RECORD_KEYS} entry, so step 4b answered it
  // identically with the step-0 `objectDef.titleField` read deleted. A pin that
  // passes for a reason unrelated to its own name is how an undeclared key
  // survives a rewrite, so the key is gone from the fixture and the real
  // negative pin lives in the "undeclared object-level titleField" block below.
  it('resolves a lightweight object with no `fields` map via the record name keys', () => {
    const obj = { name: 'account', label: 'Account' };
    expect(getRecordDisplayName(obj, { id: 'a1', name: 'Acme Corp' })).toBe('Acme Corp');
  });

  it('falls back to standard record name keys when fields are absent', () => {
    // No fields → no derivation; the `name`/`full_name`/… record probe catches it.
    expect(getRecordDisplayName({ name: 'account' }, { id: 'a1', name: 'Acme Corp' })).toBe('Acme Corp');
    expect(getRecordDisplayName({}, { id: 'c1', full_name: 'Ada Lovelace' })).toBe('Ada Lovelace');
    expect(getRecordDisplayName({}, { id: 'x', subject: 'Ticket' })).toBe('Ticket');
  });
});

describe('getRecordDisplayName — ADR-0079 Phase 2 (nameField canonical)', () => {
  // (a) nameField is the NEW canonical pointer and must win even when the object
  //     also carries a stale render-only titleFormat.
  it('resolves via nameField even when a stale titleFormat is present (nameField wins)', () => {
    const obj = {
      nameField: 'activity_name',
      titleFormat: '{wrong}',
      fields: { activity_name: { type: 'text' }, wrong: { type: 'text' } },
    };
    const rec = { id: '1', activity_name: '夏日城市骑行夜', wrong: 'STALE TEMPLATE' };
    expect(getRecordDisplayName(obj, rec)).toBe('夏日城市骑行夜');
  });

  it('nameField outranks the displayNameField alias', () => {
    const obj = {
      nameField: 'activity_name',
      displayNameField: 'legacy_name',
      fields: { activity_name: { type: 'text' }, legacy_name: { type: 'text' } },
    };
    const rec = { id: '1', activity_name: 'Canonical', legacy_name: 'Alias' };
    expect(getRecordDisplayName(obj, rec)).toBe('Canonical');
  });

  it('falls through to displayNameField when nameField is empty on the record', () => {
    const obj = {
      nameField: 'activity_name',
      displayNameField: 'legacy_name',
      fields: { activity_name: { type: 'text' }, legacy_name: { type: 'text' } },
    };
    const rec = { id: '1', activity_name: '   ', legacy_name: 'Alias' };
    expect(getRecordDisplayName(obj, rec)).toBe('Alias');
  });

  // (b) An object with ONLY a titleFormat (no nameField/displayNameField) still
  //     resolves via the template — back-compat preserved.
  it('back-compat: titleFormat-only object still resolves via the template', () => {
    const obj = {
      titleFormat: '{first} · {last}',
      fields: { first: { type: 'text' }, last: { type: 'text' } },
    };
    const rec = { id: '1', first: 'Ada', last: 'Lovelace' };
    expect(getRecordDisplayName(obj, rec)).toBe('Ada · Lovelace');
  });
});

describe('getRecordDisplayName — the undeclared object-level `titleField` (objectui#6531)', () => {
  // Producer census (objectui#6531): NOTHING puts `titleField` on an
  // object-shaped payload. `@objectstack/spec`'s object schema is a
  // `strictObject`, so the key is not merely undeclared — `ObjectSchema`
  // REJECTS it with `unrecognized_keys`, the same code a nonsense key gets,
  // while `nameField` / `displayNameField` / `titleFormat` parse. Reading it
  // here was therefore a consumer-side alias for a key no producer can ship
  // (AGENTS.md Commandment #0.1), ranked ABOVE the canonical `nameField` that
  // ADR-0079 Phase 2 made the record-title pointer.
  //
  // Undeclared at the object level ≠ undeclared everywhere: `titleField` is a
  // real, spec-declared VIEW key (`ui/CalendarConfig`, `ui/GalleryConfig`,
  // `ui/GanttConfig`, `ui/ListMapConfig`, `ui/ObjectKanbanProps`,
  // `ui/TimelineConfig`), and views hand it in as `options.titleField`. That
  // leg of step 0 is untouched — the second pin below is what keeps the
  // removal from over-reaching.

  it('does NOT consult `objectDef.titleField` — the declared `nameField` is the top of the ladder', () => {
    const obj = {
      name: 'account',
      nameField: 'name',
      // Undeclared, and rejected by `ObjectSchema.safeParse`. Before #6531 this
      // was read at step 0 and beat `nameField` outright.
      titleField: 'legacy_title',
      fields: { name: { type: 'text' }, legacy_title: { type: 'text' } },
    };
    const rec = { id: 'a1', name: 'Canonical Name', legacy_title: 'Undeclared Alias' };
    expect(getRecordDisplayName(obj, rec)).toBe('Canonical Name');
  });

  it('does NOT consult `objectDef.titleField` even when it is the ONLY pointer the object carries', () => {
    // No `nameField`, no `displayNameField`, no `titleFormat`, no `fields` map,
    // and `headline` is name-ish by NEITHER step-4b rung — not a
    // {@link NAME_ISH_RECORD_KEYS} entry, and no `*_name` / `*_title` / `name_*`
    // affix. So the undeclared key is the only thing left that could produce a
    // title. It must not: the resolver floors instead, which is the honest
    // answer for metadata the contract would have rejected outright.
    //
    // The field name matters and is load-bearing. This pin first used
    // `legacy_title`, which step 4b(ii)'s `*_title` affix rule answers on its
    // own — so it read as a failure of the removal when it was measuring the
    // fixture instead.
    const obj = { name: 'account', titleField: 'headline' };
    const rec = { id: 'a1', headline: 'Undeclared Alias', amount: 100 };
    expect(getRecordDisplayName(obj, rec)).toBe('Record #a1');
  });

  it('CONTROL: the DECLARED view-level `options.titleField` still wins at step 0', () => {
    // The half of step 0 that survives. A view's own `titleField` outranks the
    // object's canonical `nameField` by design — that is the author's
    // per-view choice, and it is a declared key on every view config.
    const obj = {
      name: 'account',
      nameField: 'name',
      fields: { name: { type: 'text' }, headline: { type: 'text' } },
    };
    const rec = { id: 'a1', name: 'Canonical Name', headline: 'From The View' };
    expect(getRecordDisplayName(obj, rec, { titleField: 'headline' })).toBe('From The View');
  });

  it('CONTROL: an object carrying the undeclared key still resolves through every declared rung', () => {
    // Removing the read must not disturb the rest of the ladder for an object
    // that happens to carry the stray key.
    const withAlias = {
      titleField: 'legacy_title',
      displayNameField: 'code',
      fields: { code: { type: 'text' }, legacy_title: { type: 'text' } },
    };
    expect(
      getRecordDisplayName(withAlias, { id: '1', code: 'ACC-1', legacy_title: 'Undeclared Alias' }),
    ).toBe('ACC-1');

    const withFormat = {
      titleField: 'legacy_title',
      titleFormat: '{code}',
      fields: { code: { type: 'text' }, legacy_title: { type: 'text' } },
    };
    expect(
      getRecordDisplayName(withFormat, { id: '1', code: 'ACC-1', legacy_title: 'Undeclared Alias' }),
    ).toBe('ACC-1');
  });
});

describe('deriveTitleField — memoization (per objectDef, not per record)', () => {
  it('returns the same derived field across repeated calls for one objectDef', () => {
    const obj = { fields: { activity_name: { type: 'text' }, start_date: { type: 'date' } } };
    const first = deriveTitleField(obj);
    expect(first).toBe('activity_name');
    // Repeated calls (the per-record hot path) return the identical result.
    for (let i = 0; i < 5; i++) expect(deriveTitleField(obj)).toBe('activity_name');
  });

  it('does NOT re-scan objectDef.fields after the first call (cached)', () => {
    // Lightweight spy: a `fields` map whose property reads are counted. After the
    // first deriveTitleField the cache must serve subsequent calls WITHOUT
    // touching `fields` again (zero further reads).
    let reads = 0;
    const fields = new Proxy(
      { activity_name: { type: 'text' }, start_date: { type: 'date' } } as Record<string, any>,
      {
        get(target, prop, receiver) {
          reads++;
          return Reflect.get(target, prop, receiver);
        },
        ownKeys(target) {
          reads++;
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, prop) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      },
    );
    const obj = { fields };

    expect(deriveTitleField(obj)).toBe('activity_name');
    const readsAfterFirst = reads;
    expect(readsAfterFirst).toBeGreaterThan(0); // the first scan touched fields

    for (let i = 0; i < 10; i++) deriveTitleField(obj);
    // No additional reads — every later call hit the WeakMap cache.
    expect(reads).toBe(readsAfterFirst);
  });

  it('memoizes an undefined result (object with no title-eligible field)', () => {
    let scans = 0;
    const obj = {
      get fields() {
        scans++;
        return { when: { type: 'date' }, qty: { type: 'number' } };
      },
    };
    expect(deriveTitleField(obj)).toBeUndefined();
    expect(deriveTitleField(obj)).toBeUndefined();
    // `fields` getter invoked exactly once → the cached `undefined` was reused.
    expect(scans).toBe(1);
  });

  it('keeps distinct objectDefs independent (no cross-contamination)', () => {
    const a = { fields: { subject: { type: 'text' } } };
    const b = { fields: { full_name: { type: 'text' } } };
    expect(deriveTitleField(a)).toBe('subject');
    expect(deriveTitleField(b)).toBe('full_name');
    expect(deriveTitleField(a)).toBe('subject');
  });

  it('does not cache primitives/null (computes uncached, no throw)', () => {
    expect(deriveTitleField(null)).toBeUndefined();
    expect(deriveTitleField(undefined)).toBeUndefined();
    expect(deriveTitleField('nope' as any)).toBeUndefined();
  });
});

describe('formatTitleTemplate — handlebars / double-brace', () => {
  it('renders double-brace {{field}} placeholders', () => {
    const obj = { titleFormat: '{{first_name}} {{last_name}}' };
    const rec = { id: 'c1', first_name: 'Ada', last_name: 'Lovelace' };
    expect(getRecordDisplayName(obj, rec)).toBe('Ada Lovelace');
  });

  it('renders {{ field }} with inner whitespace', () => {
    expect(formatTitleTemplate('{{ a }} - {{ b }}', { a: 'X', b: 'Y' })).toBe('X - Y');
  });

  it('still strips orphan separators around empty double-brace fields', () => {
    expect(formatTitleTemplate('{{full_name}} - {{company}}', { company: 'Acme' })).toBe('Acme');
  });
});

describe('deriveTitleField — ranking', () => {
  it('name-ish exact beats affix and declaration order', () => {
    const obj = { fields: { activity_name: { type: 'text' }, name: { type: 'text' }, note: { type: 'text' } } };
    expect(deriveTitleField(obj)).toBe('name');
  });

  it('honors NAME_ISH_EXACT priority order (title before label)', () => {
    const obj = { fields: { label: { type: 'text' }, title: { type: 'text' } } };
    expect(deriveTitleField(obj)).toBe('title');
  });

  it('name-ish affix beats plain declaration order', () => {
    const obj = { fields: { notes: { type: 'text' }, project_title: { type: 'text' } } };
    expect(deriveTitleField(obj)).toBe('project_title');
  });

  it('falls to first title-eligible field by declaration order', () => {
    const obj = { fields: { created: { type: 'datetime' }, amount: { type: 'currency' }, memo: { type: 'text' } } };
    expect(deriveTitleField(obj)).toBe('memo');
  });

  it('returns undefined when no title-eligible field exists', () => {
    const obj = { fields: { when: { type: 'date' }, qty: { type: 'number' }, ok: { type: 'boolean' } } };
    expect(deriveTitleField(obj)).toBeUndefined();
  });

  it('returns undefined when fields are absent', () => {
    expect(deriveTitleField({})).toBeUndefined();
    expect(deriveTitleField(undefined)).toBeUndefined();
  });

  it('supports the array field shape', () => {
    const obj = { fields: [{ name: 'when', type: 'date' }, { name: 'subject', type: 'text' }] };
    expect(deriveTitleField(obj)).toBe('subject');
  });
});

describe('isTitleEligibleField — type gate', () => {
  it.each([
    ['text', true],
    ['email', true],
    ['textarea', true],
    ['date', false],
    ['datetime', false],
    ['time', false],
    ['number', false],
    ['currency', false],
    ['percent', false],
    ['boolean', false],
    ['file', false],
    ['image', false],
    ['attachment', false],
    ['json', false],
    ['geolocation', false],
    ['select', false],
    ['multiselect', false],
    ['picklist', false],
    ['lookup', false],
    ['master_detail', false],
    ['autonumber', false],
    ['auto_number', false],
    ['phone', false],
  ])('type %s -> eligible=%s', (type, eligible) => {
    expect(isTitleEligibleField({ type })).toBe(eligible);
  });

  it('a typeless field is eligible (text-by-default)', () => {
    expect(isTitleEligibleField({})).toBe(true);
  });

  it('formula is eligible only when it returns text', () => {
    expect(isTitleEligibleField({ type: 'formula', data_type: 'text' })).toBe(true);
    expect(isTitleEligibleField({ type: 'formula', returnType: 'string' })).toBe(true);
    expect(isTitleEligibleField({ type: 'formula', data_type: 'number' })).toBe(false);
    expect(isTitleEligibleField({ type: 'formula' })).toBe(false);
  });
});

describe('formatTitleTemplate', () => {
  it('renders a template and strips orphan separators around empty fields', () => {
    expect(formatTitleTemplate('{full_name} - {company}', { company: 'Acme' })).toBe('Acme');
  });

  it('accepts the Expression envelope { source }', () => {
    expect(formatTitleTemplate({ source: '{a}/{b}' }, { a: '1', b: '2' })).toBe('1/2');
  });

  it('walks dotted paths and embedded reference objects', () => {
    expect(formatTitleTemplate('{account.name}', { account: { name: 'Globex' } })).toBe('Globex');
    expect(formatTitleTemplate('{account}', { account: { name: 'Globex' } })).toBe('Globex');
  });

  it('returns empty string when nothing resolves', () => {
    expect(formatTitleTemplate('{missing}', { id: '1' })).toBe('');
    expect(formatTitleTemplate(undefined, { id: '1' })).toBe('');
  });
});

/**
 * objectstack#5450. The empty-placeholder sentinel `EMPTY_TOKEN` is a U+0000
 * that used to be written into the source as the raw byte, which made this
 * module binary to grep. Re-spelling it as an escape leaves the runtime value
 * identical — these pin the behaviour that identity is responsible for, so a
 * later attempt to "make it printable" cannot pass quietly.
 *
 * Byte discipline: the assertions test CODE POINTS via charCodeAt. No control
 * character is written into this file, as a literal or as an escape.
 */
describe('formatTitleTemplate — the empty-placeholder sentinel', () => {
  /** True when every code point is printable (no C0 control, no U+007F). */
  const isPrintable = (s: string) =>
    Array.from(s).every((c) => {
      const cp = c.codePointAt(0) as number;
      return cp >= 0x20 && cp !== 0x7f;
    });

  it('never leaks the sentinel into the rendered title', () => {
    const out = formatTitleTemplate('{full_name} - {company}', { company: 'Acme' });
    expect(out).toBe('Acme');
    expect(isPrintable(out), 'the sentinel must not survive into a rendered title').toBe(true);
  });

  it('strips several empty placeholders and their orphan separators at once', () => {
    const out = formatTitleTemplate('{a} - {b} | {c}', { b: 'Only' });
    expect(out).toBe('Only');
    expect(isPrintable(out)).toBe(true);
  });

  it('leaves a separator that sits between two RESOLVED fields alone', () => {
    // The strip passes are anchored on the sentinel, so a real separator with
    // content on both sides must survive — otherwise "A - B" would become "AB".
    expect(formatTitleTemplate('{a} - {b}', { a: 'A', b: 'B' })).toBe('A - B');
  });

  it('does not swallow a record value just because it neighbours an empty one', () => {
    const out = formatTitleTemplate('{missing}·{kept}', { kept: 'Kept' });
    expect(out).toBe('Kept');
    expect(isPrintable(out)).toBe(true);
  });
});
