import { describe, it, expect } from 'vitest';
import * as builder from '../../builder/schema-builder';
import { form, button, input, card, grid, flex } from '../../builder/schema-builder';
import { StrictAnyComponentSchema, safeValidateSchema } from '@object-ui/types/zod';

describe('SchemaBuilder', () => {
  describe('form()', () => {
    it('creates a basic form schema', () => {
      const schema = form().id('test-form').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('form');
      expect(schema.id).toBe('test-form');
    });

    it('supports field definitions', () => {
      const schema = form()
        .field({ name: 'email', label: 'Email', type: 'string' })
        .build();
      expect(schema.fields).toHaveLength(1);
      expect(schema.fields![0].name).toBe('email');
    });

    it('supports bulk fields', () => {
      const schema = form()
        .fields([
          { name: 'first_name', label: 'First Name', type: 'string' },
          { name: 'last_name', label: 'Last Name', type: 'string' },
        ])
        .build();
      expect(schema.fields).toHaveLength(2);
    });

    it('supports default values', () => {
      const schema = form()
        .defaultValues({ status: 'active' })
        .build();
      expect(schema.defaultValues).toEqual({ status: 'active' });
    });

    it('supports submit label', () => {
      const schema = form()
        .submitLabel('Create')
        .build();
      expect(schema.submitLabel).toBe('Create');
    });

    it('supports layout option', () => {
      const schema = form()
        .layout('vertical')
        .build();
      expect(schema.layout).toBe('vertical');
    });

    it('supports columns', () => {
      const schema = form()
        .columns(2)
        .build();
      expect(schema.columns).toBe(2);
    });

    it('supports chaining', () => {
      const schema = form()
        .id('chained')
        .field({ name: 'name', label: 'Name', type: 'string' })
        .submitLabel('Submit')
        .layout('horizontal')
        .columns(3)
        .build();
      expect(schema.id).toBe('chained');
      expect(schema.fields).toHaveLength(1);
      expect(schema.submitLabel).toBe('Submit');
      expect(schema.layout).toBe('horizontal');
      expect(schema.columns).toBe(3);
    });
  });

  describe('button()', () => {
    it('creates a button schema', () => {
      const schema = button().id('btn').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('button');
      expect(schema.id).toBe('btn');
    });

    it('supports label', () => {
      const schema = button()
        .label('Click Me')
        .build();
      expect(schema.label).toBe('Click Me');
    });

    it('supports variant', () => {
      const schema = button()
        .variant('destructive')
        .build();
      expect(schema.variant).toBe('destructive');
    });
  });

  describe('input()', () => {
    it('creates an input schema', () => {
      const schema = input().id('my-input').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('input');
      expect(schema.id).toBe('my-input');
    });

    it('supports label and placeholder', () => {
      const schema = input()
        .label('Username')
        .placeholder('Enter username')
        .build();
      expect(schema.label).toBe('Username');
      expect(schema.placeholder).toBe('Enter username');
    });
  });

  describe('card()', () => {
    it('creates a card schema', () => {
      const schema = card().id('my-card').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('card');
      expect(schema.id).toBe('my-card');
    });
  });

  describe('grid()', () => {
    it('creates a grid schema', () => {
      const schema = grid().id('my-grid').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('grid');
      expect(schema.id).toBe('my-grid');
    });

    it('takes a column count the grid renderer maps, and nothing else (objectui#11491)', () => {
      const schema = grid().columns(12).build();
      expect(schema.columns).toBe(12);
      expect(safeValidateSchema(schema).success).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(schema).success).toBe(true);
      // @ts-expect-error — `grid` maps no 13th column; `tsc` refuses it at the builder.
      const thirteen = grid().columns(13).build();
      expect(safeValidateSchema(thirteen).success).toBe(false);
    });
  });

  describe('flex()', () => {
    it('creates a flex schema', () => {
      const schema = flex().id('my-flex').build();
      expect(schema).toBeDefined();
      expect(schema.type).toBe('flex');
      expect(schema.id).toBe('my-flex');
    });

    it('supports direction', () => {
      const schema = flex()
        .direction('row')
        .build();
      expect(schema.properties.direction).toBe('row');
    });

    // objectui#11276 (the maintainer's ruling A on objectui#11300): the builder
    // emits the AUTHORED spelling — every `flex` prop, the child list included,
    // in the `properties` bag — so what it builds passes the authoring faces,
    // which refuse those props written flat on the node by name.
    it('emits its props in the properties bag, which both authoring faces accept (objectui#11276)', () => {
      const schema = flex()
        .id('row')
        .className('p-4')
        .direction('col')
        .justify('between')
        .align('center')
        .gap(4)
        .child({ type: 'text', content: 'a' })
        .child({ type: 'text', content: 'b' })
        .build();

      expect(schema).toEqual({
        type: 'flex',
        id: 'row',
        className: 'p-4',
        properties: {
          direction: 'col',
          justify: 'between',
          align: 'center',
          gap: 4,
          children: [
            { type: 'text', content: 'a' },
            { type: 'text', content: 'b' },
          ],
        },
      });
      for (const key of ['direction', 'justify', 'align', 'gap', 'children']) {
        expect(schema, key).not.toHaveProperty(key);
      }
      expect(safeValidateSchema(schema).success).toBe(true);
      expect(StrictAnyComponentSchema.safeParse(schema).success).toBe(true);
    });
  });

  describe('common builder properties', () => {
    it('supports className', () => {
      const schema = button()
        .className('my-class')
        .build();
      expect(schema.className).toBe('my-class');
    });

    it('supports visible', () => {
      const schema = button()
        .visible(false)
        .build();
      expect(schema.visible).toBe(false);
    });

    it('supports disabled', () => {
      const schema = button()
        .disabled(true)
        .build();
      expect(schema.disabled).toBe(true);
    });

    it('supports testId', () => {
      const schema = button()
        .testId('test-btn')
        .build();
      expect(schema.testId).toBe('test-btn');
    });
  });
});

describe('the retired `crud` builder (objectui#5373)', () => {
  it('exports no `crud` factory — the ADR-0049 retirement removed CRUDBuilder', () => {
    // Counter-probe in the SAME assertion pair, so this cannot pass by the
    // module failing to load or by the names being read off the wrong object:
    // the surviving factories must still be there.
    expect(builder).not.toHaveProperty('crud');
    expect(builder).not.toHaveProperty('CRUDBuilder');
    expect(typeof builder.form).toBe('function');
    expect(typeof builder.grid).toBe('function');
  });
});
