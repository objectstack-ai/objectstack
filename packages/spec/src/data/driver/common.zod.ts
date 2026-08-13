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
 * Refusal prescription for a credential embedded in an authored URL's userinfo
 * (#8082, maintainer-ruled Option A 2026-08-12 — the same per-artefact contract
 * closure as #7990, applied to the one-syntax-over workaround it left open).
 *
 * #7990 refused the inline credential KEYS (`config.password` /
 * `config.authToken`) and #8078 measured, and pinned as a fact, that
 * `config.url` still admitted `postgresql://user:password@host/db` on every
 * driver that declares a `url` — the identical secret, in the identical
 * `sys_metadata` cleartext sink, one syntax over. Worse, the refusal itself
 * steered authors there: an author (very often an AI) refused on
 * `config.password` "fixes" the error by moving the secret into the URL, and
 * the parse goes green. This message closes that door loudly.
 *
 * Wording constraints, all measured rather than stylistic:
 *
 *  - It must NOT recommend `${…}` placeholders: #8078 measured that authored-
 *    metadata placeholders are resolved by nothing and reach the client
 *    verbatim, so "put a placeholder in the URL" is a broken escape that
 *    recreates the masked-failure shape (#8082's ruling names this binding).
 *    Since #8336 the message no longer merely warns: placeholder syntax in
 *    connection-material keys is itself refused at publish (maintainer-ruled
 *    direction 2, 2026-08-13), so the sentence now points at that refusal.
 *  - It must state the runtime-DSN carve-out explicitly (maintainer ruling):
 *    a DSN that arrives via the RUNTIME ENVIRONMENT (`OS_DATABASE_URL` and
 *    friends) is translated into a driver config by the boot hosts and handed
 *    to the driver factory directly — it never passes through this authoring
 *    schema, so it is unaffected by construction.
 *  - A bare username in userinfo (`postgres://svc@host/db`) stays accepted,
 *    matching #7990's posture: `username` is a writable inline key; only the
 *    secret is refused.
 */
export const URL_EMBEDDED_CREDENTIAL_REFUSED = (key: string): string =>
  `this \`${key}\` embeds a password in its userinfo (\`user:password@host\`) and is not `
  + 'accepted at publish (#8082): the datasource is persisted whole into `sys_metadata`, which '
  + 'is served back by the ordinary data API, so a URL-embedded credential lands in cleartext '
  + 'at rest exactly like an inline `password` (#7990). Keep the authored URL credential-free '
  + '(a bare username, `user@host`, is fine) and bind the secret instead: the Setup → '
  + "Datasources connection form's secret field hands it to the datasource secret binder, "
  + 'which encrypts it into `sys_secret` and stores only an opaque handle at '
  + '`external.credentialsRef` — or reference the secrets store directly with '
  + '`external.credentialsRef`. The resolved secret is injected at connect time and wins over '
  + 'anything embedded in the URL. Do NOT substitute a `${…}` placeholder into the URL: '
  + 'placeholders in authored metadata are resolved by nothing and reach the database client '
  + 'verbatim (#8078, measured), and are themselves refused at publish (#8336). '
  + 'Runtime-environment DSNs (`OS_DATABASE_URL` and friends) do '
  + 'not pass through this publish door and are unaffected.';

/**
 * The password component of a URL-ish string's userinfo, or `undefined` when
 * the string carries none — the shared value-level parse behind
 * {@link credentialFreeUrl} (#8082).
 *
 * Deliberately NOT `new URL()`: real DSNs take forms WHATWG parsing rejects or
 * mangles (postgres/mongo multi-host `user:pass@h1:5432,h2:5432/db`, bare
 * `:memory:`, `file:` paths), and a detector that throws on the exact inputs it
 * must judge would fail open. The boundaries below are RFC 3986's, and match
 * the read-path redactor (`service-datasource`'s `redactUrlPassword`) so the
 * write door refuses precisely the material the read door redacts:
 *
 *  - the authority is what follows `//` (scheme-relative included), up to the
 *    first `/`, `?` or `#` — a `:` or `@` in a path or query is never userinfo;
 *  - userinfo ends at the LAST `@` in the authority (a malformed literal `@`
 *    inside a password must not decide how much of it goes unjudged);
 *  - the password starts after the FIRST `:` in userinfo, and only a NON-EMPTY
 *    password is credential material (`user@host` and `user:@host` carry no
 *    secret; both stay accepted, and the second is what the read-path redaction
 *    of a legacy row round-trips as).
 *
 * A string with no `//` (sqlite/turso `file:` paths, `:memory:`) has no
 * authority and answers `undefined`.
 */
export function urlUserinfoPassword(value: string): string | undefined {
  const scheme = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.exec(value);
  if (!scheme) return undefined;
  const rest = value.slice(scheme[0].length);
  const end = rest.search(/[/?#]/);
  const authority = end === -1 ? rest : rest.slice(0, end);
  const at = authority.lastIndexOf('@');
  if (at === -1) return undefined;
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  if (colon === -1) return undefined;
  const password = userinfo.slice(colon + 1);
  return password.length > 0 ? password : undefined;
}

/**
 * Attach the #8082 URL-userinfo credential refusal to a driver-config URL key.
 *
 * One shared check for every URL-bearing key on the four driver schemas
 * (postgres/mysql/mongo `url`, turso `url` + `syncUrl`), so the policy cannot
 * drift per driver — the maintainer's ruling names a single value-level parse
 * as the mechanism, precisely so no second copy exists to disagree with this
 * one (the rejected Option C shape).
 */
export function credentialFreeUrl<S extends z.ZodString>(schema: S, key: string) {
  return schema.superRefine((value, ctx) => {
    if (typeof value !== 'string') return;
    if (urlUserinfoPassword(value) !== undefined) {
      ctx.addIssue({ code: 'custom', message: URL_EMBEDDED_CREDENTIAL_REFUSED(key) });
    }
  });
}

/**
 * Refusal prescription for a `${…}` placeholder written into a
 * connection-material driver-config value (#8336, maintainer-ruled direction 2
 * 2026-08-13 — refuse loudly at publish rather than implement resolution).
 *
 * The defect this closes (#7990 census, measured during #8078): a placeholder
 * such as `config.url: 'postgresql://${DB_HOST}/db'` is resolved by NOTHING —
 * it is stored verbatim in `sys_metadata` and handed verbatim to the database
 * client at connect. The author believes environment substitution happens; the
 * connection then fails (or connects somewhere unintended) with no error
 * naming the unresolved placeholder — the masked-failure shape. Until #8336
 * the syntax looked supported: it parsed green, stored fine, and failed at a
 * distance. Two shipped refusals (#8078's inline-credential message, #8082's
 * URL-userinfo message) had to warn AROUND the broken escape instead of
 * pointing through it; this refusal makes the non-capability explicit
 * (declared = enforced), and implementing real resolution — a capability with
 * an env-exfiltration security surface and no measured pull — was explicitly
 * rejected for now.
 *
 * The message names every working escape so it can serve as the migration doc
 * for whoever hits it (very often an AI author):
 *
 *  - the literal value, for non-secret connection material;
 *  - the datasource secret binder / `external.credentialsRef`, for secret
 *    material (the #7990/#8082 family's mechanisms, injected at connect time);
 *  - the runtime environment itself (`OS_DATABASE_URL` and friends) for
 *    environment-driven deployments — those DSNs are translated into driver
 *    config by the boot hosts and never pass through this authoring schema,
 *    so they are unaffected by construction (the same carve-out #8082 states).
 */
export const UNRESOLVED_PLACEHOLDER_REFUSED = (key: string): string =>
  `this \`${key}\` contains a \`\${…}\` placeholder, and placeholders are not resolved here `
  + '(#8336): nothing in the platform substitutes `${…}` in authored datasource config — '
  + 'placeholders in authored metadata are resolved by nothing, are stored verbatim in '
  + '`sys_metadata`, and reach the database client verbatim (#8078, measured), so the '
  + 'connection fails (or connects somewhere unintended) with no error naming the unresolved '
  + 'placeholder. Write the literal value instead. For secret material, bind it: the Setup → '
  + "Datasources connection form's secret field hands it to the datasource secret binder, "
  + 'which encrypts it into `sys_secret` and stores only an opaque handle at '
  + '`external.credentialsRef` — the resolved secret is injected at connect time. For '
  + 'environment-driven connections, configure the runtime environment itself: '
  + '`OS_DATABASE_URL` and friends are translated into driver config by the boot hosts and '
  + 'never pass through this publish door, so they are unaffected.';

/**
 * Does this authored string contain a complete `${…}` placeholder span?
 *
 * The boundary is placeholder-by-INTENT for the one convention the census
 * measured (`${NAME}` — shell/compose-style interpolation), judged as a
 * complete span rather than a token grammar:
 *
 *  - `${anything}` matches, whatever is inside the braces — a placeholder
 *    carrying a non-word character is still a placeholder attempt, and letting
 *    it through as "not a placeholder" is the `context-tokens.zod.ts` #5586
 *    lesson one surface over;
 *  - a bare `$VAR`, a brace pair without the dollar (`{name}`), and an
 *    unclosed `${` do NOT match — none of them is the convention authors were
 *    measured writing, and widening the refusal past the measured defect would
 *    trade a masked failure for false rejections of legitimate literals.
 */
export function containsUnresolvedPlaceholder(value: string): boolean {
  return /\$\{[^}]*\}/.test(value);
}

/**
 * Attach the #8336 placeholder refusal to a connection-material driver-config
 * string key.
 *
 * One shared check for every connection-material string key on the driver
 * schemas — the same single-mechanism construction as {@link credentialFreeUrl}
 * (#8082), so the policy cannot drift per driver or per key. Composes with
 * that check on the URL-bearing keys: `placeholderFree(credentialFreeUrl(…))`
 * judges both facts, and an input violating both reports both.
 */
export function placeholderFree<S extends z.ZodString>(schema: S, key: string) {
  return schema.superRefine((value, ctx) => {
    if (typeof value !== 'string') return;
    if (containsUnresolvedPlaceholder(value)) {
      ctx.addIssue({ code: 'custom', message: UNRESOLVED_PLACEHOLDER_REFUSED(key) });
    }
  });
}

/**
 * The #8336 placeholder refusal for a connection-material PASSTHROUGH slot —
 * mongo's `options`, a record handed to the MongoDB client verbatim.
 *
 * The deep walk exists because the passthrough is exactly where the refusal
 * would otherwise steer authors: refuse `${RS_NAME}` at `config.url` and the
 * green escape becomes `options: { replicaSet: '${RS_NAME}' }` — the same
 * one-syntax-over displacement #8078 measured for credentials. Every string
 * value in the record (nested objects and arrays included) reaches the client,
 * so every one is judged; non-string values carry no placeholder and pass
 * untouched. Each finding is reported at its own path so the author is pointed
 * at the exact entry, not at the record as a whole.
 */
export function placeholderFreeDeep<S extends z.ZodType>(schema: S, key: string) {
  return schema.superRefine((value, ctx) => {
    for (const path of unresolvedPlaceholderPaths(value)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: UNRESOLVED_PLACEHOLDER_REFUSED([key, ...path].join('.')),
      });
    }
  });
}

/** Paths of every string value under `value` carrying a `${…}` span. */
function unresolvedPlaceholderPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
): (string | number)[][] {
  if (typeof value === 'string') {
    return containsUnresolvedPlaceholder(value) ? [[...path]] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => unresolvedPlaceholderPaths(entry, [...path, index]));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => unresolvedPlaceholderPaths(v, [...path, k]));
  }
  return [];
}

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
