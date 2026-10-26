// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12681 — editing a formula field's "Formula (CEL)" editor must never
 * leave a `formula` key on the draft.
 *
 * ## The defect this file keeps fixed
 *
 * The editor's `onChange` migrated the legacy alias with a
 * `patchDef({ expression, formula: undefined })` patch. `patchDef` spreads the
 * patch over the definition, so the draft field came out with an OWN `formula`
 * property whose value is `undefined`. The client spec check judges that draft
 * with the spec's strict `FieldSchema`, which reports an own key it does not
 * declare as `unrecognized_keys` at `fields.NAME` whatever the value is — and
 * the objectui#6526 pointer then tells the author the field "carries the
 * retired `formula` key" and to make the very edit they are making. The wire
 * drops `undefined`, so the save was fine and the banner cleared after the
 * autosave; until then every edit of a clean formula field showed it.
 *
 * ## What is judged, and by what
 *
 * The real inspector, inside a parent that feeds each patch back into the
 * draft as the designer pages do. Each draft it produces is judged twice:
 *
 *  - by `ObjectSchema` from `@objectstack/spec/data`, the schema the client
 *    check loads for `object`, for the issue KIND (`unrecognized_keys`);
 *  - by `validateMetadataDraft('object', …, { mode: 'edit' })`, the check the
 *    console runs on an opened object, for the SUBJECT the banner would name
 *    (an issue at the field's own path, `fields.NAME`).
 *
 * The migration objectui#6526 ruled for is pinned in the same terms: a stored
 * field that carries `formula` is reported at its path before the edit, and
 * the edit commits `expression` and leaves no `formula` behind.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';

// The inspector loads the object list (published + drafts) for the lookup
// picker; stub both surfaces.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { validateMetadataDraft } from '../clientValidation';
import { __setCelFormulaLoader } from '../celAuthoring';

type Row = Record<string, unknown>;

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

/** The object the card's reproduction creates over REST. */
const objectWith = (estTotal: Row): Row => ({
  name: 'qavrf_job',
  label: 'QA Job',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    est_hours: { type: 'number', label: 'Est' },
    est_total: estTotal,
  },
});

/** Real-parent harness: every patch is applied to the draft the next render reads. */
function Designer({ initial, drafts }: { initial: Row; drafts: Row[] }) {
  const [draft, setDraft] = React.useState<Row>(initial);
  return (
    <ObjectFieldInspector
      type="object"
      name="qavrf_job"
      draft={draft}
      selection={{ kind: 'field', id: 'est_total' }}
      onPatch={(patch: Row) => {
        setDraft((d) => {
          const next = { ...d, ...patch };
          drafts.push(next);
          return next;
        });
      }}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

function formulaEditor(): HTMLTextAreaElement {
  const el = document.getElementById('field-formula-est_total');
  expect(el, 'the Formula (CEL) editor renders for a formula field').toBeTruthy();
  return el as HTMLTextAreaElement;
}

/** The `unrecognized_keys` issues the spec's own schema reports for `draft`. */
function unrecognizedKeys(draft: Row): Array<{ path: string; keys: string[] }> {
  const res = ObjectSchema.safeParse(draft);
  if (res.success) return [];
  return res.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .map((i) => ({ path: i.path.join('.'), keys: [...((i as { keys?: string[] }).keys ?? [])] }));
}

/** The issues the console's live check reports at the field's own path. */
async function fieldLevelIssues(draft: Row): Promise<string[]> {
  const res = await validateMetadataDraft('object', draft, undefined, { mode: 'edit' });
  return res.issues.filter((i) => i.path === 'fields.est_total').map((i) => i.message);
}

const estTotal = (draft: Row) => (draft.fields as Record<string, Row>).est_total;

describe('ObjectFieldInspector — the formula editor never leaves a `formula` key on the draft (objectui#12681)', () => {
  it('THE PIN: every step of an edit on a clean formula field judges with zero unrecognized keys', async () => {
    const initial = objectWith({
      type: 'formula',
      label: 'Est Total',
      expression: 'record.est_hours * 1.1',
      returnType: 'number',
    });
    // Control: the stored body is clean under both judges before anything is typed.
    expect(unrecognizedKeys(initial)).toEqual([]);
    expect(await fieldLevelIssues(initial)).toEqual([]);

    const drafts: Row[] = [];
    render(<Designer initial={initial} drafts={drafts} />);

    // The card's keystrokes (` + 1`, one at a time), then a cleared box and a
    // retype: the blank step takes the `returnType` branch of the same writer.
    const steps = [
      'record.est_hours * 1.1 ',
      'record.est_hours * 1.1 +',
      'record.est_hours * 1.1 + ',
      'record.est_hours * 1.1 + 1',
      '',
      'record.est_hours',
    ];
    for (const value of steps) {
      fireEvent.change(formulaEditor(), { target: { value } });
      const draft = drafts.at(-1)!;
      expect(estTotal(draft), `after typing ${JSON.stringify(value)}`).not.toHaveProperty('formula');
      expect(unrecognizedKeys(draft), `after typing ${JSON.stringify(value)}`).toEqual([]);
      expect(await fieldLevelIssues(draft), `after typing ${JSON.stringify(value)}`).toEqual([]);
    }
    expect(drafts).toHaveLength(steps.length);
    // The edit itself landed on the spec key.
    expect(estTotal(drafts.at(-1)!).expression).toBe('record.est_hours');
  });

  it('the legacy migration still works: the pointer stands before the first edit, and that edit clears it', async () => {
    const initial = objectWith({ type: 'formula', label: 'Est Total', formula: 'record.est_hours * 1.1' });
    // Before the edit: the stored alias IS reported, at the field, with the pointer.
    expect(unrecognizedKeys(initial)).toEqual([{ path: 'fields.est_total', keys: ['formula'] }]);
    const before = await fieldLevelIssues(initial);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatch(/Formula \(CEL\)/);

    const drafts: Row[] = [];
    render(<Designer initial={initial} drafts={drafts} />);
    // The legacy value seeds the editor…
    expect(formulaEditor()).toHaveValue('record.est_hours * 1.1');
    fireEvent.change(formulaEditor(), { target: { value: 'record.est_hours * 1.1 + 1' } });

    // …and the one edit commits `expression` and removes the alias outright.
    const after = drafts.at(-1)!;
    expect(estTotal(after)).not.toHaveProperty('formula');
    expect(estTotal(after).expression).toBe('record.est_hours * 1.1 + 1');
    expect(unrecognizedKeys(after)).toEqual([]);
    expect(await fieldLevelIssues(after)).toEqual([]);
  });

  it('touches nothing else on the definition', () => {
    const drafts: Row[] = [];
    render(
      <Designer
        initial={objectWith({
          type: 'formula',
          label: 'Est Total',
          description: 'Estimated total',
          expression: { dialect: 'cel', source: 'record.est_hours', meta: { rationale: 'ai draft' } },
          returnType: 'number',
        })}
        drafts={drafts}
      />,
    );
    expect(screen.getByText('Formula (CEL)')).toBeTruthy();
    fireEvent.change(formulaEditor(), { target: { value: 'record.est_hours * 2.0' } });
    expect(estTotal(drafts.at(-1)!)).toEqual({
      type: 'formula',
      label: 'Est Total',
      description: 'Estimated total',
      expression: { dialect: 'cel', source: 'record.est_hours * 2.0', meta: { rationale: 'ai draft' } },
      returnType: 'number',
    });
  });
});
