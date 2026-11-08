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
tool whose scope the token lacks, though it keeps read tools that also work on
public repositories listed whatever the scopes, `search_issues` and
`issue_read` among them ([PAT scope filtering](https://github.com/github/github-mcp-server/blob/main/docs/scope-filtering.md#public-repository-access)).
If the server does leave out a tool this app includes, `github_mcp` stays
disconnected with a reason naming the missing tools and both possible causes,
the token's scopes or the app's declaration, and its flows fail; the server
itself keeps starting, wherever the value is set. Replace the token with one
that carries the `repo` scope: a new value in **Connector Credentials** takes
effect at once, a new environment variable at the next start. Widening the
scopes of the token you already use works too: set it again in **Connector
Credentials**, or, for the environment variable, wait for the connector's next
automatic retry, at most five minutes away.

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

## Provenance

This app packages no vendor document: its upstream is GitHub's MCP server
itself, and what it pins is the definition of each tool it includes. The
listing's three provenance fields are:

- **upstream**: `https://api.githubcopilot.com/mcp/`, the server the
  `github_mcp` connector dials, with `X-MCP-Readonly: true`.
- **commit**: the commit of this repository (`objectstack-ai/objectstack`)
  the package is published from. A file cannot name the commit that contains
  it, so the publisher records it.
- **sha256**: the digest of the pin set below, pin-set sha256
  `e922e2420b05707fb3ec9df270009da30d57177c297a6d7c3ee0b4ccbbad7516`.

The connector's `providerConfig.toolsSnapshot` pins both included tools. Each
pin is the sha256, in lowercase hex, of the tool's `{ name, description,
inputSchema }` from the server's `tools/list` answer, written as canonical JSON
(the `mcpToolDigest` recipe of `@objectstack/connector-mcp`):

| Tool | Pin |
|:---|:---|
| `search_issues` | `443421e063c9330d4504a88b57def74d1f1e3d0793479068073630a1846eaeb0` |
| `issue_read` | `380e96f3d78b5c893668ab48a2d72191a3906bdc4e5e5c89f9e92c3e9de6c392` |

The maintainer measured them on 2026-11-06 at 17:27 UTC, on their own machine,
by calling `initialize` and `tools/list` on the server with
`X-MCP-Readonly: true` (the script and its full output are in
[objectstack-ai/objectstack#30116](https://github.com/objectstack-ai/objectstack/issues/30116#issuecomment-6691107153)).
The token was the maintainer's local GitHub CLI token, which carries broader
scopes than this app needs, not a token made read-only for the run. GitHub's
server can serve a different tool set to a token with other scopes, so if a
read-only token is served different definitions, the connector says so on its
first connection (below). The tool definitions that output carried are
`test/fixtures/github-mcp-tools.json`; the package's tests recompute both pins
from them and fail when a pin, this record or the fixture disagree, with no
call to GitHub.

**The pin-set digest**, for anyone who recomputes it, such as the
marketplace's ingestion: serialize the `toolsSnapshot` record as JSON with its
keys sorted (UTF-16 code-unit order, as JavaScript's default sort) and no
whitespace, which for a record of strings is its RFC 8785 (JCS) form; then
take the sha256 of those UTF-8 bytes, in lowercase hex. For the pins above:

```bash
printf '%s' '{"issue_read":"380e96f3d78b5c893668ab48a2d72191a3906bdc4e5e5c89f9e92c3e9de6c392","search_issues":"443421e063c9330d4504a88b57def74d1f1e3d0793479068073630a1846eaeb0"}' | sha256sum
# e922e2420b05707fb3ec9df270009da30d57177c297a6d7c3ee0b4ccbbad7516  -
```

**When GitHub changes a tool.** On every connection the connector hashes the
tools the server lists and compares them with the pins. A pinned tool the
server serves with a different description or input schema leaves
`github_mcp` degraded with `CONNECTOR_UPSTREAM_CHANGED`, naming the tool. (A
pinned tool the server no longer lists takes the path under Credentials
instead, since a token's scopes can hide a tool too.) A changed tool is the
signal to measure again, update the pins, this section and the fixture in the
same change, and publish again. Never drop a pin to clear it.
