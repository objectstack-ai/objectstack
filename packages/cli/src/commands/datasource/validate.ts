// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import type { SchemaValidationResult } from '@objectstack/spec/contracts';
import { readEnvelopeFrom } from '../../utils/response-envelope.js';

/** Resolve server URL + token from flags then env (mirrors createApiClient). */
function resolveTarget(flags: { url?: string; token?: string }): { url: string; token?: string } {
  const url = flags.url || process.env.OS_CLOUD_URL || 'http://localhost:3000';
  const token = flags.token || process.env.OS_TOKEN;
  return { url, token };
}

/**
 * `os datasource validate <name>` — validate federated objects on a datasource
 * against the live remote schema (ADR-0015). Exits non-zero on mismatch.
 * POST /api/v1/datasources/:name/external/validate.
 */
export default class DatasourceValidate extends Command {
  static override description = 'Validate federated objects against the remote schema of an external datasource';

  static override examples = ['$ os datasource validate warehouse'];

  static override args = {
    name: Args.string({ description: 'Datasource name', required: true }),
  };

  static override flags = {
    url: Flags.string({ char: 'u', description: 'Server URL', env: 'OS_CLOUD_URL' }),
    token: Flags.string({ char: 't', description: 'Authentication token', env: 'OS_TOKEN' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DatasourceValidate);
    const { url, token } = resolveTarget(flags);

    const res = await fetch(`${url}/api/v1/datasources/${args.name}/external/validate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
    });
    // The severe half of #10675 was HERE. Reading the pre-envelope `body.results`
    // made every response look like zero results, so this command answered
    // "No federated objects to validate." with exit 0 against drift the server
    // had already flagged `missing_column … severity:error` — a gate passing on
    // a body it never read. `readEnvelopeFrom` refuses to yield an empty payload
    // for a body it cannot parse, so the message below is now reachable only
    // from a server that really reported no federated objects.
    const envelope = await readEnvelopeFrom<{ ok?: boolean; results?: SchemaValidationResult[] }>(res);
    if (!envelope.ok) {
      this.error(envelope.message);
      return;
    }

    const results = envelope.data.results ?? [];
    if (results.length === 0) {
      this.log('No federated objects to validate.');
      return;
    }

    let hasError = false;
    for (const r of results) {
      if (r.ok && r.diffs.length === 0) {
        this.log(`✓ ${r.object} matches`);
        continue;
      }
      for (const d of r.diffs) {
        const loc = d.column ? `${r.object}.${d.column}` : r.object;
        const detail = d.expected || d.actual ? ` (expected ${d.expected ?? '—'}, actual ${d.actual ?? '—'})` : '';
        const mark = d.severity === 'error' ? '✗' : '⚠';
        this.log(`${mark} ${d.kind}: ${loc}${detail}`);
        if (d.severity === 'error') hasError = true;
      }
    }

    if (hasError) this.error('External schema validation failed.', { exit: 1 });
  }
}
