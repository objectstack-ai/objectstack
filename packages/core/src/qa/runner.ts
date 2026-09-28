// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as QA from '@objectstack/spec/qa';
import type { TargetServices, TestExecutionAdapter } from './adapter.js';

/**
 * A scenario's verdict. `skipped` is its own outcome, not a kind of pass or
 * fail: the scenario never ran because a `requires` entry was unmet, so it
 * proved nothing — a report counts it separately and never as passed.
 */
export type TestResultStatus = 'passed' | 'failed' | 'skipped';

/** One `TestScenario.requires` entry that did not hold. */
export interface UnmetRequirement {
  /** The `requires` key the entry sits under. */
  key: 'params' | 'services';
  /** The entry: the environment variable or the service key. */
  name: string;
  /** Why it is unmet, in one clause — what was observed instead. */
  detail: string;
}

/** Why a scenario was skipped instead of run. */
export interface SkipReport {
  /**
   * The sentence a report prints: every unmet entry by key and name and, when
   * a service is unmet, the services the target does declare available.
   */
  reason: string;
  /** Each unmet entry, in `requires` order (`params` first, then `services`). */
  unmet: UnmetRequirement[];
  /**
   * The services the target declares `enabled` with status `available`,
   * sorted — present whenever a `services` requirement was judged. Empty when
   * the target's services could not be read.
   */
  availableServices?: string[];
}

/** Options for {@link TestRunner}. */
export interface TestRunnerOptions {
  /**
   * The environment `requires.params` is judged against. Defaults to this
   * process's own environment — the process running the suite (`os test`),
   * never the target server's, which no suite can observe.
   */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * One scenario's outcome, carrying the names a report leads with.
 *
 * `scenarioId` is the machine handle; `scenarioName` and `suiteName` are the
 * human titles the author wrote (`TestScenario.name`, `TestSuite.name`) — a
 * report that printed only the id handed the author back the terse half of
 * what they wrote. `description` rides along so a report can say what a
 * FAILED scenario was checking without the reader opening the suite file.
 */
export interface TestResult {
  /**
   * `TestSuite.name` of the suite the scenario ran in. Set by `runSuite`;
   * absent only when `runScenario` is called on a lone scenario, which has no
   * suite to name.
   */
  suiteName?: string;
  scenarioId: string;
  /** `TestScenario.name` — the title a report prints for this scenario. */
  scenarioName: string;
  /** `TestScenario.description`, when the author wrote one. */
  description?: string;
  /**
   * The verdict. `skipped` means a `requires` entry was unmet and no step —
   * setup included — ran; {@link skipped} says which entry and why.
   */
  status: TestResultStatus;
  /**
   * `status === 'passed'`. A skipped scenario is `passed: false` — it proved
   * nothing — but it is not a failure either: read `status` to tell the two
   * apart.
   */
  passed: boolean;
  /** Present exactly when `status` is `skipped`. */
  skipped?: SkipReport;
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

/**
 * One discovery `services` entry is AVAILABLE exactly when the target says
 * `enabled: true` and `status: 'available'` — both halves, because they answer
 * different questions (ADR-0076 D12): `enabled` is "the slot is filled",
 * `status` is whether what fills it is the real thing rather than a stub or a
 * degraded fallback.
 */
function isAvailable(entry: unknown): boolean {
  if (entry === null || typeof entry !== 'object') return false;
  const info = entry as { enabled?: unknown; status?: unknown };
  return info.enabled === true && info.status === 'available';
}

/** Why a required service is unmet, from what the target said about it. */
function describeUnavailable(entry: unknown, target: TargetServices): string {
  if (target.services === undefined) {
    return `not judgeable: the target's services could not be read (${target.source})`;
  }
  if (entry === undefined) return 'not declared by the target';
  if (entry === null || typeof entry !== 'object') return 'declared by the target in an unreadable shape';
  const info = entry as { enabled?: unknown; status?: unknown };
  return `not available on the target (enabled: ${String(info.enabled)}, status: ${String(info.status)})`;
}

export class TestRunner {
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(private adapter: TestExecutionAdapter, options: TestRunnerOptions = {}) {
    this.env = options.env ?? (typeof process === 'undefined' ? {} : process.env);
  }

