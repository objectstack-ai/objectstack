// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineFlow } from '@objectstack/spec';

/**
 * Search GitHub issues and pull requests. Run it with
 * `POST /api/v1/automation/github_search_issues/trigger` and a body of
 * `{ "params": { "query": "repo:acme/app is:open label:bug" } }`; the tool's
 * answer is the run's `search.content` output.
 */
export const GitHubSearchIssuesFlow = defineFlow({
  name: 'github_search_issues',
  label: 'GitHub: search issues',
  description: "Searches issues and pull requests with GitHub's search syntax through the github_mcp connector.",
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'query', type: 'text', isInput: true },
    { name: 'search.content', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'search',
      type: 'connector_action',
      label: 'search_issues',
      connectorConfig: {
        connectorId: 'github_mcp',
        actionId: 'search_issues',
        input: { query: { dialect: 'cel', source: 'query' } },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'search' },
    { id: 'e2', source: 'search', target: 'end' },
  ],
});

/**
 * Read one issue. Run it with
 * `POST /api/v1/automation/github_get_issue/trigger` and a body of
 * `{ "params": { "owner": "acme", "repo": "app", "issue_number": 42 } }`; the
 * issue is the run's `issue.content` output.
 */
export const GitHubGetIssueFlow = defineFlow({
  name: 'github_get_issue',
  label: 'GitHub: get issue',
  description: 'Reads one issue (title, state, body, labels) through the github_mcp connector.',
  type: 'autolaunched',
  status: 'active',
  variables: [
    { name: 'owner', type: 'text', isInput: true },
    { name: 'repo', type: 'text', isInput: true },
    { name: 'issue_number', type: 'number', isInput: true },
    { name: 'issue.content', type: 'json', isOutput: true },
  ],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'issue',
      type: 'connector_action',
      label: 'issue_read',
      connectorConfig: {
        connectorId: 'github_mcp',
        actionId: 'issue_read',
        input: {
          method: 'get',
          owner: { dialect: 'cel', source: 'owner' },
          repo: { dialect: 'cel', source: 'repo' },
          issue_number: { dialect: 'cel', source: 'issue_number' },
        },
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'issue' },
    { id: 'e2', source: 'issue', target: 'end' },
  ],
});

export const allFlows = [GitHubSearchIssuesFlow, GitHubGetIssueFlow];
