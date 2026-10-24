// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11181: the Data pillar's Actions view prints an action's locale-map
 * `label` in the designer locale.
 *
 * The spec types `ActionSchema.label` as `I18nLabel`: a plain string or an
 * inline locale map. `ObjectActionsPanel` read a map through a local key order
 * of its own (`default`, `en-US`, `en`, `zh-CN`, then the first entry), so
 * under zh a map carrying both languages printed its English text. It now
 * reads the label through `navItemLabelText`, the helper the Studio's other
 * `I18nLabel` readers share, so the entry chosen is the spec's
 * `resolveI18nLabel` choice for the designer locale.
 *
 * Both readers are pinned: the action list row, and the detail pane that names
 * the selected action (with no action editor registered in this module
 * graph, the pane prints the label; see
 * `ObjectActionsPanel.designerRegistryMissing.test.tsx`). Every action of the
 * fixture parses against the spec. The plain-string action is the control.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';
import { I18nProvider } from '@object-ui/i18n';

import { ObjectActionsPanel } from './ObjectActionsPanel';

const ACTIONS = [
  // Selected by default (the first action), so the detail pane names it too.
  { name: 'send_email', label: { en: 'Send Email', 'zh-CN': '发送邮件' }, type: 'script', target: 'send_email' },
  // The control: a plain-string label prints as authored in any locale.
  { name: 'close_case', label: 'Close Case', type: 'script', target: 'close_case' },
];

const draft = { name: 'showcase_task', label: 'Task', actions: ACTIONS };

afterEach(cleanup);

type Language = 'en' | 'zh';

function renderPanel(language: Language) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ObjectActionsPanel draft={draft} onPatch={() => {}} />
    </I18nProvider>,
  );
}

const MAP_TEXT: Record<Language, { shown: string; other: string }> = {
  en: { shown: 'Send Email', other: '发送邮件' },
  zh: { shown: '发送邮件', other: 'Send Email' },
};

describe('the objectui#11181 action fixture is what the spec accepts', () => {
  it('every action of the fixture, the map included, parses against ActionSchema', () => {
    for (const action of ACTIONS) expect(ActionSchema.safeParse(action).success).toBe(true);
  });
});

for (const language of ['en', 'zh'] as const) {
  describe(`the Actions view prints a map-labelled action under ${language} (objectui#11181)`, () => {
    it('the list row and the detail pane print the designer-locale entry; the plain string as authored', async () => {
      renderPanel(language);

      const text = MAP_TEXT[language];
      // Once in the list row, once in the detail pane of the selected action.
      expect(await screen.findAllByText(text.shown)).toHaveLength(2);
      expect(screen.queryByText(text.other)).toBeNull();
      expect(screen.getByText('Close Case')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('[object Object]');
    });
  });
}
