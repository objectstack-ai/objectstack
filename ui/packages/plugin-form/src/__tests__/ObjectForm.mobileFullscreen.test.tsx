/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * End-to-end pin for `ObjectFormSchema.mobile.fullscreenLongText`
 * (objectui#3245, extended to rich text in objectui#3301) — the ONLY
 * integration coverage this feature has.
 *
 * Everything below is real: the real `ObjectForm` (the flag's single
 * producer), the real form renderer in `@object-ui/components`, the real
 * registry, and the real `TextAreaField` from `@object-ui/fields`. Nothing is
 * mocked but the data source, because the bug this file exists to prevent
 * lived exactly in the SEAMS between those four — each end looked correct on
 * its own and the flag fell through the join:
 *
 *   1. `ObjectForm` auto-generates a FormField with `type: 'field:textarea'`
 *      and stashes the object-field metadata on `field`;
 *   2. it stamped `mobile_fullscreen` onto the FormField ITSELF;
 *   3. the form renderer forwards `field: field.field || field` — for an
 *      auto-generated field `.field` exists, so the widget received the raw
 *      metadata, WITHOUT the flag;
 *   4. the FormField-level copy was then dropped by
 *      `stripRegisteredFieldProps`.
 *
 * Result: the flag reached `TextAreaField` only on the hand-authored
 * `customFields` path (no `.field` to shadow the FormField), i.e. never on the
 * path virtually every form actually takes. Unit tests on both ends passed
 * throughout. The fix stamps the flag onto the metadata carrier the renderer
 * will forward — `f.field || f` — so there stays exactly ONE carrier
 * (objectui#3233) and it is the one the widget reads.
 *
 * `registerAllFields` registers each widget as a `React.lazy`, so the
 * assertions sit behind a dynamic-import boundary — the shape AGENTS.md's test
 * discipline says must be warmed at MODULE SCOPE (never in a `beforeAll`,
 * whose 10s budget is narrower than the timeout it would replace) so the cold
 * transform is billed to the import phase, which no test/hook timeout bounds.
 * Here the barrel import below IS that warm-up: `@object-ui/fields`'s entry
 * statically imports and re-exports `./widgets/TextAreaField`, the very
 * specifier the lazy loader uses, so by the time a test renders, the widget
 * module is already in the ESM cache and `React.lazy` resolves off it instead
 * of racing RTL's 1000ms `findBy` budget against a cold Vite transform.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import type { ObjectFormSchema } from '@object-ui/types';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const objectSchema = {
  name: 'issue_note',
  label: 'Issue Note',
  fields: {
    body: { type: 'textarea', label: 'Body' },
  },
};

/**
 * The rich-text half of the same promise (objectui#3301). `markdown` and
 * `html` both map to `field:markdown` / `field:html` (`mapFieldTypeToFormType`)
 * and both resolve to `RichTextField`, which — until #3301 — never read the
 * flag `ObjectForm` had been stamping on them all along.
 */
const richTextObjectSchema = {
  name: 'release_note',
  label: 'Release Note',
  fields: {
    summary: { type: 'markdown', label: 'Summary' },
    changelog: { type: 'html', label: 'Changelog' },
  },
};

/** A form holding BOTH widget families, to pin that one setting drives both. */
const mixedObjectSchema = {
  name: 'mixed_note',
  label: 'Mixed Note',
  fields: {
    body: { type: 'textarea', label: 'Body' },
    summary: { type: 'markdown', label: 'Summary' },
  },
};

/**
 * The spec's OWN spelling of the same widget (objectui#4831).
 *
 * `richtext` is what `@objectstack/spec`'s `FieldType` calls this type;
 * `mapFieldTypeToFormType` maps it to `field:richtext`, and the widget map
 * resolves `richtext` to `RichTextField` — the same component `markdown` and
 * `html` resolve to, i.e. three registry keys on ONE widget. The producer side
 * listed only two of the three, so a field authored exactly as the spec
 * prescribes rendered `RichTextField` with no expand affordance while its two
 * siblings got one.
 */
const specRichTextObjectSchema = {
  name: 'spec_note',
  label: 'Spec Note',
  fields: {
    body: { type: 'richtext', label: 'Body' },
  },
};

function makeDataSource(schema: object = objectSchema) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(schema),
    findOne: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  } as any;
}

