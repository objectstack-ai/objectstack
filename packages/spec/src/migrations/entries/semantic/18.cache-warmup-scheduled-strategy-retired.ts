// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cache-warmup-scheduled-strategy-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
  // span AND a table cell.
  surface:
    "CacheWarmup.strategy — the value 'scheduled' left the warmup-strategy enum "
    + '(packages/spec/src/system/cache.zod.ts), and the enum describe stopped promising '
    + '"scheduled (cron)". The key itself, DistributedCacheConfig.warmup.strategy, is '
    + 'unchanged and still authorable',
  replacement:
    "'eager' to warm at startup or 'lazy' to warm on first access — the two strategies "
    + 'the vocabulary ever described without pointing outside itself. There is no '
    + 'replacement for the cadence: a warmup on a schedule is a job. Declare a `job` with '
    + 'schedule.expression (system/job.zod.ts) whose handler does the warming — that is '
    + 'the one cron slot this platform evaluates, and it is the slot #16320 deliberately '
    + 'kept when it deleted the other seven',
  reason:
    'ADR-0049 enforce-or-remove, closing the residue #16320 left inside the schema it had '
    + 'just edited. That card deleted CacheWarmup.schedule — the cron key this enum member '
    + 'selected — and declined the member itself on the reading that it is "a value, not a '
    + "position this ruling names\". That is a statement about the ruling's SCOPE, not a "
    + 'finding that the value was sound: after the deletion the member declared a warmup '
    + 'cadence with no key left to configure it, no engine that has ever run one, and a '
    + '.describe() still promising "(cron)" — ADR-0049 declared-not-enforced in the form '
    + 'Prime Directive 10 names outright, a capability advertised that the runtime does '
    + 'not deliver. Re-measured on main at 690f083f83 with a lit control rather than '
    + 'inherited from the card: CacheWarmupSchema has zero runtime consumers outside its '
    + 'declaring file (six files reference it — the generated reference page import, the '
    + 'declaration-map and export-origins catalogues, the ADR-0058 D7 ledger comment and '
    + 'two spec test files — while the control, ConnectorSchema, resolves to 46 files), '
    + 'and no cache-warmup engine exists anywhere on the platform. Bookkeeping follows the '
    + "hot-reload-inert-state-strategies-retired and crypto.hash precedents: an enum-VALUE "
    + 'narrowing puts nothing in RETIRED_KEYS_BY_MAJOR (no authorable KEY changed) and '
    + 'leaves the four surface ratchets byte-identical (no def changed, and they key on '
    + "positions and names, never on a def's value set), so the prescription hangs on the "
    + "enum's own error map dispatched by issue.input — telling the author of a TYPO that "
    + 'their value "was removed" would misinform. It is a SEMANTIC entry rather than a D2 '
    + 'conversion because there is no source to rewrite: CacheWarmup is bound to no '
    + 'metadata type and embedded in no stack collection, so no authored document and no '
    + 'stored row has ever carried this value, and os migrate meta has nothing to list. '
    + 'Route 3 of the retirement playbook, the #4834 / #11825 shape: this entry IS the '
    + 'declaration. ADR-0049, ADR-0087, #17157, #16320.',
  acceptanceCriteria:
    "No configuration passes strategy: 'scheduled' to CacheWarmupSchema or to "
    + 'DistributedCacheConfigSchema.warmup. TypeScript callers cannot: '
    + "CacheWarmup['strategy'] is now 'eager' | 'lazy', so the literal is a compile error "
    + 'at the authoring site. Callers that arrive as JSON get a parse REFUSAL — not the '
    + 'silent strip #16320 left for the schedule key beside it, because a narrowed enum '
    + 'rejects rather than drops — carrying the prescription, which names the job route. '
    + 'Concretely, check two places. (1) Any host or deployment config embedding a '
    + 'DistributedCacheConfig: a warmup block selecting the retired strategy now fails to '
    + 'parse where it previously parsed green; change it to eager or lazy. (2) Anything '
    + 'that was waiting on the cadence to take effect: it never did. No warmup has ever '
    + 'run on a schedule on this platform, so migrating the value changes no runtime '
    + 'behaviour whatsoever — what changes is that the contract stops promising it. If a '
    + 'scheduled warmup is genuinely wanted, it comes back through the ENFORCE leg of '
    + 'ADR-0049: the engine first, the declaration with it, never as a bare enum row '
    + 'again.',
};
