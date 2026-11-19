// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Shape guarantees for PLATFORM_PROVIDED_TOOL_NAMES (issue #3820, ADR-0109).
//
// Unlike platform-object-names, the OWNING packages live in the separate
// `cloud` repository (`service-ai` / `service-ai-studio`), so the "does the
// list match what is actually registered" conformance half of the contract is
// tested THERE — same split as CLOUD_PROVIDED_OBJECT_NAMES. What this repo can
// and does pin: the list's internal invariants, so a bad entry cannot poison
// every consumer silently.

import { describe, it, expect } from 'vitest';
import {
  PLATFORM_TOOLS_BY_PACKAGE,
  PLATFORM_PROVIDED_TOOL_NAMES,
  PLATFORM_TOOL_FAMILY_PREFIXES,
  MCP_FILE_TOOL_NAMES,
  isPlatformProvidedToolName,
} from './platform-tool-names';
import { LIST_DATASETS_TOOL_NAME, QUERY_DATASET_TOOL_NAME } from '../../ai/dataset-tools.zod';

describe('PLATFORM_PROVIDED_TOOL_NAMES — internal invariants', () => {
  it('every name is snake_case (ToolSchema name grammar)', () => {
    for (const name of PLATFORM_PROVIDED_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });

  it('no name collides across owning packages', () => {
    const all = Object.values(PLATFORM_TOOLS_BY_PACKAGE).flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('no static name sits inside a materialised family namespace', () => {
    // A statically-listed `action_x` would shadow the dynamic family and make
    // the resolution ladder ambiguous — families resolve against the stack's
    // own actions, never this registry.
    for (const name of PLATFORM_PROVIDED_TOOL_NAMES) {
      for (const prefix of PLATFORM_TOOL_FAMILY_PREFIXES) {
        expect(name.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('the membership helper answers from the flattened set', () => {
    expect(isPlatformProvidedToolName('describe_object')).toBe(true);
    expect(isPlatformProvidedToolName('query_records')).toBe(true);
    // The HotCRM audit's fictional reference — the case the registry exists
    // to catch.
    expect(isPlatformProvidedToolName('forecast_revenue')).toBe(false);
    expect(isPlatformProvidedToolName('action_create_case')).toBe(false);
  });

  it('lists the service-ai dataset pair the ask agent registers (cloud#4551)', () => {
    // Cloud `service-ai` registers both for the ask agent. While the registry
    // lacked them, a skill naming either read as a fictional tool and the chat
    // showed the raw tool id as the step name.
    // The spelling is the one ADR-0149 D2 declares for both registrations.
    expect(PLATFORM_TOOLS_BY_PACKAGE['service-ai']).toEqual(
      expect.arrayContaining([LIST_DATASETS_TOOL_NAME, QUERY_DATASET_TOOL_NAME]),
    );
    expect(isPlatformProvidedToolName(LIST_DATASETS_TOOL_NAME)).toBe(true);
    expect(isPlatformProvidedToolName(QUERY_DATASET_TOOL_NAME)).toBe(true);
    // The control: a neighbour spelling nobody registers still misses.
    expect(isPlatformProvidedToolName('query_datasets')).toBe(false);
  });

  it('each group is sorted, so diffs stay reviewable', () => {
    for (const [pkg, names] of Object.entries(PLATFORM_TOOLS_BY_PACKAGE)) {
      expect([...names].sort(), pkg).toEqual([...names]);
    }
  });
});

describe('MCP_FILE_TOOL_NAMES — the MCP door\'s file tools, kept apart from the cloud registry', () => {
  // Which names the door registers is pinned in `@objectstack/mcp`
  // (`mcp-file-tools.test.ts`), and that the lint rule resolves them in
  // `@objectstack/lint`. What this file pins is the list's own shape, and the
  // separation that keeps every PLATFORM_TOOLS_BY_PACKAGE group the exact set
  // one cloud package registers.
  it('is snake_case, sorted and duplicate-free', () => {
    for (const name of MCP_FILE_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
    expect([...MCP_FILE_TOOL_NAMES].sort()).toEqual([...MCP_FILE_TOOL_NAMES]);
    expect(new Set(MCP_FILE_TOOL_NAMES).size).toBe(MCP_FILE_TOOL_NAMES.length);
  });

  it('shares no name with the cloud registry and none sits inside a materialised family', () => {
    for (const name of MCP_FILE_TOOL_NAMES) {
      expect(isPlatformProvidedToolName(name), name).toBe(false);
      for (const prefix of PLATFORM_TOOL_FAMILY_PREFIXES) {
        expect(name.startsWith(prefix), name).toBe(false);
      }
    }
  });
});
