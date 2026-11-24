/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0157 D7 — a create form opens a REQUIRED `iana_time_zone` text field
 * that declares no default on the organization's time zone, the zone the
 * server gives a create that leaves the field out. An optional zone field
 * (blank means "take the parent's") is never seeded; the author's
 * `defaultValue` and the caller's record win; an unknown zone seeds nothing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { LocalizationProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { schemaDefaultValues, seedCreateValues } from '../schemaDefaults';
import { ModalForm } from '../ModalForm';
import { ObjectForm } from '../ObjectForm';

registerAllFields();
afterEach(cleanup);

// The shape of the working-calendar object's `timezone`, plus an optional
// zone field shaped like a business unit's.
const CALENDAR = {
  name: 'zone_calendar',
  fields: {
    name: { type: 'text', label: 'Name', required: true },
    timezone: { type: 'text', label: 'Time Zone', required: true, maxLength: 64, valueDomain: 'iana_time_zone' },
    unit_zone: { type: 'text', label: 'Unit zone', required: false, valueDomain: 'iana_time_zone' },
  },
};

describe('create-form seeding of a required time-zone field (ADR-0157 D7)', () => {
  it('pre-fills the required zone field with the organization time zone, and only that field', () => {
    expect(schemaDefaultValues(CALENDAR, { homeTimeZone: 'Asia/Shanghai' })).toEqual({ timezone: 'Asia/Shanghai' });
  });

  it('seeds nothing while the organization time zone is unknown', () => {
    expect(schemaDefaultValues(CALENDAR, { homeTimeZone: undefined })).toEqual({});
    expect(schemaDefaultValues(CALENDAR)).toEqual({});
  });

  it("the author's defaultValue wins", () => {
    const schema = { fields: { ...CALENDAR.fields, timezone: { ...CALENDAR.fields.timezone, defaultValue: 'UTC' } } };
    expect(schemaDefaultValues(schema, { homeTimeZone: 'Asia/Shanghai' }).timezone).toBe('UTC');
  });

  it("the caller's record wins", () => {
    expect(seedCreateValues(CALENDAR, { timezone: 'Europe/Paris' }, { homeTimeZone: 'Asia/Shanghai' }).timezone).toBe('Europe/Paris');
  });
});

describe('the create form opens on the organization time zone (ADR-0157 D7)', () => {
  const ds = { getObjectSchema: async () => CALENDAR, create: async (_o: string, d: unknown) => d };

  for (const host of ['modal', 'inline'] as const) {
    it(`${host}: the Time Zone input holds the zone the localization context carries`, async () => {
      const base = { type: 'object-form', objectName: 'zone_calendar', mode: 'create' } as any;
      const form = host === 'modal'
        ? <ModalForm schema={{ ...base, formType: 'modal', open: true }} dataSource={ds as any} />
        : <ObjectForm schema={base} dataSource={ds as any} />;
      render(<LocalizationProvider value={{ locale: 'en-US', timezone: 'Asia/Shanghai' }}>{form}</LocalizationProvider>);
      await waitFor(() => {
        const input = document.querySelector('[data-field="timezone"] input') as HTMLInputElement | null;
        if (!input) throw new Error('form not ready');
        expect(input.value).toBe('Asia/Shanghai');
      }, { timeout: 5000 });
      const unit = document.querySelector('[data-field="unit_zone"] input') as HTMLInputElement | null;
      expect(unit?.value ?? '').toBe('');
    });
  }
});
