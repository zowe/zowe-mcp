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
 * OIDC interaction UI: SAF/RACF login and consent for oidc-provider's
 * authorization-code flow.
 *
 * CSRF: every POST here is validated by `provider.interactionDetails()`, which
 * requires the interaction session cookie to match the `:uid` in the path — a
 * cross-site form post cannot supply both. Login failures re-render the form
 * with a generic message (never "no such user" vs "bad password") and count
 * against the same rate limiter as the legacy `/login` route.
 */

import express, { Router, type Request, type Response } from 'express';
import type Provider from 'oidc-provider';
import { errors, type InteractionResults } from 'oidc-provider';
import { attemptSafLogin } from '../auth-attempt.js';
import type { LoginRateLimiter } from '../rate-limit.js';
import { toSafUserid } from '../saf-userid.js';
import type { SafVerifier } from '../saf-verify.js';
import { consentPage, errorPage, loginPage, setInteractionPageHeaders } from './html.js';

function sendErrorPage(res: Response, status: number, error: string, description?: string): void {
  setInteractionPageHeaders(res);
  res.status(status).send(errorPage({ error, errorDescription: description }));
}

const noopLog = (): void => {
  /* logging disabled by default */
};

function clientIdOf(params: Record<string, unknown>): string {
  return typeof params.client_id === 'string' ? params.client_id : 'unknown client';
}

/** Human-readable client label: registered client_name when present, else the client_id. */
async function clientLabelOf(
  provider: Provider,
  params: Record<string, unknown>
): Promise<string> {
  const clientId = clientIdOf(params);
  try {
    const client = await provider.Client.find(clientId);
    return client?.clientName ?? clientId;
  } catch {
    return clientId;
  }
}

export interface InteractionRouterConfig {
  provider: Provider;
  rateLimiter: LoginRateLimiter;
  /** System name shown on the login form (the SAF verification target). */
  systemName: string;
  /** Security product label shown on the login form. */
  securityProduct: string;
  /** Purpose banner shown on the login form. */
  loginNotice: string;
  verifier: SafVerifier;
  /** Skip the consent page and grant requested scopes right after login. */
  autoConsent?: boolean;
  log?: (message: string) => void;
}

interface PromptDetails {
  missingOIDCScope?: string[];
  missingOIDCClaims?: string[];
  missingResourceScopes?: Record<string, string[]>;
}

function requestedScopes(details: PromptDetails): string[] {
  const scopes = new Set<string>(details.missingOIDCScope ?? []);
  for (const resourceScopes of Object.values(details.missingResourceScopes ?? {})) {
    for (const scope of resourceScopes) scopes.add(scope);
  }
  return [...scopes];
}

/** Creates/updates the grant for a consent prompt and returns the finish payload. */
async function buildConsentResult(
  provider: Provider,
  interaction: {
    grantId?: string;
    prompt: { details: unknown };
    params: Record<string, unknown>;
    session?: { accountId: string } | undefined;
  }
): Promise<InteractionResults> {
  const details = interaction.prompt.details as PromptDetails;
  const accountId = interaction.session?.accountId;
  const clientId = interaction.params.client_id as string;

  let grant;
  if (interaction.grantId) {
    grant = await provider.Grant.find(interaction.grantId);
  }
  grant ??= new provider.Grant({ accountId, clientId });
  if (details.missingOIDCScope) {
    grant.addOIDCScope(details.missingOIDCScope.join(' '));
  }
  if (details.missingOIDCClaims) {
    grant.addOIDCClaims(details.missingOIDCClaims);
  }
  for (const [indicator, scopes] of Object.entries(details.missingResourceScopes ?? {})) {
    grant.addResourceScope(indicator, scopes.join(' '));
  }
  const grantId = await grant.save();
  return interaction.grantId ? { consent: {} } : { consent: { grantId } };
}

