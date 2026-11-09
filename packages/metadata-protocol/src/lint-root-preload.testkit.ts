// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Import this at module top in a test file whose cases make a served `view`
// read or an object publish, so the file pays the first load of the
// `@objectstack/lint` package ROOT during collection, never inside a clocked
// case. Test-only: no product module imports it.
//
// The protocol loads the lint root lazily, on first use, in two places: a
// served `view` read decorates its `_diagnostics` with the form-layout
// warnings (`loadFormLayoutLint`, metadata-diagnostics.ts), and an object
// publish runs its build probes (`runBuildProbes`, build-probes.ts). The lazy
// shape is product design: the kernel boot path never reaches the root.
// Under vitest the first such load in a file is a cold transform of the lint
// module graph, paid inside whichever case gets there first. A module-top
// import is paid during collection, which neither `testTimeout` nor
// `hookTimeout` clocks, and the protocol's later `import()` gets the same
// module instance back (AGENTS.md § Build & Test, the clocked-window rule).
//
// Here the root resolves to `lint/dist/index.js`: this package's row in
// `check:test-source-alias` lists `@objectstack/lint` as still read from
// `dist/`.
//
// Who imports it: every test file in which a traced run of the whole suite
// saw that first load inside a case. A new file whose cases reach a view read
// or an object publish imports it too. It is not a `setupFiles` entry,
// because then every test file in the package pays the load, including the
// many that never reach it: measured, that added about 200 s of worker time
// and about a third to the suite's wall time.
import '@objectstack/lint';
