---
"@objectstack/cli": minor
---

**BREAKING** `os lint --generator` now refuses to run without `--eval`, instead of accepting the flag and ignoring it.

The flag's own description has always ended "Requires --eval.", and nothing checked it. `--generator` is read only by eval mode, so outside `--eval` the flag reached no code at all: `os lint --generator ./gen.mjs` linted the current project, exited 0 with "All checks passed", never loaded the module, and named the flag nowhere on either the human face or `--json`. A path that did not exist was accepted just as readily. Someone who meant to score a live generator got a successful-looking run whose generator was never called, with nothing said.

The refusal is this command's own, not the argument parser's, so it keeps the shape the command's other failures already have: the reason on `error`, exit 1, and on `--json` a single JSON document with stdout still reserved for the machine. No error code is invented for it.

A scripted invocation that passed `--generator` outside eval mode now exits 1 with the reason, where it previously exited 0 having silently skipped the generator. Eval mode itself is untouched: `--eval --generator` still loads the module and scores live output, and `--eval` alone still scores the bundled corpus offline.

<!-- adr-0087: not-required (no-migration-prescription) The change narrows what a CLI flag combination accepts at invocation time. No metadata surface, stored row or spec declaration is touched, so `objectstack migrate meta` has nothing to carry and the ledger has nothing to record. -->
