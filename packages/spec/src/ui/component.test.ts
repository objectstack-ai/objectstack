import { describe, it, expect } from 'vitest';
import {
  PageHeaderProps,
  PageTabsProps,
  PageCardProps,
  RecordDetailsProps,
  RecordRelatedListProps,
  RecordHighlightsProps,
  RecordActivityProps,
  RecordChatterProps,
  ComponentPropsMap,
  ElementTextPropsSchema,
  ElementNumberPropsSchema,
  ElementImagePropsSchema,
  ElementButtonPropsSchema,
  ElementFilterPropsSchema,
  ElementFormPropsSchema,
  ElementRecordPickerPropsSchema,
  ElementTextInputPropsSchema,
} from './component.zod';
import { PageComponentSchema, PageSchema } from './page.zod';

describe('PageHeaderProps', () => {
  it('should accept minimal header', () => {
    const result = PageHeaderProps.parse({ title: 'My Page' });
    expect(result.title).toBe('My Page');
    expect(result.breadcrumb).toBe(true);
    expect(result.subtitle).toBeUndefined();
    expect(result.icon).toBeUndefined();
    expect(result.actions).toBeUndefined();
  });

  it('should accept full header with all fields', () => {
    const header = {
      title: 'Dashboard',
      subtitle: 'Overview',
      icon: 'home',
      breadcrumb: false,
      actions: ['action-1', 'action-2'],
    };
    const result = PageHeaderProps.parse(header);
    expect(result.breadcrumb).toBe(false);
    expect(result.actions).toHaveLength(2);
  });

  it('should reject header without title', () => {
    expect(() => PageHeaderProps.parse({})).toThrow();
  });
});

describe('PageTabsProps', () => {
  it('should accept valid tabs with defaults', () => {
    const tabs = {
      items: [{ label: 'Tab 1', children: [] }],
    };
    const result = PageTabsProps.parse(tabs);
    expect(result.type).toBe('line');
    expect(result.position).toBe('top');
    expect(result.items).toHaveLength(1);
  });

  it('should accept tabs with all options', () => {
    const tabs = {
      type: 'card' as const,
      position: 'left' as const,
      items: [{ label: 'Tab 1', icon: 'settings', children: ['child1'] }],
    };
    expect(() => PageTabsProps.parse(tabs)).not.toThrow();
  });

  it('should reject invalid type enum', () => {
    expect(() => PageTabsProps.parse({ type: 'invalid', items: [] })).toThrow();
  });

  it('should reject tabs without items', () => {
    expect(() => PageTabsProps.parse({})).toThrow();
  });

  // Conditional tabs (#2606) — item-level `visibleWhen` (ADR-0089 canonical name).
  it('should accept an item-level visibleWhen predicate (bare CEL string → envelope)', () => {
    const result = PageTabsProps.parse({
      items: [
        { label: 'Contracts', visibleWhen: 'record.status == "customer"', children: [] },
        { label: 'Details', children: [] },
      ],
    });
    expect(result.items[0].visibleWhen).toEqual({
      dialect: 'cel',
      source: 'record.status == "customer"',
    });
    // Items without the predicate are untouched — additive, back-compatible.
    expect(result.items[1].visibleWhen).toBeUndefined();
  });

  it('should accept an item-level visibleWhen Expression envelope', () => {
    const result = PageTabsProps.parse({
      items: [
        {
          label: 'Contracts',
          visibleWhen: { dialect: 'cel', source: "page.mode != ''" },
          children: [],
        },
      ],
    });
    expect(result.items[0].visibleWhen).toEqual({ dialect: 'cel', source: "page.mode != ''" });
  });

  it('does NOT accept the deprecated `visibility` alias on tab items (new surface, canonical key only)', () => {
    // ADR-0089 D2 aliases exist for keys with legacy metadata; tab items never
    // had a visibility key, so only canonical `visibleWhen` is declared. The
    // alias is not folded — it is dropped by parse like any unknown key.
    const result = PageTabsProps.parse({
      items: [{ label: 'Contracts', visibility: 'record.status == "customer"', children: [] }],
    });
    expect(result.items[0].visibleWhen).toBeUndefined();
    expect('visibility' in result.items[0]).toBe(false);
  });
});

