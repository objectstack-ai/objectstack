/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The write-warning message — objectui#3484, points B and C.
 *
 * Two things were wrong with what the shell said when a save came back with
 * `droppedFields`:
 *
 *  - it named fields by their API key (`type, source_method`), which is not
 *    what the user is looking at; and
 *  - "Some fields were not saved" landed beside the save surface's own
 *    "Updated" toast, so the two read as a contradiction with nothing telling
 *    the user which had actually happened.
 *
 * It now resolves labels off the object schema (the adapter caches it) and says
 * one coherent thing: saved, and here is what did not take effect.
 *
 * A third thing was wrong, one reason later (objectui#3935): the wording was
 * picked by a two-way conditional on `readonly_when`, so every reason the write
 * path gained afterwards was announced as read-only. The reason table is now
 * exhaustive over the spec union, and the suite pins each reason's own sentence
 * plus the skew case a `Record` cannot cover.
 *
 * The sink is a PARAMETER, so this suite mocks no module. That is not a style
 * preference: `vitest.config.mts` runs the `unit` project with `isolate: false`
 * (one module graph per worker), where a `vi.mock('sonner')` holds only if no
 * other file in the same worker imported the real thing first — green when the
 * run is small, red once the whole repo is in flight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DroppedFieldsEventSchema } from '@objectstack/spec/data';
import { emitWriteWarning, type WriteWarningSink } from './writeWarningToast';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { createI18n, loadBuiltInLocale, type TranslateFn } from '@object-ui/i18n';
import type { DroppedFieldsEvent, WriteWarningEvent } from '@object-ui/data-objectstack';

/** Stand-in for i18next: returns the caller's English default, interpolated. */
const t = (_key: string, opts?: Record<string, unknown>) => {
  const raw = String(opts?.defaultValue ?? '');
  return raw.replace('{{fields}}', String(opts?.fields ?? ''));
};

/** Identity field-label resolver (no translation bundle loaded). */
const identityLabel = (_o: string, _f: string, fallback: string) => fallback;

/**
 * The label lookup reads `fields[<apiKey>].label` and falls back to the key when
 * the entry is absent — so the schema shape is an OPEN map of field entries, not
 * this fixture's two specific keys. Annotated as such: without it `vi.fn` infers
 * the resolved type from this literal alone, and the `{ fields: {} }` case below
 * (the whole point of the "falls back to the API key" test) is rejected for
 * missing `type` / `source_method` (objectui#4040).
 */
type ObjectSchemaShape = { fields: Record<string, { label: string }> };

const ANDON_SCHEMA: ObjectSchemaShape = {
  fields: {
    type: { label: 'Andon type' },
    source_method: { label: 'Source method' },
  },
};

const adapter = { getObjectSchema: vi.fn(async (): Promise<ObjectSchemaShape> => ANDON_SCHEMA) };

const EVENT: WriteWarningEvent = {
  operation: 'update',
  resource: 'andon',
  id: 'r1',
  droppedFields: [{ object: 'andon', fields: ['type', 'source_method'], reason: 'readonly_when' }],
};

/** Records what the shell would have shown. */
function makeSink() {
  const calls: Array<{ title: string; description?: string }> = [];
  const sink: WriteWarningSink = {
    warning: (title, options) => { calls.push({ title, description: options?.description }); },
  };
  return { sink, calls };
}

