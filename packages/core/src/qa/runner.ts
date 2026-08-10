// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as QA from '@objectstack/spec/qa';
import { TestExecutionAdapter } from './adapter.js';

export interface TestResult {
  scenarioId: string;
  passed: boolean;
  steps: StepResult[];
  error?: unknown;
  duration: number;
}

export interface StepResult {
  stepName: string;
  passed: boolean;
  error?: unknown;
  output?: unknown;
  duration: number;
}

/**
 * Name the runtime shape of a value the way a suite author sees it in their fixture.
 * `typeof` answers `object` for both `null` and an array, which are the two shapes a
 * `contains` author most needs told apart from a plain record.
 */
function describeActualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Say WHICH of the two things is wrong, because the message is the only thing the
 * author has: `undefined`/`null` mean the path did not resolve to a value, so the
 * FIXTURE (the field path, or the response shape it was written against) is the
 * suspect; anything else means the path resolved fine and the ASSERTION picked an
 * operator that does not apply to what it found.
 */
function containsInapplicableHint(actual: unknown): string {
  if (actual === undefined) {
    return (
      'The path resolved to nothing — the field is absent from the result, or the path is misspelled. ' +
      "Use 'is_null' if asserting absence is what you meant."
    );
  }
  if (actual === null) {
    return "The path resolved to null. Use 'is_null' if asserting absence is what you meant.";
  }
  return (
    "'contains' tests array membership and string substrings only. " +
    "Use 'equals' to compare a scalar, or point the field at the array or string you meant to look inside."
  );
}

export class TestRunner {
  constructor(private adapter: TestExecutionAdapter) {}

  async runSuite(suite: QA.TestSuite): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const scenario of suite.scenarios) {
      results.push(await this.runScenario(scenario));
    }
    return results;
  }

  async runScenario(scenario: QA.TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const context: Record<string, unknown> = {}; // Variable context
    
    // Initialize context from initial payload if needed? Currently schema doesn't have initial context prop on Scenario
    // But we defined TestContextSchema separately.
    
    // Setup
    if (scenario.setup) {
      for (const step of scenario.setup) {
        try {
          await this.runStep(step, context);
        } catch (e) {
           return {
             scenarioId: scenario.id,
             passed: false,
             steps: [],
             error: `Setup failed: ${e instanceof Error ? e.message : String(e)}`,
             duration: Date.now() - startTime
           };
        }
      }
    }

    const stepResults: StepResult[] = [];
    let scenarioPassed = true;
    let scenarioError: unknown = undefined;

    // Main Steps
    for (const step of scenario.steps) {
      const stepStartTime = Date.now();
      try {
        const output = await this.runStep(step, context);
        stepResults.push({
          stepName: step.name,
          passed: true,
          output,
          duration: Date.now() - stepStartTime
        });
      } catch (e) {
        scenarioPassed = false;
        scenarioError = e;
        stepResults.push({
          stepName: step.name,
          passed: false,
          error: e,
          duration: Date.now() - stepStartTime
        });
        break; // Stop on first failure
      }
    }

    // Teardown (run even if failed)
    if (scenario.teardown) {
      for (const step of scenario.teardown) {
        try {
          await this.runStep(step, context);
        } catch (e) {
          // Log teardown failure but don't override main failure if it exists
          if (scenarioPassed) {
             scenarioPassed = false;
             scenarioError = `Teardown failed: ${e instanceof Error ? e.message : String(e)}`;
          }
        }
      }
    }

    return {
      scenarioId: scenario.id,
      passed: scenarioPassed,
      steps: stepResults,
      error: scenarioError,
      duration: Date.now() - startTime
    };
  }

  private async runStep(step: QA.TestStep, context: Record<string, unknown>): Promise<unknown> {
    // 1. Resolve Variables with Context (Simple interpolation or just pass context?)
    // For now, assume adpater handles context resolution or we do basic replacement
    const resolvedAction = this.resolveVariables(step.action, context);

    // 2. Execute Action
    const result = await this.adapter.execute(resolvedAction, context);

    // 3. Capture Outputs
    if (step.capture) {
      for (const [varName, path] of Object.entries(step.capture)) {
        context[varName] = this.getValueByPath(result, path);
      }
    }

    // 4. Run Assertions
    if (step.assertions) {
      for (const assertion of step.assertions) {
        this.assert(result, assertion, context);
      }
    }

    return result;
  }

  private resolveVariables(action: QA.TestAction, context: Record<string, unknown>): QA.TestAction {
    const actionStr = JSON.stringify(action);
    const resolved = actionStr.replace(/\{\{([^}]+)\}\}/g, (_match, varPath: string) => {
      const value = this.getValueByPath(context, varPath.trim());
      if (value === undefined) return _match; // Keep unresolved
      return typeof value === 'string' ? value : JSON.stringify(value);
    });
    try {
      return JSON.parse(resolved) as QA.TestAction;
    } catch {
      return action; // Fallback to original if parse fails
    }
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    if (!path) return obj;
    const parts = path.split('.');
    let current: any = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  private assert(result: unknown, assertion: QA.TestAssertion, _context: Record<string, unknown>) {
    const actual = this.getValueByPath(result, assertion.field);
    // Resolve expected value if it's a variable ref? 
    const expected = assertion.expectedValue; // Simplify for now

    switch (assertion.operator) {
      case 'equals':
        if (actual !== expected) throw new Error(`Assertion failed: ${assertion.field} expected ${expected}, got ${actual}`);
        break;
      case 'not_equals':
        if (actual === expected) throw new Error(`Assertion failed: ${assertion.field} expected not ${expected}, got ${actual}`);
        break;
      case 'contains':
         if (Array.isArray(actual)) {
             if (!actual.includes(expected)) throw new Error(`Assertion failed: ${assertion.field} array does not contain ${expected}`);
         } else if (typeof actual === 'string') {
             if (!actual.includes(String(expected))) throw new Error(`Assertion failed: ${assertion.field} string does not contain ${expected}`);
         } else {
             // `contains` is defined over arrays (membership) and strings (substring), and
             // over nothing else. This branch used to be absent, so every other shape fell
             // out of the switch and the assertion reported PASSED (#7256) — a `contains`
             // written against a path the result does not carry was the test silently
             // deleting itself, and CI believed the green. An assertion the engine cannot
             // evaluate is a FAILED assertion, which is the posture every other unhandled
             // shape in this engine already takes (`default:` below; the HTTP adapter's
             // unknown action type).
             throw new Error(
                 `Assertion failed: ${assertion.field} cannot be evaluated by 'contains' — ` +
                 `expected an array or a string at that path, got ${describeActualType(actual)}. ` +
                 containsInapplicableHint(actual)
             );
         }
         break;
      case 'not_null':
        if (actual === null || actual === undefined) throw new Error(`Assertion failed: ${assertion.field} is null`);
        break;
      case 'is_null':
         if (actual !== null && actual !== undefined) throw new Error(`Assertion failed: ${assertion.field} is not null`);
         break;
      // ... Add other operators
      default:
        throw new Error(`Unknown assertion operator: ${assertion.operator}`);
    }
  }
}
