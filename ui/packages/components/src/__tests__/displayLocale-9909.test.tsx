/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The debug panel's event times read the DECLARED session locale, never the
 * machine's (objectui#9909).
 *
 * Each surface renders the same state twice — under a declared `de-DE` tenant
 * locale and a declared `en` one, the UI language `en` on both — and must read
 * differently: a literal expectation would measure the runner, on which a
 * broken surface and a repaired one print the same bytes. The runtime tripwire
 * then checks the argument every locale-taking call received.
 *
 * The export-progress dialog's record-count surface left this table with the
 * component itself: objectui#10247 retired the unimplemented async export path.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DebugCollector } from '@object-ui/core';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { DebugPanel } from '../debug/DebugPanel';

afterEach(() => {
  cleanup();
  DebugCollector.getInstance().clear();
});

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

function textUnder(locale: string, node: React.ReactNode, reveal?: () => void): string {
  render(session(locale, node));
  reveal?.();
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

/** 15:30:45 UTC — the suite runs in UTC; `de` is 24-hour, `en` is 12-hour. */
const EVENT_AT = Date.UTC(2020, 2, 4, 15, 30, 45);

function seedEvent(): void {
  DebugCollector.getInstance().clear();
  DebugCollector.getInstance().addEvent({ action: 'save', timestamp: EVENT_AT });
}

function openEventsTab(): void {
  const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === 'Events');
  expect(tab, 'the Events tab is rendered').toBeTruthy();
  fireEvent.click(tab!);
}

interface Surface {
  name: string;
  node: () => React.ReactNode;
  reveal?: () => void;
  de: RegExp;
  en: RegExp;
}

const SURFACES: Surface[] = [
  {
    name: 'DebugPanel — Events tab timestamp',
    node: () => {
      seedEvent();
      return <DebugPanel open onClose={() => {}} />;
    },
    reveal: openEventsTab,
    de: /15:30:45/,
    en: /3:30:45\sPM/,
  },
];

describe('component time faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', ({ node, reveal, de }) => {
    const text = textUnder('de-DE', node(), reveal);
    expect(text, `got: ${text}`).toMatch(de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', ({ node, reveal, en }) => {
    const text = textUnder('en', node(), reveal);
    expect(text, `got: ${text}`).toMatch(en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', ({ node, reveal }) => {
    expect(textUnder('de-DE', node(), reveal)).not.toBe(textUnder('en', node(), reveal));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', ({ node, reveal }) => {
    const tree = node();
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', tree));
      reveal?.();
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
