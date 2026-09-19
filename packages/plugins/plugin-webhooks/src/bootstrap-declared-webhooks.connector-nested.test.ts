// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A connector's nested `webhooks[]` does NOT reach `sys_webhook` — pinned as
 * behaviour, against a REAL registration path.
 *
 * ## Why this file exists
 *
 * `bootstrap-declared-webhooks.ts` used to open with "materialize
 * stack/**connector**-declared `webhooks` into `sys_webhook` rows so the
 * dispatcher can actually see them". The connector half was false, and it was
 * false in the one place a reader looks when deciding whether a connector's
 * nested `webhooks[]` reaches the dispatcher. Correcting the sentence is only
 * half a fix: a corrected sentence is still prose, indistinguishable under grep
 * from the false one it replaced, and it goes stale the same silent way. So the
 * claim the new docblock makes is asserted here instead.
 *
 * ## What it asserts, and why it is not a grep
 *
 * The question is not "does the word `connector` appear near the word
 * `webhook`" — that is exactly the instrument that cannot tell prose from
 * behaviour. The question is "does the registration path file a connector's
 * nested `webhooks[]` as a `webhook` METADATA ITEM", and it is answered by
 * running the real `ObjectQL` boot registration over a manifest that declares
 * both shapes at once.
 *
 * ⚠️ ANTI-VACUITY CONTROL, on the same subject and in the same corpus: the same
 * manifest also declares a TOP-LEVEL `webhooks:` entry, and the same assertions
 * demand that one IS registered and IS seeded. Without it, every expectation
 * below would also pass on an engine that registered nothing at all, on a
 * misspelled metadata type, or on a manifest this engine rejected outright.
 *
 * ## The direction this pins is the DECLARED one
 *
 * ⛔ A red here is not a licence to widen the seeder. `packages/spec` declares
 * the connector surface unenforced in two places — `automation/webhook.zod.ts`
 * ("(Connector `webhooks` remain NOT-yet-enforced — see #3197.)") and
 * `WebhookConfigSchema` in `integration/connector.zod.ts` ("declared but
 * ignored at registration ... parse and are stored, but no runtime dispatches,
 * emits, or filters on them"). If #3197 ever builds that bridge, this file and
 * the docblock it guards are part of that card's diff — which is the point:
 * the prose can no longer drift out from under the behaviour on its own.
 *
 * ⚠️ `@objectstack/objectql` is NOT aliased to source by this package's
 * `vitest.config.ts` — the ledger in `scripts/check-test-source-alias.mjs`
 * records that — so it resolves through `exports` to `objectql/dist`. A stale
 * objectql build therefore makes this verdict a statement about that build.
 * `pnpm --filter '@objectstack/plugin-webhooks^...' build` first.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { bootstrapDeclaredWebhooks } from './bootstrap-declared-webhooks.js';

const PKG = 'com.acme.billing';

/** The anti-vacuity control: a webhook authored on the stack's OWN collection. */
const STACK_DECLARED = {
  name: 'stack_declared_hook',
  label: 'Stack declared hook',
  object: 'invoice',
  triggers: ['create'],
  url: 'https://example.invalid/stack',
};

/** The subject: a webhook authored INSIDE a connector document. */
const CONNECTOR_NESTED = {
  name: 'connector_nested_hook',
  label: 'Connector nested hook',
  object: 'invoice',
  triggers: ['create'],
  url: 'https://example.invalid/connector',
};

/** One manifest carrying BOTH shapes, so the two legs share a corpus. */
function manifest(): Record<string, unknown> {
  return {
    id: PKG,
    name: 'billing',
    webhooks: [{ ...STACK_DECLARED }],
    connectors: [
      {
        name: 'acme_erp',
        label: 'Acme ERP',
        type: 'rest',
        webhooks: [{ ...CONNECTOR_NESTED }],
      },
    ],
  };
}

function bootedRegistry(): any {
  const engine = new ObjectQL();
  (engine as any).registerApp(manifest());
  return (engine as any).registry;
}

const namesOf = (registry: any, type: string): string[] =>
  (registry.listItems(type) ?? []).filter(Boolean).map((i: any) => i?.name);

/**
 * The minimum `IDataEngine` surface the seeder's INSERT path touches, wired to
 * a real registry so `readDeclared` sees exactly what boot registered. No
 * secret is authored, so no CryptoProvider is needed.
 */
function seedingEngine(registry: any) {
  const rows: any[] = [];
  return {
    rows,
    _registry: registry,
    async find() {
      return [];
    },
    async insert(_object: string, row: any) {
      rows.push(row);
      return row;
    },
    async update(_object: string, patch: any) {
      return patch;
    },
  };
}

describe("a connector's nested `webhooks[]` never becomes a `webhook` metadata item", () => {
  it('registers the top-level collection and leaves the connector-nested one where it was authored', () => {
    const registry = bootedRegistry();

    // CONTROL — the same corpus, the same spelling convention, and it is not
    // empty. This is what would have made the assertion below not-zero.
    expect(namesOf(registry, 'webhook')).toContain(STACK_DECLARED.name);

    // SUBJECT.
    expect(namesOf(registry, 'webhook')).not.toContain(CONNECTOR_NESTED.name);
    expect(namesOf(registry, 'webhook')).toEqual([STACK_DECLARED.name]);

    // …and the zero is "not hoisted", not "dropped": the connector document is
    // registered, and it still carries its nested `webhooks[]` verbatim.
    expect(namesOf(registry, 'connector')).toEqual(['acme_erp']);
    const connector: any = (registry.listItems('connector') ?? []).filter(Boolean)[0];
    expect(connector.webhooks?.map((w: any) => w?.name)).toEqual([CONNECTOR_NESTED.name]);
  });

  it('seeds `sys_webhook` from the top-level collection only — the connector half is not even skipped', async () => {
    const engine = seedingEngine(bootedRegistry());

    const result = await bootstrapDeclaredWebhooks(engine as any, undefined);

    // CONTROL: the bridge really did run and really did materialize.
    expect(result.seeded).toBe(1);
    expect(engine.rows.map((r) => r.name)).toEqual([STACK_DECLARED.name]);

    // SUBJECT: the connector-nested webhook produces NO row — and no `skipped`
    // either, because the seeder never sees it at all. A future bridge that
    // merely warned about it would move this number, not just the row list.
    expect(engine.rows.map((r) => r.name)).not.toContain(CONNECTOR_NESTED.name);
    expect(result.skipped).toBe(0);
  });
});
