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
 * Cache invalidation and update after dataset mutations.
 * Called from dataset tools after write, create, delete, rename (not copy).
 */

import {
  buildCacheKey,
  buildScopeDsn,
  buildScopeMember,
  buildScopeSystem,
  type ResponseCache,
} from '../../zos/response-cache.js';

export type MutationType = 'write' | 'create' | 'delete' | 'rename';

export interface CacheMutationParams {
  systemId: string;
  userId: string;
  dsn: string;
  member?: string;
  newDsn?: string;
  newMember?: string;
  /** For write: full replace content (to update read cache); undefined for partial write. */
  content?: string;
  /** For write: encoding used. */
  encoding?: string;
  /** For write: new etag from backend. */
  etag?: string;
  /** For write: true if startLine or endLine was provided (partial replace). */
  partialReplace?: boolean;
}

/**
 * Applies cache invalidation or update after a successful mutation.
 * Not called for copyDataset (cache is left unchanged).
 */
export function applyCacheAfterMutation(
  cache: ResponseCache,
  mutation: MutationType,
  params: CacheMutationParams
): void {
  const { systemId, userId, dsn, member, newDsn, newMember } = params;

  switch (mutation) {
    case 'delete': {
      if (member) {
        cache.invalidateScope(buildScopeMember(systemId, dsn, member));
      }
      cache.invalidateScope(buildScopeDsn(systemId, dsn));
      cache.invalidateScope(buildScopeSystem(systemId));
      break;
    }
    case 'rename': {
      cache.invalidateScope(buildScopeDsn(systemId, dsn));
      cache.invalidateScope(buildScopeDsn(systemId, newDsn ?? dsn));
      if (member && newMember) {
        cache.invalidateScope(buildScopeMember(systemId, dsn, member));
        cache.invalidateScope(buildScopeMember(systemId, newDsn ?? dsn, newMember));
      }
      break;
    }
    case 'write': {
      if (params.partialReplace) {
        if (member) {
          cache.invalidateScope(buildScopeMember(systemId, dsn, member));
        }
        cache.invalidateScope(buildScopeDsn(systemId, dsn));
      } else if (
        params.content !== undefined &&
        params.etag !== undefined &&
        params.encoding !== undefined
      ) {
        cache.invalidateScope(buildScopeDsn(systemId, dsn));
        const readKey = buildCacheKey('readDataset', {
          systemId,
          userId,
          dsn,
          member: member ?? '',
          encoding: params.encoding,
        });
        const scopes = [buildScopeDsn(systemId, dsn)];
        if (member) {
          scopes.push(buildScopeMember(systemId, dsn, member));
        }
        cache.set(
          readKey,
          {
            text: params.content,
            etag: params.etag,
            encoding: params.encoding,
          },
          scopes
        );
      } else {
        if (member) {
          cache.invalidateScope(buildScopeMember(systemId, dsn, member));
        }
        cache.invalidateScope(buildScopeDsn(systemId, dsn));
      }
      break;
    }
    case 'create': {
      cache.invalidateScope(buildScopeSystem(systemId));
      break;
    }
  }
}
