// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared changes to the DEFAULT VALUE of an already-authorable key (#4666).
 *
 * ## What this table is for
 *
 * `authorable-defaults/` records what an author gets when they omit each key.
 * Moving one of those values silently changes the behaviour of metadata that is
 * ALREADY DEPLOYED — the author wrote nothing, so there is nothing to reject
 * and nothing to warn about. `check:authorable-surface` therefore refuses any
 * such move until it is declared here, by its exact `${defKey}:${name}` and its
 * exact before/after fingerprints.
 *
 * This is the "acknowledged change" exit, and it is deliberately NOT a bare
 * allowlist. Every field is re-derived on every run from something the entry's
 * author does not control (see `authoriseDefaultChanges` in
 * `authorable-defaults.ts` for the four properties in full):
 *
 *   - `from` must equal the baseline fingerprint — read out of git at the merge
 *     base with origin/main, which the commit under test cannot rewrite;
 *   - `to` must equal what the build EMITS. The moment the default moves again,
 *     or is reverted, this entry stops matching and the gate goes red naming
 *     it. An entry cannot outlive the fact it describes;
 *   - only entries at the CURRENT protocol major authorise anything. Older
 *     majors' rows are the historical record;
 *   - `reason` is printed in full by every build that consumes the entry, so an
 *     acknowledged default flip announces itself in the log rather than passing
 *     in silence (#4690: a gate that quietly exits 0 is worse than no gate).
 *
 * ## What belongs here, and what does not
 *
 *   - **Belongs**: the default of a key that already existed moved, gained a
 *     value where it had none, or lost one.
 *   - **Does not**: a NEW key that ships with a default (no deployed document
 *     could have omitted a key that did not exist — the authorable-surface
 *     ratchet records the addition); a tightened or loosened CONSTRAINT
 *     (`.min()` / `.max()`), which is deliberately outside this ratchet because
 *     it REJECTS the offending document loudly — maintainer ruling on #4666,
 *     direction B; a retirement (`retiredKey()`), which goes through
 *     RETIRED_KEYS_BY_MAJOR.
 *
 * ## Writing an entry
 *
 * The gate prints a copy-pasteable block naming the exact key and both
 * fingerprints. Fill in `reason` with what changes for a consumer who was
 * relying on the OLD value and what they should write to keep it — that
 * sentence is the entire human record of a change no error message will ever
 * carry, and it is what a build prints when it accepts the flip.
 *
 * A default change that also warrants a migration TODO should get one: add a
 * `semantic` entry to the major's step in `src/migrations/registry.ts` so it
 * reaches `spec-changes.json`, the generated upgrade guide and
 * `os migrate meta`. This table records that the change was DECLARED; the
 * migration chain is the prescription a consumer follows.
 */

import type { DeclaredDefaultChange } from './authorable-defaults.js';

/**
 * Declared default changes, keyed by the protocol major that shipped them.
 *
 * The table landed EMPTY at major 17 — that emptiness was the ratchet's own
 * proof that every default in the tree matched its recorded fingerprint. The
 * first entry written (#6361) is worth noting for what kind of change opened
 * the account: not a behaviour flip, but the removal of a default that had
 * never once been applied.
 *
 * The `runAutomations` pair (#6704) is the same family seen from the other
 * side, and the two read best together: where #6361 deleted a fiction, this one
 * REPLACES a fiction with the fact. Both are declarations that no request path
 * ever executed; neither moves a byte on the wire. A ratchet row whose `reason`
 * says "nothing deployed changes behaviour" is therefore not a smell here — for
 * an HTTP request schema nothing parses, it is the expected shape, and the
 * consumer who IS affected is the one outside this repo who parses the
 * published JSON Schema himself.
 */
/**
 * Shared by the two `runAutomations` rows below — `CreateImportJobRequestSchema`
 * IS `ImportRequestSchema`, so one edit moves two published defaults and the two
 * rows would otherwise be a copy-paste pair that can drift apart.
 */
const IMPORT_RUN_AUTOMATIONS_REASON =
  'The declared default was WRONG about the shipped server, and this row corrects the '
  + 'declaration rather than the behaviour. `POST /api/v1/data/:object/import` (and its '
  + 'async twin `.../import/jobs`) decides in `packages/rest/src/import-prepare.ts` with '
  + '`body?.runAutomations !== false` — an OMITTED flag has run automations since #2922, '
  + 'because automations always ran on import historically (the engine ignored the flag '
  + 'entirely before then) and because the platform convention is to fire triggers on '
  + 'import (Salesforce does). The schema said the opposite, in both machine-readable and '
  + 'human-readable form: `.default(false)` shipped in `@objectstack/spec`\'s JSON Schema, '
  + 'and the `describe` prose ("off by default for bulk") rendered into the published '
  + 'reference tables for BOTH defs. '
  + 'Nothing in this repo reconciled the two, because no request path parses an import '
  + 'body through this schema — the route reads the raw body, and the only reference to '
  + '`CreateImportJobRequestSchema` is the declarative `ImportJobApiContracts` catalog '
  + 'entry, which is a declaration and not a parse. So NO deployed caller changes '
  + 'behaviour here: a request that omitted the key ran automations before and runs them '
  + 'after. '
  + 'The consumer who WAS affected — and who is the reason this is a correction and not a '
  + 'cosmetic edit — lives outside this repo: a client or SDK that parses its request '
  + 'through the published schema materialised `runAutomations: false` from the declared '
  + 'default and SENT it explicitly, and the server honoured that. Identical request '
  + 'bodies therefore produced opposite behaviour depending on whether the caller '
  + 'validated before sending, with the validating caller silently losing its triggers. '
  + 'To keep automations OFF, write it — `runAutomations: false` — which was always the '
  + 'only spelling the server actually read. To keep what the server actually did for '
  + 'you, change nothing. Reading a materialised `ImportRequestParsed.runAutomations` now '
  + 'yields `true` where it yielded `false`; the value it yields is now the value the '
  + 'server would have applied anyway. Maintainer ruling 2026-08-09 (#6704, disposition '
  + 'A: the spec follows the runtime).';

export const DEFAULT_CHANGES_BY_MAJOR: Readonly<Record<number, readonly DeclaredDefaultChange[]>> = {
  17: [
    {
      key: 'api/ListNotificationsRequest:limit',
      from: '20',
      to: '(none)',
      reason:
        'GET /api/v1/notifications declared `limit: z.number().default(20)` while the server '
        + 'has always answered its own window of 50 (MessagingService.listInbox clamps into '
        + '1..200). The declared default was never in effect on ANY request path — nothing '
        + 'parses this query string through this schema, because #3899 wired the route '
        + "catalog's requestSchema to the real entry for BODIES only — so this removal moves "
        + 'no deployed behaviour whatsoever: a caller that omitted `limit` received 50 before '
        + 'and receives 50 after. What changes is the DECLARATION, which stops promising a '
        + 'number nobody applied. The maintainer ruling (2026-08-07, #6361 Option A) allowed '
        + 'either re-declaring the real 50 or dropping the default as server-decided; the '
        + 'second was taken because the fiction was the MECHANISM, not the number — a '
        + '`.default()` on a schema no request path parses cannot take effect at whatever '
        + 'value it is spelled, and re-spelling it 50 would merely make it coincide with the '
        + 'implementation until someone moved the clamp. '
        + 'A consumer who genuinely relied on 20 was relying on client-side code of their '
        + 'own, since the wire never delivered it: to keep a 20-row window, send it — '
        + '`client.notifications.list({ limit: 20 })`. To keep what the server actually '
        + 'gave you, change nothing. Reading `ListNotificationsRequestParsed.limit` now '
        + 'yields `number | undefined` instead of `number`; the honest answer to "how big is '
        + 'the window" is the server\'s, and it is documented on the key.',
    },
    {
      key: 'api/ImportRequest:runAutomations',
      from: 'false',
      to: 'true',
      reason: IMPORT_RUN_AUTOMATIONS_REASON,
    },
    {
      // `CreateImportJobRequestSchema` IS `ImportRequestSchema` — one object, two
      // published defs (the async job body is declared identical to the sync one).
      // The ratchet names keys, not schemas, so the single edit is declared twice;
      // dropping either row leaves that def's default unauthorised and the gate red.
      key: 'api/CreateImportJobRequest:runAutomations',
      from: 'false',
      to: 'true',
      reason: IMPORT_RUN_AUTOMATIONS_REASON,
    },
  ],
};
