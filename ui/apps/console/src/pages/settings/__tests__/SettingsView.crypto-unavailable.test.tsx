/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsView — the fail-closed crypto refusal is a first-class state
 * (objectui#4570, following objectstack#8273 / PR objectstack#8396).
 *
 * What this closes: a deployment with nothing able to encrypt a declared-secret
 * key refuses the write. The framework half of that landed in #8396, which gave
 * the refusal its OWN wire envelope instead of the generic one:
 *
 *   status  500                                   (unchanged)
 *   code    SETTINGS_CRYPTO_UNAVAILABLE           (was INTERNAL_ERROR)
 *   details { namespace, key }                    the located refusal, NEVER the value
 *   message the operator prescription             (unchanged; the server owns this copy)
 *
 * The console read none of it. `SETTINGS_CRYPTO_UNAVAILABLE` fell to the `else`
 * branch, where `extractFieldErrors` finds no `details.fields` array and returns
 * null — so nothing was marked, nothing was rendered, and the whole refusal
 * collapsed into one transient toast. An admin was told a save failed; that the
 * DEPLOYMENT cannot encrypt, and which key it refused, was on the wire and
 * thrown away.
 *
 * The shape mirrors the `SETTINGS_LOCKED` precedent next to it (SettingsView.tsx
 * ~:152): detect on `error.code`, locate the subject from the declared
 * `error.details` slot, and frame it in the console's own copy. It differs in
 * one deliberate way, and that is the point of the card — LOCKED is a transient
 * toast, while this refusal names an operator prescription that has to survive
 * long enough to be acted on, so it also renders as a persistent panel.
 *
 * Two things these cases pin that are easy to get wrong:
 *
 *   - The **value never appears.** The envelope's own rule is that `details`
 *     locates the refusal and never carries the secret; the console must not
 *     re-introduce it from the draft it is holding. Note the assertion is
 *     scoped to the panel's own `textContent` — the secret IS legitimately in
 *     the input the admin typed it into, so a document-wide query would be the
 *     wrong assertion, passing or failing for the wrong reason.
 *   - The **fallback must not narrow.** Adding a branch to a `code` chain is
 *     exactly how an unknown code stops being handled at all, so an
 *     unrecognized code is pinned to the generic path.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

const getSettingsNamespace = vi.fn();
const saveSettingsNamespace = vi.fn();
const runSettingsAction = vi.fn();

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getSettingsNamespace: (...a: unknown[]) => getSettingsNamespace(...a),
    saveSettingsNamespace: (...a: unknown[]) => saveSettingsNamespace(...a),
    runSettingsAction: (...a: unknown[]) => runSettingsAction(...a),
  };
});

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { SettingsView } from '../SettingsView';

/**
 * A declared-secret key beside an ordinary one, so "only the refused key is
 * named" is a real assertion rather than the only thing on screen.
 */
const PAYLOAD = {
  manifest: {
    namespace: 'ai',
    label: 'AI',
    specifiers: [
      { type: 'password', key: 'api_key', label: 'API key', description: 'Provider credential.' },
      { type: 'text', key: 'account_id', label: 'Account ID', description: 'Cloudflare account.' },
    ],
  },
  values: {
    api_key: { value: '', source: 'default' },
    account_id: { value: 'acct_1', source: 'default' },
  },
};

/**
 * What the admin types. Distinctive on purpose: every "never the value"
 * assertion below is a substring search for this, so an accidental echo of the
 * draft into the refusal copy cannot hide behind a plausible-looking string.
 */
const SECRET = 'sk-live-DO-NOT-RENDER-4570';

/**
 * The server's sentence, carrying the operator prescription. The console
 * renders this VERBATIM — it is the server's copy to own, and restating it
 * client-side is how the two drift into disagreeing about how to fix the
 * deployment.
 */
const PRESCRIPTION =
  "Settings namespace 'ai' declares 'api_key' as encrypted, but this deployment has no way " +
  'to encrypt it. Wire SettingsServicePluginOptions.cryptoProvider, or configure a real ' +
  'crypto adapter, and retry.';

