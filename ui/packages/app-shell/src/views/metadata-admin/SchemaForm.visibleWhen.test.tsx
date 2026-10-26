// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { getPageForm, getPageSchema } from './page-schema';

afterEach(cleanup);

/**
 * objectstack#6331 — metadata-form visibility predicates arrive as
 * `visibleWhen`, not `visibleOn`.
 *
 * ADR-0089 renamed the FormView predicate and the spec's normaliser REWRITES
 * the alias rather than keeping both: a parsed `FormView` carries `visibleWhen`
 * and no `visibleOn` at all. A probe over the bundled `@objectstack/spec@17`
 * forms this engine actually renders:
 *
 *   objectForm  70 sub-fields / 16 predicates / any visibleWhen: true / any visibleOn: false
 *   pageForm     4 predicate nodes, all `visibleWhen`
 *   viewForm     7 predicate nodes, all `visibleWhen`
 *   actionForm   6 predicate nodes, all `visibleWhen`
 *
 * Until this fix all five SchemaForm read sites looked at `visibleOn` only, so
 * every one of those predicates evaluated as absent and the guard short-circuited
 * to "visible" — conditional fields and sections rendered unconditionally.
 *
 * These tests pin each of the five sites on the CANONICAL key, in both
 * directions (true → shown, false → hidden), plus the no-predicate default.
 * The retired `visibleOn` spelling is not honoured at all (objectui#12696): a
 * node carrying only `visibleOn` renders unconditionally, as it does in the
 * runtime form (`@object-ui/plugin-form` `sectionFields.ts`) — one dialect.
 */

const schema = {
  type: 'object',
  properties: {
    type: { type: 'string', title: 'Type' },
    listOnly: { type: 'string', title: 'List Only' },
    recordOnly: { type: 'string', title: 'Record Only' },
  },
};

/* ── site 1: flat path, per-property predicate ───────────────────────────── */

