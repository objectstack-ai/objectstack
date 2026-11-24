// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Errors, type Hook } from '@oclif/core';

/**
 * An unknown command ends with a pointer to the help that lists the real ones.
 *
 * Without this hook oclif answers `os environments frobnicate` with one line,
 * `command environments:frobnicate not found`, and nothing else: the id in its
 * internal colon spelling (this CLI separates topics with a space) and no way
 * forward. A wrong FLAG already ends with oclif's `See more help with --help`;
 * a wrong command name did not, at the top level or under a topic.
 *
 * The answer is unchanged in kind — a hard error, exit 2, the command never
 * runs, and no guess at what was meant (this CLI ships no not-found suggester;
 * a typo is refused, not reinterpreted). Only the words change: the id is
 * spelled the way it was typed, and the pointer names the help of the deepest
 * topic or command the typed words did reach (`os environments --help`), or
 * the root's (`os --help`) when the first word is already unknown.
 */

/** The slice of oclif's `Config` the message reads. */
export interface CommandNotFoundConfig {
  bin: string;
  topicSeparator: string;
  findTopic(id: string): unknown;
  findCommand(id: string): unknown;
}

/** The refusal's text: what was not found, then where its siblings are listed. */
export function commandNotFoundMessage(id: string, config: CommandNotFoundConfig): string {
  const separator = config.topicSeparator || ':';
  const segments = id.split(':').filter((segment) => segment !== '');
  let reached: string[] = [];
  for (let length = segments.length - 1; length > 0; length -= 1) {
    const prefix = segments.slice(0, length).join(':');
    if (config.findTopic(prefix) || config.findCommand(prefix)) {
      reached = segments.slice(0, length);
      break;
    }
  }
  const help = [config.bin, ...reached, '--help'].join(' ');
  return `command ${segments.join(separator)} not found\nSee more help with \`${help}\``;
}

const hook: Hook<'command_not_found'> = async function ({ id, config }) {
  throw new Errors.CLIError(commandNotFoundMessage(id, config), { exit: 2 });
};

export default hook;
