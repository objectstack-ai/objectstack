// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { ObjectDraft } from '@objectstack/spec/contracts';
import { readEnvelopeFrom } from '../../utils/response-envelope.js';
import { writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

/** Resolve server URL + token from flags then env (mirrors createApiClient). */
function resolveTarget(flags: { url?: string; token?: string }): { url: string; token?: string } {
  const url = flags.url || process.env.OS_CLOUD_URL || 'http://localhost:3000';
  const token = flags.token || process.env.OS_TOKEN;
  return { url, token };
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
      if (isAbsolute(flags.out) || !target.startsWith(process.cwd() + '/')) {
        this.error(`--out must be a relative path within the current directory: ${flags.out}`);
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
