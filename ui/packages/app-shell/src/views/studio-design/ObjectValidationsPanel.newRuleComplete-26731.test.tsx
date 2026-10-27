/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26731 — a new field rule is held until it is complete, an empty
 * transition row is never stored, and a conditional's `when` is captioned as
 * what it is.
 *
 * Choosing State machine, Format or JSON schema in the New menu used to write
 * the rule to the object draft at once, on the object's first listed field
 * (`created_at` on a served object) and with no message, and the Data pillar's
 * autosave stored it. Now the new rule waits in the panel, as a guarded one
 * waits for its condition (objectui#11820): no field is picked for the author,
 * and the rule is written once, when it has a field and an error message.
 *
 * "Add transition" used to write the key `""` straight into the rule; the
 * blank row now stays in the editor until it has a from-state.
 *
 * The `conditional` rule's `when` input carried the script rule's caption
 * ("Fail condition … the save is rejected"), the opposite of what `when` does:
 * it says when the `then` rule applies.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider, createI18n } from '@object-ui/i18n';
import { ObjectSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { t } from '../metadata-admin/i18n';

afterEach(() => cleanup());

// The served object's audit column first, as the card measured it: the field a
// new rule must not be seeded with.
const baseDraft: Record<string, unknown> = {
  name: 'invoice',
  label: 'Invoice',
  fields: {
    created_at: { type: 'datetime', label: 'Created At', system: true },
    status: { type: 'select', label: 'Status' },
    payload: { type: 'json', label: 'Payload' },
  },
  validations: [
    { type: 'script', name: 'no_negative', message: 'no', condition: 'record.amount < 0', severity: 'error' },
  ],
};

const MESSAGE_BOX = 'e.g. Completion date is required when status is Done';

function Harness({ onPatch, initial = baseDraft }: { onPatch: (p: Record<string, unknown>) => void; initial?: Record<string, unknown> }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <ObjectValidationsPanel
      draft={draft}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
    />
  );
}

function addFromMenu(label: string) {
  fireEvent.click(screen.getByText('New'));
  fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

/** Pick `label` in the open rule's field picker, the shared `Select` (objectui#11865). */
async function pickField(label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId('rule-field'), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

function lastValidations(onPatch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const calls = onPatch.mock.calls;
  return calls[calls.length - 1][0].validations as Array<Record<string, unknown>>;
}

const FIELD_TYPES: ReadonlyArray<[type: string, menu: string, field: string]> = [
  ['state_machine', 'State machine — allowed transitions', 'Status (status)'],
  ['format', 'Format — regex / built-in format', 'Status (status)'],
  ['json_schema', 'JSON schema — validate a JSON field', 'Payload (payload)'],
];

describe('a new field rule waits for its field and message (objectstack#26731)', () => {
  it.each(FIELD_TYPES)('a new %s rule is held with no field until it has a field and a message, then written once', async (type, menu, fieldLabel) => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu(menu);

    // Held: listed, open, marked, and no field picked for the author.
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText('validation_2')).toBeInTheDocument();
    expect(screen.getByTestId('rule-unsaved')).toHaveTextContent('Not saved — needs a field');
    expect(screen.getByTestId('rule-held')).toHaveTextContent(
      'Not saved yet: the rule “validation_2” needs a field. Your changes are kept here and saved once it is filled in.',
    );
    expect(screen.getByTestId('rule-field')).toHaveTextContent('— pick a field —');
    expect(screen.getByTestId('rule-held-hint')).toBeInTheDocument();

    await pickField(fieldLabel);
    // A field alone is not enough: the rule still has nothing to tell the user.
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('rule-unsaved')).toHaveTextContent('Not saved — needs a message');
    expect(screen.getByTestId('rule-held')).toHaveTextContent('the rule “validation_2” needs an error message');
    expect(screen.getAllByTestId('rule-held-hint')).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText(MESSAGE_BOX), { target: { value: 'Bad value' } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch);
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual((baseDraft.validations as unknown[])[0]);
    const fieldName = /\((\w+)\)$/.exec(fieldLabel)![1];
    expect(written[1]).toMatchObject({
      type,
      name: 'validation_2',
      field: fieldName,
      message: 'Bad value',
      events: ['insert', 'update'],
    });
    expect(written[1].field).not.toBe('created_at');
    expect(ObjectSchema.safeParse({ ...baseDraft, validations: written }).success).toBe(true);

    // Written, it is an ordinary rule.
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
    expect(screen.queryByTestId('rule-held')).toBeNull();
    expect(screen.queryByTestId('rule-held-hint')).toBeNull();
  });

  it('a message typed first waits for the field, and the field writes it', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('Format — regex / built-in format');
    fireEvent.change(screen.getByPlaceholderText(MESSAGE_BOX), { target: { value: 'Bad code' } });
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('rule-held')).toHaveTextContent('needs a field');

    await pickField('Status (status)');
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastValidations(onPatch)[1]).toMatchObject({ type: 'format', field: 'status', message: 'Bad code' });
  });

  it('a blank message does not complete the rule', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    addFromMenu('JSON schema — validate a JSON field');
    await pickField('Payload (payload)');
    fireEvent.change(screen.getByPlaceholderText(MESSAGE_BOX), { target: { value: '   ' } });
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('rule-held')).toHaveTextContent('needs an error message');
  });

  it('control — an existing rule switched to a field type keeps the valid first-field skeleton', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    fireEvent.keyDown(screen.getByTestId('rule-type'), { key: 'ArrowDown' });
    fireEvent.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Format — regex / built-in format' }),
    );
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(lastValidations(onPatch)[0]).toMatchObject({ type: 'format', name: 'no_negative', field: 'created_at' });
    expect(screen.queryByTestId('rule-unsaved')).toBeNull();
  });
});

