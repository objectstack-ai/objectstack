// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pure-function tests for FormPage helpers. These cover the bulk of
 * the renderer's spec-merging logic — buildSections, readPrefill,
 * normalizeColumns, normalizeOptions — without needing a DOM.
 */

import { describe, expect, it } from 'vitest';
import { ActionRunner } from '@object-ui/core';
import { DEFAULT_VALUE_TOKENS, discriminateDefaultValueShape } from '@objectstack/spec/data';
import {
  buildSections,
  FORM_RECORD_ID_PARAM,
  FORM_RECORD_OBJECT_PARAM,
  normalizeColumns,
  normalizeOptions,
  readCreatedRecordId,
  readFormRecordTarget,
  readLoadedRecord,
  readPrefill,
  resolveInternalForm,
  resolveSubmitBehavior,
} from './FormPage';

describe('normalizeColumns', () => {
  it('passes through valid numeric literals', () => {
    expect(normalizeColumns(1)).toBe(1);
    expect(normalizeColumns(2)).toBe(2);
    expect(normalizeColumns(3)).toBe(3);
    expect(normalizeColumns(4)).toBe(4);
  });

  it('parses numeric strings', () => {
    expect(normalizeColumns('1')).toBe(1);
    expect(normalizeColumns('4')).toBe(4);
  });

  it('defaults to 2 for invalid or missing values', () => {
    expect(normalizeColumns(undefined)).toBe(2);
    expect(normalizeColumns(0)).toBe(2);
    expect(normalizeColumns(5)).toBe(2);
    expect(normalizeColumns('foo')).toBe(2);
  });
});

describe('normalizeOptions', () => {
  it('returns undefined for non-arrays', () => {
    expect(normalizeOptions(undefined)).toBeUndefined();
    expect(normalizeOptions(null)).toBeUndefined();
    expect(normalizeOptions('a,b,c')).toBeUndefined();
  });

  it('maps string options to {value,label}', () => {
    expect(normalizeOptions(['new', 'qualified'])).toEqual([
      { value: 'new', label: 'new' },
      { value: 'qualified', label: 'qualified' },
    ]);
  });

  it('honors {value,label} object shape', () => {
    expect(normalizeOptions([{ value: 'n', label: 'New' }])).toEqual([
      { value: 'n', label: 'New' },
    ]);
  });

  it('falls back to {id,name} when value/label are absent', () => {
    expect(normalizeOptions([{ id: 'x', name: 'X-Ray' }])).toEqual([
      { value: 'x', label: 'X-Ray' },
    ]);
  });
});

