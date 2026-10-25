/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import './div';
import './text';
import './span';
import './separator';
import './image';
import './icon';
// `./html` (the raw-HTML `html` node type) is retired (objectui#13449): it
// injected `schema.html` unsanitised and `@objectstack/spec` declares no such
// component. Rich HTML is a field value (`html` / `richtext`, sanitised) or a
// `kind: 'html'` page.
import './html-elements';
import './button-group';
import './pagination';
import './navigation-menu';
import './elements';
import './metadata-viewer';
import './data-list';
import './record-picker';
import './text-input';
