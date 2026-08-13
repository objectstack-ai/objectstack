// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-path credential redaction for a datasource's driver `config` — the ONE
 * definition of "what is a credential key" (#8300, moved here from
 * `@objectstack/service-datasource`'s `datasource-config-redaction.ts`, which
 * PR #8126 built for #8081, the services half of #7990).
 *
 * ## Why this lives in `@objectstack/spec/data`
 *
 * Two packages must agree on the credential-key set: `service-datasource`
 * (the datasource-admin read path, PR #8126) and the metadata read path
 * (#8154's per-type redaction hook, registered through
 * `kernel/metadata-type-redaction.ts`). They share **no** dependency except
 * `@objectstack/spec`, so spec is the only place one definition can live —
 * a second derived copy would duplicate a *security* list across two doors
 * that must agree (#8300 rejected that on measured drift grounds). The
 * derivation is contract-reading, not business logic: it reads the driver
 * schemas that already live beside it.
 *
 * ## What counts as a credential here
 *
 * Three sources, in descending order of authority:
 *
 *  1. **Derived from the driver's own contract** — a config key whose schema is
 *     `z.never()` IS the shape #8078 gave a refused inline credential
 *     (`refusedInlineCredentialKey`), so reading the schema is reading the
 *     refusal list rather than re-typing it. A driver that refuses a new
 *     credential key tomorrow is covered here the day it lands, which a
 *     hand-maintained list in a consumer package would not be.
 *  2. **Former alias spellings** ({@link FORMER_CREDENTIAL_ALIASES}) — `passwd`
 *     / `pwd` / `token` / `jwt` / `auth_token` / `authtoken` used to be
 *     `aliases` that the parse RENAMED onto the canonical key; #8078 moved them
 *     to `guidance`, which refuses them. Neither spelling appears in the schema
 *     shape, and a stored row never went through the parse that would have
 *     renamed it — the wizard persists through `metadata.register`, whose
 *     validation is a structural name/label check. So the only place these can
 *     still be found is exactly the place this module reads: a stored row.
 *  3. **Credential-shaped keys that are still WRITABLE** ({@link
 *     STILL_WRITABLE_CREDENTIAL_KEYS}) — today just turso's `encryptionKey`, an
 *     AES-256 key the binder has no slot for (#8081 scope item 4, which owns
 *     the decision about giving it one). Redacting it on READ neither grants
 *     nor removes that slot: the key stays writable, stays stored, and stays
 *     injected at connect. It simply stops being served back in cleartext,
 *     which is the one question this module answers.
 *
 * For a driver the platform ships no contract for, source 1 is empty — the
 * registry is saying "nothing to check against", not "nothing to protect". The
 * canonical spellings are therefore redacted by NAME for unknown drivers too.
 * That asymmetry with the write gate (which deliberately lets an unknown
 * driver's config through untouched) is intentional: declining to REFUSE an
 * unrecognised key is a boundary choice about authoring, while serving a key
 * literally named `password` back in cleartext is a leak under any boundary.
 *
 * ## URL-embedded credentials
 *
 * A `postgresql://user:pass@host/db` in `config.url` carries the same secret as
 * `config.password`. The WRITE door refuses a URL userinfo password via the
 * shared value-level parse in `driver/common.zod.ts` (`urlUserinfoPassword`,
 * #8082 maintainer-ruled Option A 2026-08-12); this module is the READ half:
 * a scrub that dropped `config.password` and then served the identical
 * credential one key over would be a scrub in name only. So the read path
 * redacts the PASSWORD COMPONENT of a URL's userinfo and leaves everything
 * else, including the username, byte-for-byte — and the redacted shape it
 * serves (`user@host`) is exactly what the write door still accepts, which is
 * what keeps an untouched "Save" on a legacy row working.
 *
 * ## What stays in `service-datasource`
 *
 * `restoreRedactedConfig` — the write-path inverse that stops a redacted
 * round-trip deleting the stored credential — stays with the admin service
 * whose edit form needs it, importing the key set from here. Redaction is a
 * spec-derived fact; restoration is a service-side write policy.
 */

import { getDriverConfigSchema } from './driver/config-registry.zod';

/**
 * Canonical inline-credential spellings, used for a driver whose contract this
 * platform does not ship. Kept in sync with the schemas by
 * `datasource-credential-redaction.test.ts`, which asserts every `z.never()`
 * key across every builtin driver appears here — so a new refused key cannot
 * land without this fallback learning it.
 */
const CANONICAL_CREDENTIAL_KEYS = ['password', 'authToken'] as const;

/**
 * Pre-#8078 alias spellings of the keys above. A row written through the wizard
 * (which does not parse) can hold these verbatim; a row written through an
 * authoring door had them renamed onto the canonical key before storage.
 */
const FORMER_CREDENTIAL_ALIASES = [
  'passwd',
  'pwd',
  'token',
  'jwt',
  'auth_token',
  'authtoken',
] as const;

/**
 * Credential-shaped config keys that remain WRITABLE by deliberate spec choice,
 * and so are never found by the `z.never()` derivation.
 *
 * `encryptionKey` (turso) is an AES-256 key for the local database file. #8078
 * left it writable because the datasource secret binder injects exactly one
 * secret slot and `external.credentialsRef` resolution cannot target a second
 * one; giving it a slot is #8081 scope item 4 and is NOT decided here.
 */
const STILL_WRITABLE_CREDENTIAL_KEYS: Record<string, readonly string[]> = {
  turso: ['encryptionKey'],
};

/** Unwrap `.optional()` / `.default()` / `.nullable()` down to the base type. */
function baseTypeOf(schema: unknown): string | undefined {
  let node: any = schema;
  for (let depth = 0; node && depth < 10; depth += 1) {
    const def = node.def ?? node._def;
    const type: string | undefined = def?.type;
    if (!type) return undefined;
    if (type === 'optional' || type === 'default' || type === 'nullable' || type === 'readonly') {
      node = def.innerType;
      continue;
    }
    return type;
  }
  return undefined;
}

/**
 * The inline-credential keys a driver's own contract declares unwritable.
 *
 * Empty for a driver with no shipped contract — see the module note on why the
 * canonical spellings are still redacted in that case.
 */
export function refusedCredentialKeys(driver: unknown): string[] {
  let shape: Record<string, unknown> | undefined;
  try {
    const schema: any = getDriverConfigSchema(driver);
    const raw = schema?.shape;
    shape = typeof raw === 'function' ? raw() : raw;
  } catch {
    return [];
  }
  if (!shape) return [];
  return Object.entries(shape)
    .filter(([, member]) => baseTypeOf(member) === 'never')
    .map(([key]) => key);
}

/** Every config key this module hides for `driver`, canonical + alias + writable-but-secret. */
export function redactableConfigKeys(driver: unknown): string[] {
  const derived = refusedCredentialKeys(driver);
  const canonical = derived.length > 0 ? derived : [...CANONICAL_CREDENTIAL_KEYS];
  const stillWritable = typeof driver === 'string' ? (STILL_WRITABLE_CREDENTIAL_KEYS[driver] ?? []) : [];
  return [...new Set([...canonical, ...FORMER_CREDENTIAL_ALIASES, ...stillWritable])];
}

/**
 * `scheme://[user[:password]@]rest`. Anchored, and every class excludes `/?#`
 * so a password-looking substring in a path or query cannot be mistaken for one
 * — `https://host/a:b@c` has no userinfo and must come back untouched.
 *
 * The password group deliberately ALLOWS `@` and is greedy, which (with
 * backtracking) makes the match end at the LAST `@` before the path — the
 * userinfo boundary RFC 3986 actually defines. A lazier class stopping at the
 * first `@` would split `postgres://u:p@ss@host/db` after `p`, leave `ss@host`
 * in place, and publish a fragment of the password while looking redacted.
 * Such a URL is malformed (a literal `@` in userinfo must be `%40`), which is
 * precisely why it must not be the case that decides how much leaks.
 *
 * The write door's detector (`urlUserinfoPassword` in `driver/common.zod.ts`)
 * draws the same boundaries; now that both live in this package, the pin
 * keeping them aligned is `datasource-credential-redaction.test.ts`.
 */
const URL_USERINFO_RE = /^([a-z][a-z0-9+.\-]*:\/\/)([^/?#@:]*)(:[^/?#]*)@/i;

/**
 * Strip the password component from a URL's userinfo, preserving the scheme,
 * the username, and everything from the host onward.
 *
 * Returns the input unchanged when there is nothing to strip, which is what
 * makes "did this value change?" a usable test for whether a credential was
 * present.
 */
export function redactUrlPassword(value: string): string {
  return value.replace(URL_USERINFO_RE, (_m, scheme: string, user: string) => `${scheme}${user}@`);
}

/** A driver `config` with its credential material removed, and what was removed. */
export interface RedactedDatasourceConfig {
  config: Record<string, unknown>;
  /**
   * Config keys whose value was removed or rewritten, sorted. Serving this
   * alongside the redacted config is the difference between a caller that knows
   * a credential is being withheld and one that infers it from an absence.
   */
  redactedKeys: string[];
}

/**
 * Remove every stored credential from a driver `config` for serving on a read
 * path.
 *
 * Pure: the input object is never mutated, so a caller holding the stored
 * record (the connect path does) is unaffected.
 */
export function redactDatasourceConfig(
  driver: unknown,
  config: Record<string, unknown> | undefined,
): RedactedDatasourceConfig {
  if (!config || typeof config !== 'object') return { config: {}, redactedKeys: [] };

  const hidden = new Set(redactableConfigKeys(driver));
  const out: Record<string, unknown> = {};
  const redactedKeys: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (hidden.has(key)) {
      // Dropped, not masked. A mask would round-trip back through the wizard as
      // a literal new password, and post-#8078 the canonical spellings would
      // then be REFUSED at the write door — turning an untouched "Save" into an
      // error the author cannot act on. An absent key is the shape the form
      // already understands from `hasSecret`.
      if (value !== undefined) redactedKeys.push(key);
      continue;
    }
    if (typeof value === 'string') {
      const redacted = redactUrlPassword(value);
      if (redacted !== value) {
        out[key] = redacted;
        redactedKeys.push(key);
        continue;
      }
    }
    out[key] = value;
  }

  return { config: out, redactedKeys: redactedKeys.sort() };
}
