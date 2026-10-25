// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The development boot's DEMO ACCOUNTS — the stack's `demoStaff`, provisioned
 * by the platform because the application may only declare them (hotclm#28,
 * maintainer ruling D: "demo accounts are the platform's to create; the app
 * only declares them").
 *
 * An entry mints an account that can SIGN IN with the development seed
 * password, so everything here is the security boundary first and a
 * convenience second. Three questions, asked in this order, each with its own
 * refusal:
 *
 * 1. **Is this a local development boot?** ({@link decideDemoStaffEnvironmentGate})
 *    The `maybeSeedDevAdmin` posture — `NODE_ENV === 'development'`, never a
 *    migrate-and-exit run — plus two clauses of its own: the auth base URL is a
 *    loopback address (an `os dev` server published at a reachable address is
 *    not local, whatever `NODE_ENV` says), and the tenancy posture is `single`
 *    (a walled posture admits no new account to an organization by itself, so
 *    a demo account there would sign in to nothing). Answered from
 *    configuration alone, so `AuthPlugin.init()` can publish it before any
 *    application seed runs.
 * 2. **Can someone already sign in?** ({@link probeDemoStaffPriorLogin}) Under
 *    `single` the oldest account that can sign in is promoted to platform
 *    admin. A demo account must never be that account, so on a database where
 *    nothing but demo accounts could sign in, none is created. The development
 *    admin seed runs first on the same `kernel:ready`, so on an `os dev` boot
 *    this holds unless the admin seed was turned off.
 * 3. **Which entries still need work?** ({@link provisionDemoStaff})
 *    Idempotent: an address that already has an account is left exactly as it
 *    is (never renamed, never re-passworded), and only its missing position and
 *    permission-set assignments are added.
 *
 * A refusal carries an ADR-0112 `code` and HTTP-equivalent `status` from the
 * standard catalog and is reported once, at `warn` — nothing claims to have
 * been persisted, the boot is visibly smaller by its demo accounts, and the
 * line names the remedy (AGENTS.md → Degradation log levels).
 *
 * ## Sharing rules need no re-evaluation here
 *
 * The app-side scripts this replaces re-evaluated every sharing rule after
 * staffing, because `plugin-sharing` once skipped system writes. That skip is
 * retired (`plugin-sharing` `rule-hooks.ts`), and a `sys_user_position` write
 * re-evaluates every rule naming that position for the user it names
 * (`recipient-membership-recompute.ts`), system writes included. The seed then
 * writes its rows with the demo accounts already present, and the rules'
 * record hooks grant on those writes.
 */

import { SystemObjectName } from '@objectstack/spec/system';
import type { DemoStaffParsed } from '@objectstack/spec/system';

/** The system context every read and write here runs under. */
const SYSTEM_CTX = { context: { isSystem: true } } as const;

/** Why demo accounts were not provisioned on this boot. */
export type DemoStaffRefusalReason =
  | 'not-development'
  | 'migrate-and-exit'
  | 'walled-posture'
  | 'non-loopback-base-url'
  | 'no-prior-login'
  | 'unanswerable';

/**
 * One refusal, in the ADR-0112 envelope's terms: a standard-catalog `code`, the
 * HTTP status that code carries, and the remedy-bearing `message` the boot log
 * prints. `reason` is the machine discriminator a test or a caller branches on.
 */
export interface DemoStaffRefusal {
  readonly code: 'PERMISSION_DENIED' | 'PRECONDITION_REQUIRED' | 'SERVICE_UNAVAILABLE';
  readonly status: 403 | 428 | 503;
  readonly reason: DemoStaffRefusalReason;
  readonly message: string;
}

export type DemoStaffGateVerdict = { act: true } | { act: false; refusal: DemoStaffRefusal };

/** The configuration facts question 1 is decided from. */
export interface DemoStaffEnvironment {
  /** `process.env.NODE_ENV` as this process reads it. */
  readonly nodeEnv: string | undefined;
  /** `OS_MIGRATE_AND_EXIT === '1'` — a migration run never provisions a login. */
  readonly migrateAndExit: boolean;
  /** Whether the tenancy posture in force walls organizations off (`group` / `isolated`). */
  readonly wallEnforced: boolean;
  /** The auth base URL this plugin was configured with, as configured. */
  readonly baseUrl: string | undefined;
  /** Whether {@link baseUrl} names a loopback host — judged by the caller's loopback rule. */
  readonly baseUrlIsLoopback: boolean;
}

const forbidden = (reason: DemoStaffRefusalReason, message: string): DemoStaffGateVerdict => ({
  act: false,
  refusal: { code: 'PERMISSION_DENIED', status: 403, reason, message },
});

/**
 * Question 1 — is this a boot that may create sign-in-capable demo accounts at
 * all? Pure: every fact is handed in, so the boundary is testable without a
 * process environment.
 */
export function decideDemoStaffEnvironmentGate(env: DemoStaffEnvironment): DemoStaffGateVerdict {
  if (env.nodeEnv !== 'development') {
    return forbidden(
      'not-development',
      `this is not a development boot (NODE_ENV=${env.nodeEnv ?? 'unset'}). Demo accounts sign in with the ` +
        'development seed password, so they are created by `os dev` only; `os build` leaves `demoStaff` out of ' +
        'the artifact a deployment boots.',
    );
  }
  if (env.migrateAndExit) {
    return forbidden(
      'migrate-and-exit',
      'this boot is a migrate-and-exit run (OS_MIGRATE_AND_EXIT=1), and a migration run never provisions a ' +
        'login. Run `os dev` to create them.',
    );
  }
  if (env.wallEnforced) {
    return forbidden(
      'walled-posture',
      'the tenancy posture walls organizations off, and a new account there joins no organization by ' +
        'itself, so a demo account would sign in to nothing. Demo accounts are provisioned under the ' +
        '`single` posture `os dev` boots by default.',
    );
  }
  if (!env.baseUrl || !env.baseUrlIsLoopback) {
    return forbidden(
      'non-loopback-base-url',
      `the auth base URL (${env.baseUrl ?? 'not configured'}) is not a loopback address: this server is ` +
        'configured to be reached somewhere other than this machine, and a known-password account must not ' +
        'exist there. Boot with a localhost base URL to create them.',
    );
  }
  return { act: true };
}

/** The bounded reads {@link probeDemoStaffPriorLogin} needs — every data engine satisfies it. */
export interface DemoStaffProbeEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<Array<Record<string, unknown>>>;
}

