/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7206 — the CONTEXT tail of the record resolution is RETIRED, and the
 * retirement is observable rather than merely declared.
 *
 * `LookupField` and `useCascadingOptions` both resolved the record they gate on
 * as `dependentValues ?? ctx.formValues ?? ctx.data ?? {}`. The last two links
 * never existed: `SchemaRendererContextType` (`@object-ui/react`) declares
 * exactly `dataSource`, `debug`, `debugFlags` and `apiFetch`, and
 * `SchemaRendererProvider` accepts no other prop — so the tail was UNSETTABLE,
 * not merely unset, and three comments in the tree described it as a working
 * "record scope" channel a host could fill. Retired under ADR-0049
 * enforce-or-remove; maintainer ruling 2026-09-18 (letter C). The host supplies
 * the record on `dependentValues`, and a host that does not fails VISIBLY — a
 * gated picker, a gated option list — which is the failure the ruling chose
 * over a documented fallback that never fired.
 *
 * ## Why this file exists, when nothing observable changed in production
 *
 * Exactly so. No host could set those members, so no production surface moves —
 * which is precisely what makes the retirement invisible to every existing
 * behavioural test, and what would let a later author re-add the tail with the
 * whole suite green. Reaching the retired links at all takes a CAST onto the
 * context value, and that is what each SUBJECT below renders: the members
 * spelled the way the deleted reads spelled them.
 *
 * ## The shape of each assertion: a live control on every zero
 *
 * Every "the context does nothing" assertion is paired with the SAME record
 * moved onto `dependentValues`, asserted to still do the thing. Without that
 * pair a zero here is equally satisfied by a harness that gates everything, or
 * narrows nothing — rather than by the retirement.
 *
 * ⛔ The pins are keyed on the READ, never on the identifier: both widgets'
 * comments still NAME `ctx.formValues` / `ctx.data` to say they are gone, so a
 * source-text assertion on those spellings would pass with the reads restored.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SchemaRendererContext } from '@object-ui/react';
import { LookupField } from './LookupField';
import { RadioField } from './RadioField';

/**
 * A context value carrying the two members the retired tail read, spelled the
 * way it spelled them. `as never` is the cast the deleted reads needed: the
 * declared type admits neither key, which is the whole finding.
 */
function withRetiredContext(node: ReactNode, record: Record<string, unknown>) {
  return (
    <SchemaRendererContext.Provider
      value={{ dataSource: null, formValues: record, data: record } as never}
    >
      {node}
    </SchemaRendererContext.Provider>
  );
}

const contacts = [{ id: 'c1', name: 'Nora Field', account: 'a1' }];

function makeDataSource() {
  const find = vi.fn(async () => ({ data: contacts, total: contacts.length }));
  return { find } as unknown as { find: ReturnType<typeof vi.fn> };
}

const lookupField = {
  name: 'contact',
  label: 'Contact',
  reference: 'contacts',
  reference_field: 'name',
  dependsOn: ['account'],
} as any;

function renderLookup(props: Record<string, unknown>, ctxRecord?: Record<string, unknown>) {
  const node = (
    <LookupField
      field={lookupField}
      value={undefined}
      onChange={vi.fn()}
      readonly={false}
      dataSource={makeDataSource() as any}
      {...(props as any)}
    />
  );
  render(ctxRecord ? withRetiredContext(node, ctxRecord) : node);
}

/** `dependsOn` + a per-option `visibleWhen`: the `useCascadingOptions` half. */
const provinceField = {
  name: 'province',
  type: 'radio',
  dependsOn: 'country',
  options: [
    { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
    { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
  ],
} as any;

function renderRadio(props: Record<string, unknown>, ctxRecord?: Record<string, unknown>) {
  const node = (
    <RadioField value={undefined} onChange={vi.fn()} field={provinceField} {...({ name: 'province', ...props } as any)} />
  );
  render(ctxRecord ? withRetiredContext(node, ctxRecord) : node);
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
});

afterEach(cleanup);

describe('objectui#7206 — `LookupField` reads no record off `SchemaRendererContext`', () => {
  it('stays GATED although the context carries `formValues` and `data`, and the prop still ungates it', () => {
    // SUBJECT: the parent value is on the context under BOTH retired spellings
    // and under no other channel. The picker gates anyway — the visible failure
    // the ruling chose.
    renderLookup({}, { account: 'a1' });
    const gated = screen.getByTestId('lookup-trigger-gated');
    expect(gated).toBeDisabled();
    expect(gated).toHaveTextContent(/select account first/i);

    // CONTROL: the same record, same widget, moved to the surviving channel.
    // It ungates — so the gate above is the retirement, not a harness that
    // gates everything.
    cleanup();
    renderLookup({ dependentValues: { account: 'a1' } });
    expect(screen.queryByTestId('lookup-trigger-gated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /select/i })).not.toBeDisabled();
  });
});

describe('objectui#7206 — `useCascadingOptions` reads no record off `SchemaRendererContext`', () => {
  it('keeps an option list GATED although the context carries the parent value', () => {
    renderRadio({}, { country: 'cn' });
    expect(screen.getByTestId('radio-empty-province')).toHaveTextContent(/select country first/i);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);

    // CONTROL: the identical record on `dependentValues` unlocks the list and
    // narrows it to the `cn` option.
    cleanup();
    renderRadio({ dependentValues: { country: 'cn' } });
    expect(screen.queryByTestId('radio-empty-province')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Zhejiang' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'California' })).not.toBeInTheDocument();
  });

  it('PRECEDENCE, not retirement: the host record decides which option is offered', () => {
    // ⚠️ Measured under ablation and recorded rather than implied: restoring the
    // retired tail does NOT turn this case red, because a supplied
    // `dependentValues` won that chain outright anyway. So this is the
    // precedence fact, not the retirement fact — the two cases above are the
    // ones that fail when the tail comes back, and this one holds either way.
    // It stays because precedence is what a host reasons about when it decides
    // WHICH record to pass: `cn` on the prop, `us` on the retired members, and
    // the offered option follows the prop.
    renderRadio({ dependentValues: { country: 'cn' } }, { country: 'us' });
    expect(screen.getByRole('radio', { name: 'Zhejiang' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'California' })).not.toBeInTheDocument();

    // CONTROL: the prop, and only the prop, decides which option is offered.
    cleanup();
    renderRadio({ dependentValues: { country: 'us' } }, { country: 'cn' });
    expect(screen.getByRole('radio', { name: 'California' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Zhejiang' })).not.toBeInTheDocument();
  });
});
