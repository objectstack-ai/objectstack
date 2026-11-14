---
'@objectstack/plugin-security': patch
---

fix(plugin-security): an OAuth MCP client's `list_objects` resolves the person it acts for once per request, not once per object

Clause-②: no
Metadata-protocol: none

An MCP client signed in with OAuth acts on behalf of a person (ADR-0090 D10). Every object-schema read such a caller makes is the intersection of the client's grants and that person's. `list_objects` asks two questions of every object in the environment: may this caller read the object, and which of its fields. Each question re-read the person's user row, memberships, grants and positions, so one listing cost about 22 database statements per object. Measured on a real kernel, 150 objects took 4620 statements. An environment owner with about 170 objects on a remote database waited tens of seconds, close to a client's 60-second timeout.

The security service now resolves that person once per request and reuses the answer for every object, so the same listing costs 11 statements whatever the object count. `describe_object` drops from 22 statements to 11. The answers are byte for byte the same for every caller: the same objects, field counts and order. Signed-in sessions and API keys act for nobody and were not affected.

The reuse lasts only as long as the request's context and only until the next write. Revoking a grant or removing a membership retires it at once, inside the same request too. One request now judges the person's time-limited grants at one instant, its first resolution, instead of at each object, so one listing is coherent. No answer moves except one whose grant window closes inside that request.
