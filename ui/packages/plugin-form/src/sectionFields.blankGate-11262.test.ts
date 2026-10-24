/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11262 — `attachVisibility` diagnoses the blank view-level predicate
 * it drops (ADR-0137 D4: a gate predicate that is blank is "diagnosed, never a
 * silent `true`").
 *
 * `sectionFields.ts` is where every sectioned `object-form` arm (and, through
 * `SectionFieldsContext.pool`, the default arm) turns an authored section entry
 * into a runtime field. A blank predicate — a string, or an envelope whose
 * `source` is blank — never reached the runtime field's `visibleOn` slot, so the
 * form renderer, which reports a blank predicate it evaluates, never saw it: the
 * field was drawn with no gate and nothing said the author's gate was empty.
 * That verdict stands ("no gate"); only the silence ends.
 *
 * Every chain that reaches `attachVisibility` is pinned, because each reads a
 * different key: a spec form-view entry's `visibleWhen` (its retired
 * `visibleOn` is read by no chain since objectui#12654), and an already-built
 * runtime field's own `visibleOn`. A name string over the object schema is no
 * chain: the object field's `visibleOn` was one until objectui#12719, and its
 * snake_case `visible_on` until objectui#12242, both keys the spec
 * `FieldSchema` never declares (pinned last). The runtime field is the exception
 * the card's reading did not draw: that field IS the output, so its blank is
 * not dropped at all. It reaches the form renderer, which evaluates it and
 * reports it (the `form.tsx` pin "a blank view-level visibleOn is a layout
 * GATE: no gate plus a diagnostic" in `visibleWhen-fault-refuses-submit-8069`),
 * so its rows pin that it is carried unchanged and NOT reported a second time.
 *
 * Field names are unique per row: the one-time warning dedupe is module state
 * in `@object-ui/core`, keyed on the predicate text and the locator (which names
 * the field), and the `unit` project shares one module graph per worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSectionField } from './sectionFields';

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const blankLines = (): string[] =>
  warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((w: string) => w.includes('[blank]'));

const BLANKS = [
  ['an empty string', ''],
  ['a whitespace string', '  \n '],
  ["{ source: '' }", { source: '' }],
] as const;

let seq = 0;
/** A field name no other row (or file) has warned about. */
const fresh = (chain: string) => `${chain}_${++seq}_11262`;

function ctxWith(name: string, meta: Record<string, unknown> = {}) {
  return {
    objectSchema: { name: 'case_11262', fields: { [name]: { type: 'text', label: name, ...meta } } },
    objectName: 'case_11262',
    fieldLabel: (_obj: string, _name: string, fallback: string) => fallback,
  };
}

/** The chains into `attachVisibility` that DROP a blank, each handed the predicate under test. */
const CHAINS: Array<readonly [string, (pred: unknown, name: string) => ReturnType<typeof normalizeSectionField>]> = [
  ['a form-view entry’s visibleWhen', (pred, name) =>
    normalizeSectionField({ field: name, visibleWhen: pred }, ctxWith(name))],
];

describe.each(CHAINS)('attachVisibility via %s (objectui#11262, ADR-0137 D4)', (_chain, build) => {
  it.each(BLANKS)('%s: no gate on the runtime field, as before — and a [blank] report naming the field', (_label, pred) => {
    const name = fresh('blank');
    const f = build(pred, name);
    expect(f.name).toBe(name);
    expect((f as { visibleOn?: unknown }).visibleOn).toBeUndefined();
    const lines = blankLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`'${name}'`);
  });

  it('control — a written predicate is carried into the view-level slot, silently', () => {
    const name = fresh('written');
    const pred = { dialect: 'cel', source: "record.stage == 'won'" };
    expect((build(pred, name) as { visibleOn?: unknown }).visibleOn).toEqual(pred);
    expect((build("record.stage == 'won'", fresh('written')) as { visibleOn?: unknown }).visibleOn)
      .toBe("record.stage == 'won'");
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['a number', 42],
    ['a boolean', true],
    ['an object without source', {}],
  ] as const)('control — %s is not predicate text: dropped as before, and silent', (_label, pred) => {
    const f = build(pred, fresh('junk'));
    expect((f as { visibleOn?: unknown }).visibleOn).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a runtime FormField carrying its own blank visibleOn (objectui#11262)', () => {
  const runtime = (pred: unknown, name: string) =>
    normalizeSectionField({ name, type: 'text', visibleOn: pred } as never, ctxWith(name));

  it.each(BLANKS)('%s: carried unchanged to the renderer, which reports it — nothing is dropped, so nothing is said here', (_label, pred) => {
    const f = runtime(pred, fresh('runtime'));
    expect((f as { visibleOn?: unknown }).visibleOn).toBe(pred);
    expect(warn).not.toHaveBeenCalled();
  });

  it('control — a written predicate on a runtime field is carried too', () => {
    const f = runtime("record.stage == 'won'", fresh('runtime'));
    expect((f as { visibleOn?: unknown }).visibleOn).toBe("record.stage == 'won'");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe.each([
  ['retired snake_case `visible_on`', 'visible_on', 'objectui#12242'],
  ['undeclared `visibleOn`', 'visibleOn', 'objectui#12719'],
] as const)('a name string over the object field’s %s is not a chain (%s)', (_label, key, _issue) => {
  // Each key had a row in the CHAINS table above until its issue deleted the
  // read: the spec `FieldSchema` declares neither (`visible_on` it refuses by
  // name, and `BaseFieldMetadata` types it `never`; `visibleOn` it never
  // declared). An object field's visibility is its `visibleWhen`, which
  // `fromObjectSchema` carries as the field-level rule, not the view-level
  // slot. So a predicate written under either key gates nothing and is
  // reported as nothing, written or blank alike.
  it.each([
    ['a written predicate', "record.stage == 'won'"],
    ['a written envelope', { dialect: 'cel', source: "record.stage == 'won'" }],
    ...BLANKS,
  ] as const)('%s: no view-level gate on the runtime field, and silent', (_label, pred) => {
    const name = fresh('retired');
    const f = normalizeSectionField(name, ctxWith(name, { [key]: pred }));
    expect(f.name).toBe(name);
    expect((f as { visibleOn?: unknown }).visibleOn).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('control — the same predicate under the object field’s declared `visibleWhen` IS carried, as the field-level rule', () => {
    const name = fresh('control');
    const f = normalizeSectionField(name, ctxWith(name, { visibleWhen: "record.stage == 'won'" }));
    expect((f as { visibleWhen?: unknown }).visibleWhen).toBe("record.stage == 'won'");
    expect((f as { visibleOn?: unknown }).visibleOn).toBeUndefined();
  });
});