describe('buildSections', () => {
  const objectSchema = {
    name: 'lead',
    label: 'Lead',
    fields: {
      first_name: { type: 'text', label: 'First name', required: true },
      email: { type: 'email', label: 'Email', maxLength: 200 },
      status: { type: 'select', label: 'Status', options: ['new', 'qualified'] },
    },
  };

  it('merges section fields with object schema definitions', () => {
    const sections = buildSections(
      {
        type: 'simple',
        sections: [
          {
            label: 'About you',
            columns: 2,
            fields: ['first_name', 'email'],
          },
        ],
      },
      objectSchema,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('About you');
    expect(sections[0].columns).toBe(2);
    expect(sections[0].fields).toEqual([
      expect.objectContaining({ name: 'first_name', label: 'First name', type: 'text', required: true }),
      expect.objectContaining({ name: 'email', label: 'Email', type: 'email', maxLength: 200 }),
    ]);
  });

  it('lets FormField overrides win over object defaults', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [
          {
            fields: [
              { field: 'first_name', label: 'Given name', required: false, placeholder: 'Ada' },
            ],
          },
        ],
      },
      objectSchema,
    );
    expect(section.fields[0].label).toBe('Given name');
    expect(section.fields[0].required).toBe(false);
    expect(section.fields[0].placeholder).toBe('Ada');
  });

  // objectui#5595 — `maxLength` was the ONE key in the merge that read the
  // object definition unconditionally, while the docstring above
  // `buildSections` promises field-level overrides win. The three cases below
  // pin both sides of the `??` plus the both-absent floor, because "the
  // override wins" and "the object default still reaches the row" are
  // separately breakable and a single case is satisfied by a merge that
  // dropped either side entirely.
  it('lets a tighter per-form maxLength beat the object ceiling', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [{ fields: [{ field: 'email', maxLength: 40 }] }],
      },
      objectSchema,
    );
    // The object column allows 200; this form asks for 40. Before #5595 the
    // author silently got 200 at the input, with no diagnostic.
    expect(section.fields[0].maxLength).toBe(40);
  });

  it('falls back to the object ceiling when the form declares no maxLength', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [{ fields: [{ field: 'email', label: 'Work email' }] }],
      },
      objectSchema,
    );
    // The control on the case above, scoped to the same merge branch and able
    // to fail: `maxLength: override.maxLength` alone (no `?? def`) turns this
    // red while leaving the case above green.
    expect(section.fields[0].label).toBe('Work email');
    expect(section.fields[0].maxLength).toBe(200);
  });

  it('keeps an explicit 0 rather than falling through to the object ceiling', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [{ fields: [{ field: 'email', maxLength: 0 }] }],
      },
      objectSchema,
    );
    // `??`, not `||` — the distinction the sibling keys already rely on. A
    // declared 0 is a value the author wrote; `||` would silently restore the
    // exact defect #5595 fixed, for the one input that admits no characters.
    expect(section.fields[0].maxLength).toBe(0);
  });

  it('leaves maxLength undefined when neither side declares one', () => {
    const [section] = buildSections(
      { type: 'simple', sections: [{ fields: ['first_name'] }] },
      objectSchema,
    );
    // `first_name` carries no ceiling on either side, so the row must carry
    // none — the DOM sites spread `maxLength={field.maxLength}` straight onto
    // the input, and a fabricated number there would cap a field nobody capped.
    expect(section.fields[0].maxLength).toBeUndefined();
  });

  it('normalizes object schema options through onto the renderable field', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [{ fields: ['status'] }],
      },
      objectSchema,
    );
    expect(section.fields[0].options).toEqual([
      { value: 'new', label: 'new' },
      { value: 'qualified', label: 'qualified' },
    ]);
  });

  it('falls back to text type when the field is unknown', () => {
    const [section] = buildSections(
      {
        type: 'simple',
        sections: [{ fields: ['mystery'] }],
      },
      objectSchema,
    );
    expect(section.fields[0]).toMatchObject({ name: 'mystery', type: 'text' });
  });

  it('accepts legacy `groups` key as an alias for `sections`', () => {
    const sections = buildSections(
      {
        type: 'simple',
        groups: [{ fields: ['first_name'] }],
      } as any,
      objectSchema,
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].fields[0].name).toBe('first_name');
  });
});

