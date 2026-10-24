/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Schema Builder
 * 
 * Fluent API for building schemas programmatically.
 * Provides type-safe builder functions for common schema patterns.
 * 
 * @module builder
 * @packageDocumentation
 */

import type {
  BaseSchema,
  DeclaredNode,
  FormSchema,
  FormField,
  ButtonSchema,
  InputSchema,
  CardSchema,
  GridSchema,
  FlexLayoutProps
} from '@object-ui/types';

/**
 * Base builder class
 */
class SchemaBuilder<T extends BaseSchema> {
  protected schema: any;

  constructor(type: string) {
    this.schema = { type };
  }

  /**
   * Set the ID
   */
  id(id: string): this {
    this.schema.id = id;
    return this;
  }

  /**
   * Set the className
   */
  className(className: string): this {
    this.schema.className = className;
    return this;
  }

  /**
   * Set visibility
   */
  visible(visible: boolean): this {
    this.schema.visible = visible;
    return this;
  }

  /**
   * Set conditional visibility
   */
  visibleOn(expression: string): this {
    this.schema.visibleOn = expression;
    return this;
  }

  /**
   * Set disabled state
   */
  disabled(disabled: boolean): this {
    this.schema.disabled = disabled;
    return this;
  }

  /**
   * Set test ID
   */
  testId(testId: string): this {
    this.schema.testId = testId;
    return this;
  }

  /**
   * Build the final schema
   */
  build(): T {
    return this.schema as T;
  }
}

/**
 * Form builder
 */
export class FormBuilder extends SchemaBuilder<FormSchema> {
  constructor() {
    super('form');
    this.schema.fields = [];
  }

  /**
   * Add a field to the form
   */
  field(field: FormField): this {
    this.schema.fields = [...(this.schema.fields || []), field];
    return this;
  }

  /**
   * Add multiple fields
   */
  fields(fields: FormField[]): this {
    this.schema.fields = fields;
    return this;
  }

  /**
   * Set default values
   */
  defaultValues(values: Record<string, any>): this {
    this.schema.defaultValues = values;
    return this;
  }

  /**
   * Set submit label
   */
  submitLabel(label: string): this {
    this.schema.submitLabel = label;
    return this;
  }

  /**
   * Set form layout
   */
  layout(layout: 'vertical' | 'horizontal'): this {
    this.schema.layout = layout;
    return this;
  }

  /**
   * Set number of columns
   */
  columns(columns: number): this {
    this.schema.columns = columns;
    return this;
  }

  /**
   * Set submit handler
   */
  onSubmit(handler: (data: Record<string, any>) => void | Promise<void>): this {
    this.schema.onSubmit = handler;
    return this;
  }
}

/**
 * Button builder
 */
export class ButtonBuilder extends SchemaBuilder<ButtonSchema> {
  constructor() {
    super('button');
  }

  /**
   * Set button label
   */
  label(label: string): this {
    this.schema.label = label;
    return this;
  }

  /**
   * Set button variant
   */
  variant(variant: 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost' | 'link'): this {
    this.schema.variant = variant;
    return this;
  }

  /**
   * Set button size
   */
  size(size: 'default' | 'sm' | 'lg' | 'icon'): this {
    this.schema.size = size;
    return this;
  }

  /**
   * Set button icon
   */
  icon(icon: string): this {
    this.schema.icon = icon;
    return this;
  }

  /**
   * Set click handler
   */
  onClick(handler: () => void | Promise<void>): this {
    this.schema.onClick = handler;
    return this;
  }

  /**
   * Set loading state
   */
  loading(loading: boolean): this {
    this.schema.loading = loading;
    return this;
  }
}

/**
 * Input builder
 */
export class InputBuilder extends SchemaBuilder<InputSchema> {
  constructor() {
    super('input');
  }

  /**
   * Set field name
   */
  name(name: string): this {
    this.schema.name = name;
    return this;
  }

  /**
   * Set label
   */
  label(label: string): this {
    this.schema.label = label;
    return this;
  }

  /**
   * Set placeholder
   */
  placeholder(placeholder: string): this {
    this.schema.placeholder = placeholder;
    return this;
  }

  /**
   * Set input type
   */
  inputType(type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'): this {
    this.schema.inputType = type;
    return this;
  }

  /**
   * Mark as required
   */
  required(required: boolean = true): this {
    this.schema.required = required;
    return this;
  }

  /**
   * Set default value
   */
  defaultValue(value: string | number): this {
    this.schema.defaultValue = value;
    return this;
  }
}

/**
 * Card builder
 */
export class CardBuilder extends SchemaBuilder<CardSchema> {
  constructor() {
    super('card');
  }

