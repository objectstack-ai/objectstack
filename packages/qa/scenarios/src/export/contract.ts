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

/**
 * The trial package's sample data, relative to `apps/<id>/source/`: the card's
 * seed rows as stack `data:` datasets (`trial-package.ts`), which the check
 * requires (`app-sample-data`).
 */
export const SAMPLE_DATA_FILE = 'src/sample-data.json';

/** How `source/objectstack.config.ts` imports {@link SAMPLE_DATA_FILE}: the specifier, and the name it binds. */
export const SAMPLE_DATA_SPECIFIER = `./${SAMPLE_DATA_FILE}`;
export const SAMPLE_DATA_BINDING = 'gallerySampleData';

/** The package whose npm `latest` is the framework release the gallery follows. */
export const FRAMEWORK_PACKAGE = '@objectstack/cli';

/** A stable release: `MAJOR.MINOR.PATCH`, no prerelease or build suffix. */
export const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
