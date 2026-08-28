// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-form-view-predicate-features-root-refused',
  surface: 'form-view predicates naming the `features.*` scope root — section-level '
    + '`visibleWhen`, field-level `visibleWhen` at any nesting depth, and per-option '
    + '`visibleWhen` authored inline in the form view (`FormViewSchema`, including the '
    + 'flattened runtime form overlay and the deprecated `visibleOn` alias spellings)',
  replacement: 'gate by record state (`record.*` in runtime forms, `data.*` in metadata '
    + 'forms), or move the feature-gated surface onto an app page component or action — '
    + 'the predicate surfaces where `features.*` stays bound and stays legal. No rewrite '
    + 'is mechanical: a feature-flag gate and a record-state gate answer different '
    + 'questions, so the author chooses which surface the gate belongs on.',
  reason:
    'objectstack#12665, ruled 2026-08-27 on objectui#6262 (option B — vocabulary '
    + 'narrowing): one authored form view is served on two kinds of route, and a '
    + '`features.*` predicate got two verdicts from the same text. Inside an app '
    + '(`/apps/:appName/*`) the root resolves against the real auth-config flags; on the '
    + 'standalone form routes (`/forms/:name`, public `/f/:slug`) no app context exists, '
    + 'the root is UNBOUND, the predicate faults — and `visibleWhen`\'s fault fallback is '
    + 'visible, so the field or section a feature flag was meant to hide is shown to '
    + 'everyone (fail-open, on an access-shaped key). Measured before ruling and '
    + 're-verified at dispatch (2026-08-28): ZERO authored `features.*` form-view '
    + 'predicates exist across objectui apps/examples/content, against an 18-hit positive '
    + 'control on authored `visibleWhen` predicates — so the vocabulary is narrowed at '
    + 'the authoring door instead of building an auth-config fetch plus pre-load '
    + 'semantics on a route with zero consumers. App-context predicate surfaces '
    + '(page components, actions, bulk-action eligibility) keep `features.*` unchanged.',
  acceptanceCriteria:
    'A form view carrying a predicate that names `features` in root position (dotted '
    + 'member access, index access, or the bare root — outside string literals) is '
    + 'refused at parse with a prescriptive issue naming the root, the surface, the '
    + 'fail-open reason and the ruling. Predicates on permitted roots parse unchanged, '
    + 'including member access on a record field that happens to be named `features` '
    + '(`record.features.x`). Stored form views are unaffected until their next '
    + 'authoring-path save (zero such documents were measured to exist); on refusal the '
    + 'author re-gates by record state or moves the gate to an app surface.',
};