export function createInteractionRouter(config: InteractionRouterConfig): Router {
  const { provider, rateLimiter } = config;
  const log = config.log ?? noopLog;
  const router = Router();
  const formParser = express.urlencoded({ extended: false, limit: '4kb' });

  const withInteraction = (
    handler: (req: Request, res: Response) => Promise<void>
  ): ((req: Request, res: Response) => Promise<void>) => {
    return async (req, res) => {
      try {
        await handler(req, res);
      } catch (err) {
        if (err instanceof errors.SessionNotFound) {
          sendErrorPage(
            res,
            400,
            'invalid_interaction',
            'This sign-in session is invalid or has expired. Retry from the application.'
          );
          return;
        }
        log(`interaction error: ${err instanceof Error ? err.message : String(err)}`);
        sendErrorPage(res, 500, 'server_error');
      }
    };
  };

  router.get(
    '/interaction/:uid',
    withInteraction(async (req, res) => {
      const interaction = await provider.interactionDetails(req, res);
      const clientId = await clientLabelOf(provider, interaction.params);

      if (interaction.prompt.name === 'login') {
        setInteractionPageHeaders(res);
        res.send(
          loginPage({
            uid: interaction.uid,
            clientId,
            systemName: config.systemName,
            securityProduct: config.securityProduct,
            notice: config.loginNotice,
          })
        );
        return;
      }

      if (interaction.prompt.name === 'consent') {
        if (config.autoConsent) {
          const result = await buildConsentResult(provider, interaction);
          await provider.interactionFinished(req, res, result, {
            mergeWithLastSubmission: true,
          });
          return;
        }
        setInteractionPageHeaders(res);
        res.send(
          consentPage({
            uid: interaction.uid,
            clientId,
            username: interaction.session?.accountId ?? 'unknown',
            scopes: requestedScopes(interaction.prompt.details),
          })
        );
        return;
      }

      setInteractionPageHeaders(res);
      res.status(501).send(errorPage({ error: `unsupported prompt: ${interaction.prompt.name}` }));
    })
  );

  router.post(
    '/interaction/:uid/login',
    formParser,
    withInteraction(async (req, res) => {
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.prompt.name !== 'login') {
        sendErrorPage(res, 400, 'invalid_request');
        return;
      }
      const clientId = await clientLabelOf(provider, interaction.params);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      const renderLoginError = (status: number, message: string): void => {
        setInteractionPageHeaders(res);
        res.status(status).send(
          loginPage({
            uid: interaction.uid,
            clientId,
            systemName: config.systemName,
            securityProduct: config.securityProduct,
            notice: config.loginNotice,
            errorMessage: message,
          })
        );
      };

      if (!username || !password) {
        renderLoginError(400, 'Enter both username and password.');
        return;
      }

      const attempt = await attemptSafLogin({
        username,
        password,
        remoteAddress: req.socket.remoteAddress,
        rateLimiter,
        verifier: config.verifier,
      });
      if (attempt.outcome === 'rate_limited') {
        res.setHeader('Retry-After', String(attempt.retryAfterSeconds));
        renderLoginError(429, 'Too many attempts. Try again later.');
        return;
      }
      if (attempt.outcome === 'invalid_credentials') {
        // Generic message — never distinguish "no such user" from "bad password".
        renderLoginError(401, 'Sign-in failed. Check your credentials and try again.');
        return;
      }
      if (attempt.outcome === 'expired_password') {
        // Only reported for a CORRECT password — safe to show, and actionable.
        renderLoginError(
          401,
          `Your password on ${config.systemName} has expired. Change it on the system ` +
            '(for example via SSH or TSO logon), then sign in again.'
        );
        return;
      }
      if (attempt.outcome === 'unavailable') {
        log(`interaction login SAF check unavailable: ${attempt.detail}`);
        renderLoginError(503, 'Sign-in is temporarily unavailable. Contact the operator.');
        return;
      }

      await provider.interactionFinished(
        req,
        res,
        // Canonical SAF userid, not the typed form: `accountId` becomes the
        // token's `sub`, which downstream consumers use as a z/OS userid.
        { login: { accountId: toSafUserid(username) } },
        { mergeWithLastSubmission: false }
      );
    })
  );

  router.post(
    '/interaction/:uid/confirm',
    formParser,
    withInteraction(async (req, res) => {
      const interaction = await provider.interactionDetails(req, res);
      if (interaction.prompt.name !== 'consent') {
        sendErrorPage(res, 400, 'invalid_request');
        return;
      }
      const result = await buildConsentResult(provider, interaction);
      await provider.interactionFinished(req, res, result, { mergeWithLastSubmission: true });
    })
  );

  router.post(
    '/interaction/:uid/abort',
    formParser,
    withInteraction(async (req, res) => {
      await provider.interactionFinished(
        req,
        res,
        {
          error: 'access_denied',
          error_description: 'End-User aborted interaction',
        },
        { mergeWithLastSubmission: false }
      );
    })
  );

  return router;
}
