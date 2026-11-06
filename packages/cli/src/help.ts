// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Help } from '@oclif/core';
import { formatEverydayCommands } from './utils/next-steps.js';

/**
 * The CLI's help class (`oclif.helpClass` in package.json): oclif's own, with
 * the few everyday commands listed first on the root page — what bare `os`
 * and `os --help` print — ahead of the full alphabetical listing of every
 * topic and command. Topic and command pages are unchanged.
 *
 * The list itself lives in `utils/next-steps.ts`, beside the post-build hint,
 * so the two places that tell a developer what to run next read one source.
 */
export default class ObjectStackHelp extends Help {
  override formatRoot(): string {
    return `${super.formatRoot()}\n\n${formatEverydayCommands(this.config.bin)}`;
  }
}
