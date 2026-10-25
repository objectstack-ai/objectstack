/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The dependency-gate hint must actually REACH a registered option widget
 * (objectui#3231) — the producer half of "declared ≠ delivered".
 *
 * `emptyHint` was declared on the widget contract, computed here for a gated
 * option list (#2284) and handed to `renderFieldComponent` … and then lost
 * twice on the way out, so no registered widget could ever render it:
 *
 *  1. `isOptionField` compared the RAW resolved type against `'select'` etc.
 *     Object-derived forms emit `mapFieldTypeToFormType`'s prefixed ids
 *     (`field:select`), which matched nothing — so for every option field that
 *     came from an object schema (the normal case in the console) the whole
 *     cascade block was skipped and no hint was computed at all.
 *  2. `stripRegisteredFieldProps` then removed the `emptyHint` key from what
 *     was left, so even the bare-type forms that DID compute a hint delivered
 *     nothing.
 *
 * The strip is otherwise correct — every other registered widget spreads its
 * leftover props onto a DOM node, where an unknown `emptyHint` attribute is a
 * React warning — so the forward is an ALLOW-LIST over the cascade option
 * types. Both directions are pinned below.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — the cold transform must not be billed to
// `hookTimeout`. See object-ui/no-dynamic-import-in-test-hook (objectui#3010).
import '../../../renderers';

/**
 * Surfaces the received `emptyHint` so the injection can be asserted — both
 * its VALUE and whether the key was passed at all. The renderer always sets
 * `emptyHint` on the props object (`undefined` when the list is not gated), so
 * key presence is what distinguishes "stripped" from "forwarded, empty".
 */
function EmptyHintProbe(props: any) {
  return (
    <div
      data-testid={`hint-probe-${props.name}`}
      data-has-key={'emptyHint' in props ? 'yes' : 'no'}
    >
      {props.emptyHint === undefined ? 'NO-HINT' : String(props.emptyHint)}
    </div>
  );
}

const OPTION_TYPES = ['select', 'radio', 'multiselect', 'checkboxes'] as const;

beforeAll(() => {
  // The fields package owns the real widgets; components tests never load it,
  // so stand the probe in for each registered option widget.
  for (const type of OPTION_TYPES) {
    ComponentRegistry.register(`field:${type}`, EmptyHintProbe, { namespace: 'test' });
  }
  // A registered widget that is NOT an option field — the strip must still
  // hold for it (its props land on a DOM node).
  ComponentRegistry.register('field:lookup', EmptyHintProbe, { namespace: 'test' });
}, 30000);

function renderForm(fields: any[]) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />);
}

const gatedField = (type: string) => ({
  name: 'province',
  label: 'Province',
  type,
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
});

const emptyParent = { name: 'country', label: 'Country', type: 'input', defaultValue: '' };

describe('form renderer — emptyHint delivery to registered option widgets (objectui#3231)', () => {
  // The prefixed ids are what `mapFieldTypeToFormType` emits, i.e. what every
  // object-derived form in the console actually renders.
  it.each(OPTION_TYPES)('a registered field:%s receives the computed gate hint', (type) => {
    renderForm([emptyParent, gatedField(`field:${type}`)]);

    // Built from the controlling field's LABEL ("Country"), not its raw name —
    // that label resolution is the reason the host owns this string at all.
    const probe = screen.getByTestId('hint-probe-province');
    expect(probe).toHaveTextContent('Select Country first');
    expect(probe).toHaveAttribute('data-has-key', 'yes');
  });

  // `select` is a BUILTIN_FIELD_TYPE, so a bare `type: 'select'` never reaches
  // the registry at all — it renders the inline branch, which already consumed
  // `emptyHint`. The other three do resolve through `field:<type>`.
  it.each(['radio', 'multiselect', 'checkboxes'] as const)(
    'a hand-written `type: %s` schema delivers it too',
    (type) => {
      renderForm([emptyParent, gatedField(type)]);

      expect(screen.getByTestId('hint-probe-province')).toHaveTextContent('Select Country first');
    },
  );

  it('withdraws the hint once the gate lifts — an ungated list is not "empty"', async () => {
    renderForm([emptyParent, gatedField('field:select')]);

    expect(screen.getByTestId('hint-probe-province')).toHaveTextContent('Select Country first');

    // Picking the parent lifts the gate, so the host has nothing to say and the
    // widget goes back to owning its own (now non-empty) list.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'cn' } });
    await waitFor(() => {
      expect(screen.getByTestId('hint-probe-province')).toHaveTextContent('NO-HINT');
    });
  });

  it('still withholds the key from registered widgets that would spread it onto the DOM', () => {
    // The renderer sets `emptyHint` on the props of EVERY field, so without the
    // strip this probe would report `data-has-key="yes"` — and a real widget
    // would spread an unknown `emptyHint` attribute onto its DOM node. The
    // forward is an allow-list over the four cascade option types, not a
    // blanket "stop stripping it".
    renderForm([emptyParent, { name: 'contact', label: 'Contact', type: 'lookup', dependsOn: 'country' }]);

    const probe = screen.getByTestId('hint-probe-contact');
    expect(probe).toHaveAttribute('data-has-key', 'no');
    expect(probe).toHaveTextContent('NO-HINT');
  });
});
