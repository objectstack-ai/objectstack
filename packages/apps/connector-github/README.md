# GitHub

Search and read GitHub issues and pull requests from your flows. The app
connects to GitHub's hosted MCP server (`https://api.githubcopilot.com/mcp/`)
in read-only mode and exposes two of its read tools as connector actions.
Nothing is written to GitHub.

## What it adds

- **A connector, `github_mcp`.** Its actions are `search_issues` (GitHub's
  issue and pull request search syntax) and `issue_read` (one issue's details).
  Any other tool the server offers stays out of your flows and agents.
- **Two flows that use it**, ready to run or to copy:
  - `github_search_issues` takes a `query` (for example
    `repo:acme/app is:open label:bug`) and returns the matching issues as
    `search.content`.
  - `github_get_issue` takes `owner`, `repo` and `issue_number` and returns the
    issue as `issue.content`.

The app adds no objects, no sample data and no demo users. An install adds the
connector and the two flows, and nothing else.

## Credentials

The app needs one credential. Until it is set, the `github_mcp` connector is
listed as disconnected and its flows fail, naming the credential.

| Credential | What it is | Where to get it | Permissions it needs |
|:---|:---|:---|:---|
| `GITHUB_MCP_TOKEN` | A GitHub personal access token, sent to GitHub's MCP server as `Authorization: Bearer <token>` | GitHub → **Settings → Developer settings → Personal access tokens** (<https://github.com/settings/personal-access-tokens/new> for a fine-grained token) | Fine-grained token (GitHub's recommendation): access to the repositories you will search, with read-only **Issues** and **Pull requests** repository permissions; a repository owned by an organization also needs the organization to approve the token. Classic token: the `repo` scope, which both tools require |

Set the value in **Setup → Integrations → Connector Credentials**, or in the
install dialog right after installing. An environment variable named
`GITHUB_MCP_TOKEN` on the server takes precedence over a stored value.

Prefer a fine-grained token. With a classic token, GitHub's server hides every
tool whose scope the token lacks; if it hides `search_issues` or `issue_read`,
the connector refuses to start rather than quietly running without them, and
the reason names the missing tool.

The token is only ever sent to GitHub. It is never stored in the app's
metadata.

## Running it

```bash
curl -X POST "$OS_URL/api/v1/automation/github_search_issues/trigger" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"params": {"query": "repo:acme/app is:open label:bug"}}'
```

To use the answer elsewhere, add a `connector_action` node with
`connectorId: 'github_mcp'` to your own flow and read `<nodeId>.content` in a
later node.

## Limits

- Read only. The server is asked for read tools only (`X-MCP-Readonly: true`)
  and the connector allowlists two of them.
- The token is a static personal token. Signing in with GitHub (OAuth) is not
  offered.
