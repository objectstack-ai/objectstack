// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a gallery tree is made of, shared by the three sides that read it: the
 * exporter that writes it (`exporter.ts`), the refresh that versions it
 * (`refresh.ts`) and the check that guards a PR on it (`check.ts`). One
 * module, so the writer and the check cannot drift.
 *
 * It imports nothing: the published `export-gallery --check` loads it without
 * the exporter's graph (the runner, the scorer, the browser).
 */

/** The files of one exported app, relative to `apps/<id>/`. */
export const APP_LAYOUT = {
  readme: 'README.md',
  source: 'source',
  runRecord: 'run-record.json',
  scorecardJson: 'scorecard.json',
  scorecardMd: 'scorecard.md',
  transcriptJson: 'transcript.json',
  transcriptMd: 'transcript.md',
  screenshots: 'screenshots',
} as const;

/** The package whose npm `latest` is the framework release the gallery follows. */
export const FRAMEWORK_PACKAGE = '@objectstack/cli';

/** A stable release: `MAJOR.MINOR.PATCH`, no prerelease or build suffix. */
export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