function renderForm(
  schema: Partial<ObjectFormSchema>,
  object: { name: string } & Record<string, unknown> = objectSchema,
) {
  return render(
    <ObjectForm
      schema={
        {
          type: 'object-form',
          objectName: object.name,
          mode: 'create',
          ...schema,
        } as ObjectFormSchema
      }
      dataSource={makeDataSource(object)}
    />,
  );
}

/** The widget's INLINE control, as opposed to the one inside its dialog. */
function inlineControl(fieldName: string): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>(
    `[data-field="${fieldName}"] textarea`,
  );
  if (!el) throw new Error(`no control rendered for field "${fieldName}"`);
  return el;
}

describe('ObjectForm mobile.fullscreenLongText → TextAreaField (objectui#3245)', () => {
  it('reaches the widget for an AUTO-GENERATED long-text field', async () => {
    // The path almost every form takes: no `customFields`, so `ObjectForm`
    // builds the FormField from the object schema and stashes the metadata on
    // `.field`. This assertion was RED before the producer-side fix.
    renderForm({ mobile: { fullscreenLongText: true } });

    expect(await screen.findByTestId('textarea-fullscreen-toggle')).toBeInTheDocument();
  });

  it('still reaches the widget for a HAND-AUTHORED customFields long-text field, without displacing its other metadata', async () => {
    // Control for the fix: a hand-authored `customFields` entry carries no
    // `.field` metadata object, so `field.field || field` resolves to the
    // FormField ITSELF — that is the carrier, and the flag has to land on it.
    // This chain works today and must keep working.
    //
    // The extra metadata below is what makes this a real control rather than a
    // restatement of the test above. Stamping `field: { ...f.field, flag }`
    // UNCONDITIONALLY also lights the affordance up here — by conjuring a
    // metadata object out of `undefined` that contains nothing but the flag.
    // The renderer would then forward that stub as the widget's `field`, and
    // `rows` / `placeholder` (which `TextAreaField` reads off the metadata, not
    // off its props) would silently revert to their defaults. Asserting them
    // here is what makes that shortcut fail instead of pass.
    renderForm({
      mobile: { fullscreenLongText: true },
      customFields: [
        { name: 'body', label: 'Body', type: 'field:textarea', rows: 9, placeholder: 'Say more' },
      ],
    });

    expect(await screen.findByTestId('textarea-fullscreen-toggle')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText('Say more');
    expect(textarea).toHaveAttribute('rows', '9');
  });

  it('does NOT render the affordance when the form did not opt in', async () => {
    // Negative control: without `mobile.fullscreenLongText` there is no
    // producer, so no carrier may conjure the flag.
    renderForm({});

    // Wait for the textarea itself so we are asserting on a SETTLED form, not
    // on a widget that simply has not resolved yet.
    expect(await screen.findByRole('textbox')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    });
  });
});

/**
 * The other half of the same setting (objectui#3301).
 *
 * `mobile.fullscreenLongText` is documented as "textarea/rich-text get an
 * expand button", and `ObjectForm` has always stamped `mobile_fullscreen` onto
 * `field:markdown` / `field:html` too. `RichTextField` never read it, so the
 * rich-text half of that sentence had been inert since it was written — a
 * producer with no consumer, which no unit test on either end can see. These
 * assertions are RED against the pre-#3301 widget.
 */