describe('readPrefill', () => {
  const fields = [
    { name: 'first_name', label: 'First name', type: 'text', required: false, readonly: false, hidden: false, colSpan: 1 as const },
    { name: 'company', label: 'Company', type: 'text', required: false, readonly: false, hidden: false, colSpan: 1 as const, defaultValue: 'Acme' },
    { name: 'phone', label: 'Phone', type: 'text', required: false, readonly: false, hidden: false, colSpan: 1 as const },
  ];

  it('applies defaultValue from the field definition', () => {
    const out = readPrefill(fields, new URLSearchParams());
    expect(out).toEqual({ company: 'Acme' });
  });

  it('overrides defaults with `prefill_<name>` query params', () => {
    const out = readPrefill(fields, new URLSearchParams('prefill_company=Initech&prefill_first_name=Ada'));
    expect(out).toEqual({ company: 'Initech', first_name: 'Ada' });
  });

  it('ignores prefill params for fields not in the form', () => {
    const out = readPrefill(fields, new URLSearchParams('prefill_unknown=zzz'));
    expect(out).toEqual({ company: 'Acme' });
  });

  it('treats empty-string values as a real prefill', () => {
    const out = readPrefill(fields, new URLSearchParams('prefill_company='));
    expect(out.company).toBe('');
  });

  /**
   * objectui#4278 — the three-source precedence, pinned one rung at a time:
   * `defaultValue` < stored record < explicit `prefill_` param.
   */
  describe('with a stored record (edit mode)', () => {
    it('fills every field the record names', () => {
      const out = readPrefill(fields, new URLSearchParams(), {
        first_name: 'Grace',
        company: 'Initech',
        phone: '555-0100',
      });
      expect(out).toEqual({ first_name: 'Grace', company: 'Initech', phone: '555-0100' });
    });

    it("beats the field's create-time defaultValue", () => {
      const out = readPrefill(fields, new URLSearchParams(), { company: 'Initech' });
      // NOT 'Acme' — on an edit form the stored value is the truth.
      expect(out.company).toBe('Initech');
    });

    /**
     * The precedence that actually protects data: a stored null/empty must
     * not be repainted by a default, or the next save silently writes a
     * change the user never made.
     */
    it('lets a stored null or empty string beat the default', () => {
      expect(readPrefill(fields, new URLSearchParams(), { company: null }).company).toBeNull();
      expect(readPrefill(fields, new URLSearchParams(), { company: '' }).company).toBe('');
    });

    it('is overridden per FIELD by an explicit prefill_ param (the ruling)', () => {
      const out = readPrefill(
        fields,
        new URLSearchParams('prefill_company=Umbrella'),
        { first_name: 'Grace', company: 'Initech', phone: '555-0100' },
      );
      // The named field takes the param; the rest keep the record's values.
      expect(out).toEqual({ first_name: 'Grace', company: 'Umbrella', phone: '555-0100' });
    });

    it('ignores record keys that are not fields on this form', () => {
      const out = readPrefill(fields, new URLSearchParams(), {
        company: 'Initech',
        secret_internal_column: 'nope',
      });
      expect(out).not.toHaveProperty('secret_internal_column');
    });

    /** Control: the create path is byte-identical when no record is passed. */
    it('is unchanged when the record is null/undefined (create mode)', () => {
      const search = new URLSearchParams('prefill_first_name=Ada');
      expect(readPrefill(fields, search, null)).toEqual(readPrefill(fields, search));
      expect(readPrefill(fields, search, undefined)).toEqual(readPrefill(fields, search));
    });
  });

  /**
   * objectui#5727 — a `defaultValue` that is a runtime INSTRUCTION (a
   * `DEFAULT_VALUE_TOKENS` token, or a CEL Expression envelope) is the
   * server's to resolve per insert, so it must never reach the control.
   *
   * Seeding one literally puts the text `NOW()` in a datetime input and then
   * SUBMITS it, and `ObjectQL.applyFieldDefaults` resolves a declared default
   * only for a field that arrives absent or null — so the seed suppresses the
   * very resolution the declaration asked for. Hence the assertion below is
   * that the key is ABSENT, not that it is empty.
   *
   * Every specimen is the SPEC's own declaration, and is put through the
   * spec's own three-way classifier (`discriminateDefaultValueShape`) before
   * the behaviour is asserted. A hand-typed `'NOW()'` would keep passing after
   * the token family moved on; a specimen the authority still classifies as a
   * token cannot.
   */
  describe('runtime defaults are left to the server (objectui#5727)', () => {
    const withDefault = (defaultValue: unknown) => [
      {
        name: 'remind_at',
        label: 'Remind at',
        type: 'datetime',
        required: false,
        readonly: false,
        hidden: false,
        colSpan: 1 as const,
        defaultValue,
      },
    ];

    it.each([...DEFAULT_VALUE_TOKENS])('omits the %s token instead of seeding it', (token) => {
      expect(discriminateDefaultValueShape(token)).toBe('token');
      const out = readPrefill(withDefault(token), new URLSearchParams());
      expect(out).not.toHaveProperty('remind_at');
      expect(out).toEqual({});
    });

    it('omits a CEL Expression envelope instead of seeding it', () => {
      const envelope = { dialect: 'cel', source: 'today()' };
      expect(discriminateDefaultValueShape(envelope)).toBe('expression');
      const out = readPrefill(withDefault(envelope), new URLSearchParams());
      expect(out).not.toHaveProperty('remind_at');
      expect(out).toEqual({});
    });

    /**
     * The guard delegates to the classifier's real semantics rather than
     * comparing against a spelling: the `NOW()` token is case-insensitive and
     * whitespace-tolerant (the rule the SQL driver has always applied), so
     * these are the same instruction and are skipped too.
     */
    it.each(['now()', '  NOW()  '])('omits the tolerated spelling %j', (spelling) => {
      expect(discriminateDefaultValueShape(spelling)).toBe('token');
      expect(readPrefill(withDefault(spelling), new URLSearchParams())).toEqual({});
    });

    /**
     * Controls — the other side of the discrimination. If any of these stopped
     * seeding, the guard would have grown into "skip defaults", which is a
     * different (and wrong) rule.
     */
    describe('controls: what still seeds', () => {
      it('seeds a literal default', () => {
        expect(discriminateDefaultValueShape('Acme')).toBe('literal');
        expect(readPrefill(withDefault('Acme'), new URLSearchParams())).toEqual({
          remind_at: 'Acme',
        });
      });

      it('seeds a near-miss spelling that is NOT a token', () => {
        // No parentheses — a genuinely intended literal, which the spec's
        // token predicate deliberately does not widen to cover.
        expect(discriminateDefaultValueShape('NOW')).toBe('literal');
        expect(readPrefill(withDefault('NOW'), new URLSearchParams())).toEqual({
          remind_at: 'NOW',
        });
      });

      it('seeds an object default that is NOT an Expression envelope', () => {
        // Missing `dialect`: the engine falls through and stores it verbatim
        // as a literal, so this renderer seeds it for the same reason.
        const notAnEnvelope = { source: 'today()' };
        expect(discriminateDefaultValueShape(notAnEnvelope)).toBe('literal');
        expect(readPrefill(withDefault(notAnEnvelope), new URLSearchParams())).toEqual({
          remind_at: notAnEnvelope,
        });
      });

      it('seeds a declared null default (unchanged by this guard)', () => {
        expect(readPrefill(withDefault(null), new URLSearchParams())).toEqual({
          remind_at: null,
        });
      });

      it('still fills the field from a stored record (edit mode)', () => {
        // The token was resolved at insert; the persisted value is a real
        // value and this form must show the row as the server holds it.
        const out = readPrefill(withDefault('NOW()'), new URLSearchParams(), {
          remind_at: '2026-08-23T01:13:51Z',
        });
        expect(out.remind_at).toBe('2026-08-23T01:13:51Z');
      });

      it('still honours an explicit prefill_ param', () => {
        // A producer supplying a value is not a declaration awaiting
        // resolution, so source 3 outranks the skip exactly as it outranks
        // a literal default.
        const out = readPrefill(
          withDefault('NOW()'),
          new URLSearchParams('prefill_remind_at=2026-01-01T00:00:00Z'),
        );
        expect(out.remind_at).toBe('2026-01-01T00:00:00Z');
      });
    });
  });
});

