---
"@objectstack/mcp": patch
---

fix(mcp): pin the tool bridge's two hand-copied safety name sets in the direction the old pin could not see (#13486)

`mcp-server-runtime.ts` keeps two literal name sets — `PLATFORM_READ_ONLY_TOOL_NAMES`
and `PLATFORM_DESTRUCTIVE_TOOL_NAMES` — that `safetyAnnotations` consults to decide a
bridged tool's `readOnlyHint` / `destructiveHint` when the definition declares nothing.
Both are hand copies of `PLATFORM_TOOLS_BY_PACKAGE` (`@objectstack/spec/system`), and
the docblock claimed a sibling pin held them there.

It held them in one direction only. That pin bridges `[...PLATFORM_PROVIDED_TOOL_NAMES]`
and asserts every annotated name is in the registry, so its **iteration source is the
registry**: it sees a name added to a local set that the platform never registers. A name
**withdrawn** from `PLATFORM_TOOLS_BY_PACKAGE` while it stays in a local set is not among
the tools it bridges at all — nothing drives it, nothing is annotated, and the case stays
green over exactly the drift it is named for.

The harm in that direction is not "a tool the platform no longer registers keeps a hint".
These sets annotate **by name**, so once a name leaves the registry, a **plugin**
registering a tool of that name inherits a `readOnlyHint` it never declared — a read-only
promise the plugin may not honour, handed to it by a stale literal. That is what makes the
gap worth closing while the data is still clean.

The new pin iterates the thing that can drift — the two sets — and checks each name
against the registry, plus a coverage guard that fails if the module exports a
name-keyed safety set the pin does not cover. Reaching the sets from a test required
exporting them from `mcp-server-runtime.ts`; they are deliberately **not** re-exported
from `index.ts`, so `dist/index.d.ts` and the package's published surface are unchanged.
No runtime behaviour changes: no name was added, removed or reclassified, and all six
were re-verified present in the registry (size 30).

`worldAnnotation` is untouched on purpose. It reads `PLATFORM_PROVIDED_TOOL_NAMES`
directly, so derivation and pin share one source and a withdrawn name simply stops being
annotated — the shape that does not get this disease, kept as the contrast.
