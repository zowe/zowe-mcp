# Use cases for Zowe MCP

These use cases focus on **combinations of tools** and the **LLM working with tool output** (reasoning, summarizing, comparing, recommending) rather than single tool calls.

That is more powerful than "natural language → one tool call" because:

- **Multi-step workflows:** The user states a goal (e.g. "why did this job fail?"); the LLM plans a sequence (status → spool → search for errors → maybe read JCL), runs it, and only then answers. One question yields many coordinated calls and a single, coherent answer.
- **Interpretation, not just retrieval:** Raw tool output (JES listings, compiler messages, search hits) is turned into explanations, next steps, and recommendations. The value is in the reasoning over the data, not just fetching it.
- **Adaptation:** The LLM can branch (e.g. if the job failed, fetch spool; if it’s a compile error, read the listing and suggest a fix) and iterate (e.g. fix code, resubmit, re-check) instead of the user issuing each command manually.
- **Context assembly:** The assistant can pull from several tools (datasets, members, jobs, USS) and combine them into one narrative or decision (e.g. "everything you need to work on payroll" or "here’s what’s running and what’s stuck"), which would otherwise require many separate, user-driven tool invocations.

## Top 3 for developers

1. **AI-assisted mainframe development (§1)** — Browse, search, read, and open artifacts in natural language; get explanations and open in editor. Day-to-day coding workflow.
2. **Code and flow understanding (§3)** — "Explain this program" or "how does this batch flow work?" Get summaries, data flow, and where to look next.
3. **Generating code with validation (§5)** — Generate or change code, compile, fix errors, run, and verify results. Full develop–validate–fix loop.

## Top 3 for system programmers

1. **Job failure diagnostics (§2)** — "Why did this job fail?" Get status, spool, error/ABEND explanation, and suggested next steps. Core operations.
2. **Operational picture (§7)** — "What’s running and what’s stuck?" Jobs by status, long-running or abnormal jobs, quick health view.
3. **Mainframe actions (§8)** — Choose TSO, USS, or batch for a task; use search or AGENTS.md; run and summarize. Flexible admin and one-off operations.

---

The following are ordered by **general value** (broad applicability and impact).

---

## 1. AI-assisted mainframe development

**User goal:** Use natural language to browse, search, read, and open mainframe artifacts while developing.

**Tool combo:** `listDatasets`, `listMembers`, `searchInDataset`, `readDataset` (with pagination where needed). When Zowe Explorer is installed: `openDatasetInEditor`, `openUssFileInEditor`, `openJobInEditor`.

**LLM’s job:**

- **Browse and search:** "Find all references to PARM in this library" → list/search datasets and members, return focused results and explain what was found.
- **Read and explain:** "Show me the JCL for job X" or "What does this COBOL program do?" → read content and explain in plain language.
- **Open in editor:** Open data sets, USS files, or job output in the editor so the user can edit with full IDE support.

---

## 2. "Why did this job fail?" (Diagnostics)

**User goal:** Understand why a job failed and what to fix.

**Tool combo:** `getJobStatus` → `listJobFiles` / `getJobOutput` or `readJobFile` → often `searchJobOutput` for ABEND/error text → optionally `readDataset` (e.g. JCL or source of the failing program).

**LLM’s job:** Read status and spool, find error/ABEND lines, explain the failure in plain language (e.g. S0C7 = data exception), point to the step/program, and suggest next steps (check file, fix data, rerun). Optionally pull in JCL or source and tie the error to a specific line or DD.

---

## 3. "Explain this program / flow" (Code and flow understanding)

**User goal:** Understand what a program does or how a batch flow works.

**Tool combo:** `readDataset` (member or sequential) → possibly `listMembers` (same or related PDS) → `searchInDataset` (e.g. COPYs, CALLs, DDs) → maybe `getJcl` for the job that runs it.

**LLM’s job:** Summarize control flow, data flow, and purpose; explain paragraphs/sections; note files and programs used; optionally compare to "standard" patterns or suggest where to look next (e.g. "copybook X is in USER.COPY").

---

## 4. "Get me everything I need to work on X" (Context assembly)

**User goal:** Have one place (e.g. chat or editor) with all relevant mainframe artifacts for a task (e.g. "fix payroll").

**Tool combo:** `listDatasets` / `listMembers` (find payroll-related DSNs) → `readDataset` for JCL, COBOL, copybooks → maybe `getJobOutput` for the failing run. Optional: `openDatasetInEditor` / `openUssFileInEditor` so the user can edit in VS Code.

**LLM’s job:** Decide what’s "relevant" from names and content, fetch in a sensible order (e.g. JCL → main program → copybooks), summarize what each piece is and how they connect, and optionally open key files in the editor so the user has full context without manual browsing.

---

## 5. Generating code with validation

**User goal:** Generate mainframe code (e.g. COBOL, JCL) and validate that it compiles, addresses compile problems, can be executed, and produces expected results.

