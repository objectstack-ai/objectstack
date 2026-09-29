// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// --- Building Blocks ---

import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
import { CORE_SERVICE_PROVIDER, CoreServiceName } from '../system/core-services.zod';

/**
 * The plugin → service mapping the `requires.plugins` tombstone hands an author
 * converting a suite, derived from {@link CORE_SERVICE_PROVIDER} — the one table
 * both discovery builders read to name a slot's provider — so the prescription
 * cannot name a package that does not fill the slot it claims. `file-storage`
 * is left out: it is the deprecated alias of `storage`, and a converting author
 * should write the canonical slot.
 */
const PLUGIN_TO_SERVICE: string = (() => {
  const byPackage = new Map<string, string[]>();
  for (const [slot, pkg] of Object.entries(CORE_SERVICE_PROVIDER)) {
    if (pkg === null || slot === 'file-storage') continue;
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), slot]);
  }
  return [...byPackage].map(([pkg, slots]) => `${pkg} → ${slots.join(' / ')}`).join(', ');
})();

export const TestContextSchema = lazySchema(() => z.record(z.string(), z.unknown()).describe('Initial context or variables for the test'));

// Action Types
export const TestActionTypeSchema = lazySchema(() => z.enum([
  'create_record',
  'update_record',
  'delete_record',
  'read_record',
  'query_records',
  'api_call',
  'run_script',
  'wait' // Testing async processes
]).describe('Type of test action to perform'));

export const TestActionSchema = lazySchema(() => z.object({
  type: TestActionTypeSchema.describe('The action type to execute'),
  target: z.string().describe('Target Object, API Endpoint, or Function Name'),
  payload: z.record(z.string(), z.unknown()).optional().describe('Data to send or use'),
  user: z.string().optional().describe('Run as specific user/role for impersonation testing')
}).describe('A single test action to execute against the system'));

// Assertion Types
export const TestAssertionTypeSchema = lazySchema(() => z.enum([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_null',
  'not_null',
  'gt',
  'gte',
  'lt',
  'lte',
  'error' // Expecting an error
]).describe('Comparison operator for test assertions'));

export const TestAssertionSchema = lazySchema(() => z.object({
  field: z.string().describe('Field path in the result to check, resolved against the parsed response body root — no "body." prefix (e.g. "data.0.status")'),
  operator: TestAssertionTypeSchema.describe('Comparison operator to use'),
  expectedValue: z.unknown().describe('Expected value to compare against')
}).describe('A test assertion that validates the result of a test action'));

// --- Test Structure ---

export const TestStepSchema = lazySchema(() => z.object({
  name: z.string().describe('Step name for identification in test reports'),
  description: z.string().optional().describe('Human-readable description of what this step tests'),
  action: TestActionSchema.describe('The action to execute in this step'),
  assertions: z.array(TestAssertionSchema).optional().describe('Assertions to validate after the action completes'),
  // Capture outputs to variables for subsequent steps
  capture: z.record(z.string(), z.string()).optional().describe('Map result fields to context variables, paths resolved against the response body root (e.g. { "newId": "data.id" })')
}).describe('A single step in a test scenario, consisting of an action and optional assertions'));

export const TestScenarioSchema = lazySchema(() => z.object({
  id: z.string().describe('Unique scenario identifier'),
  name: z.string().describe('Scenario name for test reports'),
  description: z.string().optional().describe('Detailed description of the test scenario'),
  tags: z.array(z.string()).optional().describe('Tags for filtering and categorization (e.g. "critical", "regression", "crm")'),
  
  setup: z.array(TestStepSchema).optional().describe('Steps to run before main test (preconditions)'),
  steps: z.array(TestStepSchema).describe('Main test sequence to execute'),
  teardown: z.array(TestStepSchema).optional().describe('Steps to cleanup after test execution'),
  
  // Preconditions, judged by core's `TestRunner` before the scenario's first
  // step (ADR-0049: declared is enforced). An unmet entry makes the scenario
  // SKIPPED with a reason — counted on its own, never as passed.
  requires: z.object({
    params: z.array(z.string()).optional().describe(
      'Environment variables that must be set to a non-empty value in the process running `os test` — the runner\'s own '
      + 'environment, not the target server\'s. An unset or empty variable skips the scenario (SKIPPED, never passed) '
      + 'with a reason naming the variable'
    ),
    services: z.array(CoreServiceName).optional().describe(
      'Services the target must declare in its discovery document as `enabled` with status `available` (ADR-0076 D12), '
      + 'read from the discovery document `os test` already fetches once per run. An entry the target does not declare '
      + 'that way skips the scenario (SKIPPED, never passed) with a reason naming the service and the services the target '
      + 'does declare available'
    ),
    // ADR-0049 enforce-or-remove, ruled B: `plugins` could never be judged —
    // `os test` reaches its target over HTTP and no served surface lists the
    // loaded plugins — so it retires into `services`, the discovery contract
    // that already says what a host serves. A tombstone, not a bare deletion:
    // this object is non-strict, and a deleted key would be stripped in
    // silence. No D2 conversion: a QA suite is a loose JSON file `os test`
    // loads, never a stack collection member or a stored row; the family's D3
    // entry is `qa-scenario-requires-plugins-retired`.
    plugins: retiredKey(
      '`scenarios[].requires.plugins` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — nothing '
      + 'ever checked it: `os test` reaches its target over HTTP and no served surface lists the loaded plugins, so a '
      + 'scenario naming a missing plugin ran anyway. Delete the key and name the service the scenario needs in '
      + '`requires.services`, which is judged against the services the target\'s discovery document declares enabled '
      + 'and available — an unmet entry skips the scenario and says why. Plugin → service: '
      + `${PLUGIN_TO_SERVICE}. A plugin not listed fills no discovery service slot, so there is no service to require `
      + 'for it.',
    ),
  }).optional().describe(
    'Preconditions judged before the scenario\'s first step (setup included). Every entry must hold, or the scenario is '
    + 'SKIPPED with a reason naming each unmet entry — counted separately by `os test` and never counted as passed'
  )
}).describe('A complete test scenario with setup, execution steps, and teardown'));

export const TestSuiteSchema = lazySchema(() => z.object({
  name: z.string().describe('Test suite name'),
  scenarios: z.array(TestScenarioSchema).describe('List of test scenarios in this suite')
}).describe('A collection of test scenarios grouped into a test suite'));

export type TestSuite = z.input<typeof TestSuiteSchema>;
export type TestScenario = z.input<typeof TestScenarioSchema>;
export type TestStep = z.input<typeof TestStepSchema>;
export type TestAction = z.input<typeof TestActionSchema>;
export type TestAssertion = z.input<typeof TestAssertionSchema>;
export type TestActionType = z.input<typeof TestActionTypeSchema>;
export type TestAssertionType = z.input<typeof TestAssertionTypeSchema>;
export type TestContext = z.input<typeof TestContextSchema>;
