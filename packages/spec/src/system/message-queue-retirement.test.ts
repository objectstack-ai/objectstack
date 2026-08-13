// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';

// ─── [#8075] the message-queue config family is RETIRED ─────────────────────
//
// ADR-0049 enforce-or-remove, fork (b) of the #8075 census (accepted
// 2026-08-12): `system/message-queue.zod.ts` is deleted whole — 5 emitted defs
// (`system/MessageQueueConfig`, `system/MessageQueueProvider`,
// `system/TopicConfig`, `system/ConsumerConfig`, `system/DeadLetterQueue`),
// 14 exported names, reference docs with them.
//
// The measurement that decided it (issue #8075, report comment; spot-verified
// on the merged tree before this removal, control passing in the SAME run):
//
//   1. STATIC — zero consumers outside `packages/spec` repo-wide (definition +
//      own tests + generated artifacts only), while the corpus-reach control
//      (`DatasourceSchema` under identical exclusions) returns hits. The
//      kernel "hits" for the name are the SUBSTRING inside
//      `EventMessageQueueConfigSchema` — a different declaration.
//   2. DOORS — `DEFAULT_METADATA_TYPE_REGISTRY` has no `message_queue` type;
//      `integration/connector.zod.ts`'s `'message_queue'` is only a
//      `ConnectorType` enum VALUE (#7990's already-measured surface) and never
//      referenced these shapes.
//   3. The security face: `MessageQueueConfigSchema.sasl` required an inline
//      `password` whenever present — a broker credential in authorable
//      metadata — while the CONSUMED near-namesake
//      (`kernel/EventMessageQueueConfig`, `EventBusConfig.messageQueue`)
//      deliberately carries no credential field. The consumed MQ shape has no
//      credential key; the credential-bearing MQ shape had no consumer.
//
// ## Why route 3, and why there is nothing to tombstone
//
// With no carrier key there is no shape on which a `retiredKey()` tombstone
// could sit, and no author document for an ADR-0087 D2 conversion to rewrite —
// a prescription nobody can receive is noise. The declared record is the D3
// `SemanticMigration` `external-lookup-message-queue-families-retired` plus
// the `RETIRED_DEFS_BY_MAJOR[17]` entries the manifest-deletion gate reads.
//
// Form follows #4988 / #5055: resolved symbol identity over every public entry
// via the build-time `export-origins/` artifact, plus the file-deletion probe
// in the #4988 direction (whole-file retirement, no surviving occupant).
describe('[#8075] system/ message-queue config family retirement', () => {
  /** The 14 names the five retired defs exported (5 schema consts + 9 types). */
  const RETIRED_NAMES = [
    'MessageQueueProviderSchema', 'MessageQueueProvider',
    'TopicConfigSchema', 'TopicConfig', 'TopicConfigParsed',
    'ConsumerConfigSchema', 'ConsumerConfig', 'ConsumerConfigParsed',
    'DeadLetterQueueSchema', 'DeadLetterQueue', 'DeadLetterQueueParsed',
    'MessageQueueConfigSchema', 'MessageQueueConfig', 'MessageQueueConfigParsed',
  ] as const;

  /**
   * The near-namesakes a "finish everything message-queue" sweep would
   * plausibly take, each a DIFFERENT declaration with a live consumer:
   * the event bus's MQ integration (no credential field, inline provider
   * enum) and its per-event DLQ record.
   */
  const MUST_SURVIVE_KERNEL = [
    'EventMessageQueueConfigSchema', 'EventMessageQueueConfig', 'EventMessageQueueConfigParsed',
    'EventBusConfigSchema',
    'DeadLetterQueueEntrySchema', 'DeadLetterQueueEntry', 'DeadLetterQueueEntryParsed',
  ] as const;

  /** System-entry neighbours that stay. */
  const MUST_SURVIVE_SYSTEM = [
    'CacheConfigSchema',
    'CacheTierSchema',
  ] as const;

  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    // Anti-vacuity: the baseline must cover the real surface.
    for (const needed of ['.', './system', './kernel', './data']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./system').length, './system must export a non-trivial surface').toBeGreaterThan(100);

    // ── ABSENCE (every entry — exact names, so the near-namesakes cannot
    //    satisfy these by substring) ────────────────────────────────────────
    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #8075`).toEqual([]);
    }

    // ── SURVIVAL ──────────────────────────────────────────────────────────
    const kernelNames = exportNamesOf('./kernel');
    for (const name of MUST_SURVIVE_KERNEL) {
      expect(kernelNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
    const systemNames = exportNamesOf('./system');
    for (const name of MUST_SURVIVE_SYSTEM) {
      expect(systemNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('the module is gone from disk, and nothing imports it any more', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

    for (const f of ['message-queue.zod.ts', 'message-queue.test.ts']) {
      expect(fs.existsSync(path.join(srcRoot, 'system', f)), `system/${f} must be deleted`).toBe(false);
    }
    // Anti-vacuity: a kept sibling proves the probe looks in the right place.
    expect(fs.existsSync(path.join(srcRoot, 'system', 'cache.zod.ts'))).toBe(true);

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/(?:import|export)[^;]*['"][^'"]*\/message-queue\.zod(?:\.js)?['"]/.test(src)) {
            importers.push(path.relative(srcRoot, full));
          }
        }
      }
    };
    walk(srcRoot);
    expect(importers, 'a resurrected import means the retirement is being undone — re-read #8075').toEqual([]);
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const system = await import('./index');
    for (const name of RETIRED_NAMES) {
      expect(name in system, `system must not export ${name}`).toBe(false);
    }
    for (const name of MUST_SURVIVE_SYSTEM) {
      expect(name in system, `${name} must SURVIVE at runtime`).toBe(true);
    }
    const kernel = await import('../kernel/index');
    for (const name of MUST_SURVIVE_KERNEL.filter((n) => n.endsWith('Schema'))) {
      expect(name in kernel, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the consumed MQ shape still carries NO credential face', async () => {
    // The retirement's argument in one assertion: the LIVE message-queue
    // surface (`EventBusConfig.messageQueue`) parses real configs and has no
    // sasl / password / username slot. If someone re-adds a credential face
    // here, this pin asks for the #7990 / #8075 analysis to be re-run, not
    // for a quiet green.
    const { EventMessageQueueConfigSchema } = await import('../kernel/events/integrations.zod');
    const parsed = EventMessageQueueConfigSchema.parse({
      provider: 'kafka',
      topic: 'objectstack_events',
    });
    expect(parsed.provider).toBe('kafka');
    // Defaults applied — the shape is genuinely parsed, not passed through.
    expect(parsed.format).toBe('json');

    // A config smuggling SASL credentials is not accepted-with-secrets: the
    // schema is not `.strict()`, so zod STRIPS the unknown key — nothing
    // credential-shaped survives into the parsed value.
    const smuggled = EventMessageQueueConfigSchema.parse({
      provider: 'kafka',
      topic: 'objectstack_events',
      sasl: { mechanism: 'plain', username: 'u', password: 'p' },
    });
    expect(smuggled).not.toHaveProperty('sasl');
  });
});