/**
 * objectui#4278 — what the URL says an internal form is FOR.
 *
 * Reverse verification: with the fix reverted the param is not read at all,
 * so every `edit` expectation below collapses to `create` — which is the
 * defect verbatim (an edit intent silently becoming an insert).
 */
describe('readFormRecordTarget', () => {
  it('spells the param exactly as app-shell reserves it', () => {
    // `RECORD_DRAWER_PARAM` in packages/app-shell/src/urlParams.ts. Pinned as
    // a literal because app-shell exports only its package root, which does
    // not re-export ./urlParams — so the two spellings cannot drift silently.
    expect(FORM_RECORD_ID_PARAM).toBe('recordId');
  });

  it('is create mode when the param is absent', () => {
    expect(readFormRecordTarget('internal', new URLSearchParams())).toEqual({ kind: 'create' });
    expect(readFormRecordTarget('internal', new URLSearchParams('prefill_title=x')))
      .toEqual({ kind: 'create' });
  });

  it('is edit mode when the param names a record', () => {
    // `recordObject: null` — no object asserted (#4292). The pre-#4292 URL, and
    // still exactly the pre-#4292 behaviour.
    expect(readFormRecordTarget('internal', new URLSearchParams('recordId=task-42')))
      .toEqual({ kind: 'edit', recordId: 'task-42', recordObject: null });
  });

  it('decodes a percent-encoded id (ActionRunner encodes it)', () => {
    // `ActionRunner.executeForm` builds the URL with encodeURIComponent, and
    // URLSearchParams decodes on read — so an id carrying `/` or `#` survives.
    const search = new URLSearchParams(`recordId=${encodeURIComponent('a/b#c')}`);
    expect(readFormRecordTarget('internal', search))
      .toEqual({ kind: 'edit', recordId: 'a/b#c', recordObject: null });
  });

  /**
   * Fail closed (ruling point 2). `ActionRunner` appends the param for any
   * `recordId != null`, and an empty-string id passes that test — so this is
   * reachable, and the safe answer is to refuse rather than quietly insert.
   */
  it('REFUSES a present-but-blank param instead of degrading to create', () => {
    for (const raw of ['recordId=', 'recordId=%20%20']) {
      const target = readFormRecordTarget('internal', new URLSearchParams(raw));
      expect(target.kind).toBe('refuse');
      expect(target.kind === 'refuse' && target.reason).toMatch(/no record id/i);
    }
  });

  /**
   * Control pin — the public `/f/:slug` surface is untouched by all of #4278.
   * An anonymous visitor controls the URL, so honouring `?recordId=` there
   * would turn a public form into an arbitrary-record reader AND writer.
   */
  it('never reads the param in PUBLIC mode, whatever the URL says', () => {
    expect(readFormRecordTarget('public', new URLSearchParams('recordId=task-42')))
      .toEqual({ kind: 'create' });
    expect(readFormRecordTarget('public', new URLSearchParams('recordId=')))
      .toEqual({ kind: 'create' });
  });
});

