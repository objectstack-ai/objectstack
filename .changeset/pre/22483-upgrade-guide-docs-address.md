---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide has a public address, one docs-site page per protocol major

Clause-②: no

The guide is published on the docs site, one page per protocol major, at `https://objectstack.ai/docs/protocol-upgrade/N`; `https://objectstack.ai/docs/protocol-upgrade` lists them all. A link to one major keeps resolving after the next major opens. The site builds from `main`, so each page says whether its major is released, in prerelease, or not released yet.

`docs/protocol-upgrade-guide.md` in the repository, which earlier READMEs and changelog entries point at, is now a short pointer naming that address.

What a release shipped is unchanged: `protocol-upgrade-guide.md` inside the package and attached to its GitHub Release. Its only change is the header comment, which now names the command that writes the file.

Nothing changes for an author, and nothing is renamed or removed.