describe('emitWriteWarning (#3484)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.getObjectSchema.mockResolvedValue(ANDON_SCHEMA);
  });

  it('names the fields by LABEL, not by API key', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, sink);

    expect(calls).toHaveLength(1);
    expect(calls[0].description).toContain('Andon type, Source method');
    expect(calls[0].description).not.toContain('source_method');
  });

  it('says the record WAS saved, so it does not contradict the success toast', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, sink);

    expect(calls[0].title).toMatch(/^Saved/);
    expect(calls[0].title).not.toMatch(/not saved/i);
    expect(calls[0].description).toMatch(/did not take effect/);
  });

  it('routes a label through the translation bundle when one is loaded', async () => {
    const { sink, calls } = makeSink();
    const zh = (_o: string, fieldName: string, fallback: string) =>
      fieldName === 'type' ? '安灯类型' : fallback;

    await emitWriteWarning(EVENT, t, adapter as never, zh, sink);

    expect(calls[0].description).toContain('安灯类型');
  });

  it('falls back to the API key when the schema does not name the field', async () => {
    adapter.getObjectSchema.mockResolvedValue({ fields: {} });
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, sink);

    expect(calls[0].description).toContain('type, source_method');
  });

  it('still speaks when the metadata read fails — an API key beats silence', async () => {
    adapter.getObjectSchema.mockRejectedValue(new Error('offline'));
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, sink);

    expect(calls).toHaveLength(1);
    expect(calls[0].description).toContain('type, source_method');
  });

  it('uses the static read-only wording for reason `readonly`', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(
      { ...EVENT, droppedFields: [{ object: 'andon', fields: ['type'], reason: 'readonly' }] },
      t,
      adapter as never,
      identityLabel,
      sink,
    );

    expect(calls[0].description).toMatch(/^Read-only/);
  });

  it('uses the state wording for reason `readonly_when`, which is NOT read-only', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, sink);

    expect(calls[0].description).toMatch(/^Not editable in this record's current state/);
    expect(calls[0].description).not.toMatch(/Read-only/);
  });

  it('uses the identifier wording for reason `primary_key` (objectstack#6437)', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(
      { ...EVENT, droppedFields: [{ object: 'andon', fields: ['type'], reason: 'primary_key' }] },
      t,
      adapter as never,
      identityLabel,
      sink,
    );

    expect(calls[0].description).toMatch(/^The record's identifier cannot be changed by a save/);
    // The whole point of objectui#3935: the strip is not a read-only lock, and
    // saying so pointed the user at a permission problem that does not exist.
    expect(calls[0].description).not.toMatch(/Read-only/);
  });

  it('uses the formula wording for reason `computed`, which is NOT read-only (objectui#11206)', async () => {
    const keys: string[] = [];
    const recordingT = (key: string, opts?: Record<string, unknown>) => {
      keys.push(key);
      return t(key, opts);
    };
    const { sink, calls } = makeSink();

    await emitWriteWarning(
      {
        ...EVENT,
        droppedFields: [
          { object: 'andon', fields: ['type'], reason: 'computed' },
        ],
      },
      recordingT,
      adapter as never,
      identityLabel,
      sink,
    );

    expect(keys).toContain('detail.writeStrippedComputed');
    expect(calls[0].description).toMatch(/^Calculated by the server from a formula/);
    expect(calls[0].description).not.toMatch(/Read-only/);
    expect(calls[0].description).not.toMatch(/^Not applied by the server/);
  });

  /**
   * The `stored_expression` row (objectui#13178), driven through the REAL
   * catalogues rather than the defaultValue stand-in, so the pin is the line a
   * user reads in each language.
   */
  it('words reason `stored_expression` as a computed value saved in place of the one sent, in en and zh (objectui#13178)', async () => {
    expect(await loadBuiltInLocale('zh')).not.toBeNull();

    const lines = new Map<string, string>();
    for (const language of ['en', 'zh']) {
      const i18n = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
      await i18n.changeLanguage(language);
      const keys: string[] = [];
      const realT: TranslateFn = (key: string, opts?: Record<string, unknown>) => {
        keys.push(key);
        return String(i18n.t(key, opts));
      };
      const { sink, calls } = makeSink();

      await emitWriteWarning(
        {
          ...EVENT,
          droppedFields: [
            {
              object: 'andon',
              fields: ['type', 'source_method'],
              reason: 'stored_expression',
            },
          ],
        },
        realT,
        adapter as never,
        identityLabel,
        sink,
      );

      expect(keys).toContain('detail.writeStrippedStoredExpression');
      expect(calls).toHaveLength(1);
      lines.set(language, calls[0].description ?? '');
    }

    expect(lines.get('en')).toBe(
      'Computed from the record, so the computed value was saved instead of the one sent: Andon type, Source method',
    );
    expect(lines.get('zh')).toBe(
      '以下字段的值由记录计算得出，已保存计算值而非提交的值：Andon type, Source method',
    );
  });

  it('keeps one line per reason when a save was stripped for several', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(
      {
        ...EVENT,
        droppedFields: [
          { object: 'andon', fields: ['type'], reason: 'readonly' },
          { object: 'andon', fields: ['source_method'], reason: 'primary_key' },
        ],
      },
      t,
      adapter as never,
      identityLabel,
      sink,
    );

    const lines = (calls[0].description ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Read-only, so it did not take effect: Andon type');
    expect(lines[1]).toBe(
      "The record's identifier cannot be changed by a save, so it did not take effect: Source method",
    );
  });

  /**
   * The exhaustiveness pin (objectui#3935), read off the SPEC rather than a hand
   * list that would drift: `STRIPPED_LINE` is keyed by
   * `DroppedFieldsEvent['reason']` (widened by `'computed'` from objectui#11206
   * until the 17.6.0 bump, objectui#11438, and by `'stored_expression'` from
   * objectui#13178 until the objectstack 830a63a6 bump), so a missing key is a type error — but
   * `type-check` and `vitest` are different gates,
   * and the reason the ternary this replaced survived so long is that nothing in
   * the test suite could see the gap at all.
   *
   * So assert it behaviourally: drive the toast once per reason the INSTALLED
   * spec declares and require each to produce its own sentence rather than the
   * skew wording. A pin bump that widens the enum makes this red next to the
   * compile error, in the gate a wording change is normally noticed in.
   */
  it('gives every reason the pinned spec declares its own wording (#3935)', async () => {
    const declared: readonly string[] = DroppedFieldsEventSchema.shape.reason.options;
    expect(declared).toContain('primary_key');
    expect(declared).toContain('stored_expression');
    const reasons = declared as readonly DroppedFieldsEvent['reason'][];

    const wordings = new Map<string, string>();
    for (const reason of reasons) {
      const { sink, calls } = makeSink();

      await emitWriteWarning(
        { ...EVENT, droppedFields: [{ object: 'andon', fields: ['type'], reason }] },
        t,
        adapter as never,
        identityLabel,
        sink,
      );

      const line = calls[0]?.description ?? '';
      expect(line, `reason \`${reason}\` has no wording of its own`).not.toMatch(
        /^Not applied by the server/,
      );
      wordings.set(reason, line);
    }

    expect(new Set(wordings.values()).size).toBe(reasons.length);
  });

  /**
   * A server ahead of this bundle's spec pin. `notifyDroppedFields` asserts the
   * wire entry into `DroppedFieldsEvent` without checking `reason` against the
   * enum, so the value really can arrive from outside the union — and the toast
   * must neither throw (the adapter calls this as `void emitWriteWarning(...)`,
   * so a rejection is unhandled and the user loses the whole toast) nor reuse a
   * wording that would state a cause it does not know.
   */
  it('names the fields and claims no cause for a reason ahead of the spec pin (#3935)', async () => {
    const aheadOfPin: string = 'some_future_reason';
    const { sink, calls } = makeSink();

    await emitWriteWarning(
      {
        ...EVENT,
        droppedFields: [
          {
            object: 'andon',
            fields: ['type'],
            reason: aheadOfPin as DroppedFieldsEvent['reason'],
          },
        ],
      },
      t,
      adapter as never,
      identityLabel,
      sink,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].description).toBe('Not applied by the server: Andon type');
    expect(calls[0].description).not.toMatch(/Read-only/);
  });

  it('says nothing for an empty event', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning({ ...EVENT, droppedFields: [] }, t, adapter as never, identityLabel, sink);

    expect(calls).toEqual([]);
  });

  it('falls back to API keys when there is no adapter to read metadata from', async () => {
    const { sink, calls } = makeSink();

    await emitWriteWarning(EVENT, t, null, identityLabel, sink);

    expect(calls[0].description).toContain('type, source_method');
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
  });
});

