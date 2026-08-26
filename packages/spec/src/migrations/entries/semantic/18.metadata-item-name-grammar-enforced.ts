// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'metadata-item-name-grammar-enforced',
  surface: 'metadata item names (the `name` half of the `type`/`name` addressing pair — '
    + '`saveMetaItem` / `publishMetaItem`, `PUT /api/v1/meta/:type/:name` and the compound '
    + '`:type/:section/:name` fold)',
  replacement: 'lowercase snake_case segments, optionally dot-qualified — '
    + 'the pattern family of METADATA_ITEM_NAME_PATTERN, i.e. one or more [a-z][a-z0-9_]* '
    + 'segments joined by single dots (`crm_lead`, `crm_lead.pipeline`). A name that spelled '
    + 'a sub-resource with a slash (`views/all_leads`) is re-authored with a dot qualifier '
    + '(`crm_lead.pipeline` — the `ViewItemNameSchema` convention, now enforced with the '
    + 'qualifier optional) or flattened with an underscore (`views_all_leads`); containment '
    + 'is expressed by structure, never by a separator inside the identity string.',
  reason:
    'Maintainer ruling (2026-08-25): metadata item names must not contain `/` — '
    + 'identity-with-separator is the measured root cause of a defect family (URL arity '
    + 'mismatches, dual-arity route-mount obligations, route shadowing, a two-rule URL '
    + 'spelling split in one SDK file). The grammar was entirely unconstrained at the door: '
    + 'the empty string, `//` and `Views/All Leads` were all accepted and stored as item '
    + 'names, and a slash in the name bypassed the unrecognised-metadata-type refusal '
    + '(`type=fieldz name=a/b` was accepted while `type=fieldz name=a` was 400). Whether a '
    + 'stored slash-name (out-of-repo deployments only — the in-repo census measured zero) '
    + 'should be renamed, and to what, is a judgment the chain cannot make, so no mechanical '
    + 'conversion ships with the narrowing.',
  acceptanceCriteria:
    'Every write through `saveMetaItem` / `publishMetaItem` whose name is lowercase '
    + 'snake_case segments optionally joined by single dots succeeds exactly as before, flat '
    + 'and dotted alike. Any other name — slash, empty, whitespace, uppercase, '
    + 'leading/trailing/double dots — is refused `400 INVALID_REQUEST` with the grammar and '
    + 'the dotted prescription in the message, and nothing is persisted. Reads and '
    + '`deleteMetaItem` still answer for pre-grammar residue rows, so any stored junk name '
    + 'remains listable and clearable.',
};
