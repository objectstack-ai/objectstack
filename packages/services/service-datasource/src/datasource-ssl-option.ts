// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The datasource-level `ssl` block (or the `config.ssl` shorthand) resolved to
 * the one value every SQL driver arm of the factory starts from. A leaf module
 * that imports no driver package, so a test can pin it without loading one
 * (`check:test-source-alias`); moved out of `default-datasource-driver-factory.ts`
 * unchanged (#31327).
 */

import type { DatasourceConnectionSpec } from './contracts/index.js';

/**
 * The `ssl` value to hand a SQL client, from the datasource's TLS block or the
 * per-driver on/off shorthand.
 *
 * `datasource.ssl` is declared, strict, documented — and until #4410 stopped at
 * the record: nothing put it on the connection spec, so a TLS block with a CA
 * certificate in it configured precisely nothing, which is the failure its own
 * schema comment warns about ("a TLS setting that never took effect looked
 * identical to one that did"). The block wins when present because it is the
 * more specific statement; `config.ssl` remains the boolean shorthand.
 *
 * ⚠️ The `true` this can return is a `pg` spelling, not a universal one — see
 * `mysqlSslOption` in the driver factory, which re-expands it for `mysql2`. Do not "simplify"
 * that call away.
 */
export function resolveSslOption(spec: DatasourceConnectionSpec): unknown {
  const block = spec.ssl as
    | { enabled?: boolean; rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string }
    | undefined;
  if (block) {
    if (block.enabled === false) return false;
    const options = {
      ...(block.rejectUnauthorized !== undefined ? { rejectUnauthorized: block.rejectUnauthorized } : {}),
      ...(block.ca ? { ca: block.ca } : {}),
      ...(block.cert ? { cert: block.cert } : {}),
      ...(block.key ? { key: block.key } : {}),
    };
    // `ssl: {}` would read as "TLS with default options" to `pg`, which is what
    // `enabled: true` with nothing else means anyway — but an empty object is
    // an odd thing to hand a client, so collapse it to the boolean.
    return Object.keys(options).length > 0 ? options : true;
  }
  const shorthand = (spec.config ?? {}).ssl;
  return shorthand == null ? undefined : shorthand;
}
