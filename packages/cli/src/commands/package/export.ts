// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `objectstack package export` — take a running deployment's whole ontology
 * out as installable packages (#28914).
 *
 *   os package export [--out DIR]
 *
 * One read, `GET /api/v1/packages/export` (`client.packages.exportAll()`,
 * `PackageExportBundleSchema`): every installed package the deployment's own
 * code does not register — the marketplace and authored packages, each base's
 * `.custom` pair among them — each exactly as `GET /packages/:id/export`
 * answers it, dependencies first. This command writes them as they came, one
 * directory per package, numbered in that order:
 *
 *   DIR/01-com.acme.crm/objectstack.json
 *   DIR/02-com.acme.crm.custom/objectstack.json
 *
 * Each file is the package's export, and each is installable as it stands with
 * `os package install DIR/NN-ID/objectstack.json` on an open runtime. Install
 * them in the numbered order: the order is the read's, and this command never
 * re-sorts it.
 *
 * Loud, never partial: the read is whole or absent (a package whose export
 * cannot be assembled fails it, and the runtime's refusal names that package),
 * and this command prints that refusal with its status and code and writes
 * nothing. It refuses an `--out` directory that already holds files, so an
 * export is never mixed into an older one.
 *
 * No credential value travels: the runtime withholds credential positions on
 * this read as on every served metadata read, and a connector's
 * `credentialRef` stays the reference it is.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';
import { Command, Flags } from '@oclif/core';
import { printHeader, printKV, printSuccess, printWarning, printError, printStep, isExitSignal } from '../../utils/format.js';
import { createApiClient, requireAuth } from '../../utils/api-client.js';

/** The file each package directory holds: the name `os package install` is shown first in its examples. */
export const EXPORTED_PACKAGE_FILE = 'objectstack.json';

/** `NN-ID`: the package's place in the read's order, zero-padded so a listing sorts in install order. */
export function exportedPackageDirectory(index: number, total: number, id: string): string {
  const width = Math.max(2, String(total).length);
  return `${String(index + 1).padStart(width, '0')}-${id}`;
}

export default class PackageExport extends Command {
  static override description =
    "Export a running deployment's whole ontology as installable packages (one directory per package, in install order)";

  static override examples = [
    '$ os package export',
    '$ os package export --out ./ontology --url https://acme.objectos.app',
    '$ os package install ./ontology/01-com.acme.crm/objectstack.json   # then each directory, in order',
  ];

  static override flags = {
    out: Flags.string({
      char: 'o',
      description: 'Directory to write the packages into (created; refused when it already holds files)',
      default: './objectstack-export',
    }),
    url: Flags.string({
      char: 'u',
      description: 'Server URL of the deployment to export',
      env: 'OS_CLOUD_URL',
    }),
    token: Flags.string({
      char: 't',
      description: 'Authentication token',
      env: 'OS_TOKEN',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PackageExport);

    printHeader('Export Packages');
    const outDir = resolvePath(process.cwd(), flags.out);

    try {
      const existing = await readdir(outDir).catch((err: NodeJS.ErrnoException) => {
        if (err?.code === 'ENOENT') return [] as string[];
        throw err;
      });
      if (existing.length > 0) {
        printError(`${outDir} already holds files. Export into a new or empty directory (--out DIR).`);
        this.exit(1);
        return;
      }

      const { client, token, baseUrl } = await createApiClient({ url: flags.url, token: flags.token });
      requireAuth(token);

      printStep(`Reading the whole-deployment export from ${baseUrl}...`);
      let bundle: unknown;
      try {
        bundle = await client.packages.exportAll();
      } catch (err: any) {
        const status = typeof err?.httpStatus === 'number' ? err.httpStatus : undefined;
        const code = typeof err?.code === 'string' ? err.code : undefined;
        const tag = [status, code].filter((v) => v !== undefined).join(' ');
        printError(`Export refused${tag ? ` (${tag})` : ''}: ${err?.message ?? String(err)}. Nothing was written.`);
        this.exit(1);
        return;
      }

      const packages = (bundle as { packages?: unknown } | null | undefined)?.packages;
      if (!Array.isArray(packages)) {
        printError('The runtime answered no `packages` list: it does not serve the whole-deployment export. Nothing was written.');
        this.exit(1);
        return;
      }
      const nameless = packages.findIndex(
        (entry) => typeof (entry as { id?: unknown } | null)?.id !== 'string' || (entry as { id: string }).id === '',
      );
      if (nameless !== -1) {
        printError(`Entry ${nameless + 1} of the export names no package id, so it cannot be installed. Nothing was written.`);
        this.exit(1);
        return;
      }
      if (packages.length === 0) {
        printWarning(
          'Nothing to export: every package of this deployment is registered by its own code, which carries it. Nothing was written.',
        );
        return;
      }

      await mkdir(outDir, { recursive: true });
      const written: string[] = [];
      for (const [index, entry] of packages.entries()) {
        const id = (entry as { id: string }).id;
        const dir = join(outDir, exportedPackageDirectory(index, packages.length, id));
        await mkdir(dir, { recursive: true });
        const file = join(dir, EXPORTED_PACKAGE_FILE);
        await writeFile(file, `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
        written.push(file);
      }

      console.log('');
      printSuccess(`Exported ${packages.length} package${packages.length === 1 ? '' : 's'}`);
      printKV('  Directory', outDir);
      console.log('');
      console.log('  Install them on an open runtime in this order:');
      for (const file of written) console.log(`    os package install ${file}`);
      console.log('');
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError((error as Error).message);
      this.exit(1);
    }
  }
}
