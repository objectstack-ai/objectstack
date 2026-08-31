// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { printError, emitJson, errorCodeFields } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

/**
 * `os environments show <id>` — show detailed information for a single environment.
 *
 * Renders the environment row plus its database, active credential, and
 * membership row (same shape as `client.environments.get(id)`).
 */
export default class EnvironmentsShow extends Command {
  static override description = 'Show detailed information for an environment';

  static override examples = [
    '$ os environments show 00000000-0000-0000-0000-000000000001',
    '$ os environments show proj-123 --format json',
  ];

  static override args = {
    id: Args.string({ description: 'Environment id', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvironmentsShow);

    try {
      const { client, token } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      const res = await client.environments.get(args.id);

      if (flags.format === 'json') {
        await formatOutput(res, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(res, 'yaml');
      } else {
        const p = res?.environment ?? {};
        console.log(`\nEnvironment: ${p.display_name ?? p.id}`);
        console.log('─'.repeat(60));
        console.log(`  id:             ${p.id}`);
        console.log(`  organization:   ${p.organization_id ?? '—'}`);
        console.log(`  status:         ${p.status ?? '—'}`);
        console.log(`  plan:           ${p.plan ?? '—'}`);
        console.log(`  is_default:     ${Boolean(p.is_default)}`);
        console.log(`  is_system:      ${Boolean(p.is_system)}`);
        if (res?.database) {
          console.log(`  database:       ${res.database.driver ?? '—'} @ ${res.database.database_url ?? '—'}`);
        }
        if (res?.membership) {
          console.log(`  yourRole:       ${res.membership.role ?? '—'}`);
        }
        console.log('');
      }
    } catch (error: any) {
      if (flags.format === 'json') {
        await emitJson({ success: false, error: error.message, ...errorCodeFields(error) });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
