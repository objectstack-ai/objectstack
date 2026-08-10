// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'dashboard-widget-strict-unknown-keys',
  surface: 'dashboard widgets (undeclared top-level keys — legacy inline ' +
    'analytics, objectui-internal `component`/`data`, or typos)',
  replacement: 'declared keys only (`dataset` + `dimensions` + `values` for ' +
    'analytics; `options` for renderer-specific extras)',
  reason:
    'The `.strict()` flip turns a previously silently-stripped unknown key into a ' +
    'parse error. There is no mapping target for an arbitrary unknown key — ' +
    'auto-deleting it would be exactly the silent data loss ADR-0078 bans — so ' +
    'each occurrence needs the author to decide: bind a `dataset` and select ' +
    '`dimensions`/`values`, move a renderer setting under `options`, or delete ' +
    'the dead key.',
  acceptanceCriteria:
    '`objectstack validate` passes with no unknown-key parse errors on dashboard ' +
    'widgets.',
};
