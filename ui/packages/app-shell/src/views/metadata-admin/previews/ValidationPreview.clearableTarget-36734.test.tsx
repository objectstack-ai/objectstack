// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36734 — the validation preview names a `''` state-machine
 * target as "may be cleared".
 *
 * A `''` target is not a state: it says the state may be cleared (the field
 * set back to empty). The preview used to join it as a name, so
 * `paused: ['open', '']` drew `open | ` (a trailing separator) and
 * `closed: ['']` drew a blank, which reads as neither "may be cleared" nor a
 * dead end. The marker reuses the Studio rules panel's own words for that
 * row's checkbox, in both locales; an empty list still reads as a dead end.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { ValidationPreview } from './ValidationPreview';
import { t as tr } from '../i18n.js';

await loadStudioCatalogue('zh');

afterEach(cleanup);

const RULE = {
  name: 'status_flow',
  type: 'state_machine',
  message: 'Invalid status change.',
  field: 'status',
  transitions: { paused: ['open', ''], closed: [''], archived: [] },
} satisfies Record<string, unknown>;

function rowTexts(locale: string): Record<string, string> {
  const { container } = render(
    <ValidationPreview type="validation" name="status_flow" draft={RULE} locale={locale} />,
  );
  const rows: Record<string, string> = {};
  for (const li of Array.from(container.querySelectorAll('li'))) {
    const spans = Array.from(li.querySelectorAll('span')).map((s) => s.textContent ?? '');
    rows[spans[0]] = spans.slice(1).join(' / ');
  }
  return rows;
}

describe('a state-machine target of "" previews as "may be cleared" (objectstack#36734)', () => {
  for (const locale of ['en-US', 'zh-CN']) {
    it(`${locale}: names the clearable target, never a trailing separator or a blank`, () => {
      const cleared = tr('engine.studio.rules.transitionClearable', locale);
      const deadEnd = tr('engine.validationPreview.deadEnd', locale);
      // The catalogue rows are real, not the key echoed back.
      expect(cleared).not.toBe('engine.studio.rules.transitionClearable');
      if (locale === 'zh-CN') expect(cleared).not.toBe(tr('engine.studio.rules.transitionClearable', 'en-US'));

      expect(rowTexts(locale)).toEqual({
        paused: `open / ${cleared}`,
        closed: cleared,
        archived: deadEnd,
      });
    });
  }
});
