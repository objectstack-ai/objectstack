---
'@object-ui/core': patch
---

refactor(core)!: retire forty-two zero-consumer entry exports, and delete the query-AST convenience pair nothing reads

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/core#buildQueryAST, @object-ui/core#defaultQueryASTBuilder, @object-ui/core#CANONICAL_COLUMN_IDENTITY_KEY, @object-ui/core#LEGACY_COLUMN_IDENTITY_KEYS, @object-ui/core#normalizeColumnIdentities, @object-ui/core#CANONICAL_COLUMN_LABEL_KEY, @object-ui/core#isOpenDomAttributeFamily, @object-ui/core#AffordanceGrantRow, @object-ui/core#normalizeObjectSortability, @object-ui/core#OBJECT_SORTABILITY_KEY, @object-ui/core#ACTION_SWITCHED_OFF_KEY, @object-ui/core#CASCADE_DELETE_OBJECTS_KEY, @object-ui/core#compareCellValues, @object-ui/core#SUBJECT_PERMISSIONS, @object-ui/core#SUBJECT_CAPABILITIES, @object-ui/core#ROW_PREDICATE_CANONICAL_ROOT, @object-ui/core#NAVIGATION_ALIAS_KEYS, @object-ui/core#HOST_DISPATCH_ACTION_KEYS, @object-ui/core#KNOWN_ACTION_KEYS, @object-ui/core#classifyActionKeys, @object-ui/core#hasDeprecatedObjectParams, @object-ui/core#warnOnDeprecatedObjectParams, @object-ui/core#isLegacyActionEnvelope, @object-ui/core#actionCopyText, @object-ui/core#fillTransitionalCopy, @object-ui/core#toCSSColor, @object-ui/core#generateTypographyVars, @object-ui/core#generateBorderRadiusVars, @object-ui/core#generateShadowVars, @object-ui/core#isElementDataSourceBlock, @object-ui/core#isErrorCode, @object-ui/core#formatErrorMessage, @object-ui/core#isDebugEnabled, @object-ui/core#ContextTokenName, @object-ui/core#isBuiltinAggregate, @object-ui/core#resolveMeasureLabel, @object-ui/core#resolveRelationshipTarget, @object-ui/core#resolveDimensionFieldOptions, @object-ui/core#INTEGER_AGGREGATES, @object-ui/core#isColorLiteral, @object-ui/core#buildFieldColorMap, @object-ui/core#FieldColorOption) the retired operands are client-side helpers, constants, symbol keys and three types of the UI core package; nothing in the workspace or in hotcrm imports any of them from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names them, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports any of these forty-two names from `@object-ui/core`. None had an importer anywhere in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected.

Two of them are **gone from the package, not only from the entry**, because nothing inside the package read them either: `buildQueryAST` and the `defaultQueryASTBuilder` instance it wrapped are deleted from `query/query-ast.ts`.

The other forty stay in their modules for the code and tests that read them and only leave the entry. Every other name the entry exported stays exported unchanged, among them `QueryASTBuilder`, `columnIdentity`, `columnHeader`, `normalizeColumnIdentity`, `toDomProps`, `pickDomProps`, `AFFORDANCE_GRANTS`, `attachObjectSortability`, `readObjectSortability`, `markSwitchedOffActions`, `isActionSwitchedOff`, `attachCascadeDeleteObjects`, `readCascadeDeleteObjects`, `getSortValue`, `compareSortValues`, `bindSubjectPermissions`, `subjectPermissionsOf`, `bindSubjectCapabilities`, `subjectCapabilitiesOf`, `detectNonCanonicalRowSpelling`, `ACTION_DEF_KEYS`, `SPEC_ACTION_KEYS`, `RETIRED_ACTION_KEYS`, `warnOnUnknownActionKeys`, `interpretActionResponse`, `readActionPayload`, `actionCopySource`, `fillTemplateHoles`, `generateThemeVars`, `generateColorVars`, `elementDataSourceBlock`, `ERROR_CODES`, `createError`, `ObjectUIError` with all its subclasses, `debugLog`, `parseDebugFlags`, `CONTEXT_TOKENS`, `resolveFilterPlaceholders`, `buildChartSeries`, `isIntegerAggregate`, `resolveDimensionFieldMeta` and `createFieldColorResolver`.

