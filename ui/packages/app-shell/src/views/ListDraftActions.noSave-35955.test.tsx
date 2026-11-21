/**
 * objectstack#35955 — Discard and Save where no save is offered (personal
 * views not ready, or no grant to create one on a shared view): both faces
 * are Discard alone. The narrow face never draws a Save that holds nothing
 * to save.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { ListDraftActions } from './ListDraftActions';

afterEach(() => cleanup());

describe('Discard and Save with no save offered (objectstack#35955)', () => {
  it('draws Discard on both faces and no Save at all', () => {
    const onDiscard = vi.fn();
    render(<ListDraftActions parts={['sort']} onDiscard={onDiscard} />);

    expect(screen.queryByTestId('list-draft-save')).toBeNull();
    expect(screen.queryByTestId('list-draft-compact')).toBeNull();
    expect(screen.getByTestId('list-draft-discard')).toBeTruthy();
    const compact = screen.getByTestId('list-draft-compact-discard');
    // A plain button, not a menu item: it discards on a click.
    expect(compact.tagName).toBe('BUTTON');
    fireEvent.click(compact);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: with a save offered, the narrow face is one Save whose menu holds Discard', () => {
    render(<ListDraftActions parts={['sort']} onDiscard={() => {}} onSaveAsMyView={() => {}} />);

    expect(screen.getByTestId('list-draft-compact')).toBeTruthy();
    // Discard lives inside that menu, not beside it.
    expect(screen.queryByTestId('list-draft-compact-discard')).toBeNull();
  });
});
