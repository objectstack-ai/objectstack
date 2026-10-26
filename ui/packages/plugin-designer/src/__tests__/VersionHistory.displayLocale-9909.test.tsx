/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `VersionHistory`'s version times read the DECLARED session locale, never the
 * machine's (objectui#9909).
 *
 * The same entries render under a declared `de-DE` tenant locale and a
 * declared `en` one — the UI language `en` on both — and must read
 * differently: a literal would measure the runner, on which a broken surface
 * and a repaired one print the same bytes. The runtime tripwire then checks
 * the argument every locale-taking call received.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';
import { VersionHistory } from '../components/VersionHistory';

afterEach(() => cleanup());

function session(locale: string, node: React.ReactNode): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

const VERSIONS = [
  { version: 2, timestamp: '2020-03-04T15:30:00.000Z', userId: 'u1', userName: 'Ada', description: 'Renamed', isCurrent: true },
];

function textUnder(locale: string): string {
  render(session(locale, <VersionHistory versions={VERSIONS} />));
  const text = document.body.textContent ?? '';
  cleanup();
  return text.replace(/\s+/g, ' ').trim();
}

describe('VersionHistory times follow the declared session locale (objectui#9909)', () => {
  it('says the de-DE face under a de-DE session', () => {
    expect(textUnder('de-DE')).toMatch(/4\.3\.2020, 15:30:00/);
  });

  it('keeps its en face under an en session', () => {
    expect(textUnder('en')).toMatch(/3\/4\/2020, 3:30:00\sPM/);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it('is a reading of the session, not of the machine', () => {
    expect(textUnder('de-DE')).not.toBe(textUnder('en'));
  });

  it('every locale-taking call receives the declared tag', () => {
    const calls = recordLocaleArguments(() => {
      render(session('de-DE', <VersionHistory versions={VERSIONS} />));
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale)).toEqual([]);
  });
});
