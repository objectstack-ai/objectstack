/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#38048 — an ask turn that saved drafts ends with a
 * `data-draft-review` part, and the chat draws it as a review card under the
 * answer: one row per draft with its verdict badge and a Review link, one
 * "Review and publish" link per package, and "+N more" for `omitted`.
 *
 * The turns are built from wire parts through `uiMessageToChatMessage`, so the
 * lift (`extractDraftReview`, through the spec's `DraftReviewListSchema`) and
 * the draw are pinned together, the way a streamed conversation reaches the
 * chat.
 *
 * - N rows, the right badges, the right links with accessible names.
 * - A plain click goes through `onOpenReviewLink`; a modified click keeps the
 *   browser's own; the href is the host's `reviewLinkHref`.
 * - The card has no publish and no discard control.
 * - A part the parse refuses draws nothing and does not throw, and the CONTROL
 *   (the same turn with a part that parses) draws the card.
 * - A turn without the part renders as before.
 * - The part is not kept for a history or cache rebuild (live only).
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DRAFT_REVIEW_PART_TYPE } from '@objectstack/spec/ai';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { extractDraftReview, storedAnswerData, uiMessageToChatMessage } from '../mapMessages';
import { STORED_ANSWER_DATA_PARTS } from '../toolResultParsers';
import { groupDraftsByPackage } from '../chat/draftReviewGroups';

afterEach(() => {
  cleanup();
});

const ISSUE = {
  rule: 'flow-multi-write-unfiltered',
  path: 'flows[0].nodes[1].config.multi',
  where: 'flow "close_invoices" · node "update"',
  message: 'A multi-record write names no filter.',
  hint: 'Add a filter.',
  severity: 'error' as const,
};

const review = (pkg: string, type: string, name: string) => ({
  changes: `/studio/${pkg}/data?changes=review`,
  item: `/studio/${pkg}/metadata/${type}/${name}?review=1`,
});

/** Three drafts in two packages: one publishable, one with two refusals, one withheld. */
const LIST = {
  drafts: [
    {
      type: 'object',
      name: 'acme_invoice',
      package: 'acme',
      label: 'Invoice',
      verdict: { publishable: true, refusals: [], advisories: [] },
      verdictRead: 'turn-end',
      review: review('acme', 'object', 'acme_invoice'),
    },
    {
      type: 'flow',
      name: 'close_invoices',
      package: 'billing',
      verdict: { publishable: false, refusals: [ISSUE, { ...ISSUE, path: 'flows[0].nodes[2].config.multi' }], advisories: [] },
      verdictRead: 'save',
      review: review('billing', 'flow', 'close_invoices'),
    },
    {
      type: 'view',
      name: 'acme_invoice_list',
      package: 'acme',
      verdict: null,
      verdictWithheld: { code: 'PERMISSION_DENIED', message: 'You may not read view drafts.', status: 403 },
      verdictRead: 'turn-end',
      review: review('acme', 'view', 'acme_invoice_list'),
    },
  ],
  omitted: 4,
};

const draftReviewPart = (data: unknown) => ({ type: DRAFT_REVIEW_PART_TYPE, id: 'draft-review', data });

const turn = (parts: unknown[]) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [{ type: 'text', text: 'I saved the invoice object, its list view and the closing flow.' }, ...parts],
  } as never);

const question = { id: 'u1', role: 'user' as const, content: 'Build me invoicing.' };

function renderTurn(parts: unknown[], props: { onOpenReviewLink?: (path: string) => void; reviewLinkHref?: (path: string) => string } = {}) {
  return render(<ChatbotEnhanced messages={[question, turn(parts)]} {...props} />);
}

describe('objectstack#38048 — extractDraftReview reads the part through the spec schema', () => {
  it('lifts the parsed list', () => {
    expect(extractDraftReview([draftReviewPart(LIST)] as never)).toEqual(LIST);
  });

  it('answers undefined for a part the schema refuses, and for a turn without the part', () => {
    expect(extractDraftReview([draftReviewPart({ drafts: [{ ...LIST.drafts[0], extra: 1 }] })] as never)).toBeUndefined();
    expect(extractDraftReview([draftReviewPart({ drafts: [] })] as never)).toBeUndefined();
    expect(extractDraftReview([draftReviewPart('not a list')] as never)).toBeUndefined();
    expect(extractDraftReview([{ type: 'text', text: 'hi' }] as never)).toBeUndefined();
  });

  it('groups rows by package, packages in first-save order', () => {
    const groups = groupDraftsByPackage(extractDraftReview([draftReviewPart(LIST)] as never)!.drafts);
    expect(groups.map((g) => [g.name, g.drafts.map((d) => d.name), g.changes])).toEqual([
      ['acme', ['acme_invoice', 'acme_invoice_list'], '/studio/acme/data?changes=review'],
      ['billing', ['close_invoices'], '/studio/billing/data?changes=review'],
    ]);
  });
});

