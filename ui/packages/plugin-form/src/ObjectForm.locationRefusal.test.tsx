/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6716, measured end to end: a refused coordinate must be ANNOUNCED,
 * and must still not be stored.
 *
 * The sibling file `ObjectForm.locationRange.test.tsx` is #6714's measurement —
 * an out-of-range pair never reaches `dataSource.create`. This file is the
 * other half: the same refusal, now visible to the person who caused it. Both
 * arms are covered, the pre-existing FORMAT one (`not a coordinate`) and the
 * RANGE one #6714 added (`999, 999`).
 *
 * ## What this measured on the base commit (`faac0d935`), before the fix
 *
 * Typing either text into this same form left `aria-invalid` at `"false"`, the
 * field rendering only its label, the box EMPTY (React restores a controlled
 * input in the same tick when no state update follows a change), and the create
 * payload carrying no `place` key at all. The refusal was total and silent.
 *
 * ## Why the announcement comes from the widget
 *
 * Triage routed the fix to `buildValidationRules`, for a single producer of the
 * published objectui#3222 `error` slot. Measured: that route cannot see a
 * refusal at all — a refusal means `onChange` never fires, so the typed text
 * never becomes a form value, and a `location` branch installed there was
 * invoked with `undefined` in both arms.
 *
 * ⚠️ `buildValidationRules` DOES have a `location` branch now — objectui#6744
 * added one, for the different defect of a STORED out-of-range coordinate that
 * was never validated on an edit form. That does not weaken the reason above,
 * it is the reason above seen from the other side: the branch adjudicates a
 * value, and a refusal has no value to adjudicate. The last test in this file
 * is now the pin for THAT — the rule exists and answers `true` for the
 * `undefined` it is handed here — so the announcement stays the widget's, and
 * this card is still not the one that installed the branch.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { I18nProvider } from '@object-ui/i18n';
import { valueSchemaFor } from '@objectstack/spec/data';

import { ObjectForm } from './ObjectForm';
import { registerAllFields, buildValidationRules } from '@object-ui/fields';

registerAllFields();

const LOCATION_SCHEMA = valueSchemaFor({ type: 'location' } as any)!;

const siteSchema = {
  name: 'site',
  fields: {
    title: { type: 'text', label: 'Title' },
    place: { type: 'location', label: 'Place' },
  },
};

const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(siteSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

/**
 * The form's own error line for a field — `<FormMessage/>`, the text a submit
 * refusal draws — or `null` while the field carries none. Distinct from the
 * widget's own refusal line, which shows before any validation has run.
 */
function formError(container: HTMLElement, name: string): string | null {
  return container.querySelector(`[data-field="${name}"] [id$="-form-item-message"]`)?.textContent ?? null;
}

/** The whole rendered row for `place`, so any text the field draws is seen. */
function placeRowText(container: HTMLElement): string {
  let node: HTMLElement | null = container.querySelector('input[name="place"]');
  for (let i = 0; i < 4 && node?.parentElement; i++) node = node.parentElement;
  return (node?.textContent || '').trim();
}

async function typeInto(container: HTMLElement, text: string) {
  fireEvent.change(await waitInput(container, 'place'), { target: { value: text } });
  const el = container.querySelector('input[name="place"]') as HTMLInputElement;
  return { ariaInvalid: el.getAttribute('aria-invalid'), domValue: el.value, rowText: placeRowText(container) };
}

function mountForm() {
  const ds = makeDS();
  const { container } = render(
    <ObjectForm
      schema={{ type: 'object-form', objectName: 'site', mode: 'create' } as any}
      dataSource={ds as any}
    />,
  );
  return { ds, container };
}

describe('ObjectForm shows WHY a location was refused (objectui#6716)', () => {
  it.each([
    ['the RANGE arm', '999, 999'],
    ['the FORMAT arm', 'not a coordinate'],
  ])('%s marks the control invalid and renders a reason', async (_arm, typed) => {
    const { ds, container } = mountForm();
    fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
    const after = await typeInto(container, typed);

    // 1. The a11y state a screen reader reads — `"false"` here before the fix.
    expect(after.ariaInvalid).toBe('true');
    // 2. A reason a person can read, which the row did not carry at all before.
    expect(after.rowText).toContain('Not saved:');
    // 3. The text that was refused is still in the box to be corrected.
    expect(after.domValue).toBe(typed);

    // 4. #6714's rule is untouched: the value is still NOT stored. Since
    //    objectstack#32139 the refusal is also this field's validation error,
    //    so the submit is refused and nothing is written at all.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(formError(container, 'place')).toContain('Not saved:'));
    expect(ds.create).not.toHaveBeenCalled();
  });

  it('clears the announcement when the coordinate is corrected, and stores it', async () => {
    const { ds, container } = mountForm();
    fireEvent.change(await waitInput(container, 'title'), { target: { value: 'HQ' } });
    expect((await typeInto(container, '999, 999')).ariaInvalid).toBe('true');

    const fixed = await typeInto(container, '30.2741, 120.1551');
    expect(fixed.ariaInvalid).toBe('false');
    expect(fixed.rowText).not.toContain('Not saved:');

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalled());
    const stored = ds.create.mock.calls[0][1].place;
    expect(stored).toEqual({ lat: 30.2741, lng: 120.1551 });
    expect(LOCATION_SCHEMA.safeParse(stored).success).toBe(true);
  });

  it('says nothing about a coordinate it accepts', async () => {
    const { container } = mountForm();
    const after = await typeInto(container, '30.2741, 120.1551');
    expect(after.ariaInvalid).toBe('false');
    expect(after.rowText).not.toContain('Not saved:');
  });
});

