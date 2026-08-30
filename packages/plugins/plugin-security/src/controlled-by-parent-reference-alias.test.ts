// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13250] `resolveCbpRelation` KEEPS reading the rejected `reference` aliases,
// and now says so out loud.
//
// ## The disposition this suite pins, and why it is the inverse of its siblings
//
// `@objectstack/spec` declares `reference` as the only relationship spelling;
// `FieldSchema` rejects `reference_to` / `referenceTo` (#11567). Two lint
// readers were narrowed to canonical-only on that ruling. This one was NOT
// (maintainer ruling, 2026-08-30), and the reason is measured rather than
// stylistic:
//
//   • The alias REACHES here. This reader consumes `ql.getSchema()`, i.e. the
//     `SchemaRegistry`, and a raw `registerObject` skips Zod by design (#3896).
//   • A miss here is a DENIAL, not a wrong answer. `resolveCbpRelation`
//     returning null is fail-closed: the read leg answers `RLS_DENY_FILTER`
//     (zero rows for every non-admin caller) and the write leg throws
//     `MasterDetailRelationMissingError`. Narrowing would take a
//     raw-registered, alias-spelled `controlled_by_parent` object from "access
//     derived from its master" to "everything denied" — an availability outage
//     on a population that provably exists.
//
// So the card's defect (a tolerant consumer hiding an authoring mistake) is
// answered by making the tolerance LOUD, not by removing it.
//
// ## What this suite refuses to let a later change do
//
// The load-bearing tests here are the two NEGATIVES, and they point in opposite
// directions, so neither "narrow it after all" nor "drop the noisy log" can
// pass quietly:
//
//   1. THE ALIAS STILL RESOLVES. A future narrowing reddens `resolves the
//      relation` below rather than shipping as a silent availability change.
//   2. IT IS REPORTED, ONCE PER OBJECT. Deleting the diagnostic reddens the
//      report tests; making it per-read reddens the cache test; making it
//      fire-once-per-process reddens the re-arm test.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';

/** The MASTER. Spelling is irrelevant to it — it declares no relation. */
const ACCOUNT_SCHEMA = {
  name: 'crm_account',
  sharingModel: 'private',
  fields: { id: { name: 'id', type: 'text' } },
};

/** A detail whose master FK is spelled with `field` carrying `value`. */
function detailSchema(field: string, value: unknown, extra: Record<string, unknown> = {}) {
  return {
    name: 'crm_contact',
    sharingModel: 'controlled_by_parent',
    fields: {
      id: { name: 'id', type: 'text' },
      account: { name: 'account', type: 'master_detail', required: true, [field]: value, ...extra },
    },
  };
}

/**
 * Boot a real `SecurityPlugin` over a fake registry, through the plugin's OWN
 * lifecycle — `start()` is what binds `this.logger` to the host sink and what
 * subscribes the cache invalidation, so both facts under test here are only
 * true of a started plugin. Returns the metadata `watch` callback so a test can
 * drive a real metadata-change invalidation rather than reaching into the cache.
 */
async function boot(schemas: Record<string, any>) {
  const warn = vi.fn();
  let onMetadataChange: (() => void) | undefined;
  const ql: any = {
    getSchema: (object: string) => schemas[object],
    registerMiddleware: () => {},
  };
  const metadata: any = {
    watch: (_pattern: string, cb: () => void) => {
      onMetadataChange = cb;
      return () => {};
    },
    list: async () => [],
  };
  const services: Record<string, any> = {
    objectql: ql,
    metadata,
    manifest: { register: () => {} },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
    registerService: () => {},
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({});
  await plugin.init(ctx);
  await plugin.start(ctx);
  return {
    plugin,
    warn,
    resolve: (object: string) => (plugin as any).resolveCbpRelation(object),
    /** Fire the real `metadata.watch('*')` subscription `start()` installed. */
    changeMetadata: () => {
      if (!onMetadataChange) throw new Error('plugin did not subscribe to metadata changes');
      onMetadataChange();
    },
  };
}

/** Every alias-carrying warn this suite cares about, in call order. */
const aliasWarns = (warn: ReturnType<typeof vi.fn>) =>
  warn.mock.calls.filter((c) => String(c[0]).includes('#11567'));

describe('resolveCbpRelation — the rejected `reference` alias still RESOLVES (#13250)', () => {
  it('`reference_to` resolves the relation — narrowing it would deny access, so it must not be narrowed', async () => {
    const { resolve } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference_to', 'crm_account'),
    });
    // ⛔ THE invariant the 2026-08-30 ruling protects. If this ever reads
    // `null`, a raw-registered object spelled this way answers
    // RLS_DENY_FILTER on read and throws on write.
    expect(resolve('crm_contact')).toMatchObject({ fk: 'account', master: 'crm_account' });
  });

  it('`referenceTo` resolves it too — the tolerance covers both rejected spellings', async () => {
    const { resolve } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('referenceTo', 'crm_account'),
    });
    expect(resolve('crm_contact')).toMatchObject({ fk: 'account', master: 'crm_account' });
  });

  it('the canonical `reference` resolves it, unchanged', async () => {
    const { resolve } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference', 'crm_account'),
    });
    expect(resolve('crm_contact')).toMatchObject({ fk: 'account', master: 'crm_account' });
  });

  it('an ABSENT-then-aliased chain falls through exactly as `??` did (the refKey mirror)', async () => {
    // `refKey` replaced a literal `reference ?? reference_to ?? referenceTo`
    // chain, so the fall-through semantics are pinned rather than assumed:
    // `??` skips null and undefined ONLY, which is what `!= null` tests. A
    // present-but-null canonical key must therefore keep falling through to
    // the alias — and a truthiness-based rewrite would fail this.
    const nullReference = null;
    const { resolve } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference', nullReference, { reference_to: 'crm_account' }),
    });
    expect(resolve('crm_contact')).toMatchObject({ fk: 'account', master: 'crm_account' });
  });
});

