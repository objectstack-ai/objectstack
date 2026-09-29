// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as QA from '@objectstack/spec/qa';

/**
 * What an adapter can say about the services its target serves — the input the
 * runner judges `TestScenario.requires.services` against.
 */
export interface TargetServices {
  /**
   * The target's per-service status map, keyed by service name — the
   * discovery document's `services` (ADR-0076 D12: advertise only what is
   * mounted). Absent when the adapter could not read it; the runner then has
   * nothing to judge a service requirement against, and every such requirement
   * is unmet.
   */
  services?: Readonly<Record<string, unknown>>;
  /** One clause saying where `services` came from, or why it is absent. */
  source: string;
}

/**
 * Interface for executing test actions against a target system.
 * The target could be a local Kernel instance or a remote API.
 */
export interface TestExecutionAdapter {
  /**
   * Execute a single test action.
   * @param action The action to perform (create_record, api_call, etc.)
   * @returns The result of the action (e.g. created record, API response)
   */
  execute(action: QA.TestAction, context: Record<string, unknown>): Promise<unknown>;

  /**
   * The services the target declares, for judging `requires.services` before a
   * scenario runs. Optional: an adapter that cannot say leaves it out, and a
   * scenario requiring a service is then SKIPPED with that reason — never run
   * on an unverified precondition, never passed.
   */
  readTargetServices?(): Promise<TargetServices>;
}
