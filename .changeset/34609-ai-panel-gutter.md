---
'@object-ui/plugin-chatbot': patch
---

fix(plugin-chatbot): the docked AI panel keeps a 16px gutter on both sides

Clause-②: no
Metadata-protocol: none

The plain chat surface (`surface="plain"`, used by the console's AI page, its right-docked assistant panel and the shared-record page) dropped the side padding of its message list and composer at the `sm` VIEWPORT breakpoint, so on any desktop window the text and the input touched the edges of a ~420px dock. The gutter now follows the width the chat is given: the plain root is a Tailwind size container, and the message list and the composer keep 16px on both sides until the container reaches `@3xl` (48rem), where the centred 42rem column already has room around it. Below that width an assistant turn spans the column, so its prose, tables and cards end on the same 16px line as the composer; a wide table keeps scrolling horizontally inside its own box. At full width the layout is unchanged, and the card surface is untouched.
