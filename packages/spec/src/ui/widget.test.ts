import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { FieldWidgetPropsSchema, type FieldWidgetProps } from './widget.zod';
import { Field } from '../data/field.zod';
import { measureDoors } from './door-reachability.testkit';
import { PageSchema } from './page.zod';
import { ObjectListViewSchema } from './view.zod';

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

// ============================================================================
// #5055 — what is LEFT of this file, and why it is left.
//
// 批 16 measured nine sites here and #5055 disposed of them under ADR-0049:
// eight were REMOVED (`WidgetManifest`, `WidgetLifecycle`, `WidgetEvent`,
// `WidgetProperty`, `WidgetSource` with its three union branches) and one —
// `FieldWidgetProps` — was KEPT.
//
// The keep is the part that needs a pin, because the removal took the other
// eight with it and a later sweep "finishing widget.zod.ts" is exactly the shape
// that would take the ninth too. It must not, and the reason is not that this
// shape is more reachable — it is `unreachable` like the others were:
//
//   - It is not authorable metadata at all. It never appeared in
//     `authorable-surface/` or `json-schema.manifest/` (its `onChange` is a
//     `z.function()`, so no JSON Schema is emitted), so ADR-0049's question
//     about a declared-but-unenforced AUTHORABLE key never applied to it.
//   - It is a React props contract, and a props contract is enforced by `tsc` in
//     the implementing repo, not by a `.parse()` here. "Zero parse" is its
//     design.
//   - It has a live cross-repo reader, added the day before 批 16 measured:
//     objectui PR #3289 (2026-08-03) renamed `@object-ui/fields`' validation
//     slot onto the spec's `error` with no alias and made the form renderer
//     produce it, and `packages/fields/src/__tests__/spec-symbol-batch7.test.ts`
//     pins `HasKey<SpecFieldWidgetProps, 'error'>` against
//     `import type { FieldWidgetProps } from '@objectstack/spec/ui'` — a
//     deliberate tripwire: "the day the spec stops exporting `FieldWidgetProps`,
//     this file stops compiling and the rename's reason is up for re-triage".
//
// So the door measurement below is kept for the surviving shape (an unreachable
// verdict is still the truth about it, and the controls keep the walker honest),
// but `unreachable` is NOT the retirement trigger for this one. Re-measure the
// objectui consumer before touching it.
// ============================================================================
describe('#5055 — the one surviving shape, and the eight that left', () => {
  it('FieldWidgetPropsSchema is still unreachable — and that is not a reason to retire it', () => {
    const { verdict, nodeCount, rootCount } = measureDoors();

    // Controls FIRST, in the same run. An empty result and a broken walker
    // produce the same output, and only these tell them apart.
    expect(rootCount, 'roots must include every metadata type plus ObjectStackSchema').toBeGreaterThan(20);
    expect(nodeCount, 'the graph must actually have been walked').toBeGreaterThan(1000);
    expect(verdict(PageSchema), 'positive control').toBe('direct');
    expect(verdict(ObjectListViewSchema), 'positive control').toBe('direct');
    expect(verdict(z.object({ a: z.string() })), 'negative control').toBe('unreachable');

    expect(verdict(FieldWidgetPropsSchema), 'a props contract has no authoring door, by design').toBe('unreachable');
  });

  it('a synthetic carrier flips it — the verdict is the graph, not the walker', () => {
    const carrier = z.object({ props: FieldWidgetPropsSchema });
    const { verdict } = measureDoors([carrier]);
    expect(verdict(FieldWidgetPropsSchema)).toBe('direct');
  });

  it('the shape still accepts its own vocabulary — this pins "open", not "broken"', () => {
    const ok = FieldWidgetPropsSchema.safeParse({
      value: 'x',
      onChange: () => {},
      field: { name: 'f', type: 'text' },
      notAPropsKey: 1,
    });
    expect(ok.success).toBe(true);
  });
});
