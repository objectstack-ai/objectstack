// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { readAuthConfig, writeAuthConfig } from '../../utils/auth-config.js';
import { recordCloudActiveEnvironmentId } from '../../utils/active-environment.js';

/**
 * `os environments switch <id>` — set the active environment for this CLI session.
 *
 * Calls `POST /api/v1/cloud/environments/:id/activate` to update the
 * server-side session, then persists `activeEnvironmentId` into
 * `~/.objectstack/credentials.json` so subsequent CLI commands (and any
 * client they create via `createApiClient`) automatically target this
 * environment.
 *
 * When the control plane it just talked to IS the one `~/.objectstack/cloud.json`
 * records, the same id is written there as well, so `os package publish --install`
 * can install into the environment you just switched to without repeating the
 * uuid. Two files, two servers, an active environment for each — the id is
 * never carried across, because it would not resolve on the other side. The
 * gate lives in `utils/active-environment.ts`.
 */
export default class EnvironmentsSwitch extends Command {
  static override description = 'Activate an environment for subsequent CLI calls';

  static override examples = [
    '$ os environments switch 00000000-0000-0000-0000-000000000001',
    '$ os environments switch proj-123 --no-remote',
  ];

  static override args = {
    id: Args.string({ description: 'Environment id to activate', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    remote: Flags.boolean({
      description: 'Also call /activate on the server (updates the session row)',
      default: true,
      allowNo: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvironmentsSwitch);

    try {
      const { client, token, baseUrl } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      // Sanity-check the id resolves — fail fast before writing the cred file
      const lookup = await client.environments.get(args.id);
      const environment = lookup?.environment;
      if (!environment?.id) {
        throw new Error(`Environment ${args.id} not found`);
      }

      if (flags.remote) {
        await client.environments.activate(environment.id);
      }

      // Cloud store first: the server session is already switched at this
      // point, so the publish-side record must not be lost to a failure in the
      // runtime store below (a user who only ran `os cloud login` has no
      // `credentials.json` at all).
      const recordedForCloud = await recordCloudActiveEnvironmentId(environment.id, baseUrl);

      // Runtime store: unchanged behaviour. This is the copy `createApiClient`
      // reads, so the `data` / `meta` / `environments` families keep targeting
      // the environment you just switched to.
      const cfg = await readAuthConfig().catch(() => null);
      if (cfg) {
        cfg.activeEnvironmentId = environment.id;
        cfg.lastUsedAt = new Date().toISOString();
        await writeAuthConfig(cfg);
      }

      console.log(`\n✓ Active environment: ${environment.display_name ?? environment.id}`);
      console.log(`  id: ${environment.id}`);
      if (recordedForCloud) {
        console.log('  (also recorded in cloud.json — `os package publish --install` will use it)');
      }
      if (!recordedForCloud && !cfg) {
        console.log('  ⚠ no local credential store to record it in — run `os login` or `os cloud login`');
      }
      if (!flags.remote) {
        console.log('  (local only — server session unchanged)');
      }
      console.log('');
    } catch (error: any) {
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