describe('the announcement is still the widget\'s, not the host rule\'s (objectui#6716)', () => {
  it('the `location` rule objectui#6744 added is handed `undefined` by a refusal', () => {
    // This pin used to read "compiles no rule for a `location` field". #6744
    // answered that question — the branch exists, for STORED values — so the
    // pin now asserts the property that actually kept #6716 widget-local, and
    // that a future edit could still break: the host rule adjudicates a VALUE,
    // and a refusal produces none.
    const rules = buildValidationRules({ type: 'location', name: 'place' });
    expect(typeof rules.validate.location).toBe('function');
    // What the rule sees in both refusal arms above, because `onChange` never
    // fired: nothing. A rule that answered anything but `true` here would be
    // reporting a refusal it cannot observe.
    expect(rules.validate.location(undefined)).toBe(true);
    // A control from the same call, so the reading above cannot be an artefact
    // of a helper that answers the same way for everything.
    expect(buildValidationRules({ type: 'text', name: 'title', required: true })).toEqual({ required: true });
  });
});

/* -------------------------------------------------------------------------- */
/* objectstack#32139 — a refused draft blocks the save on an edit form.        */
/* -------------------------------------------------------------------------- */

describe('a refused location draft blocks Update on an edit form (objectstack#32139)', () => {
  const STORED = { lat: 22.54, lng: 114.05 };

  async function mountEdit(language?: string) {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(siteSchema),
      findOne: vi.fn().mockResolvedValue({ id: 'r1', title: 'HQ', place: STORED }),
      create: vi.fn(),
      update: vi.fn(async (_o: string, _id: string, d: any) => ({ id: 'r1', ...d })),
    };
    const user = userEvent.setup();
    const form = (
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'site', mode: 'edit', recordId: 'r1' } as any}
        dataSource={ds as any}
      />
    );
    const { container } = render(
      language
        ? (
          <I18nProvider persistLanguage={false} config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
            {form}
          </I18nProvider>
        )
        : form,
    );
    const box = await waitInput(container, 'place');
    await waitFor(() => expect(box.value).toBe('22.54, 114.05'));
    // The form's submit button, whatever the reader's language calls it.
    const update = () => user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
    return { ds, user, container, box, update };
  }

  /** Settle a submit that may be refused: wait for the write or for the form's field error. */
  async function settled(ds: { update: { mock: { calls: unknown[] } } }, container: HTMLElement) {
    await waitFor(() => {
      if (!ds.update.mock.calls.length && formError(container, 'place') === null) {
        throw new Error('form has neither written nor refused yet');
      }
    });
  }

  /** How many times the refusal sentence is drawn in the row: once, never twice. */
  const timesShown = (container: HTMLElement, text: string) => placeRowText(container).split(text).length - 1;

  it.each([
    ['cleared first, then typed', true],
    ['typed over the selected value', false],
  ])('non-coordinate text %s refuses the save and writes nothing', async (_how, clearFirst) => {
    const { ds, user, container, box, update } = await mountEdit();
    if (clearFirst) await user.clear(box);
    else await user.tripleClick(box);
    await user.keyboard('Shenzhen 深圳');
    expect(box.value).toBe('Shenzhen 深圳');

    await update();
    await settled(ds, container);
    expect(ds.update).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    // The refusal is the FORM's error now, and the widget does not repeat it.
    expect(formError(container, 'place')).toContain('Not saved:');
    expect(timesShown(container, 'Not saved:')).toBe(1);
    // The refused text stays in the box to be corrected.
    expect(box.value).toBe('Shenzhen 深圳');
  });

  it('the refusal is translated: a zh-CN reader sees the field error in Chinese', async () => {
    const { ds, user, container, box, update } = await mountEdit('zh-CN');
    await user.clear(box);
    await user.keyboard('Shenzhen 深圳');
    await update();
    await waitFor(() => expect(formError(container, 'place')).toContain('未保存'));
    expect(placeRowText(container)).not.toContain('Not saved:');
    expect(ds.update).not.toHaveBeenCalled();
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('a valid pair typed over the old one still saves', async () => {
    const { ds, user, box, update } = await mountEdit();
    await user.clear(box);
    await user.type(box, '31.23, 121.47');
    await update();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toMatchObject({ place: { lat: 31.23, lng: 121.47 } });
  });

  it('clearing the box on purpose still writes null', async () => {
    const { ds, user, box, update } = await mountEdit();
    await user.clear(box);
    expect(box).toHaveAttribute('aria-invalid', 'false');
    await update();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toMatchObject({ place: null });
  });

  it('correcting a refused draft withdraws the error and saves the pair', async () => {
    const { ds, user, container, box, update } = await mountEdit();
    await user.clear(box);
    await user.keyboard('Shenzhen');
    await update();
    await settled(ds, container);
    expect(ds.update).not.toHaveBeenCalled();

    expect(formError(container, 'place')).toContain('Not saved:');

    await user.clear(box);
    await user.type(box, '31.23, 121.47');
    await waitFor(() => expect(placeRowText(container)).not.toContain('Not saved:'));
    expect(formError(container, 'place')).toBeNull();
    expect(box).toHaveAttribute('aria-invalid', 'false');
    await update();
    await waitFor(() => expect(ds.update).toHaveBeenCalledTimes(1));
    expect(ds.update.mock.calls[0][2]).toMatchObject({ place: { lat: 31.23, lng: 121.47 } });
  });
});
