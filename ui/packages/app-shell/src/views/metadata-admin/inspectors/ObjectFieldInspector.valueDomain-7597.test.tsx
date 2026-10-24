// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7597 — the Object Field inspector authors `valueDomain` on the field
 * types the spec admits it on, and on no other.
 *
 * `FieldSchema.valueDomain` (ruling A on objectstack#14168) names the standard a
 * written value must belong to: `iana_time_zone`, `iso_4217_currency` or
 * `iso_3166_alpha2`. The inspector is a hand-written key list, so the key had no
 * control and a Studio author could not declare it at all.
 *
 * The card's three delivery details are each pinned here, against the INSTALLED
 * spec rather than against literals copied out of it:
 *
 *   1. Shown only for a type in `VALUE_DOMAIN_FIELD_TYPES` — checked across
 *      EVERY member of the spec's `FieldType`, both directions, so a control
 *      that leaks onto one more type and a control that never renders both fail.
 *   2. The members are labelled from the spec's `describe()` prose, not from a
 *      table in this repo. Each option's gloss must be a span of that prose, so
 *      a hand-written copy goes red the first time the spec rewrites a gloss,
 *      while the derivation follows it.
 *   3. Unset DELETES the key. The assertion is the key's absence (`in`), not a
 *      falsy value: `FieldSchema` refuses `valueDomain: null` and
 *      `valueDomain: ''` alike, so a select that writes its empty value would
 *      turn a legal field into a 422.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldSchema, FieldType, VALUE_DOMAIN_FIELD_TYPES } from '@objectstack/spec/data';
import { ValueDomainSchema } from '@objectstack/spec/shared';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

beforeAll(() => {
  // Radix Select drives its trigger through the pointer-capture API, which the
  // DOM environment does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!Element.prototype[m]) {
      // @ts-expect-error test shim
      Element.prototype[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

const MEMBERS = ValueDomainSchema.options;
const PROSE = FieldSchema.shape.valueDomain.description ?? '';

function renderField(
  def: Record<string, unknown>,
  opts: { locale?: 'en-US' | 'zh-CN'; readOnly?: boolean } = {},
) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields: { code: def } }}
      selection={{ kind: 'field', id: 'code' }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={opts.readOnly ?? false}
      locale={opts.locale ?? 'en-US'}
    />,
  );
  /** The field definition the host's Save would persist after the last edit. */
  const saved = () =>
    (onPatch.mock.calls.at(-1)![0].fields as Record<string, Record<string, unknown>>).code;
  return { onPatch, saved };
}

const valueDomainControl = () => screen.queryByRole('combobox', { name: 'Value domain' });

async function openValueDomain() {
  const trigger = valueDomainControl();
  expect(trigger, 'the Value domain select is rendered').not.toBeNull();
  await userEvent.click(trigger as HTMLElement);
  return screen.findAllByRole('option');
}

describe('ObjectFieldInspector · `valueDomain` (objectui#7597)', () => {
  it('the spec this suite reads still declares a non-empty vocabulary and applicability set', () => {
    // Guard against a vacuous pass: every assertion below iterates these.
    expect(MEMBERS.length).toBeGreaterThan(0);
    expect(VALUE_DOMAIN_FIELD_TYPES.size).toBeGreaterThan(0);
    expect(PROSE.length).toBeGreaterThan(0);
  });

  describe('1 · shown exactly for the types in `VALUE_DOMAIN_FIELD_TYPES`', () => {
    it.each(FieldType.options.map((t) => [t, VALUE_DOMAIN_FIELD_TYPES.has(t)] as const))(
      '%s → control rendered: %s',
      (type, expected) => {
        renderField({ type, label: 'Code' });
        expect(valueDomainControl() !== null).toBe(expected);
      },
    );

    it('the control is labelled in the designer locale', () => {
      renderField({ type: 'text', label: 'Code' }, { locale: 'zh-CN' });
      expect(screen.queryByRole('combobox', { name: '值域' })).not.toBeNull();
    });

    it('is disabled when the inspector is read-only', () => {
      renderField({ type: 'text', label: 'Code' }, { readOnly: true });
      expect(valueDomainControl()).toBeDisabled();
    });
  });

  describe('2 · the members are labelled from the spec\'s describe() prose', () => {
    it('offers the unset row plus every member of the spec\'s vocabulary, in the spec\'s order', async () => {
      renderField({ type: 'text', label: 'Code' });
      const names = (await openValueDomain()).map((o) => o.textContent ?? '');
      expect(names[0]).toBe('— None —');
      expect(names.slice(1).map((n) => n.split(' (')[0])).toEqual([...MEMBERS]);
    });

    it('each member\'s gloss is a span of the installed spec\'s prose, never the bare member id', async () => {
      renderField({ type: 'text', label: 'Code' });
      const names = (await openValueDomain()).map((o) => o.textContent ?? '').slice(1);
      const plainProse = PROSE.replace(/`/g, '');
      for (const [i, member] of MEMBERS.entries()) {
        const name = names[i];
        expect(name.startsWith(`${member} (`), `${member} carries a gloss`).toBe(true);
        expect(name.endsWith(')')).toBe(true);
        const gloss = name.slice(member.length + 2, -1);
        expect(gloss.length, `${member}'s gloss is non-empty`).toBeGreaterThan(0);
        expect(plainProse.includes(gloss), `${member}'s gloss is read from the spec`).toBe(true);
      }
    });

    it('shows a stored member on the trigger', () => {
      renderField({ type: 'text', label: 'Code', valueDomain: 'iso_4217_currency' });
      expect(valueDomainControl()!.textContent).toContain('iso_4217_currency (');
    });
  });

  describe('3 · set writes the member; unset deletes the key', () => {
    it.each(MEMBERS.map((m) => [m]))('choosing %s writes it, and the spec accepts the field', async (member) => {
      const { saved } = renderField({ type: 'text', label: 'Code' });
      const options = await openValueDomain();
      await userEvent.click(options.find((o) => (o.textContent ?? '').startsWith(`${member} (`))!);

      const def = saved();
      expect(def.valueDomain).toBe(member);
      expect(def.label).toBe('Code');
      expect(FieldSchema.safeParse(def).success).toBe(true);
    });

    it('choosing the unset row removes `valueDomain` from the field — absent, not null', async () => {
      const { saved } = renderField({ type: 'text', label: 'Code', valueDomain: 'iso_3166_alpha2' });
      const options = await openValueDomain();
      await userEvent.click(options[0]);

      const def = saved();
      expect('valueDomain' in def).toBe(false);
      // The rest of the field survives the removal.
      expect(def).toEqual({ type: 'text', label: 'Code' });
      expect(FieldSchema.safeParse(def).success).toBe(true);
    });

    it('the spec refuses the two values an unset select could otherwise write (premise)', () => {
      // Why (3) asserts absence: both "empty" spellings are refused outright.
      expect(FieldSchema.safeParse({ type: 'text', label: 'Code', valueDomain: null }).success).toBe(false);
      expect(FieldSchema.safeParse({ type: 'text', label: 'Code', valueDomain: '' }).success).toBe(false);
    });
  });
});
