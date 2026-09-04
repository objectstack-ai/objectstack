---
"@objectstack/types": patch
---

fix(types): an aliased install (`"foo": "npm:bar@1"`) is now found by the host importer's ESM-only fallback

`createHostImporter`'s #14041 fallback finder verifies the one directory it
consults — `<hostRoot>/node_modules/<key>` — by matching that directory's
`package.json` `name` against the declared package name. An aliased install
fails that check by construction: `{ "dependencies": { "foo": "npm:bar@1" } }`
puts a manifest named `bar` at `node_modules/foo`. The finder answered
`absent`, and an ESM-only aliased package therefore kept the pre-#14041 INSTALL
wording — a confidently-wrong remedy sending an operator to run `pnpm install`
against an install that is already correct, on a declaration shape
`packageNameFromSpecifier`'s own documentation blesses.

The declaration is now parsed for the name it promises: `npm:bar@1`,
`npm:@acme/x@^2` and the aliased `workspace:bar@*` name the package installed
under the key, so that is the manifest name the finder expects there. An
aliased ESM-only package is rescued exactly as a plain one is, and an aliased
install publishing nothing loadable gets the message about the PACKAGE's own
shape instead of the INSTALL message.

⚠️ The manifest-name check itself is NOT loosened — that check is what keeps
the fallback strictly tighter than the CJS resolution it backs up (#4719's
declaration gate, from the fallback side). What moved is the EXPECTATION, still
authored by the host and still read out of the host's own `package.json`: an
alias naming one package refuses a directory holding another, a non-aliased
declaration is unchanged, and a value that is not a bare package name — a
`workspace:` range, an alias carrying a subpath — yields no expectation to move
to, so the key stays and today's refusal is kept. `link:` and `file:` name a
LOCATION rather than a package, so no name is derivable from them at all; they
keep the key expectation, and with it the conservative direction the finder had
before.
