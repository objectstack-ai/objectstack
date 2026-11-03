---
'@objectstack/cli': patch
---

fix(cli): a flag given without its value (`os dev -d`) now opens with the INVOCATION ERROR line

Clause-②: no
Metadata-protocol: none

`os dev -d`, `os serve --port` and `os migrate meta --from` used to exit 2 with only oclif's `Error: Flag --NAME expects a value` line. Backgrounded, that reads like a server that booted and died. The CLI now writes its one-line `objectstack: INVOCATION ERROR — … The command never ran: nothing was started and nothing is listening.` first, as it already did for an unknown flag or a refused value.

The same line now also leads three other parse failures that oclif raises the same way: a flag with an option list given without its value (`os dev --log-level`), a single-valued flag given twice (`os dev -p 1 -p 2`), and a value a flag's own parser refused (`os lint --eval-min abc`).

Nothing else changes: the same inputs are accepted and refused, the exit code is still 2, and oclif's own lines follow unchanged. A command that parsed and then failed while running gets no banner.

The banner's reason now carries oclif's whole message on one line instead of only its first line, so `os plugin keygen` reads `The following error occurred: Missing required flag out` and `os lint --eval-min abc` reads `Parsing --eval-min; Expected an integer but received: abc` where both used to name only the header.
