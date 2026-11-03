// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pay the first load of the `@objectstack/lint` package ROOT before a test
// file is collected, never inside a clocked case. Wired as `setupFiles` in
// `../vitest.config.ts`.
//
// ## Why
//
// The protocol loads the lint root lazily, on first use, in two places: a
// served `view` read decorates its `_diagnostics` with the form-layout
// warnings (`loadFormLayoutLint`, src/metadata-diagnostics.ts), and an object
// publish runs its build probes (`runBuildProbes`, src/build-probes.ts). The
// lazy shape is product design: the kernel boot path never reaches the root.
// Under vitest the first of those loads is a cold transform of the lint
// module graph, paid inside whichever case makes the file's first such read
// or publish. Here the root resolves to `lint/dist/index.js` (no alias; the
// package's row in `check:test-source-alias` lists it), and one run of the
// whole suite traced that load inside a case in 39 test files. In those
// cases it measured 714 ms p50 idle and 975 ms p50 (1241 ms max) with four
// copies on four cores, against siblings in the tens of milliseconds and the
// 5000 ms `testTimeout`.
//
// ## What it does
//
// It imports the root once, at module top. vitest runs a setup file before it
// collects the test file, and neither `testTimeout` nor `hookTimeout` clocks
// that. The setup file shares the test file's module graph, so the
// protocol's later `import()` gets this instance back.
//
// A setup file rather than a per-file import, because 39 files need it and a
// new test that first reaches a view read or an object publish needs it too,
// without knowing it. The price is that every test file in the package
// evaluates the lint root once during setup, including the files that never
// reach it.
import '@objectstack/lint';
