// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'import-run-automations-declared-default-corrected',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell (see the note on `spec-type-alias-input-suffix-retired`).
  surface:
    'api.ImportRequest runAutomations — the declared default of the key on BOTH import '
    + 'bodies, POST /api/v1/data/:object/import (ImportRequest) and its async twin POST '
    + '/api/v1/data/:object/import/jobs (CreateImportJobRequest, which IS the same schema '
    + 'object). It was declared default(false) and described as "off by default for '
    + 'bulk"; it is now default(true), which is what the server has always done',
  replacement:
    'an explicit runAutomations: false on any import request that is meant to load rows '
    + 'without firing triggers/hooks. That spelling is unchanged and has always been the '
    + 'only one the server read — what changes is that omitting the key now DECLARES what '
    + 'it already DID. Callers who want automations on need write nothing',
  reason:
    'A DECLARATION corrected to match a runtime that did not move — the inverse of a '
    + "behaviour flip, and registered here for the reason protocol 12's "
    + '`rest-requireauth-default-flip` and this major\'s '
    + '`action-descriptor-resume-authority-default-flip` are: whether a given import was '
    + 'meant to fire triggers is a judgment no transform can make, so the prescription is '
    + 'a TODO rather than a rewrite. The server decides in import-prepare.ts with '
    + '`body?.runAutomations !== false`, i.e. an omitted flag runs automations, and has '
    + 'since #2922 — automations always ran on import historically (the engine ignored '
    + 'the flag entirely before then), so opt-out was made the explicit act, matching '
    + 'platform convention. The schema said the opposite in both machine-readable and '
    + "human-readable form, and both SHIPPED: `.default(false)` in `@objectstack/spec`'s "
    + 'JSON Schema, and the describe prose in the published reference tables for both '
    + 'defs. '
    + '⚠️ Nothing in this repo reconciled the two and NO deployed caller changes '
    + 'behaviour: no request path parses an import body through this schema — the route '
    + 'reads the raw body, and the sole reference to `CreateImportJobRequestSchema` is '
    + 'the declarative `ImportJobApiContracts` catalog entry, a declaration and not a '
    + 'parse. That is exactly why this needed a ruling rather than a docs edit: the '
    + 'divergence was unobservable in-tree and observable only to a consumer OUTSIDE it. '
    + 'A client or SDK that validated its request through the published schema '
    + 'materialised `runAutomations: false` from the declared default and sent it '
    + 'explicitly, and the server honoured it — so the same request body produced '
    + 'opposite behaviour depending on whether the caller validated before sending, with '
    + 'the validating caller silently losing its triggers. Nothing rejected it, nothing '
    + 'warned, and the reference page told an author the wrong thing in the other '
    + 'direction. There is deliberately NO schema tombstone and no D2 conversion: no key '
    + 'is removed, and an HTTP request body is neither authored nor persisted — the same '
    + 'disposition `notification-list-cursor-retired` (#6361) takes for the sibling '
    + 'default on this major, and `batch-options-validate-only-retired` before it. The '
    + 'declared move itself is recorded mechanically, per key, in '
    + 'DEFAULT_CHANGES_BY_MAJOR[17] (#4666), whose `from`/`to` fingerprints are '
    + 're-derived on every build. Maintainer ruling 2026-08-09 (#6704, disposition A: '
    + 'the spec follows the runtime). ADR-0049 / ADR-0078.',
  acceptanceCriteria:
    'Every import request of yours that must NOT fire triggers sends `runAutomations: '
    + 'false` explicitly, rather than omitting the key and trusting the old declared '
    + 'default. The check is worth doing precisely where it looks unnecessary: if you '
    + 'build the body by parsing it through `ImportRequestSchema` (or the published JSON '
    + 'Schema) and then send the PARSED object, your bulk loads were running with '
    + 'automations OFF and will now run with them ON — that is the only class whose '
    + 'behaviour changes, and it changes toward what an unvalidated caller always got. '
    + '⚠️ Behaviour on the wire is deliberately UNCHANGED and should be verified as '
    + 'such: a body that omits `runAutomations` fired triggers before this change and '
    + 'fires them after, and `runAutomations: false` turns them off before and after. '
    + 'Nothing starts being refused — the route never validated this body against the '
    + 'schema and does not begin to. `dryRun` is unaffected and still runs NO automations '
    + 'whatever the flag says (#6037).',
};
