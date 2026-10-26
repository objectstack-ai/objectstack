/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Schema-driven config panel type definitions.
 *
 * Each concrete panel (View, Dashboard, Page…) provides a ConfigPanelSchema,
 * and ConfigPanelRenderer auto-generates the UI.
 */

/** Supported control types for config fields */
export type ControlType =
  | 'input'
  | 'textarea'
  | 'switch'
  | 'select'
  | 'checkbox'
  | 'slider'
  | 'color'
  | 'field-picker'
  | 'filter'
  | 'sort'
  | 'icon-group'
  | 'summary'
  | 'custom';

/** A single field within a config section */
export interface ConfigField {
  /** Field key in the draft object */
  key: string;
  /** Display label (may be an i18n key) */
  label: string;
  /** Control type determining which widget to render */
  type: ControlType;
  /** Default value for the field */
  defaultValue?: any;
  /** Select/icon-group options */
  options?: Array<{ value: string; label: string; icon?: React.ReactNode }>;
  /** Visibility predicate evaluated against the current draft */
  visibleWhen?: (draft: Record<string, any>) => boolean;
  /** Disabled predicate evaluated against the current draft */
  disabledWhen?: (draft: Record<string, any>) => boolean;
  /** Custom render function for type='custom' */
  render?: (
    value: any,
    onChange: (v: any) => void,
    draft: Record<string, any>,
  ) => React.ReactNode;
  /** Placeholder text for input/select controls */
  placeholder?: string;
  /** Help text displayed below the control */
  helpText?: string;
  /** Minimum value for slider */
  min?: number;
  /** Maximum value for slider */
  max?: number;
  /** Step value for slider */
  step?: number;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Field definitions for filter/sort sub-editors */
  fields?: Array<{ value: string; label: string; type?: string; options?: Array<{ value: string; label: string }> }>;
  /** Summary display text for type='summary' */
  summaryText?: string;
  /** Click handler for the summary gear/action button (type='summary') */
  onSummaryClick?: () => void;
}

/** A group of related config fields */
export interface ConfigSection {
  /** Unique section key (used for collapse state tracking) */
  key: string;
  /** Section title (may be an i18n key) */
  title: string;
  /** Hint text displayed below the title */
  hint?: string;
  /** Icon displayed before the section title (e.g. a Lucide icon element) */
  icon?: React.ReactNode;
  /** Whether this section supports collapse/expand */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Fields belonging to this section */
  fields: ConfigField[];
  /** Nested sub-sections for complex grouping */
  subsections?: ConfigSection[];
  /** Visibility predicate evaluated against the current draft */
  visibleWhen?: (draft: Record<string, any>) => boolean;
}

/** Top-level schema describing an entire config panel */
export interface ConfigPanelSchema {
  /** Breadcrumb segments displayed in the panel header */
  breadcrumb: string[];
  /** Ordered list of sections */
  sections: ConfigSection[];
}
