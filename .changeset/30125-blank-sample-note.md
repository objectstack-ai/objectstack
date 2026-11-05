---
'create-objectstack': patch
---

Clause-②: no
Metadata-protocol: none

The blank template now says its `note` object is a sample: the generated README gains a "The sample `note` object" section with the steps to delete or replace it, and `src/objects/note.object.ts` opens with a comment saying the same. A developer no longer finds a `note` object in their app, over REST or in an MCP client's object list, without anything telling them it came from the scaffold.
