/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The refused `aria.label` spelling is retired, and the retirement is LOUD
 * (objectui#9945)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `record:path` and `record:quick_actions` used to fold the contract-refused
 * `aria.label` in behind the canonical `aria.ariaLabel`. Ruling `5749677059` on
 * objectui#9945 (maintainer-approved, letter A) retired that fold: the shared
 * read point reads `aria.ariaLabel` only, and a served `aria.label` is
 * reported with one `console.warn` that names the block and the canonical
 * spelling, while the block announces its default name.
 *
 * The ruling made the retirement conditional on one measurement: each block
 * must HAVE a default accessible name, or retiring would leave it unnamed. The
 * "nothing authored" rows below are that measurement, and they are why the
 * retirement landed (the pre-authorised fallback was to keep the fold).
 *
 * Every case asserts the accessibility tree through `getByRole(role, { name })`,
 * not the `aria-label` attribute, for the reason
 * `recordComponentAria-9556.test.tsx` gives.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(node: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1', stage: 'won' }}>
        {node}
      </RecordContextProvider>
    </I18nProvider>
  );
}

const ACT = { name: 'act', label: 'Act', type: 'script', locations: ['record_header'] };

interface Block {
  /** The registered type, which is what the report must name. */
  type: string;
  /** The block's built-in accessible name (en). */
  defaultName: string;
  el: (aria?: unknown) => React.ReactElement;
  /** Every element that carries the block's own name. */
  named: (name: string) => HTMLElement[];
}

const BLOCKS: Block[] = [
  {
    type: 'record:path',
    defaultName: 'Record path',
    el: (aria) => (
      <RecordPathRenderer
        schema={{ statusField: 'stage', stages: [{ value: 'won', label: 'Won' }], ...(aria ? { aria } : {}) } as never}
      />
    ),
    // Both rails (desktop and mobile) carry the name; the split is CSS-only.
    named: (name) => screen.queryAllByRole('list', { name }),
  },
  {
    type: 'record:quick_actions',
    defaultName: 'Quick actions',
    el: (aria) => (
      <RecordQuickActionsRenderer schema={{ actions: [ACT], ...(aria ? { aria } : {}) } as never} />
    ),
    named: (name) => screen.queryAllByRole('toolbar', { name }),
  },
];

/** The `console.warn` calls that report a served `aria.label` on `type`. */
function reportsFor(warn: MockInstance<typeof console.warn>, type: string): string[] {
  return warn.mock.calls
    .map((args) => String(args[0]))
    .filter((message) => message.includes(type) && message.includes('`aria.label`'));
}

const LEGACY = 'Legacy name';
const CANONICAL = 'Account overview';

for (const block of BLOCKS) {
  describe(`${block.type} — \`aria.label\` is retired (objectui#9945)`, () => {
    it('has a default accessible name when nothing is authored (the ruling\'s condition)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(wrap(block.el(undefined)));
      expect(block.named(block.defaultName).length).toBeGreaterThan(0);
      expect(reportsFor(warn, block.type)).toHaveLength(0);
    });

    it('a served `aria.label` is not read: the block announces its default name', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(wrap(block.el({ label: LEGACY })));
      expect(block.named(block.defaultName).length).toBeGreaterThan(0);
      expect(block.named(LEGACY)).toHaveLength(0);
    });

    it('a served `aria.label` is reported once, naming the block and `aria.ariaLabel`', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const view = render(wrap(block.el({ label: LEGACY })));
      // A re-render hands the block a NEW bag with the same content, which is
      // what a live page does on every state change. It must not report again.
      view.rerender(wrap(block.el({ label: LEGACY })));

      const reports = reportsFor(warn, block.type);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('`aria.ariaLabel`');
    });

    it('control: `aria.ariaLabel` beside it still names the block', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(wrap(block.el({ ariaLabel: CANONICAL, label: LEGACY })));
      expect(block.named(CANONICAL).length).toBeGreaterThan(0);
      expect(block.named(LEGACY)).toHaveLength(0);
      // The refused key is still carried, so it is still reported.
      expect(reportsFor(warn, block.type)).toHaveLength(1);
    });

    it('control: `aria.ariaLabel` alone names the block and reports nothing', () => {
      // Without this, a report that fired on every bag would pass the case
      // above for the wrong reason.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      render(wrap(block.el({ ariaLabel: CANONICAL })));
      expect(block.named(CANONICAL).length).toBeGreaterThan(0);
      expect(reportsFor(warn, block.type)).toHaveLength(0);
    });
  });
}
