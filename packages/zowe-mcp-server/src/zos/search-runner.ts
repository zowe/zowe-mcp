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
 * Search runner: implements search using only listMembers and readDataset.
 * Backend-agnostic; used by both Native and Mock backends until ZNP tool.search is available.
 */

import type { Logger } from '../log.js';
import type {
  MemberEntry,
  ReadDatasetResult,
  SearchInDatasetOptions,
  SearchInDatasetResult,
  SearchInDatasetSummary,
  SearchMatchEntry,
  SearchMemberResult,
} from './backend.js';
import type { SystemId } from './system.js';

/**
 * Minimal backend interface for the search runner (listMembers + readDataset).
 * Allows callers that already hold a connection (e.g. NativeBackend inside withNativeClient)
 * to run search without re-acquiring the connection lock.
 */
export interface SearchBackendAdapter {
  listMembers(systemId: SystemId, dsn: string): Promise<MemberEntry[]>;
  readDataset(
    systemId: SystemId,
    dsn: string,
    member?: string,
    encoding?: string
  ): Promise<ReadDatasetResult>;
}

/** Whether to search case-sensitively (from parms: no ANYC = case-sensitive). */
function isCaseSensitive(parms: string): boolean {
  const upper = parms.toUpperCase();
  return !upper.includes('ANYC');
}

/** Whether to restrict search to COBOL area columns 7-72 (from parms). */
function isCobolColumns(parms: string): boolean {
  return parms.toUpperCase().includes('COBOL');
}

/**
 * Search text for lines containing the search string.
 * Honors case sensitivity and optional COBOL column restriction (cols 7-72, 1-based).
 */
function grepLines(text: string, searchString: string, parms: string): SearchMatchEntry[] {
  const caseSensitive = isCaseSensitive(parms);
  const cobol = isCobolColumns(parms);
  const needle = caseSensitive ? searchString : searchString.toLowerCase();
  const lines = text.split(/\r?\n/);
  const matches: SearchMatchEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let searchable = line;
    if (cobol && line.length > 0) {
      // COBOL: search only in columns 7-72 (0-based 6 to 71)
      searchable = line.length <= 6 ? '' : line.slice(6, 72);
    }
    const haystack = caseSensitive ? searchable : searchable.toLowerCase();
    if (haystack.includes(needle)) {
      matches.push({
        lineNumber: i + 1,
        content: line,
      });
    }
  }
  return matches;
}

/**
 * Run search using backend listMembers and readDataset.
 * For PDS: list members (optionally filter to one), read each, grep. For sequential: read once, grep.
 *
 * @param logger - Optional logger; when provided, logs what is searched, which dataset/members are read, and summary.
 */
export async function runSearchWithListAndRead(
  backend: SearchBackendAdapter,
  systemId: SystemId,
  dsn: string,
  options: SearchInDatasetOptions,
  logger?: Logger
): Promise<SearchInDatasetResult> {
  const { string: searchString, member: filterMember, parms, encoding } = options;
  let members: SearchMemberResult[] = [];
  let linesProcessed = 0;
  let membersWithLines = 0;
  let membersWithoutLines = 0;

  const log = logger?.child('search');

  if (log) {
    log.info('Search started', {
      systemId,
      dsn,
      string: searchString,
      member: filterMember ?? '(all)',
      parms: parms || '(default)',
      encoding: encoding,
    });
  }

  let memberList: { name: string }[];

  try {
    memberList = await backend.listMembers(systemId, dsn);
  } catch {
    // listMembers failed (e.g. sequential dataset or not found) — treat as sequential
    if (log) {
      log.debug('Treating as sequential dataset (listMembers failed or not a PDS)', { dsn });
    }
    try {
      if (log) {
        log.debug('Reading sequential dataset for search', { dsn, encoding: encoding });
      }
      const result = await backend.readDataset(systemId, dsn, undefined, encoding);
      const matchList = grepLines(result.text, searchString, parms);
      linesProcessed = result.text.split(/\r?\n/).length;
      members = [
        {
          name: '',
          matches: matchList,
        },
      ];
      membersWithLines = matchList.length > 0 ? 1 : 0;
      membersWithoutLines = matchList.length > 0 ? 0 : 1;
      if (log) {
        log.info('Sequential search complete', {
          dsn,
          linesProcessed,
          linesFound: matchList.length,
        });
      }
    } catch (err) {
      throw err;
    }

    const linesFound = members.reduce((sum, m) => sum + m.matches.length, 0);
    const summary: SearchInDatasetSummary = {
      linesFound,
      linesProcessed,
      membersWithLines,
      membersWithoutLines,
      searchPattern: searchString,
      processOptions: parms,
    };
    return { dataset: dsn, members, summary };
  }

  // PDS: filter to one member if requested
  let toSearch = memberList.map(m => m.name);
  if (filterMember !== undefined && filterMember !== '') {
    const want = filterMember.toUpperCase();
    if (!toSearch.some(m => m === want)) {
      if (log) {
        log.warning('Requested member not found in PDS', { dsn, member: want });
      }
      return {
        dataset: dsn,
        members: [],
        summary: {
          linesFound: 0,
          linesProcessed: 0,
          membersWithLines: 0,
          membersWithoutLines: 1,
          searchPattern: searchString,
          processOptions: parms,
        },
      };
    }
    toSearch = [want];
  }

  if (log) {
    log.info('Searching PDS members', {
      dsn,
      memberCount: toSearch.length,
      members: toSearch.slice(0, 20),
      ...(toSearch.length > 20 ? { _truncated: `${toSearch.length - 20} more` } : {}),
    });
  }

  const MAX_PREVIEW_LINES = 5;
  const MAX_PREVIEW_LEN = 80;

  for (const mem of toSearch) {
    try {
      if (log) {
        log.info('Reading member', { dsn, member: mem, encoding: encoding });
      }
      const result = await backend.readDataset(systemId, dsn, mem, encoding);
      const lines = result.text.split(/\r?\n/);
      const lineCount = lines.length;
      linesProcessed += lineCount;
      if (log) {
        const contentStart = lines
          .slice(0, MAX_PREVIEW_LINES)
          .map(l => (l.length > MAX_PREVIEW_LEN ? l.slice(0, MAX_PREVIEW_LEN) + '…' : l));
        log.info('Member read', {
          dsn,
          member: mem,
          encoding,
          lineCount,
          contentStart,
        });
      }
      const matchList = grepLines(result.text, searchString, parms);
      if (matchList.length > 0) {
        membersWithLines++;
        members.push({ name: mem, matches: matchList });
        if (log) {
          log.debug('Member has matches', { dsn, member: mem, matchCount: matchList.length });
        }
      } else {
        membersWithoutLines++;
        if (log) {
          log.debug('Member has no matches', { dsn, member: mem });
        }
      }
    } catch {
      membersWithoutLines++;
      if (log) {
        log.debug('Failed to read member (skipped)', { dsn, member: mem });
      }
    }
  }

  const linesFound = members.reduce((sum, m) => sum + m.matches.length, 0);
  if (log) {
    log.info('Search complete', {
      dsn,
      linesProcessed,
      linesFound,
      membersWithLines,
      membersWithoutLines,
    });
  }
  const summary: SearchInDatasetSummary = {
    linesFound,
    linesProcessed,
    membersWithLines,
    membersWithoutLines,
    searchPattern: searchString,
    processOptions: parms,
  };
  return { dataset: dsn, members, summary };
}
