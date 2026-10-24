/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6052 — the gantt export filename stringified a locale-map `label`.
 *
 * `ObjectGantt` hands `GanttView` an `exportFileName`, and the chain's second
 * link is `schema.label`. `BaseSchema.label` is `string | I18nLabel` since
 * #4580's revised Q1-A ruling — `I18nLabel` being the spec's INLINE locale MAP
 * (`{ en: 'Shift Plan', 'zh-CN': '排班计划' }`) — so a gantt authored as
 *
 *   { "type": "object-gantt", "objectName": "task",
 *     "label": { "en": "Shift Plan", "zh-CN": "排班计划" } }
 *
 * reached a bare `String(...)` and exported `[object Object]-<ts>.png`.
 *
 * ## The trap this file is built around
 *
 * The defect appears ONLY when `label` is authored as a MAP. A pin written
 * with a plain-string `label` is a phantom assertion — green before the fix and
 * green after it, proving nothing. Every map case below is therefore paired
 * with a plain-string CONTROL, so the fix cannot pass by breaking the string
 * path, and with a control for each OTHER link in the same `??` chain.
 *
 * ## Why every assertion reads the produced FILENAME
 *
 * Not the prop, and not a mocked `GanttView`: the harm the card records is the
 * name of the downloaded file, and the prop is one indirection short of it.
 * These render the real `GanttView`, click its real export button, and read
 * `download` off the transient anchor `downloadBlob` creates — so the
 * assertion includes `GanttView`'s own filesystem-hostile-character strip
 * (`[\\/:*?"<>|\s]+ → ' '`) and its `-yyyyMMdd-HHmm` stamp.
 *
 * That strip is also the answer to the sanitisation question this card raised:
 * the chain ALREADY sanitises, downstream of this call site, and a resolved
 * locale-map entry goes through exactly the same strip a plain string does. No
 * sanitisation is added here.
 *
 * ## Directions — predicted before running, then measured
 *
 * Against the UNFIXED source (`String(… ?? schema.label ?? …)`):
 *   · the two map cases          → RED, `[object Object]-<ts>.png`, at every locale;
 *   · the plain-string control   → GREEN on both sides (must not change);
 *   · the `objectName` control   → GREEN on both sides (must not change);
 *   · the `objectSchema.label` control → GREEN on both sides (must not change);
 *   · the explicit-override control    → GREEN on both sides (must not change).
 * Measured red-first with the fix reverted; the recorded reds are in the PR body.
 *
 * ## Why `objectSchema?.label` is NOT resolved, and is pinned as a control
 *
 * It is the DATA object's label, declared `label: z.string().optional()` on the
 * spec's `ObjectSchemaBase` — a `strictObject`, so a locale map in that slot is
 * REJECTED by the producer rather than resolved by the consumer. Resolving it
 * here would be accepting a second vocabulary at a read site, which AGENTS.md
 * #0.1 rules out. The control pins that the link still passes its declared
 * plain string through untouched.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';
import { ObjectGantt } from './ObjectGantt';

/** The inline locale map an author writes; `zh-CN` exists so a switch is observable. */
const INLINE_MAP = { en: 'Shift Plan', 'zh-CN': '排班计划' } as const;

const ITEMS = [
  { id: '1', name: 'Alpha', start: '2024-01-01', end: '2024-01-05' },
  { id: '2', name: 'Beta', start: '2024-02-01', end: '2024-02-10' },
];

function ganttSchema(extra: Record<string, any> = {}) {
  return {
    type: 'object-gantt',
    objectName: 'task',
    startDateField: 'start',
    endDateField: 'end',
    titleField: 'name',
    data: { provider: 'value', items: ITEMS },
    ...extra,
  } as any;
}

/** An object-provider source, so the component reaches `objectSchema?.label`. */
function makeDataSource(objectLabel?: string): DataSource {
  return {
    find: vi.fn().mockResolvedValue({ data: ITEMS }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      label: objectLabel,
      fields: { name: { type: 'text' }, start: { type: 'date' }, end: { type: 'date' } },
    }),
  } as any;
}

