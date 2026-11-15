/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The post-save advisory toast shows the producer's localized sentence
 * (objectstack#32657, layer 3 of #32654: ruling C on #32440).
 *
 * The save door composes each advisory's `userMessage`
 * (`RuntimeAuthoringIssueSchema.userMessage`) in the caller's language. The
 * toast renders that sentence in place of the developer-facing English
 * `message` and `hint`; a finding the producer wrote no sentence for keeps
 * the `message` + `hint` face.
 *
 * Rendered end to end: the real `AdapterProvider` builds the real adapter and
 * subscribes, the real SDK client parses a save response from a `fetch`
 * double, and the REAL sonner `Toaster` draws the toast — what is asserted is
 * the text on screen, not what a sink was called with. The two sentences below
 * are the `security-private-no-readscope` catalog entries
 * (`validate-security-posture.user-text.ts`) for these params, as the save
 * door sends them for an en and a zh-CN request.
 */

import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Toaster, toast } from 'sonner';
import { AdapterProvider, useAdapter } from './AdapterProvider';

const FINDING = {
  severity: 'warning' as const,
  rule: 'security-private-no-readscope',
  where: 'permission set "sales_rep" · object "crm_deal"',
  path: 'objects.crm_deal',
  message:
    'permission set "sales_rep" grants read on private object "crm_deal" without a readScope, so holders see only their own rows',
  hint: 'set readScope on the grant, or widen the object sharing model',
};

const USER_TEXT_EN =
  'Holders of permission set "sales_rep" see only the "crm_deal" records they own or that are shared with them: ' +
  '"crm_deal" is private, and the set grants read access without a read scope. If they should see more, give the ' +
  "set a read scope or widen the object's sharing.";

const USER_TEXT_ZH =
  '权限集“sales_rep”的持有者只能看到自己拥有或被共享给他们的“crm_deal”记录：“crm_deal”是私有对象，' +
  '而该权限集授予了读取权限却没有设置读取范围。如果他们应当看到更多记录，请为该权限集设置读取范围，或放宽该对象的共享设置。';

const CLEAN_BODY = { success: true, version: 'v2', seq: 4, state: 'active' as const };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A server that answers discovery and every metadata write with `saveBody`. */
function serverAnswers(saveBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.includes('/discovery')) return jsonResponse({ success: true, data: {} });
      return jsonResponse(saveBody);
    }),
  );
}

let captured: { getClient(): { meta: { saveItem(t: string, n: string, i: unknown): Promise<unknown> } } } | null = null;

function CaptureAdapter() {
  const adapter = useAdapter();
  useEffect(() => {
    captured = adapter as unknown as typeof captured;
  }, [adapter]);
  return null;
}

async function saveThroughProvider(): Promise<void> {
  render(
    <>
      <Toaster duration={60_000} />
      <AdapterProvider>
        <CaptureAdapter />
      </AdapterProvider>
    </>,
  );
  await waitFor(() => expect(captured).not.toBeNull());
  await act(async () => {
    await captured!.getClient().meta.saveItem('permission', 'sales_rep', { name: 'sales_rep' });
  });
}

/** The text of the one advisory toast on screen. */
async function toastText(): Promise<string> {
  let text = '';
  await waitFor(() => {
    const shown = Array.from(document.querySelectorAll<HTMLElement>('[data-sonner-toast]'));
    expect(shown).toHaveLength(1);
    text = shown[0].textContent ?? '';
    expect(text).toMatch(/Saved/);
  });
  return text;
}

beforeEach(() => {
  captured = null;
});

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
  cleanup();
  vi.unstubAllGlobals();
});

describe('the post-save advisory toast shows the producer’s localized sentence (objectstack#32657)', () => {
  it('a zh-CN userMessage is the finding’s text, in place of the English message and hint', async () => {
    serverAnswers({ ...CLEAN_BODY, advisories: [{ ...FINDING, userMessage: USER_TEXT_ZH }] });
    await saveThroughProvider();

    const text = await toastText();
    expect(text).toContain(USER_TEXT_ZH);
    expect(text).toContain(FINDING.rule);
    expect(text).not.toContain(FINDING.message);
    expect(text).not.toContain(FINDING.hint);
  });

  it('an en userMessage is shown the same way', async () => {
    serverAnswers({ ...CLEAN_BODY, advisories: [{ ...FINDING, userMessage: USER_TEXT_EN }] });
    await saveThroughProvider();

    const text = await toastText();
    expect(text).toContain(USER_TEXT_EN);
    expect(text).not.toContain(FINDING.message);
  });

  it('CONTROL: a finding without a userMessage keeps the message + hint face', async () => {
    serverAnswers({ ...CLEAN_BODY, advisories: [FINDING] });
    await saveThroughProvider();

    const text = await toastText();
    expect(text).toContain(FINDING.message);
    expect(text).toContain(FINDING.hint);
    expect(text).toContain(FINDING.rule);
  });
});
