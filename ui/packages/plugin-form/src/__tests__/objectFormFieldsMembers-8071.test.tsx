/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form.fields` — the MEMBER shape this renderer reads (objectui#8071,
 * criterion from objectui#8068).
 *
 * The registration declares `{ name: 'fields', type: 'array' }` with no `of`
 * and no description, and the spec's `object-form.fields` row is
 * `z.array(z.unknown())` carrying the prose "Limit/order the fields shown". So
 * NOTHING on either declared side says what a member is: every coarse member
 * kind parses, and the read site is the whole member contract. That is exactly
 * the population objectui#8068 refuses to leave unwatched, and this file is
 * this key's answer.
 *
 * WHAT THE RENDERER READS, measured at `ObjectForm.tsx`'s `SimpleObjectForm`
 * (the `const fieldsToShow = schema.fields || Object.keys(objectSchema.fields)`
 * loop) and at `flatFields.ts`'s `buildFlatFields`, which the drawer and modal
 * presentations share:
 *
 *     a member is a BARE FIELD NAME, looked up in the object schema.
 *
 * The pin is that sentence made falsifiable, plus the ONE distinction that
 * makes this key worth a pin of its own rather than a note: `object-form` has a
 * SECOND authoring surface spelled `fields` — `sections[].fields` — and the two
 * do NOT share a member vocabulary. A section field may be the spec's
 * `FormFieldSchema` object, whose identity key is `field` (see
 * `sectionFields.ts`, and `sectionFields.spec-parity.test.ts` for its key set).
 * That same object as a member of the TOP-LEVEL `fields` resolves to no name
 * and is dropped from render — no throw, no empty-state.
 *
 * Until objectui#8738 route 1 that drop was also SILENT — no console warning
 * either. The maintainer ruling at issuecomment-5603577602 required a named
 * `console.warn` naming the skipped key and the vocabulary difference (same
 * voice/dedupe discipline as `sectionFields.ts`'s `warnOnMixedVocabulary`,
 * see `warnUnresolvedTopLevelField`). Row 4 below now pins that the warning
 * fires; the block after row 6 pins both its legs (fires for an unresolvable
 * member, does not fire for a legal one) with entries distinct from row 4's,
 * since the warning's dedupe Set is module-scoped for the whole file run.
 *

 * ⛔ NOT a restatement of the declaration: the declaration says `array` and
 * stops. Every row below is a render whose outcome would change if the read
 * site changed — the ablation objectui#8071 ran on this file removed the
 * `typeof fieldName === 'string'` name resolution and reddened rows 1, 3 and 5.
 *
 * Row 6 is the `{ name }` entry, and objectui#11550 TURNED IT AROUND (triage
 * ruling 5969880008). It used to be pinned as a tolerated spelling, which every
 * authoring face then taught. It is retired from authoring: the declared member
 * is `string[]` (`ObjectFormSchema.fields`, whose zod mirror refuses the entry
 * at `fields.0`), and the guide and the fixtures name fields as strings. What
 * stays is the READ: the loop's `(fieldName as any).name` and `buildFlatFields`
 * still draw an entry STORED that way, as objectui#11533 kept stored rules
 * readable. So the row pins both halves, and the `{ field }` contrast above it
 * stays exactly as it was.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectFormSchema as ObjectFormMirror } from '@object-ui/types/zod';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

/** `{ code, path }` of what a parse refused, so row 6 names WHICH entry was refused and HOW. */
const refusal = (result: { success: boolean; error?: { issues: Array<{ code: string; path: PropertyKey[] }> } }) =>
  result.success ? [] : result.error!.issues.map((issue) => ({ code: issue.code, path: issue.path.join('.') }));

const OBJECT_SCHEMA = {
  name: 'invoice',
  fields: {
    status: { type: 'text', label: 'Status' },
    sent_at: { type: 'text', label: 'Sent at' },
    note: { type: 'text', label: 'Note' },
  },
};

const makeDataSource = () =>
  ({
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_SCHEMA),
    getRecord: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  }) as any;

/** Render `object-form` and hand back the field labels in DOM order. */
async function renderedFieldLabels(schema: Record<string, unknown>): Promise<string[]> {
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'invoice', mode: 'create', ...schema } as any}
      dataSource={makeDataSource()}
    />,
  );
  // The form resolves the object schema in an effect; wait for the first field
  // to land rather than for a fixed set, so a row asserting an EMPTY result
  // still waits for the same settle point as the others.
  await waitFor(() => expect(container.querySelector('form')).toBeTruthy());
  await waitFor(() =>
    expect(container.querySelector('[data-loading], .animate-pulse')).toBeFalsy(),
  );
  return Array.from(container.querySelectorAll('label')).map((l) =>
    (l.textContent ?? '').replace(/\s*\*\s*$/, '').trim(),
  );
}

describe('object-form `fields` members are BARE FIELD NAMES (objectui#8071)', () => {
  it('1. resolves each member against the object schema, in AUTHORED order', async () => {
    expect(await renderedFieldLabels({ fields: ['note', 'status'] })).toEqual(['Note', 'Status']);
  });

  it('2. control: with no `fields` every declared field renders, in schema order', async () => {
    // Without this the row above could pass on a renderer that ignored the key
    // entirely and happened to agree — it does not: the orders differ.
    expect(await renderedFieldLabels({})).toEqual(['Status', 'Sent at', 'Note']);
  });

  it('3. drops a member the object schema does not declare — no untyped stub', async () => {
    expect(await renderedFieldLabels({ fields: ['status', 'not_a_field'] })).toEqual(['Status']);
  });

  it('4. the spec SECTION-field object is NOT a member of this key — dropped from render, and (route 1) now WARNED', async () => {
    // `{ field }` is the spec `FormFieldSchema` identity key — legal in
    // `sections[].fields`, meaningless here. The renderer reads `.name` off a
    // non-string member, finds nothing, and skips it — but since objectui#8738
    // route 1 (ruling: issuecomment-5603577602), no longer without a word: a
    // named `console.warn` fires, naming the skipped shape and the vocabulary
    // difference. The render outcome is UNCHANGED from before route 1 (still
    // no throw, still an empty result — the ruling makes the failure audible,
    // it does not make the wrong spelling work); only the silence is gone.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await renderedFieldLabels({ fields: [{ field: 'note' }] })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const [message] = warn.mock.calls[0];
      expect(String(message)).toContain("{ field: 'note' }");
      expect(String(message)).toContain('sections[].fields');
      expect(String(message)).toContain('FormFieldSchema');
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('5. the SAME entry inside `sections[].fields` DOES resolve — two vocabularies, one word', async () => {
    // The live control for row 4. Without it "dropped" could mean "this object
    // schema never renders `note`", which is the failure mode a one-sided
    // negative cannot tell apart from the claim.
    //
    // The section SELECTS from the fields the top-level key already resolved,
    // so `status` dropping out is the second half of the reading: the section's
    // `{ field: 'note' }` really was resolved to the name `note`. A section
    // whose members resolved to nothing renders no field at all (the loop
    // `return`s on an empty `sectionFields`), which is the outcome row 4 sees.
    // The section heading is a `section-divider` pseudo-field, not a `<label>`,
    // so it is deliberately absent from this list.
    expect(
      await renderedFieldLabels({
        fields: ['note', 'status'],
        sections: [{ label: 'Detail', fields: [{ field: 'note' }] }],
      }),
    ).toEqual(['Note']);
  });

  it('6. a STORED `{ name }` entry still draws, but the declared member refuses it (objectui#11550)', async () => {
    // The authoring half: the mirror of the declared `string[]` refuses the
    // entry, and ONLY the entry. The bare name beside it is the control.
    const node = { type: 'object-form', objectName: 'invoice', mode: 'create' } as const;
    expect(refusal(ObjectFormMirror.safeParse({ ...node, fields: [{ name: 'note' }] }))).toEqual([
      { code: 'invalid_type', path: 'fields.0' },
    ]);
    expect(ObjectFormMirror.safeParse({ ...node, fields: ['note'] }).success).toBe(true);
    // The read half: metadata already stored with the entry keeps drawing.
    expect(await renderedFieldLabels({ fields: [{ name: 'note' }] })).toEqual(['Note']);
  });
});

describe('object-form top-level `fields` WARNS on an unresolvable member (route 1, objectui#8738)', () => {
  // Route 1 adds an observable where there was none, so it owes a pin of its
  // own with BOTH legs: fires for the case that used to vanish, and does NOT
  // fire for a legal bare name — without the second leg, the first leg would
  // still pass on a warning that fires unconditionally on every render.
  //
  // Deliberately uses a DIFFERENT entry (`sent_at`, not row 4's `note`):
  // `warnUnresolvedTopLevelField`'s dedupe Set is keyed by object name +
  // skipped shape and module-scoped for this whole file's run, so reusing row
  // 4's exact shape here would observe the dedupe, not the firing.
  it('fires once for a member that resolves to no name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await renderedFieldLabels({ fields: [{ field: 'sent_at' }] })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("{ field: 'sent_at' }");
    } finally {
      warn.mockRestore();
    }
  });

  it('does NOT fire for a legal bare field name — the firing control', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await renderedFieldLabels({ fields: ['status'] })).toEqual(['Status']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
