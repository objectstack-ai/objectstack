---
'@objectstack/cli': patch
---

fix(cli): `os datasource introspect --out` judges where the write really lands, so an in-tree symlink no longer lets the server-generated draft leave the current directory

Clause-②: no
Metadata-protocol: none

The `--out` check compared the spelled path with the current directory and then wrote through `writeFile`, which follows symlinks. A path such as `objects/lnk/x.object.ts`, with `objects/lnk` a symlink to a directory outside the project, passed the check and wrote the draft outside the tree with exit 0. The same held for an `--out` that was itself a symlink, even one pointing at a file that did not exist yet.

The command now also refuses an `--out` that is an existing symlink, and resolves symlinks in both the current directory and the nearest existing directory above the target, refusing when the second is not under the first. Both refusals print the message absolute and `../` paths already get (`--out must be a relative path within the current directory`) and exit 2. Plain relative paths inside the tree write as before, including from a current directory reached through a symlink. A missing intermediate directory is still not created; the write fails as it did.
