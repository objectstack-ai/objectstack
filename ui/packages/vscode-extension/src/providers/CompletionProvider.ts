/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as vscode from 'vscode';

/**
 * Provides IntelliSense and auto-completion for Object UI schemas
 */
export class CompletionProvider
  implements vscode.CompletionItemProvider
{
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    const linePrefix = document
      .lineAt(position)
      .text.substring(0, position.character);

    // Get completion items based on context
    const items: vscode.CompletionItem[] = [];

    // Add type completions
    if (linePrefix.includes('"type"')) {
      items.push(...this.getTypeCompletions());
    }

    // Add property completions based on type
    const currentType = this.getCurrentType(document, position);
    if (currentType) {
      items.push(...this.getPropertyCompletions(currentType));
    }

    // Add common properties
    items.push(...this.getCommonPropertyCompletions());

    return items;
  }

  /**
   * Get type completions
   */
  private getTypeCompletions(): vscode.CompletionItem[] {
    const types = [
      { name: 'div', desc: 'Container element' },
      { name: 'text', desc: 'Text content' },
      { name: 'card', desc: 'Card component' },
      { name: 'button', desc: 'Button component' },
      { name: 'input', desc: 'Input field' },
      { name: 'textarea', desc: 'Textarea field' },
      { name: 'select', desc: 'Select dropdown' },
      { name: 'checkbox', desc: 'Checkbox input' },
      { name: 'radio', desc: 'Radio input' },
      { name: 'separator', desc: 'Horizontal separator' },
      { name: 'badge', desc: 'Badge component' },
      { name: 'alert', desc: 'Alert component' },
      { name: 'tabs', desc: 'Tabs component' },
      { name: 'accordion', desc: 'Accordion component' },
    ];

    return types.map((type) => {
      const item = new vscode.CompletionItem(
        type.name,
        vscode.CompletionItemKind.Value
      );
      item.detail = type.desc;
      item.documentation = new vscode.MarkdownString(
        `Object UI component type: **${type.name}**\n\n${type.desc}`
      );
      return item;
    });
  }

  /**
   * Get property completions based on type
   */
  private getPropertyCompletions(type: string): vscode.CompletionItem[] {
    const properties: Record<string, Array<{ name: string; desc: string }>> = {
      input: [
        { name: 'label', desc: 'Input label' },
        { name: 'placeholder', desc: 'Placeholder text' },
        { name: 'inputType', desc: 'Input type (text, email, etc.)' },
        { name: 'required', desc: 'Whether input is required' },
        { name: 'disabled', desc: 'Whether input is disabled' },
      ],
      textarea: [
        { name: 'label', desc: 'Textarea label' },
        { name: 'placeholder', desc: 'Placeholder text' },
        { name: 'rows', desc: 'Number of rows' },
        { name: 'required', desc: 'Whether textarea is required' },
      ],
      button: [
        { name: 'label', desc: 'Button text' },
        { name: 'variant', desc: 'Button variant (default, outline, etc.)' },
        { name: 'size', desc: 'Button size (sm, default, lg)' },
        { name: 'disabled', desc: 'Whether button is disabled' },
      ],
      card: [
        { name: 'title', desc: 'Card title' },
        { name: 'description', desc: 'Card description' },
        { name: 'children', desc: 'Card content' },
      ],
      text: [{ name: 'content', desc: 'Text content' }],
    };

    const props = properties[type] || [];

    return props.map((prop) => {
      const item = new vscode.CompletionItem(
        prop.name,
        vscode.CompletionItemKind.Property
      );
      item.detail = prop.desc;
      item.insertText = new vscode.SnippetString(`"${prop.name}": "$1"`);
      return item;
    });
  }

  /**
   * Get common property completions
   */
  private getCommonPropertyCompletions(): vscode.CompletionItem[] {
    const common = [
      { name: 'type', desc: 'Component type' },
      { name: 'className', desc: 'Tailwind CSS classes' },
      { name: 'children', desc: 'Child components or content' },
      { name: 'id', desc: 'Component ID' },
      { name: 'visible', desc: 'Visibility condition' },
    ];

    return common.map((prop) => {
      const item = new vscode.CompletionItem(
        prop.name,
        vscode.CompletionItemKind.Property
      );
      item.detail = prop.desc;

      if (prop.name === 'children') {
        item.insertText = new vscode.SnippetString('"children": {\n  $0\n}');
      } else if (prop.name === 'className') {
        item.insertText = new vscode.SnippetString('"className": "$1"');
      } else {
        item.insertText = new vscode.SnippetString(`"${prop.name}": "$1"`);
      }

      return item;
    });
  }

  /**
   * Get current type from document context
   * Note: This is a simplified implementation. For production use,
   * consider using a proper JSON parser or AST for accurate context detection.
   */
  private getCurrentType(
    document: vscode.TextDocument,
    position: vscode.Position
  ): string | null {
    try {
      const text = document.getText();
      const offset = document.offsetAt(position);
      
      // Look backwards for the nearest "type" property
      const before = text.substring(Math.max(0, offset - 500), offset);
      
      // Find all type declarations in the context
      const typeMatches = Array.from(before.matchAll(/"type"\s*:\s*"(\w+)"/g));
      
      // Return the most recent one
      if (typeMatches.length > 0) {
        return typeMatches[typeMatches.length - 1][1];
      }
    } catch (error) {
      // Fail silently - just won't provide context-specific completions
      console.error('Error detecting current type:', error);
    }
    
    return null;
  }
}
