# Object UI VSCode Extension - Design Document

## 概述 (Overview)

Object UI VSCode扩展是一个全功能的开发工具，用于提升Object UI JSON schema的开发体验。本扩展提供语法高亮、智能提示、实时预览、验证和导出等功能。

The Object UI VSCode extension is a comprehensive development tool designed to enhance the development experience for Object UI JSON schemas. It provides syntax highlighting, IntelliSense, live preview, validation, and export capabilities.

## 架构设计 (Architecture Design)

### 核心组件 (Core Components)

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode Extension                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │   Extension    │  │  Providers   │  │   Commands     │  │
│  │   Activation   │  │              │  │                │  │
│  └────────────────┘  └──────────────┘  └────────────────┘  │
│         │                   │                   │            │
│         │                   │                   │            │
│         v                   v                   v            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Language Services                        │ │
│  ├────────────────┬──────────────┬─────────────────────────┤ │
│  │  Completion    │    Hover     │      Validation         │ │
│  │  Provider      │   Provider   │       Provider          │ │
│  └────────────────┴──────────────┴─────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Preview System                           │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  - Webview Panel Manager                               │ │
│  │  - Schema Renderer (Simplified)                        │ │
│  │  - Auto-refresh on Save                                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                Utilities                                │ │
│  ├────────────────────────────────────────────────────────┤ │
│  │  - Schema Templates                                    │ │
│  │  - React Component Generator                           │ │
│  │  - Formatter                                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 1. Extension Activation (扩展激活)

**文件**: `src/extension.ts`

扩展激活时注册所有providers、commands和事件监听器。

**Activation Events**:
- `onLanguage:json` - JSON文件打开时
- `onLanguage:jsonc` - JSONC文件打开时
- `workspaceContains:**/*.objectui.json` - 工作区包含Object UI schema时
- `onCommand:*` - 命令执行时

### 2. Language Providers (语言服务提供者)

#### CompletionProvider (自动完成)

**文件**: `src/providers/CompletionProvider.ts`

提供智能的代码补全建议：

- **Component Types**: `div`, `card`, `button`, `input`, etc.
- **Properties**: 根据component type提供相关属性
- **Common Properties**: `type`, `className`, `children`, etc.
- **Trigger Characters**: `"`, `:`, ` `

**实现特点**:
- 上下文感知：根据当前编辑的组件类型提供相关建议
- 代码片段：使用VSCode的SnippetString提供模板
- 文档：每个建议都带有详细说明

#### HoverProvider (悬停提示)

**文件**: `src/providers/HoverProvider.ts`

鼠标悬停时显示属性和组件的文档：

- **Property Documentation**: 属性说明、类型、示例
- **Component Documentation**: 组件介绍、用法示例
- **Markdown格式**: 支持代码高亮和链接

#### SchemaValidator (Schema验证)

**文件**: `src/providers/SchemaValidator.ts`

实时验证Schema的正确性：

- **JSON语法验证**: 检测JSON格式错误
- **类型特定验证**: 验证inputType、variant等枚举值
- **可访问性警告**: 提示添加label等无障碍属性
- **Diagnostics Collection**: 使用VSCode诊断系统显示错误

### 3. Preview System (预览系统)

**文件**: `src/providers/PreviewProvider.ts`

提供实时预览功能：

**功能特点**:
- **Side-by-side Preview**: 侧边预览，边写边看
- **Auto-refresh**: 保存时自动刷新
- **Error Handling**: 优雅的错误显示
- **Simplified Renderer**: 内置简化的渲染器

**技术实现**:
- 使用VSCode Webview API
- 集成Tailwind CSS CDN
- 简化的JavaScript渲染逻辑（将来可替换为完整的@object-ui/react）

### 4. Commands (命令)

| Command | 功能 | 实现 |
|---------|------|------|
| `objectui.preview` | 打开预览 | 在当前列打开预览面板 |
| `objectui.previewToSide` | 侧边预览 | 在侧边打开预览面板 |
| `objectui.validate` | 验证Schema | 手动触发验证 |
| `objectui.format` | 格式化 | 格式化JSON缩进 |
| `objectui.exportToReact` | 导出React组件 | 生成React组件代码 |
| `objectui.newSchema` | 新建Schema | 从模板创建 |

### 5. Snippets (代码片段)

**文件**: `snippets/objectui.json`

提供12+个常用模式的代码片段：

- `oui-empty`: 空白模板
- `oui-form`: 表单模板
- `oui-card`: 卡片组件
- `oui-input`: 输入框
- `oui-button`: 按钮
- `oui-grid`: 网格布局
- `oui-dashboard`: 仪表板模板
- 等等...

**特点**:
- 使用VSCode snippet语法
- 支持占位符和选择项
- Tab键快速跳转

## 配置文件 (Configuration Files)

### package.json

扩展的清单文件，定义：
- 扩展元数据
- 激活事件
- 贡献点（commands、snippets、languages等）
- 配置项
- 依赖

### language-configuration.json

语言配置：
- 注释符号
- 括号匹配
- 自动闭合

