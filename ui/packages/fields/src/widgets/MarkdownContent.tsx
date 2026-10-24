import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { RICH_TEXT_SANITIZE_SCHEMA } from './sanitizedHtml.js';

/**
 * Heavy markdown renderer, split into its own module so it can be lazy-loaded
 * by the cell/detail renderers (react-markdown pulls in ~100-200 KB). GitHub
 * Flavored Markdown + sanitization (defense against XSS in stored content),
 * against the same schema the `html` / `richtext` pipeline uses.
 */
export default function MarkdownContent({ value }: { value: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeSanitize, RICH_TEXT_SANITIZE_SCHEMA]]}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
