/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * cloud#816 / ADR-0057 "B+" — hosts render agent behavior (debug drawer, Live
 * Canvas, resume-vs-fresh) by the server-DECLARED `capabilities`, falling back
 * to the legacy `isBuildAgent(name)` check when the catalog entry carries none
 * (older server) — so shipping order between cloud and console doesn't matter.
 */
import { describe, it, expect } from 'vitest';
import { agentHasCapability, type AgentDescriptor } from '../useAgents';

const withCaps = (name: string, on: boolean): AgentDescriptor => ({
  name,
  label: name,
  capabilities: { authoring: on, canvas: on, debug: on, resume: on },
});

describe('agentHasCapability', () => {
  it('uses DECLARED capabilities when present — even against the name heuristic', () => {
    // A skill-driven build variant with a non-"build" name still gets behavior…
    const variant: AgentDescriptor = {
      name: 'app_author_v2',
      label: 'Author',
      capabilities: { authoring: true, canvas: true, debug: false, resume: true },
    };
    expect(agentHasCapability([variant], 'app_author_v2', 'authoring')).toBe(true);
    expect(agentHasCapability([variant], 'app_author_v2', 'debug')).toBe(false);
    // …and a declared-off `build` beats the name check (declaration wins).
    expect(agentHasCapability([withCaps('build', false)], 'build', 'debug')).toBe(false);
  });

  it('falls back to isBuildAgent(name) when capabilities are absent (older server)', () => {
    const legacy: AgentDescriptor[] = [
      { name: 'build', label: 'Build' },
      { name: 'ask', label: 'Ask' },
    ];
    expect(agentHasCapability(legacy, 'build', 'debug')).toBe(true);
    expect(agentHasCapability(legacy, 'ask', 'debug')).toBe(false);
    // Alias-aware fallback (legacy id).
    expect(agentHasCapability([], 'metadata_assistant', 'resume')).toBe(true);
  });

  it('no name → no capability', () => {
    expect(agentHasCapability([withCaps('build', true)], undefined, 'debug')).toBe(false);
  });
});