// The real export path rasterizes an SVG through `new Image()` and a canvas.
// happy-dom decodes neither, so both are stubbed down to what the path reads:
// an image that reports load, and a canvas that yields a Blob. The FILENAME is
// under test here; the pixels are not.
const realImage = (globalThis as any).Image;
const realCreateObjectURL = URL.createObjectURL;
const realRevokeObjectURL = URL.revokeObjectURL;
const realToBlob = (globalThis as any).HTMLCanvasElement.prototype.toBlob;

/** Filenames handed to the transient download anchor, in click order. */
let downloads: string[] = [];
let clickSpy: any;

beforeAll(() => {
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 100;
    height = 100;
    set src(_v: string) {
      // Asynchronous, like a real decode, so the handler is attached first.
      setTimeout(() => this.onload?.(), 0);
    }
  }
  (globalThis as any).Image = StubImage;
  URL.createObjectURL = vi.fn(() => 'blob:stub') as any;
  URL.revokeObjectURL = vi.fn() as any;
  (globalThis as any).HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob) => void) {
    cb(new Blob(['png'], { type: 'image/png' }));
  };
});

afterAll(() => {
  (globalThis as any).Image = realImage;
  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevokeObjectURL;
  (globalThis as any).HTMLCanvasElement.prototype.toBlob = realToBlob;
});

beforeEach(() => {
  downloads = [];
  // `downloadBlob` creates, clicks and removes the anchor in one statement, so
  // the click is the only moment its `download` attribute is observable.
  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
});

afterEach(() => {
  clickSpy.mockRestore();
  cleanup();
});

async function exportPngName(schema: any, tenantLocale?: string, dataSource?: DataSource) {
  const { findByTestId } = render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale: tenantLocale }}>
        <ObjectGantt schema={schema} dataSource={dataSource} />
      </LocalizationProvider>
    </I18nProvider>,
  );
  const button = await findByTestId('gantt-export-png');
  fireEvent.click(button);
  await waitFor(() => expect(downloads.length).toBe(1));
  return downloads[0];
}

// `<base>-yyyyMMdd-HHmm.png` — the stamp is the wall clock, so it is matched
// rather than pinned, and the base is anchored at both ends of the name.
const named = (base: string) => new RegExp(`^${base}-\\d{8}-\\d{4}\\.png$`);

describe('ObjectGantt export filename resolves the inline locale map (objectui#6052)', () => {
  it('a locale-map label exports under the zh-CN entry, not "[object Object]"', async () => {
    const name = await exportPngName(ganttSchema({ label: INLINE_MAP }), 'zh-CN');
    expect(name).not.toContain('[object Object]');
    expect(name).toMatch(named('排班计划'));
  });

  it('the same map exports under the en entry for an en audience', async () => {
    const name = await exportPngName(ganttSchema({ label: INLINE_MAP }), 'en');
    expect(name).not.toContain('[object Object]');
    expect(name).toMatch(named('Shift Plan'));
  });

  it('CONTROL — a plain-string label still names the file itself', async () => {
    const name = await exportPngName(ganttSchema({ label: 'Plain Label' }), 'zh-CN');
    expect(name).toMatch(named('Plain Label'));
  });

  it('CONTROL — an explicit exportFileName still wins the chain over the map', async () => {
    const name = await exportPngName(
      ganttSchema({ label: INLINE_MAP, exportFileName: 'Shift Plan Gantt' }),
      'zh-CN',
    );
    expect(name).toMatch(named('Shift Plan Gantt'));
  });

  it('CONTROL — no label falls through to the object API name', async () => {
    const name = await exportPngName(ganttSchema(), 'zh-CN');
    expect(name).toMatch(named('task'));
  });

  it('CONTROL — no view label falls through to the object schema label, unresolved', async () => {
    const name = await exportPngName(
      ganttSchema({ data: { provider: 'object', object: 'task' } }),
      'zh-CN',
      makeDataSource('Task Object'),
    );
    expect(name).toMatch(named('Task Object'));
  });
});
