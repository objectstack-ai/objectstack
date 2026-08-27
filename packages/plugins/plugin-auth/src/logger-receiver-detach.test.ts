// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12773] Logger calls keep their RECEIVER — pinned with a class-based
 * logger double whose methods actually read `this`.
 *
 * ## The defect, and why every existing suite stayed green
 *
 * Three sites in this package selected a log channel by EXTRACTING the method
 * before calling it:
 *
 *   `(logger?.error ?? logger?.warn)?.(message, meta)`      auth-manager.ts
 *   `const log = deps.logger?.error ?? deps.logger?.warn`   reconcile-membership.ts
 *   `const log = options.logger?.info ?? …`                 adopt-membership.ts
 *
 * `a.b` in *call position* passes `a` as the receiver; `(a.b ?? c.d)(…)`
 * evaluates to the bare function first, so the call runs with
 * `this === undefined`. A plain-closure logger — which is what nearly every
 * test double in this repo is — does not read `this` and survives that
 * perfectly. `@objectstack/core`'s `ObjectLogger` is a real class with
 * prototype methods and NO constructor binding: `error`/`fatal` reach for
 * `this.writeErrorLike`, and `debug`/`info`/`warn` for `this.write`. So the
 * bug was invisible to every unit suite and appeared only in a real composed
 * deployment, where it cost the operator the verdict:
 *
 *   TypeError: Cannot read properties of undefined (reading 'writeErrorLike')
 *       at error (…/packages/core/dist/index.js:650:10)
 *       at _AuthManager.audienceLogError (…/plugin-auth/dist/index.mjs:5460:38)
 *
 * In `validateAudienceAdmission` the damage compounds: the throw from the
 * `try` block lands in the `catch`, which calls the SAME helper again, so the
 * second throw escapes the gate entirely. The audience refusal — a decided,
 * fail-closed 4xx that names what the operator misconfigured — was delivered
 * as `HTTP 500 null`.
 *
 * ## What this file pins, and why case ⓪ comes first
 *
 * A regression pin for this defect is only as good as its double. A bare
 * closure passes against the BROKEN code and pins nothing, so case ⓪ asserts
 * the double's receiver-sensitivity DIRECTLY — and asserts that a closure
 * double would not have caught it. That keeps the rest of the file
 * non-vacuous: if someone later "simplifies" these doubles into plain object
 * literals, case ⓪ goes red instead of the suite going quietly decorative.
 *
 * Cases ①–② drive the REAL audience gate (not the private helper in
 * isolation), so what is pinned is the user-visible contract: the refusal
 * reaches the caller carrying its code and message, and the fallback to
 * `warn` still happens for a host that ships no `error` channel (#9754).
 */

import { describe, it, expect } from 'vitest';
import { AuthManager } from './auth-manager.js';
import { AUDIENCE_CONFIG_ERROR } from './audience-posture.js';
import { reconcileMembership, type MembershipPolicy } from './reconcile-membership.js';
import { adoptExistingMembership } from './adopt-membership.js';

const SECRET = 'test-secret-least-32-characters-long-value';
const BASE_URL = 'http://localhost:3000';

type Level = 'info' | 'warn' | 'error';
interface LoggedLine {
  level: Level;
  message: string;
  meta?: unknown;
}

/**
 * The double the triage grading requires: a CLASS whose channels dispatch
 * through `this`, mirroring `ObjectLogger`'s `this.write` / `this.writeErrorLike`.
 *
 * `#lines`/`record` are reached as `this.record(…)`, so an unbound call throws
 * exactly the way the real logger does. Do NOT rewrite this as an object
 * literal of arrow functions — that is precisely the shape that made the
 * production defect invisible (case ⓪ enforces this).
 */
class ReceiverSensitiveLogger {
  readonly lines: LoggedLine[] = [];

  /** The `this.writeErrorLike` analogue — the dereference that throws when detached. */
  private record(level: Level, message: string, meta?: unknown): void {
    this.lines.push({ level, message, meta });
  }

  info(message: string, meta?: unknown): void {
    this.record('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.record('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.record('error', message, meta);
  }

  at(level: Level): LoggedLine[] {
    return this.lines.filter((l) => l.level === level);
  }
}

/**
 * A reduced host sink: the guaranteed `warn` channel and no `error` at all
 * (#9754's reason the fallback exists). Still class-based, so the fallback
 * leg is held to the same receiver standard as the primary one — a fix that
 * bound only `error` would go red here.
 */
class WarnOnlyReceiverSensitiveLogger {
  readonly lines: LoggedLine[] = [];

  private record(level: Level, message: string, meta?: unknown): void {
    this.lines.push({ level, message, meta });
  }

  warn(message: string, meta?: unknown): void {
    this.record('warn', message, meta);
  }

  at(level: Level): LoggedLine[] {
    return this.lines.filter((l) => l.level === level);
  }
}

/** A manager with NO data engine: all three admission probes answer `false`, which is the misconfigured-deployment shape the defect was measured on. */
function makeManager(logger: unknown, permissionSet = 'ops_self_serve'): AuthManager {
  return new AuthManager({
    secret: SECRET,
    baseUrl: BASE_URL,
    logger,
    audience: { posture: 'open', selfRegistrationPermissionSet: permissionSet },
  } as never);
}

/** The vendor payload `user.validateUserInfo` receives for a self-serve sign-up. */
const SELF_SERVE_CREATE = {
  user: { email: 'newcomer@example.com' },
  source: { action: 'create-user', method: 'signUpEmail' },
};

function driveAudienceGate(
  manager: AuthManager,
): Promise<{ error: string; errorDescription?: string } | undefined> {
  return (
    manager as unknown as {
      validateAudienceAdmission(
        data: unknown,
        ctx?: unknown,
      ): Promise<{ error: string; errorDescription?: string } | undefined>;
    }
  ).validateAudienceAdmission(SELF_SERVE_CREATE);
}

describe('[#12773] ⓪ the doubles are receiver-sensitive (this file is non-vacuous)', () => {
  it('a class-based double THROWS when its method is detached from the receiver', () => {
    const logger = new ReceiverSensitiveLogger();
    const detached = logger.error;
    expect(() => detached('detached call')).toThrow(TypeError);
    expect(() => detached('detached call')).toThrow(/Cannot read properties of undefined/);
    // …and works perfectly when called through the property.
    expect(() => logger.error('bound call')).not.toThrow();
    expect(logger.at('error')).toHaveLength(1);
  });

  it('the warn-only double is receiver-sensitive on its fallback channel too', () => {
    const logger = new WarnOnlyReceiverSensitiveLogger();
    const detached = logger.warn;
    expect(() => detached('detached call')).toThrow(/Cannot read properties of undefined/);
    expect(() => logger.warn('bound call')).not.toThrow();
  });

  it('a CLOSURE double survives the same detachment — which is why one cannot pin this defect', () => {
    const seen: string[] = [];
    const closureLogger = { error: (m: string) => void seen.push(m) };
    const detached = closureLogger.error;
    expect(() => detached('detached call')).not.toThrow();
    expect(seen).toEqual(['detached call']);
  });
});

describe('[#12773] ① the audience gate reports its refusal instead of crashing', () => {
  it('returns the AUTH_CONFIG_ERROR verdict to the caller and logs it at error, receiver intact', async () => {
    const logger = new ReceiverSensitiveLogger();
    const verdict = await driveAudienceGate(makeManager(logger));

    // The consequence the defect destroyed: the refusal REACHES the caller.
    // Before the fix this rejected with the TypeError instead (the escaped
    // second throw), which the transport surfaced as `500 null`.
    expect(verdict).toBeDefined();
    expect(verdict?.error).toBe(AUDIENCE_CONFIG_ERROR);
    expect(verdict?.errorDescription).toMatch(/cannot be resolved in sys_permission_set/);

    // …and the operator's log carries the same verdict.
    const errors = logger.at('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('[audience]');
    expect(errors[0].message).toContain("'ops_self_serve'");
    expect(errors[0].message).toMatch(/cannot be resolved in sys_permission_set/);
  });

  it('② falls back to the guaranteed warn channel when the host ships no error channel', async () => {
    const logger = new WarnOnlyReceiverSensitiveLogger();
    const verdict = await driveAudienceGate(makeManager(logger));

    expect(verdict?.error).toBe(AUDIENCE_CONFIG_ERROR);
    const warnings = logger.at('warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/cannot be resolved in sys_permission_set/);
  });
});

describe('[#12773] ③ reconcile-membership refuses an off-vocabulary policy without crashing', () => {
  const engine = {
    find: async () => [],
    insert: async (_object: string, row: unknown) => row,
  };

  it('reports the refusal through a class-based logger, receiver intact', async () => {
    const logger = new ReceiverSensitiveLogger();
    const res = await reconcileMembership(engine as never, 'user-1', {
      policy: 'inviteOnly' as unknown as MembershipPolicy,
      resolveTargetOrg: async () => 'org_default',
      logger: logger as never,
    });

    expect(res.outcome).toBe('invalid-policy');
    const errors = logger.at('error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('[membership] refusing to bind');
    expect(errors[0].message).toContain("'inviteOnly'");
    expect(errors[0].meta).toMatchObject({ policy: "'inviteOnly'" });
  });

  it('falls back to warn on a host with no error channel, receiver intact', async () => {
    const logger = new WarnOnlyReceiverSensitiveLogger();
    const res = await reconcileMembership(engine as never, 'user-1', {
      policy: 'nope' as unknown as MembershipPolicy,
      resolveTargetOrg: async () => 'org_default',
      logger: logger as never,
    });

    expect(res.outcome).toBe('invalid-policy');
    expect(logger.at('warn')).toHaveLength(1);
    expect(logger.at('warn')[0].message).toContain('[membership] refusing to bind');
  });
});

describe('[#12773] ④ membership adoption logs through a class-based logger', () => {
  it('reports the adoption on the info channel, receiver intact', async () => {
    const logger = new ReceiverSensitiveLogger();
    const existing = { id: 'mem_1', role: 'member', organization_id: 'org_1', user_id: 'usr_1' };
    const engine = {
      findOne: async () => existing,
      update: async (_object: string, data: unknown) => ({ ...existing, ...(data as object) }),
    };

    const adopted = await adoptExistingMembership(
      engine as never,
      'sys_member',
      { organization_id: 'org_1', user_id: 'usr_1', role: 'member' },
      { logger: logger as never },
    );

    expect(adopted?.id).toBe('mem_1');
    const infos = logger.at('info');
    expect(infos).toHaveLength(1);
    expect(infos[0].message).toContain('[membership] adopted the existing sys_member row');
    expect(infos[0].meta).toMatchObject({ memberId: 'mem_1' });
  });
});
