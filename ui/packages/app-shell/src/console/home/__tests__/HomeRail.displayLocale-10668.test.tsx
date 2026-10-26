// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Home rail's relative timestamps read the DISPLAY locale, never the UI
 * language (objectui#10668).
 *
 * `HomeActionCenter` and `HomeActivity` handed `useObjectTranslation().language`
 * to `timeAgo`, which formats through `Intl.RelativeTimeFormat`. So a regional
 * display locale (`de-CH` under an English UI) never reached them, while the
 * relative-time faces beside them (the Marketplace's, objectui#10331; Studio
 * home's visit times, objectui#10232) already read `useDisplayLocale()`. Both
 * now read `useDisplayLocale()`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';

import { HomeActionCenter, HomeActivity } from '../HomeRail';

afterEach(cleanup);

const t = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key;

/** Three days ago: `timeAgo` rounds it to exactly -3 days. */
const threeDaysAgo = () => new Date(Date.now() - 3 * 86_400_000).toISOString();

function railUnder(locale: string) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <div data-testid="action-center">
          <HomeActionCenter
            pendingApprovals={[]}
            pendingApprovalsCount={0}
            pendingApprovalsStatus="ready"
            pendingApprovalsReadable
            notifications={[{ id: 'n1', title: 'A file was assigned to you', createdAt: threeDaysAgo() }]}
            unreadTopicCount={1}
            notificationsStatus="ready"
            notificationsReadable
            onOpenApprovals={() => {}}
            onOpenApproval={() => {}}
            onOpenInbox={() => {}}
            onOpenNotification={() => {}}
            t={t}
          />
        </div>
        <div data-testid="activity">
          <HomeActivity
            activity={{
              value: [
                {
                  id: 'a1',
                  type: 'update',
                  objectName: 'account',
                  user: 'Priya',
                  description: 'updated Northwind',
                  timestamp: threeDaysAgo(),
                },
              ],
              status: 'ready',
              readable: true,
            }}
            onViewAll={() => {}}
            t={t}
          />
        </div>
      </LocalizationProvider>
    </I18nProvider>
  );
}

/** The RAW text of each card: expectations are built by the cases, never in here. */
function facesUnder(locale: string): { actionCenter: string; activity: string } {
  const { getByTestId } = render(railUnder(locale));
  const faces = {
    actionCenter: getByTestId('action-center').textContent ?? '',
    activity: getByTestId('activity').textContent ?? '',
  };
  cleanup();
  return faces;
}

const threeDaysIn = (locale: string) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'day');

describe('Home rail — relative timestamps follow the display locale (objectui#10668)', () => {
  it('reads de-CH under an English UI with a de-CH display locale', () => {
    expect(threeDaysIn('de-CH')).toBe('vor 3 Tagen');
    const faces = facesUnder('de-CH');
    expect(faces.actionCenter, `got: ${faces.actionCenter}`).toContain('vor 3 Tagen');
    expect(faces.activity, `got: ${faces.activity}`).toContain('vor 3 Tagen');
  });

  it('control: reads en-US under an en-US display locale', () => {
    expect(threeDaysIn('en-US')).toBe('3 days ago');
    const faces = facesUnder('en-US');
    expect(faces.actionCenter, `got: ${faces.actionCenter}`).toContain('3 days ago');
    expect(faces.activity, `got: ${faces.activity}`).toContain('3 days ago');
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    const de = facesUnder('de-CH');
    const en = facesUnder('en-US');
    expect(de.actionCenter).not.toBe(en.actionCenter);
    expect(de.activity).not.toBe(en.activity);
  });

  it('every locale-taking call receives the declared tag', () => {
    const tree = railUnder('de-CH');
    const calls = recordLocaleArguments(() => {
      render(tree);
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