/** The #8396 wire body, as `api.ts`'s `jsonOrThrow` parks it on `err.payload`. */
function cryptoUnavailableRejection() {
  const err = new Error(PRESCRIPTION) as Error & { status?: number; payload?: unknown };
  err.status = 500;
  err.payload = {
    success: false,
    error: {
      code: 'SETTINGS_CRYPTO_UNAVAILABLE',
      message: PRESCRIPTION,
      details: { namespace: 'ai', key: 'api_key' },
    },
  };
  return err;
}

/** The env-lock refusal, in its post-#4224 declared position. */
function lockedRejection() {
  const err = new Error('Locked by environment.') as Error & { status?: number; payload?: unknown };
  err.status = 409;
  err.payload = {
    success: false,
    error: {
      code: 'SETTINGS_LOCKED',
      message: 'Locked by environment.',
      details: { namespace: 'ai', key: 'api_key' },
    },
  };
  return err;
}

/** The per-field rejection that feeds `extractFieldErrors`. */
function validationRejection() {
  const err = new Error('Settings for \'ai\' are incomplete.') as Error & {
    status?: number;
    payload?: unknown;
  };
  err.status = 400;
  err.payload = {
    success: false,
    error: {
      code: 'SETTINGS_VALIDATION',
      message: "Settings for 'ai' are incomplete: account_id — …",
      details: {
        namespace: 'ai',
        fields: [
          {
            field: 'account_id',
            code: 'invalid_format',
            message: 'Account ID does not match the expected format.',
            label: 'Account ID',
          },
        ],
      },
    },
  };
  return err;
}

/**
 * Mounts an EXPLICIT `en` I18nProvider — objectui#4024.
 *
 * This file used to mount none, which was fine while `SettingsView` carried its
 * copy as English literals. It no longer does: the screen resolves
 * `console.settingsView.*` through the bundle, and `t()` outside a provider
 * returns the KEY, so every English assertion below would read
 * `console.settingsView.cryptoRefusalTitle`.
 *
 * A provider, rather than re-pointing the assertions at key literals, because
 * the two most valuable assertions here are about INTERPOLATION — that the
 * refused key reaches `Cannot encrypt secrets: ai.api_key`, and that
 * `SETTINGS_LOCKED` still names its own key. With no provider the key comes
 * back bare and the `{{subject}}` / `{{key}}` holes are never filled, so a
 * key-literal assertion could not tell a working interpolation from a broken
 * one — it would keep the file green while deleting the thing it tests.
 *
 * The sibling `SettingsView.envelope.test.tsx` is deliberately handled the
 * OTHER way; see its own note.
 */
function renderView() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/settings/ai']}>
        <Routes>
          <Route path="/settings/:namespace" element={<SettingsView />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/**
 * The secret input. `password` renders UNCONTROLLED (placeholder only, no
 * `value`), so it is reached through its type rather than a display value.
 */
const secretInput = (c: HTMLElement) => c.querySelector('input[type="password"]') as HTMLInputElement;

/** The input rendered for a given field label — the sibling test's helper. */
const inputFor = (label: string) =>
  screen.getByText(label).closest('div')?.parentElement?.querySelector('input') ?? null;

/**
 * The refusal panel, located by its headline rather than a test id.
 *
 * The `?? null` is load-bearing: optional chaining off a `queryByText` miss
 * yields `undefined`, and `expect(undefined).toBeNull()` fails — which would
 * make the must-not-change pins below red for a reason that has nothing to do
 * with the code under test.
 */
const refusalPanel = (): HTMLElement | null =>
  screen.queryByText(/cannot encrypt secrets/i)?.closest('[role="alert"]') ?? null;

/** Type a secret and save. */
async function typeSecretAndSave(container: HTMLElement) {
  fireEvent.change(secretInput(container), { target: { value: SECRET } });
  fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getSettingsNamespace.mockResolvedValue(structuredClone(PAYLOAD));
});
afterEach(cleanup);

