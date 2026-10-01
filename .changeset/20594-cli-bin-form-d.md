---
'@objectstack/cli': patch
---

A docblock line in `@objectstack/cli`'s `bin/run.js` no longer cites a tracker number

The docblock above `bin/run.js`'s `process.stderr` `error` listener ended a
sentence with a tracker number that no longer resolves on GitHub. The number is
gone and the sentence stays: `files` names only `dist`, but npm packs a `bin`
target regardless, which is the measured fact the number was pointing at. The
file ships because of that same packing rule, which is why this is a release
note at all. Comment only: no command, flag, exit code, error code, export or
runtime behaviour changes.
