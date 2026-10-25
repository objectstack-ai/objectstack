// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// Capture the schema ObjectForm receives so object-form mode can be asserted
// without standing up the real plugin-form runtime.
const { objectFormSpy, adapterRef, objectsRef } = vi.hoisted(() => ({
  objectFormSpy: vi.fn(),
  adapterRef: { current: { fake: 'adapter' } as unknown },
  objectsRef: { current: [] as unknown[] },
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: ({ schema }: { schema: unknown }) => {
    objectFormSpy(schema);
    return <div data-testid="object-form" />;
  },
}));

vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => adapterRef.current,
}));

// Enriched object defs (with derived master-detail subforms) come from here at
// runtime; the preview feeds them straight to ObjectForm.
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ objects: objectsRef.current }),
}));

import { ScreenPreview } from './ScreenPreview';
import { buildScreenSpec, hiddenFieldCount, screenPredicateRoots, unevaluableVisibleWhen } from './screen-spec';
import { screenPredicateScope } from '../../ScreenView';

afterEach(() => {
  cleanup();
  objectFormSpy.mockClear();
  adapterRef.current = { fake: 'adapter' };
  objectsRef.current = [];
});

describe('ScreenPreview — flat fields', () => {
  it('renders the title + description {{ }} holes against supplied variables (objectui#11824)', () => {
    render(
      <ScreenPreview
        node={{ id: 's1', config: { title: 'Discount for {{ customer }}', description: 'Deal {{ deal_id }} · owner {{ missing }}' } }}
        variables={{ customer: 'Acme', deal_id: 42 }}
      />,
    );
    expect(screen.getByText('Discount for Acme')).toBeInTheDocument();
    // Known var substituted; unknown hole kept literal so the author sees it.
    expect(screen.getByText('Deal 42 · owner {{ missing }}')).toBeInTheDocument();
  });

  it('renders each input field (label, required marker) and a non-functional Submit', () => {
    const { container } = render(
      <ScreenPreview
        node={{
          id: 's1',
          config: {
            title: 'Review',
            fields: [
              { name: 'amount', label: 'Amount', type: 'number', required: true },
              { name: 'note', label: 'Note', type: 'textarea' },
            ],
          },
        }}
      />,
    );
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
    // Required marker.
    expect(screen.getByText('*')).toBeInTheDocument();
    // Field types map to the runtime inputs (number → spinbutton, textarea).
    expect(container.querySelector('input[type="number"]')).toBeTruthy();
    expect(container.querySelector('textarea')).toBeTruthy();
    // The preview offers a disabled Submit — it never resumes a real run.
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled();
  });

  it('live-updates when the node config changes', () => {
    const { rerender } = render(<ScreenPreview node={{ id: 's1', config: { title: 'Step one' } }} />);
    expect(screen.getByText('Step one')).toBeInTheDocument();

    rerender(<ScreenPreview node={{ id: 's1', config: { title: 'Step two', fields: [{ name: 'x', label: 'Reason' }] }} } />);
    expect(screen.queryByText('Step one')).not.toBeInTheDocument();
    expect(screen.getByText('Step two')).toBeInTheDocument();
    expect(screen.getByText('Reason')).toBeInTheDocument();
  });

  it('shows an empty-state hint when nothing is configured', () => {
    render(<ScreenPreview node={{ id: 's1', config: {} }} />);
    expect(screen.getByText(/Add a title, description, fields, or an object form/i)).toBeInTheDocument();
  });
});

