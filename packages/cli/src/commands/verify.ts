// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { resolveTenancyPosture } from '@objectstack/types';
import { postureEnforcesWall } from '@objectstack/spec/security';
import {
  bootStack,
  runCrudVerification,
  formatReport,
  runRlsProofs,
  formatRlsReport,
  provisionRlsProbePersona,
  provisionRlsPositionPersona,
  declaredPositionNames,
  rlsProbeSecurity,
  type VerifyReport,
  type RlsReport,
  type RlsProbeDescriptor,
  type RlsPositionPersonaInput,
} from '@objectstack/verify';
import { loadConfig } from '../utils/config.js';

/**
 * Should this `os verify` run boot an org-scoped (multi-tenant) stack?
 *
 * Two independent ways to ask for it, ORed: the explicit `--multi-tenant` flag,
 * or a deployment environment that already asks for an organization wall.
 *
 * [ADR-0105 D1 / #5262] The env half reads the resolved POSTURE — ⛔ never
 * `resolveMultiOrgEnabled()`, which ADR-0105 D1 demoted to a back-compat INPUT
 * of `resolveTenancyPosture()`. On a deployment configured the documented way
 * (`OS_TENANCY_POSTURE=isolated|group`, legacy boolean unset) that boolean reads
 * `false`, so `os verify` booted a single-org stack and SILENTLY skipped every
 * multi-tenant proof. That is the worst place in the codebase for this defect to
 * land: the whole purpose of `verify` is to be the thing that notices, and a
 * verifier that under-verifies reports success it never established. Third
 * recurrence of the shape (cloud#1020, #5233).
 *
 * REQUESTED posture is the right judge here — this resolves a CLI flag before
 * any kernel exists, and the question is literally "what did the operator ask
 * this run to prove". `bootStack({ multiTenant: true })` then REQUESTS the
 * `isolated` posture for the fixture and hard-fails if the enterprise runtime
 * is missing, so an unenforceable request surfaces as an error rather than as a
 * quietly single-org pass.
 *
 * Extracted and exported so the decision is testable on its own, following
 * `describeRegisteredDriver` in `serve.ts` — this package's established shape
 * for a command-level decision worth pinning.
 */
export function resolveVerifyMultiTenant(flags: { 'multi-tenant'?: boolean }): boolean {
  return Boolean(flags['multi-tenant']) || postureEnforcesWall(resolveTenancyPosture());
}

/**
 * `objectstack verify` — boot the app in-process and exercise it through the
 * real HTTP stack, asserting runtime behavior the static gates can't see:
 *   - data fidelity: author → write → read → assert, per object/field type
 *   - authorization (--rls): "you can't write what you can't read" (#1994 class)
 *
 * Exits non-zero on real failures so it drops straight into CI.
 */
export default class Verify extends Command {
  static override description =
    'Boot the app in-process and verify it through the real HTTP stack (CRUD round-trip fidelity + the cross-owner RLS invariant)';

  static override examples = [
    '<%= config.bin %> verify',
    '<%= config.bin %> verify --app ./objectstack.config.ts --rls',
    '<%= config.bin %> verify --rls --multi-tenant --json',
  ];

