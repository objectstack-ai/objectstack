/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A settings label probe that falls back by design logs nothing
 * (objectui#11801, item 2).
 *
 * ## What was broken
 *
 * The workspace-timezone prompt renders the manifest's `timezone` row through
 * `<SettingsField labels={useSettingsLabel('localization')}>`, the same pair
 * the Settings page uses. `useSettingsLabel` resolves every label, help line
 * and option label by PROBING `<ns>.settings.<namespace>.…` in each top-level
 * i18next namespace that has a truthy `settings` member, and falls back to the
 * manifest literal on a miss. Each probe was a plain `t()` call, so each miss
 * reached `@object-ui/i18n`'s dev missing-key handler and logged
 * "Missing translation for …" once per key.
 *
 * Two kinds of miss, both of them the convention working as designed:
 *
 * - namespaces that can never hold a settings tree. The built-in `en` pack
 *   has four top-level groups with a `settings` member — `workspace`,
 *   `sidebar` and `user` (each a STRING, a menu label) and `organization`
 *   (the organization page's own strings). Every probe into them misses.
 * - suffixes the server is allowed not to translate. The server's
 *   `TranslationData.settings.localization` (delivered under `app` by
 *   `transformSpecTranslations`) carries `label` and `help` for `timezone`
 *   but no `options`, so each curated zone's option label misses too, and
 *   the manifest's own option literal is what renders.
 *
 * Neither is a missing translation. The server already ships the timezone
 * label and help in every locale it serves; the fix is that a convention
 * probe asks i18next whether the key EXISTS (which never reaches the
 * missing-key handler) before it translates it — the same exclusion
 * `useObjectLabel` gets for its own convention probes inside
 * `@object-ui/i18n`.
 *
 * ## Why the server tree goes through `transformSpecTranslations`
 *
 * It is the transform `apps/console/src/loadLanguage.ts` applies to
 * `/api/v1/i18n/translations/:locale`, so the tree lands under `app` exactly
 * as it does in the running console, beside the resident built-in `en` pack
 * that `createI18n` merges in. Hand-writing `{ app: … }` would assert against
 * a shape the transport might not produce.
 *
 * ## Red-first prediction (written before the first run)
 *
 * On `origin/main` the first case FAILS — the warnings name the four
 * built-in namespaces for `label` and `help`, and every namespace for each
 * curated option — and the resolution cases PASS, because the fix must not
 * change what renders.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  createI18n,
  I18nProvider,
  transformSpecTranslations,
  type SpecTranslationData,
} from '@object-ui/i18n';
import { SettingsField } from '../SettingsField';
import { useSettingsLabel } from '../useSettingsLabel';
import type { ResolvedSettingValue, Specifier } from '../types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The manifest's `timezone` row as the server declares it, curated options in full. */
const TIMEZONE_SPEC: Specifier = {
  type: 'select',
  key: 'timezone',
  label: 'Default timezone',
  description:
    'IANA zone used to resolve today()/daysFromNow, analytics date buckets, and rendered datetimes.',
  default: 'UTC',
  valueDomain: 'iana_time_zone',
  options: [
    { value: 'UTC', label: 'UTC' },
    { value: 'America/Los_Angeles', label: '(UTC−08/−07) Los Angeles' },
    { value: 'America/Denver', label: '(UTC−07/−06) Denver' },
    { value: 'America/Chicago', label: '(UTC−06/−05) Chicago' },
    { value: 'America/New_York', label: '(UTC−05/−04) New York' },
    { value: 'America/Sao_Paulo', label: '(UTC−03) São Paulo' },
    { value: 'Europe/London', label: '(UTC±00/+01) London' },
    { value: 'Europe/Paris', label: '(UTC+01/+02) Paris' },
    { value: 'Europe/Berlin', label: '(UTC+01/+02) Berlin' },
    { value: 'Europe/Moscow', label: '(UTC+03) Moscow' },
    { value: 'Asia/Dubai', label: '(UTC+04) Dubai' },
    { value: 'Asia/Kolkata', label: '(UTC+05:30) Kolkata' },
    { value: 'Asia/Singapore', label: '(UTC+08) Singapore' },
    { value: 'Asia/Shanghai', label: '(UTC+08) Shanghai' },
    { value: 'Asia/Tokyo', label: '(UTC+09) Tokyo' },
    { value: 'Australia/Sydney', label: '(UTC+10/+11) Sydney' },
    { value: 'Pacific/Auckland', label: '(UTC+12/+13) Auckland' },
  ],
};

/** The server's served `settings` groups for `en`, abridged to the localization namespace. */
const SERVED_EN: SpecTranslationData = {
  settingsCommon: {
    sourceLabels: { env: 'Env', global: 'Global', tenant: 'Tenant', user: 'User', default: 'Default' },
  },
  settings: {
    localization: {
      title: 'Localization',
      keys: {
        timezone: {
          label: 'Default timezone (served)',
          help: 'Help line as the server translates it.',
        },
      },
    },
  },
};

const DEFAULT_RESOLVED: ResolvedSettingValue = { value: 'UTC', source: 'default', locked: false };

function TimezoneRow() {
  const labels = useSettingsLabel('localization');
  return (
    <SettingsField
      spec={TIMEZONE_SPEC}
      resolved={DEFAULT_RESOLVED}
      value="Asia/Kolkata"
      onChange={() => {}}
      labels={labels}
    />
  );
}

function renderRow(served: SpecTranslationData | null) {
  const instance = createI18n({
    defaultLanguage: 'en',
    detectBrowserLanguage: false,
    warnMissingKeys: true,
    resources: served ? { en: transformSpecTranslations(served) } : {},
  });
  return render(
    <I18nProvider instance={instance}>
      <TimezoneRow />
    </I18nProvider>,
  );
}

/** Every dev missing-key warning that names a settings convention key. */
function settingsMisses(calls: unknown[][]): string[] {
  return calls
    .map((args) => String(args[0]))
    .filter((line) => line.includes('Missing translation') && /\.settings\.localization\./.test(line));
}

describe('useSettingsLabel convention probes (objectui#11801)', () => {
  it('logs no missing-translation warning for a probe that falls back by design', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderRow(SERVED_EN);
    expect(settingsMisses(warn.mock.calls)).toEqual([]);
  });

  it('still resolves the label and help the server serves under `app`', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderRow(SERVED_EN);
    expect(screen.getByText('Default timezone (served)')).toBeInTheDocument();
    expect(screen.getByText('Help line as the server translates it.')).toBeInTheDocument();
  });

  it('still falls back to the manifest literal when nothing is served, and logs nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderRow(null);
    expect(screen.getByText('Default timezone')).toBeInTheDocument();
    expect(screen.getByText(TIMEZONE_SPEC.description as string)).toBeInTheDocument();
    expect(settingsMisses(warn.mock.calls)).toEqual([]);
  });
});
