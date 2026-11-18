---
'@objectstack/mcp': patch
---

feat(mcp): the HTTP `initialize` instructions carry the governed-metric selection rule and the skills install line

Clause-②: no
Metadata-protocol: none

A client connected to the open MCP server over HTTP was told one sentence at `initialize`. The rule for choosing between a governed metric and an object query lived only in the dataset tools' own descriptions, which a client reads after it has already chosen a tool, and nothing named the skills package to install.

When neither the host's per-request text nor the plugin's `instructions` option answers, `result.instructions` now carries, after that sentence:

- **The selection rule**, only where the request registers both `list_datasets` and `query_dataset` (a bridge with the dataset members and a grant that admits `data:read`; an API key or session counts): look for a governed metric first with `list_datasets` and the question's business words; a word matches only an equal name, label or synonym; one measure match answers through `query_dataset`; several matches are a question for the user; no match falls back to `query_records` / `aggregate_records` and says the answer is not from a governed metric. A grant without `data:read` gets no dataset sentence.
- **The skills install line**: `Published skills: @objectstack/skills <version>` with the command that installs it into the agent's skills directory, with or without a project, `os skills install --version <version>`, at this package's own version (released together with `@objectstack/skills`), not the `version` option.

Host-injected instructions and the `instructions` option are served exactly as before, with nothing appended. The stdio server's instructions are unchanged.
