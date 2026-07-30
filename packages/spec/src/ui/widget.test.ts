import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldWidgetPropsSchema, type FieldWidgetProps } from './widget.zod';
import { WidgetManifestSchema, type WidgetManifest } from './widget.zod';
import { Field } from '../data/field.zod';

describe('FieldWidgetPropsSchema', () => {
  describe('Valid Widget Props', () => {
    it('should accept minimal valid widget props', () => {
      const props: FieldWidgetProps = {
        value: 'test value',
        onChange: () => {},
        field: {
          name: 'test_field',
          type: 'text',
        },
      };

      const result = FieldWidgetPropsSchema.safeParse(props);
      expect(result.success).toBe(true);
    });

    it('should accept complete widget props', () => {
      const props: FieldWidgetProps = {
        value: 'John Doe',
        onChange: (newValue: any) => console.log(newValue),
        readonly: false,
        required: true,
        error: 'This field is required',
        field: {
          name: 'full_name',
          label: 'Full Name',
          type: 'text',
          maxLength: 100,
          required: true,
        },
        record: {
          id: '123',
          full_name: 'John Doe',
          email: 'john@example.com',
        },
        options: {
          theme: 'dark',
          placeholder: 'Enter your name',
        },
      };

      const result = FieldWidgetPropsSchema.safeParse(props);
      expect(result.success).toBe(true);
    });

    it('should apply default values for readonly and required', () => {
      const props = {
        value: 42,
        onChange: () => {},
        field: {
          name: 'count',
          type: 'number',
        },
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.readonly).toBe(false);
      expect(result.required).toBe(false);
    });
  });

  describe('Different Value Types', () => {
    it('should accept string value', () => {
      const props = {
        value: 'text value',
        onChange: () => {},
        field: Field.text(),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept number value', () => {
      const props = {
        value: 42,
        onChange: () => {},
        field: Field.number(),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept boolean value', () => {
      const props = {
        value: true,
        onChange: () => {},
        field: Field.boolean(),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept array value for multiple fields', () => {
      const props = {
        value: ['option1', 'option2'],
        onChange: () => {},
        field: {
          type: 'select',
          multiple: true,
          options: [
            { label: 'Option 1', value: 'option1' },
            { label: 'Option 2', value: 'option2' },
          ],
        },
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept object value', () => {
      const props = {
        value: { id: '123', name: 'Test' },
        onChange: () => {},
        field: Field.lookup('account'),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept null value', () => {
      const props = {
        value: null,
        onChange: () => {},
        field: Field.text(),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });

    it('should accept undefined value', () => {
      const props = {
        value: undefined,
        onChange: () => {},
        field: Field.text(),
      };

      expect(() => FieldWidgetPropsSchema.parse(props)).not.toThrow();
    });
  });

  describe('Field Definition', () => {
    it('should accept text field definition', () => {
      const props = {
        value: 'test',
        onChange: () => {},
        field: Field.text({ label: 'Name', maxLength: 50 }),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.field.type).toBe('text');
      expect(result.field.label).toBe('Name');
      expect(result.field.maxLength).toBe(50);
    });

    it('should accept select field definition with options', () => {
      const props = {
        value: 'high',
        onChange: () => {},
        field: Field.select({
          label: 'Priority',
          options: [
            { label: 'High', value: 'high' },
            { label: 'Low', value: 'low' },
          ],
        }),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.field.type).toBe('select');
      expect(result.field.options).toHaveLength(2);
    });

    it('should accept lookup field definition', () => {
      const props = {
        value: { id: 'acc123', name: 'Acme Corp' },
        onChange: () => {},
        field: Field.lookup('account', { 
          label: 'Account',
        }),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.field.type).toBe('lookup');
      expect(result.field.reference).toBe('account');
    });
  });

  describe('Widget States', () => {
    it('should accept readonly state', () => {
      const props = {
        value: 'readonly value',
        onChange: () => {},
        readonly: true,
        field: Field.text(),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.readonly).toBe(true);
    });

    it('should accept required state', () => {
      const props = {
        value: '',
        onChange: () => {},
        required: true,
        field: Field.text({ required: true }),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.required).toBe(true);
    });

    it('should accept error message', () => {
      const props = {
        value: '',
        onChange: () => {},
        required: true,
        error: 'This field is required',
        field: Field.text({ required: true }),
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.error).toBe('This field is required');
    });
  });

  describe('Record Context', () => {
    it('should accept record context for cross-field logic', () => {
      const props = {
        value: 'john@example.com',
        onChange: () => {},
        field: Field.email({ label: 'Email' }),
        record: {
          id: 'contact123',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          account_id: 'acc123',
        },
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.record).toBeDefined();
      expect(result.record?.id).toBe('contact123');
      expect(result.record?.first_name).toBe('John');
    });
  });

  describe('Custom Options', () => {
    it('should accept custom widget options', () => {
      const props = {
        value: '2024-01-20',
        onChange: () => {},
        field: Field.date({ label: 'Birth Date' }),
        options: {
          format: 'YYYY-MM-DD',
          minDate: '1900-01-01',
          maxDate: '2024-12-31',
          showCalendar: true,
        },
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.options).toBeDefined();
      expect(result.options?.format).toBe('YYYY-MM-DD');
      expect(result.options?.showCalendar).toBe(true);
    });

    it('should accept nested custom options', () => {
      const props = {
        value: 'rich text',
        onChange: () => {},
        field: Field.html({ label: 'Content' }),
        options: {
          editor: {
            toolbar: ['bold', 'italic', 'link'],
            plugins: ['autolink', 'lists'],
          },
          maxHeight: 400,
        },
      };

      const result = FieldWidgetPropsSchema.parse(props);
      expect(result.options?.editor).toBeDefined();
      expect(result.options?.editor.toolbar).toContain('bold');
    });
  });

  describe('Required Fields Validation', () => {
    it('should accept props with all required fields', () => {
      const props = {
        value: 'test',
        onChange: () => {},
        field: Field.text(),
      };

      const result = FieldWidgetPropsSchema.safeParse(props);
      expect(result.success).toBe(true);
    });

    it('should require onChange function', () => {
      const props = {
        value: 'test',
        onChange: 'not a function', // Invalid type
        field: Field.text(),
      };

      const result = FieldWidgetPropsSchema.safeParse(props);
      expect(result.success).toBe(false);
    });

    it('should require field definition with valid structure', () => {
      const props = {
        value: 'test',
        onChange: () => {},
        field: 'not an object', // Invalid type
      };

      const result = FieldWidgetPropsSchema.safeParse(props);
      expect(result.success).toBe(false);
    });
  });
});

describe('Widget I18n Integration', () => {
  it('should reject i18n object as widget manifest label', () => {
    expect(() => WidgetManifestSchema.parse({
      name: 'i18n_widget',
      label: { key: 'widgets.date_picker', defaultValue: 'Date Picker' },
    })).toThrow();
  });
  it('should reject i18n as widget description', () => {
    expect(() => WidgetManifestSchema.parse({
      name: 'desc_widget',
      label: 'Test Widget',
      description: { key: 'widgets.test.desc', defaultValue: 'A test widget' },
    })).toThrow();
  });
});

describe('Widget ARIA Integration', () => {
  it('should accept widget manifest with ARIA attributes', () => {
    expect(() => WidgetManifestSchema.parse({
      name: 'accessible_widget',
      label: 'Accessible Widget',
      aria: { ariaLabel: 'Custom date picker widget', role: 'widget' },
    })).not.toThrow();
  });
});

describe('Widget — retired performance (#3896 close-out)', () => {
  it('REJECTS the retired `performance` and names the live alternative', () => {
    let message = '';
    try {
      WidgetManifestSchema.parse({
        name: 'perf_widget', label: 'Performance Widget', performance: { lazyLoad: true },
      });
    } catch (e) { message = String((e as Error).message); }
    expect(message).toMatch(/virtualScroll/);
    expect(message).toMatch(/#3896/);
  });
});
