---
'create-objectstack': patch
---

fix(create-objectstack): a project name npm would refuse is refused before anything is written, with the rule and a suggested name

Clause-②: no
Metadata-protocol: none

`create-objectstack "My App!"` (or `MyApp`, or no argument inside a directory called `My App`) used to write that name verbatim into `package.json` and `objectstack.manifest.json`. `validate` and `build` passed, and the first refusal came from npm at `npm publish`.

The resolved project name (the argument, or the current directory's name when there is none) is now checked against npm's rules for a new package name, using `validate-npm-package-name` (the module npm itself uses), before the first file is written. A refused name exits 1 and prints npm's reasons, the rule, and a suggested name (`My App!` and `MyApp` both suggest `my-app`). The name is never rewritten for you: re-run with the suggested name or one of your own. Names npm accepts, such as `my-app` and `@scope/my-app`, scaffold as before.

`create-objectstack` gains one runtime dependency, `validate-npm-package-name`.
