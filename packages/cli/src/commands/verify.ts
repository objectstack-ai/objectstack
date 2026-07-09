// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { resolveMultiOrgEnabled } from '@objectstack/types';
import {
  bootStack,
  runCrudVerification,
  formatReport,
  runRlsProofs,
  formatRlsReport,
  type VerifyReport,
  type RlsReport,
} from '@objectstack/verify';
import { loadConfig } from '../utils/config.js';

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
      description: 'Boot org-scoped (register the enterprise @objectstack/organizations plugin) so tenant-isolation RLS policies apply (also honors $OS_MULTI_ORG_ENABLED)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Emit the structured report as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Verify);

    const { config, absolutePath } = await loadConfig(flags.app);

    const multiTenant = flags['multi-tenant'] || resolveMultiOrgEnabled();

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
      const rlsStack = await bootStack(config, { multiTenant });
      try {
        const adminToken = await rlsStack.signIn();
        const memberToken = await rlsStack.signUp('verify-member@objectstack.test');
        rls = await runRlsProofs(rlsStack, adminToken, memberToken, config);
      } finally {
        await rlsStack.stop();
      }
    }

    // Failure contract: a "real" runtime break the app's author must see.
    const hardFailures =
      crud.summary.createFailed +
      crud.summary.readFailed +
      crud.summary.fidelityGaps +
      (rls?.summary.holes ?? 0);

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