// ── a write answer's `warnings` (objectui#12107) ───────────────────────────
//
// Through the real chain: the real adapter's create/update reads the answer,
// `onWriteWarning` hands the event to this module, and the sink is what the
// user would have seen. Only the transport (`client.data`) is stubbed.

const ADVISORY = {
  field: 'discount',
  code: 'validation_rule',
  message: 'Discounts above 30% need a manager note',
  rule: 'discount_cap',
  severity: 'warning' as const,
};

/** A real adapter whose `client.data` is the stub, wired to the toast module. */
function wiredAdapter(data: Record<string, unknown>) {
  const ds = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  });
  const internals = ds as unknown as { connected: boolean; connectionState: string; client: unknown };
  internals.connected = true;
  internals.connectionState = 'connected';
  internals.client = { data };
  const { sink, calls } = makeSink();
  const pending: Promise<void>[] = [];
  ds.onWriteWarning((ev) => {
    pending.push(emitWriteWarning(ev, t, adapter as never, identityLabel, sink));
  });
  return { ds, calls, settle: () => Promise.all(pending) };
}

describe('emitWriteWarning — write answer warnings (objectui#12107)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapter.getObjectSchema.mockResolvedValue(ANDON_SCHEMA);
  });

  it('shows the warning message after a create whose answer carries one', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1' }, warnings: [ADVISORY] });
    const { ds, calls, settle } = wiredAdapter({ create });

    await ds.create('quote', { discount: 40 });
    await settle();

    expect(calls).toEqual([{ title: 'Saved — with warnings', description: ADVISORY.message }]);
  });

  it('shows the warning message after an update whose answer carries one', async () => {
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' }, warnings: [ADVISORY] });
    const { ds, calls, settle } = wiredAdapter({ update });

    await ds.update('quote', 'r1', { discount: 40 });
    await settle();

    expect(calls).toEqual([{ title: 'Saved — with warnings', description: ADVISORY.message }]);
  });

  it('CONTROL: an answer without the key shows nothing', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'r1' } });
    const update = vi.fn().mockResolvedValue({ record: { id: 'r1' } });
    const { ds, calls, settle } = wiredAdapter({ create, update });

    await ds.create('quote', { discount: 40 });
    await ds.update('quote', 'r1', { discount: 40 });
    await settle();

    expect(calls).toEqual([]);
  });

  it('CONTROL: with both lists present the stripped-fields toast is unchanged and the warnings get their own', async () => {
    const update = vi.fn().mockResolvedValue({
      record: { id: 'r1' },
      droppedFields: [{ object: 'andon', fields: ['type', 'source_method'], reason: 'readonly_when' }],
      warnings: [ADVISORY],
    });
    const { ds, calls, settle } = wiredAdapter({ update });
    const strippedOnly = makeSink();
    await emitWriteWarning(EVENT, t, adapter as never, identityLabel, strippedOnly.sink);

    await ds.update('andon', 'r1', { type: 'x', source_method: 'y' });
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(strippedOnly.calls[0]);
    expect(calls[1]).toEqual({ title: 'Saved — with warnings', description: ADVISORY.message });
  });

  it('shows each distinct message once, one per line', async () => {
    const { sink, calls } = makeSink();
    const second = { ...ADVISORY, field: 'close_date', rule: 'close_date_past', message: 'Close date is in the past' };

    await emitWriteWarning(
      { ...EVENT, droppedFields: [], warnings: [ADVISORY, second, ADVISORY] },
      t,
      adapter as never,
      identityLabel,
      sink,
    );

    expect(calls).toEqual([
      { title: 'Saved — with warnings', description: `${ADVISORY.message}\n${second.message}` },
    ]);
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
  });
});
