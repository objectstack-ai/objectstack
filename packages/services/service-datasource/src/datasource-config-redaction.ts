// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Read-path credential redaction for a datasource's driver `config` (#8081,
 * the services half of #7990).
 *
 * #8078 closed the WRITE door: `config.password` / `config.authToken` are
 * declared-unwritable (`z.never()`) on every driver that has them, so no new
 * row can carry an inline credential. It could not close the READ door, and it
 * did not try: rows written before it still carry cleartext, and
 * `DatasourceAdminService.getDatasource()` handed `config` back verbatim while
 * its own doc comment claimed the credential had been stripped. This module is
 * the strip that comment described.
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
 *     hand-maintained list in this package would not be.
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
 * `config.password`, and #7990/#8078 left refusing it explicitly UNRULED — the
 * spec half pinned the behaviour as a fact rather than rejecting it. This
 * module does not disturb that: nothing here refuses a URL, at any door. But a
 * scrub that dropped `config.password` and then served the identical credential
 * one key over would be a scrub in name only — the same "claims a protection it
 * does not perform" shape #8081 exists to end. So the read path redacts the
 * PASSWORD COMPONENT of a URL's userinfo and leaves everything else, including
 * the username, byte-for-byte. Redacting a value on the way out is not the same
 * act as refusing it on the way in, and only the second one is unruled.
 *
 * ## Why redaction must be reversible
 *
 * `getDatasource()` feeds the Studio edit form, and `updateDatasource()` takes
 * that form's `config` back as a whole-object patch. A scrub with no inverse
 * would therefore turn every "Save" on an unmodified form into silent credential
 * DELETION — trading a disclosure bug for a data-loss bug. {@link
 * restoreRedactedConfig} is that inverse, and it is the same rule the secret
 * path next to it has always used ("preserve the existing `credentialsRef`
 * unless a new secret rewraps it"), applied to the material this module hides.
 */

import { getDriverConfigSchema } from '@objectstack/spec/data';

/**
 * Canonical inline-credential spellings, used for a driver whose contract this
 * platform does not ship. Kept in sync with the schemas by
 * `datasource-config-redaction.test.ts`, which asserts every `z.never()` key
 * across every builtin driver appears here — so a new refused key cannot land
 * without this fallback learning it.
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
    const schema: any = getDriverConfigSchema(driver as never);
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

/**
 * Re-apply the credential material {@link redactDatasourceConfig} hid, for a
 * patch that is round-tripping a previously-read config back to the store.
 *
 * The rule is deliberately narrow: stored material is carried forward ONLY
 * where the patch is indistinguishable from what the read path served — an
 * absent key, or a URL that matches the stored URL once redacted. Anything the
 * author actually changed wins, including clearing a URL's password by hand.
 *
 * What this does NOT do is let a patch set a refused key: `assertValidConfig`
 * still runs on the merged record, so a caller that types `password` into the
 * config gets #8078's refusal exactly as it would without this function.
 */
export function restoreRedactedConfig(
  driver: unknown,
  patch: Record<string, unknown> | undefined,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!patch || typeof patch !== 'object') return patch;
  if (!stored || typeof stored !== 'object') return patch;

  const hidden = new Set(redactableConfigKeys(driver));
  const out: Record<string, unknown> = { ...patch };

  for (const key of hidden) {
    // Only when the patch does not speak to the key at all. A patch that DOES
    // carry it is the author's word, and (for a refused spelling) is about to
    // be refused on its own merits rather than quietly overwritten here.
    if (!(key in out) && stored[key] !== undefined) out[key] = stored[key];
  }

  for (const [key, storedValue] of Object.entries(stored)) {
    if (hidden.has(key) || typeof storedValue !== 'string') continue;
    const redactedStored = redactUrlPassword(storedValue);
    // Unchanged by redaction ⇒ it carried no credential ⇒ nothing to restore.
    if (redactedStored === storedValue) continue;
    if (out[key] === redactedStored) out[key] = storedValue;
  }

  return out;
}