describe('PageCardProps', () => {
  it('should accept empty card with defaults', () => {
    const result = PageCardProps.parse({});
    expect(result.bordered).toBe(true);
    expect(result.title).toBeUndefined();
    expect(result.actions).toBeUndefined();
    expect(result.body).toBeUndefined();
    expect(result.footer).toBeUndefined();
  });

  it('should accept full card', () => {
    const card = {
      title: 'Info Card',
      bordered: false,
      actions: ['edit', 'delete'],
      body: ['component1'],
      footer: ['footer-component'],
    };
    const result = PageCardProps.parse(card);
    expect(result.title).toBe('Info Card');
    expect(result.bordered).toBe(false);
  });
});

describe('RecordDetailsProps', () => {
  it('should accept empty with defaults', () => {
    const result = RecordDetailsProps.parse({});
    expect(result.columns).toBe('2');
    expect(result.layout).toBe('auto');
    expect(result.sections).toBeUndefined();
  });

  it('should accept custom layout with sections', () => {
    const details = { columns: '3' as const, layout: 'custom' as const, sections: ['sec-1', 'sec-2'] };
    expect(() => RecordDetailsProps.parse(details)).not.toThrow();
  });

  it('should reject invalid column value', () => {
    expect(() => RecordDetailsProps.parse({ columns: '5' })).toThrow();
  });
});

describe('RecordRelatedListProps', () => {
  it('should accept valid related list', () => {
    const props = {
      objectName: 'contact',
      relationshipField: 'account_id',
      columns: ['name', 'email'],
    };
    const result = RecordRelatedListProps.parse(props);
    expect(result.limit).toBe(5);
    expect(result.sort).toBeUndefined();
  });

  it('should accept full related list with optional fields', () => {
    const props = {
      objectName: 'opportunity',
      relationshipField: 'account_id',
      columns: ['name', 'amount'],
      sort: 'created_at',
      limit: 10,
    };
    expect(() => RecordRelatedListProps.parse(props)).not.toThrow();
  });

  it('should reject without required fields', () => {
    expect(() => RecordRelatedListProps.parse({})).toThrow();
    expect(() => RecordRelatedListProps.parse({ objectName: 'x' })).toThrow();
  });

  it('should accept a related list without columns (columns derive from the child object)', () => {
    const props = { objectName: 'contact', relationshipField: 'account_id' };
    expect(() => RecordRelatedListProps.parse(props)).not.toThrow();
    expect(RecordRelatedListProps.parse(props).columns).toBeUndefined();
  });
});

describe('RecordHighlightsProps', () => {
  it('should accept valid highlights', () => {
    const props = { fields: ['name', 'status', 'amount'] };
    const result = RecordHighlightsProps.parse(props);
    expect(result.fields).toHaveLength(3);
  });

  it('should reject empty fields array (min 1)', () => {
    expect(() => RecordHighlightsProps.parse({ fields: [] })).toThrow();
  });

  it('should reject more than 7 fields', () => {
    expect(() => RecordHighlightsProps.parse({ fields: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })).toThrow();
  });

  it('should reject missing fields', () => {
    expect(() => RecordHighlightsProps.parse({})).toThrow();
  });
});

describe('ComponentPropsMap', () => {
  it('should contain structure components', () => {
    expect(ComponentPropsMap['page:header']).toBeDefined();
    expect(ComponentPropsMap['page:tabs']).toBeDefined();
    expect(ComponentPropsMap['page:card']).toBeDefined();
    expect(ComponentPropsMap['page:footer']).toBeDefined();
    expect(ComponentPropsMap['page:sidebar']).toBeDefined();
    expect(ComponentPropsMap['page:accordion']).toBeDefined();
    expect(ComponentPropsMap['page:section']).toBeDefined();
  });

  it('should contain record components', () => {
    expect(ComponentPropsMap['record:details']).toBeDefined();
    expect(ComponentPropsMap['record:related_list']).toBeDefined();
    expect(ComponentPropsMap['record:highlights']).toBeDefined();
    expect(ComponentPropsMap['record:activity']).toBeDefined();
    expect(ComponentPropsMap['record:chatter']).toBeDefined();
    expect(ComponentPropsMap['record:path']).toBeDefined();
  });

  it('should contain AI components', () => {
    expect(ComponentPropsMap['ai:chat_window']).toBeDefined();
    expect(ComponentPropsMap['ai:suggestion']).toBeDefined();
  });

  it('should parse ai:chat_window with default', () => {
    const result = ComponentPropsMap['ai:chat_window'].parse({});
    expect(result.mode).toBe('float');
  });

  it('should parse ai:suggestion with optional context', () => {
    const result = ComponentPropsMap['ai:suggestion'].parse({});
    expect(result.context).toBeUndefined();
  });

  it('should parse empty props schemas for utility components', () => {
    expect(() => ComponentPropsMap['page:footer'].parse({})).not.toThrow();
    expect(() => ComponentPropsMap['global:search'].parse({})).not.toThrow();
    expect(() => ComponentPropsMap['user:profile'].parse({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Content Elements in PageComponentType
// ---------------------------------------------------------------------------
describe('Content Elements', () => {
  it('should accept element:text component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:text',
      properties: { content: 'Hello World' },
    })).not.toThrow();
  });

  it('should accept element:number component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:number',
      properties: { object: 'order', aggregate: 'count' },
    })).not.toThrow();
  });

  it('should accept element:image component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:image',
      properties: { src: '/images/banner.jpg' },
    })).not.toThrow();
  });

  it('should accept element:divider component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:divider',
      properties: {},
    })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Element Props Schemas
