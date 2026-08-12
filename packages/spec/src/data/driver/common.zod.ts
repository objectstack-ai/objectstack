// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Shared building blocks for the per-driver `datasource.config` shapes (#4410).
 *
 * Every schema under `data/driver/` describes ONE driver's `config` slot — the
 * keys an author may write and the platform actually reads. They are the
 * enforcement half of the `config` escape hatch `datasource.zod.ts` opens: the
 * slot stays `z.record` at the top of `DatasourceSchema` because a sqlite
 * `filename` and a postgres `host` share no shape, and `DatasourceSchema`'s
 * refinement then parses it against the schema for the declared driver.
 *
 * The rule these files are written to: **a key is declared here only if some
 * code path reads it.** A config key that no driver and no factory consumes is
 * the same silent-strip defect one level down (#4001, ADR-0078), so an unread
 * key is either wired or rejected with a prescription — never left in the
 * contract to look supported.
 */

/**
 * Dev-only, loosen-only schema self-heal (#2186), honoured by the SQL drivers.
 *
 * Read by `createDefaultDatasourceDriverFactory` and passed to
 * `SqlDriver.autoMigrate`; force-disabled under `NODE_ENV=production`. `'safe'`
 * applies only non-destructive alters (relax NOT NULL, widen varchar).
 */
export const SqlAutoMigrateSchema = z.enum(['off', 'safe'])
  .describe('Dev-only non-destructive schema self-heal (#2186)');

export type SqlAutoMigrate = z.input<typeof SqlAutoMigrateSchema>;

/**
 * `schemaMode` written inside `config`. Shared by every SQL driver: the factory
 * used to look for it there because the datasource-level key was dropped
 * between the record and the connection spec, so the nested copy was the only
 * spelling that reached a driver. #4410 carries the declared key down instead.
 */
export const SCHEMA_MODE_BELONGS_ON_DATASOURCE =
  '`schemaMode` is a datasource-level key, not driver config. Write it next to `driver` '
  + "(`schemaMode: 'external'`) — the connection service now carries it down to the driver, so "
  + 'the copy inside `config` is gone rather than duplicated.';

/**
 * `readOnly` written inside `config`. Shared by every driver.
 *
 * This line used to send authors to `capabilities: { readOnly: true }` — a key
 * #4583 removed because nothing read it, so the advice manufactured exactly the
 * belief it was meant to correct: an author moved the key, the parse went
 * green, and the datasource stayed writable. The prescription now names the one
 * gate that is enforced, and says plainly where it does NOT apply rather than
 * leaving the reader to assume it covers their case (#4584).
 */
export const READ_ONLY_BELONGS_ON_DATASOURCE =
  '`readOnly` is not driver config, and there is no datasource key that makes a connection '
  + 'read-only. For a FEDERATED datasource use `external.allowWrites: false`, which the ObjectQL '
  + 'engine enforces before every write. For a managed (local) datasource there is currently no '
  + 'read-only gate — grant the connection SELECT-only at the database instead, which is a real '
  + 'boundary rather than an application-layer flag (#4584).';

/**
 * TLS on/off for a SQL driver — the shorthand, and deliberately ONLY the
 * shorthand.
 *
 * Certificates live in the datasource's own `ssl` block (`enabled`,
 * `rejectUnauthorized`, `ca`, `cert`, `key`), which #4410 wired through to the
 * client; before that it was declared, strict, documented and read by nobody,
 * so the only TLS setting that did anything was this per-driver one. Two slots
 * for the same setting is one too many, and this is the one that has to stay
 * narrow: it is what the Studio connection form renders from, and the form
 * turns anything that is not a boolean / enum / number into a TEXT INPUT. A
 * `boolean | object` union here would hand the wizard a text box whose every
 * value the gate then rejects — a form that cannot produce a saveable record.
 */
export const DriverSslToggleSchema = z.boolean()
  .describe('Enable TLS. Certificates go in the datasource-level `ssl` block.');
export type DriverSslToggle = z.input<typeof DriverSslToggleSchema>;

/** Where the certificate-bearing form of TLS lives. */
export const SSL_DETAIL_BELONGS_ON_DATASOURCE =
  'Certificates and verification live in the datasource-level `ssl` block, not in driver config: '
  + '`ssl: { enabled: true, rejectUnauthorized: false, ca: … }` next to `driver`. Inside `config`, '
  + '`ssl` is the on/off shorthand only.';

/**
 * Refusal prescription for an inline credential written into driver config
 * (#7990, maintainer-ruled Option A 2026-08-12: per-artefact contract closure).
 *
 * Why the KEY is refused, not just discouraged: a datasource artefact is
 * persisted whole into `sys_metadata`, and `sys_metadata` declares
 * `apiMethods: ['get','list']` — so an inline credential is cleartext at rest,
 * readable through the ordinary data API. The two mechanisms this prescription
 * names are the ones that already exist and already win over an inline value
 * at connect time (`DatasourceConnectionService` resolves
 * `external.credentialsRef` and injects the secret into the driver factory).
 *
 * Used both as the `z.never` error of a {@link refusedInlineCredentialKey}
 * (the declared key) and as the `guidance` entry for the key's former alias
 * spellings (`passwd`/`pwd`/`token`/`jwt`) — an alias row pointing at an
 * unwritable key would be the `triggerPhrase → triggerPhrases` two-step
 * rejection `shared/strict-object.ts` documents.
 */
export const INLINE_CREDENTIAL_REFUSED = (key: string): string =>
  `\`${key}\` is a credential and is not accepted inline in driver config (#7990): the `
  + 'datasource is persisted whole into `sys_metadata`, which is served back by the ordinary '
  + 'data API, so an inline credential lands in cleartext at rest. Bind the secret instead: '
  + "the Setup → Datasources connection form's secret field hands it to the datasource secret "
  + 'binder, which encrypts it into `sys_secret` and stores only an opaque handle at '
  + '`external.credentialsRef` — or reference the secrets store directly with '
  + '`external.credentialsRef`. The resolved secret is injected at connect time and always '
  + 'wins over anything embedded in `config`.';

/**
 * A driver-config credential key, declared but UNWRITABLE (#7990).
 *
 * Same construction as `shared/retired-key.ts`'s `retiredKey()` — `z.never()`
 * emits as `{ "not": {} }`, so the authorable-surface ratchet reads the key as
 * `[RETIRED]` and `tsc` types it `never` — but hand-rolled here for the one
 * thing `retiredKey()` cannot carry: the `.meta({ format: 'password' })`
 * projection. The Studio connection form (objectui
 * `DatasourceResourcePage.tsx`) renders its SECRET input from exactly that
 * marker and routes the value to the top-level `secret` — the datasource
 * secret binder's door, not `config` — so the marker must survive the
 * refusal or the wizard loses the very input the refusal diverts authors to.
 * The parse and the form cannot disagree: they read one schema.
 */
export function refusedInlineCredentialKey(key: string, formTitle: string) {
  return z.never({ error: () => INLINE_CREDENTIAL_REFUSED(key) }).optional()
    .describe(
      "Set through the connection form's secret field or `external.credentialsRef` — "
      + 'encrypted into `sys_secret`, never stored in `config` (#7990)',
    )
    .meta({ title: formTitle, format: 'password' });
}

/** Options every driver-config JSON-Schema projection is built with. */
const TO_JSON_SCHEMA = {
  target: 'draft-2020-12',
  // The AUTHOR-facing shape: a key with a `.default()` is optional to write.
  io: 'input',
  // The memory driver's `persistence` accepts a custom adapter — an object of
  // functions, which has no JSON-Schema form. Emitting `{}` for it keeps the
  // connection form renderable instead of throwing at boot (#3746 hazard).
  unrepresentable: 'any',
} as const;

/**
 * Memoized JSON-Schema projection of a driver-config schema.
 *
 * One projection per schema, computed on first use and cached: this is what
 * `DriverDefinitionSchema.configSchema` publishes and what the Studio
 * connection form renders, so the form and the parse gate cannot describe
 * different shapes — they are the same zod object seen twice.
 */
export function driverConfigJsonSchema(schema: z.ZodType): () => Record<string, unknown> {
  let cached: Record<string, unknown> | undefined;
  return () => {
    if (cached === undefined) {
      cached = z.toJSONSchema(schema, TO_JSON_SCHEMA) as Record<string, unknown>;
    }
    return cached;
  };
}
