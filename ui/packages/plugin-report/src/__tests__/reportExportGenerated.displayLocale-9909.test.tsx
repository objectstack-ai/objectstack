/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The exported report's "Generated:" time reads the DECLARED session locale,
 * never the machine's (objectui#9909).
 *
 * The HTML and PDF exports stamp that time into a file the reader downloads
 * and keeps; both templates used `new Date().toLocaleString()` with no tag.
 * The surface is measured where a user reaches it — `ReportViewer`'s PDF
 * button, which writes the print document, and its popup-blocked fallback,
 * which downloads the HTML file — plus `exportReport` itself for a caller that
 * passes nothing, which must land on the display channel's last resort and
 * never on the machine.
 *
 * Measured as a DIFFERENCE: the same export under a declared `de-DE` session
 * and a declared `en` one must read differently, since a literal would measure
 * the runner. The runtime tripwire then checks the argument every
 * locale-taking call received.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';
import { ReportViewer } from '../ReportViewer';
import { exportReport } from '../ReportExportEngine';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** 2020-03-04 15:30:45 UTC — the suite runs in UTC. */
const NOW = new Date(Date.UTC(2020, 2, 4, 15, 30, 45));

function renderIn(locale: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{element}</LocalizationProvider>
    </I18nProvider>,
  );
}

const VIEWER_SCHEMA = {
  type: 'report-viewer',
  showToolbar: true,
  allowExport: true,
  allowPrint: false,
  data: [{ name: 'A', amount: 1 }],
  report: {
    title: 'Quarterly',
    showExportButtons: true,
    fields: [{ name: 'name', label: 'Name' }, { name: 'amount', label: 'Amount' }],
    sections: [],
  },
};

/** Click PDF with a print window that records what was written to it. */
async function printDocumentUnder(locale: string): Promise<string> {
  let written = '';
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write: (html: string) => { written += html; }, close: () => {} },
    print: () => {},
  } as unknown as Window);
  renderIn(locale, <ReportViewer schema={VIEWER_SCHEMA as never} />);
  fireEvent.click(screen.getByRole('button', { name: /PDF/ }));
  cleanup();
  return written;
}

/** Click PDF with the popup blocked, so the HTML file is downloaded instead. */
async function downloadedHtmlUnder(locale: string): Promise<string> {
  let blob: Blob | undefined;
  vi.spyOn(window, 'open').mockReturnValue(null);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    blob = b as Blob;
    return 'blob:report';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  renderIn(locale, <ReportViewer schema={VIEWER_SCHEMA as never} />);
  fireEvent.click(screen.getByRole('button', { name: /PDF/ }));
  cleanup();
  expect(blob, 'the fallback downloaded a file').toBeDefined();
  return blob!.text();
}

const generated = (doc: string): string => /Generated: ([^<]+)</.exec(doc)?.[1]?.replace(/\s+/g, ' ') ?? '';

interface Surface {
  name: string;
  read: (locale: string) => Promise<string>;
}

const SURFACES: Surface[] = [
  { name: 'ReportViewer PDF — the print document', read: printDocumentUnder },
  { name: 'ReportViewer PDF, popup blocked — the downloaded HTML file', read: downloadedHtmlUnder },
];

async function faceUnder(locale: string, surface: Surface): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    return generated(await surface.read(locale));
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
}

describe('the exported report stamps its "Generated:" time in the session locale (objectui#9909)', () => {
  it.each(SURFACES)('$name — says the de-DE face under a de-DE session', async (surface) => {
    expect(await faceUnder('de-DE', surface)).toBe('4.3.2020, 15:30:45');
  });

  it.each(SURFACES)('$name — keeps its en face under an en session', async (surface) => {
    expect(await faceUnder('en', surface)).toBe('3/4/2020, 3:30:45 PM');
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it.each(SURFACES)('$name — is a reading of the session, not of the machine', async (surface) => {
    expect(await faceUnder('de-DE', surface)).not.toBe(await faceUnder('en', surface));
  });

  it.each(SURFACES)('$name — every locale-taking call receives the declared tag', async (surface) => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await faceUnder('de-DE', surface);
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });

  /**
   * A published caller that passes no locale lands on the display channel's
   * own last resort (`'en'`, `displayLocale.ts`), exactly like `formatValue`
   * — never on the machine's locale.
   */
  it('exportReport with no locale uses the last resort, not the machine', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      let written = '';
      vi.spyOn(window, 'open').mockReturnValue({
        document: { write: (html: string) => { written += html; }, close: () => {} },
        print: () => {},
      } as unknown as Window);
      exportReport('pdf', VIEWER_SCHEMA.report as never, VIEWER_SCHEMA.data);
      expect(written).toMatch(/Generated: /);
    });
    expect(calls.filter(isMachineLocale)).toEqual([]);
    expect(calls.map((c) => c.locale)).toContain('en');
  });
});
