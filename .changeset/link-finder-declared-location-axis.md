---
'@objectstack/types': minor
---

Host importer: a `link:` / `file:` install is now verified by the LOCATION the app declared, so a correctly linked package loads instead of being refused.

The ESM fallback finder (`createHostImporter`) verifies the one directory it consults — `<hostRoot>/node_modules/<key>` — against what the host's own `package.json` declares. Until now it could only do that by NAME, and a `link:` / `file:` value promises no name, so the KEY stood in for one: a package linked exactly as the app asked, whose own manifest happens to be named something else, was refused with `declared-unresolvable` / `MODULE_NOT_FOUND`. Nothing was broken, and the only way out was to stop using a supported linking mode.

Such a declaration does name something checkable — a directory — so the finder now checks that too: `realpath(node_modules/<key>)` against `realpath(resolve(hostRoot, <declared path>))`, both sides canonicalised, compared exactly (no basename matching, no case folding). If they are the same directory, the host declared it and it loads.

This is a second verification axis, not a looser first one. A directory the app declared neither by name nor by path is refused exactly as before, and the finder stays strictly tighter than the CommonJS resolution it backs up, which asks neither question. Unchanged: a plain version range licenses no path; an `npm:` alias is still checked by name; `github:` / tarball URLs and the bare `owner/repo` shorthand name no on-disk location, so they gain nothing; a package that publishes a `require` condition never reaches this fallback at all, so no load that succeeds today changes.

Measured on pnpm 10.33: `link:` symlinks the key at the declared directory and verifies; a `file:` directory install routes through pnpm's virtual store (a copy), so it does not, and keeps today's refusal. The refusal's text now states what the location check compared instead of asserting a limit the finder no longer has.
