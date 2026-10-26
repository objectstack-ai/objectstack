/**
 * ObjectUI ESLint rule: no-inline-spec-config
 *
 * Bans hand-redefining a view-config type *inline* when `@objectstack/spec`
 * already exports it. objectql.ts states the rule "Never Redefine Types.
 * ALWAYS import them." — a hand mirror silently drifts from the spec (the bug
 * class behind "shipped-but-inert" metadata: the type says a field exists, the
 * served data never carries it, the feature no-ops with no error).
 *
 * A field like
 *     appearance?: { showDescription?: boolean; allowedVisualizations?: string[] }
 * must instead reference the spec type
 *     appearance?: AppearanceConfig            // or Partial<AppearanceConfig>
 *     appearance?: Partial<AppearanceConfig> & { ...transitional extension }
 *
 * Flagged: ONLY a *bare* inline object type (`TSTypeLiteral`) on a known
 * spec-backed field. A spec-type reference (`AppearanceConfig`,
 * `Partial<AppearanceConfig>`) or an intersection that includes one
 * (`Partial<X> & { ext }`, the transitional pattern) is fine.
 *
 * Pending conversion (still inline in objectql.ts — convert each, then add it
 * here so the ratchet covers it): kanban → KanbanConfig, calendar →
 * CalendarConfig, gantt → GanttConfig, addRecord → AddRecordConfig,
 * userFilters → UserFilters.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

// field name → the @objectstack/spec/ui type it must reference.
const SPEC_BACKED_FIELDS = {
  userActions: 'UserActionsConfig',
  appearance: 'AppearanceConfig',
  selection: 'SelectionConfig',
  pagination: 'PaginationConfig',
  grouping: 'GroupingConfig',
  gallery: 'GalleryConfig',
  timeline: 'TimelineConfig',
};

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow redefining a spec-backed view-config inline; reference the @objectstack/spec type instead (never redefine spec types).',
      recommended: true,
    },
    schema: [],
    messages: {
      inline:
        "Don't redefine `{{field}}` inline — import `{{type}}` from '@objectstack/spec/ui' and use `{{field}}?: {{type}}` (or `Partial<{{type}}> & {{{ext}}}` for a transitional extension). A hand mirror silently drifts from the spec.",
    },
  },
  create(context) {
    return {
      TSPropertySignature(node) {
        if (!node.key || node.key.type !== 'Identifier') return;
        const type = SPEC_BACKED_FIELDS[node.key.name];
        if (!type) return;
        const annotation = node.typeAnnotation && node.typeAnnotation.typeAnnotation;
        // Only a *bare* inline object type is a redefinition. A type reference
        // or an intersection (Partial<X> & { ext }) is the sanctioned form.
        if (annotation && annotation.type === 'TSTypeLiteral') {
          context.report({
            node: annotation,
            messageId: 'inline',
            data: { field: node.key.name, type, ext: ' …' },
          });
        }
      },
    };
  },
};