describe('SettingsView — a deployment that cannot encrypt refuses the save', () => {
  it('renders the refusal as its own state, naming the refused key from error.details', async () => {
    saveSettingsNamespace.mockRejectedValue(cryptoUnavailableRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);

    // The dedicated state exists at all — pre-fix this envelope rendered
    // nothing, because the generic path only toasts.
    const panel = (await screen.findByText(/cannot encrypt secrets/i)).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(panel).toBeTruthy();

    // Both halves of `error.details`, composed into the located refusal.
    expect(panel.textContent).toContain('ai.api_key');

    // The server's prescription, verbatim — not re-worded by the console.
    expect(panel.textContent).toContain(PRESCRIPTION);
  });

  it('never renders the value it refused to encrypt', async () => {
    saveSettingsNamespace.mockRejectedValue(cryptoUnavailableRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);
    const panel = (await screen.findByText(/cannot encrypt secrets/i)).closest(
      '[role="alert"]',
    ) as HTMLElement;

    // Scoped to the panel deliberately: the secret is legitimately inside the
    // input the admin typed it into, so a document-wide query would assert the
    // wrong thing. What must never happen is the console echoing the draft it
    // is holding into copy about the refusal.
    expect(panel.textContent).not.toContain(SECRET);
    expect(panel.textContent).not.toContain('sk-live');
  });

  it('toasts the console framing rather than the generic save-failed sentence', async () => {
    saveSettingsNamespace.mockRejectedValue(cryptoUnavailableRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);
    await screen.findByText(/cannot encrypt secrets/i);

    // Mirrors SETTINGS_LOCKED's `Locked by environment: <key>` — a code-specific
    // sentence naming the subject, not `err.message` handed to a generic toast.
    expect(toastError).toHaveBeenCalledWith('Cannot encrypt secrets: ai.api_key');
  });

  it('keeps the draft so the admin does not lose the value while fixing the deployment', async () => {
    saveSettingsNamespace.mockRejectedValue(cryptoUnavailableRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);
    await screen.findByText(/cannot encrypt secrets/i);

    // The save bar is still up: the refusal is about the deployment, and
    // discarding the admin's work is not part of reporting it.
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeTruthy();
  });

  it('clears the refusal once a save actually succeeds', async () => {
    saveSettingsNamespace.mockRejectedValueOnce(cryptoUnavailableRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);
    await screen.findByText(/cannot encrypt secrets/i);

    // The deployment got its crypto wired; the same draft now goes through.
    saveSettingsNamespace.mockResolvedValueOnce({
      values: { api_key: { value: '***', source: 'tenant' } },
    });
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(screen.queryByText(/cannot encrypt secrets/i)).toBeNull();
  });
});

describe('SettingsView — the branches this refusal must not disturb', () => {
  it('SETTINGS_LOCKED still renders the env-lock toast and no refusal panel', async () => {
    saveSettingsNamespace.mockRejectedValue(lockedRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);

    // Byte-for-byte the string the locked branch has always produced.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Locked by environment: api_key'),
    );
    expect(refusalPanel()).toBeNull();
  });

  it('SETTINGS_VALIDATION still marks the offending field and no refusal panel', async () => {
    saveSettingsNamespace.mockRejectedValue(validationRejection());
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);

    const msg = await screen.findByText(/does not match the expected format/i);
    expect(msg.getAttribute('role')).toBe('alert');
    await waitFor(() => {
      expect(inputFor('Account ID')!.getAttribute('aria-invalid')).toBe('true');
    });
    // The field error is itself a `role="alert"`, so this is queried by the
    // refusal's own headline rather than by role.
    expect(refusalPanel()).toBeNull();
  });

  it('an unrecognized code still takes the generic path — the fallback must not narrow', async () => {
    const err = new Error('Something else went wrong') as Error & { payload?: unknown };
    err.payload = {
      success: false,
      error: { code: 'SETTINGS_SOME_FUTURE_CODE', message: 'Something else went wrong' },
    };
    saveSettingsNamespace.mockRejectedValue(err);
    const { container } = renderView();
    await screen.findByText('API key');

    await typeSecretAndSave(container);

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Something else went wrong'));
    expect(refusalPanel()).toBeNull();
    expect(inputFor('Account ID')!.getAttribute('aria-invalid')).toBeNull();
  });
});