// ---------------------------------------------------------------------------
describe('ElementTextPropsSchema', () => {
  it('should accept minimal text props', () => {
    const props = ElementTextPropsSchema.parse({ content: 'Hello' });
    expect(props.content).toBe('Hello');
    expect(props.variant).toBe('body');
    expect(props.align).toBe('left');
  });

  it('should accept full text props', () => {
    const props = ElementTextPropsSchema.parse({
      content: '# Welcome',
      variant: 'heading',
      align: 'center',
    });
    expect(props.variant).toBe('heading');
    expect(props.align).toBe('center');
  });

  it('should accept all variants', () => {
    const variants = ['heading', 'subheading', 'body', 'caption'] as const;
    variants.forEach(variant => {
      expect(() => ElementTextPropsSchema.parse({ content: 'Test', variant })).not.toThrow();
    });
  });

  it('should reject without content', () => {
    expect(() => ElementTextPropsSchema.parse({})).toThrow();
  });
});

describe('ElementNumberPropsSchema', () => {
  it('should accept minimal number props', () => {
    const props = ElementNumberPropsSchema.parse({
      object: 'order',
      aggregate: 'count',
    });
    expect(props.object).toBe('order');
    expect(props.aggregate).toBe('count');
    expect(props.field).toBeUndefined();
  });

  it('should accept full number props', () => {
    const props = ElementNumberPropsSchema.parse({
      object: 'order',
      field: 'amount',
      aggregate: 'sum',
      filter: { status: 'paid' },
      format: 'currency',
      prefix: '$',
      suffix: ' USD',
    });
    expect(props.format).toBe('currency');
    expect(props.prefix).toBe('$');
    expect(props.suffix).toBe(' USD');
  });

  it('should accept all aggregate functions', () => {
    const aggregates = ['count', 'sum', 'avg', 'min', 'max'] as const;
    aggregates.forEach(aggregate => {
      expect(() => ElementNumberPropsSchema.parse({ object: 'order', aggregate })).not.toThrow();
    });
  });

  it('should accept all format options', () => {
    const formats = ['number', 'currency', 'percent'] as const;
    formats.forEach(format => {
      expect(() => ElementNumberPropsSchema.parse({ object: 'order', aggregate: 'count', format })).not.toThrow();
    });
  });

  it('should reject without required fields', () => {
    expect(() => ElementNumberPropsSchema.parse({})).toThrow();
    expect(() => ElementNumberPropsSchema.parse({ object: 'order' })).toThrow();
  });
});