  async runSuite(suite: QA.TestSuite): Promise<TestResult[]> {
    const results: TestResult[] = [];
    for (const scenario of suite.scenarios) {
      results.push({ suiteName: suite.name, ...(await this.runScenario(scenario)) });
    }
    return results;
  }

  async runScenario(scenario: QA.TestScenario): Promise<TestResult> {
    const startTime = Date.now();

    // Preconditions first: a scenario whose `requires` does not hold runs no
    // step at all — setup included, since setup can write records.
    const skipped = await this.judgeRequirements(scenario);
    if (skipped) {
      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        description: scenario.description,
        status: 'skipped',
        passed: false,
        skipped,
        steps: [],
        duration: Date.now() - startTime,
      };
    }

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
             scenarioName: scenario.name,
             description: scenario.description,
             status: 'failed',
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
      scenarioName: scenario.name,
      description: scenario.description,
      status: scenarioPassed ? 'passed' : 'failed',
      passed: scenarioPassed,
      steps: stepResults,
      error: scenarioError,
      duration: Date.now() - startTime
    };
  }

  /**
   * Judge `TestScenario.requires` (ADR-0049: declared is enforced; ruled B).
   * Returns the skip report when an entry is unmet, `undefined` when every
   * entry holds or the scenario declares none.
   *
   * - `params`: each variable must be set to a non-empty value in {@link env}
   *   — the process running the suite. Empty counts as unset: a CI secret that
   *   is not configured arrives as an empty string, and a scenario that needs
   *   it cannot run on it.
   * - `services`: each key must be declared by the target `enabled` with
   *   `status === 'available'` — the discovery document's own verdict
   *   (ADR-0076 D12), read through the adapter's one probe of the run. A
   *   target whose services cannot be read declares none, so every service
   *   requirement is unmet and the reason says why.
   *
   * Every unmet entry is reported, not just the first, so one run tells the
   * author everything the target is missing.
   */
  private async judgeRequirements(scenario: QA.TestScenario): Promise<SkipReport | undefined> {
    const requires = scenario.requires;
    if (!requires) return undefined;
    const unmet: UnmetRequirement[] = [];

    for (const name of requires.params ?? []) {
      const value = this.env[name];
      if (value === undefined) {
        unmet.push({ key: 'params', name, detail: 'not set in the environment of the process running the suite' });
      } else if (value === '') {
        unmet.push({ key: 'params', name, detail: 'set to an empty value in the environment of the process running the suite' });
      }
    }

    const services = requires.services ?? [];
    let availableServices: string[] | undefined;
    if (services.length > 0) {
      const target: TargetServices = this.adapter.readTargetServices
        ? await this.adapter.readTargetServices()
        : { source: 'the execution adapter does not report the target\'s services' };
      const declared = target.services ?? {};
      availableServices = Object.keys(declared).filter((key) => isAvailable(declared[key])).sort();
      for (const name of services) {
        if (isAvailable(declared[name])) continue;
        unmet.push({ key: 'services', name, detail: describeUnavailable(declared[name], target) });
      }
    }

    if (unmet.length === 0) return undefined;
    const clauses = unmet.map((u) => `requires.${u.key} '${u.name}' is ${u.detail}`);
    let reason = `${clauses.join('; ')}.`;
    if (availableServices !== undefined && unmet.some((u) => u.key === 'services')) {
      reason += availableServices.length > 0
        ? ` The target declares available: ${availableServices.join(', ')}.`
        : ' The target declares no service available.';
    }
    return { reason, unmet, ...(availableServices !== undefined ? { availableServices } : {}) };
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
