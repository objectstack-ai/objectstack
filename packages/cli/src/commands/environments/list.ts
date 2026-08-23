// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printError, emitJson } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

/**
 * `os environments list` — list projects visible to the current session.
 *
 * Filters by organization via `--org`. Output format is the same
 * table/json/yaml shape used by other metadata commands, for a
 * consistent DX.
 */
export default class EnvironmentsList extends Command {
  static override description = 'List projects visible to the current session';

  static override examples = [
    '$ os environments list',
    '$ os environments list --org 00000000-0000-0000-0000-000000000000',
    '$ os environments list --format json',
  ];

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    org: Flags.string({ description: 'Filter by organization id' }),
    status: Flags.string({ description: 'Filter by project status (active|provisioning|failed|…)' }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EnvironmentsList);

    try {
      const { client, token, environmentId: activeId } = await createApiClient({
        url: flags.url,
        token: flags.token,
      });

      requireAuth(token);

      const res = await client.projects.list({
        organization_id: flags.org,
        status: flags.status,
      });

      const projects = res?.projects ?? [];

      if (flags.format === 'json') {
        await formatOutput(res, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(res, 'yaml');
      } else {
        console.log(`\nProjects (${projects.length}):\n`);
        if (projects.length === 0) {
          console.log('  (no projects)');
        } else {
          for (const p of projects) {
            const active = p.id === activeId ? ' ★' : '';
            const defaultTag = p.is_default ? ' [default]' : '';
            const systemTag = p.is_system ? ' [system]' : '';
            console.log(
              `  • ${p.display_name ?? p.id}${active}${defaultTag}${systemTag}`,
            );
            console.log(`      id:   ${p.id}`);
            console.log(`      status: ${p.status ?? '—'}  plan: ${p.plan ?? '—'}`);
          }
        }
        console.log('');
      }
    } catch (error: any) {
      if (flags.format === 'json') {
        await emitJson({ success: false, error: error.message });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
