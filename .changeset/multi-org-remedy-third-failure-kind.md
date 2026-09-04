---
"@objectstack/cli": patch
"@objectstack/verify": patch
---

fix(cli,verify): the multi-org runtime's remedy stops telling an operator to declare a package the app already declares

The three consumers that turn a failed `@objectstack/organizations` import into
operator-facing advice picked their remedy with a two-way branch, written when
`HostImportFailureKind` had exactly two members. A third one — a package the app
DECLARES, that the install DELIVERED, and whose own `exports` names no runtime
entry Node can load (a `types`-only or `browser`-only publish, or an unexported
subpath) — fell into the else leg and rendered the *declare* remedy:

- `objectstack serve`'s ADR-0093 D5 stage-1 fatal ("add the package to THIS APP
  — declare it in the app's package.json and install"),
- `bootStack({ multiTenant: true })`'s refusal ("Install/link it in THIS APP —
  and DECLARE it in that app's package.json"),
- the enterprise dogfood probe's skip reason and its `MULTI_ORG=1` throw.

Each of those three also prints the importer's own message, which words the case
correctly — so the bullet an operator reads first contradicted the diagnosis
printed underneath it, and prescribed two actions (declare it, install it) that
were already done and could not have helped: no edit to the app and no install
action changes what a package publishes.

Every branch now asks *is the declaration the problem?* rather than testing one
kind. `undeclared` keeps the declare remedy and `declared-unresolvable` keeps
the install remedy, both byte-for-byte unchanged. The third kind prescribes
nothing: it names the two things that are NOT the problem and defers to the
importer's message, which already states that the remedy lives in the package
and what the package has to publish. No fourth remedy sentence is minted — one
wording of the package-shape case, in the one place that measured it.
