/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

/**
 * `markdown-table-prettify` ships no type declarations (it's a VS Code
 * extension's CLI package repurposed as a library). This is a minimal
 * ambient declaration covering only the surface used by generate-docs.ts.
 */
declare module 'markdown-table-prettify' {
  export class CliPrettify {
    static prettify(text: string): string;
  }
}
