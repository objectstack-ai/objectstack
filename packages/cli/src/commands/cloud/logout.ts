// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack cloud logout` — clear cloud credentials from
 * ~/.objectstack/cloud.json (and best-effort revoke the session on the
 * cloud control plane).
 */

import { Command, Flags } from '@oclif/core';
import { ObjectStackClient } from '@objectstack/client';
import { printHeader, printSuccess, printError, emitJson, errorCodeFields } from '../../utils/format.js';
import { deleteCloudConfig, tryReadCloudConfig } from '../../utils/cloud-config.js';

export default class CloudLogout extends Command {
  static override description = 'Clear stored ObjectStack Cloud credentials';

  static override examples = ['$ os cloud logout'];

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(CloudLogout);

    try {
      if (!flags.json) printHeader('ObjectStack Cloud Logout');

      const config = await tryReadCloudConfig();
      if (config?.token && config?.url) {
        try {
          const client = new ObjectStackClient({ baseUrl: config.url, token: config.token });
          await client.auth.logout();
        } catch {
          // Best-effort
        }
      }

      await deleteCloudConfig();

      if (flags.json) {
        await emitJson({ success: true, message: 'Cloud credentials cleared' });
      } else {
        printSuccess('Cloud credentials cleared');
        console.log('');
      }
    } catch (error: any) {
      if (flags.json) {
        await emitJson({ success: false, error: error.message, ...errorCodeFields(error) });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
