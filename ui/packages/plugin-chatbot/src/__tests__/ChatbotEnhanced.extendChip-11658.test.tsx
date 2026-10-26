/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#11658 item 5 — the extend-mode scope chip ("+ Adding to existing
 * app …") is localized and names the target app by its LABEL.
 *
 * Measured on the 2026-10-05 cloud acceptance run: a zh-CN user's plan card read
 * `+ Adding to existing app "customer_management"` — an English literal the
 * component defaulted to, around the app's machine name. Both chip sites carry
 * it: the proposed-plan card and the live design panel (`BlueprintProgressPanel`).
 *
 * The predicate pinned is the class the acceptance names: under a non-English
 * locale the chip carries NO ASCII-only literal. The target label below is
 * Chinese on purpose, so any Latin letter left in the zh chip is an English
 * word the component (or a missing pack key) put there. The machine name stays
 * reachable, on the chip's tooltip.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';

const TARGET = 'customer_management';
const TARGET_LABEL = '客户管理';
const resolveAppLabel = (name: string) => (name === TARGET ? TARGET_LABEL : undefined);

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>{ui}</I18nProvider>,
  );
}

const planMessages = (targetApp: string): ChatbotEnhancedMessage[] => [
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
          summary: '跟进记录',
          objects: [{ name: 'follow_up', label: '跟进', fieldCount: 3 }],
          counts: { objects: 1, views: 0, dashboards: 0, seedData: 0 },
          questions: [],
          assumptions: [],
          targetApp,
        },
      },
    ],
  },
];

const designingMessages = (targetApp: string): ChatbotEnhancedMessage[] => [
  { id: 'u1', role: 'user', content: '加一张跟进表' },
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    streaming: true,
    toolInvocations: [{ toolCallId: 't1', toolName: 'propose_blueprint', state: 'input-available' }],
    blueprintProgress: {
      phase: 'designing',
      targetApp,
      objects: [{ name: 'follow_up', label: '跟进', fields: 3 }],
    },
  },
];

/** Every Latin-letter run in a string — an English word, in a zh chip. */
const latinWords = (text: string) => text.match(/[A-Za-z]+/g) ?? [];

afterEach(cleanup);

describe('the extend-mode scope chip (objectui#11658 item 5)', () => {
  describe.each([
    ['the proposed-plan card', 'proposed-plan-extend', planMessages],
    ['the live design panel', 'blueprint-progress-extend', designingMessages],
  ] as const)('%s', (_where, testId, messages) => {
    it('zh: carries no ASCII-only literal and names the app by its label', () => {
      renderIn('zh', <ChatbotEnhanced isLoading messages={messages(TARGET)} resolveAppLabel={resolveAppLabel} />);
      const chip = screen.getByTestId(testId);
      expect(chip.textContent).toContain(TARGET_LABEL);
      expect(latinWords(chip.textContent ?? '')).toEqual([]);
      expect(chip.textContent).not.toContain('Adding to existing app');
      // The machine name is not the chip's text; it stays on the tooltip.
      expect(chip.textContent).not.toContain(TARGET);
      expect(chip).toHaveAttribute('title', TARGET);
    });

    it('en: reads the English sentence around the label (control)', () => {
      renderIn('en', <ChatbotEnhanced isLoading messages={messages(TARGET)} resolveAppLabel={resolveAppLabel} />);
      const chip = screen.getByTestId(testId);
      expect(chip.textContent).toContain('Adding to existing app');
      expect(chip.textContent).toContain(TARGET_LABEL);
      expect(chip.textContent).not.toContain(TARGET);
    });

    it('an app the resolver does not know is shown by the name given', () => {
      renderIn('zh', <ChatbotEnhanced isLoading messages={messages('orders')} resolveAppLabel={resolveAppLabel} />);
      const chip = screen.getByTestId(testId);
      expect(chip.textContent).toContain('orders');
      expect(latinWords(chip.textContent ?? '')).toEqual(['orders']);
    });
  });
});
