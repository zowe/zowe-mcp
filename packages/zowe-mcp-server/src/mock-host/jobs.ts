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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ZosErrors } from './errors.js';

/**
 * Persistent on-disk job state machine for the mock host.
 *
 * Layout:
 *   <mockDir>/jobs/<systemId>/counter.json
 *   <mockDir>/jobs/<systemId>/JOBnnnnn/meta.json
 *   <mockDir>/jobs/<systemId>/JOBnnnnn/jcl.txt
 *   <mockDir>/jobs/<systemId>/JOBnnnnn/spool/<NNN>.json
 *   <mockDir>/jobs/<systemId>/JOBnnnnn/spool/<NNN>.txt
 *
 * The state machine is deterministic: by default a submitted job transitions
 * INPUT → ACTIVE → OUTPUT within one tick and produces three spool files
 * (JESMSGLG, JESJCL, JESYSMSG) plus one per `SYSOUT=*` DD. JCL triggers like
 * `PGM=FAIL0008` and `PGM=ABEND0C7` produce realistic retcodes.
 */

export interface JobMeta {
  id: string;
  name: string;
  owner: string;
  type: string;
  class: string;
  status: 'INPUT' | 'ACTIVE' | 'OUTPUT';
  retcode?: string;
  phase: number;
  phaseName: string;
  held: boolean;
  submittedAt: string;
}

export interface SpoolMeta {
  id: number;
  ddname: string;
  stepname: string;
  procstep: string;
  dsname: string;
}

interface CounterFile {
  next: number;
}

/**
 * Default time (ms) a normally-completing job reports ACTIVE before transitioning
 * to OUTPUT, measured from `submittedAt`.
 */
const DEFAULT_JOB_ACTIVE_MS = 6000;

/**
 * How long a normally-completing job lingers in ACTIVE before OUTPUT. Override with
 * `ZOWE_MCP_MOCK_JOB_ACTIVE_MS`; set to `0` for legacy instant-OUTPUT behavior.
 * Read per call so the daemon's environment governs it.
 */
function jobActiveDurationMs(): number {
  const raw = process.env.ZOWE_MCP_MOCK_JOB_ACTIVE_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_JOB_ACTIVE_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_JOB_ACTIVE_MS;
}

/**
 * Apply the time-based lifecycle view to a stored job. A normally-completing job
 * (non-held, non-canceled, status OUTPUT) reports ACTIVE/EXECUTING with no retcode
 * until {@link jobActiveDurationMs} has elapsed since submit, then its stored
 * OUTPUT/retcode. Held and canceled jobs are returned unchanged. This makes the
 * job lifecycle observable to clients that poll getJobStatus (e.g. MCP progress
 * notifications during a submitJob wait) without any background timer — the view
 * is computed purely from `submittedAt`, so it survives daemon restarts.
 */
