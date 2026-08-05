import { describe, it, expect, expectTypeOf } from 'vitest';
import type { StrictObjectTranslation } from './translation-typegen';

// ────────────────────────────────────────────────────────────────────────────
// Test fixtures — minimal object shapes that mimic ObjectSchema.create() output
// ────────────────────────────────────────────────────────────────────────────

const SimpleObject = {
  fields: {
    name: { type: 'text' as const, label: 'Name' },
    email: { type: 'email' as const, label: 'Email' },
  },
};

const ObjectWithSelect = {
  fields: {
    title: { type: 'text' as const, label: 'Title' },
    status: {
      type: 'select' as const,
      label: 'Status',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Closed', value: 'closed' },
      ] as const,
    },
    priority: {
      type: 'select' as const,
      label: 'Priority',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'High', value: 'high' },
      ] as const,
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Type-level tests
// ────────────────────────────────────────────────────────────────────────────

describe('StrictObjectTranslation', () => {

  it('should require label at object level', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    expectTypeOf<T>().toHaveProperty('label');
    expectTypeOf<T['label']>().toBeString();
  });

  it('should make pluralLabel optional', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    expectTypeOf<T>().toHaveProperty('pluralLabel');
  });

  it('should require all field keys', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    type FieldKeys = keyof T['fields'];
    expectTypeOf<FieldKeys>().toEqualTypeOf<'name' | 'email'>();
  });

  it('should require label on non-select fields', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    expectTypeOf<T['fields']['name']>().toHaveProperty('label');
    expectTypeOf<T['fields']['name']['label']>().toBeString();
  });

  it('should require options map on select fields', () => {
    type T = StrictObjectTranslation<typeof ObjectWithSelect>;
    expectTypeOf<T['fields']['status']>().toHaveProperty('options');
  });

  it('should require all option values as keys in options map', () => {
    type T = StrictObjectTranslation<typeof ObjectWithSelect>;
    type StatusOptions = keyof T['fields']['status']['options'];
    expectTypeOf<StatusOptions>().toEqualTypeOf<'open' | 'closed'>();

    type PriorityOptions = keyof T['fields']['priority']['options'];
    expectTypeOf<PriorityOptions>().toEqualTypeOf<'low' | 'high'>();
  });

  it('should accept a valid complete translation', () => {
    type T = StrictObjectTranslation<typeof ObjectWithSelect>;
    const valid: T = {
      label: 'Test',
      fields: {
        title: { label: 'Title' },
        status: {
          label: 'Status',
          options: { open: 'Open', closed: 'Closed' },
        },
        priority: {
          label: 'Priority',
          options: { low: 'Low', high: 'High' },
        },
      },
    };
    expect(valid.label).toBe('Test');
    expect(valid.fields.status.options.open).toBe('Open');
  });

  it('should report TS error when a field is missing', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    const _invalid: T = {
      label: 'Test',
      // The directive sits on the OFFENDING property, not on the declaration:
      // TS2741 ("Property 'email' is missing") is reported at `fields`, so a
      // directive three lines up suppressed nothing and was itself unused
      // (TS2578). Invisible until #5286 put this file in front of tsc.
      // @ts-expect-error — missing 'email' field
      fields: {
        name: { label: 'Name' },
      },
    };
    expect(_invalid).toBeDefined();
  });

  it('should report TS error when an extra field is present', () => {
    type T = StrictObjectTranslation<typeof SimpleObject>;
    const _invalid: T = {
      label: 'Test',
      fields: {
        name: { label: 'Name' },
        email: { label: 'Email' },
        // @ts-expect-error — 'ghost' does not exist in source fields
        ghost: { label: 'Ghost' },
      },
    };
    expect(_invalid).toBeDefined();
  });

  it('should report TS error when an option is missing', () => {
    type T = StrictObjectTranslation<typeof ObjectWithSelect>;
    const _invalid: T = {
      label: 'Test',
      fields: {
        title: { label: 'Title' },
        status: {
          label: 'Status',
          // Same mispositioning as above: the missing-option error lands on
          // `options`, not on the declaration line (#5286).
          // @ts-expect-error — missing 'closed' option
          options: { open: 'Open' },
        },
        priority: {
          label: 'Priority',
          options: { low: 'Low', high: 'High' },
        },
      },
    };
    expect(_invalid).toBeDefined();
  });
});
