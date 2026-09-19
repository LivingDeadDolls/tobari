# Tobari — Requirements memo

Updated: 2026-09-20

Implementation update: the authorized 0.1 delivery uses a cloned repository and a foreground Windows `start.bat` server (Node + SQLite), not Cloudflare. The bat window stays open with running/stopped status and logs. Dashboard registration, copyable CLI launch commands, authenticated LAN transport, local outbox retry and setup documentation are now in scope. See [0.1 implementation](product-v0.1.md) for implemented behavior and remaining gaps; earlier research/prototype sections below are historical.

## Goal

Connect work performed by Codex and Claude Code to human-created tasks, then inspect status, activity, time, and outcomes from one dashboard.

AI performs the work; the human primarily reviews results and the criteria and rationale behind decisions. The dashboard must help a person overseeing parallel work answer:

- What is this session responsible for?
- How far has the task progressed, and is the work actually finished?
- What is the conclusion, what supports it, and what requires my judgment next?

Task progress, outcomes, and review needs take precedence over a live feed of individual tool operations.

## Task creation (human-led)

- A person registers tasks from the dashboard UI before agent work starts.
- The initial registration form consists of:
  - a required title;
  - a free-text request describing the desired work, constraints, and completion criteria, including source-message excerpts or notes as useful;
  - the target repository / working directory for launching the CLI;
  - optional source links, such as a message, GitHub Issue, Linear, Notion, or Slack.
- Completion criteria are not a separate mandatory field. The request can be refined through subsequent CLI conversation; registration does not require a fully specified task.
- Status is updated through the agent integration. Priority and tags remain candidate metadata rather than required initial registration fields.

## Starting and linking work

- Initial usage is personal, with Codex and Claude Code CLIs running on the user's development machine; this does not mean running a local LLM.
- A dashboard task provides a launch command for the selected CLI, which the user copies and runs in a terminal. Direct browser-to-terminal launch is not required initially.
- Launching an agent supplies the selected `task_id` to that process (for example via a wrapper CLI and process-local environment variable).
- A session-start hook registers the agent session and binds it to that task.
- Later hook events identify the session; the server resolves the current linked task from the session, rather than inferring a task from the prompt.
- A session may be switched deliberately to another task. The original session and event history remain intact.

## Parallel and subagent work

- The primary workflow is one task with one main CLI session, which often delegates work to subagents. Parallel work usually means multiple such tasks running at once.
- Agent-team workflows, including the user's use of Claude Code Agent Teams, are also in scope for requirements. The available integration signals and initial implementation coverage remain to be verified.
- One task may have multiple independent Codex and/or Claude Code sessions, but this is a secondary workflow rather than the default.
- A subagent starts as a child of its parent work session and inherits the parent task by default.
- A subagent may deliberately switch to another task while retaining its `parent_session_id` for traceability.
- Preserve team membership and member responsibility where available, separately from parent-child session relationships; do not assume all team members are ordinary child sessions.
- Distinguish task-level progress and conclusions from each subagent's or team member's progress and outcomes.
- Keep one star per human-created task in the overview; expose the main session, subagents, and team members in task details rather than treating every agent as a separate top-level task.
- Let the main session (or designated coordinating session in a team) report the overall task conclusion. A member's completion report does not by itself mark the whole task complete.
- Task-level reporting must distinguish wall-clock elapsed time from summed agent execution time, because concurrent sessions can overlap.

## Events and dashboard

- Hooks should automatically update session operational status. Exact event availability and integration mechanisms for each CLI remain to be verified.
- Capture useful lifecycle events: session start/end, interruption, task switch, selected tool/file/git activity, result summary, and commits.
- Avoid sending full prompts, arbitrary command output, secrets, or raw logs by default.
- Dashboard should show: active sessions, task progress, per-session outcomes, commits/changed files, activity timeline, elapsed time, aggregate agent time, and peak concurrency.

## Task progress and human review

- The short status text describes progress toward the task's goal, not the current tool operation. Examples: "Cause identified; fix not started", "Implementation and tests complete; review pending", or "Blocked on a decision about scope".
- A person should be able to understand the current conclusion, remaining work, and any requested decision without reconstructing the terminal conversation.
- Review information should explain results, relevant decision criteria and rationale, and supporting evidence such as validation results or changes.
- Session operational state, reported task progress, and human acceptance are distinct concepts. A completed agent response alone does not establish that the task is complete.
- Semantic progress reporting requires an explicit reporting mechanism in addition to lifecycle events; the implementation is not yet decided.

## Initial dashboard interaction scope

- The dashboard is primarily for observation: humans register tasks, obtain launch commands, and inspect progress, outcomes, rationale, and evidence.
- Review follow-up, additional instructions, and requests for revisions happen in the corresponding CLI terminal in the initial version.
- Approval and revision-request controls that send instructions to agents are outside the initial version.
- Progress and results should return to the dashboard automatically through the integration; routine manual status updates should not be necessary.
- In the initial version, show a task as complete when the AI explicitly reports that the requested work is complete, accompanied by validation results and any unresolved issues. Merely ending a response or session does not count as this report.
- When additional instructions restart work on a completed task, return its status to in progress.
- The initial version does not separately track human acceptance or require a manual completion action.

## Future scope: issue and pull request links

- Show the relationships between Tobari tasks and GitHub Issues / pull requests, connecting the originating request to resulting work.
- This is a future extension beyond the initial version's source links; automatic discovery, external status synchronization, and write-back behavior are not yet specified.

## Proposals to refine

- Use a shared human-readable name in the dashboard and terminal, combining task name with session responsibility, such as "Login bug | Investigation". Session IDs remain the internal identifiers. Terminal tab-title support needs verification.
- Show the last progress-report timestamp so an old report is not mistaken for a current observation.

## Open requirements questions

- What minimum report structure and update timing are needed to communicate progress, conclusions, decision rationale, evidence, and requests for human judgment?
- How should the reporting authority for overall task progress be identified in team workflows, and how should conflicting reports or unavailable member telemetry be displayed?

## Integration research

- Official hook documentation and locally installed CLI versions/help were checked on 2026-09-20. See [agent integration research and proposed design](agent-integration.md).
- Both CLIs document lifecycle and subagent hooks. Semantic progress reporting, reliable identity propagation, and team coverage still require a runtime prototype.
- The linked report proposes a launch wrapper, CLI-specific hook adapters, and explicit structured progress reports. These are implementation proposals, not yet verified behavior or additional user-approved scope.
- A subsequently authorized local prototype now implements the wrapper, hook receiver, structured reporting and SQLite inspection. See [prototype validation](prototype-validation.md) for the distinction between simulated tests, successful Codex runtime reporting, and the Claude login prerequisite. Dashboard and cloud implementation remain outside this prototype.

## Product metaphor and visual direction

- The dashboard is a night sky; each task is a star rather than a conventional task card.
- Active work can give a star a subtle glow or pulse. Completed work forms a stable constellation/history; blocked work is visually distinct but quiet.
- Relationships between parent tasks, subtasks, and agent sessions can be rendered as constellation lines when useful, without making the main view noisy.
- The metaphor should support orientation: humans use the sky to see what is active, where work is heading, and how independent efforts form a whole.

## Direction considered

- Build a personal backend and UI using Cloudflare Workers, D1, and Pages within free-tier limits.
- Secure hook-to-backend traffic with a per-user secret; protect the dashboard with authentication.
