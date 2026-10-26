/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * FlowRefusalNotice (objectui#9973) — the Close-only notice a flow LAUNCH opens
 * when the run ended `refused` without pausing. The launch routes that open it
 * are pinned end to end beside their hosts; these pin the component's own
 * disposition, including the empty-sentence case no host test reaches.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { FlowRefusalNotice } from '../FlowRefusalNotice';

const SENTENCE = 'Refused: Acme Corp is a confirmed duplicate';

describe('FlowRefusalNotice', () => {
  it('renders the title and the sentence as a plain (non-destructive) notice', () => {
    render(<FlowRefusalNotice state={{ open: true, title: 'Check duplicate', message: SENTENCE }} onClose={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Check duplicate')).toBeTruthy();
    const alert = within(dialog).getByRole('alert');
    expect(alert.textContent).toContain(SENTENCE);
    expect(alert.className).not.toMatch(/destructive/);
  });

  it('offers Close only, and Close reports the dismissal', () => {
    const onClose = vi.fn();
    render(<FlowRefusalNotice state={{ open: true, title: 'Check duplicate', message: SENTENCE }} onClose={onClose} />);

    const buttons = within(screen.getByRole('dialog')).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim()).every((n) => n === 'Close')).toBe(true);
    fireEvent.click(buttons.find((b) => !b.querySelector('.sr-only'))!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with an EMPTY sentence keeps its title and Close, and invents no copy', () => {
    render(<FlowRefusalNotice state={{ open: true, title: 'Check duplicate', message: '' }} onClose={() => {}} />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Check duplicate')).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent?.trim()).every((n) => n === 'Close')).toBe(true);
  });

  it('renders nothing while closed', () => {
    render(<FlowRefusalNotice state={{ open: false, title: 'Check duplicate', message: SENTENCE }} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.textContent).not.toContain(SENTENCE);
  });
});
