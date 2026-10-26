/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit tests for agent alias resolution — the bridge between friendly console
 * routes (`/ai/build`, `/ai/ask`) and the built-in agent identifiers, robust
 * across the Path A rename (`metadata_assistant`→`build`, `data_chat`→`ask`)
 * and the legacy ids. Also covers `resolveDefaultAgentName`'s alias-awareness.
 */
import { describe, it, expect } from 'vitest';
import {
  agentAliasGroup,
  agentRouteName,
  resolveAgentParam,
  isBuiltinAgentName,
  isBuildAgent,
  isAskAgent,
} from '../agentAliases';
import { resolveDefaultAgentName, type AgentDescriptor } from '../useAgents';

const LEGACY: readonly string[] = ['data_chat', 'metadata_assistant'];
const RENAMED: readonly string[] = ['ask', 'build'];

function agents(...names: string[]): AgentDescriptor[] {
  return names.map((name) => ({ name, label: name }));
}

describe('agentRouteName', () => {
  it('maps built-in ids (new and legacy) to their friendly route name', () => {
    expect(agentRouteName('metadata_assistant')).toBe('build');
    expect(agentRouteName('build')).toBe('build');
    expect(agentRouteName('data_chat')).toBe('ask');
    expect(agentRouteName('ask')).toBe('ask');
  });
  it('leaves custom agents as their own name', () => {
    expect(agentRouteName('sales_assistant')).toBe('sales_assistant');
  });
});

describe('agentAliasGroup', () => {
  it('returns the friendly-first equivalence group for built-ins', () => {
    expect(agentAliasGroup('metadata_assistant')).toEqual(['build', 'metadata_assistant']);
    expect(agentAliasGroup('ask')).toEqual(['ask', 'data_chat']);
  });
  it('returns a singleton for custom agents', () => {
    expect(agentAliasGroup('custom_x')).toEqual(['custom_x']);
  });
});

describe('resolveAgentParam', () => {
  it('resolves a friendly route param against a legacy (pre-rename) catalog', () => {
    expect(resolveAgentParam('build', LEGACY)).toBe('metadata_assistant');
    expect(resolveAgentParam('ask', LEGACY)).toBe('data_chat');
  });
  it('resolves a friendly route param against a renamed (post-rename) catalog', () => {
    expect(resolveAgentParam('build', RENAMED)).toBe('build');
    expect(resolveAgentParam('ask', RENAMED)).toBe('ask');
  });
  it('resolves a legacy id param against either catalog', () => {
    expect(resolveAgentParam('metadata_assistant', LEGACY)).toBe('metadata_assistant');
    expect(resolveAgentParam('metadata_assistant', RENAMED)).toBe('build');
    expect(resolveAgentParam('data_chat', RENAMED)).toBe('ask');
  });
  it('resolves a custom agent by its own name when present (criterion c)', () => {
    expect(resolveAgentParam('sales_assistant', ['data_chat', 'sales_assistant'])).toBe('sales_assistant');
  });
  it('returns undefined for a non-agent segment (e.g. a legacy conversation id)', () => {
    expect(resolveAgentParam('conv_abc-123', LEGACY)).toBeUndefined();
    expect(resolveAgentParam(undefined, LEGACY)).toBeUndefined();
    // A friendly name whose target isn't served (empty catalog) is unresolvable.
    expect(resolveAgentParam('build', [])).toBeUndefined();
  });
});

describe('isBuiltinAgentName', () => {
  it('recognizes built-in agents by friendly name or legacy id, catalog-independent', () => {
    expect(isBuiltinAgentName('build')).toBe(true);
    expect(isBuiltinAgentName('metadata_assistant')).toBe(true);
    expect(isBuiltinAgentName('ask')).toBe(true);
    expect(isBuiltinAgentName('data_chat')).toBe(true);
  });
  it('returns false for custom agents and non-agent segments (conversation ids)', () => {
    expect(isBuiltinAgentName('showcase_assistant')).toBe(false);
    expect(isBuiltinAgentName('conv_abc-123')).toBe(false);
    expect(isBuiltinAgentName(undefined)).toBe(false);
  });
  it('distinguishes "known agent, just not in this catalog" from "not an agent"', () => {
    // `/ai/build` on a deployment without the cloud build agent: not in the
    // catalog (resolveAgentParam → undefined) BUT a known agent (→ fall back to
    // the default surface, not treat "build" as a conversation id).
    const catalogWithoutBuild = ['ask', 'showcase_assistant'];
    expect(resolveAgentParam('build', catalogWithoutBuild)).toBeUndefined();
    expect(isBuiltinAgentName('build')).toBe(true);
    // A real conversation id: not resolvable AND not a known agent.
    expect(resolveAgentParam('conv_x', catalogWithoutBuild)).toBeUndefined();
    expect(isBuiltinAgentName('conv_x')).toBe(false);
  });
});

describe('isBuildAgent / isAskAgent', () => {
  it('classify built-ins regardless of new vs legacy id', () => {
    expect(isBuildAgent('build')).toBe(true);
    expect(isBuildAgent('metadata_assistant')).toBe(true);
    expect(isAskAgent('ask')).toBe(true);
    expect(isAskAgent('data_chat')).toBe(true);
  });
  it('do not misclassify the other built-in or custom agents', () => {
    expect(isBuildAgent('data_chat')).toBe(false);
    expect(isAskAgent('metadata_assistant')).toBe(false);
    expect(isBuildAgent('sales_assistant')).toBe(false);
    expect(isAskAgent(undefined)).toBe(false);
  });
});

describe('resolveDefaultAgentName (alias-aware)', () => {
  it('prefers the platform data agent across the rename', () => {
    // legacy catalog → resolves the platform default (ask) to data_chat
    expect(resolveDefaultAgentName(agents('data_chat', 'metadata_assistant'))).toBe('data_chat');
    // renamed catalog → resolves to ask
    expect(resolveDefaultAgentName(agents('ask', 'build'))).toBe('ask');
  });
  it('honors a preferred agent given as a friendly name, new id, or legacy id', () => {
    const legacy = agents('data_chat', 'metadata_assistant');
    expect(resolveDefaultAgentName(legacy, 'build')).toBe('metadata_assistant');
    expect(resolveDefaultAgentName(legacy, 'metadata_assistant')).toBe('metadata_assistant');
    const renamed = agents('ask', 'build');
    expect(resolveDefaultAgentName(renamed, 'metadata_assistant')).toBe('build');
  });
  it('falls back to the first agent when neither preferred nor platform default is present', () => {
    expect(resolveDefaultAgentName(agents('sales_assistant'))).toBe('sales_assistant');
    expect(resolveDefaultAgentName([])).toBeUndefined();
  });
});
