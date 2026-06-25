// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { ViewFilterRuleSchema } from './view.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { FeedItemType, FeedFilterMode } from '../data/feed.zod';

/**
 * Empty Properties Schema
 */
import { lazySchema } from '../shared/lazy-schema';
import { ExpressionInputSchema } from '../shared/expression.zod';
const EmptyProps = z.object({});

/**
 * ----------------------------------------------------------------------
 * 1. Structure Components
 * ----------------------------------------------------------------------
 */

export const PageHeaderProps = z.object({
  title: I18nLabelSchema.describe('Page title'),
  subtitle: I18nLabelSchema.optional().describe('Page subtitle'),
  icon: z.string().optional().describe('Icon name'),
  breadcrumb: z.boolean().default(true).describe('Show breadcrumb'),
  actions: z.array(z.string()).optional().describe('Action IDs to show in header'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const PageTabsProps = z.object({
  type: z.enum(['line', 'card', 'pill']).default('line'),
  position: z.enum(['top', 'left']).default('top'),
  items: z.array(z.object({
    label: I18nLabelSchema,
    icon: z.string().optional(),
    children: z.array(z.unknown()).describe('Child components')
  })),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const PageCardProps = z.object({
  title: I18nLabelSchema.optional(),
  bordered: z.boolean().default(true),
  actions: z.array(z.string()).optional(),
  /** Slot for nested content in the Card body */
  body: z.array(z.unknown()).optional().describe('Card content components (slot)'),
  /** Slot for footer content */
  footer: z.array(z.unknown()).optional().describe('Card footer components (slot)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ----------------------------------------------------------------------
 * 2. Record Context Components
 * ----------------------------------------------------------------------
 */

export const RecordDetailsProps = z.object({
  columns: z.enum(['1', '2', '3', '4']).default('2').describe('Number of columns for field layout (1-4)'),
  layout: z.enum(['auto', 'custom']).default('auto').describe('Layout mode: auto uses object compactLayout, custom uses explicit sections'),
  sections: z.array(z.string()).optional().describe('Section IDs to show (required when layout is "custom")'),
  fields: z.array(z.string()).optional().describe('Explicit field list to display (optional, overrides compactLayout)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordRelatedListProps = z.object({
  objectName: z.string().describe('Related object name (e.g., "task", "opportunity")'),
  relationshipField: z.string().describe('Field on related object that points to this record (e.g., "account_id")'),
  columns: z.array(z.string()).describe('Fields to display in the related list'),
  sort: z.union([
    z.string(),
    z.array(z.object({
      field: z.string(),
      order: z.enum(['asc', 'desc'])
    }))
  ]).optional().describe('Sort order for related records'),
  limit: z.number().int().positive().default(5).describe('Number of records to display initially'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Additional filter criteria for related records'),
  title: I18nLabelSchema.optional().describe('Custom title for the related list'),
  showViewAll: z.boolean().default(true).describe('Show "View All" link to see all related records'),
  actions: z.array(z.string()).optional().describe('Action IDs available for related records'),
  /**
   * Enable an "Add" affordance that links EXISTING records via a picker, rather
   * than only "+ New" (create-and-navigate). Generic over m2m / junction
   * relationships: pick records from `add.picker.object` (the far side) and
   * create a link row in `objectName` with `{[relationshipField]: <parentId>,
   * [add.linkField]: <pickedId>}`. Omit `linkField` for a plain 1:m re-parent
   * (the picked child's `relationshipField` is set to the parent id instead).
   * Server-side rules still apply on insert (e.g. the AI-seat cap), and their
   * errors surface in the dialog. The canonical use is "Assigned Users" on a
   * permission set (objectName=`sys_user_permission_set`,
   * relationshipField=`permission_set_id`, picker.object=`sys_user`,
   * linkField=`user_id`).
   */
  add: z.object({
    picker: z.object({
      object: z.string().describe('Object to pick records from (the far side of an m2m, or the child object for a 1:m re-parent).'),
      valueField: z.string().default('id').describe('Field on the picked record used as the link value (default `id`).'),
      labelField: z.string().optional().describe('Field shown in the picker rows (defaults to the object title field).'),
      filter: z.array(ViewFilterRuleSchema).optional().describe('Restrict which records the picker offers.'),
    }).describe('Where the Add affordance sources records from.'),
    linkField: z.string().optional().describe('Field on `objectName` that stores the picked record id (junction case). Omit for a 1:m re-parent.'),
    label: I18nLabelSchema.optional().describe('Label for the Add button (default "Add").'),
  }).optional().describe('Add-existing-via-picker config (generic m2m/junction assignment).'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordHighlightsField = z.union([
  z.string(),
  z.object({
    name: z.string().describe('Field name on the record'),
    label: z.string().optional().describe('Display label (overrides schema label)'),
    icon: z.string().optional().describe('Icon name (lucide icon key)'),
    type: z.string().optional().describe('Override cell renderer type (rare)'),
  }),
]).describe('Highlight field: bare name, or {name,label?,icon?,type?}');

export const RecordHighlightsProps = z.object({
  fields: z.array(RecordHighlightsField).min(1).max(7).describe('Key fields to highlight (1-7 fields max, typically displayed as prominent cards). Each item may be a bare field name or {name, label?, icon?, type?} for inline overrides.'),
  layout: z.enum(['horizontal', 'vertical']).default('horizontal').describe('Layout orientation for highlight fields'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordActivityProps = z.object({
  /** Activity types to display (unified enum including comment, field_change, etc.) */
  types: z.array(FeedItemType).optional().describe('Feed item types to show (default: all)'),
  /** Default filter mode (Airtable-style dropdown) */
  filterMode: FeedFilterMode.default('all').describe('Default activity filter'),
  /** Allow user to switch filter modes */
  showFilterToggle: z.boolean().default(true).describe('Show filter dropdown in panel header'),
  /** Pagination */
  limit: z.number().int().positive().default(20).describe('Number of items to load per page'),
  /** Show completed activities */
  showCompleted: z.boolean().default(false).describe('Include completed activities'),
  /** Merge field_change + comment in a unified timeline */
  unifiedTimeline: z.boolean().default(true).describe('Mix field changes and comments in one timeline (Airtable style)'),
  /** Show the comment input box at the bottom */
  showCommentInput: z.boolean().default(true).describe('Show "Leave a comment" input at the bottom'),
  /** Enable @mentions in comments */
  enableMentions: z.boolean().default(true).describe('Enable @mentions in comments'),
  /** Enable emoji reactions */
  enableReactions: z.boolean().default(false).describe('Enable emoji reactions on feed items'),
  /** Enable threaded replies */
  enableThreading: z.boolean().default(false).describe('Enable threaded replies on comments'),
  /** Show notification subscription toggle (bell icon) */
  showSubscriptionToggle: z.boolean().default(true).describe('Show bell icon for record-level notification subscription'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordChatterProps = z.object({
  /** Panel position */
  position: z.enum(['sidebar', 'inline', 'drawer']).default('sidebar').describe('Where to render the chatter panel'),
  /** Panel width (for sidebar/drawer) */
  width: z.union([z.string(), z.number()]).optional().describe('Panel width (e.g., "350px", "30%")'),
  /** Collapsible */
  collapsible: z.boolean().default(true).describe('Whether the panel can be collapsed'),
  /** Default collapsed state */
  defaultCollapsed: z.boolean().default(false).describe('Whether the panel starts collapsed'),
  /** Feed configuration (delegates to RecordActivityProps) */
  feed: RecordActivityProps.optional().describe('Embedded activity feed configuration'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const RecordPathProps = z.object({
  statusField: z.string().describe('Field name representing the current status/stage'),
  stages: z.array(z.object({
    value: z.string(),
    label: I18nLabelSchema,
  })).optional().describe('Explicit stage definitions (if not using field metadata)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const PageAccordionProps = z.object({
  items: z.array(z.object({
    label: I18nLabelSchema,
    icon: z.string().optional(),
    collapsed: z.boolean().default(false),
    children: z.array(z.unknown()).describe('Child components'),
  })),
  allowMultiple: z.boolean().default(false).describe('Allow multiple panels to be expanded simultaneously'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

export const AIChatWindowProps = z.object({
  mode: z.enum(['float', 'sidebar', 'inline']).default('float').describe('Display mode for the chat window'),
  agentId: z.string().optional().describe('Specific AI agent to use'),
  context: z.record(z.string(), z.unknown()).optional().describe('Contextual data to pass to the AI'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
});

/**
 * ----------------------------------------------------------------------
 * 3. Content Element Components (Airtable Interface Parity)
 * ----------------------------------------------------------------------
 */

export const ElementTextPropsSchema = lazySchema(() => z.object({
  content: z.string().describe('Text or Markdown content'),
  variant: z.enum(['heading', 'subheading', 'body', 'caption'])
    .optional().default('body').describe('Text style variant'),
  align: z.enum(['left', 'center', 'right'])
    .optional().default('left').describe('Text alignment'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementNumberPropsSchema = lazySchema(() => z.object({
  object: z.string().describe('Source object'),
  field: z.string().optional().describe('Field to aggregate'),
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max'])
    .describe('Aggregation function'),
  filter: FilterConditionSchema.optional().describe('Filter criteria'),
  format: z.enum(['number', 'currency', 'percent']).optional().describe('Number display format'),
  prefix: z.string().optional().describe('Prefix text (e.g. "$")'),
  suffix: z.string().optional().describe('Suffix text (e.g. "%")'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementImagePropsSchema = lazySchema(() => z.object({
  src: z.string().describe('Image URL or attachment field'),
  alt: z.string().optional().describe('Alt text for accessibility'),
  fit: z.enum(['cover', 'contain', 'fill'])
    .optional().default('cover').describe('Image object-fit mode'),
  height: z.number().optional().describe('Fixed height in pixels'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * Read-only, synthesized view of a metadata item, embedded inline in content
 * (ADR-0051). This is the *inline form* of ADR-0046 §3.5 ("derived content is
 * rendered, never written") and the component a ` ```metadata ` doc fence
 * compiles to. Because it renders the platform's *own* metadata via the
 * platform's *own* viewer, it carries no expressions or actions — it stays on
 * the data side of the §3.4 trust boundary and is safe to embed in inert docs
 * (`embeddableInDoc`). The view is resolved live at read time, then projected
 * to the reader's permissions automatically (see `detail` for the distinct,
 * author-controlled altitude projection). `object` embeds are deferred
 * (ADR-0051 §5).
 */
export const ElementMetadataViewerPropsSchema = lazySchema(() => z.object({
  type: z.enum(['state_machine', 'flow', 'permission'])
    .describe('Metadata view kind (ADR-0051): state_machine | flow | permission'),
  name: z.string()
    .describe('Target metadata item name; resolved package-scoped (ADR-0048), then dependencies (ADR-0046 §3.3)'),
  object: z.string().optional()
    .describe('Owning object — required for object-scoped kinds: state_machine is a rule ON an object (ADR-0020), permission renders a matrix FOR one; omit for top-level flow'),
  mode: z.enum(['diagram', 'matrix', 'summary']).optional()
    .describe('Render form; defaults per type (diagram for flow/state_machine, matrix for permission)'),
  detail: z.enum(['business', 'technical']).optional().default('business')
    .describe('Authoring altitude (ADR-0051 §3.4): business collapses technical flow nodes to business steps + approvals. NOT access (cf. book.audience); permission projection is automatic and render-time, never set here'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * ----------------------------------------------------------------------
 * 4. Interactive Element Components (Phase B — Element Library)
 * ----------------------------------------------------------------------
 */

export const ElementButtonPropsSchema = lazySchema(() => z.object({
  label: I18nLabelSchema.describe('Button display label'),
  variant: z.enum(['primary', 'secondary', 'danger', 'ghost', 'link'])
    .optional().default('primary').describe('Button visual variant'),
  size: z.enum(['small', 'medium', 'large'])
    .optional().default('medium').describe('Button size'),
  icon: z.string().optional().describe('Icon name (Lucide icon)'),
  iconPosition: z.enum(['left', 'right'])
    .optional().default('left').describe('Icon position relative to label'),
  disabled: z.boolean().optional().default(false).describe('Disable the button'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementFilterPropsSchema = lazySchema(() => z.object({
  object: z.string().describe('Object to filter'),
  fields: z.array(z.string()).describe('Filterable field names'),
  targetVariable: z.string().optional().describe('Page variable to store filter state'),
  layout: z.enum(['inline', 'dropdown', 'sidebar'])
    .optional().default('inline').describe('Filter display layout'),
  showSearch: z.boolean().optional().default(true).describe('Show search input'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementFormPropsSchema = lazySchema(() => z.object({
  object: z.string().describe('Object for the form'),
  fields: z.array(z.string()).optional().describe('Fields to display (defaults to all editable fields)'),
  mode: z.enum(['create', 'edit']).optional().default('create').describe('Form mode'),
  submitLabel: I18nLabelSchema.optional().describe('Submit button label'),
  onSubmit: ExpressionInputSchema.optional().describe('Action expression on form submit (CEL)'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

export const ElementRecordPickerPropsSchema = lazySchema(() => z.object({
  object: z.string().describe('Object to pick records from'),
  displayField: z.string().describe('Field to display as the record label'),
  searchFields: z.array(z.string()).optional().describe('Fields to search against'),
  filter: FilterConditionSchema.optional().describe('Filter criteria for available records'),
  multiple: z.boolean().optional().default(false).describe('Allow multiple record selection'),
  targetVariable: z.string().optional().describe('Page variable to bind selected record ID(s)'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * A single-line free-text input — the data-entry half of an SDUI page (Airtable
 * "text"/"number" field parity). The console renderer binds the typed value into
 * a page variable via the {@link PageVariableSchema} `source` convention (the
 * variable whose `source` equals this component's `id`), exposing it to
 * expressions as `page.<var>` and to submit actions as a `{{page.<var>}}` token.
 * A whole free-text family lives under one element: `inputType` selects the
 * native modality (text/email/number/…), keeping genuinely-distinct inputs
 * (textarea, select, checkbox) free to arrive as their own elements later.
 */
export const ElementTextInputPropsSchema = lazySchema(() => z.object({
  inputType: z.enum(['text', 'email', 'number', 'tel', 'url', 'password'])
    .optional().default('text')
    .describe('Native input type — drives keyboard/validation affordance and how the bound value is coerced (number → numeric).'),
  label: I18nLabelSchema.optional().describe('Field label shown above the input'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text shown when empty'),
  defaultValue: z.union([z.string(), z.number()]).optional()
    .describe('Initial value; seeds the bound page variable on mount'),
  required: z.boolean().optional().default(false).describe('Mark the field as required'),
  disabled: z.boolean().optional().default(false).describe('Disable the input'),
  description: I18nLabelSchema.optional().describe('Helper text shown below the input'),
  targetVariable: z.string().optional()
    .describe('Page variable this input writes to. Declarative hint; the live binding resolves via the variable whose `source` equals this component id (see PageVariableSchema).'),
  /** ARIA accessibility */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * ----------------------------------------------------------------------
 * Component Props Map
 * Maps Component Type to its Property Schema
 * ----------------------------------------------------------------------
 */
export const ComponentPropsMap = {
  // Structure
  'page:header': PageHeaderProps,
  'page:tabs': PageTabsProps,
  'page:card': PageCardProps,
  'page:footer': EmptyProps,
  'page:sidebar': EmptyProps,
  'page:accordion': PageAccordionProps,
  'page:section': EmptyProps,

  // Record
  'record:details': RecordDetailsProps,
  'record:related_list': RecordRelatedListProps,
  'record:highlights': RecordHighlightsProps,
  'record:activity': RecordActivityProps,
  'record:chatter': RecordChatterProps,
  'record:path': RecordPathProps,

  // Navigation
  'app:launcher': EmptyProps,
  'nav:menu': EmptyProps,
  'nav:breadcrumb': EmptyProps,

  // Utility
  'global:search': EmptyProps,
  'global:notifications': EmptyProps,
  'user:profile': EmptyProps,
  
  // AI
  'ai:chat_window': AIChatWindowProps,
  'ai:suggestion': z.object({ context: z.string().optional() }),

  // Content Elements
  'element:text': ElementTextPropsSchema,
  'element:number': ElementNumberPropsSchema,
  'element:image': ElementImagePropsSchema,
  'element:metadata_viewer': ElementMetadataViewerPropsSchema, // ADR-0051: inline read-only metadata view (embeddableInDoc)
  'element:divider': EmptyProps,

  // Interactive Elements
  'element:button': ElementButtonPropsSchema,
  'element:filter': ElementFilterPropsSchema,
  'element:form': ElementFormPropsSchema,
  'element:record_picker': ElementRecordPickerPropsSchema,
  'element:text_input': ElementTextInputPropsSchema,
} as const;

/**
 * Type Helper to extract props from map
 */
export type ComponentProps<T extends keyof typeof ComponentPropsMap> = z.infer<typeof ComponentPropsMap[T]>;
export type ComponentPropsInput<T extends keyof typeof ComponentPropsMap> = z.input<typeof ComponentPropsMap[T]>;
