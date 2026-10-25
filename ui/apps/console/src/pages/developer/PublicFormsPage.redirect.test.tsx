// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4990 — the Public Forms dialog is an authoring door for
 * `submitBehavior.url`, so it must refuse what the contract refuses.
 *
 * The ruling is objectstack#7496 (2026-08-11), landed in `@objectstack/spec` by
 * objectstack#7657 and live on this repo's 17.0.0 GA pin: the key is a RELATIVE
 * in-app path, interpolated only as `{{record.field_name}}`. The spec refuses
 * seven families of value, each with its own author-facing prescription. This
 * dialog enforced ONE of them — non-empty — and wrote the other six into view
 * metadata unexamined.
 *
 * ## What is pinned, and against what
 *
 * The oracle is the contract itself. `specRefusal()` below performs the same
 * minimal parse an authoring door performs and reads the message off it, so
 * every expectation here is "the dialog showed the SPEC's sentence", never "the
 * dialog showed this string I typed into a test". That distinction is the whole
 * point of the fix: a local copy of the seven prescriptions would pass a
 * literal-text assertion right up to the spec release that reworded one, which
 * is the drift `scripts/check-spec-symbol-derivation.mjs` exists to discourage.
 * These tests follow the pin instead — reword the spec and they still pass;
 * hand-write the message in the dialog and they fail.
 *
 * The second half of every refusal case is that `meta.saveItem` was NOT called.
 * A dialog that showed the refusal and saved anyway would be the same corpus
 * defect wearing an error's clothes.
 *
 * ## Reverse verification — predicted first, then measured
 *
 * 1. **Reverting the door to the non-empty check** (`if (!editBehaviorUrl)` +
 *    `url: editBehaviorUrl`): all eight out-of-contract cases go RED, and each
 *    fails on BOTH assertions — `saveItem` is called with the rejected value,
 *    and no alert renders to read a message from. The empty case stays GREEN in
 *    its save-blocking half (the old code refused empty too) and goes RED on the
 *    message, because `Redirect URL is required` is not the spec's sentence.
 *    The in-contract cases and the thank-you boundary case stay green.
 * 2. **Keeping the parse but showing a local string** (`setEditUrlRefusal('That
 *    URL is not allowed')`): every refusal case stays green on `saveItem` and
 *    goes RED on the message comparison — the narrow change detector for message
 *    PROVENANCE, which is the property a second copy of the rule would silently
 *    take away.
 *
 * Control characters in the fixtures below are written as escape sequences on
 * purpose — a raw one makes the whole file read as binary to grep, and this repo
 * has paid for that four times (objectui#4890 among them).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// The page asks the router where the anonymous route is served (objectui#11769),
// so it renders inside one, as it does in the app.
import { MemoryRouter } from 'react-router-dom';
import { FormViewSchema } from '@objectstack/spec/ui';

/**
 * One published public form, on the `ViewItem` shape `GET /meta/view` serves:
 * the form under `config`, opened to anonymous intake by the server's rule
 * (`sharing.enabled`, `allowAnonymous` and a `publicLink`; objectui#11545). The
 * Edit dialog writes `submitBehavior` back under `config`, beside `sharing`.
 */
const { saveItem, ADAPTER } = vi.hoisted(() => {
  const item = {
    name: 'showcase_task.public',
    label: 'Log Time',
    object: 'showcase_task',
    viewKind: 'form',
    config: {
      type: 'simple',
      sections: [{ label: 'Task', fields: ['title'] }],
      sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/log-time' },
    },
  };
  const saveItem = vi.fn(async () => ({ ok: true }));
  // A STABLE singleton: a fresh object per render loops the page's load effect.
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => (type === 'view' ? [item] : []),
        saveItem,
      },
    }),
  };
  return { saveItem, ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Imported AFTER the mocks so the page picks them up.
import { PublicFormsPage } from './PublicFormsPage';

/**
 * The contract's own prescription for one authored value — the same minimal
 * parse the door performs, spelled out here independently so the test states the
 * question rather than borrowing the door's answer.
 */
function specRefusal(url: string): string {
  const parsed = FormViewSchema.safeParse({ submitBehavior: { kind: 'redirect', url } });
  if (parsed.success) throw new Error(`fixture is IN contract, not out of it: ${url}`);
  const onUrl = parsed.error.issues.find(
    (issue) => issue.path[0] === 'submitBehavior' && issue.path[1] === 'url',
  );
  if (!onUrl) throw new Error(`the schema refused ${url} on some other path`);
  return onUrl.message;
}

/**
 * Put a value in the field with `fireEvent.change` rather than `user.type`.
 *
 * Not a shortcut: userEvent's keyboard DSL reads `{` and `[` as key descriptors
 * — `{{` types ONE literal brace and `{record.id}` reads as an unknown key —
 * and half of these fixtures exist to be about braces. What the door reacts to
 * is the change event, so dispatching it directly asks the same question of the
 * same handler without fighting the DSL over the fixture's own content.
 */
function setUrl(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

/**
 * Open the row's editor and switch the post-submit behavior to `redirect`,
 * through the shared `Select` the picker is (objectui#11865): open it from the
 * keyboard, choose the option.
 */
async function openRedirectEditor(user: ReturnType<typeof userEvent.setup>) {
  render(<PublicFormsPage />, { wrapper: MemoryRouter });
  await user.click(
    await screen.findByRole('button', { name: /Edit sharing & post-submit behavior/i }),
  );
  fireEvent.keyDown(await screen.findByRole('combobox', { name: /After submit/i }), { key: 'ArrowDown' });
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Redirect to a URL' }));
  return screen.findByLabelText(/Redirect URL/i);
}

beforeEach(() => saveItem.mockClear());
afterEach(cleanup);

/**
 * One fixture per family the spec's check defends, named by what saving it would
 * have put into the metadata corpus.
 */
const OUT_OF_CONTRACT: Array<[label: string, url: string]> = [
  ['an absolute URL — the open redirect the ruling closed', 'https://example.com/thanks'],
  ['a script scheme, the same refusal for a stronger reason', 'javascript:alert(1)'],
  ['protocol-relative: another origin despite the leading slash', '//evil.example/thanks'],
  ['a backslash, which browsers normalise to a slash while resolving', '/\\evil.example'],
  ['whitespace, stripped before resolving and hiding the real start', '/ thanks'],
  ['a tab, the same smuggle in a form that is easy to miss', '/\u0009thanks'],
  ['a single-brace near-miss of the token spelling', '/thanks?x={record.id}'],
  ['document-relative, so one form lands in different places', 'thanks'],
];

describe('the redirect door refuses what the contract refuses (#4990)', () => {
  it.each(OUT_OF_CONTRACT)('refuses %s', async (_label, url) => {
    const user = userEvent.setup();
    const field = await openRedirectEditor(user);

    setUrl(field, url);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    // The value never reaches the metadata corpus.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(saveItem).not.toHaveBeenCalled();

    // And the sentence the author reads is the SPEC's, not this dialog's. This
    // is the assertion a hand-written mirror of the rule would fail.
    expect(screen.getByRole('alert')).toHaveTextContent(specRefusal(url));
  });

  /**
   * Empty is the one family the old door DID catch, with a local
   * `Redirect URL is required`. It routes through the contract now for the same
   * reason as the other seven: the spec's sentence says what to write instead.
   */
  it('refuses empty with the contract’s prescription, not a local “required”', async () => {
    const user = userEvent.setup();
    const field = await openRedirectEditor(user);

    setUrl(field, '');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(saveItem).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(specRefusal(''));
  });

  it('marks the field invalid and describes it by the refusal', async () => {
    const user = userEvent.setup();
    const field = await openRedirectEditor(user);

    setUrl(field, 'https://example.com/thanks');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAttribute('aria-describedby', 'edit-url-refusal');
  });

  it('clears the refusal when the author starts fixing the value', async () => {
    const user = userEvent.setup();
    const field = await openRedirectEditor(user);

    setUrl(field, 'https://example.com/thanks');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    setUrl(field, '/thanks');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('in-contract values still save (#4990)', () => {
  it.each([
    ['a rooted in-app path', '/thanks'],
    ['a path with a query', '/thanks?ref=42'],
    ['an interpolated path, the one form the ruling allows', '/t/{{record.slug}}?r={{record.id}}'],
  ])('saves %s unchanged', async (_label, url) => {
    const user = userEvent.setup();
    const field = await openRedirectEditor(user);

    setUrl(field, url);
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(saveItem).toHaveBeenCalledWith(
      'view',
      'showcase_task.public',
      expect.objectContaining({
        config: expect.objectContaining({ submitBehavior: { kind: 'redirect', url } }),
      }),
    );
  });

  /**
   * The scope boundary, pinned so a later reading of #4990 does not widen it by
   * accident: `thank-you`'s `title` and `message` are free-form strings in the
   * spec, so there is no contract for this door to state about them — even when
   * the text happens to look like the address the redirect key refuses.
   */
  it('leaves thank-you title/message unvalidated — the spec declares them free text', async () => {
    const user = userEvent.setup();
    render(<PublicFormsPage />, { wrapper: MemoryRouter });
    await user.click(
      await screen.findByRole('button', { name: /Edit sharing & post-submit behavior/i }),
    );

    setUrl(await screen.findByLabelText(/^Title$/i), 'https://example.com/thanks');
    setUrl(screen.getByLabelText(/^Message$/i), 'See javascript:alert(1) below');
    await user.click(screen.getByRole('button', { name: /^Save$/ }));

    await waitFor(() => expect(saveItem).toHaveBeenCalledTimes(1));
    expect(saveItem).toHaveBeenCalledWith(
      'view',
      'showcase_task.public',
      expect.objectContaining({
        config: expect.objectContaining({
          submitBehavior: {
            kind: 'thank-you',
            title: 'https://example.com/thanks',
            message: 'See javascript:alert(1) below',
          },
        }),
      }),
    );
  });
});
