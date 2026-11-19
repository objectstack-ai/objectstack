/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Composer send-failure UX: when a message is rejected before it reaches the
 * model (rate-limit / network — `notSent`), the typed text must be RESTORED to
 * the box (not silently dropped) and a clear inline notice shown — NOT the
 * "Response failed / Retry" banner (which would regenerate the rolled-back turn).
 * A streamed-response error still shows the banner. A clean submit clears the box.
 * A host that held the message itself names the text to restore (`unsentText`,
 * objectstack#33562), a held suggestion chip included; absent, the composer
 * restores its own last typed submit and no chip text.
 * A file the composer refuses for size names itself and the limit in the same
 * band above the composer, and is not attached (objectstack#34463).
 * The accept list reads the HTML `accept` grammar (`.ext` / `type/*` / exact
 * MIME), and a file it refuses names itself and the accepted list in that same
 * band (objectstack#35276).
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import type { ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const LABELS = {
  sendFailedRateLimited: 'RATE_LIMIT_MSG',
  sendFailedGeneric: 'GENERIC_MSG',
};

/** Tagged error shaped like one from sendAwareFetch. */
function notSentError(status?: number): Error {
  const e = new Error(status === 429 ? '{"error":"rate_limited"}' : 'boom') as Error & {
    notSent?: boolean;
    status?: number;
  };
  e.notSent = true;
  if (status) e.status = status;
  return e;
}

async function submit(text: string, onSendMessage: () => void) {
  const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.submit(textarea.closest('form')!);
  // prompt-input calls onSubmit in a microtask (after blob conversion).
  await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
  return textarea;
}

describe('ChatbotEnhanced send-failure UX', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('restores the input and shows a rate-limit notice on a 429 (no Retry banner)', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />,
    );

    const textarea = await submit('build me a CRM', onSendMessage);
    expect(onSendMessage.mock.calls[0][0]).toBe('build me a CRM');
    // The composer optimistically cleared the box on submit…
    expect(textarea.value).toBe('');

    // …then the send is rejected with a 429.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        error={notSentError(429)}
      />,
    );

    // ① input restored, ② clear error shown, and NOT the generic "Response failed" banner.
    await waitFor(() => expect(textarea.value).toBe('build me a CRM'));
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('RATE_LIMIT_MSG');
    expect(screen.queryByText(/Response failed/i)).not.toBeInTheDocument();
  });

  it('uses the generic notice for a non-429 not-sent failure (network / 5xx)', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />,
    );
    const textarea = await submit('hello there', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        error={notSentError(503)}
      />,
    );

    await waitFor(() => expect(textarea.value).toBe('hello there'));
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('GENERIC_MSG');
  });

  it('restores the host-named unsentText instead of its own last-submitted text (objectstack#33562)', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />,
    );
    // The host held an earlier message and joined this one to it.
    const textarea = await submit('second part', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        error={notSentError(503)}
        unsentText={'first part\n\nsecond part'}
      />,
    );

    await waitFor(() => expect(textarea.value).toBe('first part\n\nsecond part'));
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('GENERIC_MSG');
  });

  it('a suggestion chip the host held comes back through unsentText; without it a chip restores nothing (objectstack#33562)', async () => {
    const onSendMessage = vi.fn();
    const chip = 'Build a CRM';
    const { rerender } = render(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} suggestions={[chip]} />,
    );
    fireEvent.click(screen.getByText(chip));
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledWith(chip));
    const textarea = screen.getByPlaceholderText('Ask…') as HTMLTextAreaElement;

    // CONTROL: the composer alone restores no chip text (objectui#7253).
    const first = notSentError(503);
    rerender(
      <ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} suggestions={[chip]} error={first} />,
    );
    await waitFor(() => expect(screen.getByTestId('chat-send-error')).toBeInTheDocument());
    expect(textarea.value).toBe('');

    // The host held the chip's message and names it: that is what was not sent.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        suggestions={[chip]}
        error={notSentError(503)}
        unsentText={chip}
      />,
    );
    await waitFor(() => expect(textarea.value).toBe(chip));
  });

  it('shows the Response-failed banner (not the send notice) for a streamed-response error', async () => {
    const onSendMessage = vi.fn();
    render(
      <ChatbotEnhanced
        placeholder="Ask…"
        onSendMessage={onSendMessage}
        labels={LABELS}
        onReload={vi.fn()}
        error={new Error('stream dropped mid-turn')}
      />,
    );

    expect(screen.getByText(/Response failed/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });

  it('a clean submit (no error) leaves the box cleared — text is only kept on failure', async () => {
    const onSendMessage = vi.fn();
    render(<ChatbotEnhanced placeholder="Ask…" onSendMessage={onSendMessage} labels={LABELS} />);
    const textarea = await submit('all good', onSendMessage);
    // No error prop → nothing restored; the optimistic clear stands.
    expect(textarea.value).toBe('');
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });
});

