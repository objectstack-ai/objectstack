---
'@objectstack/skills': patch
---

feat(skills): objectstack-mcp-build, the order of work for a client that builds through the MCP draft door

Clause-②: no
Metadata-protocol: none

The skills catalog gains `objectstack-mcp-build`, a short process skill for a client that builds or changes an app's metadata through an environment's MCP draft door, with no project files. It gives the order of work: read what exists (`list_metadata_items`, `get_metadata_item`, and `describe_object` where the connection lists it), load the domain skill for the type and read its contract, save with `save_metadata_draft`, read the publish verdict in the reply and repair the item until no refusal is left, then report the drafts and give a person the Studio review routes the reply names. The door has no publish tool, so the skill tells the client never to say a draft is live.

It restates no shape and no tool argument: the domain skills (`objectstack-data`, `objectstack-ui`, `objectstack-automation` and the others) stay the one copy of each type's keys and traps, for a project author and an MCP client alike.

A project that already syncs its skills gets the new one on its next `npx skills@1.7.2 experimental_sync --agent <runtime> --copy -y` after bumping `@objectstack/skills`.