describe('an empty transition row is not stored (objectstack#26731)', () => {
  const machine = {
    ...baseDraft,
    validations: [
      { type: 'state_machine', name: 'status_flow', message: 'Bad move', field: 'status', transitions: { open: ['closed'] } },
    ],
  };

  it('“Add transition” shows a blank row and writes nothing until it has a from-state', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={machine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add transition' }));
    expect(onPatch).not.toHaveBeenCalled();
    const froms = screen.getAllByPlaceholderText(t('engine.studio.rules.transitionFrom', 'en-US'));
    expect(froms).toHaveLength(2);
    expect(froms[1]).toHaveValue('');

    // Next states typed first stay in the row, unsent.
    const tos = screen.getAllByPlaceholderText(t('engine.studio.rules.transitionTo', 'en-US'));
    fireEvent.change(tos[1], { target: { value: 'open' } });
    expect(onPatch).not.toHaveBeenCalled();

    fireEvent.change(froms[1], { target: { value: 'closed' } });
    expect(onPatch).toHaveBeenCalledTimes(1);
    const written = lastValidations(onPatch)[0];
    expect(written.transitions).toEqual({ open: ['closed'], closed: ['open'] });
    expect(written.transitions).not.toHaveProperty('');
    // The row it became is the one the author is typing in.
    expect(screen.getAllByPlaceholderText(t('engine.studio.rules.transitionFrom', 'en-US'))[1]).toHaveValue('closed');
  });

  it('deleting the blank row writes nothing', () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} initial={machine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add transition' }));
    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    // The row's own delete, not the rule's.
    fireEvent.click(deletes.filter((b) => b.getAttribute('data-testid') !== 'rule-delete')[1]);
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getAllByPlaceholderText(t('engine.studio.rules.transitionFrom', 'en-US'))).toHaveLength(1);
  });
});

describe('the conditional rule’s `when` has its own caption (objectstack#26731)', () => {
  const both = {
    ...baseDraft,
    validations: [
      { type: 'script', name: 'no_negative', message: 'no', condition: 'record.amount < 0', severity: 'error' },
      {
        type: 'conditional',
        name: 'enterprise_only',
        message: 'x',
        when: "record.status == 'open'",
        then: { type: 'script', name: 'enterprise_only_then', message: 'y', condition: 'record.amount > 1' },
      },
    ],
  };

  function captionOf(ruleName: string, lang: 'en' | 'zh'): string {
    const panel = <ObjectValidationsPanel draft={both} onPatch={() => {}} />;
    if (lang === 'en') render(panel);
    else {
      const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: { zh: {} } });
      render(<I18nProvider instance={zh}>{panel}</I18nProvider>);
    }
    fireEvent.click(screen.getByText(ruleName));
    const group = screen.getAllByRole('group').find((g) => g.hasAttribute('aria-labelledby') && g.tabIndex === -1)!;
    const text = document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent ?? '';
    cleanup();
    return text;
  }

  it.each([
    ['en', 'en-US'],
    ['zh', 'zh-CN'],
  ] as const)('in %s the conditional caption is not the script one, and says the Then rule applies', (lang, locale) => {
    const script = captionOf('no_negative', lang);
    const conditional = captionOf('enterprise_only', lang);
    expect(script).toBe(
      t('engine.studio.rules.celPre', locale) + t('engine.studio.rules.celTrue', locale) + t('engine.studio.rules.celMid', locale),
    );
    expect(conditional).toBe(
      t('engine.studio.rules.whenPre', locale) + t('engine.studio.rules.celTrue', locale) + t('engine.studio.rules.whenMid', locale),
    );
    expect(conditional).not.toBe(script);
    // Real rows, not the key echoed back.
    expect(t('engine.studio.rules.whenPre', locale)).not.toBe('engine.studio.rules.whenPre');
    expect(t('engine.studio.rules.whenMid', locale)).not.toBe('engine.studio.rules.whenMid');
    expect(conditional).toContain('Then');
  });
});
