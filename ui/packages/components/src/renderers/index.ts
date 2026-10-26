/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import './basic';
import './form';
import './layout';
import './navigation';
import './data-display';
import './feedback';
import './overlay';
import './disclosure';
import './complex';
import './action';
// Registers placeholders for the page blocks the Studio palette offers but no
// package renders yet, so they don't red-box in hosts that skip the optional
// `registerPlaceholders()` bootstrap (#2943). The rest stay opt-in.
import './placeholders';