describe('ElementImagePropsSchema', () => {
  it('should accept minimal image props', () => {
    const props = ElementImagePropsSchema.parse({ src: '/images/hero.jpg' });
    expect(props.src).toBe('/images/hero.jpg');
    expect(props.fit).toBe('cover');
  });

  it('should accept full image props', () => {
    const props = ElementImagePropsSchema.parse({
      src: '/images/banner.png',
      alt: 'Company banner',
      fit: 'contain',
      height: 200,
    });
    expect(props.alt).toBe('Company banner');
    expect(props.fit).toBe('contain');
    expect(props.height).toBe(200);
  });

  it('should accept all fit modes', () => {
    const fits = ['cover', 'contain', 'fill'] as const;
    fits.forEach(fit => {
      expect(() => ElementImagePropsSchema.parse({ src: '/img.png', fit })).not.toThrow();
    });
  });

  it('should reject without src', () => {
    expect(() => ElementImagePropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap content elements
// ---------------------------------------------------------------------------
describe('ComponentPropsMap content elements', () => {
  it('should contain element:text', () => {
    expect(ComponentPropsMap['element:text']).toBeDefined();
  });

  it('should contain element:number', () => {
    expect(ComponentPropsMap['element:number']).toBeDefined();
  });

  it('should contain element:image', () => {
    expect(ComponentPropsMap['element:image']).toBeDefined();
  });

  it('should contain element:divider', () => {
    expect(ComponentPropsMap['element:divider']).toBeDefined();
  });

  it('should parse element:text props', () => {
    const result = ComponentPropsMap['element:text'].parse({ content: 'Hello' });
    expect(result.content).toBe('Hello');
  });

  it('should parse element:number props', () => {
    const result = ComponentPropsMap['element:number'].parse({
      object: 'order',
      aggregate: 'count',
    });
    expect(result.object).toBe('order');
  });

  it('should parse element:image props', () => {
    const result = ComponentPropsMap['element:image'].parse({ src: '/img.png' });
    expect(result.src).toBe('/img.png');
  });

  it('should parse element:divider (empty props)', () => {
    expect(() => ComponentPropsMap['element:divider'].parse({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:button
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:button', () => {
  it('should accept element:button component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:button',
      properties: { label: 'Submit' },
    })).not.toThrow();
  });

  it('should parse element:button props with defaults', () => {
    const props = ElementButtonPropsSchema.parse({ label: 'Save' });
    expect(props.label).toBe('Save');
    expect(props.variant).toBe('primary');
    expect(props.size).toBe('medium');
    expect(props.iconPosition).toBe('left');
    expect(props.disabled).toBe(false);
  });

  it('should accept full button props', () => {
    const props = ElementButtonPropsSchema.parse({
      label: 'Delete',
      variant: 'danger',
      size: 'large',
      icon: 'trash',
      iconPosition: 'right',
      disabled: true,
    });
    expect(props.variant).toBe('danger');
    expect(props.icon).toBe('trash');
    expect(props.disabled).toBe(true);
  });

  it('should accept all button variants', () => {
    const variants = ['primary', 'secondary', 'danger', 'ghost', 'link'] as const;
    variants.forEach(variant => {
      expect(() => ElementButtonPropsSchema.parse({ label: 'Btn', variant })).not.toThrow();
    });
  });

  it('should reject button without label', () => {
    expect(() => ElementButtonPropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:filter
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:filter', () => {
  it('should accept element:filter component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:filter',
      properties: { object: 'order', fields: ['status'] },
    })).not.toThrow();
  });

  it('should parse filter props with defaults', () => {
    const props = ElementFilterPropsSchema.parse({
      object: 'order',
      fields: ['status', 'priority'],
    });
    expect(props.object).toBe('order');
    expect(props.layout).toBe('inline');
    expect(props.showSearch).toBe(true);
  });

  it('should accept filter with targetVariable', () => {
    const props = ElementFilterPropsSchema.parse({
      object: 'task',
      fields: ['status'],
      targetVariable: 'active_filter',
      layout: 'sidebar',
    });
    expect(props.targetVariable).toBe('active_filter');
    expect(props.layout).toBe('sidebar');
  });

  it('should reject filter without required fields', () => {
    expect(() => ElementFilterPropsSchema.parse({})).toThrow();
    expect(() => ElementFilterPropsSchema.parse({ object: 'order' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:form
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:form', () => {
  it('should accept element:form component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:form',
      properties: { object: 'contact' },
    })).not.toThrow();
  });

  it('should parse form props with defaults', () => {
    const props = ElementFormPropsSchema.parse({ object: 'contact' });
    expect(props.object).toBe('contact');
    expect(props.mode).toBe('create');
  });

  it('should accept full form props', () => {
    const props = ElementFormPropsSchema.parse({
      object: 'contact',
      fields: ['name', 'email', 'phone'],
      mode: 'edit',
      submitLabel: 'Update Contact',
      onSubmit: 'navigate_to("page_detail")',
    });
    expect(props.mode).toBe('edit');
    expect(props.fields).toHaveLength(3);
    expect(props.submitLabel).toBe('Update Contact');
  });

  it('should reject form without object', () => {
    expect(() => ElementFormPropsSchema.parse({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:record_picker
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:record_picker', () => {
  it('should accept element:record_picker component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:record_picker',
      properties: { object: 'account', displayField: 'name' },
    })).not.toThrow();
  });

  it('should parse record_picker props with defaults', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      object: 'account',
      displayField: 'name',
    });
    expect(props.object).toBe('account');
    expect(props.displayField).toBe('name');
    expect(props.multiple).toBe(false);
  });

  it('should accept full record_picker props', () => {
    const props = ElementRecordPickerPropsSchema.parse({
      object: 'account',
      displayField: 'name',
      searchFields: ['name', 'email'],
      filter: { status: 'active' },
      multiple: true,
      targetVariable: 'selected_account',
      placeholder: 'Search accounts...',
    });
    expect(props.multiple).toBe(true);
    expect(props.targetVariable).toBe('selected_account');
    expect(props.searchFields).toEqual(['name', 'email']);
  });

  it('should reject record_picker without required fields', () => {
    expect(() => ElementRecordPickerPropsSchema.parse({})).toThrow();
    expect(() => ElementRecordPickerPropsSchema.parse({ object: 'account' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Interactive Elements — element:text_input
// ---------------------------------------------------------------------------
describe('Interactive Elements — element:text_input', () => {
  it('should accept element:text_input component', () => {
    expect(() => PageComponentSchema.parse({
      type: 'element:text_input',
      properties: { label: 'Workspace name' },
    })).not.toThrow();
  });

  it('should parse text_input props with defaults', () => {
    const props = ElementTextInputPropsSchema.parse({});
    expect(props.inputType).toBe('text');
    expect(props.required).toBe(false);
    expect(props.disabled).toBe(false);
  });

  it('should accept full text_input props', () => {
    const props = ElementTextInputPropsSchema.parse({
      inputType: 'email',
      label: 'Email',
      placeholder: 'you@example.com',
      defaultValue: 'a@b.com',
      required: true,
      disabled: false,
      description: 'We never share it',
      targetVariable: 'email',
    });
    expect(props.inputType).toBe('email');
    expect(props.required).toBe(true);
    expect(props.targetVariable).toBe('email');
  });

  it('should accept all input types', () => {
    const types = ['text', 'email', 'number', 'tel', 'url', 'password'] as const;
    types.forEach(inputType => {
      expect(() => ElementTextInputPropsSchema.parse({ inputType })).not.toThrow();
    });
  });

  it('should accept a numeric defaultValue', () => {
    const props = ElementTextInputPropsSchema.parse({ inputType: 'number', defaultValue: 42 });
    expect(props.defaultValue).toBe(42);
  });

  it('should reject an unknown input type', () => {
    expect(() => ElementTextInputPropsSchema.parse({ inputType: 'color' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap — interactive elements
// ---------------------------------------------------------------------------
describe('ComponentPropsMap interactive elements', () => {
  it('should contain element:button', () => {
    expect(ComponentPropsMap['element:button']).toBeDefined();
  });

  it('should contain element:filter', () => {
    expect(ComponentPropsMap['element:filter']).toBeDefined();
  });

  it('should contain element:form', () => {
    expect(ComponentPropsMap['element:form']).toBeDefined();
  });

  it('should contain element:record_picker', () => {
    expect(ComponentPropsMap['element:record_picker']).toBeDefined();
  });

  it('should contain element:text_input', () => {
    expect(ComponentPropsMap['element:text_input']).toBeDefined();
  });

  it('should parse element:button props', () => {
    const result = ComponentPropsMap['element:button'].parse({ label: 'Click Me' });
    expect(result.label).toBe('Click Me');
  });

  it('should parse element:filter props', () => {
    const result = ComponentPropsMap['element:filter'].parse({
      object: 'order',
      fields: ['status'],
    });
    expect(result.object).toBe('order');
  });

  it('should parse element:form props', () => {
    const result = ComponentPropsMap['element:form'].parse({ object: 'contact' });
    expect(result.object).toBe('contact');
  });

  it('should parse element:record_picker props', () => {
    const result = ComponentPropsMap['element:record_picker'].parse({
      object: 'account',
      displayField: 'name',
    });
    expect(result.object).toBe('account');
  });

  it('should parse element:text_input props', () => {
    const result = ComponentPropsMap['element:text_input'].parse({ label: 'Name' });
    expect(result.inputType).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// Enhanced RecordActivityProps (Unified Timeline)
// ---------------------------------------------------------------------------
describe('RecordActivityProps (enhanced)', () => {
  it('should accept empty with defaults', () => {
    const result = RecordActivityProps.parse({});
    expect(result.filterMode).toBe('all');
    expect(result.showFilterToggle).toBe(true);
    expect(result.limit).toBe(20);
    expect(result.showCompleted).toBe(false);
    expect(result.unifiedTimeline).toBe(true);
    expect(result.showCommentInput).toBe(true);
    expect(result.enableMentions).toBe(true);
    expect(result.enableReactions).toBe(false);
    expect(result.enableThreading).toBe(false);
    expect(result.showSubscriptionToggle).toBe(true);
  });

  it('should accept unified feed item types including comment and field_change', () => {
    const result = RecordActivityProps.parse({
      types: ['comment', 'field_change', 'task', 'email'],
    });
    expect(result.types).toEqual(['comment', 'field_change', 'task', 'email']);
  });

  it('should accept custom filter mode', () => {
    const result = RecordActivityProps.parse({ filterMode: 'comments_only' });
    expect(result.filterMode).toBe('comments_only');
  });

  it('should accept all filter modes', () => {
    const modes = ['all', 'comments_only', 'changes_only', 'tasks_only'] as const;
    modes.forEach(mode => {
      expect(() => RecordActivityProps.parse({ filterMode: mode })).not.toThrow();
    });
  });

  it('should accept full configuration', () => {
    const result = RecordActivityProps.parse({
      types: ['comment', 'field_change'],
      filterMode: 'all',
      showFilterToggle: true,
      limit: 50,
      showCompleted: true,
      unifiedTimeline: true,
      showCommentInput: true,
      enableMentions: true,
      enableReactions: true,
      enableThreading: true,
      showSubscriptionToggle: false,
    });
    expect(result.enableReactions).toBe(true);
    expect(result.enableThreading).toBe(true);
    expect(result.showSubscriptionToggle).toBe(false);
    expect(result.limit).toBe(50);
  });

  it('should reject invalid feed item type', () => {
    expect(() => RecordActivityProps.parse({ types: ['invalid_type'] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RecordChatterProps (replaces EmptyProps)
// ---------------------------------------------------------------------------
describe('RecordChatterProps', () => {
  it('should accept empty with defaults', () => {
    const result = RecordChatterProps.parse({});
    expect(result.position).toBe('sidebar');
    expect(result.collapsible).toBe(true);
    expect(result.defaultCollapsed).toBe(false);
    expect(result.width).toBeUndefined();
    expect(result.feed).toBeUndefined();
  });

  it('should accept sidebar position with width', () => {
    const result = RecordChatterProps.parse({
      position: 'sidebar',
      width: '350px',
    });
    expect(result.position).toBe('sidebar');
    expect(result.width).toBe('350px');
  });

  it('should accept numeric width', () => {
    const result = RecordChatterProps.parse({ width: 400 });
    expect(result.width).toBe(400);
  });

  it('should accept all position modes', () => {
    const positions = ['sidebar', 'inline', 'drawer'] as const;
    positions.forEach(position => {
      expect(() => RecordChatterProps.parse({ position })).not.toThrow();
    });
  });

  it('should accept collapsed state', () => {
    const result = RecordChatterProps.parse({
      collapsible: true,
      defaultCollapsed: true,
    });
    expect(result.defaultCollapsed).toBe(true);
  });

  it('should accept embedded feed configuration', () => {
    const result = RecordChatterProps.parse({
      position: 'sidebar',
      width: '30%',
      feed: {
        types: ['comment', 'field_change'],
        filterMode: 'all',
        limit: 30,
        enableMentions: true,
        enableReactions: true,
      },
    });
    expect(result.feed).toBeDefined();
    expect(result.feed!.types).toEqual(['comment', 'field_change']);
    expect(result.feed!.limit).toBe(30);
    expect(result.feed!.enableReactions).toBe(true);
  });

  it('should reject invalid position', () => {
    expect(() => RecordChatterProps.parse({ position: 'modal' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ComponentPropsMap — record:chatter is no longer empty
// ---------------------------------------------------------------------------
describe('ComponentPropsMap record:chatter', () => {
  it('should parse record:chatter with defaults', () => {
    const result = ComponentPropsMap['record:chatter'].parse({});
    expect(result.position).toBe('sidebar');
    expect(result.collapsible).toBe(true);
  });

  it('should parse record:chatter with feed config', () => {
    const result = ComponentPropsMap['record:chatter'].parse({
      position: 'drawer',
      feed: { filterMode: 'comments_only' },
    });
    expect(result.position).toBe('drawer');
    expect(result.feed!.filterMode).toBe('comments_only');
  });

  it('should parse record:activity with unified types', () => {
    const result = ComponentPropsMap['record:activity'].parse({
      types: ['comment', 'field_change', 'task'],
      unifiedTimeline: true,
    });
    expect(result.types).toEqual(['comment', 'field_change', 'task']);
    expect(result.unifiedTimeline).toBe(true);
  });
});

/**
 * ── #4001 批 17: the `no gate` verdict, pinned ──────────────────────────────
 *
 * These schemas are NOT a pending `.strict()` batch. Nothing parses them, so
 * closing them would enforce nothing (#4583). The full measurement and the
 * reasoning live in `component.zod.ts`'s file header and in the `ui/` tables of
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md`.
 *
 * This block exists so the verdict cannot outlive its truth. Each assertion is
 * written to go RED the day the world changes underneath it — at which point the
 * correct response is to update all three places together, not to relax the test.
 */
describe('#4001 批 17 — component props are `no gate` (carrier live, parse absent)', () => {
  it('the carrier is still an OPEN bag — goes red the day `properties` gets a typed dispatch', () => {
    // `PageComponentSchema` is `.strict().transform(…)`, so unwrap the pipe to
    // reach the object shape.
    const def = (PageComponentSchema as any)._zod.def;
    const shape = def.type === 'pipe' ? def.in._zod.def.shape : def.shape;
    // `properties` is `z.record(z.string(), z.unknown()).optional().default({})`.
    let node = shape.properties;
    while (node?._zod?.def?.innerType) node = node._zod.def.innerType;
    expect(node._zod.def.type).toBe('record');
    // The value type must still be the fully-open `unknown`. A dispatch on
    // `type` (the #5068 fix) replaces this, and that is the signal to reclassify
    // this file back to `authorable` and schedule the ratchet.
    expect(node._zod.def.valueType._zod.def.type).toBe('unknown');
  });

  it('an unknown key inside `properties` survives the LIVE page parse — with the strict sibling as negative control', () => {
    const page = {
      name: 'batch17_probe',
      label: 'Probe',
      type: 'home' as const,
      regions: [
        { name: 'header', components: [{ type: 'page:header', properties: { title: 'T' } }] },
      ],
    };

    // A. unknown key INSIDE the carrier slot — accepted AND retained today.
    const inside = structuredClone(page) as any;
    inside.regions[0].components[0].properties.zzUndeclared = 'x';
    const a = PageSchema.safeParse(inside);
    expect(a.success).toBe(true);
    expect((a as any).data.regions[0].components[0].properties.zzUndeclared).toBe('x');

    // B. NEGATIVE CONTROL — the same key one level out, on the component node
    // itself, which IS strict (ADR-0089 D3a). If this ever stops failing, the
    // assertion above proves nothing and this whole block is measuring air.
    const outside = structuredClone(page) as any;
    outside.regions[0].components[0].zzUndeclared = 'x';
    expect(PageSchema.safeParse(outside).success).toBe(false);
  });

  it('every ComponentPropsMap entry is still non-strict — a sweep that closes them without wiring #5068 fails here', () => {
    const stillOpen: string[] = [];
    for (const [type, schema] of Object.entries(ComponentPropsMap)) {
      const def = (schema as any)._zod.def;
      // zod records an unknown-key policy on the object def; `.strict()` sets a
      // `never` catchall. Anything else means the site is still open.
      if (def.catchall?._zod?.def?.type === 'never') continue;
      stillOpen.push(type);
    }
    // All 31 registered component types are open. When #5068 wires the parse and
    // a later batch closes them, this expectation flips — update the verdict in
    // component.zod.ts and the ledger in the same PR.
    expect(stillOpen.length).toBe(Object.keys(ComponentPropsMap).length);
  });
});