  static override flags = {
    app: Flags.string({
      char: 'a',
      description: 'Path to the app config (defaults to ./objectstack.config.{ts,js,mjs})',
    }),
    rls: Flags.boolean({
      description: 'Also run the cross-owner RLS invariant (a fresh member must not write what it cannot read)',
      default: false,
    }),
    'multi-tenant': Flags.boolean({
      description: 'Boot org-scoped (register the enterprise @objectstack/organizations plugin) so tenant-isolation RLS policies apply (also honors a walled $OS_TENANCY_POSTURE, and the legacy $OS_MULTI_ORG_ENABLED it falls back to)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Emit the structured report as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Verify);

    const { config, absolutePath } = await loadConfig(flags.app);

    const multiTenant = resolveVerifyMultiTenant(flags);

    // Data fidelity runs on its own pristine stack.
    let crud: VerifyReport;
    {
      const stack = await bootStack(config, { multiTenant });
      try {
        const adminToken = await stack.signIn();
        crud = await runCrudVerification(stack, adminToken, config);
      } finally {
        await stack.stop();
      }
    }

    // The RLS proofs run on a SEPARATE, fresh stack. Reusing the fidelity stack
    // would let the RLS phase's admin-creates collide with the rows the fidelity
    // phase already wrote on unique-constrained fields (e.g. a unique `sku` or
    // `account_number`) — a 409 that silently skips the object instead of
    // proving its authorization.
    let rls: RlsReport | undefined;
    if (flags.rls) {
      // [#7685] The by-id-write class is only REACHABLE for a persona holding
      // the object-level grants AND standing outside the record scope. A bare
      // `signUp()` member holds no grants, so `checkObjectPermission` answers
      // 403 before record scope is consulted and every probe was masked — 11 of
      // 13 "consistent" showcase verdicts were that 403, an unfalsifiable green.
      // `rlsProbeSecurity` registers the capability #7665's acceptance
      // criterion 2 names (object read+edit, owner-scoped SELECT only) and
      // carries the app's declared default profile through unchanged.
      const rlsStack = await bootStack(config, { multiTenant, security: rlsProbeSecurity(config) });
      try {
        const adminToken = await rlsStack.signIn();
        let probeToken: string;
        let probe: RlsProbeDescriptor;
        try {
          const persona = await provisionRlsProbePersona(rlsStack, config);
          probeToken = persona.token;
          probe = { label: persona.email, grantedObjects: persona.grantedObjects };
        } catch (e) {
          // Prefer failing to falling back (Route & surface ownership §3): a
          // weaker persona still produces a report, so the degradation is
          // recorded on the report itself AND counted as a hard failure below.
          // Silently probing with an ungranted member is the exact false green
          // this issue exists to remove.
          probeToken = await rlsStack.signUp('verify-member@objectstack.test');
          probe = {
            label: 'verify-member@objectstack.test',
            degraded: `probe persona provisioning failed: ${(e as Error).message}`,
          };
        }
        // [#7978] The base persona holds no positions by construction, so an
        // app policy carrying `positions: [...]` is never applicable to it and
        // the app's OWN narrowing goes unexercised. Mint one persona per
        // DECLARED position — derived from the config, never a list written
        // here — so the position-gated half is probed too. Provisioning lives
        // on this side because it needs the live stack; the runner re-derives
        // the intended reach from the config, so a position missing from this
        // loop reports as `positionCoverage.notRun` instead of quietly
        // shrinking the run.
        const positionPersonas: RlsPositionPersonaInput[] = [];
        const positionFailures: Array<{ position: string; error: string }> = [];
        for (const position of declaredPositionNames(config)) {
          try {
            const persona = await provisionRlsPositionPersona(rlsStack, position);
            positionPersonas.push({ position, token: persona.token, label: persona.email });
          } catch (e) {
            positionFailures.push({ position, error: (e as Error).message });
          }
        }

        rls = await runRlsProofs(rlsStack, adminToken, probeToken, config, {
          probe,
          positionPersonas,
          positionFailures,
        });
      } finally {
        await rlsStack.stop();
      }
    }

    // Failure contract: a "real" runtime break the app's author must see.
    // A degraded RLS probe counts: the run reported verdicts it could not have
    // established, which is worse than no verifier at all.
    //
    // [#7978] `totals`, not `summary`: a hole a POSITION persona found is
    // exactly as real as one the base persona found — reading `summary` here
    // would run the fan-out and then throw its findings away. A declared
    // position that could not be provisioned counts for the same reason a
    // degraded base persona does: the run covered less than its numbers read.
    const hardFailures =
      crud.summary.createFailed +
      crud.summary.readFailed +
      crud.summary.fidelityGaps +
      (rls?.totals.holes ?? 0) +
      (rls?.probe.degraded ? 1 : 0) +
      (rls?.positionCoverage.notRun.length ?? 0);

    if (flags.json) {
      this.log(JSON.stringify({ app: crud.app, config: absolutePath, multiTenant, crud, rls, hardFailures }, null, 2));
    } else {
      this.log(formatReport(crud));
      if (rls) this.log(formatRlsReport(rls));
      this.log('');
      this.log(
        hardFailures > 0
          ? chalk.red(`✗ verify FAILED — ${hardFailures} runtime failure(s)`)
          : chalk.green('✓ verify passed — no runtime failures'),
      );
    }

    // Force process exit: the in-process stack leaves handles open (http server,
    // sqlite-wasm, better-auth timers) that keep the event loop alive after
    // stop(), so a bare return would hang. exit() also encodes the CI contract.
    this.exit(hardFailures > 0 ? 1 : 0);
  }
}
