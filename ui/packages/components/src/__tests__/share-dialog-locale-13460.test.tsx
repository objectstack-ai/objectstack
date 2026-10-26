/**
 * objectui#13460 — the share-link dialog speaks the session's language.
 *
 * `ShareDialog` drew its whole chrome as English literals: the title, the
 * audience and expiry choices, the form labels and placeholders, the empty
 * list and the footer. It now reads `shareDialog.*` (and `common.done`).
 *
 * What this file pins, through the real dialog and a real `I18nProvider`:
 *   - under zh the title (with the "this record" fallback), the description,
 *     the audience and expiry triggers, the labels, the placeholders, the
 *     create button and the empty list read the zh pack (guarded as real zh
 *     rows, not English copies);
 *   - a caller's `recordLabel` lands in the zh title's hole;
 *   - control: with no provider the dialog still reads its English.
 *
 * The link list answers empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { ShareDialog } from '../share/ShareDialog';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ links: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const { zh, en } = builtInLocales;
const zhShare = zh.shareDialog;

function dialog(language: 'zh' | null, recordLabel?: string) {
  const node = (
    <ShareDialog open onOpenChange={() => {}} objectName="ai_conversations" recordId="r1" recordLabel={recordLabel} apiBase="/api" />
  );
  return render(
    language ? (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
        {node}
      </I18nProvider>
    ) : (
      node
    ),
  );
}

describe('ShareDialog under zh (objectui#13460)', () => {
  it('guard: the zh values read below are real zh rows, not English copies', () => {
    for (const [zhValue, enValue] of [
      [zhShare.thisRecord, en.shareDialog.thisRecord],
      [zhShare.noLinks, en.shareDialog.noLinks],
      [zhShare.audienceLinkOnly, en.shareDialog.audienceLinkOnly],
    ]) {
      expect(zhValue).not.toBe(enValue);
      expect(zhValue).toMatch(/\p{Script=Han}/u);
    }
  });

  it('draws its chrome from the zh pack', async () => {
    dialog('zh');
    expect(await screen.findByText(zhShare.noLinks)).toBeTruthy();
    expect(screen.getByRole('heading', { name: zhShare.title.replace('{{label}}', zhShare.thisRecord) })).toBeTruthy();
    expect(screen.getByText(zhShare.description)).toBeTruthy();
    expect(screen.getByTestId('share-audience').textContent).toContain(zhShare.audienceLinkOnly);
    expect(screen.getByTestId('share-expiry').textContent).toBe(zhShare.expiry7d);
    for (const label of [zhShare.whoCanAccess, zhShare.expiresIn, zhShare.password, zhShare.label]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByPlaceholderText(zhShare.passwordPlaceholder)).toBeTruthy();
    expect(screen.getByPlaceholderText(zhShare.labelPlaceholder)).toBeTruthy();
    expect(screen.getByTestId('share-create').textContent).toBe(zhShare.createLink);
    expect(screen.getByRole('button', { name: zh.common.done })).toBeTruthy();
  });

  it("puts the caller's record label in the zh title's hole", async () => {
    dialog('zh', 'Q3 plan');
    expect(await screen.findByRole('heading', { name: zhShare.title.replace('{{label}}', 'Q3 plan') })).toBeTruthy();
  });
});

describe('control: with no provider the dialog still reads its English (objectui#13460)', () => {
  it('reads the en values', async () => {
    dialog(null);
    expect(await screen.findByText('No share links yet. Create one above.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Share this record' })).toBeTruthy();
    expect(screen.getByTestId('share-expiry').textContent).toBe('7 days');
    expect(screen.getByTestId('share-create').textContent).toBe('Create link');
  });
});
