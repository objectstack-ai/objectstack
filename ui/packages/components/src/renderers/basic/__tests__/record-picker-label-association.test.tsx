/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker` — the authored `label` is programmatically
 * associated with the combobox, not unassociated caption text beside it
 * (objectui#5771).
 *
 * Pre-fix, neither end carried the wiring: the `<label>` had no `htmlFor` and
 * the `SelectTrigger` had no `id`. That is a step worse than the sibling gap
 * objectui#5735 closed on `element:text_input` — there the label HALF was
 * already correct and only `description` was adrift; here the caption named
 * nothing at all.
 *
 * Measured (not assumed): with no association, the trigger's computed
 * accessible name is the EMPTY string even when a `placeholder` renders
 * visible text inside it — `role="combobox"` does not support "name from
 * content" the way a plain `button`/`link` would, so the rendered placeholder
 * text is not a fallback name here. The "mints no accessible name … when
 * `schema.id` is absent" case below pins the measured value directly.
 *
 * ## Pin the RESOLUTION, not the two attributes
 *
 * Per objectui#3341's landed reasoning (which transfers verbatim: `SelectTrigger`
 * renders a `button` with `role="combobox"`, a labelable element, so a plain
 * `htmlFor`/`id` pair is the correct association with no `aria-labelledby`
 * needed — Radix sets none on the trigger): the failure mode #3341's test file
 * documents is an association that LOOKS wired — a `label[for]` here, an `id`
 * there — while resolving to nothing, because the two values never actually
 * matched. Two `expect`s on `htmlFor` and `id` in isolation would pass against
 * exactly that bug. So every case below resolves the relationship end to end —
 * `getByLabelText` / `toHaveAccessibleName`, or `label[for]` followed by
 * `document.getElementById` — never the two attributes read separately.
 *
 * ## Wired when `schema.id` exists — the #5735 / #3341 shape, not a `useId` fallback
 *
 * Triage inherited #5735's ruling on the same question for the complement
 * block rather than reaching for an always-on `useId()` fallback: `htmlFor`
 * needs an id on the control, which only the author can supply via
 * `schema.id`, so the wiring can only hold when they did. The no-`schema.id`
 * case below pins that this is unchanged, deliberate behaviour, not an
 * oversight — mirroring `text-input-description-association.test.tsx`'s
 * "associates … even when the node carries NO id" case for the same shape.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// Registers `element:record_picker` at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

function renderPicker(properties: Record<string, unknown>, schemaExtra: Record<string, unknown> = {}) {
  const C = ComponentRegistry.get('element:record_picker') as React.ComponentType<any>;
  if (!C) throw new Error('element:record_picker is not registered');
  return render(<C schema={{ type: 'element:record_picker', dataSource: { object: 'account' }, properties, ...schemaExtra }} />);
}

describe('element:record_picker — label→combobox association (objectui#5771)', () => {
  it('resolves the label to the combobox, so getByLabelText finds the trigger', () => {
    renderPicker({ label: 'Owner' }, { id: 'owner_picker' });

    const combobox = screen.getByRole('combobox');
    expect(screen.getByLabelText('Owner')).toBe(combobox);
    expect(combobox).toBe(screen.getByTestId('record-picker-trigger'));
  });

  it('gives the combobox the LABEL as its accessible name — the caption the docs advertise', () => {
    renderPicker({ label: 'Owner' }, { id: 'owner_picker' });

    // Findable BY that accessible name, the way an author-facing a11y check
    // (and the testing-library query the PM route calls for) would drive it.
    const combobox = screen.getByRole('combobox', { name: 'Owner' });
    expect(combobox).toHaveAccessibleName('Owner');
  });

  it('points htmlFor at an id that really exists on the trigger, not a name that merely looks matched', () => {
    // The #3341 failure mode: two attributes present but pointing at nothing.
    // Read `for` off the rendered label and resolve it through the DOM, rather
    // than asserting `id`/`htmlFor` as two independent strings.
    renderPicker({ label: 'Owner' }, { id: 'owner_picker' });

    const label = document.querySelector('label[for]');
    expect(label).not.toBeNull();
    const target = document.getElementById(label!.getAttribute('for')!);
    expect(target).not.toBeNull();
    expect(target).toBe(screen.getByTestId('record-picker-trigger'));
    expect(target).toHaveAttribute('role', 'combobox');
  });

  it('registers the label on the trigger via the DOM `labels` collection', () => {
    // The association browsers actually use for both the accessible name and
    // click-to-focus.
    renderPicker({ label: 'Owner' }, { id: 'owner_picker' });

    const trigger = screen.getByTestId('record-picker-trigger') as HTMLButtonElement;
    expect(trigger.labels).not.toBeNull();
    expect(Array.from(trigger.labels!)).toHaveLength(1);
    expect(trigger.labels![0].getAttribute('for')).toBe(trigger.id);
    expect(trigger.labels![0]).toHaveTextContent('Owner');
  });

  it('mints no accessible name from the label when `schema.id` is absent — unchanged, deliberate degradation', () => {
    // The deliberate half of the fix (triage: follow #5735's answer, not a
    // `useId()` fallback that would always name the control). Only the author
    // can supply `schema.id`, so this wiring can only hold when they did —
    // this is exactly the defect the issue title describes: "the caption its
    // own docs advertise names nothing", pinned so a later change cannot
    // silently start minting an id (or otherwise naming the control) for a
    // picker whose author never supplied one.
    //
    // An explicit `placeholder` is passed and confirmed present in the DOM, to
    // rule out the one alternative source of a name: it does NOT reach the
    // accessible name either (measured — `role="combobox"` does not support
    // "name from content"), so the empty name below is not an artifact of
    // omitting `placeholder`.
    renderPicker({ label: 'Owner', placeholder: 'Select…' });

    const trigger = screen.getByTestId('record-picker-trigger');
    expect(trigger).toHaveTextContent('Select…');
    const label = document.querySelector('label');
    expect(label).not.toBeNull();
    expect(label).not.toHaveAttribute('for');
    expect(trigger).not.toHaveAttribute('id');
    expect(trigger).toHaveAccessibleName('');
  });

  it('renders no label element when `label` is absent — the fix cannot be "always associate"', () => {
    renderPicker({ placeholder: 'Select…' }, { id: 'owner_picker' });

    // No `label` was authored, so there is nothing for `htmlFor`/`id` to
    // associate — pinned so a later change cannot silently start minting a
    // `<label>` for a key that was never authored.
    expect(document.querySelector('label')).toBeNull();
  });

  it('resolves the RESOLVED locale value as the accessible name, not the raw map', () => {
    const C = ComponentRegistry.get('element:record_picker') as React.ComponentType<any>;
    render(
      <I18nProvider
        persistLanguage={false}
        config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}
      >
        <C
          schema={{
            type: 'element:record_picker',
            id: 'owner_picker',
            dataSource: { object: 'account' },
            properties: { label: { en: 'Owner', 'zh-CN': '负责人' } },
          }}
        />
      </I18nProvider>,
    );

    expect(screen.getByRole('combobox')).toHaveAccessibleName('负责人');
  });

  it('survives the real render path through SchemaRenderer', () => {
    render(
      <SchemaRenderer
        schema={{
          type: 'element:record_picker',
          id: 'owner_picker',
          dataSource: { object: 'account' },
          properties: { label: 'Owner' },
        }}
      />,
    );

    const combobox = screen.getByRole('combobox');
    expect(screen.getByLabelText('Owner')).toBe(combobox);
    expect(combobox).toHaveAccessibleName('Owner');
  });
});
