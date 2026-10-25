/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13292 — an OBJECT-LEVEL rule's refusal names no field. The engine
 * attributes such a rule (a `script` rule, or one whose `fields` is empty) to
 * the `_record` sentinel, and the inline save bar used to print it as a label:
 * the banner read `_record: <the rule's message>`.
 *
 * The rulings these pin:
 *   (a) a `_record` entry shows the rule's message ALONE — no label, no
 *       sentinel text anywhere, no per-field hint;
 *   (b) a `field` naming nothing on the record is treated the same;
 *   (c) a real field's entry is unchanged — "Label: message" and its hint;
 *   (d) a mixed refusal shows both shapes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

const RULE_MESSAGE = 'Only Convert Lead marks a lead as Converted';

/** A `VALIDATION_FAILED` as `@objectstack/client` delivers it (`details.fields`). */
function validationRefusal(fields: Array<Record<string, unknown>>) {
  return {
    code: 'VALIDATION_FAILED',
    message: RULE_MESSAGE,
    details: { error: RULE_MESSAGE, code: 'VALIDATION_FAILED', fields },
  };
}

/** A host that echoes the machine name back when it knows no label, as the console does. */
const LABELS: Record<string, string> = { status: 'Status', converted: 'Converted' };
const fieldLabelFor = (n: string) => LABELS[n] ?? n;

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setField('status', 'converted')}>edit-status</button>
      <button onClick={() => inline.cancel()}>edit-cancel</button>
      <span data-testid="published-hints">{JSON.stringify(inline.fieldErrors)}</span>
    </>
  );
}

function renderAndSave(err: unknown) {
  const update = vi.fn().mockRejectedValue(err);
  render(
    <InlineEditProvider canEdit>
      <Harness />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="lead"
        recordId="l1"
        data={{ updated_at: 'v1', status: 'open', converted: false }}
        refresh={vi.fn()}
        fieldLabelFor={fieldLabelFor}
      />
    </InlineEditProvider>,
  );
  fireEvent.click(screen.getByText('edit-enter'));
  fireEvent.click(screen.getByText('edit-status'));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  return update;
}

const banner = () => screen.getByRole('alert');
const publishedHints = () => JSON.parse(screen.getByTestId('published-hints').textContent || 'null');
const fieldLines = () =>
  Array.from(document.querySelectorAll('[data-inline-field-error]')).map((li) => li.textContent);
const recordLines = () =>
  Array.from(document.querySelectorAll('[data-inline-record-error]')).map((li) => li.textContent);

describe('objectui#13292 — a record-level refusal reads without a field label', () => {
  it('(a) shows a `_record` entry as the rule message alone, with no sentinel and no hint', async () => {
    renderAndSave(validationRefusal([{ field: '_record', code: 'rule_violation', message: RULE_MESSAGE }]));

    await waitFor(() => expect(banner()).toBeInTheDocument());
    expect(banner().textContent).toBe(RULE_MESSAGE);
    expect(document.body.textContent).not.toContain('_record');
    expect(fieldLines()).toEqual([]);
    expect(publishedHints()).toBeNull();
  });

  it('(b) treats a `field` naming nothing on the record the same as `_record`', async () => {
    renderAndSave(validationRefusal([{ field: 'no_such_field', code: 'rule_violation', message: RULE_MESSAGE }]));

    await waitFor(() => expect(banner()).toBeInTheDocument());
    expect(banner().textContent).toBe(RULE_MESSAGE);
    expect(document.body.textContent).not.toContain('no_such_field');
    expect(publishedHints()).toBeNull();
  });

  it('(c) CONTROL: a real field keeps its label in the banner and its per-field hint', async () => {
    renderAndSave(validationRefusal([{ field: 'converted', code: 'rule_violation', message: RULE_MESSAGE }]));

    await waitFor(() => expect(fieldLines()).toEqual([`Converted: ${RULE_MESSAGE}`]));
    expect(recordLines()).toEqual([]);
    expect(publishedHints()).toEqual({ converted: RULE_MESSAGE });
  });

  it('(d) a mixed refusal labels the field entry and leaves the record-level message bare', async () => {
    renderAndSave(
      validationRefusal([
        { field: 'status', code: 'invalid_option', message: 'Status is not allowed here' },
        { field: '_record', code: 'rule_violation', message: RULE_MESSAGE },
      ]),
    );

    await waitFor(() => expect(fieldLines()).toEqual(['Status: Status is not allowed here']));
    expect(recordLines()).toEqual([RULE_MESSAGE]);
    expect(banner().textContent).not.toContain('_record');
    expect(publishedHints()).toEqual({ status: 'Status is not allowed here' });
  });

  it('retires the record-level line with the session', async () => {
    renderAndSave(validationRefusal([{ field: '_record', code: 'rule_violation', message: RULE_MESSAGE }]));
    await waitFor(() => expect(banner()).toBeInTheDocument());

    fireEvent.click(screen.getByText('edit-cancel'));
    fireEvent.click(screen.getByText('edit-enter'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(recordLines()).toEqual([]);
  });
});
