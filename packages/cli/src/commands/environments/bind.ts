// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags, Args } from '@oclif/core';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { printError, printStep, printKV, emitJson, isExitSignal } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';
import { formatOutput } from '../../utils/output-formatter.js';

/**
 * `os environments bind` — bind a locally-compiled artifact to an existing
 * multi-environment server project.
 *
 * Equivalent to `PATCH /api/v1/cloud/environments/<id>` with
 * `metadata.artifact_path = <absolute-path>`. The server's
 * AppBundleResolver picks up the path on the next per-project kernel
 * boot, registering the bundle's objects, views, and seed data.
 *
 * Use `--build` to compile `objectstack.config.ts` first so the artifact
 * reflects the latest source.
 */
export default class EnvironmentsBind extends Command {
  static override description = 'Bind a local objectstack artifact to an existing environment';

  static override examples = [
    '$ os environments bind <environment-id> --artifact ./dist/objectstack.json',
    '$ os environments bind <environment-id> --artifact ./dist/objectstack.json --build',
    '$ os environments bind <environment-id> --reseed',
  ];

  static override args = {
    environmentId: Args.string({
      description: 'Target environment id (UUID)',
      required: true,
    }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    artifact: Flags.string({
      description: 'Path to a compiled objectstack.json artifact (default: ./dist/objectstack.json)',
    }),
    build: Flags.boolean({
      description: 'Run `objectstack compile` before binding',
      default: false,
    }),
    reseed: Flags.boolean({
      description: 'After binding, also re-run schema sync + bundle seeding via /cloud/environments/:id/reseed',
      default: false,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['json', 'table', 'yaml'],
      default: 'table',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvironmentsBind);

    try {
      const artifactRel = flags.artifact ?? './dist/objectstack.json';
      const artifactAbs = path.isAbsolute(artifactRel)
        ? artifactRel
        : path.resolve(process.cwd(), artifactRel);

      if (flags.build) {
        printStep('Compiling objectstack.config.ts → ' + artifactAbs);
        const binPath = process.argv[1];
        // NOTE: Do NOT set NODE_ENV='development' on this child. It activates
        // oclif's tsx TypeScript source loader, which honours the CWD
        // tsconfig's `paths` — and an app's `paths` redirect a CommonJS
        // workspace package to its `.ts` source, after which Node's CJS
        // resolver fails on that file's sibling imports. `os dev` carried the
        // same spawn and died on exactly that; `os start`'s compile spawn
        // never set it. `compile` reads NODE_ENV nowhere. See the NOTEs in
        // commands/dev.ts and child-env-source-loader.pin.test.ts.
        const r = spawnSync(
          process.execPath,
          [binPath, 'compile', '--output', artifactAbs],
          { stdio: 'inherit', env: process.env },
        );
        if (r.status !== 0) {
          printError('Compile failed — fix errors above before binding');
          this.exit(1);
        }
      }

      try {
        await fs.access(artifactAbs);
      } catch {
        printError(`Artifact not found: ${artifactAbs}`);
        if (!flags.build) {
          console.error('  Hint: pass --build to compile first, or check the path with --artifact.');
        }
        this.exit(1);
      }

      const { client, token } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      // Fetch existing metadata so we don't blow it away.
      const current = await client.projects.get(args.environmentId);
      const existingMeta: Record<string, unknown> = (current?.project?.metadata && typeof current.project.metadata === 'object')
        ? { ...current.project.metadata as Record<string, unknown> }
        : {};
      // Drop the prior bind error so the UI doesn't show a stale failure.
      delete existingMeta.artifactBindError;
      existingMeta.artifact_path = artifactAbs;

      printKV('Environment', args.environmentId, '🎯');
      printKV('Artifact', artifactAbs, '📦');

      const res = await client.projects.update(args.environmentId, {
        metadata: existingMeta,
      });

      if (flags.reseed) {
        printStep('Reseeding bundle (POST /cloud/environments/:id/reseed)…');
        try {
          // Best-effort: server may not expose a reseed endpoint yet.
          const reseed = await (client as any).fetch?.(
            `${(client as any).baseUrl}/api/v1/cloud/environments/${encodeURIComponent(args.environmentId)}/reseed`,
            { method: 'POST' },
          );
          if (reseed && typeof reseed.ok === 'boolean' && !reseed.ok) {
            console.error('  ⚠ reseed endpoint returned ' + reseed.status + ' — bundle will be applied on next kernel boot.');
          }
        } catch (e: any) {
          console.error('  ⚠ reseed failed: ' + (e?.message ?? e) + ' — bundle will be applied on next kernel boot.');
        }
      }

      if (flags.format === 'json') {
        await formatOutput(res, 'json');
      } else if (flags.format === 'yaml') {
        await formatOutput(res, 'yaml');
      } else {
        console.log(`\n✓ Environment bound to artifact`);
        console.log(`  ${args.environmentId} → ${artifactAbs}`);
        console.log(`  The next request to this environment will load the new bundle.`);
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