/** Every spelling an address may be stored under: as declared, and lower-cased as sign-up stores it. */
function addressSpellings(emails: readonly string[]): string[] {
  return [...new Set(emails.flatMap((email) => [email, email.trim().toLowerCase()]))];
}

/**
 * Question 2 — does an account that can sign in already exist that is NOT one
 * of the declared demo accounts? Any provider counts (a federated login is a
 * login, as the platform-admin promotion counts it). A probe that cannot be
 * answered refuses rather than guessing "someone can": reading it the other way
 * is how a demo account becomes the promoted platform admin.
 */
export async function probeDemoStaffPriorLogin(
  engine: DemoStaffProbeEngine | undefined,
  staffEmails: readonly string[],
): Promise<DemoStaffGateVerdict> {
  const unanswerable = (detail: string): DemoStaffGateVerdict => ({
    act: false,
    refusal: {
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      reason: 'unanswerable',
      message:
        `whether an account can already sign in could not be read (${detail}), and the first account that can ` +
        'sign in is promoted to platform admin, so no demo account was created. Restart once the data engine ' +
        'is reachable.',
    },
  });
  if (!engine || typeof engine.find !== 'function') return unanswerable('no data engine');
  try {
    const staffUserIds: unknown[] = [];
    const spellings = addressSpellings(staffEmails);
    if (spellings.length > 0) {
      for (const row of await engine.find(
        SystemObjectName.USER,
        { where: { email: { $in: spellings } }, fields: ['id'], limit: spellings.length * 2 },
        SYSTEM_CTX,
      )) {
        if (row?.id != null) staffUserIds.push(row.id);
      }
    }
    const others = await engine.find(
      SystemObjectName.ACCOUNT,
      {
        ...(staffUserIds.length > 0 ? { where: { user_id: { $nin: staffUserIds } } } : {}),
        fields: ['id'],
        limit: 1,
      },
      SYSTEM_CTX,
    );
    if (others.length > 0) return { act: true };
    return {
      act: false,
      refusal: {
        code: 'PRECONDITION_REQUIRED',
        status: 428,
        reason: 'no-prior-login',
        message:
          'no account can sign in yet, and under the `single` posture the first account that can is promoted to ' +
          'platform admin — which must never be a demo account. Keep the development admin seed on (`os dev` ' +
          'without --no-seed-admin), or create the first account yourself, then restart.',
      },
    };
  } catch (err) {
    return unanswerable(String((err as Error)?.message ?? err));
  }
}

