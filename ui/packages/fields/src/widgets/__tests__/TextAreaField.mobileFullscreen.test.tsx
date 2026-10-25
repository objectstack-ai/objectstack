/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TextAreaField`'s fullscreen affordance has ONE source (objectui#3232).
 *
 * It used to be read from four places with a `??` chain — a `mobileFullscreen`
 * (camelCase) prop, `field.mobile_fullscreen`, a `mobile_fullscreen` prop, and
 * `schema.mobile_fullscreen`. Only the field-metadata flag was ever produced:
 * `ObjectForm` stamps it on long-text fields from
 * `ObjectFormSchema.mobile.fullscreenLongText`. The camelCase prop had no
 * producer anywhere in the repo, and the snake_case prop could not arrive
 * because `stripRegisteredFieldProps` (components/src/renderers/form/form.tsx)
 * removes it from what registered widgets are forwarded.
 *
 * So this file pins both halves of that convergence:
 *
 *  1. **The live path still works.** The metadata flag drives the affordance
 *     end to end — button, dialog, and the committed edit. Deleting the dead
 *     reads must not have cost the working behaviour, and this is the test
 *     that fails if a future refactor drops the real read too.
 *  2. **The retired prop spellings are gone**, at compile time (they are not
 *     on the closed `FieldWidgetComponentProps`, objectui#3221) and at runtime
 *     (a host that passes one anyway gets no affordance). Convergence means a
 *     misspelled flag is now inert and loud, not silently absorbed.
 *
 * Note the built-in (unregistered) `textarea` branch in `form.tsx` reads
 * `mobile_fullscreen || fullscreen` off the form-field props and renders its
 * own `FullscreenTextarea`. That is a separate, live path and is untouched
 * here — this file is about the registered `field:textarea` widget only.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TextAreaField } from '../TextAreaField';
import type { FieldWidgetComponentProps } from '../types';
import type { FieldMetadata } from '@object-ui/types';

const fieldMeta = (extra: Record<string, unknown> = {}) =>
  ({
    name: 'description',
    label: 'Description',
    type: 'textarea',
    ...extra,
  }) as unknown as FieldMetadata;

describe('TextAreaField mobile fullscreen — the metadata flag is the only source', () => {
  it('renders the expand affordance when the field metadata sets mobile_fullscreen', () => {
    render(
      <TextAreaField
        value="hello"
        onChange={() => {}}
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    expect(screen.getByTestId('textarea-fullscreen-toggle')).toBeInTheDocument();
  });

  it('opens the fullscreen dialog and commits the edited draft', () => {
    const onChange = vi.fn();
    render(
      <TextAreaField
        value="hello"
        onChange={onChange}
        field={fieldMeta({ mobile_fullscreen: true })}
      />,
    );

    // Closed until the affordance is used — the dialog is not just mounted.
    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('textarea-fullscreen-toggle'));
    expect(screen.getByTestId('textarea-fullscreen-dialog')).toBeInTheDocument();

    const dialogInput = screen.getByTestId('textarea-fullscreen-input');
    expect(dialogInput).toHaveValue('hello');

    fireEvent.change(dialogInput, { target: { value: 'hello from fullscreen' } });
    // The draft is local until "Done" — the host is not notified per keystroke.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('textarea-fullscreen-save'));
    expect(onChange).toHaveBeenCalledWith('hello from fullscreen');
  });

  it('no longer reads the flag off a `schema` prop (objectui#3233)', () => {
    // This used to be the second carrier: `SchemaRenderer` passed the authored
    // node as `schema` and the widget resolved `field || schema`. v17 converged
    // that at the producer — the registry adapter (`withFieldCarrier`) maps the
    // SDUI node onto `field` before any widget sees it, so the widget has one
    // read. A host that still passes `schema` is now inert AND loud: a compile
    // error on the closed props type, and no affordance at runtime.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const legacyHostProps = {
        schema: fieldMeta({ mobile_fullscreen: true }),
      } as unknown as Partial<FieldWidgetComponentProps<string>>;

      render(
        <TextAreaField
          value=""
          onChange={() => {}}
          field={fieldMeta()}
          {...legacyHostProps}
        />,
      );

      expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders no affordance when the metadata does not opt in', () => {
    render(<TextAreaField value="hello" onChange={() => {}} field={fieldMeta()} />);

    expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('textarea-fullscreen-dialog')).not.toBeInTheDocument();
  });
});

describe('TextAreaField mobile fullscreen — the retired prop spellings', () => {
  it('does not declare them on the widget contract', () => {
    const props = {} as FieldWidgetComponentProps<string>;

    // Both were read by the widget and written by no host. With the closed
    // props type (objectui#3221) they are now compile errors, so a future
    // author reaches for the metadata flag instead of a silently ignored prop.
    // @ts-expect-error `mobileFullscreen` is not part of this contract
    void props.mobileFullscreen;
    // @ts-expect-error `mobile_fullscreen` is a metadata key, not a widget prop
    void props.mobile_fullscreen;
    // …and the retired second METADATA carrier (objectui#3233). The flag has
    // one source and that source now has one carrier.
    // @ts-expect-error `schema` was retired from the widget contract in v17
    void props.schema;

    expect(true).toBe(true);
  });

  it('ignores them at runtime when a host passes them anyway', () => {
    // Untyped hosts (plain JS, `as any` spreads) can still get these onto the
    // element. They must not resurrect the affordance: the metadata flag is
    // the contract. Unknown props land on the DOM spread, so React's unknown
    // -attribute warnings are expected noise here and are suppressed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hostProps = {
        mobileFullscreen: true,
        mobile_fullscreen: true,
      } as unknown as Partial<FieldWidgetComponentProps<string>>;

      render(
        <TextAreaField
          value="hello"
          onChange={() => {}}
          field={fieldMeta()}
          {...hostProps}
        />,
      );

      expect(screen.queryByTestId('textarea-fullscreen-toggle')).not.toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
