---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

Clause-②: yes — widening: on a delegated agent token whose scope reaches the docs tools, a permission-set-gated package doc is now found and read when the delegating person holds that set (ADR-0090 D10, ceiling ∩ delegator); nothing served today is refused, a non-holder and a token without docs-tool access still see nothing. Seat runs a contract read before ready; security#2 checks the head read-only before merge.
Metadata-protocol: none

fix(runtime): on an OAuth MCP connection, `search_package_docs` and `read_package_doc` judge a manual's permission-set audience by the delegating person's own permission sets

An OAuth token makes the request an agent acting on behalf of the person who consented (ADR-0090 D10). The two app-docs tools used to judge a manual whose audience is `{ permissionSet }` against the token's scope-derived permission sets, so a person who holds that set could not find or read the manual from their own AI client, while the Console showed it to them.

Now, on such a connection:

- The token's scope still decides whether the docs tools are reached at all (`data:read`). A token without it is served neither tool, whatever the person holds.
- The audience reads the person's own permission sets, resolved by the same grant resolution a request uses, in the organization the token's consent bound. A person who does not exist, or who holds no current membership in that organization, holds no set here, and permission-set manuals stay closed to them.
- The token's own permission sets are never added to the person's: a manual whose audience is one of the token's scope sets stays closed unless the person holds it.
- Manuals with the default audience answer as before. API keys, signed-in sessions and AI service accounts keep their own permission sets.

Both tool descriptions now say so: on an OAuth connection, the person's own permission sets decide, never more.
