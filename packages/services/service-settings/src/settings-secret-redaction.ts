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
 * The mask shape is NOT invented here — it IS the encrypted-**field** convention
 * ADR-0100 pins for `secret` / `password` columns on the generic CRUD path
 * (`SECRET_MASK`, declared in `@objectstack/spec` and re-exported by
 * `@objectstack/objectql`, exercised by the
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
 * The mask itself is now IMPORTED, not redeclared (#7572). #7522 shipped a
 * second byte-identical literal here and said why: this service is deliberately
 * framework-agnostic (see the `settings-service.ts` header) — it defines its own
 * minimal `SettingsEngine` instead of importing `IDataEngine`, and does not
 * depend on `@objectstack/objectql` at all, so taking a runtime dependency on
 * the whole data engine to reach one string was not worth it. That reasoning
 * held against depending on **objectql**, and it still does. It does not apply
 * to `@objectstack/spec`, which is where the mask now lives: spec is already a
 * dependency of this package, and already in its runtime graph (`manifest.ts`
 * → `@objectstack/platform-objects/system` → `@objectstack/spec/data`). The
 * framework-agnostic property is untouched — no objectql import was added here
 * or anywhere in this package.
 */

import { SECRET_MASK } from '@objectstack/spec/data';
import type { ResolvedSettingValue } from '@objectstack/spec/system';

/**
 * Value served in place of a set secret on the REST read path. Says "a secret
 * is set" without leaking its cleartext; an unset secret resolves to `null`
 * instead, so set-vs-unset stays observable.
 *
 * The ADR-0100 credential read mask under the name this package publishes — the
 * SAME declaration objectql re-exports as `SECRET_MASK`, not a copy of it
 * (#7572), so one client-side comparison recognises a masked read from either
 * surface and no edit can leave the two disagreeing. The literal, its eight
 * U+2022 BULLET characters and its grep-findable spelling are pinned at the
 * declaration in `@objectstack/spec` (`data/secret-mask.ts`).
 */
export const SETTINGS_SECRET_MASK = SECRET_MASK;

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
