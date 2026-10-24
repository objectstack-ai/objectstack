/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE sanitizer for stored rich content in this package: the schema both
 * display pipelines in `./richTextDisplay.tsx` run through, and the HTML
 * pipeline that applies it to an `html` / `richtext` value.
 *
 * The markdown pipeline (`./MarkdownContent.tsx`) hands
 * {@link RICH_TEXT_SANITIZE_SCHEMA} to `rehype-sanitize` as a rehype plugin;
 * {@link renderSanitizedHtml} below runs the very same `rehype-sanitize`
 * transform over a parsed HTML value. One schema, one transform, two inputs —
 * there is no second allow-list in this package to fall a version behind.
 *
 * ## How an HTML value reaches the DOM
 *
 *   1. PARSE with the browser's own HTML parser (`DOMParser`, `text/html`).
 *      A parsed document has no browsing context: nothing in it runs and
 *      nothing it names is fetched, so parsing is inert. Using the platform
 *      parser also means the tree that is sanitized is the tree the browser
 *      itself would build — no second HTML parser whose reading of malformed
 *      markup can differ from the browser's.
 *   2. CONVERT the DOM nodes to hast. Attribute names become hast property
 *      names through `hastscript`, which is the vocabulary the sanitize schema
 *      is written in (`className`, `colSpan`, `ariaLabel`).
 *   3. SANITIZE with `rehype-sanitize` and {@link RICH_TEXT_SANITIZE_SCHEMA}:
 *      an allow-list of elements, attributes and URL protocols. Anything the
 *      list does not name is dropped, which is the direction a sanitizer must
 *      fail in.
 *   4. RENDER the sanitized tree as React elements (`hast-util-to-jsx-runtime`,
 *      the renderer `react-markdown` itself uses). No `dangerouslySetInnerHTML`
 *      and no second serialise-and-reparse step: the elements React creates
 *      are the sanitized tree, node for node.
 *
 * Deliberately NOT exported from the package barrel. It is the trust boundary
 * of the rich-content display renderers and of nothing else: a second caller
 * rendering stored HTML its own way is how one surface ends up a version
 * behind this one. Consume the RENDERER (`HtmlCellRenderer`).
 */

import React from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeSanitize, { defaultSchema, type Options as Schema } from 'rehype-sanitize';
import { h } from 'hastscript';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

type HastRoot = Parameters<ReturnType<typeof rehypeSanitize>>[0];
type HastChild = HastRoot['children'][number];

/**
 * Elements removed TOGETHER WITH their content.
 *
 * The schema drops every element it does not allow but, by default, keeps the
 * element's children (so an unknown wrapper still shows its text). For these
 * the children are not readable prose: a raw-text element's body is code or
 * CSS, an embed's or a foreign-content subtree's body is markup the reader was
 * never meant to see. Showing it as text would be inert but would put source
 * on screen — the defect class objectui#5498 fixed — so it goes with its tag.
 */
const STRIP_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'noembed',
  'noframes',
  'template',
  'textarea',
  'select',
  'title',
  'xmp',
  'svg',
  'math',
] as const;

/**
 * The allow-list for stored rich content: `rehype-sanitize`'s GitHub-style
 * `defaultSchema`, unchanged except that {@link STRIP_WITH_CONTENT} is
 * dropped with its content rather than unwrapped.
 *
 * What it keeps is what a rich-text document is made of: headings,
 * paragraphs, emphasis, lists, quotes, code, tables, horizontal rules, links
 * (`http`, `https`, `mailto` and the schema's other link protocols, plus
 * relative URLs) and images (`http`, `https`, relative). What it drops is
 * everything else: every `on*` attribute, `style`, `class` outside the
 * schema's few named values, any URL whose protocol is not on the list, and
 * every element not on the list. `id` / `name` values are prefixed
 * (`user-content-`) so stored content cannot shadow the host page's own ids.
 */
export const RICH_TEXT_SANITIZE_SCHEMA: Schema = {
  ...defaultSchema,
  strip: [...new Set([...(defaultSchema.strip ?? []), ...STRIP_WITH_CONTENT])],
};

const sanitizeTree = rehypeSanitize(RICH_TEXT_SANITIZE_SCHEMA);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * One DOM node as hast. Elements and text only: comments, processing
 * instructions and doctypes carry nothing a reader sees, and the schema would
 * drop them anyway. A `<template>`'s content lives in `.content`, not in
 * `childNodes`, so it never reaches the tree at all.
 */
function toHast(node: Node): HastChild | undefined {
  if (node.nodeType === TEXT_NODE) return { type: 'text', value: node.nodeValue ?? '' };
  if (node.nodeType !== ELEMENT_NODE) return undefined;
  const element = node as Element;
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  // `hastscript` maps the attribute names onto hast property names. The tag
  // name is assigned separately rather than passed to `h()`, which reads its
  // first argument as a CSS-style selector (`a.b` would become `<a class="b">`).
  const { properties } = h('div', attributes);
  return {
    type: 'element',
    tagName: element.localName,
    properties,
    children: childrenOf(element) as Extract<HastChild, { type: 'element' }>['children'],
  };
}

function childrenOf(parent: ParentNode): HastChild[] {
  const children: HastChild[] = [];
  for (const node of Array.from(parent.childNodes)) {
    const child = toHast(node);
    if (child) children.push(child);
  }
  return children;
}

/**
 * Stored HTML as sanitized React content.
 *
 * Where there is no DOM parser (a non-browser render), the value is returned
 * as a plain string: React renders it as text, so the markup shows as source
 * but nothing in it is interpreted. A browser render always takes the
 * sanitizing path.
 */
export function renderSanitizedHtml(html: string): React.ReactNode {
  if (typeof DOMParser === 'undefined') return html;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const tree = sanitizeTree({ type: 'root', children: childrenOf(parsed.body) });
  // `tableCellAlignToStyle: false` keeps a cell's `align` as the attribute
  // it was stored as, rather than rewriting it into a `style` the schema
  // would otherwise never let through.
  return toJsxRuntime(tree, { Fragment, jsx, jsxs, tableCellAlignToStyle: false });
}
