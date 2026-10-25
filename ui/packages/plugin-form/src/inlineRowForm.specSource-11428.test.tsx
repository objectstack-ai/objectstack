/**
 * objectui#11428 — both halves of an inline master-detail collection's per-row
 * expand form read `@objectstack/spec`'s rule, not a local copy of it:
 *
 * - WHICH fields the form draws: `deriveFormFields` returns
 *   `deriveInlineRowFormFields`' answer;
 * - WHETHER a row offers the form at all: `MasterDetailForm` asks
 *   `isInlineRowFormOffered`, with the collection's RESOLVED `inlineMode`,
 *   `formFields` and `columns` (authored or derived).
 *
 * The local rules this card replaced agree with the spec on every input, so an
 * equality pin cannot tell "reads the spec" from "agrees with it by
 * coincidence" (the agreement itself is pinned by the corpus in
 * `deriveMasterDetail.inlineRowFormFields-11428.test.ts`). These pins can: the
 * two exports are wrapped in pass-through spies, and the stubbed rows hand back
 * an answer the local rule would never give. A site that stopped reading the
 * spec keeps its old answer and goes red here.
 *
 * The pass-through rows are the existing behaviour. With the real answer, the
 * three authored offer arms (`masterDetailDetailsMembers-8071` row 3: a list,
 * a form wider than its cells, a form no wider than its cells) answer as they
 * did, and a fully derived collection is offered the form its derived
 * `formFields` widen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React, { type ComponentProps } from 'react';
import type { DataSource } from '@object-ui/types';
import { registerAllFields } from '@object-ui/fields';
import { deriveInlineRowFormFields, isInlineRowFormOffered } from '@objectstack/spec/data';
import { MasterDetailForm, type MasterDetailDetailConfig, type MasterDetailFormSchema } from './MasterDetailForm';
import { deriveDetail, deriveFormFields } from './deriveMasterDetail';
import { en } from '@object-ui/i18n';

/** The `en` session's word for a boolean value: what `useBooleanValueLabel`
 *  (`@object-ui/fields`) draws under `en`. The derive functions require one
 *  (objectui#12924). */
const booleanLabel = (value: boolean) => (value ? en.common.yes : en.common.no);

type SpecData = typeof import('@objectstack/spec/data');
type Fields = typeof import('@object-ui/fields');
/** The members of a grid's props these pins read. */
type GridProps = { onRowExpand?: unknown; onAdd?: unknown; displayMode?: string; field?: { columns?: unknown[] } };

const { gridProps, probe } = vi.hoisted(() => ({
  gridProps: [] as GridProps[],
  probe: {
    factoryRan: false,
    realRowFormFields: undefined as unknown as SpecData['deriveInlineRowFormFields'],
    realOffer: undefined as unknown as SpecData['isInlineRowFormOffered'],
  },
}));

/** The spec's two exports behind pass-through spies; every other export is the real one. */
vi.mock('@objectstack/spec/data', async (importOriginal) => {
  const actual = await importOriginal<SpecData>();
  probe.factoryRan = true;
  probe.realRowFormFields = actual.deriveInlineRowFormFields;
  probe.realOffer = actual.isInlineRowFormOffered;
  return {
    ...actual,
    deriveInlineRowFormFields: vi.fn(actual.deriveInlineRowFormFields),
    isInlineRowFormOffered: vi.fn(actual.isInlineRowFormOffered),
  };
});

/** Every prop object `MasterDetailForm` hands the line grid; the REAL grid still renders. */
vi.mock('@object-ui/fields', async (importOriginal) => {
  const actual = await importOriginal<Fields>();
  const { createElement } = await import('react');
  const RealLineItemsField = actual.LineItemsField;
  return {
    ...actual,
    LineItemsField: (props: ComponentProps<Fields['LineItemsField']>) => {
      gridProps.push(props as GridProps);
      return createElement(RealLineItemsField, props);
    },
  };
});

registerAllFields();

const OBJECTS: Record<string, { name: string; fields: Record<string, Record<string, unknown>> }> = {
  po: { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } },
  po_line: {
    name: 'po_line',
    fields: {
      po: { type: 'master_detail', reference: 'po', label: 'Purchase order' },
      qty: { type: 'number', label: 'Qty' },
      price: { type: 'number', label: 'Price' },
    },
  },
  po_note: {
    name: 'po_note',
    fields: {
      po: { type: 'lookup', reference: 'po', label: 'Purchase order' },
      note: { type: 'text', label: 'Note' },
    },
  },
  // Fully derived: a `vector` field is no grid cell but a form field, so the
  // derived form (qty, embedding) is wider than the derived grid (qty), and
  // the smart default stays `grid`.
  po_vec: {
    name: 'po_vec',
    fields: {
      po: { type: 'master_detail', reference: 'po', label: 'Purchase order' },
      qty: { type: 'number', label: 'Qty' },
      embedding: { type: 'vector', label: 'Embedding' },
    },
  },
};

function makeDataSource(): DataSource {
  return {
    getObjectSchema: vi.fn(async (name: string) => OBJECTS[name] ?? { name, fields: {} }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] }),
  } as unknown as DataSource;
}

const QTY = { name: 'qty', label: 'Qty', type: 'number' as const };
const NOTE = { name: 'note', label: 'Note', type: 'text' as const };

