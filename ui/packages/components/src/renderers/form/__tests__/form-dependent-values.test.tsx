/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Live `dependentValues` injection for data-source fields (#2215).
 *
 * Dependent (cascading) lookups resolve their `dependsOn` gate and filters
 * from the `dependentValues` prop. The form renderer must inject the LIVE
 * form values there — pre-fix nothing injected the prop and the widget fell
 * back to reading `ctx.formValues`, a member `SchemaRendererContext` never had,
 * so in create mode a dependent lookup stayed gated forever no matter what the
 * user picked in the parent field. That fallback has since been retired
 * (objectui#7206), so this prop is the only channel there is.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry, CASCADE_OPTION_WIDGET_TYPES } from '@object-ui/core';
import '../../../renderers';

// Probe widget standing in for a lookup field: surfaces the received
// `dependentValues` so the test can assert on the injection.
function DependentValuesProbe(props: any) {
  return <div data-testid="dep-probe">{JSON.stringify(props.dependentValues ?? null)}</div>;
}

// The barrel import moved to module scope (see `import '../../../renderers'`
// above): inside the hook its cold transform was billed to `hookTimeout`, which
// is why this carried a raised timeout. The overrides below still have to run
// AFTER the barrel, and they do — static imports are evaluated before any hook.
// See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
beforeAll(() => {
  // Override the protocol placeholder for `field:lookup` with the probe
  // (the fields package owns the real widget; components tests never load it).
  ComponentRegistry.register('field:lookup', DependentValuesProbe, { namespace: 'test' });
  // Cascading `select`/`radio`/`multiselect` options resolve their per-option
  // `visibleWhen` + `dependsOn` gate from the SAME live `dependentValues` channel
  // (#2284/#1583) — regression guard for the injection reaching option fields.
  ComponentRegistry.register('field:select', DependentValuesProbe, { namespace: 'test' });
}, 30000);

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        showSubmit: false,
        showCancel: false,
        fields,
      }}
    />,
  );
}

describe('form renderer — dependentValues injection for data-source fields (#2215)', () => {
  it('feeds live form values to a lookup field as the user edits the parent', async () => {
    renderForm([
      { name: 'account', label: 'Account', type: 'input', defaultValue: '' },
      { name: 'contact', label: 'Contact', type: 'lookup' },
    ]);

    const probe = screen.getByTestId('dep-probe');
    // Initial snapshot carries the (empty) parent value — not undefined.
    expect(JSON.parse(probe.textContent!)).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: 'a1' } });
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('dep-probe').textContent!)).toMatchObject({
        account: 'a1',
      });
    });
  });

  it('feeds live form values to a cascading select as the user edits the parent (#2284)', async () => {
    renderForm([
      { name: 'country', label: 'Country', type: 'input', defaultValue: '' },
      {
        name: 'province',
        label: 'Province',
        // `widget: 'field:select'` forces the REGISTERED SelectField path (what
        // ObjectForm uses in the real console) rather than the builtin `case
        // 'select'` fallback — the registered path is where the injection was
        // missing, leaving a cascading select gated forever in create mode.
        type: 'select',
        widget: 'field:select',
        dependsOn: 'country',
        options: [
          { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
          { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
        ],
      },
    ]);

    // The probe stands in for SelectField; it must receive the live record, not
    // an undefined/empty snapshot, so its `dependsOn` gate + `visibleWhen`
    // filter can resolve against the chosen parent.
    expect(JSON.parse(screen.getByTestId('dep-probe').textContent!)).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'cn' } });
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('dep-probe').textContent!)).toMatchObject({
        country: 'cn',
      });
    });
  });

});

describe('form renderer — the allow-table is the SHARED object (objectui#4770)', () => {
  it('asks @object-ui/core CASCADE_OPTION_WIDGET_TYPES which fields get the record', () => {
    // Identity, not membership — the same pin the two dialog surfaces carry
    // (`app-shell/src/views/ActionParamDialog.dialogRecord.test.tsx`,
    // `plugin-grid/src/__tests__/bulkActionDialogRecord.test.tsx`). The
    // injection cases above pass against ANY set holding these four members,
    // including the private `CASCADE_OPTION_FIELD_TYPES` copy this form carried
    // until objectui#4770 — so they cannot report the failure mode #4770
    // closed, which was the three copies drifting apart. The spy is installed
    // on the Set object exported by `@object-ui/core`; it records a call only
    // if this renderer consulted THAT object.
    const spy = vi.spyOn(CASCADE_OPTION_WIDGET_TYPES, 'has');
    try {
      renderForm([
        { name: 'country', label: 'Country', type: 'input', defaultValue: '' },
        {
          name: 'province',
          label: 'Province',
          type: 'select',
          widget: 'field:select',
          dependsOn: 'country',
          options: [{ label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" }],
        },
      ]);
      // The form normalizes `field:select` to `select` BEFORE the lookup, so
      // the key reaching the shared set is the widget key it is defined on.
      expect(spy.mock.calls.map(([k]) => k)).toContain('select');
    } finally {
      spy.mockRestore();
    }
  });
});
