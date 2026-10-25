/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end: the EDITABLE rich-text widget forwards the host's `id` and
 * `aria-describedby` to the control the user actually types into
 * (objectui#4810).
 *
 * The defect, measured on a real form renderer with a field carrying a
 * `description` — count the elements whose `aria-describedby` names the
 * `…-form-item-description` id, and resolve the visible label's `for`:
 *
 * ```
 * markdown  editable  descEl=SET  consumers=0  hostIdEl=NONE  for=DANGLING
 * text      editable  descEl=SET  consumers=1  hostIdEl=input     for=RESOLVES
 * textarea  editable  descEl=SET  consumers=1  hostIdEl=textarea  for=RESOLVES
 * ```
 *
 * `RichTextField` had no `toDomProps` anywhere in the file: `<FormControl>`'s
 * Radix `Slot` handed it the field's `id` / `aria-describedby`, the widget read
 * only `className` / `disabled` off `props`, and both landed nowhere. So the
 * form's visible label pointed at an id NO element carried (clicking it focused
 * nothing) and the `<FormDescription>` the form rendered had zero consumers —
 * a screen reader never announced the help text for a markdown / html /
 * richtext field.
 *
 * `markdown`, `html` and `richtext` are three registry keys on ONE widget
 * (`fieldWidgetMap`), so every case below runs for all three: a fix landed on
 * one key and not the others is not possible here, but a REGISTRATION that
 * stops pointing at this widget is, and that is what the parameterisation
 * pins.
 *
 * ## What this file deliberately does NOT cover
 *
 * - The **readonly** branch. `markdown readonly` measures `consumers=0` too,
 *   but that half is objectui#4788 (the read-only replacement display family),
 *   whose mechanism is still undecided. Pinning today's readonly reading here
 *   would freeze a defect that has an open design question.
 * - Other widgets missing the same pass-through (`slider` / `grid` /
 *   `signature`): they are in objectui#3318's ledger and are fixed by its
 *   recipe, not here.
 *
 * The widget is registered raw rather than through `registerAllFields()`, which
 * wraps every loader in `React.lazy`: an unbounded module load inside a bounded
 * `findBy`/`waitFor` window is the repo's known flake generator (AGENTS.md
 * 测试纪律, objectui#3010). Same component, no Suspense boundary.
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope: pulls in the form renderer's registration side effect.
import '@object-ui/components';

import { RichTextField } from '../widgets/RichTextField';

/** The three `fieldWidgetMap` keys that resolve to this one widget. */
const RICH_TEXT_TYPES = ['markdown', 'html', 'richtext'] as const;

const DESCRIPTION = 'Some help';

beforeAll(() => {
  for (const type of RICH_TEXT_TYPES) {
    ComponentRegistry.register(type, RichTextField as any, {
      namespace: 'field',
      skipFallback: true,
    });
  }
}, 30000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The real form renderer hosting one rich-text field — the #4810 probe. */
function renderForm(type: string, extra: Record<string, unknown> = {}) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues: { body: '' },
        fields: [
          {
            name: 'body',
            label: 'Body',
            type: `field:${type}`,
            description: DESCRIPTION,
            ...extra,
          },
        ],
        onSubmit: () => {},
      }}
    />,
  );
}

/** The editing surface the widget renders — what focus and ARIA must land on. */
function editorSurface(): HTMLTextAreaElement {
  const el = document.querySelector('[data-field="body"] textarea');
  if (!el) throw new Error('the rich-text widget rendered no textarea');
  return el as HTMLTextAreaElement;
}

/**
 * The probe from the issue, verbatim: which element carries the host id, does
 * the visible label's `for` resolve, and how many elements consume the
 * description id.
 */
function probe() {
  const descEl = document.querySelector('[id$="-form-item-description"]');
  const descId = descEl?.getAttribute('id') ?? '';
  const consumers = Array.from(document.querySelectorAll('[aria-describedby]')).filter((el) =>
    (el.getAttribute('aria-describedby') ?? '').split(/\s+/).includes(descId),
  );
  const label = document.querySelector('label[for]');
  const forId = label?.getAttribute('for') ?? '';
  const hostIdEl = forId ? document.getElementById(forId) : null;
  return {
    descEl,
    descId,
    consumers,
    forId,
    hostIdEl,
    for: hostIdEl ? 'RESOLVES' : 'DANGLING',
  };
}

