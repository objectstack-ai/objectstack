/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as vscode from 'vscode';

/**
 * Provides hover information for Object UI schema properties
 */
export class HoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) {
      return null;
    }

    const word = document.getText(range);

    // Get hover information based on the property/value
    const hoverInfo = this.getHoverInfo(word, document, position);

    if (hoverInfo) {
      return new vscode.Hover(hoverInfo);
    }

    return null;
  }

  /**
   * Get hover information for a word
   */
  private getHoverInfo(
    word: string,
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.MarkdownString | null {
    // Property documentation
    const propertyDocs: Record<string, string> = {
      type: `**type** (string, required)

The component type to render.

Common values:
- \`div\` - Container element
- \`text\` - Text content
- \`card\` - Card component
- \`button\` - Button
- \`input\` - Input field
- \`form\` - Form container

[View all component types](https://www.objectui.org/docs/components)`,

      className: `**className** (string)

Tailwind CSS classes for styling the component.

Example:
\`\`\`json
"className": "flex items-center gap-4 p-6 bg-white rounded-lg shadow"
\`\`\`

[Tailwind CSS Documentation](https://tailwindcss.com)`,

      children: `**children** (object | array)

Child components or content.

Can be:
- A single component object
- An array of component objects
- For text components: a string value

Example:
\`\`\`json
"children": [
  { "type": "text", "content": "Hello" },
  { "type": "button", "label": "Click me" }
]
\`\`\``,

      label: `**label** (string)

Text label for form inputs and buttons.

Example:
\`\`\`json
"label": "Email Address"
\`\`\``,

      placeholder: `**placeholder** (string)

Placeholder text for input fields.

Example:
\`\`\`json
"placeholder": "Enter your email..."
\`\`\``,

      required: `**required** (boolean)

Whether the input field is required.

Example:
\`\`\`json
"required": true
\`\`\``,

      variant: `**variant** (string)

Style variant for components.

For buttons:
- \`default\` - Primary button
- \`destructive\` - Danger/delete button
- \`outline\` - Outlined button
- \`secondary\` - Secondary button
- \`ghost\` - Transparent button
- \`link\` - Link-styled button`,

      inputType: `**inputType** (string)

HTML input type.

Common values:
- \`text\` - Text input
- \`email\` - Email input
- \`password\` - Password input
- \`number\` - Number input
- \`tel\` - Telephone input
- \`url\` - URL input
- \`date\` - Date picker`,

      title: `**title** (string)

Title text for components like cards, modals, etc.

Example:
\`\`\`json
"title": "User Settings"
\`\`\``,

      description: `**description** (string)

Description or subtitle text.

Example:
\`\`\`json
"description": "Manage your account settings"
\`\`\``,

      content: `**content** (string)

Text content for text components.

Example:
\`\`\`json
"content": "Welcome to Object UI!"
\`\`\``,
    };

    const doc = propertyDocs[word];
    if (doc) {
      return new vscode.MarkdownString(doc);
    }

    // Component type documentation
    const componentDocs: Record<string, string> = {
      div: `**div** - Container Component

A flexible container for grouping other components.

Example:
\`\`\`json
{
  "type": "div",
  "className": "flex gap-4 p-6",
  "children": [...]
}
\`\`\``,

      card: `**card** - Card Component

A card container with optional title and description.

Example:
\`\`\`json
{
  "type": "card",
  "title": "Card Title",
  "description": "Card description",
  "children": {...}
}
\`\`\``,

      button: `**button** - Button Component

An interactive button element.

Example:
\`\`\`json
{
  "type": "button",
  "label": "Click Me",
  "variant": "default"
}
\`\`\``,

      input: `**input** - Input Component

A form input field.

Example:
\`\`\`json
{
  "type": "input",
  "label": "Email",
  "inputType": "email",
  "placeholder": "your@email.com",
  "required": true
}
\`\`\``,

      text: `**text** - Text Component

Display text content.

Example:
\`\`\`json
{
  "type": "text",
  "content": "Hello World",
  "className": "text-lg font-bold"
}
\`\`\``,
    };

    const componentDoc = componentDocs[word];
    if (componentDoc) {
      return new vscode.MarkdownString(componentDoc);
    }

    return null;
  }
}
