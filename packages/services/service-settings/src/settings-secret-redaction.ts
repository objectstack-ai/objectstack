// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Secret redaction for the settings **REST boundary** (#7522).
 *
 * `SettingsService` decrypts on purpose: `materialiseRow()` dereferences the
 * `sec_` handle through `sys_secret` and hands back cleartext, because the
 * in-process consumers of this service — `createClient()` / `snapshotOf()`, and
 * through them the mail / sms / storage / auth plugins — need the real secret to
 * open an SMTP session or sign an API call. That decryption is load-bearing and
 * stays exactly where it is.
 *
 * What was missing is the boundary on the way OUT. `getNamespace()` copies that
 * plaintext into `values.<key>.value` **and** into every `cascadeChain` entry,
 * and the REST handler used to serve the payload verbatim — so every operator,
 * integration, proxy, browser cache and HAR capture on that response path
 * received the cleartext of every secret in the namespace, defeating the whole
 * point of the `value_enc` + `sys_secret` split. The endpoint requires
 * `setup.access`, so this is defense-in-depth rather than privilege escalation;
 * it is still an exposure, and the REST response is the one surface that should
 * never carry the cleartext.
 *
 * The mask shape is NOT invented here — it mirrors the encrypted-**field**
 * convention ADR-0100 pins for `secret` / `password` columns on the generic CRUD
 * path (`SECRET_MASK` in `@objectstack/objectql`, exercised by the
 * `records-forms.encrypted-field-behavior` checklist item):
 *
 *  - **read**: a set value becomes the mask; an unset one stays `null`, so the
 *    response is presence-preserving and the console can still render
 *    "configured" vs "not configured" (and the env-lock affordances keep
 *    working — `source`, `locked` and `lockedReason` are untouched).
 *  - **write**: a submitted value equal to the mask means "unchanged" and the
 *    key is DROPPED from the patch, so a form round-trip that echoes the mask
 *    does not overwrite the stored secret with the mask's literal text.
 *
 * The constant is redeclared rather than imported because this service is
 * deliberately framework-agnostic (see the `settings-service.ts` header): it
 * defines its own minimal `SettingsEngine` instead of importing `IDataEngine`,
 * and does not depend on `@objectstack/objectql` at all. Taking a runtime
 * dependency on the whole data engine to reach one string would undo that. The
 * long-term fix is to hoist the mask into a package both sides already depend on
 * (`@objectstack/spec`) and have objectql re-export it — recorded on #7522 as
 * follow-up rather than done here, since it is a cross-package move on a
 * security card.
 */

import type { ResolvedSettingValue } from '@objectstack/spec/system';

/**
 * Value served in place of a set secret on the REST read path. Says "a secret
 * is set" without leaking its cleartext; an unset secret resolves to `null`
 * instead, so set-vs-unset stays observable.
 *
 * Byte-identical to `SECRET_MASK` in `@objectstack/objectql` (ADR-0100) — eight
 * U+2022 BULLET characters — so one client-side comparison recognises a masked
 * read from either surface. Spelled as the literal, not an escape, so a grep for
 * the mask finds both declarations.
 */
export const SETTINGS_SECRET_MASK = '••••••••';

/** Mask one resolved value: the effective value AND every cascade entry. */
function maskResolved(resolved: ResolvedSettingValue): ResolvedSettingValue {
  return {
    ...resolved,
    // `== null` covers both null and undefined: an unset secret must stay
    // distinguishable from a set one.
    value: resolved.value == null ? null : SETTINGS_SECRET_MASK,
    // The chain is where the same plaintext was repeated once per scope. Masked
    // entry-by-entry rather than dropped, so "global sets this, your user
    // overrides it" still renders — only the values go.
    ...(resolved.cascadeChain
      ? {
          cascadeChain: resolved.cascadeChain.map((entry) => ({
            ...entry,
            value: entry.value == null ? null : SETTINGS_SECRET_MASK,
          })),
        }
      : {}),
  };
}

/**
 * Redact every secret-backed value in a resolved map, returning a NEW map.
 *
 * Non-mutating on purpose: the same helper serves the GET payload and the PUT
 * response, and neither may hand a mutated object back to an in-process caller
 * that is entitled to the plaintext.
 *
 * `secretKeys` is the service's own encrypted-key set (`secretKeysOf()`), i.e.
 * exactly the set the write path uses to decide what gets encrypted — so the
 * two sides cannot drift into "encrypted on write, cleartext on read".
 */
export function redactSecretValues(
  values: Record<string, ResolvedSettingValue>,
  secretKeys: ReadonlySet<string>,
): Record<string, ResolvedSettingValue> {
  if (secretKeys.size === 0) return values;
  const out: Record<string, ResolvedSettingValue> = {};
  for (const [key, resolved] of Object.entries(values)) {
    out[key] = secretKeys.has(key) ? maskResolved(resolved) : resolved;
  }
  return out;
}

/**
 * Drop every secret key whose submitted value is the echoed read mask.
 *
 * The classic second bug of a redaction fix: the console reads `••••••••`,
 * submits the form unchanged, and the write path stores the mask's literal text
 * over the real secret — silently destroying it, with the mask then decrypting
 * back to itself so nothing looks wrong until the SMTP login fails. Dropping the
 * key makes the echo a no-op, which is what "unchanged" means.
 *
 * Scoped to `secretKeys`: a plain text setting whose value genuinely IS eight
 * bullets is a legal write and is left alone.
 */
export function dropEchoedSecretMasks(
  patch: Record<string, unknown>,
  secretKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (secretKeys.size === 0) return patch;
  let dropped = false;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (secretKeys.has(key) && value === SETTINGS_SECRET_MASK) {
      dropped = true;
      continue;
    }
    out[key] = value;
  }
  return dropped ? out : patch;
}