What leaves, and what to write instead:

- FROM `buildQueryAST(query)`, `defaultQueryASTBuilder` TO `new QueryASTBuilder().build(query)`.
- FROM `CANONICAL_COLUMN_IDENTITY_KEY`, `LEGACY_COLUMN_IDENTITY_KEYS`, `CANONICAL_COLUMN_LABEL_KEY` TO `columnIdentity(column)` / `columnHeader(column)`, which read the canonical key and its legacy spellings; FROM `normalizeColumnIdentities(columns)` TO `columns.map(normalizeColumnIdentity)`.
- FROM `isOpenDomAttributeFamily` TO `toDomProps` / `pickDomProps`, which already pass every `data-*` and `aria-*` key.
- FROM `AffordanceGrantRow` TO `AffordanceGrant`, or `(typeof AFFORDANCE_GRANTS)[ConsoleAffordance]` for one row.
- FROM `normalizeObjectSortability`, `OBJECT_SORTABILITY_KEY` TO `attachObjectSortability` / `readObjectSortability`.
- FROM `ACTION_SWITCHED_OFF_KEY` TO `markSwitchedOffActions` / `markSwitchedOffActionsByObject` / `isActionSwitchedOff`.
- FROM `CASCADE_DELETE_OBJECTS_KEY` TO `attachCascadeDeleteObjects` / `readCascadeDeleteObjects`.
- FROM `compareCellValues(a, b, options)` TO `compareSortValues(getSortValue(a, options), getSortValue(b, options))`.
- FROM `SUBJECT_PERMISSIONS`, `SUBJECT_CAPABILITIES` TO `bindSubjectPermissions` / `subjectPermissionsOf` and `bindSubjectCapabilities` / `subjectCapabilitiesOf`.
- FROM `ROW_PREDICATE_CANONICAL_ROOT` TO the literal `'record'`, or `detectNonCanonicalRowSpelling` to check a predicate.
- FROM `NAVIGATION_ALIAS_KEYS`, `HOST_DISPATCH_ACTION_KEYS`, `KNOWN_ACTION_KEYS`, `classifyActionKeys` TO `warnOnUnknownActionKeys`, which classifies an action against the same vocabulary, or `ACTION_DEF_KEYS` / `SPEC_ACTION_KEYS` for the authored key lists.
- FROM `hasDeprecatedObjectParams`, `warnOnDeprecatedObjectParams` TO nothing: `ActionRunner` warns about deprecated object params itself when it runs the action.
- FROM `isLegacyActionEnvelope` TO `interpretActionResponse` / `readActionPayload`, which unwrap the legacy envelope.
- FROM `actionCopyText`, `fillTransitionalCopy` TO `actionCopySource` with `hasTemplateHoles` / `fillTemplateHoles`.
- FROM `toCSSColor`, `generateTypographyVars`, `generateBorderRadiusVars`, `generateShadowVars` TO `generateThemeVars(theme)`, which emits all of those variables, or `generateColorVars` for the colour block alone.
- FROM `isElementDataSourceBlock` TO nothing a host needs: the component registry reads it when `elementDataSourceBlock` marks a renderer.
- FROM `isErrorCode(code)` TO `code in ERROR_CODES`; FROM `formatErrorMessage(error)` TO `error.message` with `ERROR_CODES[error.code]` for the suggestion and doc link.
- FROM `isDebugEnabled` TO `debugLog` / `debugTime`, which are no-ops when debug mode is off.
- FROM `ContextTokenName` TO `(typeof CONTEXT_TOKENS)[number]`.
- FROM `isBuiltinAggregate`, `resolveMeasureLabel` TO `buildChartSeries` with `builtinAggregateLabels`, which labels a built-in aggregate measure the same way; FROM `INTEGER_AGGREGATES` TO `isIntegerAggregate`.
- FROM `resolveDimensionFieldOptions(...)` TO `resolveDimensionFieldMeta(...)`, the same walk, reading each entry's `options`; FROM `resolveRelationshipTarget` TO `resolveDimensionFieldMeta`, which follows the relationship for a dotted path.
- FROM `isColorLiteral`, `buildFieldColorMap`, `FieldColorOption` TO `createFieldColorResolver(fieldDef)`, which builds the colour map and accepts colour literals as-is.