/**
 * objectui#4292 — the object half of the URL contract, read (not yet judged).
 *
 * The comparison itself needs the FormView's object and therefore lives in the
 * loader; what this function owns is carrying the claim through unaltered, and
 * deciding what "no claim" means. Reverse verification: with the read reverted
 * every `recordObject` below reads back `null`, the loader has nothing to
 * compare, and the forged-URL guard silently disarms — green tests, absent
 * protection, which is why the DOM suite pins the refusal itself.
 */
describe('readFormRecordTarget carries the record object (#4292)', () => {
  it('spells the param exactly as ActionRunner emits it', () => {
    // Literal on both sides — `@object-ui/core` sits below this app and
    // app-shell exports no `./urlParams`. The behavioural pin below is what
    // actually holds them together.
    expect(FORM_RECORD_OBJECT_PARAM).toBe('recordObject');
  });

  it('reads the object the URL claims the id belongs to', () => {
    expect(
      readFormRecordTarget(
        'internal',
        new URLSearchParams('recordId=task-42&recordObject=showcase_task'),
      ),
    ).toEqual({ kind: 'edit', recordId: 'task-42', recordObject: 'showcase_task' });
  });

  it('carries a MISMATCHING claim through untouched — the loader judges it', () => {
    // Refusing here would be wrong: this function cannot know the FormView's
    // object, so it must not pretend to. It reports what the URL said.
    expect(
      readFormRecordTarget(
        'internal',
        new URLSearchParams('recordId=42&recordObject=showcase_account'),
      ),
    ).toEqual({ kind: 'edit', recordId: '42', recordObject: 'showcase_account' });
  });

  /**
   * Ruling point 2: the guard tightens only where identity information is
   * present. Absent or blank asserts nothing — and a hand-authored URL can
   * always just omit the param, so treating blank as a mismatch would buy no
   * protection while breaking the old deep links the ruling preserves.
   */
  it('treats an absent or blank claim as no claim at all', () => {
    for (const raw of [
      'recordId=task-42',
      'recordId=task-42&recordObject=',
      'recordId=task-42&recordObject=%20%20',
    ]) {
      expect(readFormRecordTarget('internal', new URLSearchParams(raw)))
        .toEqual({ kind: 'edit', recordId: 'task-42', recordObject: null });
    }
  });

  it('is still CREATE when an object is claimed but no record is named', () => {
    // Nothing for the assertion to be about; the form creates, as it always did.
    expect(readFormRecordTarget('internal', new URLSearchParams('recordObject=showcase_task')))
      .toEqual({ kind: 'create' });
  });

  it('never reads it in PUBLIC mode either', () => {
    expect(
      readFormRecordTarget(
        'public',
        new URLSearchParams('recordId=task-42&recordObject=showcase_task'),
      ),
    ).toEqual({ kind: 'create' });
  });
});

/**
 * The two halves of #4292, pinned against each other by BEHAVIOUR rather than
 * by spelling: the real `ActionRunner` produces a URL, and this route's real
 * reader consumes it. A rename on either side fails here — which matters more
 * than usual, because a silently disarmed guard is invisible: the form would go
 * back to loading whatever the id happened to hit, with every test still green.
 *
 * (`@object-ui/core` is a declared dependency of this app, so this is an
 * ordinary import — no new coupling, and the only place the two ends meet.)
 */
