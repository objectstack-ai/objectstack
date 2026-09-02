// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14157] THE dev-admin seed's precondition — "does a LOGIN already exist?"
 *
 * ## The defect this module exists to close
 *
 * `objectstack dev` declares, in its own `--help`, that it seeds *a known,
 * loginable dev admin … never overwrites an existing account*. The gate that
 * implemented it asked a different question: **does any human `sys_user` row
 * exist?** Those two are the same question only while every user row carries a
 * credential.
 *
 * They come apart the moment an app declares people in `defineStack({ data })`.
 * A seeded person is a **directory row with no account** — it is not a login,
 * and treating it as one is the defect. The declarative seed is awaited inside
 * `AppPlugin.start()`, so it has always landed before the seed's own
 * `kernel:ready` hook runs: the database is non-zero-user *before* the check,
 * the admin is never minted, and because the row survives, it is never minted
 * on any later boot either. The deployment ends up with **no loginable account
 * at all** — measured end to end on a 13-person demo seed: 13 `sys_user` rows,
 * **zero** `sys_account` rows, `POST /auth/sign-in/email` → 401.
 *
 * So the predicate moves from the directory to the credential store, which is
 * where the answer actually lives. Two reads, because the card's two suggested
 * spellings each guard a case the other does not:
 *
 *  1. **Is the configured seed address already claimed?** Any account of any
 *     provider on that address means the seed must not touch it — the
 *     never-overwrite half of the declared contract, held whether that account
 *     is a local password or a federated identity. (This is the question
 *     `maybeReportExistingSeedAdmin` already asks one function later; it is
 *     asked *here* too so the gate and the report agree.)
 *  2. **Does a local password login exist anywhere?** That is what the seed
 *     provides, so that is what makes providing it unnecessary. `provider_id:
 *     'credential'` is the card's own prescription and triage's ruled fix
 *     direction ("gate on a credential-bearing account, not on user rows").
 *
 * ## Fail posture: unanswerable ⇒ do not act, loudly
 *
 * A probe that cannot be answered is NOT "no login" — reading it that way is
 * how a gate mints a known-credential account into an environment it could not
 * read. `unanswerable` is therefore its own verdict and the caller reports it,
 * rather than folding into either decision. In practice it is close to
 * unreachable: `sys_account` is registered by this very plugin, so a
 * composition that has an auth plugin has the table this probe reads.
 *
 * ## Deliberate NON-consequence: this widens no public door
 *
 * The gate decides only whether the deployment's own boot command provisions
 * its admin. The *admission* of that provisioning call is a separate question
 * with a separate answer (`AuthManager.stageOperatorProvisioning`), because the
 * audience gate's bootstrap bypass — "zero HUMAN users" — is a public
 * self-registration carve-out and must keep counting humans. Measured: with 13
 * seeded people and zero accounts, the seed's own `api.signUpEmail` call is
 * refused `SELF_REGISTRATION_CLOSED` under the default `invite_only` posture.
 * A fix that moved only this gate would have produced a seed that decides to
 * run and a gate that then refuses it — the exact drift `isHumanUserRow`'s doc
 * warns about.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/** The bounded reads this probe performs — every data engine satisfies them. */
export interface DevAdminSeedProbeEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

/**
 * Why the seed is not acting on this boot — or `act: true` when it should.
 *
 * The reasons are distinct because the caller says different things about
 * them: a claimed address and an existing local login are both normal,
 * expected outcomes that re-arm the credential hint, while `unanswerable` is a
 * degradation the operator has to be told about.
 */
export type DevAdminSeedGateVerdict =
  | { act: true }
  | {
      act: false;
      /**
       * `seed-address-claimed` — an account already holds the configured seed
       * address (never overwrite it).
       * `local-login-exists` — some other local password login already exists,
       * so the environment is not login-less and the seed has nothing to add.
       * `unanswerable` — the credential store could not be read; the seed
       * declines rather than guessing.
       */
      reason: 'seed-address-claimed' | 'local-login-exists' | 'unanswerable';
    };

const SYSTEM_READ = { context: { isSystem: true } } as const;

/** better-auth's local password provider — the one the dev seed provisions. */
export const CREDENTIAL_PROVIDER_ID = 'credential';

function asRows(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const records = (raw as { records?: unknown } | null | undefined)?.records;
  return Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
}

/**
 * Decide whether the dev-admin seed should provision on this boot.
 *
 * Never throws: an unanswerable read is reported as `unanswerable`, never
 * silently folded into "no login exists".
 *
 * @param engine  the data engine, read through the system context
 * @param seedEmail  the address {@link devSeedAdminEmail} resolved
 */
export async function decideDevAdminSeedGate(
  engine: DevAdminSeedProbeEngine | undefined,
  seedEmail: string,
): Promise<DevAdminSeedGateVerdict> {
  if (!engine || typeof engine.find !== 'function') return { act: false, reason: 'unanswerable' };
  try {
    // (1) Is the configured address already claimed by an account?
    //
    // Both spellings, the same two-spelling read the walled-owner probe
    // performs: better-auth lowercases on `createUser`, but a row inserted by
    // some other path (an app seed, an import) carries whatever it was given,
    // and `OS_SEED_ADMIN_EMAIL` may itself be mixed case.
    const spellings = [...new Set([seedEmail, seedEmail.trim().toLowerCase()])];
    const seedUserIds = new Set<unknown>();
    for (const spelling of spellings) {
      for (const row of asRows(
        await engine.find(
          SystemObjectName.USER,
          { where: { email: spelling }, limit: 5 },
          SYSTEM_READ,
        ),
      )) {
        if (row?.id != null) seedUserIds.add(row.id);
      }
    }
    for (const userId of seedUserIds) {
      const accounts = asRows(
        await engine.find(
          SystemObjectName.ACCOUNT,
          { where: { user_id: userId }, limit: 1 },
          SYSTEM_READ,
        ),
      );
      if (accounts.length > 0) return { act: false, reason: 'seed-address-claimed' };
    }

    // (2) Does any local password login exist at all?
    const credentials = asRows(
      await engine.find(
        SystemObjectName.ACCOUNT,
        { where: { provider_id: CREDENTIAL_PROVIDER_ID }, limit: 1 },
        SYSTEM_READ,
      ),
    );
    if (credentials.length > 0) return { act: false, reason: 'local-login-exists' };

    return { act: true };
  } catch {
    return { act: false, reason: 'unanswerable' };
  }
}