describe('SchemaForm flat path — per-property visibleWhen (objectstack#6331)', () => {
  const flatSchema = {
    type: 'object',
    properties: {
      viewKind: { type: 'string', title: 'View family' },
      kind: { type: 'string', title: 'List layout', visibleWhen: "data.viewKind == 'list'" },
      formType: { type: 'string', title: 'Form layout', visibleWhen: "data.viewKind == 'form'" },
    },
  };

  it('shows the property whose visibleWhen is true and hides the false one', () => {
    render(<SchemaForm schema={flatSchema} value={{ viewKind: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('List layout')).toBeInTheDocument();
    expect(screen.queryByText('Form layout')).not.toBeInTheDocument();
  });

  it('flips with the draft', () => {
    render(<SchemaForm schema={flatSchema} value={{ viewKind: 'form' }} onChange={() => {}} />);
    expect(screen.getByText('Form layout')).toBeInTheDocument();
    expect(screen.queryByText('List layout')).not.toBeInTheDocument();
  });
});

/* ── site 2: sectioned path, section-level predicate ─────────────────────── */

describe('SchemaForm sections — section-level visibleWhen (objectstack#6331)', () => {
  const form = {
    type: 'simple' as const,
    sections: [
      { label: 'Basics', fields: [{ field: 'type' }] },
      {
        label: 'Data Context',
        visibleWhen: { dialect: 'cel', source: "data.type != 'list'" },
        fields: [{ field: 'recordOnly' }],
      },
      {
        label: 'Interface',
        visibleWhen: "data.type == 'list'",
        fields: [{ field: 'listOnly' }],
      },
    ],
  };

  it('hides the section whose visibleWhen is false and shows the true one', () => {
    render(<SchemaForm schema={schema} form={form} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.queryByText('Data Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Record Only')).not.toBeInTheDocument();
    expect(screen.getByText('Interface')).toBeInTheDocument();
    expect(screen.getByText('List Only')).toBeInTheDocument();
  });

  it('flips for a non-list draft', () => {
    render(<SchemaForm schema={schema} form={form} value={{ type: 'record' }} onChange={() => {}} />);
    expect(screen.getByText('Data Context')).toBeInTheDocument();
    expect(screen.getByText('Record Only')).toBeInTheDocument();
    expect(screen.queryByText('Interface')).not.toBeInTheDocument();
    expect(screen.queryByText('List Only')).not.toBeInTheDocument();
  });
});

/* ── site 3: sectioned path, field-level predicate ───────────────────────── */

describe('SchemaForm sections — field-level visibleWhen (objectstack#6331)', () => {
  const form = {
    type: 'simple' as const,
    sections: [
      {
        label: 'Configuration',
        fields: [
          { field: 'type' },
          { field: 'listOnly', visibleWhen: "data.type == 'list'" },
          { field: 'recordOnly', visibleWhen: { dialect: 'cel', source: "data.type == 'record'" } },
        ],
      },
    ],
  };

  it('renders only the fields whose visibleWhen holds', () => {
    render(<SchemaForm schema={schema} form={form} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('List Only')).toBeInTheDocument();
    expect(screen.queryByText('Record Only')).not.toBeInTheDocument();
  });

  it('flips with the draft', () => {
    render(<SchemaForm schema={schema} form={form} value={{ type: 'record' }} onChange={() => {}} />);
    expect(screen.getByText('Record Only')).toBeInTheDocument();
    expect(screen.queryByText('List Only')).not.toBeInTheDocument();
  });

  it('a field with no predicate always renders; both keys absent → shown', () => {
    render(<SchemaForm schema={schema} form={form} value={{}} onChange={() => {}} />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.queryByText('List Only')).not.toBeInTheDocument();
    expect(screen.queryByText('Record Only')).not.toBeInTheDocument();
  });
});

/* ── site 4: tabbed path, tab kept only if a field survives the predicate ── */

describe('SchemaForm tabs — field visibleWhen decides whether a tab renders (objectstack#6331)', () => {
  const tabbedForm = {
    type: 'tabbed' as const,
    sections: [
      { label: 'General', fields: [{ field: 'type' }] },
      { label: 'ListTab', fields: [{ field: 'listOnly', visibleWhen: "data.type == 'list'" }] },
      { label: 'RecordTab', fields: [{ field: 'recordOnly', visibleWhen: "data.type == 'record'" }] },
    ],
  };

  it('drops the tab whose only field is predicated away', () => {
    render(<SchemaForm schema={schema} form={tabbedForm} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ListTab' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'RecordTab' })).not.toBeInTheDocument();
  });

  it('flips with the draft', () => {
    render(<SchemaForm schema={schema} form={tabbedForm} value={{ type: 'record' }} onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'RecordTab' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'ListTab' })).not.toBeInTheDocument();
  });
});

/* ── site 5: `type: 'record'` row sub-fields (Studio object field list) ───── */

describe('SchemaForm record rows — sub-field visibleWhen (objectstack#6331)', () => {
  // Mirrors the spec `objectForm`: a name-keyed `fields` record whose row
  // sub-fields are gated on the row's own `type` (`data.type in [...]`).
  const objectishSchema = {
    type: 'object',
    properties: {
      fields: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Name' },
            type: { type: 'string', title: 'Type' },
            precision: { type: 'number', title: 'Precision' },
            maxLength: { type: 'number', title: 'Max Length' },
          },
        },
      },
    },
  };
  const objectishForm = {
    type: 'simple' as const,
    sections: [
      {
        label: 'Fields',
        fields: [
          {
            field: 'fields',
            type: 'record',
            keyField: { field: 'name', label: 'Name' },
            fields: [
              { field: 'type' },
              { field: 'precision', visibleWhen: "data.type in ['number','currency']" },
              { field: 'maxLength', visibleWhen: "data.type in ['text','textarea']" },
            ],
          },
        ],
      },
    ],
  } as never;

  it('a currency row shows Precision and hides Max Length', () => {
    render(
      <SchemaForm
        schema={objectishSchema}
        form={objectishForm}
        value={{ fields: { amount: { type: 'currency', precision: 2 } } }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('amount'));
    expect(screen.getByText('Precision')).toBeInTheDocument();
    expect(screen.queryByText('Max Length')).not.toBeInTheDocument();
  });

  it('a text row shows Max Length and hides Precision', () => {
    render(
      <SchemaForm
        schema={objectishSchema}
        form={objectishForm}
        value={{ fields: { title: { type: 'text', maxLength: 80 } } }}
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('title'));
    expect(screen.getByText('Max Length')).toBeInTheDocument();
    expect(screen.queryByText('Precision')).not.toBeInTheDocument();
  });
});

/* ── the retired `visibleOn` spelling is not honoured (objectui#12696) ────── */

/**
 * `readVisibility` used to fall back to `visibleOn` when `visibleWhen` was
 * absent. That fold let a layout an AI wrote with the retired key preview
 * correctly here while every other reader ignores it. Each case below carries a
 * `visibleOn` that would HIDE something if it were read, and asserts that the
 * thing is still shown; the paired `visibleWhen` case proves the same predicate
 * does hide it under the canonical key, so a green run is not a dead read site.
 */