describe('resolveCbpRelation — the tolerance is LOUD (#13250)', () => {
  it('reports the alias, and the report names the object, the field, the key and the fix', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference_to', 'crm_account'),
    });
    resolve('crm_contact');

    const calls = aliasWarns(warn);
    expect(calls).toHaveLength(1);
    const [message, detail] = calls[0];
    expect(message).toContain('crm_contact');
    expect(message).toContain('account');
    expect(message).toContain('reference_to');
    expect(message).toContain('`reference`');
    // The operator must not go hunting for an outage that did not happen: the
    // text has to say the alias still worked.
    expect(message).toMatch(/UNAFFECTED/);
    expect(detail).toEqual({
      object: 'crm_contact',
      field: 'account',
      alias: 'reference_to',
      master: 'crm_account',
    });
  });

  it('names `referenceTo` when THAT is what resolved it — the report tracks the key actually read', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('referenceTo', 'crm_account'),
    });
    resolve('crm_contact');
    expect(aliasWarns(warn)[0]?.[1]).toMatchObject({ alias: 'referenceTo' });
  });

  it('says NOTHING for the canonical spelling — this is a defect report, not a trace', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference', 'crm_account'),
    });
    resolve('crm_contact');
    expect(aliasWarns(warn)).toHaveLength(0);
  });

  it('says nothing when canonical WINS over a stale alias on the same field', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference', 'crm_account', { reference_to: 'stale_legacy' }),
    });
    expect(resolve('crm_contact')).toMatchObject({ master: 'crm_account' });
    // The alias was present but was not what answered, so it is not news.
    expect(aliasWarns(warn)).toHaveLength(0);
  });

  it('ONCE per object, not once per read — this sits under the per-request RLS path', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference_to', 'crm_account'),
    });
    for (let i = 0; i < 25; i++) resolve('crm_contact');
    // The cache miss is the report's gate: 25 resolutions, one report.
    expect(aliasWarns(warn)).toHaveLength(1);
  });

  it('once per OBJECT — two alias-spelled objects are two reports, not one', async () => {
    const { resolve, warn } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference_to', 'crm_account'),
      crm_note: { ...detailSchema('reference_to', 'crm_account'), name: 'crm_note' },
    });
    resolve('crm_contact');
    resolve('crm_note');
    expect(aliasWarns(warn).map((c) => c[1].object)).toEqual(['crm_contact', 'crm_note']);
  });

  it('RE-ARMS on a metadata change — the author who just edited the object hears the verdict', async () => {
    const { resolve, warn, changeMetadata } = await boot({
      crm_account: ACCOUNT_SCHEMA,
      crm_contact: detailSchema('reference_to', 'crm_account'),
    });
    resolve('crm_contact');
    resolve('crm_contact');
    expect(aliasWarns(warn)).toHaveLength(1);

    // Studio / AI authoring edited metadata: `start()`'s `metadata.watch('*')`
    // subscription clears `cbpRelCache`, and the report rides that same
    // lifecycle deliberately — a process-lifetime "already warned" set would
    // stay silent here, which is the one moment the author is listening.
    changeMetadata();
    resolve('crm_contact');
    expect(aliasWarns(warn)).toHaveLength(2);
  });
});
