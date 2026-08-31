// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack cloud whoami` — display the active ObjectStack Cloud
 * identity (read from ~/.objectstack/cloud.json) and verify the token
 * with a /get-session call against the cloud control plane.
 */

import { Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, emitJson, isExitSignal, errorCodeFields } from '../../utils/format.js';
import { tryReadCloudConfig } from '../../utils/cloud-config.js';

export default class CloudWhoami extends Command {
  static override description = 'Show the active ObjectStack Cloud identity';

  static override examples = ['$ os cloud whoami'];

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudWhoami);

    try {
      const config = await tryReadCloudConfig();
      if (!config?.token) {
        if (flags.json) {
          await emitJson({ logged_in: false });
        } else {
          printError('Not logged in to ObjectStack Cloud. Run `os cloud login` first.');
        }
        this.exit(1);
        return;
      }

      // Verify token with /get-session
      let sessionUser: { id?: string; email?: string } | undefined;
      try {
        const res = await globalThis.fetch(`${config.url}/api/v1/auth/get-session`, {
          headers: { Authorization: `Bearer ${config.token}` },
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const u = data?.user ?? data?.data?.user;
          if (u) sessionUser = { id: u.id, email: u.email };
        }
      } catch {
        // Network failure — fall through to local-only view
      }

      const email = sessionUser?.email ?? config.email;
      const userId = sessionUser?.id ?? config.userId;
      const valid = !!sessionUser;

      if (flags.json) {
        await emitJson({ logged_in: true, valid, url: config.url, email, userId });
      } else {
        printHeader('ObjectStack Cloud Identity');
        printKV('Server', config.url);
        if (email) printKV('Email', email);
        if (userId) printKV('User ID', userId);
        if (config.activeOrgId) printKV('Org', config.activeOrgId);
        console.log('');
        if (valid) {
          printSuccess('Session valid');
        } else {
          printError('Could not verify session with cloud. Token may be expired — try `os cloud login --force`.');
        }
        console.log('');
      }
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ success: false, error: error.message, ...errorCodeFields(error) });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
