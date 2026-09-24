---
'@objectstack/console': patch
---

The prebuilt Console dist now ships `dist/sdui.manifest.json`: the ADR-0080 public-tier
component manifest of the objectui registry at the pinned commit.

It is the same file the framework repository tracks at its root and gates on every pull
request. `scripts/build-console.sh` copies it in, and one producer writes it:
`scripts/gen-sdui-manifest-node.mjs`, which reads objectui's built tree at the pin. No
earlier published `@objectstack/console` carried this file. The RC cut used to write a
browser-dumped copy into `dist/`, but the release build replaced `dist/` before packing, so
none reached a tarball (17.0.0, 17.3.0 and 17.4.0 each list 0 matches). That browser dump is
retired. It was byte-identical to the tracked file over the same built tree.

For now the file is only present in the tarball. This package's `exports` map exposes
`./package.json` and nothing else, so resolving `@objectstack/console/dist/sdui.manifest.json`
through `exports` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Anything that resolves through
`exports` cannot read the file yet. That includes the CLI's JSX-page manifest fallback, which
catches the error and keeps parse-level validation, as before.
