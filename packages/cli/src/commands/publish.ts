// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printError, printStep } from '../utils/format.js';

export default class Publish extends Command {
  static override description = 'Publish a compiled artifact to ObjectStack Cloud';

  static override args = {
    artifact: Args.string({ description: 'Path to compiled artifact (default: dist/objectstack.json)', required: false }),
  };

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
    token: Flags.string({
      char: 't',
      description: 'API key for ObjectStack Cloud',
      env: 'OS_CLOUD_API_KEY',
    }),
    timeout: Flags.integer({
      description: 'Upload timeout in milliseconds (use a higher value on slow networks; 0 disables timeout)',
      env: 'OS_CLOUD_TIMEOUT_MS',
      default: 60_000,
    }),
    note: Flags.string({
      char: 'n',
      description: 'Optional human-readable note to attach to this revision',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Publish);

    printHeader('Publish Artifact');

    try {
      // 1. Locate the compiled artifact
      const artifactPath = args.artifact
        ? resolvePath(process.cwd(), args.artifact)
        : resolvePath(process.cwd(), 'dist/objectstack.json');

      printStep(`Loading artifact from ${artifactPath}...`);
      let artifactRaw: string;
      try {
        artifactRaw = await readFile(artifactPath, 'utf-8');
      } catch (err: any) {
        printError(`Cannot read artifact: ${err.message}. Run \`objectstack build\` first.`);
        this.exit(1);
        return;
      }

      const artifact = JSON.parse(artifactRaw);
      printSuccess(`Loaded artifact (${(artifactRaw.length / 1024).toFixed(1)} KB)`);

      // 2. POST to the control-plane publish endpoint
      const noteQs = flags.note ? `?note=${encodeURIComponent(flags.note)}` : '';
      const serverUrl = `${flags.server}/api/v1/cloud/projects/${flags.project}/metadata${noteQs}`;
      printStep(`Publishing to ${serverUrl}...`);

      const response = await (async () => {
        const controller = new AbortController();
        const timer = flags.timeout > 0
          ? setTimeout(() => controller.abort(), flags.timeout)
          : undefined;
        try {
          return await fetch(serverUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(flags.token && { Authorization: `Bearer ${flags.token}` }),
            },
            body: artifactRaw,
            signal: controller.signal,
          });
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            throw new Error(
              `Upload timed out after ${flags.timeout}ms. Use --timeout <ms> or set OS_CLOUD_TIMEOUT_MS to extend it (0 disables).`,
            );
          }
          throw err;
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();

      if (!response.ok) {
        let errMsg: string;
        try {
          const errBody = await response.json() as any;
          errMsg = errBody?.error ?? response.statusText;
        } catch {
          errMsg = response.statusText;
        }
        printError(`Publish failed (${response.status}): ${errMsg}`);
        this.exit(1);
        return;
      }

      const result = await response.json() as any;
      const data = result?.data ?? result;

      console.log('');
      printSuccess('Artifact published successfully');
      printKV('  Project', flags.project);
      if (data?.commitId) printKV('  Commit', data.commitId);
      const checksumStr = typeof data?.checksum === 'string'
        ? data.checksum
        : (data?.checksum?.value ?? null);
      if (checksumStr) printKV('  Checksum', String(checksumStr).slice(0, 16));
      printKV('  Server', flags.server);

    } catch (error) {
      printError((error as Error).message);
      this.exit(1);
    }
  }
}
