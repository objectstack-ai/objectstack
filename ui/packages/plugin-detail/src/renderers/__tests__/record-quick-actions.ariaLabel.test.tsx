/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:quick_actions` — the toolbar's accessible name is read under the
 * spelling the platform ARIA contract actually accepts (objectui#4663).
 *
 * The bar used to read `schema.aria?.label` and nothing else. That is the ONE
 * spelling `@objectstack/spec`'s `AriaPropsSchema` refuses: `label` is an ALIAS
 * ENTRY on that closed shape, i.e. a rename prescription pointing at
 * `ariaLabel`, so it exists to produce a better rejection message — never to be
 * accepted. The two halves compounded into a dead read point:
 *
 *   - the spec-valid `aria: { ariaLabel: '…' }` reached the renderer and was
 *     read by nothing (the built-in "Quick actions" default won every time);
 *   - the spelling the renderer honoured is the one an author cannot write
 *     without the contract rejecting the document.
 *
 * `SchemaRenderer`'s generic ARIA channel is no escape hatch here: it reads the
 * FLAT `schema.ariaLabel` off the hoisted node and injects `aria-label` as a
 * component PROP, and this renderer drops every prop that is not a designer key
 * (`splitDesigner` keeps `data-obj-id` / `data-obj-type` / `style` and discards
 * the rest). The nested bag read below is the only live path for an authored
 * name on this surface.
 *
 * The spec half is measured, not asserted from memory — the last case parses
 * both spellings through the installed `AriaPropsSchema` so "the contract
 * refuses `label`" stays a fact this file checks rather than a claim it repeats.
 *
 * ## objectui#4663's back-compat fold is RETIRED (objectui#9945)
 *
 * objectui#4663 also kept `aria.label` readable behind the canonical spelling,
 * for documents written before the contract closed, and this file pinned that
 * fold. Ruling `5749677059` on objectui#9945 (maintainer-approved) superseded
 * that decision for this block. The reason is the standing rule on deprecated
 * aliases: a deprecated alias retires immediately by default, with no staged
 * window, and staging needs named evidence of an external user. No such
 * evidence exists for this spelling. The pin is rewritten, ⛔ not deleted: it
 * now asserts that a served `aria.label` is NOT read, that the toolbar falls
 * back to its built-in name, and that the retirement is reported.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RecordContextProvider } from '@object-ui/react';
import { AriaPropsSchema } from '@objectstack/spec/ui';
import { RecordQuickActionsRenderer } from '../record-quick-actions';

/**
 * One visible action, so the toolbar element (and its `aria-label`) renders at
 * all — with no visible action the bar short-circuits to its dashed placeholder,
 * which carries no toolbar role.
 */
const ACT = { name: 'act', label: 'Act', type: 'script', locations: ['record_header'] };

function mount(aria?: Record<string, unknown>) {
  return render(
    <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
      <RecordQuickActionsRenderer schema={{ actions: [ACT], ...(aria ? { aria } : {}) } as any} />
    </RecordContextProvider>,
  );
}

const toolbarName = () => screen.getByRole('toolbar').getAttribute('aria-label');

afterEach(() => vi.restoreAllMocks());

describe('record:quick_actions — toolbar accessible name (objectui#4663)', () => {
  it('reads the contract spelling `aria.ariaLabel`', () => {
    mount({ ariaLabel: 'Account actions' });
    expect(toolbarName()).toBe('Account actions');
  });

  it('no longer reads the refused `aria.label`: the built-in name wins, and it is reported', () => {
    // This case used to assert the objectui#4663 back-compat fold: a stored
    // document's `aria.label` named the toolbar. objectui#9945 retired the fold
    // under the standing rule that a deprecated alias retires at once unless a
    // named external user needs a staged window (see this file's header).
    // `AriaPropsSchema` refuses the spelling (last case), so nothing newly
    // authored reaches here. A stored document that still carries it now
    // announces the built-in name, and the author is told why, once.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ label: 'Legacy name' });
    expect(toolbarName()).toBe('Quick actions');
    const reports = warn.mock.calls
      .map((args) => String(args[0]))
      .filter((m) => m.includes('record:quick_actions') && m.includes('`aria.label`'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('`aria.ariaLabel`');
  });

  it('reads the canonical spelling when a document carries both', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ ariaLabel: 'Canonical', label: 'Legacy' });
    expect(toolbarName()).toBe('Canonical');
  });

  it('falls back to the built-in name when neither spelling is authored', () => {
    mount();
    expect(toolbarName()).toBe('Quick actions');
  });

  /**
   * Empty-string semantics, pinned because the choice is deliberate
   * (objectui#4663): the built-in default is truthiness-gated, matching
   * `ListView`'s own read point (`schema.aria?.ariaLabel ? {'aria-label': …} : {}`),
   * which treats an empty string as no accessible name at all.
   * `role="toolbar"` needs a name, so the equivalent here is the built-in
   * default rather than ListView's "omit the attribute".
   */
  it('treats an authored empty string as no name — the built-in default wins', () => {
    mount({ ariaLabel: '' });
    expect(toolbarName()).toBe('Quick actions');
    cleanup();

    // …and a stale `label` beside it does not resurface either. Before
    // objectui#9945 the empty canonical value SHADOWED it; now it is not read
    // at all.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({ ariaLabel: '', label: 'Legacy' });
    expect(toolbarName()).toBe('Quick actions');
  });

  it('the platform contract really accepts `ariaLabel` and refuses `label`', () => {
    // The premise the read order above rests on, measured against the installed
    // spec instead of restated. If a future spec ever accepts `label`, this
    // fails and the retirement above (objectui#9945) has to be revisited.
    expect(AriaPropsSchema.safeParse({ ariaLabel: 'Account actions' }).success).toBe(true);

    const legacy = AriaPropsSchema.safeParse({ label: 'Account actions' });
    expect(legacy.success).toBe(false);
    // Asserted as an envelope — the code AND the key it names — so a rejection
    // of something else could not satisfy it.
    expect(legacy.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    expect(
      legacy.error?.issues.flatMap((i) => (i as unknown as { keys?: string[] }).keys ?? []),
    ).toContain('label');
  });
});
