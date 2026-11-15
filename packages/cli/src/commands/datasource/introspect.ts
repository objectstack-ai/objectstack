// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { ObjectDraft } from '@objectstack/spec/contracts';
import { readEnvelopeFrom } from '../../utils/response-envelope.js';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';

/** Resolve server URL + token from flags then env (mirrors createApiClient). */
function resolveTarget(flags: { url?: string; token?: string }): { url: string; token?: string } {
  const url = flags.url || process.env.OS_CLOUD_URL || 'http://localhost:3000';
  const token = flags.token || process.env.OS_TOKEN;
  return { url, token };
}

/**
 * Whether a write to `target` really lands under `cwd` once symlinks are
 * resolved. A lexically in-tree path can still leave the tree through a
 * symlinked directory on the way (`objects/lnk/x.ts` with `objects/lnk` ->
 * `/elsewhere`), or through `target` itself being a symlink, which
 * `writeFile` follows even when it dangles. So: refuse an existing symlink
 * at `target`, then realpath both `cwd` and the nearest EXISTING ancestor
 * of `target` and require the second to sit under the first. A missing
 * intermediate directory is left to `writeFile`, which fails as it always has.
 */
async function landsInside(cwd: string, target: string): Promise<boolean> {
  try {
    if ((await lstat(target)).isSymbolicLink()) return false;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const root = await realpath(cwd);
  let dir = dirname(target);
  for (;;) {
    try {
      const real = await realpath(dir);
      return real === root || real.startsWith(root + sep);
    } catch (err) {
      const parent = dirname(dir);
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' || parent === dir) throw err;
      dir = parent;
    }
  }
}

/**
 * `os datasource introspect <name> --table <remote>` — generate an Object
 * draft (`*.object.ts`) from a remote table (ADR-0015).
 * POST /api/v1/datasources/:name/external/tables/:remote/draft.
 */
export default class DatasourceIntrospect extends Command {
  static override description = 'Generate an Object draft from a remote table on an external datasource';

  static override examples = [
    '$ os datasource introspect warehouse --table fact_orders',
    '$ os datasource introspect warehouse --table fact_orders --out objects/wh_order.object.ts',
  ];

  static override args = {
    name: Args.string({ description: 'Datasource name', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    table: Flags.string({ char: 'T', description: 'Remote table name', required: true }),
    out: Flags.string({ char: 'o', description: 'Write the generated source to this file (under the current working directory)' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DatasourceIntrospect);
    const { url, token } = resolveTarget(flags);

    const res = await fetch(
      `${url}/api/v1/datasources/${args.name}/external/tables/${encodeURIComponent(flags.table)}/draft`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      },
    );
    // `data.draft`, not `body.draft`: the server wraps every payload in the
    // declared envelope, so the flat read produced `undefined` and reported
    // "Failed to generate draft" for drafts the server had generated (#10675).
    const envelope = await readEnvelopeFrom<{ draft?: ObjectDraft }>(res);
    if (!envelope.ok) {
      this.error(envelope.message);
      return;
    }

    const draft = envelope.data.draft;
    if (!draft?.source) {
      this.error(`Failed to generate draft for '${flags.table}' on '${args.name}'.`);
      return;
    }

    if (flags.out) {
      // Constrain the output path to the current working directory: the body
      // is server-generated TypeScript, so refuse to write outside the project
      // tree (defends against a malicious/compromised server supplying an
      // absolute or traversing `--out` via shell expansion).
      const target = resolve(process.cwd(), flags.out);
      const refusal = `--out must be a relative path within the current directory: ${flags.out}`;
      if (isAbsolute(flags.out) || !target.startsWith(process.cwd() + '/')) {
        this.error(refusal);
        return;
      }
      // The check above is lexical; `writeFile` follows symlinks. Re-judge
      // the location the write would really land on.
      if (!(await landsInside(process.cwd(), target))) {
        this.error(refusal);
        return;
      }
      await writeFile(target, draft.source, 'utf8');
      this.log(`Wrote ${flags.out}`);
    } else {
      this.log(draft.source);
    }

    for (const r of draft.review ?? []) {
      this.warn(`REVIEW: column '${r.column}' — ${r.note}`);
    }
  }
}
