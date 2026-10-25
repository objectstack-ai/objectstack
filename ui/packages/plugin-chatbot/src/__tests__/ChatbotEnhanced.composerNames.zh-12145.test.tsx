/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — the composer's send button is named from the pack.
 *
 * The vendored `PromptInputSubmit` defaults to `aria-label="Submit"`, and its one
 * shipped call site, `ChatbotEnhanced`, overrides it with `L.submit`. That
 * fallback was the English literal itself, so every host that passes no
 * `labels` (an SDUI `chatbot` node, a standalone embed) named the button
 * "Submit" in every locale. It now reads `console.ai.submit`, the key the
 * console already passes for the same name, and the stop state reads
 * `console.ai.stopResponse`.
 *
 * The name is read against the PACK, never against a literal.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';
import { ChatbotEnhanced } from '../ChatbotEnhanced';

afterEach(cleanup);

describe("the composer's send button is named from the pack (objectui#12145)", () => {
  it('with no provider and no host labels, it carries the en pack value', () => {
    render(<ChatbotEnhanced messages={[]} />);
    expect(screen.getByRole('button', { name: en.console.ai.submit })).toBeInTheDocument();
  });

  it('under zh with no host labels, it is named by the zh pack, not by the English word', async () => {
    expect(zh.console.ai.submit).not.toBe(en.console.ai.submit);
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ChatbotEnhanced messages={[]} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: zh.console.ai.submit })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.console.ai.submit })).toBeNull();
  });

  it("a host's own label still wins over the pack", async () => {
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }} persistLanguage={false}>
        <ChatbotEnhanced messages={[]} labels={{ submit: 'Host send' }} />
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Host send' })).toBeInTheDocument();
  });
});
