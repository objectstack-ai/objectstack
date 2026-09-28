// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A TYPE-surface narrowing registered here for the reason
// `spec-type-alias-input-suffix-retired` is: the surface is a TypeScript
// declaration, so there is no stored source for a D2 conversion to rewrite, and
// the compiler error it produces names the canonical vocabulary but not which
// member an alias spelling maps to. This guide is the channel that carries that
// second half. Nothing at rest moves and the runtime accept set is unchanged.
export const entry: SemanticMigration = {
  id: 'view-filter-rule-operator-input-canonical',
  // No backticks in `surface` — build-upgrade-guide renders it inside a code
  // span already, and a nested backtick would close it.
  surface:
    'ui.ViewFilterRule operator — the TypeScript INPUT type of a view filter rule, on every '
    + 'carrier of ViewFilterRuleSchema (ListView.filter, a view tab filter, Page.filterBy, the '
    + 'related-list, record-picker and object-* block filter doors)',
  replacement:
    'the canonical operator id, a member of ViewFilterOperator (VIEW_FILTER_OPERATORS). A '
    + 'typed rule written operator: "eq" becomes operator: "equals"; every legacy spelling maps '
    + 'to exactly one canonical id, and VIEW_FILTER_OPERATOR_ALIASES is that map (ne and neq to '
    + 'not_equals, gt to greater_than, gte to greater_than_or_equal, nin and notIn to not_in, '
    + 'isNull to is_null, and the rest). A value that is not yet known to be an operator — '
    + 'read from storage, a URL or user input — is typed unknown and handed to '
    + 'ViewFilterRuleSchema.safeParse, or folded with normalizeFilterOperator first; the '
    + 'schema stays the judge',
  reason:
    'The operator key is a z.preprocess over the alias fold, and zod types a preprocess\'s '
    + 'INPUT from its function\'s parameter. That parameter was unknown, so ViewFilterRule (a '
    + 'z.input) typed operator as unknown: a rule with operator: 42, or any string at all, '
    + 'compiled on every carrier and was refused only when the door parsed it. The typed input '
    + 'is now the canonical ViewFilterOperator, the vocabulary the alias table\'s own contract '
    + 'says new producers emit. '
    + 'The RUNTIME does not move: the door still folds every spelling it folded before to '
    + 'canonical and still refuses a non-string with the enum\'s own '
    + 'issue at operator, so a stored sys_metadata row, a YAML or JSON body, and a plain-JS '
    + 'producer that carries an alias keep parsing exactly as before, and os validate answers '
    + 'as before. Metadata AT REST is deliberately NOT rewritten and this entry adds no D2 '
    + 'conversion: what narrows is only what TypeScript source may write. '
    + 'The exported normalizeFilterOperator keeps its unknown parameter on purpose — it exists '
    + 'to fold untyped stored metadata, and its callers pass raw strings by design. ADR-0087 / '
    + 'ADR-0122.',
  acceptanceCriteria:
    'Your TypeScript compiles: tsc reports each typed rule whose operator is an alias or a '
    + 'non-string, naming the canonical vocabulary. Rewrite each alias to the id '
    + 'VIEW_FILTER_OPERATOR_ALIASES maps it to — the rule selects the same rows, because the '
    + 'door already folded it to that id — and for a value typed string that is really '
    + 'unvalidated input, type it unknown and parse it rather than casting it. Stored views need '
    + 'no action: they load and parse as before.',
};