  /**
   * Set card title
   */
  title(title: string): this {
    this.schema.title = title;
    return this;
  }

  /**
   * Set card description
   */
  description(description: string): this {
    this.schema.description = description;
    return this;
  }

  /**
   * Set card content: a node of a declared type, or a list of them
   * (objectui#11466). Each node is checked against its own type's keys.
   */
  content(content: DeclaredNode | DeclaredNode[]): this {
    this.schema.content = content;
    return this;
  }

  /**
   * Set card variant
   */
  variant(variant: 'default' | 'outline' | 'ghost'): this {
    this.schema.variant = variant;
    return this;
  }

  /**
   * Make card hoverable
   */
  hoverable(hoverable: boolean = true): this {
    this.schema.hoverable = hoverable;
    return this;
  }
}

/**
 * Grid builder
 */
export class GridBuilder extends SchemaBuilder<GridSchema> {
  constructor() {
    super('grid');
    this.schema.children = [];
  }

  /**
   * Set number of columns — one of the counts the `grid` renderer maps
   * (objectui#11491); the parameter is the declaration's own bare-count arm,
   * so `tsc` refuses any other number.
   */
  columns(columns: Extract<NonNullable<GridSchema['columns']>, number>): this {
    this.schema.columns = columns;
    return this;
  }

  /**
   * Set gap — one of the steps the `grid` renderer maps (objectui#11474); the
   * parameter is the declaration's own set, so `tsc` refuses any other number.
   */
  gap(gap: NonNullable<GridSchema['gap']>): this {
    this.schema.gap = gap;
    return this;
  }

  /**
   * Add a child: a node of a declared type (`DeclaredNode`, objectui#11466),
   * checked against its own type's keys like a child written inline.
   */
  child(child: DeclaredNode): this {
    const children = Array.isArray(this.schema.children) ? this.schema.children : [];
    this.schema.children = [...children, child];
    return this;
  }

  /**
   * Set all children: nodes of declared types (objectui#11466).
   */
  children(children: DeclaredNode[]): this {
    this.schema.children = children;
    return this;
  }
}

/**
 * Flex builder
 *
 * Builds an AUTHORED `flex` node: its props in the `properties` bag
 * (objectui#11276, the maintainer's ruling A on objectui#11300) —
 * `{ type: 'flex', properties: { direction, justify, align, gap, children } }`,
 * the spelling `@objectstack/spec`'s page component declares and
 * `@object-ui/types`' authoring faces accept. A `flex` prop written flat on the
 * node is refused there by name, so the builder never writes one. The base
 * setters (`id`, `className`, `visible`, …) stay on the node. The bag's members
 * are `FlexLayoutProps`; `SchemaRenderer` hoists them onto the node before the
 * `flex` renderer reads them.
 */
export class FlexBuilder extends SchemaBuilder<BaseSchema & { type: 'flex'; properties: FlexLayoutProps }> {
  constructor() {
    super('flex');
    this.schema.properties = { children: [] };
  }

  /**
   * Set flex direction
   */
  direction(direction: 'row' | 'col' | 'row-reverse' | 'col-reverse'): this {
    this.schema.properties.direction = direction;
    return this;
  }

  /**
   * Set justify content
   */
  justify(justify: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly'): this {
    this.schema.properties.justify = justify;
    return this;
  }

  /**
   * Set align items
   */
  align(align: 'start' | 'end' | 'center' | 'baseline' | 'stretch'): this {
    this.schema.properties.align = align;
    return this;
  }

  /**
   * Set gap — one of the steps the `flex` renderer maps (objectui#11474); the
   * parameter is the declaration's own set, so `tsc` refuses any other number.
   */
  gap(gap: NonNullable<FlexLayoutProps['gap']>): this {
    this.schema.properties.gap = gap;
    return this;
  }

  /**
   * Add a child: a node of a declared type (`DeclaredNode`, objectui#11466),
   * checked against its own type's keys like a child written inline.
   */
  child(child: DeclaredNode): this {
    const children = Array.isArray(this.schema.properties.children) ? this.schema.properties.children : [];
    this.schema.properties.children = [...children, child];
    return this;
  }

  /**
   * Set all children: nodes of declared types (objectui#11466).
   */
  children(children: DeclaredNode[]): this {
    this.schema.properties.children = children;
    return this;
  }
}

// Export factory functions
export const form = () => new FormBuilder();
export const button = () => new ButtonBuilder();
export const input = () => new InputBuilder();
export const card = () => new CardBuilder();
export const grid = () => new GridBuilder();
export const flex = () => new FlexBuilder();