describe('ObjectForm mobile.fullscreenLongText → RichTextField (objectui#3301)', () => {
  it('reaches the widget for an AUTO-GENERATED field:markdown / field:html field', async () => {
    renderForm({ mobile: { fullscreenLongText: true } }, richTextObjectSchema);

    // Both rich-text types resolve to the same widget, and both are stamped.
    await waitFor(() => {
      expect(screen.getAllByTestId('richtext-fullscreen-toggle')).toHaveLength(2);
    });
  });

  it('does NOT render the affordance when the form did not opt in', async () => {
    renderForm({}, richTextObjectSchema);

    // Settle on the rendered widget before asserting an absence.
    await waitFor(() => expect(inlineControl('summary')).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
    });
  });

  it('commits a fullscreen edit back into the form state', async () => {
    // The acceptance criterion end to end: edit inside the dialog, close it,
    // and the react-hook-form value is updated — observed through the INLINE
    // control, which re-renders from form state. A widget that committed to a
    // local buffer instead (or lost the value on unmount) fails here while
    // every isolated unit test still passes.
    renderForm(
      {
        mobile: { fullscreenLongText: true },
        customFields: [{ name: 'summary', label: 'Summary', type: 'field:markdown' }],
      },
      richTextObjectSchema,
    );

    // objectui#9778 — `customFields` MERGES over the metadata-generated set, so
    // this form draws the object's OTHER rich-text field (`changelog`) too and
    // there are two expand affordances on screen. The case is about `summary`,
    // so the lookup is scoped to it; before the merge this member was the whole
    // field set and an unscoped `findByTestId` happened to be unambiguous.
    await waitFor(() => expect(inlineControl('summary')).toBeInTheDocument());
    const summaryField = document.querySelector('[data-field="summary"]') as HTMLElement;
    const toggle = within(summaryField).getByTestId('richtext-fullscreen-toggle');
    fireEvent.click(toggle);

    fireEvent.change(screen.getByTestId('richtext-fullscreen-input'), {
      target: { value: '## Shipped' },
    });
    fireEvent.click(screen.getByTestId('richtext-fullscreen-save'));

    await waitFor(() => {
      expect(screen.queryByTestId('richtext-fullscreen-dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(inlineControl('summary')).toHaveValue('## Shipped');
    });
  });

  it('reaches the widget for a field the SPEC spells `richtext` (objectui#4831)', async () => {
    // The regression this case exists for. `richtext` is the spec's own name
    // for this type and resolves to the very same `RichTextField` that
    // `markdown` / `html` above resolve to — with the same reader, live since
    // #3301. Only the producer-side list was short, so this was the one
    // spelling of the three that never got the affordance.
    //
    // Deliberately NOT an assertion that the stamp list contains the literal
    // `'field:richtext'`: that shape is green whenever the string is present,
    // whether or not anything downstream can act on it (objectui#4250). This
    // goes through the real alias mapping, the real registry and the real
    // widget, so it can only be green when the button actually renders.
    renderForm({ mobile: { fullscreenLongText: true } }, specRichTextObjectSchema);

    expect(await screen.findByTestId('richtext-fullscreen-toggle')).toBeInTheDocument();
  });

  it('does NOT render the affordance for a `richtext` field when the form did not opt in', async () => {
    // Negative control for the case above: the new list member must not become
    // an unconditional stamp. Without the form-level opt-in there is no
    // producer, so `richtext` stays as bare as it was before #4831.
    renderForm({}, specRichTextObjectSchema);

    await waitFor(() => expect(inlineControl('body')).toBeInTheDocument());
    await waitFor(() => {
      expect(screen.queryByTestId('richtext-fullscreen-toggle')).not.toBeInTheDocument();
    });
  });

  it('drives BOTH widget families from the one form-level setting', async () => {
    // The regression this whole issue is about: the setting is form-level, so
    // a form containing a textarea AND a markdown field must light up both.
    // Before #3301 only the textarea did, from the very same stamp.
    renderForm({ mobile: { fullscreenLongText: true } }, mixedObjectSchema);

    expect(await screen.findByTestId('textarea-fullscreen-toggle')).toBeInTheDocument();
    expect(await screen.findByTestId('richtext-fullscreen-toggle')).toBeInTheDocument();
  });
});
