// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Planner for the operator-initiated credential re-homing action (#8155) —
 * *"Move credential to the secret store"*.
 *
 * ## What this decides, and why it is a pure function
 *
 * A datasource row written before #8078 closed the write door can still hold
 * its credential in cleartext inside `config` (`config.password`,
 * `config.authToken`, a pre-#8078 alias spelling, or embedded in a connection
 * URL's userinfo). #8081 closed the READ path so none of it is served, and
 * #8154 closed the `/meta` read path — neither removes what is already at
 * rest. This module answers the one question the removal turns on: **can this
 * row's stored credential be re-homed into `sys_secret` without changing which
 * credential the connect path actually uses?**
 *
 * It is pure and I/O-free so every verdict is unit-testable against a stored
 * row, and so the service that executes it cannot accidentally decide policy in
 * the middle of a write sequence.
 *
 * ## The one migratable key: the driver's own refused slot
 *
 * The candidate set is `refusedCredentialKeys(driver)` — the keys a driver's
 * own config contract declares `z.never()` — and NOTHING else. That is exactly
 * the key whose value the injected `spec.secret` substitutes at connect time,
 * measured per arm:
 *
 * | driver             | slot         | what the connect path does with `spec.secret`                    |
 * |--------------------|--------------|------------------------------------------------------------------|
 * | postgres           | `password`   | `spec.secret ? password : cfg.password` — exact substitute        |
 * | mysql              | `password`   | same, on the discrete-field branch                               |
 * | mongodb            | `password`   | `spec.secret ?? cfg.password` in `buildMongoUrl`                 |
 * | turso              | `authToken`  | `spec.secret` read AHEAD of `config.authToken` (#8152)           |
 * | sqlite/wasm/memory | *(none)*     | no credential slot at all                                        |
 *
 * Three families are deliberately NOT candidates, each for its own reason:
 *
 *  - **Pre-#8078 alias spellings** (`passwd`, `pwd`, `token`, `jwt`,
 *    `auth_token`, `authtoken`). No connection builder reads them, so they are
 *    not live credentials — binding one would ADD a credential to a connection
 *    that authenticates without it today, which is a behaviour change on a
 *    working datasource. They are reported as `remaining` instead, so the
 *    operator can clear them by hand.
 *  - **`encryptionKey` (turso)** — credential-shaped and deliberately still
 *    writable (#8078). The binder injects exactly ONE secret slot and that slot
 *    is the `authToken`; binding an encryption key into it would hand the
 *    driver the wrong credential. Giving it a slot of its own is #8081 item 4
 *    and is NOT decided here.
 *  - **A credential embedded in a URL's userinfo** — see below.
 *
 * ## Why a URL-embedded credential is REFUSED rather than extracted
 *
 * `postgresql://user:pass@host/db` in `config.url` holds the same secret as
 * `config.password`, and #8082 refuses it at the publish door — so such a row
 * IS in the `/meta` `_diagnostics.valid:false` inventory this migration works
 * from. It is still refused here, on a measured asymmetry in the connect path:
 * the DSN branches of the **mysql** and **mongodb** arms hand the URL to the
 * client verbatim and drop the injected `spec.secret` entirely
 * (`buildMysqlConnection`: `if (url) return url;` — `buildMongoUrl`:
 * `if (explicit) return explicit;`). Extracting the password out of the URL and
 * binding it would therefore leave those datasources connecting with **no
 * credential at all** — a migration that reports success and breaks the row.
 *
 * The remedy is stated per row instead (fallback (a) in the card's terms): the
 * operator re-enters the credential through the connection form, whose secret
 * field already binds it. Making these rows machine-migratable is a change to
 * the *producer* — the driver factory's DSN branches would have to honour the
 * injected secret — not something this action may paper over from the consumer
 * side (Prime Directive #12).
 */

import {
  redactableConfigKeys,
  redactUrlCredentials,
  refusedCredentialKeys,
  validateDriverConfig,
} from '@objectstack/spec/data';
import type { StoredDatasource } from './datasource-admin-service.js';

/** Remedy sentence shared by every refusal that leaves the credential at rest. */
const REENTER_REMEDY =
  'Open the datasource in Setup → Datasources and re-enter the credential in the connection '
  + "form's secret field: that path binds it into the secret store and stores only an opaque "
  + '`external.credentialsRef`, then remove the cleartext from `config`.';

/** What {@link planCredentialMigration} decided should happen to a stored row. */
export type CredentialMigrationPlan =
  /** Bind `value` (read from `config[key]`) and drop that key once the ref is durable. */
  | { action: 'bind'; key: string; value: string; remaining: string[] }
  /**
   * A `credentialsRef` is ALREADY on the row and an inline copy of the credential
   * is still in `config`: finish the job by dropping the inline key only. NEVER
   * mints a second `sys_secret` row — the orphan-accumulation failure mode
   * measured on #8103 and guarded in PR #8114's `headersPatch` compare-before-write.
   */
  | { action: 'drop-inline'; key: string; credentialsRef: string; remaining: string[] }
  /** Nothing to do — already migrated, or never held a bindable credential. */
  | { action: 'none'; status: 'already-bound' | 'nothing-to-migrate'; remaining: string[] }
  /** Cannot be re-homed by this action; `reason` and `remedy` are operator-facing. */
  | { action: 'refuse'; reason: string; remedy: string };

/** Config keys holding a non-empty string value. */
function stringValued(config: Record<string, unknown> | undefined): Array<[string, string]> {
  if (!config || typeof config !== 'object') return [];
  return Object.entries(config).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
  );
}

/**
 * Config keys whose string value embeds a credential in a URL — userinfo
 * password (#8082) or credential-bearing query parameter (#8337,
 * `?authToken=` / `?password=`).
 *
 * Uses the spec's own detector (`redactUrlCredentials`, the read path's URL
 * half) rather than a second regex: "did redaction change this value?" is
 * exactly the question, and the boundaries it draws are the ones the write
 * door's refusal draws too — both syntaxes included, so a stored
 * `?authToken=` row is refused with the per-row remedy instead of planning
 * `nothing-to-migrate` while a JWT sits cleartext in its URL.
 */
export function urlCredentialKeys(config: Record<string, unknown> | undefined): string[] {
  return stringValued(config)
    .filter(([, value]) => redactUrlCredentials(value) !== value)
    .map(([key]) => key)
    .sort();
}

/**
 * Credential-shaped config keys this action will not bind: the pre-#8078 alias
 * spellings and any driver key that is credential-shaped but still writable
 * (turso's `encryptionKey`).
 *
 * Derived by subtracting the driver's bindable slot from the READ path's own
 * redaction set (`redactableConfigKeys`, the one security list #8300 put in
 * spec) — never a second hand-written list. A refused key added to a driver
 * contract tomorrow therefore lands on the bindable side automatically, and a
 * new still-writable credential key lands here.
 */
function unbindableCredentialKeys(
  driver: unknown,
  config: Record<string, unknown> | undefined,
  bindable: ReadonlySet<string>,
): string[] {
  const present = new Set(stringValued(config).map(([key]) => key));
  return redactableConfigKeys(driver)
    .filter((key) => present.has(key) && !bindable.has(key))
    .sort();
}

/**
 * Decide what a re-homing run should do with one stored datasource row.
 *
 * Every branch either produces a concrete action or a REFUSAL that names why
 * and what to do instead — an unstated outcome for the residue is precisely the
 * gap that makes a migration story incomplete (#8155).
 */
export function planCredentialMigration(record: StoredDatasource): CredentialMigrationPlan {
  if ((record.origin ?? 'code') !== 'runtime') {
    return {
      action: 'refuse',
      reason:
        `Datasource '${record.name}' is code-defined (origin: 'code'), so its definition is owned by `
        + 'the artifact that declares it and cannot be rewritten at runtime.',
      remedy:
        'Move the credential in the source that defines this datasource: bind it through '
        + '`external.credentialsRef`, or supply it from the runtime environment.',
    };
  }

  const config = record.config;
  const urlKeys = urlCredentialKeys(config);
  if (urlKeys.length > 0) {
    return {
      action: 'refuse',
      reason:
        `Datasource '${record.name}' carries its credential inside a connection URL `
        + `(${urlKeys.map((k) => `config.${k}`).join(', ')}). A bound secret is not a substitute for a `
        + "URL-embedded one on every driver: the mysql and mongodb arms hand the URL to the client "
        + 'verbatim and drop the injected secret, so re-homing it here could leave this datasource '
        + 'connecting with no credential at all.',
      remedy:
        'Edit the datasource in Setup → Datasources: remove the credential from the URL (the '
        + 'userinfo password and/or the `?authToken=` / `?password=` query parameter; a bare '
        + '`user@host` is accepted) and enter it in the connection form\'s secret field, which binds '
        + 'it into the secret store.',
    };
  }

  const bindable = new Set(refusedCredentialKeys(record.driver));
  const present = new Map(stringValued(config));
  const candidates = [...bindable].filter((key) => present.has(key)).sort();
  const remaining = unbindableCredentialKeys(record.driver, config, bindable);
  const credentialsRef = record.external?.credentialsRef;

  if (candidates.length === 0) {
    // Nothing bindable is stored. Either an honest no-op, or a refusal for the
    // row that holds credential-shaped cleartext this action must not bind —
    // and the three reasons for that are genuinely different, so they are said
    // differently rather than folded into one message that fits none of them.
    if (remaining.length > 0) {
      const named = remaining.map((k) => `config.${k}`).join(', ');
      if (!validateDriverConfig(record.driver, {}).known) {
        return {
          action: 'refuse',
          reason:
            `Datasource '${record.name}' holds ${named}, and this platform ships no config contract for `
            + `driver '${String(record.driver)}' — so which key (if any) is its credential is unknown here. `
            + 'Binding one into the single secret slot could hand the driver a credential it never reads, '
            + 'leaving the connection unauthenticated.',
          remedy:
            'Move the credential through whatever door that driver documents; the datasource secret '
            + "binder's slot reaches a driver only if that driver reads the injected secret.",
        };
      }
      if (bindable.size === 0) {
        return {
          action: 'refuse',
          reason:
            `Datasource '${record.name}' holds ${named}, but the ${String(record.driver)} driver takes no `
            + 'bound credential at all — its contract declares no inline credential key, so there is no '
            + 'slot for the secret binder to fill.',
          remedy:
            'Remove the key by hand in Setup → Datasources: no connection this driver opens reads it.',
        };
      }
      return {
        action: 'refuse',
        reason:
          `Datasource '${record.name}' holds ${named}, which the ${String(record.driver)} driver does not `
          + 'read as its credential — a pre-#8078 alias spelling, or a key that is credential-shaped but '
          + 'deliberately still writable (turso\'s `encryptionKey`, #8081 item 4). Binding one into the '
          + 'single secret slot would hand the driver a credential it does not use, or add authentication '
          + 'to a connection that works without it today.',
        remedy:
          'Remove the key by hand in Setup → Datasources; if it IS the live credential, re-enter it in '
          + "the connection form's secret field, which binds it into the secret store.",
      };
    }
    return {
      action: 'none',
      status: credentialsRef ? 'already-bound' : 'nothing-to-migrate',
      remaining,
    };
  }

  if (candidates.length > 1) {
    // ⚠️ NOT reachable through any driver contract shipped today, and that is
    // an invariant rather than an accident: every builtin declares at most one
    // `z.never()` credential key, pinned by
    // `datasource-credential-migration.test.ts`. This arm is the fail-safe for
    // the day a contract declares two — without it the planner would silently
    // bind whichever sorted first, i.e. re-home one credential and leave the
    // other in cleartext while reporting success. When that pin goes red, the
    // decision it points at is which key the ONE secret slot should carry, and
    // that is not a decision this planner may take on its own.
    return {
      action: 'refuse',
      reason:
        `Datasource '${record.name}' stores more than one bindable credential `
        + `(${candidates.map((k) => `config.${k}`).join(', ')}), and the datasource secret binder fills `
        + 'exactly one secret slot per datasource.',
      remedy: REENTER_REMEDY,
    };
  }

  const key = candidates[0];
  const value = present.get(key) as string;

  if (credentialsRef) {
    // The row already references a secret AND still holds the inline copy —
    // reachable two ways, both real: an interrupted earlier run, and an
    // operator who re-entered the credential in the wizard (whose
    // `restoreRedactedConfig` carries the stored cleartext forward by design).
    // The connect path already prefers the resolved secret over `config`, so
    // dropping the inline key changes nothing about which credential is used.
    return { action: 'drop-inline', key, credentialsRef, remaining };
  }

  return { action: 'bind', key, value, remaining };
}
