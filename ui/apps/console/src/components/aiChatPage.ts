// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page AI chat, as the ONE module the console loads it through
 * (objectui#13410).
 *
 * `App.tsx` reaches `DefaultAiChatPage` through `import('./aiChatPage')`
 * behind a `lazy()` boundary, so the page and the `@object-ui/plugin-chatbot`
 * chat UI only it reaches leave the eager closure every console page load
 * pays for. The mechanism, and why this is a console-local module rather than
 * an `import()` of `@object-ui/app-shell`, is written once on
 * `./studioBuilder`; ⛔ not restated here.
 *
 * ⛔ A static `import ... from './aiChatPage'` anywhere in the console makes
 * that `import()` ineffective again, and the chat UI rejoins every first load.
 */

export { DefaultAiChatPage } from '@object-ui/app-shell';