describe('objectstack#38048 — the card under the answer', () => {
  it('draws one row per draft, with the right badge and Review link', () => {
    renderTurn([draftReviewPart(LIST)]);
    const card = screen.getByTestId('draft-review-card');
    const rows = within(card).getAllByTestId('draft-review-row');
    expect(rows).toHaveLength(3);

    const [invoice, list] = within(within(card).getAllByTestId('draft-review-package')[0]).getAllByTestId('draft-review-row');
    const [flow] = within(within(card).getAllByTestId('draft-review-package')[1]).getAllByTestId('draft-review-row');

    expect(invoice).toHaveTextContent('Invoice');
    expect(invoice).toHaveTextContent('object');
    expect(within(invoice).getByTestId('draft-review-verdict')).toHaveAttribute('data-verdict', 'publishable');
    expect(within(invoice).getByTestId('draft-review-verdict')).toHaveTextContent('Will publish');

    // A draft with no label shows its name.
    expect(flow).toHaveTextContent('close_invoices');
    expect(within(flow).getByTestId('draft-review-verdict')).toHaveAttribute('data-verdict', 'refused');
    expect(within(flow).getByTestId('draft-review-verdict')).toHaveTextContent('2 problems');
    expect(within(flow).getByTestId('draft-review-verdict-at-save')).toBeInTheDocument();

    expect(within(list).getByTestId('draft-review-verdict')).toHaveAttribute('data-verdict', 'withheld');
    expect(within(list).getByTestId('draft-review-verdict')).toHaveTextContent('Verdict withheld');
    expect(within(list).getByTestId('draft-review-verdict')).toHaveAttribute('title', 'You may not read view drafts.');
    expect(within(invoice).queryByTestId('draft-review-verdict-at-save')).toBeNull();

    const invoiceLink = within(invoice).getByRole('link', { name: 'Review the draft Invoice in Studio' });
    expect(invoiceLink).toHaveAttribute('href', '/studio/acme/metadata/object/acme_invoice?review=1');
    expect(within(flow).getByRole('link', { name: 'Review the draft close_invoices in Studio' })).toHaveAttribute(
      'href',
      '/studio/billing/metadata/flow/close_invoices?review=1',
    );
  });

  it('draws one Review and publish link per package, and +N more for omitted', () => {
    renderTurn([draftReviewPart(LIST)]);
    const card = screen.getByTestId('draft-review-card');
    const changes = within(card).getAllByTestId('draft-review-changes-link');
    expect(changes.map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])).toEqual([
      ['Review and publish the drafts of package acme in Studio', '/studio/acme/data?changes=review'],
      ['Review and publish the drafts of package billing in Studio', '/studio/billing/data?changes=review'],
    ]);
    expect(within(card).getByTestId('draft-review-omitted')).toHaveTextContent('+4 more');
  });

  it('has no publish and no discard control: every control is a review link', () => {
    renderTurn([draftReviewPart(LIST)]);
    const card = screen.getByTestId('draft-review-card');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
    expect(within(card).getAllByRole('link')).toHaveLength(5);
  });

  it('opens a link through onOpenReviewLink on a plain click, and keeps a modified click the browser\'s', () => {
    const onOpenReviewLink = vi.fn();
    renderTurn([draftReviewPart(LIST)], { onOpenReviewLink, reviewLinkHref: (path) => `/_console${path}` });
    const card = screen.getByTestId('draft-review-card');
    const [acmeChanges] = within(card).getAllByTestId('draft-review-changes-link');
    expect(acmeChanges).toHaveAttribute('href', '/_console/studio/acme/data?changes=review');

    const plain = fireEvent.click(acmeChanges);
    expect(plain).toBe(false); // default prevented
    expect(onOpenReviewLink).toHaveBeenCalledWith('/studio/acme/data?changes=review');

    onOpenReviewLink.mockClear();
    const [itemLink] = within(card).getAllByTestId('draft-review-item-link');
    const modified = fireEvent.click(itemLink, { ctrlKey: true });
    expect(modified).toBe(true);
    expect(onOpenReviewLink).not.toHaveBeenCalled();
  });

  it('draws nothing for a part the parse refuses, and the control draws the card', () => {
    // A review link that is not a Console path: the whole part is refused.
    const bad = { drafts: [{ ...LIST.drafts[0], review: { ...LIST.drafts[0].review, item: 'javascript:alert(1)' } }] };
    expect(() => renderTurn([draftReviewPart(bad)])).not.toThrow();
    expect(screen.queryByTestId('draft-review-card')).toBeNull();
    expect(screen.getByText('I saved the invoice object, its list view and the closing flow.')).toBeInTheDocument();
    cleanup();

    renderTurn([draftReviewPart({ drafts: [LIST.drafts[0]] })]);
    expect(screen.getByTestId('draft-review-card')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-review-omitted')).toBeNull();
  });

  it('a turn without the part renders as before', () => {
    const withoutPart = turn([]);
    expect(withoutPart).not.toHaveProperty('draftReview');
    renderTurn([]);
    expect(screen.queryByTestId('draft-review-card')).toBeNull();
  });
});

describe('objectstack#38048 — live only', () => {
  it('is not a kept data part, so a history or cache rebuild draws no card', () => {
    expect(Object.values(STORED_ANSWER_DATA_PARTS)).not.toContain(DRAFT_REVIEW_PART_TYPE);
    expect(storedAnswerData([draftReviewPart(LIST)] as never)).toEqual({});
  });
});
