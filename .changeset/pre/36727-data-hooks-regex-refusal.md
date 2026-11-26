---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-data`'s hook reference (`references/data-hooks.md`) no longer says every regex pattern the checking engine refuses is a warning. It now says what the compile rules do: a pattern the runtime refuses too is the same `hook-body-does-not-compile` / `job-body-does-not-compile` error, and only a duplicate named capture group, a modifier group such as `(?i:a)` or a Unicode property name only the runtime knows is a warning (on a host whose Unicode tables are older than 17.0, every property name it refuses). The file stays inside its token ceiling and its line count by tightening the same paragraph: it drops the note that the finding names the hook, the `SyntaxError` and its line, and the spelled-out rename example.
