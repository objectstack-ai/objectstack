/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refusal leads with one plain sentence; the code and the rest of the
 * server's text are one click away, whole and copyable (objectui#13332).
 *
 * The three messages below are the ones measured on Setup: a package publish
 * refused on a read-only package (the server's message as the console's
 * envelope reader hands it on, with the declared code appended), a position
 * created under an illegal name, and an OAuth application registered with a
 * redirect URL that does not parse (the validator's joined issues).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { splitRefusal } from '../utils/refusalLead';
import { RefusalMessage } from './RefusalMessage';

const PACKAGE_REFUSAL =
  "[writable_package_required] Cannot publish package 'com.acme.crm': it is read-only "
  + '(provided by code or an installed app). Packages the deployment ships are managed by '
  + 'the deployment, not over this API — publish a package you own, or customise what this '
  + 'package provides beside it, as environment-level state (ADR-0131 D6): save an item under '
  + 'its own name. (WRITABLE_PACKAGE_REQUIRED)';
const PACKAGE_LEAD =
  "Cannot publish package 'com.acme.crm': it is read-only (provided by code or an installed app).";

const POSITION_REFUSAL =
  '"Sales/Rep" is not a legal metadata item name. Item names are lowercase snake_case segments, '
  + "optionally dot-qualified, e.g. 'crm_lead' or 'crm_lead.pipeline'. The compound "
  + "'section/name' spelling is retired: qualify with a dot.";
const POSITION_LEAD = '"Sales/Rep" is not a legal metadata item name.';

const OAUTH_REFUSAL = '[body.redirect_uris.0] Invalid URL; [body.redirect_uris.0] URL must be parseable';

describe('splitRefusal — the first plain sentence of a server refusal (objectui#13332)', () => {
  it.each([
    ['a package publish refused on a read-only package', PACKAGE_REFUSAL, PACKAGE_LEAD],
    ['a position created under an illegal name', POSITION_REFUSAL, POSITION_LEAD],
    ['an OAuth redirect URL that does not parse', OAUTH_REFUSAL, 'Invalid URL'],
  ])('%s: leads with one sentence and keeps the whole message', (_name, message, lead) => {
    expect(splitRefusal(message)).toEqual({ lead, full: message });
  });

  it('a single sentence is all lead, with nothing to disclose', () => {
    expect(splitRefusal('Request failed (500)')).toEqual({ lead: 'Request failed (500)', full: null });
    expect(splitRefusal('  The package was not found.  ')).toEqual({ lead: 'The package was not found.', full: null });
  });

  it('a trailing declared code is left out of the lead, and kept in the message', () => {
    expect(splitRefusal('The package was not found. (PACKAGE_NOT_FOUND)')).toEqual({
      lead: 'The package was not found.',
      full: 'The package was not found. (PACKAGE_NOT_FOUND)',
    });
    expect(splitRefusal('Not allowed (PERMISSION_DENIED)').lead).toBe('Not allowed');
  });

  it('an abbreviation does not end the sentence; a CJK full stop and a line break do', () => {
    expect(splitRefusal('Use a dotted name, e.g. crm_lead.pipeline, instead. Slashes are retired.').lead)
      .toBe('Use a dotted name, e.g. crm_lead.pipeline, instead.');
    expect(splitRefusal('名称不合法。请改用小写。').lead).toBe('名称不合法。');
    expect(splitRefusal('Publish blocked\n- views/a: missing label').lead).toBe('Publish blocked');
    // A semicolon inside a sentence is not a joined issue.
    expect(splitRefusal('Published 0; 2 failed. object/lead: bad name').lead).toBe('Published 0; 2 failed.');
  });

  it('a message that is only a code is shown as it is', () => {
    expect(splitRefusal('[item_locked]')).toEqual({ lead: '[item_locked]', full: null });
  });
});

describe('RefusalMessage — one sentence first, the rest behind More (objectui#13332)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows only the lead until More is pressed, then the whole message', async () => {
    render(<RefusalMessage text={PACKAGE_REFUSAL} />);

    expect(screen.getByTestId('refusal-lead')).toHaveTextContent(PACKAGE_LEAD);
    // Closed: the code and the decision-record prose are not on screen.
    expect(screen.queryByText(/writable_package_required/)).toBeNull();
    expect(screen.queryByText(/ADR-0131/)).toBeNull();
    const more = screen.getByTestId('refusal-more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveTextContent('refusalDetails.more');

    fireEvent.click(more);

    // Open: every byte the server sent, as one selectable block.
    expect(screen.getByTestId('refusal-detail').textContent).toBe(PACKAGE_REFUSAL);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more).toHaveTextContent('refusalDetails.less');
  });

  it('copies the whole message, not the lead', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<RefusalMessage text={OAUTH_REFUSAL} />);
    expect(screen.getByTestId('refusal-lead')).toHaveTextContent(/^Invalid URL$/);

    fireEvent.click(screen.getByTestId('refusal-more'));
    fireEvent.click(screen.getByTestId('refusal-copy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(OAUTH_REFUSAL));
    await waitFor(() =>
      expect(screen.getByTestId('refusal-copy')).toHaveAttribute('aria-label', 'refusalDetails.copied'),
    );
  });

  it('a one-sentence message renders as text with no disclosure (control)', () => {
    const { container } = render(<RefusalMessage text="User already exists" />);
    expect(container.innerHTML).toBe('User already exists');
    expect(screen.queryByTestId('refusal-more')).toBeNull();
    expect(screen.queryByTestId('refusal-detail')).toBeNull();
  });
});
