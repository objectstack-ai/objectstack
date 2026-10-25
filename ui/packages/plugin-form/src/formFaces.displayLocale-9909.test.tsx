/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form package's number and time faces read the DECLARED session locale,
 * never the machine's (objectui#9909): the analytics submission count, the
 * master-detail money stack and the OCC conflict dialog's "their save" time.
 *
 * Each surface renders the same state twice — under a declared `de-DE` tenant
 * locale and a declared `en` one, the UI language `en` on both — and must read
 * differently: a literal expectation would measure the runner, on which a
 * broken surface and a repaired one print the same bytes. The runtime tripwire
 * then checks the argument every locale-taking call received.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import { FormAnalytics } from './FormAnalytics';
import { MasterDetailForm } from './MasterDetailForm';
import { useOccSave } from './occSave';

registerAllFields();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function session(locale: string, node: React.ReactNode, currency?: string): React.ReactElement {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale, currency }}>{node}</LocalizationProvider>
    </I18nProvider>
  );
}

/* -------------------------------------------------------------------------- */
/* The surfaces                                                               */
/* -------------------------------------------------------------------------- */

const PARENT = 'po';
function masterDetailDataSource() {
  return {
    getObjectSchema: vi.fn(async (obj: string) =>
      obj === PARENT
        ? { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' }, tax_rate: { type: 'number', label: 'Tax Rate' } } }
        : { name: 'po_line', fields: { line_total: { type: 'number', label: 'Line Total' }, po: { type: 'lookup', label: 'PO' } } },
    ),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
  } as never;
}
const MASTER_DETAIL_SCHEMA = {
  objectName: PARENT,
  mode: 'create',
  fields: ['ref', 'tax_rate'],
  details: [
    {
      childObject: 'po_line',
      relationshipField: 'po',
      amountField: 'line_total',
      title: 'PO lines',
      columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
    },
  ],
} as never;

/** The platform's 409 CONCURRENT_UPDATE, carrying the racer's SQL-style version. */
const conflictError = () =>
  Object.assign(new Error('Record was modified by another user'), {
    code: 'CONCURRENT_UPDATE',
    httpStatus: 409,
    currentVersion: '2020-03-04 15:30:00.000',
    currentRecord: { id: 'r1', updated_at: '2020-03-04 15:30:00.000' },
  });

function OccConflictHarness() {
  const { saveWithOcc, conflictDialog } = useOccSave();
  // One save, one conflict: the ref (not the callback's identity) is what
  // keeps a re-render from saving twice.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    void saveWithOcc({
      dataSource: { update: vi.fn().mockRejectedValue(conflictError()) },
      objectName: 'device',
      recordId: 'r1',
      payload: { name: 'Mine v2' },
      baseRecord: { updated_at: '2020-03-04 15:00:00.000' },
    });
  }, [saveWithOcc]);
  return <>{conflictDialog}</>;
}

interface Surface {
  name: string;
  node: () => React.ReactNode;
  /** Settles the surface and returns the face under test. */
  read: () => Promise<string>;
  de: RegExp;
  en: RegExp;
  /** The tenant's default currency, for a surface that shows money. */
  currency?: string;
}

const SURFACES: Surface[] = [
  {
    name: 'FormAnalytics — total submissions',
    node: () => <FormAnalytics formId="f1" metrics={{ totalSubmissions: 12345 }} />,
    read: async () => document.body.textContent ?? '',
    de: /12\.345/,
    en: /12,345/,
  },
  {
    name: 'MasterDetailForm — subtotal stack',
    node: () => <MasterDetailForm schema={MASTER_DETAIL_SCHEMA} dataSource={masterDetailDataSource()} />,
    read: async () => {
      const cell = await waitFor(() => screen.getAllByLabelText('Line Total')[0] as HTMLInputElement);
      fireEvent.change(cell, { target: { value: '1234.5' } });
      return waitFor(() => {
        const text = screen.getByTestId('md-subtotal').textContent ?? '';
        expect(text).toMatch(/1.234.50/);
        return text;
      });
    },
    // The grouping is the display locale's; the sign is the tenant's USD, where
    // the locale puts it (objectui#11132). It used to be a literal `¥` prefix
    // whatever the currency.
    currency: 'USD',
    de: /^1\.234,50 \$$/,
    en: /^\$1,234\.50$/,
  },
  {
    name: "useOccSave — the conflict dialog's “their save” time",
    node: () => <OccConflictHarness />,
    read: () =>
      waitFor(() => {
        const text = document.body.textContent ?? '';
        expect(text).toMatch(/Their save: /);
        return text;
      }),
    de: /Their save: 4\.3\.2020, 15:30:00/,
    en: /Their save: 3\/4\/2020, 3:30:00\sPM/,
  },
];

async function faceUnder(locale: string, surface: Surface): Promise<string> {
  render(session(locale, surface.node(), surface.currency));
  const text = (await surface.read()).replace(/\s+/g, ' ').trim();
  cleanup();
  return text;
}

describe('form number and time faces follow the declared session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async (surface) => {
    const text = await faceUnder('de-DE', surface);
    expect(text, `got: ${text}`).toMatch(surface.de);
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async (surface) => {
    const text = await faceUnder('en', surface);
    expect(text, `got: ${text}`).toMatch(surface.en);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async (surface) => {
    expect(await faceUnder('de-DE', surface)).not.toBe(await faceUnder('en', surface));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async (surface) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      render(session('de-DE', surface.node(), surface.currency));
      await surface.read();
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
