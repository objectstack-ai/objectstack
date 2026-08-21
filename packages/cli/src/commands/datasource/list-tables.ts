// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { RemoteTable } from '@objectstack/spec/contracts';
import { readEnvelopeFrom } from '../../utils/response-envelope.js';

/** Resolve server URL + token from flags then env (mirrors createApiClient). */
function resolveTarget(flags: { url?: string; token?: string }): { url: string; token?: string } {
  const url = flags.url || process.env.OS_CLOUD_URL || 'http://localhost:3000';
  const token = flags.token || process.env.OS_TOKEN;
  return { url, token };
}

/**
 * `os datasource list-tables <name>` — list remote tables on a federated
 * datasource (ADR-0015). GET /api/v1/datasources/:name/external/tables.
 */
export default class DatasourceListTables extends Command {
  static override description = 'List remote tables on an external (federated) datasource';

  static override examples = [
    '$ os datasource list-tables warehouse',
    '$ os datasource list-tables warehouse --schema mart',
  ];

  static override args = {
    name: Args.string({ description: 'Datasource name', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
    schema: Flags.string({ char: 's', description: 'Filter by remote schema' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DatasourceListTables);
    const { url, token } = resolveTarget(flags);

    const qs = flags.schema ? `?schema=${encodeURIComponent(flags.schema)}` : '';
    const res = await fetch(`${url}/api/v1/datasources/${args.name}/external/tables${qs}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    // The payload lives under `data` in the declared envelope, and its shape is
    // the service contract's own `RemoteTable` rather than a transcription of
    // it — a copy is what silently reported "No remote tables found." against a
    // server that had listed two (#10675).
    const envelope = await readEnvelopeFrom<{ tables?: RemoteTable[] }>(res);
    if (!envelope.ok) {
      this.error(envelope.message);
      return;
    }

    const tables = envelope.data.tables ?? [];
    if (tables.length === 0) {
      this.log('No remote tables found.');
      return;
    }
    for (const t of tables) {
      const where = t.schema ? `${t.schema}.${t.name}` : t.name;
      const rows = t.rowCountEstimate != null ? `, ~${t.rowCountEstimate} rows` : '';
      this.log(`  ${where}  (${t.columnCount} cols${rows})`);
    }
  }
}