describe('editable rich-text carries the host id (objectui#4810)', () => {
  it.each(RICH_TEXT_TYPES)('%s: the visible label resolves to the editor', (type) => {
    renderForm(type);

    const reading = probe();
    // The measured defect: `for=DANGLING`, `hostIdEl=NONE`.
    expect(reading.for).toBe('RESOLVES');
    expect(reading.forId).toMatch(/-form-item$/);
    expect(reading.hostIdEl).toBe(editorSurface());
  });

  it.each(RICH_TEXT_TYPES)('%s: getByLabelText reaches the editor', (type) => {
    renderForm(type);

    // Resolves label→control through `for`/id, so it fails outright — "found a
    // label … however no form control was found associated to that label" —
    // while the id lands nowhere.
    expect(screen.getByLabelText('Body')).toBe(editorSurface());
  });

  it.each(RICH_TEXT_TYPES)('%s: clicking the label reaches the editor', (type) => {
    renderForm(type);

    // The user-facing symptom: clicking a field's label is the normal way to
    // start typing, and it reaches the control only through `for`/id — the
    // label's ACTIVATION BEHAVIOUR, which forwards the click to the labelled
    // control. Asserted as the forwarded click rather than as focus because
    // jsdom implements the forwarding and not the focus that follows it in a
    // browser; a dangling `for` forwards nothing, which is the reading this
    // pins.
    const editor = editorSurface();
    const clicked = vi.fn();
    editor.addEventListener('click', clicked);

    fireEvent.click(screen.getByText('Body'));

    expect(clicked).toHaveBeenCalledTimes(1);
  });
});

describe('editable rich-text consumes the form description (objectui#4810)', () => {
  it.each(RICH_TEXT_TYPES)('%s: the description has exactly one consumer', (type) => {
    renderForm(type);

    const reading = probe();
    // `descEl=SET` was never the problem — the form rendered the help text all
    // along. `consumers=0` is: nothing pointed at it.
    expect(reading.descEl).not.toBeNull();
    expect(reading.descEl).toHaveTextContent(DESCRIPTION);
    expect(reading.consumers).toHaveLength(1);
    expect(reading.consumers[0]).toBe(editorSurface());
  });

  it.each(RICH_TEXT_TYPES)('%s: the editor names the description id', (type) => {
    renderForm(type);

    const { descId } = probe();
    expect(descId).not.toBe('');
    expect((editorSurface().getAttribute('aria-describedby') ?? '').split(/\s+/)).toContain(descId);
  });
});

describe('rich-text keeps announcing invalidity (objectui#3318 stays PASS)', () => {
  // `RichTextEditorSurface` reads `error` and sets `aria-invalid` itself — one
  // of #3318's 17 PASS entries, and the reason this widget was never on that
  // issue's fix list. The pass-through spread must not disturb it: the host's
  // own `aria-invalid` arrives through `toDomProps`' `aria-*` family, so the
  // widget's read has to stay AFTER the spread to remain the authority.

  it.each(RICH_TEXT_TYPES)('%s: a valid field is not marked invalid', (type) => {
    renderForm(type);

    expect(editorSurface()).toHaveAttribute('aria-invalid', 'false');
  });

  it.each(RICH_TEXT_TYPES)('%s: a failed required check marks the editor invalid', async (type) => {
    renderForm(type, { required: true });

    fireEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      expect(editorSurface()).toHaveAttribute('aria-invalid', 'true');
    });

    // And the error message joins the description in `aria-describedby` — the
    // second half of what `<FormControl>` hands down, delivered by the same
    // spread.
    const messageId = document
      .querySelector('[data-field="body"] [id$="-form-item-message"]')
      ?.getAttribute('id');
    expect(messageId).toBeTruthy();
    expect((editorSurface().getAttribute('aria-describedby') ?? '').split(/\s+/)).toContain(
      messageId,
    );
  });
});