describe('producer → consumer round trip (#4292)', () => {
  /** Run the real producer and return the URL it navigated to. */
  async function produce(context: Record<string, unknown>, target: string): Promise<string> {
    const runner = new ActionRunner(context);
    let url = '';
    runner.setNavigationHandler((to) => {
      url = to;
    });
    await runner.execute({ type: 'form', target });
    return url;
  }

  function searchOf(url: string): URLSearchParams {
    return new URLSearchParams(url.split('?')[1] ?? '');
  }

  it('a same-object action yields an edit target carrying the object', async () => {
    const url = await produce(
      { record: { id: 'task-42' }, objectName: 'showcase_task' },
      'showcase_task.edit',
    );

    expect(readFormRecordTarget('internal', searchOf(url))).toEqual({
      kind: 'edit',
      recordId: 'task-42',
      recordObject: 'showcase_task',
    });
  });

  it('a cross-object action yields a CREATE target — no id crossed the boundary', async () => {
    const url = await produce(
      { record: { id: 42 }, objectName: 'showcase_account' },
      'showcase_task.edit',
    );

    expect(url).toBe('/forms/showcase_task.edit');
    expect(readFormRecordTarget('internal', searchOf(url))).toEqual({ kind: 'create' });
  });

  it('survives an id needing percent-encoding, end to end', async () => {
    const url = await produce(
      { record: { id: 'a/b#c' }, objectName: 'showcase_task' },
      'showcase_task.edit',
    );

    expect(readFormRecordTarget('internal', searchOf(url))).toEqual({
      kind: 'edit',
      recordId: 'a/b#c',
      recordObject: 'showcase_task',
    });
  });
});

/**
 * objectui#4278 — reading `GET /api/v1/data/:object/:id`, which the spec
 * declares as `GetDataResponse = { object, id, record }`.
 */
describe('readLoadedRecord', () => {
  const RESPONSE = {
    object: 'showcase_task',
    id: 'task-42',
    record: { id: 'task-42', title: 'Write the report', hours: 3 },
  };

  it('reads the record off a bare GetDataResponse', () => {
    expect(readLoadedRecord(RESPONSE, 'showcase_task', 'task-42')).toEqual(RESPONSE.record);
  });

  it('reads it through the { success, data } transport envelope too', () => {
    // Same one rule `@objectstack/client.unwrapResponse` applies — the
    // http-dispatcher wraps, packages/rest does not.
    const wrapped = { success: true, data: RESPONSE, meta: { ts: 1 } };
    expect(readLoadedRecord(wrapped, 'showcase_task', 'task-42')).toEqual(RESPONSE.record);
  });

  it('accepts a response that omits the echoed object key', () => {
    expect(readLoadedRecord({ id: 'task-42', record: { title: 'x' } }, 'showcase_task', 'task-42'))
      .toEqual({ title: 'x' });
  });

  /**
   * Object mismatch ⇒ refuse (ruling point 2). Honest reachability: the
   * deployed server ECHOES the path object, and we build that path from the
   * view's target, so `packages/rest` cannot produce this payload — it is a
   * contract assertion at the consumer, pinned with a hand-built body.
   */
  it('throws when the served object contradicts the form target', () => {
    expect(() =>
      readLoadedRecord({ ...RESPONSE, object: 'showcase_account' }, 'showcase_task', 'task-42'),
    ).toThrow(/belongs to showcase_account.*edits showcase_task/s);
  });

  it('throws — never returns empty — when the payload carries no record', () => {
    // An empty object would land in the same state as create mode, which is
    // the harm; so each of these must be an error rather than `{}`.
    expect(() => readLoadedRecord(null, 'showcase_task', 'task-42')).toThrow(/no record payload/);
    expect(() => readLoadedRecord('not json', 'showcase_task', 'task-42')).toThrow(/no record payload/);
    expect(() => readLoadedRecord({ object: 'showcase_task', id: 'task-42' }, 'showcase_task', 'task-42'))
      .toThrow(/no "record"/);
    expect(() => readLoadedRecord({ record: [] }, 'showcase_task', 'task-42')).toThrow(/no "record"/);
    expect(() => readLoadedRecord({ record: null }, 'showcase_task', 'task-42')).toThrow(/no "record"/);
  });
});

