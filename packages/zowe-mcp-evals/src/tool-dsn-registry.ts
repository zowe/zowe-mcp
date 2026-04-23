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

export interface ToolDsnParams {
  dsnParam: string;
  memberParam?: string;
}

const TOOL_DSN_REGISTRY: Record<string, ToolDsnParams> = {
  readDataset: { dsnParam: 'dsn', memberParam: 'member' },
  writeDataset: { dsnParam: 'dsn', memberParam: 'member' },
  getDatasetAttributes: { dsnParam: 'dsn', memberParam: 'member' },
  searchInDataset: { dsnParam: 'dsn', memberParam: 'member' },
  copyDataset: { dsnParam: 'sourceDsn', memberParam: 'sourceMember' },
  deleteDataset: { dsnParam: 'dsn', memberParam: 'member' },
  renameDataset: { dsnParam: 'dsn', memberParam: 'member' },
  createDataset: { dsnParam: 'dsn' },
  getTempDatasetPrefix: { dsnParam: 'dsn' },
  getTempDatasetName: { dsnParam: 'dsn' },
  createTempDataset: { dsnParam: 'dsn' },
  deleteDatasetsUnderPrefix: { dsnParam: 'dsn' },
  restoreDataset: { dsnParam: 'dsn' },
  listMembers: { dsnParam: 'dsn', memberParam: 'memberPattern' },
  listDatasets: { dsnParam: 'dsnPattern' },
  submitJobFromDataset: { dsnParam: 'dsn' },
  downloadDatasetToFile: { dsnParam: 'dsn', memberParam: 'member' },
  uploadFileToDataset: { dsnParam: 'dsn', memberParam: 'member' },
};

/**
 * Look up the DSN/member parameter names for a tool. Throws if the tool
 * is not in the registry — this is intentional so new tools that accept
 * DSN params are never silently ignored when someone uses `validDsn`.
 */
export function getToolDsnParams(toolName: string): ToolDsnParams {
  const entry = TOOL_DSN_REGISTRY[toolName];
  if (!entry) {
    throw new Error(
      `validDsn is used for tool '${toolName}' but '${toolName}' is not in the DSN param registry. ` +
        `Add dsnParam (and optionally memberParam) for this tool in tool-dsn-registry.ts.`
    );
  }
  return entry;
}
