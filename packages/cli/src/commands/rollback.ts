// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, printStep } from '../utils/format.js';

export default class Rollback extends Command {
  static override description = 'Activate a previously published artifact revision (rollback or roll-forward)';

  static override examples = [
    '<%= config.bin %> <%= command.id %> --commit 9ce1bd48dd70',
    'OS_PROJECT_ID=proj_crm <%= config.bin %> <%= command.id %> --commit abcdef123456',
  ];

  static override flags = {
    server: Flags.string({
      char: 's',
      description: 'ObjectStack Cloud control-plane URL',
      env: 'OS_CLOUD_URL',
      default: 'http://localhost:4000',
    }),
    project: Flags.string({
      char: 'p',
      description: 'Project ID (required)',
      env: 'OS_PROJECT_ID',
      required: true,
    }),
    commit: Flags.string({
      char: 'c',
      description: 'Commit ID (full or 12+ char prefix) of the revision to activate',
      required: true,
    }),
    token: Flags.string({
      char: 't',
      description: 'API key for ObjectStack Cloud',
      env: 'OS_CLOUD_API_KEY',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Rollback);

    printHeader('Rollback / Activate Revision');

    try {
      const url = `${flags.server}/api/v1/cloud/projects/${flags.project}/revisions/${flags.commit}/activate`;
      printStep(`POST ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(flags.token && { Authorization: `Bearer ${flags.token}` }),
        },
      });

      if (!response.ok) {
        let errMsg: string;
        try {
          const errBody = await response.json() as any;
          errMsg = errBody?.error ?? response.statusText;
        } catch {
          errMsg = response.statusText;
        }
        printError(`Activate failed (${response.status}): ${errMsg}`);
        this.exit(1);
        return;
      }

      const result = await response.json() as any;
      const data = result?.data ?? result;

      console.log('');
      printSuccess('Revision activated');
      printKV('  Project', flags.project);
      if (data?.commitId) printKV('  Commit', data.commitId);
      if (data?.previousCommitId) printKV('  Previous', data.previousCommitId);
      printKV('  Server', flags.server);
    } catch (error) {
      printError((error as Error).message);
      this.exit(1);
    }
  }
}