/** The engine surface {@link provisionDemoStaff} reads and writes through. */
export interface DemoStaffEngine extends DemoStaffProbeEngine {
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

export interface DemoStaffProvisioningDeps {
  readonly engine: DemoStaffEngine;
  /**
   * Create ONE account through the auth door — the caller's `signUpEmail`,
   * admitted as the operator class with a ticket for exactly this address.
   * Throws when the door refuses.
   */
  readonly signUp: (account: { email: string; password: string; name: string }) => Promise<void>;
  /** The development seed password every demo account signs in with. */
  readonly password: string;
  /**
   * The Default Organization — `tenancy.defaultOrgId()`, `null` when there is
   * none. Every assignment is written in it: a `sys_user_position` or
   * `sys_user_permission_set` row without an organization applies in none
   * (ADR-0131 D1), so there is no unscoped fallback.
   */
  readonly defaultOrganizationId: () => Promise<string | null>;
}

/** What one provisioning pass did, per address. */
export interface DemoStaffOutcome {
  /** Accounts this pass created. */
  readonly created: string[];
  /** Addresses that already had an account, left as they were. */
  readonly present: string[];
  /** Entries that could not be completed, with the reason. Every other entry still ran. */
  readonly failed: Array<{ email: string; message: string }>;
  /** Position and permission-set assignments this pass added. */
  readonly assignmentsAdded: number;
}

async function findUserIdByEmail(engine: DemoStaffEngine, email: string): Promise<string | undefined> {
  const rows = await engine.find(
    SystemObjectName.USER,
    { where: { email: { $in: addressSpellings([email]) } }, fields: ['id'], limit: 1 },
    SYSTEM_CTX,
  );
  const id = rows[0]?.id;
  return id == null ? undefined : String(id);
}

/** Whether the account is a member of the organization — the one its assignments are written in. */
async function isMemberOf(engine: DemoStaffEngine, userId: string, organizationId: string): Promise<boolean> {
  const rows = await engine.find(
    SystemObjectName.MEMBER,
    { where: { user_id: userId, organization_id: organizationId }, fields: ['id'], limit: 1 },
    SYSTEM_CTX,
  );
  return rows.length > 0;
}

/**
 * Question 3 — provision every declared entry. Call only after both gates said
 * `act`. Entries are independent: one that fails is reported and the rest
 * still run.
 */
export async function provisionDemoStaff(
  staff: readonly DemoStaffParsed[],
  deps: DemoStaffProvisioningDeps,
): Promise<DemoStaffOutcome> {
  const { engine, signUp, password } = deps;
  const outcome: DemoStaffOutcome = { created: [], present: [], failed: [], assignmentsAdded: 0 };
  let assignmentsAdded = 0;
  let organizationId: string | null | undefined;

  for (const entry of staff) {
    const email = entry.email.trim().toLowerCase();
    try {
      let userId = await findUserIdByEmail(engine, email);
      if (userId) {
        outcome.present.push(email);
      } else {
        await signUp({ email, password, name: entry.name });
        userId = await findUserIdByEmail(engine, email);
        if (!userId) throw new Error('the sign-up returned but no account row was found for the address');
        outcome.created.push(email);
        // Born verified, as the development admin is: the account is created by
        // the deployment's own boot command with operator-known credentials,
        // and a deployment that requires a verified address to sign in would
        // otherwise refuse every demo account (no mailbox exists for the link).
        // `isSystem` passes the statically-readonly column, the same doorway the
        // better-auth adapter's own verification write uses.
        await engine.update('sys_user', { id: userId, email_verified: true }, { context: { isSystem: true } });
      }

      const permissionSets = entry.permissionSets ?? [];
      if (!entry.position && permissionSets.length === 0) continue;
      // Asked once, after the first account exists: the Default Organization
      // may itself have been created by the development admin's sign-up.
      if (organizationId === undefined) organizationId = await deps.defaultOrganizationId();
      if (!organizationId) {
        throw new Error(
          'there is no Default Organization to assign its position and permission sets in, so none was written',
        );
      }
      // The membership reconciler decides who joins (ADR-0093 D2); this step
      // never writes a membership. An account the membership policy left out
      // would hold assignments in an organization it cannot enter.
      if (!(await isMemberOf(engine, userId, organizationId))) {
        throw new Error(
          'the account is not a member of the Default Organization (the membership policy admitted it to none), ' +
            'so its position and permission sets were not written. Add it to the organization under Setup → ' +
            'Users, then restart.',
        );
      }

      if (entry.position) {
        const row = { user_id: userId, position: entry.position, organization_id: organizationId };
        const held = await engine.find('sys_user_position', { where: row, fields: ['id'], limit: 1 }, SYSTEM_CTX);
        if (held.length === 0) {
          await engine.insert('sys_user_position', row, { context: { isSystem: true } });
          assignmentsAdded++;
        }
      }
      for (const set of permissionSets) {
        const row = { user_id: userId, permission_set: set, organization_id: organizationId };
        const held = await engine.find('sys_user_permission_set', { where: row, fields: ['id'], limit: 1 }, SYSTEM_CTX);
        if (held.length === 0) {
          await engine.insert('sys_user_permission_set', row, { context: { isSystem: true } });
          assignmentsAdded++;
        }
      }
    } catch (err) {
      outcome.failed.push({ email, message: String((err as Error)?.message ?? err) });
    }
  }
  return { ...outcome, assignmentsAdded };
}
