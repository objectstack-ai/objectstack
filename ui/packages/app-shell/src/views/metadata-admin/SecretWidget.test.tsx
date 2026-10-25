// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WIDGETS, OBJECTUI_SECRET_MASK } from './widgets';

afterEach(cleanup);

const Secret = WIDGETS['secret'];

/**
 * `secret` widget — write-only/masked credential input for `secret` field types
 * and `format: 'password'` props. A stored secret reads back as OBJECTUI_SECRET_MASK, so
 * the box starts empty (keep-on-blank); typing replaces; Clear removes.
 */
describe('secret widget', () => {
  it('is registered in the WIDGETS map', () => {
    expect(Secret).toBeTypeOf('function');
  });

  it('renders an empty password input for a new (unset) secret and emits typed value', () => {
    const onChange = vi.fn();
    render(<Secret value={undefined} onChange={onChange} schema={{ type: 'string', format: 'password' }} />);
    const input = screen.getByLabelText('Secret value') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'password');
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: 'hunter2' } });
    expect(onChange).toHaveBeenLastCalledWith('hunter2');
  });

  it('starts blank for a stored secret and keeps it (emits OBJECTUI_SECRET_MASK) when left blank', () => {
    const onChange = vi.fn();
    render(<Secret value={OBJECTUI_SECRET_MASK} onChange={onChange} schema={{ type: 'string', format: 'password' }} />);
    const input = screen.getByLabelText('Secret value') as HTMLInputElement;
    expect(input.value).toBe('');
    // type then clear back to blank → keep (no-op write)
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(OBJECTUI_SECRET_MASK);
  });

  it('exposes a Clear action for a stored secret that emits null', () => {
    const onChange = vi.fn();
    render(<Secret value={OBJECTUI_SECRET_MASK} onChange={onChange} schema={{ type: 'string' }} />);
    fireEvent.click(screen.getByText('Clear'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('toggles reveal between password and text', () => {
    render(<Secret value={undefined} onChange={() => {}} schema={{ type: 'string' }} />);
    const input = screen.getByLabelText('Secret value');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByLabelText('Reveal value'));
    expect(input).toHaveAttribute('type', 'text');
  });
});
