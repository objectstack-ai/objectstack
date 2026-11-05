// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import Compile from './compile.js';

export default class Build extends Compile {
  static override description = 'Compile ObjectStack configuration to JSON artifact (alias for compile)';

  /** `os build` is what a deployment runs, so it says what the artifact leaves behind. */
  protected override reportsLocalCustomizations = true;
}