function withLifecycle(meta: JobMeta): JobMeta {
  if (meta.held || meta.status !== 'OUTPUT' || meta.retcode === 'CANCELED') return meta;
  const activeMs = jobActiveDurationMs();
  if (activeMs <= 0) return meta;
  const submitted = Date.parse(meta.submittedAt);
  if (!Number.isFinite(submitted) || Date.now() - submitted >= activeMs) return meta;
  return { ...meta, status: 'ACTIVE', retcode: undefined, phase: 10, phaseName: 'EXECUTING' };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export class MockJobStore {
  constructor(private readonly mockDir: string) {}

  private systemDir(systemId: string): string {
    return path.join(this.mockDir, 'jobs', systemId);
  }

  private jobDir(systemId: string, jobId: string): string {
    return path.join(this.systemDir(systemId), jobId);
  }

  private async nextId(systemId: string): Promise<string> {
    const sysDir = this.systemDir(systemId);
    await fs.mkdir(sysDir, { recursive: true });
    const counterPath = path.join(sysDir, 'counter.json');
    let current: CounterFile = { next: 1 };
    try {
      current = JSON.parse(await fs.readFile(counterPath, 'utf-8')) as CounterFile;
    } catch {
      /* first run */
    }
    const id = `JOB${String(current.next).padStart(5, '0')}`;
    current.next += 1;
    await fs.writeFile(counterPath, JSON.stringify(current));
    return id;
  }

  /**
   * Submit a job from raw JCL text. Returns the assigned job ID. The job is
   * promoted to OUTPUT immediately (deterministic mock).
   */
  async submit(systemId: string, jcl: string, owner: string): Promise<JobMeta> {
    const parsed = parseJcl(jcl);
    const jobName = parsed.jobName ?? 'UNKNOWN';
    const id = await this.nextId(systemId);
    const jobDir = this.jobDir(systemId, id);
    await fs.mkdir(path.join(jobDir, 'spool'), { recursive: true });

    const retcode =
      parsed.failRc != null
        ? `CC ${String(parsed.failRc).padStart(4, '0')}`
        : parsed.abend != null
          ? `ABEND S${parsed.abend}`
          : 'CC 0000';

    const meta: JobMeta = {
      id,
      name: jobName,
      owner: owner.toUpperCase(),
      type: 'JOB',
      class: parsed.class ?? 'A',
      status: parsed.held ? 'INPUT' : 'OUTPUT',
      retcode: parsed.held ? undefined : retcode,
      phase: parsed.held ? 0 : 30,
      phaseName: parsed.held ? 'AWAITING_HOLD' : 'OUTPUT_QUEUED',
      held: parsed.held,
      submittedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(jobDir, 'meta.json'), JSON.stringify(meta, null, 2));
    await fs.writeFile(path.join(jobDir, 'jcl.txt'), jcl);

    // Spool files
    const spool: { meta: SpoolMeta; body: string }[] = [
      {
        meta: {
          id: 1,
          ddname: 'JESMSGLG',
          stepname: 'JES2',
          procstep: '',
          dsname: `JES2.${id}.D0000001.JESMSGLG`,
        },
        body:
          `         J E S 2  J O B  L O G  --  S Y S T E M  SY1  --  N O D E  N1\n` +
          ` ${meta.submittedAt}  ---- TUESDAY, ${new Date().toDateString()} ----\n` +
          ` ${meta.submittedAt}  IRR010I  USERID ${meta.owner} IS ASSIGNED TO THIS JOB.\n` +
          ` ${meta.submittedAt}  IEF236I ALLOC. FOR ${jobName} STEP1\n` +
          ` ${meta.submittedAt}  IEF142I ${jobName} STEP1 - STEP WAS EXECUTED - COND CODE 0000\n` +
          ` ${meta.submittedAt}  IEF373I STEP/STEP1   /START ${meta.submittedAt}\n` +
          ` ${meta.submittedAt}  IEF373I JOB/${jobName} /START ${meta.submittedAt}\n` +
          ` ${meta.submittedAt}  IEF033I JOB/${jobName} /ENDED ${meta.submittedAt}\n`,
      },
      {
        meta: {
          id: 2,
          ddname: 'JESJCL',
          stepname: 'JES2',
          procstep: '',
          dsname: `JES2.${id}.D0000002.JESJCL`,
        },
        body: jcl,
      },
      {
        meta: {
          id: 3,
          ddname: 'JESYSMSG',
          stepname: 'JES2',
          procstep: '',
          dsname: `JES2.${id}.D0000003.JESYSMSG`,
        },
        body:
          ` IEF236I ALLOC. FOR ${jobName} STEP1\n` +
          ` IEF237I JES2 ALLOCATED TO SYSPRINT\n` +
          ` IEF142I ${jobName} STEP1 - STEP WAS EXECUTED - ${retcode}\n` +
          ` IEF285I   ${meta.owner}.${jobName}.JOB${id.slice(3)}.D0000003.?  SYSOUT\n`,
      },
    ];

    // SYSOUT=* spool entries
    parsed.sysoutDds.forEach((dd, idx) => {
      const sid = 4 + idx;
      spool.push({
        meta: {
          id: sid,
          ddname: dd.ddname,
          stepname: dd.stepname,
          procstep: '',
          dsname: `JES2.${id}.D000000${sid}.${dd.ddname}`,
        },
        body: `(mock output for ${dd.stepname}.${dd.ddname})\n`,
      });
    });

    for (const s of spool) {
      const sid = String(s.meta.id).padStart(3, '0');
      await fs.writeFile(
        path.join(jobDir, 'spool', `${sid}.json`),
        JSON.stringify(s.meta, null, 2)
      );
      await fs.writeFile(path.join(jobDir, 'spool', `${sid}.txt`), s.body);
    }

    return meta;
  }

  async getStatus(systemId: string, jobId: string): Promise<JobMeta> {
    const metaPath = path.join(this.jobDir(systemId, jobId), 'meta.json');
    if (!(await pathExists(metaPath))) throw ZosErrors.jobNotFound(jobId);
    return withLifecycle(JSON.parse(await fs.readFile(metaPath, 'utf-8')) as JobMeta);
  }

  async list(
    systemId: string,
    opts: { owner?: string; prefix?: string } = {}
  ): Promise<JobMeta[]> {
    const sysDir = this.systemDir(systemId);
    if (!(await pathExists(sysDir))) return [];
    const entries = await fs.readdir(sysDir);
    const out: JobMeta[] = [];
    for (const id of entries) {
      if (!id.startsWith('JOB')) continue;
      const metaPath = path.join(sysDir, id, 'meta.json');
      try {
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as JobMeta;
        if (opts.owner && meta.owner !== opts.owner.toUpperCase()) continue;
        if (opts.prefix && !meta.name.startsWith(opts.prefix.toUpperCase())) continue;
        out.push(withLifecycle(meta));
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  async listSpools(systemId: string, jobId: string): Promise<SpoolMeta[]> {
    const spoolDir = path.join(this.jobDir(systemId, jobId), 'spool');
    if (!(await pathExists(spoolDir))) throw ZosErrors.jobNotFound(jobId);
    const entries = await fs.readdir(spoolDir);
    const out: SpoolMeta[] = [];
    for (const f of entries) {
      if (!f.endsWith('.json')) continue;
      out.push(JSON.parse(await fs.readFile(path.join(spoolDir, f), 'utf-8')) as SpoolMeta);
    }
    return out.sort((a, b) => a.id - b.id);
  }

  async readSpool(systemId: string, jobId: string, spoolId: number): Promise<string> {
    const sid = String(spoolId).padStart(3, '0');
    const txtPath = path.join(this.jobDir(systemId, jobId), 'spool', `${sid}.txt`);
    if (!(await pathExists(txtPath))) throw ZosErrors.jobNotFound(`${jobId}#${spoolId}`);
    return fs.readFile(txtPath, 'utf-8');
  }

  async getJcl(systemId: string, jobId: string): Promise<string> {
    const jclPath = path.join(this.jobDir(systemId, jobId), 'jcl.txt');
    if (!(await pathExists(jclPath))) throw ZosErrors.jobNotFound(jobId);
    return fs.readFile(jclPath, 'utf-8');
  }

  async cancel(systemId: string, jobId: string): Promise<void> {
    const meta = await this.getStatus(systemId, jobId);
    meta.status = 'OUTPUT';
    meta.retcode = 'CANCELED';
    meta.phase = 30;
    meta.phaseName = 'OUTPUT_QUEUED';
    await fs.writeFile(
      path.join(this.jobDir(systemId, jobId), 'meta.json'),
      JSON.stringify(meta, null, 2)
    );
  }

  async hold(systemId: string, jobId: string): Promise<void> {
    const meta = await this.getStatus(systemId, jobId);
    meta.held = true;
    meta.phaseName = 'AWAITING_HOLD';
    await fs.writeFile(
      path.join(this.jobDir(systemId, jobId), 'meta.json'),
      JSON.stringify(meta, null, 2)
    );
  }

  async release(systemId: string, jobId: string): Promise<void> {
    const meta = await this.getStatus(systemId, jobId);
    meta.held = false;
    meta.status = 'OUTPUT';
    meta.retcode = meta.retcode ?? 'CC 0000';
    meta.phase = 30;
    meta.phaseName = 'OUTPUT_QUEUED';
    await fs.writeFile(
      path.join(this.jobDir(systemId, jobId), 'meta.json'),
      JSON.stringify(meta, null, 2)
    );
  }

  async deleteJob(systemId: string, jobId: string): Promise<void> {
    const dir = this.jobDir(systemId, jobId);
    if (!(await pathExists(dir))) throw ZosErrors.jobNotFound(jobId);
    await fs.rm(dir, { recursive: true });
  }
}

interface ParsedJcl {
  jobName?: string;
  class?: string;
  held: boolean;
  failRc?: number;
  abend?: string;
  sysoutDds: { ddname: string; stepname: string }[];
}

/**
 * Parse a JCL string just enough to drive the mock. We look at:
 *   - first `//<NAME> JOB ...` line → job name
 *   - CLASS=, MSGCLASS=, TYPRUN=HOLD on JOB card
 *   - `//STEPNAME EXEC PGM=...` lines (capture current step)
 *   - `//<DDNAME> DD SYSOUT=*` lines → driven into spool files
 *   - `PGM=FAILnnnn` → fail with CC nnnn
 *   - `PGM=ABENDxxx` → abend Sxxx
 */
function parseJcl(jcl: string): ParsedJcl {
  const out: ParsedJcl = { held: false, sysoutDds: [] };
  let currentStep = 'STEP1';
  for (const rawLine of jcl.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.startsWith('//') || line.startsWith('//*')) continue;
    const m = /^\/\/(\S+)?\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    const kind = m[2];
    const rest = m[3] ?? '';

    if (kind === 'JOB') {
      if (name && !out.jobName) out.jobName = name.slice(0, 8).toUpperCase();
      const classMatch = /CLASS=([A-Z0-9])/.exec(rest);
      if (classMatch) out.class = classMatch[1];
      if (rest.includes('TYPRUN=HOLD')) out.held = true;
      // Match CLASS=H but NOT MSGCLASS=H. Require start-of-string or non-word
      // char (or comma) before CLASS.
      if (/(^|[,\s])CLASS=H\b/.test(rest)) out.held = true;
    } else if (kind === 'EXEC') {
      if (name) currentStep = name.toUpperCase();
      const pgm = /PGM=(\S+?)(?:[,\s]|$)/.exec(rest);
      if (pgm) {
        const v = pgm[1];
        const failM = /^FAIL(\d{1,4})$/.exec(v);
        const abendM = /^ABEND(.{3})$/.exec(v);
        if (failM) out.failRc = parseInt(failM[1], 10);
        else if (abendM) out.abend = abendM[1];
      }
    } else if (kind === 'DD') {
      if (rest.includes('SYSOUT=')) {
        out.sysoutDds.push({ ddname: name || 'SYSOUT', stepname: currentStep });
      }
    }
  }
  return out;
}