/**
 * objectui#2208 — the server's `/meta/view/:name` returns the flattened
 * ExpandedViewItem envelope `{ name, object, viewKind, label, config }`;
 * the form spec lives under `config`. Pre-fix the loader read sections off
 * the envelope itself → every internal form rendered zero fields + a bare
 * Submit that "succeeded". List views reaching the forms route (the
 * framework#2554 collision fallout) rendered the same false positive
 * instead of an actionable error.
 */
describe('resolveInternalForm', () => {
  const envelope = {
    name: 'showcase_task.tabbed',
    object: 'showcase_task',
    viewKind: 'form',
    label: 'Tabbed',
    scope: 'package',
    config: {
      type: 'tabbed',
      data: { provider: 'object', object: 'showcase_task' },
      sections: [{ name: 'overview', label: 'Overview', fields: ['title', 'status'] }],
    },
  };

  it('unwraps the ExpandedViewItem envelope: form spec comes from config', () => {
    const out = resolveInternalForm('showcase_task.tabbed', envelope);
    expect(out.form.type).toBe('tabbed');
    expect(out.form.sections).toHaveLength(1);
    expect(out.label).toBe('Tabbed');
    expect(out.object).toBe('showcase_task');
  });

  it('accepts the { item: envelope } wrapper', () => {
    const out = resolveInternalForm('showcase_task.tabbed', { item: envelope });
    expect(out.form.sections).toHaveLength(1);
    expect(out.object).toBe('showcase_task');
  });

  // objectui#13433 — no fallback to the view NAME: a form that names itself
  // nowhere is headed by its object's label, resolved by `FormPage` at render
  // (`FormPage.inAppShell-13433.test.tsx`). The raw qualified name was what
  // the showcase's Log Time page was headed by.
  it('answers no label when neither envelope nor config carry one, rather than the view name', () => {
    const { label: _l, ...noLabel } = envelope;
    const out = resolveInternalForm('showcase_task.tabbed', noLabel);
    expect(out.label).toBeUndefined();
  });

  it('reads the form config’s `title` when the envelope carries no label', () => {
    const { label: _l, ...noLabel } = envelope;
    const out = resolveInternalForm('showcase_task.tabbed', {
      ...noLabel,
      config: { ...noLabel.config, title: 'Tabbed edit' },
    });
    expect(out.label).toBe('Tabbed edit');
  });

  it('throws an actionable error for a non-form view instead of rendering an empty form', () => {
    const listView = {
      name: 'showcase_task.default',
      object: 'showcase_task',
      viewKind: 'list',
      label: 'All Tasks',
      config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: ['title'] },
    };
    expect(() => resolveInternalForm('showcase_task.default', listView)).toThrow(/list view, not a form view/);
  });

  it('throws for a flattened runtime-overlay list row that lost its viewKind (framework#2555 fallout)', () => {
    // A personalization PUT persisted the raw config at the top level; the
    // pre-heal server returns it with name/object/label but NO viewKind and
    // NO config envelope. It must not pass for a legacy bare form spec.
    const pollutedOverlay = {
      name: 'showcase_task.default',
      object: 'showcase_task',
      label: 'All Tasks',
      type: 'grid',
      data: { provider: 'object', object: 'showcase_task' },
      columns: [{ field: 'title' }],
      sort: [{ id: '29200fa8-c416-471e-9ca3-913f9308ad89', field: 'estimate_hours', order: 'desc' }],
    };
    expect(() => resolveInternalForm('showcase_task.default', pollutedOverlay)).toThrow(/grid view, not a form view/);
  });

  it('throws for a flattened list body whose viewKind sits at the top level (healed overlay row)', () => {
    const healedOverlay = {
      name: 'showcase_task.default',
      object: 'showcase_task',
      viewKind: 'list',
      label: 'All Tasks',
      type: 'grid',
      data: { provider: 'object', object: 'showcase_task' },
      columns: [{ field: 'title' }],
    };
    expect(() => resolveInternalForm('showcase_task.default', healedOverlay)).toThrow(/list view, not a form view/);
  });

  it('still accepts a bare legacy form spec (no envelope)', () => {
    const bare = {
      type: 'simple',
      label: 'Quick Edit',
      data: { provider: 'object', object: 'task' },
      sections: [{ label: 'Main', fields: ['title'] }],
    };
    const out = resolveInternalForm('task.quick', bare);
    expect(out.form).toBe(bare as any);
    expect(out.label).toBe('Quick Edit');
    // object resolved from the spec's data binding
    expect(out.object).toBe('task');
  });

  it('accepts the legacy { item: { spec } } wrapper', () => {
    const out = resolveInternalForm('task.quick', {
      item: { spec: { type: 'simple', object: 'task', sections: [] } },
    });
    expect(out.object).toBe('task');
    expect(out.form.type).toBe('simple');
  });
});

