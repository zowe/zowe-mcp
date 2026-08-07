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
 * Pre/post checks around deploying the zowex z/OS server binary (see
 * ZSshUtils.installServer in @zowe/zowex-for-zowe-sdk).
 *
 * On z/OS, zFS filesystems can auto-grow, so a free-space stat (`df`) does not
 * reliably predict whether an upload will fit — the filesystem may report low
 * free space yet still satisfy the write by growing, or vice versa hit a quota
 * a stat never revealed. The only trustworthy check is to actually write data
 * of the size we're about to deploy and see whether the filesystem can commit
 * it. Without this, a truncated upload/extraction can succeed silently and
 * only fail much later as a cryptic z/OS abend (SE06 / IEW4006I "MODULE HAS
 * BEEN TRUNCATED") when something finally tries to run zowex.
 */

import { ZSshClient, ZSshUtils, type SshSession } from '@zowe/zowex-for-zowe-sdk';
import { NodeSSH, type Config as NodeSshConfig } from 'node-ssh';

/**
 * Conservative estimate of peak space needed during a zowex deploy: the
 * compressed pax archive and its extracted binary coexist briefly (the
 * archive is only removed after extraction succeeds), plus headroom for the
 * checksums file and files the running server writes later (tmp dir, CEEDUMPs).
 */
export const DEPLOY_SPACE_PROBE_BYTES = 64 * 1024 * 1024; // 64 MiB

const PROBE_FILE_NAME = '.zowe-mcp-deploy-space-probe';

/**
 * Delay between writing the probe file and reading it back, to let a compressed zFS
 * aggregate's lazy/asynchronous space accounting settle before we trust the result.
 * Measured against a real z/OS zFS aggregate: reported free space was still dropping
 * ~3 seconds after a `dd` write had already returned success, meaning the write syscall
 * completing does not mean the data was actually committed to physical (compressed)
 * storage yet — a probe that deletes the file immediately could miss a real ENOSPC that
 * only surfaces during that lazy flush.
 */
const PROBE_SETTLE_DELAY_SECONDS = 3;

/**
 * Matches z/OS "module load failed because the file was truncated" signatures (SE06 abend,
 * shown on the console as completion code E06 / "ABENDE06", with IEW4006I/CSV034I diagnostics).
 */
export function isZowexTruncatedModuleError(text: string): boolean {
  return (
    /\bSE06\b/i.test(text) ||
    /\bABENDE06\b/i.test(text) ||
    /COMPLETION CODE[=\s]*E06\b/i.test(text) ||
    text.includes('IEW4006I') ||
    text.includes('CSV034I') ||
    /module has been truncated/i.test(text) ||
    text.includes('26110035')
  );
}

async function withRawSsh<T>(session: SshSession, fn: (ssh: NodeSSH) => Promise<T>): Promise<T> {
  const ssh = new NodeSSH();
  // buildSshConfig's privateKey is always read as a utf-8 string (never a Buffer); the ssh2
  // ConnectConfig type it returns just allows both, which node-ssh's own Config type doesn't.
  await ssh.connect(ZSshUtils.buildSshConfig(session) as NodeSshConfig);
  try {
    return await fn(ssh);
  } finally {
    ssh.dispose();
  }
}

/**
 * Verifies the deploy directory can actually hold `sizeBytes` of real data by writing
 * (and removing) a probe file of that size — rather than trusting `df` free-space numbers
 * that zFS auto-grow can make meaningless. Throws if the write fails (e.g. the filesystem
 * hit a quota or auto-grow limit), so callers can fail fast instead of attempting a real
 * upload that would only be discovered truncated much later.
 *
 * Three things confirmed against a real z/OS zFS aggregate, not just simulated: (1) USS `dd`
 * rejects unit suffixes on `bs=` (`bs=1m` errors with "badly formed number" — byte counts
 * only); (2) on a *compressed* aggregate, all-zero data from `/dev/zero` compresses away to
 * almost nothing, so it would pass this probe even when there's no room for the real
 * (incompressible) pax archive/binary — `/dev/urandom` is used instead so the probe's space
 * consumption is representative; (3) space accounting can be lazy/asynchronous, so after the
 * write we wait `PROBE_SETTLE_DELAY_SECONDS` and read the probe file back before declaring
 * success — a write whose data never actually got committed (e.g. a deferred ENOSPC during
 * background compression) should fail on that read-back rather than passing silently.
 */
export async function probeDeploySpace(
  session: SshSession,
  remoteServerPath: string,
  sizeBytes: number = DEPLOY_SPACE_PROBE_BYTES
): Promise<void> {
  const remoteDir = remoteServerPath.replace(/^~/, '.');
  const probePath = `${remoteDir}/${PROBE_FILE_NAME}`;
  const blockCountMiB = Math.ceil(sizeBytes / (1024 * 1024));
  await withRawSsh(session, async ssh => {
    const result = await ssh.execCommand(
      `mkdir -p ${remoteDir} && ` +
        `dd if=/dev/urandom of=${probePath} bs=1048576 count=${blockCountMiB} 2>&1 && ` +
        `sleep ${PROBE_SETTLE_DELAY_SECONDS} && ` +
        `dd if=${probePath} of=/dev/null bs=1048576 2>&1; ` +
        `rc=$?; rm -f ${probePath}; exit $rc`
    );
    if (result.code !== 0) {
      throw new Error(
        `Not enough space to deploy the Zowe Remote SSH server to ${remoteServerPath}: writing a ` +
          `${blockCountMiB}MB probe file failed (RC=${String(result.code)}). ` +
          `${result.stdout || result.stderr}`.trim() +
          ' Free up space in this directory (or its zFS filesystem) and try again.'
      );
    }
  });
}

/**
 * Smoke-tests the just-deployed zowex binary by running it with `-v`. A successful `pax`
 * extraction return code does not guarantee the resulting binary is loadable — a filesystem
 * that ran out of real space mid-write can still report success. Running the binary is the
 * only way to confirm it isn't a truncated program object (which fails at load time with an
 * SE06 abend instead of a normal non-zero exit).
 */
export async function verifyZowexBinary(
  session: SshSession,
  remoteServerPath: string
): Promise<void> {
  const remoteDir = remoteServerPath.replace(/^~/, '.');
  const binPath = `${remoteDir}/${ZSshClient.BIN_NAME}`;
  await withRawSsh(session, async ssh => {
    const result = await ssh.execCommand(`${binPath} -v`);
    const combined = `${result.stdout} ${result.stderr}`;
    if (result.code !== 0 || isZowexTruncatedModuleError(combined)) {
      throw new Error(
        `The Zowe Remote SSH server binary at ${remoteServerPath} did not start after deploy ` +
          `(RC=${String(result.code)}): ${combined.trim()}`
      );
    }
  });
}
