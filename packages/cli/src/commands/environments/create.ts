// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { printError, emitJson, isExitSignal } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';
import { readAuthConfig, writeAuthConfig } from '../../utils/auth-config.js';

/**
 * `os environments create` — provision a new project.
 *
 * Delegates to `ProjectProvisioningService.provisionProject` on the server.
 * On success, optionally activates the new project for the current session
 * and persists `activeEnvironmentId` into `~/.objectstack/credentials.json`
 * (unless `--no-activate` is passed).
 */
export default class EnvironmentsCreate extends Command {
  static override description = 'Provision a new project';

  static override examples = [
    '$ os environments create --org 00000000-0000-0000-0000-000000000000 --name Staging',
    '$ os environments create --org $ORG --name Dev --plan free',
    '$ os environments create --org $ORG --name "Clone" --clone-from <source-id> --no-activate',
    '$ os environments create --org $ORG --name CRM --artifact ./examples/app-crm/dist/objectstack.json',
  ];

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    org: Flags.string({ description: 'Organization id', required: true }),
    name: Flags.string({ description: 'Display name', required: true }),
    plan: Flags.string({ description: 'Billing plan', default: 'free' }),
    driver: Flags.string({ description: 'Data-plane driver id' }),
    // No `--template`. It advertised "Built-in template id (e.g. crm, todo,
    // blank)" and sent `template_id`, which the control plane has never read —
    // the `blank`/`crm`/`todo` registry it named died with the `apps/server`
    // templates route. Removed in #3731: an accepted-and-dropped flag reports
    // success for work that never happened. Starter content is installed from
    // the App Marketplace instead (`os package install`, `sys_package` with
    // `is_starter = true`).
    artifact: Flags.string({
      description: 'Path to a locally-compiled objectstack.json artifact to bind into this project',
    }),
    'clone-from': Flags.string({ description: 'Clone schema from an existing project id' }),
    activate: Flags.boolean({
      description: 'Activate the new project for subsequent CLI calls',
      default: true,
      allowNo: true,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(EnvironmentsCreate);

    try {
      const { client, token } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      // Resolve the artifact to an absolute path so the server can read it
      // regardless of its CWD. Bail early if the file is missing — better
      // to fail before provisioning than leave a half-bound project.
      let metadata: Record<string, unknown> | undefined;
      if (flags.artifact) {
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const abs = path.isAbsolute(flags.artifact)
          ? flags.artifact
          : path.resolve(process.cwd(), flags.artifact);
        try {
          await fs.access(abs);
        } catch {
          printError(`Artifact not found: ${abs}`);
          this.exit(1);
        }
        metadata = { artifact_path: abs };
      }

      const res = await client.projects.create({
        organization_id: flags.org,
        display_name: flags.name,
        plan: flags.plan,
        driver: flags.driver,
        clone_from_environment_id: flags['clone-from'],
        ...(metadata ? { metadata } : {}),
      });

      if (flags.activate && res?.project?.id) {
        try {
          await client.projects.activate(res.project.id);
          const cfg = await readAuthConfig().catch(() => null);
          if (cfg) {
            cfg.activeEnvironmentId = res.project.id;
            cfg.lastUsedAt = new Date().toISOString();
            await writeAuthConfig(cfg);
          }
        } catch (activateError: any) {
          // Creation succeeded — surface activation failure as a warning
          console.error(`  ⚠ activation failed: ${activateError.message}`);
        }
      }

      if (flags.format === 'json') {
        await formatOutput(res, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(res, 'yaml');
      } else {
        const p = res?.project ?? {};
        console.log(`\n✓ Project created: ${p.display_name ?? p.id} (${p.id})`);
        if (flags.activate) {
          console.log(`  active project set to ${p.id}`);
        }
        console.log('');
      }
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.format === 'json') {
        await emitJson({ success: false, error: error.message });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
