/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import type { CjkPlugin, PluginConfig } from "streamdown";

/**
 * Emphasis next to CJK full-width punctuation.
 *
 * CommonMark decides whether a `**` run can open or close emphasis from the
 * characters on either side, and counts full-width punctuation (book-title
 * marks, corner brackets, the full-width comma and full stop) as punctuation.
 * A CJK sentence puts no space beside the run, so a run with a CJK letter on
 * one side and full-width punctuation on the other is neither left- nor
 * right-flanking the way the writer meant it, and stays literal asterisks.
 *
 * `remark-cjk-friendly` replaces the attention tokenizer with the
 * markdown-cjk-friendly rule, which reads a CJK character beside the run the
 * way it reads the whitespace an English sentence would have there. It runs
 * before remark-gfm (streamdown's `cjk.remarkPluginsBefore` slot) so it owns
 * the emphasis tokenizer; ASCII emphasis, code spans and backslash escapes
 * keep their CommonMark meaning. The `parseOnly` entry leaves out the
 * markdown serializer half, which the chat never runs.
 */
const CJK_EMPHASIS: CjkPlugin = {
  name: "cjk",
  type: "cjk",
  remarkPlugins: [remarkCjkFriendly],
  remarkPluginsBefore: [remarkCjkFriendly],
  remarkPluginsAfter: [],
};

/** The streamdown plugins every chat markdown surface renders with. */
export const CHAT_MARKDOWN_PLUGINS: PluginConfig = { cjk: CJK_EMPHASIS };