### syntaxes/objectui.tmLanguage.json

TextMate语法定义：
- 关键字高亮
- 继承JSON语法

### schemas/objectui-schema.json

JSON Schema定义：
- 用于验证Object UI schemas
- 提供IntelliSense支持
- 定义所有可用属性和类型

## 构建和打包 (Build & Package)

### TypeScript配置

**文件**: `tsconfig.json`

- Target: ES2020
- Module: CommonJS (VSCode要求)
- Strict mode
- Source maps

### 构建工具

**文件**: `tsup.config.ts`

使用tsup进行构建：
- 入口: `src/extension.ts`
- 输出: CommonJS格式
- External: `vscode` (由VSCode提供)
- 打包: `@object-ui/types`, `@object-ui/core`

### 打包流程

```bash
# 1. 构建
pnpm build

# 2. 打包成.vsix
pnpm package

# 3. 安装测试
code --install-extension object-ui-*.vsix

# 4. 发布到市场
pnpm publish
```

## 功能详解 (Feature Details)

### 1. Live Preview (实时预览)

**工作流程**:
```
User edits schema → Save → FileSystemWatcher detects change 
→ Parse JSON → Validate → Generate HTML → Update Webview
```

**关键代码**:
```typescript
panel.webview.html = this.getPreviewHtml(schema, schemaText);
```

**优点**:
- 即时反馈
- 无需额外工具
- 集成在编辑器中

### 2. IntelliSense (智能提示)

**触发时机**:
- 输入 `"` 时提示属性名
- 输入 `:` 后提示值
- 输入空格时显示建议

**上下文感知**:
```typescript
const currentType = this.getCurrentType(document, position);
if (currentType === 'input') {
  // 提供input专用的属性
  suggestions.push('inputType', 'placeholder', 'required');
}
```

### 3. Schema Validation (验证)

**验证级别**:
- **Error**: JSON语法错误
- **Warning**: 无效的属性值
- **Information**: 可访问性建议

**实时验证**:
- 打开文件时验证
- 保存时验证
- 可通过配置禁用

### 4. Export to React (导出React)

**生成代码**:
```typescript
// No React import: under the automatic JSX runtime ("jsx": "react-jsx",
// what a new Vite or Next project is configured with) nothing here reads that
// identifier, so it compiles as an unused local. Add the import back only if
// this file is built with the classic "jsx": "react" transform.
import { SchemaRenderer, type SchemaRendererProps } from '@object-ui/react';
// Importing the package registers every default renderer as a side effect —
// there is no separate registration call.
import '@object-ui/components';

// Typed as the schema SchemaRenderer takes, so each "type" below stays a literal
// and the compiler checks the schema against the node types it accepts.
const schema: SchemaRendererProps['schema'] = { /* 用户的schema */ };

export default function GeneratedComponent() {
  return <SchemaRenderer schema={schema} />;
}
```

**用途**:
- 快速原型转生产代码
- 学习Object UI的React用法
- 代码生成参考

## 未来规划 (Future Plans)

### Phase 1: 增强功能
- [ ] 完整的JSON解析和位置查找
- [ ] 更智能的上下文感知补全
- [ ] 集成真正的@object-ui/react渲染器
- [ ] 支持YAML格式

### Phase 2: 高级特性
- [ ] 可视化拖拽编辑器集成
- [ ] Schema diff和版本比较
- [ ] 多文件schema引用支持
- [ ] 性能优化和缓存

### Phase 3: 生态集成
- [ ] 与Object UI CLI集成
- [ ] 与Object UI Designer联动
- [ ] 主题市场
- [ ] 组件库浏览器

## 开发指南 (Development Guide)

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/objectstack-ai/objectui.git
cd objectui/packages/vscode-extension

# 2. 安装依赖
pnpm install

# 3. 启动开发模式
pnpm dev

# 4. 在VSCode中按F5启动调试
```

### 调试技巧

1. **使用Extension Development Host**: 
   - 按F5启动新的VSCode窗口
   - 在新窗口中打开测试schema文件

2. **查看输出**:
   - Output面板 → Object UI
   - Developer Tools (Help → Toggle Developer Tools)

3. **断点调试**:
   - 在TypeScript源文件中设置断点
   - 调试器会自动映射到源代码

### 测试

```bash
# 运行测试
pnpm test

# 监听模式
pnpm test:watch
```

## 发布流程 (Release Process)

1. 更新版本号 (package.json)
2. 更新 CHANGELOG.md
3. 构建和测试
4. 创建.vsix包
5. 发布到VSCode Marketplace
6. 创建GitHub Release

## 贡献指南 (Contributing)

欢迎贡献！请遵循以下步骤：

1. Fork仓库
2. 创建feature分支
3. 提交更改
4. 创建Pull Request

详见主仓库的[CONTRIBUTING.md](../../CONTRIBUTING.md)

## 许可证 (License)

MIT License - 详见[LICENSE](../../LICENSE)

---

<div align="center">

**Built with ❤️ for the Object UI Community**

</div>
