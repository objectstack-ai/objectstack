// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20289 (family `qa-runner`, verdict ENFORCE; the `requires` key ruled B) — the
// D3 entry of the family (one D3 entry per retirement family). Registered key:
// `qa/TestScenario:requires.plugins`. No D2 conversion: a QA suite is a loose
// JSON file `os test` loads, never a stack collection member or a stored row, so
// there is no source for a conversion to rewrite — and the move is a judgement
// (which service did the plugin stand for?), not a mechanical edit. This entry
// is where the prescription reaches `os migrate meta`, the upgrade guide and
// `spec-changes.json`.
export const entry: SemanticMigration = {
  id: 'qa-scenario-requires-plugins-retired',
  surface: 'qa.scenarios[].requires.plugins',
  replacement:
    '`requires.services` — the discovery service keys the scenario needs (for example `auth`, `analytics`, '
    + '`automation`, `ai`), each judged against the target\'s discovery document: met only when the target declares '
    + 'the service `enabled` with status `available`. The plugin → service mapping follows the provider table '
    + 'discovery itself reports (`CORE_SERVICE_PROVIDER`): `@objectstack/plugin-auth` fills `auth`, '
    + '`@objectstack/service-analytics` fills `analytics`, `@objectstack/service-automation` fills `automation`, '
    + 'and so on. A plugin that fills no discovery service slot has no service to require.',
  reason:
    '`requires.plugins` was declared as a precondition and checked by nothing: `os test` reaches its target over '
    + 'HTTP, no served surface lists the loaded plugins, and the plugin spelling (package name or `plugin.name`) '
    + 'was never defined — so a scenario naming a missing plugin ran anyway and failed, or passed, on whatever the '
    + 'missing plugin caused. The block is now enforced (ADR-0049): core\'s TestRunner judges `requires` before the '
    + 'first step, and an unmet entry makes the scenario SKIPPED with a reason, counted separately and never as '
    + 'passed. `plugins` could not join that judgement honestly, so it retires into `services`, which the target\'s '
    + 'discovery document already answers (ADR-0076 D12: advertise only what is mounted). The consumer still owes '
    + 'the judgement because a plugin name does not always map to one service — a plugin that fills no discovery '
    + 'slot was never a checkable precondition, and only the suite\'s author knows what the scenario needed it for.',
  acceptanceCriteria:
    'No QA suite (`qa/*.test.json`) carries `requires.plugins` — `os test` now refuses such a file at load time '
    + 'with the retirement prescription, naming the key, instead of running it; `tsc` refuses the key at a typed '
    + 'authoring site (`never`). Each scenario that declared plugins declares the services it needs in '
    + '`requires.services`, and `os test` against a target that serves them runs the scenario, while against one '
    + 'that does not it prints the scenario as skipped with the unmet service and the services the target declares '
    + 'available. A suite without `requires` runs exactly as before.',
};
