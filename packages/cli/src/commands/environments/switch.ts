// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { readAuthConfig, writeAuthConfig } from '../../utils/auth-config.js';

/**
 * `os environments switch <id>` — set the active project for this CLI session.
 *
 * Calls `POST /api/v1/cloud/environments/:id/activate` to update the
 * server-side session, then persists `activeEnvironmentId` into
 * `~/.objectstack/credentials.json` so subsequent CLI commands (and any
 * client they create via `createApiClient`) automatically target this
 * project.
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
      const { client, token } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      // Sanity-check the id resolves — fail fast before writing the cred file
      const lookup = await client.projects.get(args.id);
      const project = lookup?.project;
      if (!project?.id) {
        throw new Error(`Environment ${args.id} not found`);
      }

      if (flags.remote) {
        await client.projects.activate(project.id);
      }

      const cfg = await readAuthConfig();
      cfg.activeEnvironmentId = project.id;
      cfg.lastUsedAt = new Date().toISOString();
      await writeAuthConfig(cfg);

      console.log(`\n✓ Active environment: ${project.display_name ?? project.id}`);
      console.log(`  id: ${project.id}`);
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
