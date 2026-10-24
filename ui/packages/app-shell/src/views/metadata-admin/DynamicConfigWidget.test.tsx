// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WIDGETS } from './widgets';

afterEach(cleanup);

const Dyn = WIDGETS['dynamic-config'];

const ctx = {
  // objectui#8167 — `conditionScope` is required on `WidgetContext` now;
  // `'flattened'` is the verdict every mount ran under before it existed.
  conditionScope: 'flattened' as const,
  dynamicSchemas: {
    sqlite: { properties: { filename: { type: 'string', title: 'Filename' } }, required: ['filename'] },
    postgres: { properties: { host: { type: 'string', title: 'Host' }, port: { type: 'number', title: 'Port' } } },
  },
};

/**
 * `dynamic-config` widget — renders an object field whose shape depends on a
 * sibling field's value (`fieldSpec.dependsOn` → `context.dynamicSchemas[value]`).
 */
describe('dynamic-config widget', () => {
  it('is registered in the WIDGETS map', () => {
    expect(Dyn).toBeTypeOf('function');
  });

  it('prompts to select the parent when the dependency is unset', () => {
    render(<Dyn value={{}} onChange={() => {}} schema={{ type: 'object' }} fieldSpec={{ field: 'config', dependsOn: 'driver' }} formData={{}} context={ctx} />);
    expect(screen.getByText(/Select driver to configure/i)).toBeInTheDocument();
  });

  it('renders the sub-schema fields for the chosen parent value and merges edits', () => {
    const onChange = vi.fn();
    render(<Dyn value={{}} onChange={onChange} schema={{ type: 'object' }} fieldSpec={{ field: 'config', dependsOn: 'driver' }} formData={{ driver: 'sqlite' }} context={ctx} />);
    const input = screen.getByLabelText('Filename') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/tmp/x.db' } });
    expect(onChange).toHaveBeenLastCalledWith({ filename: '/tmp/x.db' });
  });

  it('renders different fields when the parent value changes', () => {
    render(<Dyn value={{}} onChange={() => {}} schema={{ type: 'object' }} fieldSpec={{ field: 'config', dependsOn: 'driver' }} formData={{ driver: 'postgres' }} context={ctx} />);
    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toBeInTheDocument();
  });

  it('renders a credential sub-field (format:password) via the masked secret input', () => {
    const ctxPw = { conditionScope: 'flattened' as const, dynamicSchemas: { mysql: { properties: { password: { type: 'string', title: 'Password', format: 'password' } } } } };
    render(<Dyn value={{}} onChange={() => {}} schema={{ type: 'object' }} fieldSpec={{ field: 'config', dependsOn: 'driver' }} formData={{ driver: 'mysql' }} context={ctxPw} />);
    // SecretWidget exposes a reveal toggle + the masked input.
    expect(screen.getByLabelText('Secret value')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Reveal value')).toBeInTheDocument();
  });

  it('shows a no-config message for an unknown parent value', () => {
    render(<Dyn value={{}} onChange={() => {}} schema={{ type: 'object' }} fieldSpec={{ field: 'config', dependsOn: 'driver' }} formData={{ driver: 'memory' }} context={ctx} />);
    expect(screen.getByText(/No configuration needed/i)).toBeInTheDocument();
  });
});