/**
 * objectui#4109 — the mode-aware post-submit default, from the maintainer
 * ruling of 2026-08-10 (objectstack#7245): an internal submit lands on the
 * record; `thank-you` stays the default for the public `/f/:slug` path only;
 * an explicitly declared behaviour still wins in BOTH modes.
 */
describe('resolveSubmitBehavior', () => {
  it('defaults an INTERNAL form to landing on the created record', () => {
    expect(resolveSubmitBehavior('internal', undefined)).toEqual({ kind: 'created-record' });
  });

  it('keeps thank-you as the PUBLIC default', () => {
    expect(resolveSubmitBehavior('public', undefined)).toEqual({ kind: 'thank-you' });
  });

  it('lets an explicit behaviour win in internal mode', () => {
    const declared = { kind: 'thank-you', title: 'All set' } as const;
    expect(resolveSubmitBehavior('internal', declared)).toBe(declared);
  });

  it('lets an explicit behaviour win in public mode', () => {
    const declared = { kind: 'continue' } as const;
    expect(resolveSubmitBehavior('public', declared)).toBe(declared);
  });

  /**
   * Ruling point 3 — "the corpus must not have to opt out of a wrong default".
   * Every authorable kind reaches the renderer unchanged in both modes, so a
   * form that DOES declare one is never second-guessed.
   */
  it('passes every authorable kind through untouched, in both modes', () => {
    const kinds = [
      { kind: 'thank-you' },
      { kind: 'redirect', url: 'https://example.test/done' },
      { kind: 'continue' },
      { kind: 'next-record' },
    ] as const;
    for (const declared of kinds) {
      expect(resolveSubmitBehavior('internal', declared)).toBe(declared);
      expect(resolveSubmitBehavior('public', declared)).toBe(declared);
    }
  });
});

/**
 * The seam the redirect depends on: what `POST /api/v1/data/:object` returns.
 * Spec-declared as `CreateDataResponse = { object, id, record }`, served bare
 * by `packages/rest` and `{ success, data, meta }`-wrapped by the runtime's
 * http-dispatcher — the one envelope rule `@objectstack/client.unwrapResponse`
 * already owns, mirrored here because FormPage hand-rolls `fetch`.
 */
describe('readCreatedRecordId', () => {
  it('reads the spec-declared top-level id from a bare CreateDataResponse', () => {
    expect(
      readCreatedRecordId({
        object: 'showcase_task',
        id: 'task-1',
        record: { id: 'task-1', title: 'Write the report' },
      }),
    ).toBe('task-1');
  });

  it('reads it through the { success, data } transport envelope too', () => {
    expect(
      readCreatedRecordId({
        success: true,
        data: { object: 'showcase_task', id: 'task-2', record: { id: 'task-2' } },
        meta: undefined,
      }),
    ).toBe('task-2');
  });

  it('coerces a numeric primary key to its string form', () => {
    expect(readCreatedRecordId({ object: 'o', id: 42, record: { id: 42 } })).toBe('42');
  });

  it('returns null when the payload names no id, so the caller can confirm instead', () => {
    expect(readCreatedRecordId(null)).toBeNull();
    expect(readCreatedRecordId('nope')).toBeNull();
    expect(readCreatedRecordId({})).toBeNull();
    expect(readCreatedRecordId({ object: 'o', id: '' })).toBeNull();
    expect(readCreatedRecordId({ success: true, data: null })).toBeNull();
  });

  /**
   * `record.id` carries the same value, and reading it as an alias would be the
   * second de-facto contract AGENTS.md #0.1 forbids: one declared key, one
   * reader. A response missing the declared `id` is a producer bug and must
   * surface as "no redirect", not be papered over here.
   */
  it('does not fall back to record.id when the declared id is absent', () => {
    expect(readCreatedRecordId({ object: 'o', record: { id: 'task-3' } })).toBeNull();
  });
});
