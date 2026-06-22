// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import MigratePlan from './plan.js';

/**
 * `os migrate` with no subcommand defaults to the (read-only) plan, so the
 * bare command can never mutate the schema by surprise (issue #2186).
 */
export default class Migrate extends MigratePlan {
  static override description =
    'Inspect / reconcile physical-database drift from metadata. Defaults to a dry-run plan; use "os migrate apply" to reconcile.';
}