**Tool combo:** `readDataset` (existing code, copybooks, JCL) → `writeDataset` (new or modified members) → submit/compile via `submitJob` or `runSafeTsoCommand` / `runSafeUssCommand` (depending on build setup) → `getJobStatus`, `getJobOutput`, `readJobFile` or command output to read compiler listing and RC → iterate with further `readDataset` / `writeDataset` and resubmit until clean compile and successful run.

**LLM’s job:** Generate or modify code; submit build/job; read compiler and runtime output; interpret errors (syntax, undefined references, etc.); suggest and apply fixes; re-run until the code compiles and execution matches expected results. Combines code generation with a validate-fix-validate loop.

---

## 6. "Find where this is used or defined" (Search and trace)

**User goal:** Find all references to a program, copybook, or string across libraries.

**Tool combo:** `listDatasets` / `listMembers` (scope) → `searchInDataset` (multiple DSNs or members) → maybe `readDataset` for a few hits to show context.

**LLM’s job:** Turn "N matches in M members" into a short report: "CALL PAYROLL appears in USER.JCL.CNTL(PAYJOB) and USER.SRC.COBOL(MAIN); the copybook is in USER.COPY(PAYDATA)." Prioritize by relevance and suggest "read this member next for full context."

---

## 7. "What’s running and what’s stuck?" (Operational picture)

**User goal:** Quick view of job activity and any problems.

**Tool combo:** `listJobs` (possibly with filters) → for interesting jobs: `getJobStatus`, maybe `getJobOutput` or `readJobFile` for one or two.

**LLM’s job:** Group jobs by status (running, output, held, etc.), highlight long-running or abnormal jobs, and summarize: "3 jobs in OUTPUT, 1 in execution for 2 hours, 2 held; JOB00245 failed (see earlier diagnostics)." Optionally pull one spool and summarize the failure.

---

## 8. Mainframe actions (TSO, UNIX, or batch)

**User goal:** Accomplish a task where the LLM chooses the best mainframe mechanism: TSO command, UNIX command, or batch utility, possibly using search or project context (e.g. AGENTS.md).

**Tool combo:** LLM decides among `runSafeTsoCommand`, `runSafeUssCommand`, and job-based tools (`submitJob`, `getJobOutput`, etc.). May combine with `searchInDataset` (find where something is defined or used), `listDatasets` / `listMembers` (discover targets), or `readDataset` (inspect before/after). Project docs (e.g. AGENTS.md) inform conventions, patterns, and safe practices.

**LLM’s job:** Interpret the user’s request; choose TSO vs USS vs batch (and which tool sequence) based on task and context; optionally use search to find how to accomplish the task or AGENTS.md to follow organizational conventions; execute the chosen actions and summarize outcomes. Example: "List my data sets in a catalog" → TSO; "Find a file that contains the word 'payroll' in my home directory" → USS (grep); "Run the inventory report" → find JCL via search or list, then submit job.

---

## 9. "What do I have and where does it live?" (Discovery & mapping)

**User goal:** Get a mental map of their data: what datasets, members, and jobs exist and how they relate.

**Tool combo:** `listSystems` / `getContext` → `listDatasets` (maybe paginated) → `listMembers` for key libraries → maybe `listJobs` (by status). Optional: `searchInDataset` to find references (e.g. CALLs, COPYs).

**LLM’s job:** Turn raw lists into a short narrative: "You have N systems; on X you have COBOL under USER.SRC.COBOL (M members), JCL under USER.JCL.CNTL; job JOB123 is in OUTPUT." Can highlight "this library has the payroll sources" or "these jobs are still running."

---

## 10. "Onboard me to this system/project" (Guided tour)

**User goal:** Learn what systems are available and what’s important in a project (datasets, jobs, conventions).

**Tool combo:** `listSystems` / `getContext` → `listDatasets` (e.g. user or project HLQ) → `listMembers` on a few key libraries → maybe one or two `readDataset` samples (JCL, COBOL).

**LLM’s job:** Act as a guide: "You’re on system X as user Y; your main libraries are …; this JCL is the nightly batch; start by looking at this member." Tailor to "I’m new" vs "I need the payroll part only."

---

## Summary

| #   | Use case                           | LLM works with output to…                          |
|-----|------------------------------------|----------------------------------------------------|
| 1   | AI-assisted mainframe development  | Browse, search, read, explain, open in editor      |
| 2   | Job failure diagnostics            | Explain cause, step, and next steps                |
| 3   | Code/flow understanding            | Explain logic, flow, and relationships             |
| 4   | Context assembly                   | Fetch and explain "everything for X"               |
| 5   | Code generation with validation    | Generate, compile, fix errors, run, verify results |
| 6   | Search and trace                   | Report "where X is used or defined"                |
| 7   | Operational picture                | Summarize what’s running, stuck, or failed         |
| 8   | Mainframe actions                  | Choose TSO/USS/batch to accomplish a task          |
| 9   | Discovery & mapping                | Narrate "what you have and where"                  |
| 10  | Onboarding                         | Guided tour of system/project                      |