describe('ScreenPreview — object-form mode', () => {
  it('renders the runtime ObjectForm with the configured object/mode/defaults', () => {
    render(
      <ScreenPreview
        node={{ id: 's1', config: { objectName: 'crm_account', mode: 'edit', defaults: { stage: 'new' } } }}
      />,
    );
    expect(screen.getByTestId('object-form')).toBeInTheDocument();
    const schema = objectFormSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(schema.type).toBe('object-form');
    expect(schema.objectName).toBe('crm_account');
    expect(schema.mode).toBe('edit');
    expect(schema.initialValues).toEqual({ stage: 'new' });
    // Object-form owns no preview Submit (its own bar is hidden in preview).
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('passes derived master-detail subforms from the enriched object def to ObjectForm', () => {
    // useMetadata().objects already carries `form.subforms` derived from inline-edit
    // relationships (attachInlineSubforms) — the preview just forwards them.
    objectsRef.current = [
      { name: 'showcase_invoice', form: { subforms: [{ childObject: 'showcase_invoice_line', relationshipField: 'invoice', inlineMode: 'grid' }] } },
    ];
    render(<ScreenPreview node={{ id: 's1', config: { objectName: 'showcase_invoice', mode: 'create' } }} />);
    const schema = objectFormSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(schema.objectName).toBe('showcase_invoice');
    expect(schema.subforms).toEqual([
      { childObject: 'showcase_invoice_line', relationshipField: 'invoice', inlineMode: 'grid' },
    ]);
  });

  it('falls back to a hint when no data source is available', () => {
    adapterRef.current = null;
    render(<ScreenPreview node={{ id: 's1', config: { objectName: 'crm_account' } }} />);
    expect(screen.queryByTestId('object-form')).not.toBeInTheDocument();
    expect(screen.getByText(/Connect to a backend to preview this object form/i)).toBeInTheDocument();
  });
});

describe('ScreenPreview — visibleWhen is decided live by the screen renderer (objectui#10743)', () => {
  // The docs' lead-conversion shape (`createOpportunity == true`), plus a
  // control field that declares no predicate. The preview used to judge the
  // predicate once against `variables`, drop the field and strip the predicate,
  // so no tick ever brought it back.
  const node = {
    id: 's1',
    config: {
      fields: [
        { name: 'createOpp', label: 'Create Opportunity?', type: 'boolean' },
        { name: 'oppName', label: 'Opportunity Name', type: 'text', visibleWhen: 'createOpp == true' },
        { name: 'plain', label: 'Plain', type: 'text' },
      ],
    },
  };

  it('a sibling-field predicate hides its field until the sibling is ticked, then shows it; the hint follows; the control is drawn throughout', () => {
    const { container } = render(<ScreenPreview node={node} variables={{}} />);
    expect(screen.getByText('Create Opportunity?')).toBeInTheDocument();
    expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
    expect(screen.getByText(/hidden by .*visible when/i)).toBeInTheDocument();

    fireEvent.click(container.querySelector('#ff-createOpp')!);
    expect(screen.getByText('Opportunity Name')).toBeInTheDocument();
    expect(screen.getByText('Plain')).toBeInTheDocument();
    expect(screen.queryByText(/hidden by .*visible when/i)).not.toBeInTheDocument();
  });

  it('the variables handed in for {var} interpolation do not decide a sibling-field predicate: a flow variable of the same name, false, used to freeze the field hidden', () => {
    const { container } = render(<ScreenPreview node={node} variables={{ createOpp: false }} />);
    expect(screen.queryByText('Opportunity Name')).not.toBeInTheDocument();
    fireEvent.click(container.querySelector('#ff-createOpp')!);
    expect(screen.getByText('Opportunity Name')).toBeInTheDocument();
  });

  it('a numeric sibling predicate follows what is typed (the console sample: note, visibleWhen discount > 0)', () => {
    const sample = {
      id: 'review',
      config: {
        fields: [
          { name: 'discount', label: 'Discount %', type: 'number' },
          { name: 'note', label: 'Note', type: 'text', required: true, visibleWhen: 'discount > 0' },
          { name: 'comment', label: 'Comment', type: 'text' },
        ],
      },
    };
    const { container } = render(<ScreenPreview node={sample} variables={{}} />);
    const discount = container.querySelector('#ff-discount')!;
    fireEvent.change(discount, { target: { value: '5' } });
    expect(screen.getByText('Note')).toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();
    fireEvent.change(discount, { target: { value: '0' } });
    expect(screen.queryByText('Note')).not.toBeInTheDocument();
    expect(screen.getByText('Comment')).toBeInTheDocument();
  });

  it('a predicate over a run variable is not read from the run variables: the render is the same whether it holds true or false', () => {
    const gated = {
      id: 'g',
      config: {
        fields: [
          { name: 'reason', label: 'Reason', type: 'text', visibleWhen: 'needsApproval == true' },
          { name: 'plain', label: 'Plain', type: 'text' },
        ],
      },
    };
    const withTrue = render(<ScreenPreview node={gated} variables={{ needsApproval: true }} />);
    const reasonWithTrue = withTrue.queryByText('Reason') !== null;
    expect(withTrue.getByText('Plain')).toBeInTheDocument();
    withTrue.unmount();
    const withFalse = render(<ScreenPreview node={gated} variables={{ needsApproval: false }} />);
    const reasonWithFalse = withFalse.queryByText('Reason') !== null;
    expect(withFalse.getByText('Plain')).toBeInTheDocument();
    // Whether the renderer shows or hides a predicate it cannot evaluate is its
    // own fallback (objectui#8069); this pin reads the SCOPE only.
    expect(reasonWithFalse).toBe(reasonWithTrue);
  });
});

describe('unevaluableVisibleWhen — the names a screen predicate may reference (objectui#10743)', () => {
  const withPredicate = (visibleWhen: unknown) => ({
    id: 's',
    config: { fields: [{ name: 'discount', type: 'number' }, { name: 'note', visibleWhen }, { name: 'plain' }] },
  });

  it.each([
    ['a sibling field', 'discount > 0'],
    ['a sibling field under the record namespace the renderer binds', 'record.discount > 0'],
    ['two sibling fields', 'discount > 0 && plain != ""'],
    ['control: no predicate', undefined],
    ['control: a blank predicate', '  '],
  ])('%s is not reported', (_name, visibleWhen) => {
    expect(unevaluableVisibleWhen(withPredicate(visibleWhen))).toEqual([]);
  });

  it.each([
    ['a run variable', 'needsApproval == true', /needsApproval/],
    ['a run variable behind a stdlib call', 'size(tags) > 0', /tags/],
    ["the runtime's vars root, which the renderer does not bind", 'vars.discount > 0', /vars/],
    ['a {var} brace, the brace trap in a bare-CEL slot', '{discount} > 0', /./],
    ['a non-string', true, /./],
  ])('%s is reported on the field, by name', (_name, visibleWhen, reason) => {
    const out = unevaluableVisibleWhen(withPredicate(visibleWhen));
    expect(out.map((u) => u.name)).toEqual(['note']);
    expect(out[0].error).toMatch(reason);
  });

  it('names the nearest declared field for a typo', () => {
    const [only] = unevaluableVisibleWhen(withPredicate('dicount > 0'));
    expect(only.name).toBe('note');
    expect(only.error).toMatch(/discount/);
  });

  it.each([
    ['exists', '["a","b"].exists(t, t == note)'],
    ['all over a sibling', '[discount].all(d, d > 0)'],
    ['nested map and exists_one over siblings', '[discount].map(i, i + 1).exists_one(q, q > discount)'],
  ])("a comprehension's iteration variable is bound, not a root: %s is not reported", (_name, visibleWhen) => {
    expect(unevaluableVisibleWhen(withPredicate(visibleWhen))).toEqual([]);
  });

  it('a comprehension does not hide an undeclared root inside its body, nor the same name used bare outside it', () => {
    expect(unevaluableVisibleWhen(withPredicate('["a","b"].exists(t, t == tags)')).map((u) => u.error)).toEqual([
      expect.stringMatching(/`tags` is not a field on this screen/),
    ]);
    const outer = unevaluableVisibleWhen(withPredicate('t == 1 && ["a"].exists(t, t == note)'));
    expect(outer.map((u) => u.error)).toEqual([expect.stringMatching(/`t` is not a field on this screen/)]);
  });

  it('one rule: the roots are the keys of the renderer\'s own predicate scope plus record', () => {
    const node = withPredicate(undefined);
    const fromRenderer = [...Object.keys(screenPredicateScope(buildScreenSpec(node), {})), 'record'].sort();
    expect([...screenPredicateRoots(node)].sort()).toEqual(fromRenderer);
    expect(fromRenderer).toEqual(['discount', 'note', 'plain', 'record']);
  });
});

describe('buildScreenSpec', () => {
  it('maps authored config keys onto the runtime ScreenSpec', () => {
    const spec = buildScreenSpec({
      id: 'n1',
      config: {
        title: 'T',
        description: 'D',
        fields: [{ name: 'a', label: 'A', type: 'text', required: true }, { bad: 'no-name' }],
        idVariable: 'account_id',
      },
    });
    expect(spec.nodeId).toBe('n1');
    expect(spec.kind).toBe('fields');
    expect(spec.fields).toEqual([{ name: 'a', label: 'A', type: 'text', required: true }]);
    expect(spec.idVariable).toBe('account_id');
  });

  it('switches to object-form kind when objectName is set', () => {
    const spec = buildScreenSpec({ id: 'n1', config: { objectName: 'crm_account', mode: 'create' } });
    expect(spec.kind).toBe('object-form');
    expect(spec.objectName).toBe('crm_account');
    expect(spec.mode).toBe('create');
  });

  it('keeps every field and carries its visibleWhen raw; the renderer decides visibility', () => {
    const cfg = {
      id: 'n1',
      config: {
        fields: [
          { name: 'createOpp', label: 'Create?', type: 'boolean' },
          { name: 'oppName', label: 'Name', type: 'text', visibleWhen: 'createOpp == true' },
        ],
      },
    };
    const spec = buildScreenSpec(cfg);
    expect(spec.fields).toEqual([
      { name: 'createOpp', label: 'Create?', type: 'boolean', required: false },
      { name: 'oppName', label: 'Name', type: 'text', required: false, visibleWhen: 'createOpp == true' },
    ]);
    // The hint's count is the renderer's own verdict for the values collected so far.
    expect(hiddenFieldCount(spec, {})).toBe(1);
    expect(hiddenFieldCount(spec, { createOpp: true })).toBe(0);
  });
});
