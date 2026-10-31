// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The composer draws a picked mention as a chip (objectstack#28218, the
 * presentation half of ruling A on objectstack#27703): a mention used to look
 * like plain typed text, so the author could not see whom the comment names.
 *
 * A mention is "picked" when the text holds `@LABEL` of a suggestion, resolved
 * exactly as the write resolves it (`extractMentions`): those are the users the
 * comment's `mentions` will carry. Under the editor they are a labelled row of
 * chips; in the preview each `@LABEL` is a chip, a multi-word label whole. Any
 * other `@word` keeps the plain highlight.
 */

import * as React from 'react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { RichTextCommentInput, type MentionSuggestion } from '../RichTextCommentInput';
import { DETAIL_DEFAULT_TRANSLATIONS } from '../useDetailTranslation';

const MENTIONED = DETAIL_DEFAULT_TRANSLATIONS['detail.mentionedPeople'];
const PREVIEW = DETAIL_DEFAULT_TRANSLATIONS['detail.preview'];

const SUGGESTIONS: MentionSuggestion[] = [
  { id: 'u-grace', label: 'Grace Hopper' },
  { id: 'u-linus', label: 'Linus' },
  { id: 'u-ann', label: 'Ann' },
];

function Composer({ initial }: { initial: string }) {
  const [value, setValue] = React.useState(initial);
  return <RichTextCommentInput value={value} onChange={setValue} mentionSuggestions={SUGGESTIONS} />;
}

afterEach(() => cleanup());

describe('RichTextCommentInput draws picked mentions as chips (objectstack#28218)', () => {
  it('a row of chips under the editor names each picked user once, whole multi-word labels included', () => {
    render(<Composer initial="@Grace Hopper and @Linus, and @Linus again" />);

    const row = screen.getByRole('list', { name: MENTIONED });
    const chips = within(row).getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual(['@Grace Hopper', '@Linus']);
  });

  it('the row follows the text: a typed mention adds a chip, a removed one drops it, none draws no row', () => {
    render(<Composer initial="" />);
    expect(screen.queryByRole('list', { name: MENTIONED })).toBeNull();

    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'ping @Linus' } });
    expect(within(screen.getByRole('list', { name: MENTIONED })).getAllByRole('listitem').map((li) => li.textContent))
      .toEqual(['@Linus']);

    fireEvent.change(box, { target: { value: 'ping nobody' } });
    expect(screen.queryByRole('list', { name: MENTIONED })).toBeNull();
  });

  it('a prefix of a longer name, or an @word naming nobody, is not a chip', () => {
    render(<Composer initial="@Annabel and @nobody wrote" />);
    expect(screen.queryByRole('list', { name: MENTIONED })).toBeNull();
  });

  it('the preview draws each picked @LABEL as one chip and keeps any other @word a plain highlight', () => {
    const { container } = render(<Composer initial="**Note** for @Grace Hopper and @nobody" />);
    fireEvent.click(screen.getByTitle(PREVIEW));

    const chips = Array.from(container.querySelectorAll('[data-mention-chip]')).map((el) => el.textContent);
    expect(chips).toEqual(['@Grace Hopper']);
    expect(screen.getByText('@nobody')).toHaveClass('text-primary');
    expect(screen.getByText('@nobody')).not.toHaveAttribute('data-mention-chip');
    expect(container.querySelector('strong')).toHaveTextContent('Note');
  });

  it('the preview escapes the text, chips included', () => {
    const { container } = render(<Composer initial="<b>x</b> @Linus" />);
    fireEvent.click(screen.getByTitle(PREVIEW));
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>x</b>');
    expect(container.querySelector('[data-mention-chip]')).toHaveTextContent('@Linus');
  });
});