/**
 * objectui#2627 — the ROLLBACK half of the plan card's optimistic approve.
 * Clicking "Build it" flips the card to a "Confirmed" badge (objectstack#32984;
 * it read "Building…" before) before the server
 * has said anything (#2632, pinned in ChatbotEnhanced.test.tsx). When that
 * approval never left the client — a 429 or an offline send, tagged `notSent` —
 * the optimistic badge is a lie AND a dead end: the badge replaces the buttons,
 * so with no rollback the user cannot re-approve at all and the build silently
 * never starts. The happy flip was pinned on its own; this is the other side.
 */
const planMessage: ChatbotEnhancedMessage[] = [
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 't1',
        toolName: 'propose_blueprint',
        state: 'output-available',
        proposedPlan: {
          summary: 'A tiny CRM',
          objects: [{ name: 'contact', label: 'Contact', fieldCount: 4 }],
          counts: { objects: 1, views: 1, dashboards: 0, seedData: 0 },
          questions: [],
          assumptions: [],
        },
      },
    ],
  } as unknown as ChatbotEnhancedMessage,
];

describe('ChatbotEnhanced plan approval — optimistic flip rollback (#2627)', () => {
  it('rolls the "Confirmed" badge back to the buttons when the approval never left the client', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );

    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    expect(screen.getByTestId('proposed-plan-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();

    // The approval was rejected before reaching the model (rate limit).
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        error={notSentError(429)}
      />,
    );

    // The card must be actionable again — nothing is building.
    await waitFor(() =>
      expect(screen.getByTestId('proposed-plan-approve')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('proposed-plan-confirmed')).not.toBeInTheDocument();
    // …and the failure is surfaced, not swallowed.
    expect(screen.getByTestId('chat-send-error')).toHaveTextContent('RATE_LIMIT_MSG');
  });

  it('a STREAMED-response error leaves the badge alone — that approval did reach the server', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));

    // Not `notSent`: the turn started and the stream dropped. Re-offering
    // "Build it" here invites a SECOND build of the same plan.
    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        onReload={vi.fn()}
        error={new Error('stream dropped mid-turn')}
      />,
    );

    expect(screen.getByTestId('proposed-plan-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });

  it('a LATER send supersedes the approve — its failure must not re-open the built card', async () => {
    const onSendMessage = vi.fn();
    const { rerender } = render(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
      />,
    );
    fireEvent.click(screen.getByTestId('proposed-plan-approve'));
    // The approval went through; the user then types something that does not.
    await submit('also add invoices', onSendMessage);

    rerender(
      <ChatbotEnhanced
        placeholder="Ask…"
        messages={planMessage}
        onSendMessage={onSendMessage}
        labels={LABELS}
        planBuildingLabel="BUILDING_NOW"
        error={notSentError(429)}
      />,
    );

    // The composer text is restored, but the plan card stays "Confirmed" —
    // rolling it back would offer a second build of a plan already building.
    await waitFor(() => expect(screen.getByTestId('chat-send-error')).toBeInTheDocument());
    expect(screen.getByTestId('proposed-plan-confirmed')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-approve')).not.toBeInTheDocument();
  });
});

describe('ChatbotEnhanced composer — a file over maxFileSize is named to the user (objectstack#34463)', () => {
  const LIMIT = 1024;
  const limitText = new Intl.NumberFormat('en', { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 }).format(1);
  const png = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });

  beforeEach(() => {
    // jsdom has no object URLs; the composer makes one per attached file.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:attached') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  function pick(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    fireEvent.change(input);
  }

  function mount(node: ReactElement = <ChatbotEnhanced placeholder="Ask…" enableFileUpload maxFileSize={LIMIT} />) {
    return render(node).container;
  }

  it('an over-size file shows a notice naming the file and the limit, and is not attached', () => {
    const container = mount();
    pick(container, [png('big.png', LIMIT + 1)]);

    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('big.png');
    expect(notice).toHaveTextContent(limitText);
    expect(screen.queryByAltText('big.png')).toBeNull();
  });

  it('a mixed pick attaches the file under the limit and names only the one over it', () => {
    const container = mount();
    pick(container, [png('big.png', LIMIT + 1), png('small.png', 10)]);

    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent('big.png');
    expect(notice).not.toHaveTextContent('small.png');
    expect(screen.getByAltText('small.png')).toBeInTheDocument();
    expect(screen.queryByAltText('big.png')).toBeNull();
  });

  it('CONTROL: a file under the limit attaches with no notice', () => {
    const container = mount();
    pick(container, [png('small.png', LIMIT)]);

    expect(screen.getByAltText('small.png')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-attachment-refused')).toBeNull();
  });

  it('the close button dismisses the notice', () => {
    const container = mount();
    pick(container, [png('big.png', LIMIT + 1)]);

    fireEvent.click(screen.getByRole('button', { name: en.common.close }));
    expect(screen.queryByTestId('chat-attachment-refused')).toBeNull();
  });

  it('under zh the notice is the zh pack sentence, not the English one', async () => {
    const zhLead = zh.chatbot.composer.fileTooLarge.split('{{')[0];
    const enLead = en.chatbot.composer.fileTooLarge.split('{{')[0];
    expect(zhLead).not.toBe(enLead);
    const container = mount(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ChatbotEnhanced placeholder="Ask…" enableFileUpload maxFileSize={LIMIT} />
      </I18nProvider>,
    );
    await screen.findByPlaceholderText('Ask…');
    pick(container, [png('big.png', LIMIT + 1)]);

    const notice = await screen.findByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent(zhLead);
    expect(notice).toHaveTextContent('big.png');
    expect(notice).not.toHaveTextContent(enLead);
  });
});

describe('ChatbotEnhanced composer — the accept list reads the HTML accept grammar, and a refused type is named to the user (objectstack#35276)', () => {
  const DEFAULT_ACCEPT_SHOWN = 'image/*, .pdf, .doc, .docx, .txt, .csv, .tsv, .xlsx, .xlsm';
  const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type });

  beforeEach(() => {
    // jsdom has no object URLs; the composer makes one per attached file.
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:attached') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  });

  function pick(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    fireEvent.change(input);
  }

  /** A non-image attachment chip shows the file name as its own text. */
  const attached = (name: string) => screen.queryByText(name, { selector: 'span' });

  it('a CSV and a PDF picked with the default accept list attach, with no notice', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload />);
    pick(container, [file('data.csv', 'text/csv'), file('report.pdf', 'application/pdf')]);

    expect(attached('data.csv')).toBeInTheDocument();
    expect(attached('report.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-attachment-refused')).toBeNull();
  });

  it('a `.ext` token matches the name case-insensitively, whatever type the browser reported', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload />);
    pick(container, [file('EXPORT.CSV', ''), file('Book.XLSX', 'application/octet-stream')]);

    expect(attached('EXPORT.CSV')).toBeInTheDocument();
    expect(attached('Book.XLSX')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-attachment-refused')).toBeNull();
  });

  it('extension, wildcard and exact-MIME tokens each admit their own files and nothing else', () => {
    const { container } = render(
      <ChatbotEnhanced placeholder="Ask…" enableFileUpload acceptedFileTypes="image/*,.CSV,application/pdf" />,
    );
    pick(container, [
      file('photo.png', 'image/png'), // image/* — MIME prefix
      file('data.csv', 'text/csv'), // .CSV — extension, upper-case token
      file('doc.bin', 'application/pdf'), // application/pdf — exact MIME, the name does not matter
      file('clip.mp4', 'video/mp4'), // no token admits it
      file('scan.pdf', 'application/x-pdf'), // exact MIME is not a prefix and no `.pdf` token is listed
    ]);

    expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    expect(attached('data.csv')).toBeInTheDocument();
    expect(attached('doc.bin')).toBeInTheDocument();
    expect(attached('clip.mp4')).toBeNull();
    expect(attached('scan.pdf')).toBeNull();
    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent('clip.mp4');
    expect(notice).toHaveTextContent('scan.pdf');
    expect(notice).not.toHaveTextContent('photo.png');
  });

  it('a refused type shows a notice naming the file and the accepted list, and is not attached', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload />);
    pick(container, [file('setup.exe', 'application/x-msdownload')]);

    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveAttribute('role', 'alert');
    expect(notice).toHaveTextContent('setup.exe');
    expect(notice).toHaveTextContent(DEFAULT_ACCEPT_SHOWN);
    expect(attached('setup.exe')).toBeNull();
  });

  it('a mixed pick attaches the accepted file and names only the refused one', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload />);
    pick(container, [file('setup.exe', 'application/x-msdownload'), file('data.csv', 'text/csv')]);

    expect(attached('data.csv')).toBeInTheDocument();
    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent('setup.exe');
    expect(notice).not.toHaveTextContent('data.csv');
  });

  it('one pick refused for type AND for size names both files', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload maxFileSize={1024} />);
    pick(container, [file('setup.exe', 'application/x-msdownload'), file('big.png', 'image/png', 1025)]);

    const notice = screen.getByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent('setup.exe');
    expect(notice).toHaveTextContent('big.png');
  });

  it('CONTROL: a .png picked with the default accept list attaches with no notice', () => {
    const { container } = render(<ChatbotEnhanced placeholder="Ask…" enableFileUpload />);
    pick(container, [file('small.png', 'image/png')]);

    expect(screen.getByAltText('small.png')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-attachment-refused')).toBeNull();
  });

  it('under zh the notice is the zh pack sentence, not the English one', async () => {
    const zhLead = zh.fields.file.typeNotAccepted.split('{{name}}')[1].split('{{')[0];
    const enLead = en.fields.file.typeNotAccepted.split('{{name}}')[1].split('{{')[0];
    expect(zhLead).not.toBe(enLead);
    const { container } = render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ChatbotEnhanced placeholder="Ask…" enableFileUpload />
      </I18nProvider>,
    );
    await screen.findByPlaceholderText('Ask…');
    pick(container, [file('setup.exe', 'application/x-msdownload')]);

    const notice = await screen.findByTestId('chat-attachment-refused');
    expect(notice).toHaveTextContent(zhLead.trim());
    expect(notice).toHaveTextContent('setup.exe');
    expect(notice).not.toHaveTextContent(enLead.trim());
  });
});
