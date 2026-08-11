// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

// --- Building Blocks ---

import { lazySchema } from '../shared/lazy-schema';
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
  
  // Environment requirements
  requires: z.object({
    params: z.array(z.string()).optional().describe('Required environment variables or parameters'),
    plugins: z.array(z.string()).optional().describe('Required plugins that must be loaded')
  }).optional().describe('Environment requirements for this scenario')
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