const DETAILS: MasterDetailDetailConfig[] = [
  { childObject: 'po_line', relationshipField: 'po', title: 'As a list', columns: [QTY], inlineMode: 'form' },
  { childObject: 'po_line', relationshipField: 'po', title: 'Wider form', columns: [QTY], formFields: ['qty', 'price'] },
  { childObject: 'po_note', relationshipField: 'po', title: 'Cells only', columns: [NOTE], formFields: ['note'] },
  { childObject: 'po_vec', title: 'Derived' },
];
const HEADINGS = ['As a list', 'Wider form', 'Cells only', 'Derived'];

/** Mount the block and wait until every section's grid has its columns. */
async function mount() {
  const view = render(
    <MasterDetailForm schema={{ objectName: 'po', mode: 'create', details: DETAILS } satisfies MasterDetailFormSchema} dataSource={makeDataSource()} />,
  );
  await waitFor(() => {
    if (!view.container.querySelector('input[name="ref"]')) throw new Error('parent form not ready');
    for (const h of HEADINGS) if (!gridOf(h)?.field?.columns?.length) throw new Error(`${h}: columns not resolved yet`);
  });
  return view;
}

/** The props the grid of the section headed `heading` received LAST. */
function gridOf(heading: string): GridProps {
  const section = screen.getByRole('heading', { name: heading }).closest('section');
  if (!section) throw new Error(`no section headed ${heading}`);
  const sections = Array.from(document.querySelectorAll('section'));
  return gridProps.slice(-sections.length)[sections.indexOf(section)];
}

const offered = (heading: string) => typeof gridOf(heading).onRowExpand === 'function';

beforeEach(() => {
  gridProps.length = 0;
  vi.mocked(deriveInlineRowFormFields).mockReset().mockImplementation(probe.realRowFormFields);
  vi.mocked(isInlineRowFormOffered).mockReset().mockImplementation(probe.realOffer);
});

describe('the per-row form reads the spec rule, not a copy of it (objectui#11428)', () => {
  it('the spies stand in front of the real exports', () => {
    expect(probe.factoryRan).toBe(true);
    expect(vi.isMockFunction(deriveInlineRowFormFields)).toBe(true);
    expect(vi.isMockFunction(isInlineRowFormOffered)).toBe(true);
    expect(typeof probe.realOffer).toBe('function');
  });

  it("deriveFormFields hands the spec the child schema, relationshipField and exclude, and returns the spec's answer as is", () => {
    const schema = OBJECTS.po_line;
    // A system name, the relationship field and a name the map lacks: three
    // answers the replaced local filter could never give.
    const stub = ['id', 'po', 'not_a_field'];
    vi.mocked(deriveInlineRowFormFields).mockReturnValueOnce(stub);
    expect(deriveFormFields(schema, { relationshipField: 'po', exclude: ['price'] })).toStrictEqual(stub);
    expect(deriveInlineRowFormFields).toHaveBeenCalledTimes(1);
    expect(deriveInlineRowFormFields).toHaveBeenCalledWith(schema, { relationshipField: 'po', exclude: ['price'] });
  });

  it("deriveDetail's formFields and its smart default read the same answer, each arm the other's control", () => {
    const schema = {
      name: 'po_memo',
      fields: {
        po: { type: 'master_detail', reference: 'po' },
        qty: { type: 'number' },
        memo: { type: 'textarea' },
      },
    };
    const real = deriveDetail('po_memo', schema, 'po', { booleanLabel });
    expect(real.formFields).toStrictEqual(['qty', 'memo']);
    expect(real.mode, 'a textarea in the form tips the smart default to `form`').toBe('form');

    vi.mocked(deriveInlineRowFormFields).mockReturnValue(['qty']);
    const stubbed = deriveDetail('po_memo', schema, 'po', { booleanLabel });
    expect(stubbed.formFields).toStrictEqual(['qty']);
    expect(stubbed.mode, 'the spec dropped the textarea, so nothing tips it').toBe('grid');
  });

  it('pass-through: each collection asks isInlineRowFormOffered with its resolved inlineMode, formFields and columns, and is offered the form as before', async () => {
    await mount();
    const asked = vi.mocked(isInlineRowFormOffered);
    expect(asked).toHaveBeenCalledWith({ inlineMode: 'form', formFields: undefined, columns: [QTY] });
    expect(asked).toHaveBeenCalledWith({ inlineMode: undefined, formFields: ['qty', 'price'], columns: [QTY] });
    expect(asked).toHaveBeenCalledWith({ inlineMode: undefined, formFields: ['note'], columns: [NOTE] });
    expect(asked).toHaveBeenCalledWith(
      expect.objectContaining({ inlineMode: 'grid', formFields: ['qty', 'embedding'], columns: [expect.objectContaining({ name: 'qty' })] }),
    );

    expect(offered('As a list'), 'list mode edits through the full form').toBe(true);
    expect(offered('Wider form'), '`formFields` wider than `columns` offers the row form').toBe(true);
    expect(offered('Cells only'), 'a form no wider than the cells adds nothing to open').toBe(false);
    expect(offered('Derived'), 'the derived form is wider than the derived grid').toBe(true);
  });

  it("the spec's answer is the only source: an inverted answer inverts every offer and moves nothing else", async () => {
    vi.mocked(isInlineRowFormOffered).mockImplementation((opts) => !probe.realOffer(opts));
    await mount();
    expect(offered('As a list')).toBe(false);
    expect(offered('Wider form')).toBe(false);
    expect(offered('Cells only')).toBe(true);
    expect(offered('Derived')).toBe(false);

    const list = gridOf('As a list');
    expect(list.displayMode, 'the list stays a list').toBe('list');
    expect(typeof list.onAdd, 'and still adds through the full form').toBe('function');
    expect(gridOf('Cells only').displayMode).toBe('grid');
  });
});
