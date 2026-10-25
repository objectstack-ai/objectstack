/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Retirement pin — the field type `owner` and the widget key `field:owner`
 * (objectui#4814, ruling A′, ADR-0049 enforce-or-remove).
 *
 * What makes this retirement different from `capability-multiselect`'s (whose
 * pin lives next door) is WHERE the retired name used to be reachable from.
 * `capability-multiselect` was a `widget:` hint that had never been registered
 * on the live path, so its retirement is proved by absence: the registry does
 * not answer, and nothing else could have.
 *
 * `owner` was a real, live field TYPE. Deleting it alone would have been
 * answered by two silent tails — `mapFieldTypeToFormType`'s `|| 'field:text'`
 * and `resolveFormWidgetType`'s `: 'text'` — each of which hands back a working
 * plain text input. No gate in this repo turns red on that: `FORM_WIDGET_TYPES`
 * in `field-type-coverage.test.ts` never listed `owner` (or `user`), and the
 * catalog's hosted test only asserts that a form and a `[data-field]` exist,
 * which a TextField satisfies. So an author — or an AI author copying
 * `type: 'owner'` out of a doc — would have shipped a text box believing they
 * had shipped a person picker, with every check green.
 *
 * Therefore these assertions are about LOUDNESS, not absence, and they are
 * written against the refusal's SHAPE rather than against "it is not a
 * UserField": a test that only asserted the latter would pass just as happily
 * against the silent text-box regression this card exists to prevent.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';

import {
  registerAllFields,
  FORM_FIELD_TYPES,
  RetiredFieldTombstone,
  RETIRED_FIELD_TYPES,
  resetRetiredFieldTypeReports,
  mapFieldTypeToFormType,
  resolveFormWidgetType,
  getCellRenderer,
  TextCellRenderer,
} from '../index';

const RETIRED = 'owner';
const SURVIVOR = 'user';

beforeEach(() => {
  resetRetiredFieldTypeReports();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('`owner` field-type retirement (objectui#4814)', () => {
  describe('the form path refuses loudly instead of degrading to a text box', () => {
    it('does NOT resolve the retired type to the field:text fallback', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // The whole point of the tombstone: `field:text` here is the regression.
      expect(mapFieldTypeToFormType(RETIRED)).not.toBe('field:text');
      expect(mapFieldTypeToFormType(RETIRED)).toBe(`field:${RETIRED}`);
    });

    it('does NOT resolve the retired widget key to the `text` widget', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(resolveFormWidgetType(RETIRED)).not.toBe('text');
      expect(resolveFormWidgetType(RETIRED)).toBe(RETIRED);
    });

    it('logs a prescription naming the migration, not a bare "unknown type"', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      mapFieldTypeToFormType(RETIRED);

      const said = error.mock.calls.map((c) => String(c[0])).join('\n');
      // The message must be actionable on its own — this is the text an agent
      // or a developer will follow, so its content is the contract.
      expect(said).toContain('`owner`');
      expect(said).toContain('RETIRED');
      expect(said).toContain("{ type: 'user', name: 'owner' }");
      expect(said).toContain('objectui#4814');
    });

    it('reports once per spelling, so a rendered list cannot bury the message', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let i = 0; i < 50; i++) mapFieldTypeToFormType(RETIRED);

      const retiredMessages = error.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('objectui#4814'));
      expect(retiredMessages).toHaveLength(1);
    });

    it('is not a renderable field type any more', () => {
      expect(FORM_FIELD_TYPES).not.toContain(RETIRED);
      // …and the survivor is untouched, so this is a subtraction of exactly one.
      expect(FORM_FIELD_TYPES).toContain(SURVIVOR);
    });
  });

  describe('both authored spellings land on the visible refusal', () => {
    it('registers the tombstone under `field:owner`, so `widget: "field:owner"` reaches it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      registerAllFields();
      // This is the exact lookup `form.tsx`'s `renderFieldComponent` performs
      // for BOTH `widget: 'field:owner'` and a hand-written `type: 'owner'`.
      // The entry is the tombstone BOUND to its spelling (objectui#10471), so
      // it is judged by what it renders rather than by identity.
      const Registered = ComponentRegistry.get(`field:${RETIRED}`)!;
      render(<Registered field={{ type: RETIRED }} />);
      expect(
        screen.getByTestId('field-retired-tombstone').getAttribute('data-retired-field-type'),
      ).toBe(RETIRED);
    });

    it('does not claim the bare `owner` global name', () => {
      registerAllFields();
      expect(ComponentRegistry.get(RETIRED)).toBeUndefined();
    });

    it('renders an alert carrying the prescription, not an input', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<RetiredFieldTombstone field={{ type: RETIRED, name: 'record_owner' }} />);

      const alert = screen.getByTestId('field-retired-tombstone');
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain("{ type: 'user', name: 'owner' }");
      // A refusal, not a control the author could mistake for a working field.
      expect(document.body.querySelector('input')).toBeNull();
    });

    it('names the offending spelling on the element, for a host that inspects it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<RetiredFieldTombstone field={{ type: RETIRED }} />);
      expect(
        screen.getByTestId('field-retired-tombstone').getAttribute('data-retired-field-type'),
      ).toBe(RETIRED);
    });
  });

  describe('the read/cell path', () => {
    it('degrades to the text cell but says so', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const renderer = getCellRenderer(RETIRED);

      expect(renderer).toBe(TextCellRenderer);
      const said = error.mock.calls.map((c) => String(c[0])).join('\n');
      expect(said).toContain('objectui#4814');
    });
  });

  describe('the `user` path is untouched', () => {
    it('still maps, resolves and renders as the person picker', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      registerAllFields();

      expect(mapFieldTypeToFormType(SURVIVOR)).toBe(`field:${SURVIVOR}`);
      expect(resolveFormWidgetType(SURVIVOR)).toBe(SURVIVOR);
      expect(ComponentRegistry.get(`field:${SURVIVOR}`)).toBeTruthy();
      expect(ComponentRegistry.get(`field:${SURVIVOR}`)).not.toBe(ComponentRegistry.get(`field:${RETIRED}`));
      expect(getCellRenderer(SURVIVOR)).not.toBe(TextCellRenderer);

      // Nothing about a live type may reach the retirement machinery.
      expect(error.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('objectui#4814');
    });

    it('leaves a genuinely unknown type on the quiet text fallback', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Retirement is a NAMED disposition, not a new blanket noise source: an
      // unknown type keeps the pre-existing silent fallback.
      expect(mapFieldTypeToFormType('something-unknown')).toBe('field:text');
      expect(error).not.toHaveBeenCalled();
    });
  });

  it('carries exactly the retired vocabulary it claims to', () => {
    // Guards the table itself: growing it is a decision, never a side effect.
    expect(Object.keys(RETIRED_FIELD_TYPES)).toEqual([RETIRED]);
  });
});