describe('SchemaForm — retired `visibleOn` is not read (objectui#12696)', () => {
  it('a FormView section and field carrying only `visibleOn` are not hidden by it', () => {
    const retiredForm = {
      type: 'simple' as const,
      sections: [
        { label: 'Basics', fields: [{ field: 'type' }] },
        { label: 'Retired', visibleOn: "data.type == 'record'", fields: [{ field: 'listOnly' }] },
        {
          label: 'RetiredField',
          fields: [{ field: 'recordOnly', visibleOn: "data.type == 'record'" }],
        },
      ],
    };
    render(<SchemaForm schema={schema} form={retiredForm} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.getByText('List Only')).toBeInTheDocument();
    expect(screen.getByText('Record Only')).toBeInTheDocument();
  });

  it('the same predicates under `visibleWhen` do hide that section and field', () => {
    const canonicalForm = {
      type: 'simple' as const,
      sections: [
        { label: 'Basics', fields: [{ field: 'type' }] },
        { label: 'Canonical', visibleWhen: "data.type == 'record'", fields: [{ field: 'listOnly' }] },
        {
          label: 'CanonicalField',
          fields: [{ field: 'recordOnly', visibleWhen: "data.type == 'record'" }],
        },
      ],
    };
    render(<SchemaForm schema={schema} form={canonicalForm} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.queryByText('Canonical')).not.toBeInTheDocument();
    expect(screen.queryByText('List Only')).not.toBeInTheDocument();
    expect(screen.queryByText('Record Only')).not.toBeInTheDocument();
  });

  it('a raw JSONSchema create property carrying only `visibleOn` is not hidden by it', () => {
    const createSchema = {
      type: 'object',
      properties: {
        viewKind: { type: 'string', title: 'View family' },
        kind: { type: 'string', title: 'List layout', visibleOn: "data.viewKind == 'list'" },
      },
    };
    render(<SchemaForm schema={createSchema} value={{ viewKind: 'form' }} onChange={() => {}} />);
    expect(screen.getByText('List layout')).toBeInTheDocument();
  });
});

/* ── precedence: canonical over alias ────────────────────────────────────── */

/**
 * A node carrying both keys: `visibleWhen` decides. Reverting a read site to
 * `visibleOn` (alone, or as the first leg of a fold) turns this red, because
 * the stale key then decides the verdict.
 */
describe('SchemaForm — visibleWhen wins over visibleOn (objectstack#6331)', () => {
  it('canonical wins when a node carries both keys with conflicting predicates', () => {
    const bothForm = {
      type: 'simple' as const,
      sections: [
        {
          label: 'Both',
          // Canonical says show for a list draft; the retired key says the
          // opposite. Only `visibleWhen` is read.
          visibleWhen: "data.type == 'list'",
          visibleOn: "data.type == 'record'",
          fields: [{ field: 'listOnly' }],
        },
      ],
    };
    render(<SchemaForm schema={schema} form={bothForm} value={{ type: 'list' }} onChange={() => {}} />);
    expect(screen.getByText('Both')).toBeInTheDocument();
    expect(screen.getByText('List Only')).toBeInTheDocument();
  });
});

/* ── the real bundled spec form, not a hand-written mirror ───────────────── */

describe('SchemaForm — bundled spec `pageForm` predicates are reachable (objectstack#6331)', () => {
  /**
   * The strongest pin: the Page inspector feeds `getPageForm()` — the BUNDLED
   * `@objectstack/spec` FormView, post-ADR-0089 normalisation, i.e. carrying
   * `visibleWhen` — straight into SchemaForm. If the reader ever regresses to
   * `visibleOn` only, this goes red without anyone having to hand-transcribe
   * the spec's predicates into a fixture (which is how #4984's family of dead
   * rules stayed green).
   */
  const form = getPageForm();
  const pageSchema = getPageSchema();

  it('the spec ships `visibleWhen` (and not the alias) on the sections we assert', () => {
    const dataContext = form?.sections?.find((s) => s.label === 'Data Context');
    expect(dataContext).toBeDefined();
    expect(dataContext?.visibleWhen).toBeDefined();
    expect(dataContext).not.toHaveProperty('visibleOn');
  });

  it('a `list` page hides the Data Context section; a record page shows it', () => {
    render(
      <SchemaForm schema={pageSchema} form={form} value={{ name: 'p', type: 'list' }} onChange={() => {}} />,
    );
    expect(screen.queryByText('Data Context')).not.toBeInTheDocument();
    cleanup();
    render(
      <SchemaForm schema={pageSchema} form={form} value={{ name: 'p', type: 'record' }} onChange={() => {}} />,
    );
    expect(screen.getByText('Data Context')).toBeInTheDocument();
  });
});
