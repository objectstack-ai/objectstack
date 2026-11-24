---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

feat(mcp): the MCP door can search and read the installed apps' manuals, and tells the client how to answer a question about the app

Clause-②: yes
Metadata-protocol: none

An AI client connected over MCP (a user's own Claude, Cursor, …) can now answer "what is X?" and "how does this approval work?" from the manuals the installed apps ship, instead of from its own guess:

- **`search_package_docs({ terms, package? })`** finds the pages whose title, a heading or text contains one of the terms (case aside, in the page's base text or a translation). Pages that contain more of the terms come first, then pages where the terms sit higher (the sum of title 3, heading 2, text 1), then by title; at most 10, each with an excerpt, its manual and, where the page has one, its console address (`/_console/apps/<package>/docs/<book>/<page>`) to cite. The heading parse is line-based and linear.
- **`read_package_doc({ name, package?, locale? })`** reads one page: its title, manual, Markdown content and, where the page has one, its console address (cut at 60,000 characters, and the answer says so).
- **Who sees what.** Both tools read the `doc` items through the `/meta/doc` docs-audience gate (ADR-0046 §6.7) with the request's execution context as the caller: a page the caller may not read is neither found nor read, and answers as not found. On an OAuth grant the request is an agent acting for the person who consented, and a permission-set audience is read against that person's own permission sets (ADR-0090 D10), never the token's scope-derived sets. Both are read tools: they register for an API key, a session, or a token granted `data:read`. The runtime's HTTP bridge carries them where the protocol serves the `/meta` list read; the stdio bridge does not.
- **The answer order.** Where both tools register, the HTTP `initialize` instructions say: read the manuals first; answer a concept from the manual, and label a general explanation as one when no page covers it; for a process or rule, also read its real definition, which wins where the two differ; end with each page's title and url. The rule names a definition reader only where the connection lists one (`describe_metadata`, else `get_metadata_item`, both under `metadata:write`); without one it says to answer from the manual and state that the configured process was not checked. A host's own instructions and a configured `instructions` option are served unchanged.

The two names are the ones the cloud AI runtime already registers, so `MCP_DOOR_TOOL_NAMES` (`@objectstack/spec/system`) now lists them too; `PLATFORM_PROVIDED_TOOL_NAMES` is unchanged. No metadata key, value or default changes.
