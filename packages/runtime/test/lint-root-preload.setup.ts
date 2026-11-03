// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pay the first load of the `@objectstack/lint` package ROOT before a test
// file is collected, never inside a clocked case. Wired as `setupFiles` in
// both projects of `../vitest.config.ts`.
//
// ## Why
//
// `@objectstack/metadata-protocol` loads the lint root lazily, on first use,
// in two places: a served `view` read decorates its `_diagnostics` with the
// form-layout warnings (`loadFormLayoutLint`, metadata-diagnostics.ts), and an
// object publish runs its build probes (`runBuildProbes`, build-probes.ts).
// The lazy shape is product design: the kernel boot path never reaches the
// root. Under vitest the first of those loads is a cold transform of the lint
// module graph, paid inside whichever case makes the file's first such read
// or publish. One run of the whole suite traced that load inside a case in 9
// test files of this package. Here the root resolves through the anchored
// `^@objectstack/lint$` alias to lint's source, which costs less than the
// built bundle the two sibling packages load, but it still lands in the case.
//
// ## What it does
//
// It imports the root once, at module top. vitest runs a setup file before it
// collects the test file, and neither `testTimeout` nor `hookTimeout` clocks
// that. The setup file shares the test file's module graph, so the
// protocol's later `import()` gets this instance back.
//
// A setup file rather than a per-file import, because 9 files need it and a
// new test that first reaches a view read or an object publish needs it too,
// without knowing it. `meta-write-org-scope.test.ts` keeps its own module-top
// import, which now finds the module already loaded. The price is that every
// test file in the package evaluates the lint root once during setup,
// including the files that never reach it.
import '@objectstack/lint';
