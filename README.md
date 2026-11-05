# Luma Office

An open-source, local-first, self-hostable AI workplace by Lumavun.

## What it is

Luma Office is an AI-native workplace that runs locally and can be self-hosted.
It is built in layers so the AI layer is optional and provider-agnostic: you can
start with plain HTTP endpoints and add models later.

This repository currently contains the backend foundation (Phase 1).

## Architecture (intentional layers)

- **Luma Core** — FastAPI application, settings, lifespan, and top-level routing.
- **Agents** — agent records and autonomy levels. Default autonomy is `Supervised`.
- **Governance** — safeguards, approvals, and audit trail (stub in Phase 1).
- **Memory** — short-term and long-term memory stores (stub in Phase 1).
- **Model providers** — provider-agnostic interface for cloud and offline AI
  providers. No provider is installed in Phase 1.

## Quick start (Windows PowerShell)

```powershell
# 1. Create and activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1

# 2. Install dependencies
pip install -r requirements.txt

# 3. Copy the example environment file
copy .env.example .env

# 4. Run the server
uvicorn luma_core.app:app --reload --host 127.0.0.1 --port 8000
```

Then open:

- http://127.0.0.1:8000/api/health
- http://127.0.0.1:8000/api/departments
- http://127.0.0.1:8000/docs (auto-generated Swagger UI)

## Running tests

```powershell
.venv\Scripts\Activate.ps1
pytest
```

## Environment

Copy `.env.example` to `.env`. The only required setting for Phase 1 is
`DATABASE_URL`. The default points to a local SQLite file.

Never commit `.env` or real API keys. Keys are loaded from environment
variables only.

## Phase 2 scope — Company Brain Foundation

Phase 2 turns Luma Office into a functioning AI workplace with agent roles, task
routing, and governance safeguards.

### Agent Registry

- Manager and worker agent types with `AgentType` enum.
- Each agent belongs to a department and may manage one.
- Autonomy modes: `Manual`, `Supervised`, `Autonomous` (`AutonomyLevel` enum).
- Default autonomy is `Supervised`.
- Skills stored as a JSON array on the agent row; helper methods `get_skills` /
  `set_skills` handle round-tripping.

### Automatic Department Manager

When a worker is created:

1. The worker's `job_type` is resolved through `JobTypeRegistry` to a department
   name and a manager role.
2. The department is created if it does not already exist.
3. Exactly one primary manager is created for that department if none exists.
4. Duplicate managers are prevented by:
   - A partial unique index, `uq_agents_primary_manager_per_department`, on
     `managed_department_id` where `agent_type = 'manager'` and
     `managed_department_id IS NOT NULL` (created by the model and re-applied
     idempotently on every startup, so a database created before the index
     existed gets it too; startup fails with an explicit error if the database
     file is too old to match the current models).
   - A savepoint around the manager insert plus a defensive re-select after the
     resulting integrity error, so requests that race to create the first
     manager still result in exactly one and the caller's pending work (the
     worker row, unrelated inserts and updates) still commits.
5. The worker agent never grants itself permissions; the manager is created by the
   service layer as part of the same request, before any worker action occurs.

#### Unknown job types

For job types not listed in `JobTypeRegistry`:

- A generic department is created using the pattern ``{JobTypeTitle} Team`` (e.g.
  ``Quantum Flamingo Trainer Team``).
- A generic manager is created with the role ``{DepartmentName} Manager`` and **no
  specific skills profile** from the registry. The manager still exists to own the
  department, but its skills are empty until explicitly configured.
- This policy ensures unknown job types never silently invent specialized manager
  capabilities; they get a structural manager only.

Example mappings:

- `web developer` / `backend engineer` / `frontend engineer` → **Development** → **Dev Manager**
- `video editor` / `videographer` → **Media Studio** → **Media Manager**
- `meme coin researcher` / `trader` → **Trading Lab** → **Trading Manager**

Add new mappings by editing `luma_core/agents/job_type_registry.py`.

### Task Routing

- `POST /api/tasks` creates a task and runs deterministic Phase 2 routing.
- The task's `job_type` is resolved to a department via `JobTypeRegistry`.
- `TaskService.assign_task` finds the best-fit available worker in that department
  by skill overlap, falling back to the lowest-id worker when there is no skill
  overlap.
- If a suitable worker exists, the task is assigned and stays in `assigned` status
  until an executor starts work and transitions it to `in_progress`.
- Otherwise it stays `pending` with no assignee.
- Every assignment or unassignment is recorded in `AssignmentHistory` with an
  action, actor, target, and reason.
- Routing is deterministic and does **not** call any AI model in Phase 2.

### Task Lifecycle

Tasks follow a strict state machine with transitions:

- `pending` → `assigned` | `cancelled`
- `assigned` → `in_progress` | `cancelled`
- `in_progress` → `completed` | `failed` | `cancelled`
- `failed` → `assigned` | `cancelled`
- `completed`, `cancelled` are terminal states

Invalid transitions (e.g. `pending` → `completed`) return HTTP 422.

### Governance

- `GovernancePolicy` uses **default-deny**: only explicitly permitted actions pass.
- Actor identity is required for mutating and sensitive actions.
- Autonomy tiers cap what each agent may do without approval:
  - `manual` — no autonomous actions.
  - `supervised` — read-only.safe actions.
  - `assisted` — may create tasks in addition to read-only actions.
  - `autonomous` — may assign tasks and create tasks, but still cannot perform
    sensitive actions without approval.
- Sensitive actions (`execute_task`, `publish_result`, `transfer_funds`, `run_shell`)
  always require an approval request.
- `ApprovalRequest` records are owner-actioned: only the local owner may approve or
  deny a pending request via `POST /api/approval-requests/{id}/approve` or
  `POST /api/approval-requests/{id}/deny`.
- `AuditEvent` is append-only and captures actor, action, resource, outcome, and
  metadata (serialized as JSON).
- Phase 2 does **not** implement live trading, real transactions, or unrestricted
  shell execution.

### Authentication (lightweight local-owner)

- The self-hosted MVP uses a single shared secret: `LOCAL_OWNER_TOKEN`.
- Endpoints that require owner privileges validate the `X-Luma-Owner-Token` header.
- **Protected endpoints** (require owner token):
  - `POST /api/agents` — create agent
  - `PATCH /api/agents/{id}` — update agent
  - `POST /api/tasks` — create task (triggers routing)
  - `PATCH /api/tasks/{id}` — update task
  - `POST /api/departments` — create department
  - `PATCH /api/departments/{id}` — update department
  - `DELETE /api/departments/{id}` — delete department
  - `POST /api/approval-requests` — create approval request
  - `POST /api/approval-requests/{id}/approve` — approve request
  - `POST /api/approval-requests/{id}/deny` — deny request
- **Public endpoints** (no token required):
  - Health, list endpoints, get endpoints (read-only)
- Unauthenticated requests are never labeled as "local-owner" in audit logs.
- Concurrent manager creation uses SQLite savepoints to avoid rolling back
  unrelated changes (e.g., worker inserts) when a uniqueness conflict occurs.
- This is intentionally minimal and is **not** a multi-user SSO solution.

### API endpoints

| Method   | Path                            | Description                              |
|----------|---------------------------------|------------------------------------------|
| GET      | `/api/health`                   | Service health                           |
| GET      | `/api/departments`              | List departments                         |
| POST     | `/api/departments`              | Create a department                      |
| GET      | `/api/departments/{id}`         | Get a department                         |
| PATCH    | `/api/departments/{id}`         | Update a department                      |
| DELETE   | `/api/departments/{id}`         | Delete a department                      |
| GET      | `/api/agents`                   | List agents (filterable)                 |
| POST     | `/api/agents`                   | Create a worker (auto-creates manager)   |
| GET      | `/api/agents/{id}`              | Get an agent                             |
| PATCH    | `/api/agents/{id}`              | Update an agent                          |
| GET      | `/api/agents/{id}/department`   | Get an agent's department                |
| GET      | `/api/tasks`                    | List tasks (filterable)                  |
| POST     | `/api/tasks`                    | Create a task (triggers routing)         |
| GET      | `/api/tasks/{id}`               | Get a task                               |
| PATCH    | `/api/tasks/{id}`               | Update a task                            |
| GET      | `/api/approval-requests`        | List approval requests                   |
| GET      | `/api/audit-events`             | List audit events                        |

### Tests

Phase 2+ adds tests for:

- Automatic manager creation when a worker is created.
- No duplicate managers when a second worker joins the same department.
- Task routing to the correct department and worker.
- Tasks without a suitable worker staying unassigned.
- Permission denial via the policy engine (default-deny).
- Default `Supervised` autonomy for new agents.
- Strict input validation: invalid autonomy, status, or task state returns HTTP 422.
- Task lifecycle transitions: invalid transitions (e.g. pending -> completed) are rejected.
- Owner-only approval and denial require the `X-Luma-Owner-Token` header.
- Unknown job types create a generic department and never invent a manager skills profile.
- Authentication bypass attempts are rejected (401).
- All state-changing endpoints require owner authentication.
- Concurrent manager creation prevents duplicates (two separate `AsyncSession`
  instances against one file-backed SQLite database).
- The integrity-error handler is exercised: one racing session loses the insert,
  recovers, and adopts the surviving manager.
- Unrelated pending changes survive that recovery and are committed.
- Unrelated integrity errors (e.g. NOT NULL) are re-raised, never mistaken for a
  duplicate manager.
- The database itself rejects a second primary manager for a department.
- All autonomy levels are valid enum values.
- Audit events record actor identity.
- Tasks remain in 'assigned' status until executor starts work.

```powershell
pytest
```

## Phase 1 scope

- FastAPI application
- `/api/health` and `/api/departments` endpoints
- SQLite models for departments, agents, and tasks
- Basic API tests
- Provider-agnostic AI architecture stubs

What Phase 1 does **not** include:

- Ollama, Docker, or heavy local AI models
- Real trading or autonomous external actions
- Frontend

## Phase 3 and beyond (planned, not implemented)

- AI model integration for task assignment suggestions and drafting.
- Provider backends behind the provider-agnostic interface.
- Frontend workspace.

## License

TBD.

## Phase 3.1 — Cloud AI Brain Foundation

The optional cloud executor produces **text only**. It cannot run shell commands,
write project files, browse, invoke tools, or execute generated code. Creating or
assigning a task never calls AI. Default autonomy remains `supervised`.

`BaseModelProvider.chat` / `ProviderResponse` form the provider-neutral contract;
`ProviderRegistry` selects OpenAI or OpenRouter (OpenAI-compatible Chat Completions)
via the existing httpx dependency, with bounded output, timeout,
and no automatic retries. No Docker, Ollama, GPU, or local model is required.
The selected task instruction, optional description, and assigned-agent name, role,
skills, and department are sent to the selected provider. Do not include secrets
in task text or agent metadata. Real calls require a provider account and may incur costs.

### Windows 10 CMD

From the repository directory (Python 3.12 recommended):

```bat
py -3.12 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install -r requirements.txt
if not exist .env copy .env.example .env
notepad .env
```

In the private `.env`, set `LOCAL_OWNER_TOKEN` to a random secret,
`AI_PROVIDER=openai`, `OPENAI_API_KEY` to your own key, and
`OPENAI_MODEL=gpt-4o-mini` (or a compatible Chat Completions model you can access).
Keep `.env` private. API keys are masked by settings and never included in task
errors. `AI_TIMEOUT_SECONDS=60` and `AI_MAX_OUTPUT_TOKENS=1024` are defaults.
Restart the server after changing settings. Leave `AI_PROVIDER=unavailable` to
keep AI disabled.

To use **OpenRouter**, set these values in your private `.env` instead:

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your-private-openrouter-key
OPENROUTER_MODEL=openai/gpt-4o-mini
```

Use an OpenRouter model ID available to your account; the model above is the
configurable default. The adapter posts to
`https://openrouter.ai/api/v1/chat/completions` and uses `max_tokens` from
`AI_MAX_OUTPUT_TOKENS`. It sends text messages only, with no tools, streaming,
automatic retries, or fallback to OpenAI. OpenAI credentials are not used by
OpenRouter, and OpenRouter credentials are not used by OpenAI. Missing or blank
OpenRouter keys return controlled HTTP 503 before execution; invalid credentials,
timeouts, malformed responses, and upstream failures produce a persisted `failed`
task with a sanitized error. Inspect task status, not just HTTP status.

OpenRouter routes the task text to the chosen model provider. Use nonsensitive
text for a first trial, check account/model availability and cost, and restart the
server after editing `.env`. Keep `LOCAL_OWNER_TOKEN` configured: the same
owner-only, task-specific approval and execute flow below applies to both adapters.
No database migration or new dependency is required.

For an isolated trial, use a new SQLite filename; no schema change is required:

```bat
set DATABASE_URL=sqlite:///./luma-phase31-trial.db
python -m pytest -ra
python -m uvicorn luma_core.app:app --host 127.0.0.1 --port 8000
```

In a second CMD, set `OWNER_TOKEN` to the same owner token (never the provider key),
then create a worker and task:

```bat
set OWNER_TOKEN=your-local-owner-token
curl -X POST http://127.0.0.1:8000/api/agents -H "Content-Type: application/json" -H "X-Luma-Owner-Token: %OWNER_TOKEN%" -d "{\"name\":\"Cloud Writer\",\"job_type\":\"backend engineer\"}"
curl -X POST http://127.0.0.1:8000/api/tasks -H "Content-Type: application/json" -H "X-Luma-Owner-Token: %OWNER_TOKEN%" -d "{\"title\":\"Draft a short API design\",\"job_type\":\"backend engineer\"}"
```

Use returned task ID instead of `1` below. Request approval, then use the returned
approval ID instead of `1` in the approval URL and `approval_id`:

```bat
curl -X POST http://127.0.0.1:8000/api/approval-requests -H "Content-Type: application/json" -H "X-Luma-Owner-Token: %OWNER_TOKEN%" -d "{\"action\":\"execute_task\",\"target_type\":\"task\",\"target_id\":1}"
curl -X POST http://127.0.0.1:8000/api/approval-requests/1/approve -H "X-Luma-Owner-Token: %OWNER_TOKEN%"
curl -X POST http://127.0.0.1:8000/api/tasks/1/execute -H "Content-Type: application/json" -H "X-Luma-Owner-Token: %OWNER_TOKEN%" -d "{\"approval_id\":1}"
curl http://127.0.0.1:8000/api/tasks/1
```

Approval alone does not start execution. The explicit execute request claims an
assigned task atomically, commits `in_progress`, calls AI without a database write
lock, then persists `completed` + `result`, or `failed` + a sanitized `error`.
A provider failure returns HTTP 200 with task status `failed`; inspect the status.
Missing owner authentication returns 401, invalid approval 403, invalid task state
409, and unconfigured provider 503. Approval is single use: its existing status
becomes `cancelled` with a consumption note; the audit links the approval ID.
No destructive migration or new database column is needed.

Start/completion/failure and approval denials are audited. An owner cancellation
during a call is preserved instead of being overwritten by the result. There is
no automatic retry or background scheduler. While an executor owns an `in_progress` task, owner PATCH may only cancel it;
manual completion or failure returns 409 to prevent a reset and overlapping call.
If the process is killed after the claim, the task may remain `in_progress`.
Cancel that task and create a new task with a new approval after confirming that
the old server process has stopped. A remote call may already have incurred cost,
so inspect before retrying. Public read endpoints
remain as in Phase 2.1: keep this local service bound to localhost.

Tests use mock providers and HTTP mocks; no real API key or paid call is needed.


## Phase 3.1.1 — Agent Prompt Intelligence

Execution now uses a provider-neutral `TaskPrompt` built from the current task and
its assigned agent. A fixed application-owned system message instructs the model
to execute the user instruction directly and obey explicit output formatting.
A separate JSON user message contains:

- `primary_instruction`: the exact task title, interpreted as an instruction.
- `supplementary_context`: the description, omitted when absent or whitespace-only.
- `assigned_agent`: name, role, skills, and department, when an agent is available.

Agent metadata is background context, not privileged instructions. User-controlled
text never becomes a system message. Safety instructions remain fixed and do not
grant tools or permissions; owner authentication, task-specific approval, atomic
execution, cancellation, and audit are still enforced by application code.
Neither adapters nor the prompt builder execute generated text.

Both OpenAI and OpenRouter accept `TaskPrompt` and the original plain-string
`chat(prompt)` calling convention. Custom provider implementations should accept
`TaskPrompt | str`; use `provider_messages` for the shared message serialization
and configured-secret redaction. Model credentials are used in HTTP authorization,
never added as prompt context. Known configured provider keys and owner tokens are
redacted from outbound user content and generated results. Raw provider errors
remain sanitized, and prompts/results are not copied to audit records. This is
not a general detector for arbitrary credentials users paste into stored task or
agent fields; do not store secrets there. Existing read APIs still return those
user-supplied fields.

There is no schema change, conversation memory, new endpoint, new dependency,
automatic execution, or Chat/Work UI modification. Each request uses only its
current task and assigned-agent context. Historical task results and chat history
are not included. Plain strings also receive the fixed system instructions.

### Verify through your connected Luma Office Chat interface

The repository now includes the lightweight Chat/Work frontend at `/office`.
Connect the owner token in the UI before reading private conversations.

1. Restart this updated backend with your configured OpenAI or OpenRouter provider
   and a disposable SQLite database, for example in Windows CMD:
   `set DATABASE_URL=sqlite:///./luma-prompt-trial.db` followed by
   `python -m uvicorn luma_core.app:app --host 127.0.0.1 --port 8000`.
   Use a new filename so existing Phase 2.1/3.1 data is not opened for the trial.
2. Create/select a worker and ensure the UI routes its task to that worker. Send
   **Reply only LUMA_SMOKE_OK** in Chat. Inspect the resulting task in Work: its
   title must preserve that exact instruction. If the UI replaces it with a summary,
   correct that mapping in the UI before testing the backend behavior.
3. Confirm the task is `assigned`, then explicitly approve `execute_task` for this
   task as owner and request execution using the existing controls. If your UI has
   no approval controls, use the existing API flow documented above or `/docs`.
4. Inspect the task result in Work. Expected result: exactly `LUMA_SMOKE_OK`, with
   no explanation or Markdown, and status `completed`. No follow-up prompt should
   be needed. Check the audit for the corresponding start/completion events.
5. Optionally try a new task: **Reply with exactly two bullet points about API
   design**, with description **Audience: a beginner Python developer**. Expect
   two direct bullet points using the description as supplementary context. This
   is a separate paid call and requires its own task-specific approval.

Automated tests mock both providers; they validate message structure and persisted
results, not a remote model's intelligence. Actual compliance depends on the model.
The application does not fabricate the smoke response, rewrite the model result to
force exact formatting, or retry a noncompliant answer automatically. A process
interruption can still require the manual cancellation/recreation recovery described
in Phase 3.1. No Phase 3.2 conversation memory is implemented.

## Phase 3.2 — Conversation Memory Engine

The backend now stores private conversations and ordered user/assistant messages
in SQLite. Existing one-task API clients keep working. To use memory, clients must
create their tasks through `POST /api/conversations/{id}/messages`; old
`POST /api/tasks` calls do not implicitly create a conversation or share history.

### Storage, ownership, and migration

Startup adds only `conversations` and `conversation_messages`, with indexes and
uniqueness constraints. Legacy agent, task, approval, assignment and audit table
columns and records are preserved. No database deletion or reset is required.
Before upgrading, stop the backend and make a backup of your SQLite database, then
restart the updated backend normally. Startup initialization is idempotent. Do not
run an older backend against a database containing private conversation tasks:
older code does not implement their visibility filters.

Conversation UUIDs are not credentials. Every conversation API requires
`X-Luma-Owner-Token`. The associated owner identity comes from server configuration
`LOCAL_OWNER_ID` (default `local-owner`), never from client headers or request bodies.
Keep that ID stable when rotating `LOCAL_OWNER_TOKEN`; changing the ID makes the
previous owner's conversations inaccessible through the API. This remains a
single-owner deployment: all browsers using the same owner token share that owner's
conversations. It is not a new multi-user login or per-device session system.

Conversation-linked tasks, their approvals, and related audit events are hidden
from unauthenticated reads and from other owner identities. Authenticated Work
requests must include the owner token to see these tasks. Legacy non-conversation
records retain their previous public-read behavior. No history is logged in audit
records. Known configured secrets are redacted from newly stored message text,
conversation titles, history sent to providers, and assistant results. Do not paste
arbitrary credentials into tasks or metadata; this is not a general secret scanner.
SQLite files contain private text at rest and should remain locally protected.

### Conversation API

All routes below require the owner token. IDs use UUID strings for conversations
and monotonically ordered integer IDs for messages. Timestamps are UTC ISO strings.

| Method | Route | Behavior |
|---|---|---|
| POST | `/api/conversations` | Create with optional `title`; default `New conversation` |
| GET | `/api/conversations` | Owner's sidebar list, `limit` 1–100 and `offset` |
| GET | `/api/conversations/{id}` | Details and chronological messages; `after_id`, `limit` 1–200, `has_more`, `next_after_id` |
| PATCH | `/api/conversations/{id}` | Rename with required nonblank `title` |
| POST | `/api/conversations/{id}/messages` | Append a user message and create/route its task; use the same route to continue |

User message body:

```json
{
  "client_message_id": "6cbe4c46-d4a9-4ac9-8e53-4ead85eb076a",
  "content": "Remember that our project is named Aurora.",
  "job_type": "backend engineer"
}
```

Generate a new UUID for each new message (browser `crypto.randomUUID()` or Python
`uuid.uuid4()`); reuse it when retrying delivery of that same message. Repeated
requests with matching content and job type return the existing message/task with
`replayed: true`, without new rows or AI calls. Reusing it for different content
returns 409. Conversation titles are limited to 255 characters and current user
messages to 512 characters, preserving the existing task-title input limit.
`job_type` is optional, but a suitable worker is needed for routing and execution;
without one the task stays pending. Assistant roles, owner IDs, and arbitrary task
IDs are never accepted from the message API.

The response contains `message`, `task`, and `replayed`. The user's message row links
its task to the conversation, so no column is added to legacy `tasks`. Each user
message creates one task. There is at most one pending/assigned/in-progress task
per conversation: finish or cancel it before adding the next turn (otherwise 409).
Separate conversations can progress independently. Conversation task content is
immutable; corrections are new turns. Start/completion must use the approved
executor, not manual status PATCH. A failed latest turn can be reassigned with
PATCH and retried with a new approval, or followed by a new message. Old turns
cannot be executed/retried after a newer user message exists.

### Execution and bounded memory

Posting or reopening a conversation never executes AI. For every turn, create and
approve an `execute_task` approval targeting that task, then explicitly call
`POST /api/tasks/{task_id}/execute` with its `approval_id`, as in Phase 3.1.
Approvals are task-specific and single-use. Historical text cannot authorize a call.

The prompt retains the fixed system message and current primary instruction.
`conversation_history` is a separate array of `{role, content}` entries inside the
untrusted user payload, in chronological order. Only earlier messages in the same
conversation whose tasks completed are eligible; failed, cancelled, current, future,
and other-conversation turns are excluded. Context limits apply before serialization:

```dotenv
LOCAL_OWNER_ID=local-owner
CONVERSATION_CONTEXT_MAX_MESSAGES=20
CONVERSATION_CONTEXT_MAX_CHARS=12000
```

Both limits bound history, not the current instruction or fixed system instructions.
Newest eligible messages are preferred; the oldest included message may be shortened
to fit the remaining character budget. A `history_truncated` marker tells the model
when a window was shortened. A window may contain a partial turn; there is no summary,
vector retrieval, embedding, or unbounded full-history prompt. Set either limit to
zero to omit history from prompts while still storing conversations. Full stored
history remains accessible through paginated authenticated reads.

Task completion, one assistant message, the conversation update timestamp, and
completion audit commit together. A database uniqueness constraint prevents more
than one assistant message per task. Failed, cancelled, or discarded executions
never create assistant messages. Cancelling during a provider call preserves the
cancelled task and discards its late answer; a remote call may still incur cost.
A crash/storage failure after claiming can leave `in_progress`; cancel and create
a new turn only after checking that the old process has stopped. There is no
automatic retry, scheduler, shell, file-writing tool, or external action capability.

### Chat/Work integration and a two-message check

The synchronized lightweight Chat/Work frontend is now integrated and automatically
served at `http://127.0.0.1:8000/office` (also `/office/`). No installer run is needed;
`install_office_ui.py` remains available and exits without changing an already
mounted app. The existing design, Work panels, and explicit approval controls are
preserved. There is no framework, CDN, Node.js runtime, or production dependency added.

- Connect your **owner token**, not a provider API key. All API reads and writes
  include that token while connected. It lives only in tab memory: reload requires
  reconnecting. Neither localStorage, sessionStorage, nor browser databases store it.
- Sidebar lists saved conversations, fetching API pages as needed. **Tugas baru**
  creates a persistent conversation. **Ubah nama** renames the selected conversation.
- Opening a conversation restores messages in server-ID order. Its nonsecret UUID
  is retained in the URL fragment so refresh can reopen it after reconnecting.
  The last task's team is restored without overriding subsequent user selection.
- Send uses the conversation message API and a stable delivery UUID. A lost POST
  response is reconciled against stored message IDs; no second task is created.
  A draft/delivery UUID is not persisted across reload: inspect history before
  resending after a full page restart. No automatic message or execution retries occur.
- Every task still requires **Minta approval → Setujui → Jalankan dengan AI**.
  Approving alone does not execute it. The UI refreshes server state and renders
  only persisted assistant messages, without inventing or duplicating an answer.
- Cancellation stays available while execution is pending. Pending/unassigned
  tasks can also be cancelled to unblock a conversation. Cancelling does not undo
  a remote provider request or its cost. Refresh/reconnect never starts execution.
- Work retains agent creation, departments, tasks, approvals and audit activity.
  **Lihat** reopens the associated conversation using authenticated
  `GET /api/tasks/{id}/conversation`; legacy tasks return a null conversation ID
  and remain readable individually. Work requests include the owner token.
- Forgetting/replacing a token clears the private view and ignores delayed responses
  from the previous session. Invalid tokens cannot leave old private data displayed.
  Rendered messages and model results use text nodes, not executable HTML.

Private API responses and UI assets use `Cache-Control: no-store`; owner-filtered
responses also vary on the owner-token header. The UI has a same-origin Content
Security Policy and an asset allowlist (only app.js and styles.css are public).
Do not publish an older UI/backend against this private-memory database. Department
deletion is refused when it would cascade into conversation tasks; archive the
department instead to preserve history.

To verify through `/office`:

1. Start the backend against a new disposable database, configure OpenAI or
   OpenRouter, and ensure a matching worker exists. In Windows CMD:
   `set DATABASE_URL=sqlite:///./luma-memory-trial.db`, then
   `python -m uvicorn luma_core.app:app --host 127.0.0.1 --port 8000`.
2. Click **Tugas baru**. Send **Remember that our project is named Aurora. Reply
   only ACK.** Approve and execute that turn; expect `ACK`.
3. In the same conversation, send **What is our project's name? Reply only with
   the name.** Approve and execute its new task; expect `Aurora`.
4. Restart the backend with the same database, reopen the conversation, and confirm
   both user messages and both assistant messages remain in chronological order.
5. Create a different conversation and ask the same name question. Its prompt must
   contain none of the Aurora conversation's messages. A model can guess a name,
   so automated payload-isolation tests provide stronger evidence than its wording.

These are two real provider calls and may incur cost; use nonsensitive text. The same test can also be done from authenticated `/docs` using the conversation
routes followed by the existing approval and execute routes.
Automated tests mock both providers; no real keys or paid calls are required.
Phase 3.3 features and frontend replacement are outside this change.


### Optional browser integration checks

`python -m pytest -ra` runs backend, migration and UI-serving tests without any
browser package. Optional real-browser checks live in `tests/browser_office.py`.
Run them with a development Python that has Playwright and Chromium installed;
set `LUMA_TEST_PYTHON` to the application virtual environment's Python if different.
`CHROMIUM_BINARY` can select an existing Chromium executable. These are test-only
tools, not application dependencies. The harness starts a temporary SQLite-backed
server with a fake AI provider; it never calls OpenRouter or OpenAI.

The browser checks cover two-turn recall, explicit approvals, refresh/restart,
private-read authentication, message pagination, lost-response/double-send recovery,
cancellation, Work actions, text-only output rendering, invalid tokens and stale
responses after logout. A screenshot can be saved by setting `LUMA_UI_ARTIFACT_DIR`.

## Phase 3.2.1 — separate Chat and Work

Ordinary **Chat** is authenticated, persistent text generation. Sending is an explicit
request to the configured cloud model; it creates no task or approval. **Work →
Buat task** opens the governed task composer. Work still requires task-specific
approval before executing an assigned task. Existing conversation-linked tasks,
agent management, cancellation, audit, and results remain available.

The sidebar supports search within loaded conversations, a visible toggle and
Ctrl+Shift+S (when not intercepted by the browser). Only sidebar visibility and
Low/Medium/High preferences enter localStorage. Tokens remain in tab memory;
reconnect after refreshing. The empty Chat composer is centered; active histories
use the bottom composer. Work task controls remain visibly labeled.

### Direct Chat API and limits

All `/api/chat/**` routes require `X-Luma-Owner-Token`, including attachment reads.
Create a conversation with `POST /api/conversations`, then send
`POST /api/chat/conversations/{id}/messages` with:

```json
{"client_message_id":"a unique UUID", "content":"Reply only LUMA_SMOKE_OK", "level":"medium", "attachments":[]}
```

The client must reuse the same UUID and payload when reconciling an uncertain
submission. Completed requests replay without another provider call; running and
failed attempts return 409. At most one active request/task per conversation and
three active direct requests per owner are permitted. Messages are limited to 512
characters, bounded history uses the Phase 3.2 limits, and provider calls use
`AI_TIMEOUT_SECONDS` with no automatic retry. Failed requests retain the user
message but never fabricate an assistant response. Private responses disable caching.

Each provider has configurable `OPENAI_CHAT_{LOW,MEDIUM,HIGH}_MODEL` or
`OPENROUTER_CHAT_{LOW,MEDIUM,HIGH}_MODEL` mappings; blank mappings use the existing
provider model. Output budgets use `CHAT_{LOW,MEDIUM,HIGH}_TOKENS`. Medium is the
initial default. Levels do not guarantee intelligence or cost: these depend on
the chosen model. No reasoning-effort parameters are sent, ensuring compatibility
with models that do not support them. Work provider settings remain unchanged.

### Attachments

The plus menu uploads real files to authenticated `POST /api/chat/attachments`
(raw request body, Content-Type, X-File-Name). The returned UUID can be attached to
a message; authenticated `GET /api/chat/attachments/{uuid}` retrieves it. Limit:
three files per request, 4 MiB per file. Supported: validated PNG/JPEG/WebP
(maximum 16 million pixels), UTF-8 TXT, and text PDFs (maximum 30 pages and 20,000
extracted characters per document). Encrypted/scanned-only PDFs, OCR, audio,
video and other formats are unsupported. PDFs are parsed as text, never executed.
Image support is explicitly allowlisted by exact model ID in `CHAT_IMAGE_MODELS`;
misconfigured/unsupported remote models produce a sanitized provider failure.
Images use inline data URLs sent only to the selected provider. Text documents
are redacted and stored as extracted text, not original files. Images are stored
under random UUIDs in `CHAT_ATTACHMENT_DIR`, never under user-supplied paths and
never mounted as static content. Unsent attachments can be removed from the
composer; unused uploads can be cleaned with the owner-only retention endpoint below.
Do not expose the upload directory or database, which contain private material.

Additive startup creates `chat_requests` and `chat_attachments` without altering
existing tables. Back up the SQLite file and upload directory together when the
server is stopped. A process crash after claiming a request can leave it running;
there is deliberately no automatic retry/recovery that could cause another paid
call. Inspect history and use a new conversation after stopping the old process.
Image contents cannot be semantically scanned for secrets; inspect files before
uploading. Historical image bytes are not resent on follow-ups; document text and
text exchanges are included within the configured context bounds.

### Windows 10 CMD verification

From the project folder with the server stopped:

```bat
.venv\Scripts\activate
python -m pip install -r requirements.txt
python -m pytest -q
python -m uvicorn luma_core.app:app --host 127.0.0.1 --port 8000
```

Keep your existing `.env` and database. Add the optional settings from
`.env.example`, configure your provider privately, and open
`http://127.0.0.1:8000/office`. Connect the owner token. In Chat send
“Remember the project name Aurora”, then “What is the project name?”; there should
be two answers and no new Work tasks. Refresh, reconnect, and reopen the history.
Try a small TXT and an image with a supported vision model, removing an attachment
before sending. Compare the usage levels after configuring distinct model mappings.
In Work create a task, confirm it remains assigned, then explicitly request,
approve, and execute it. Toggle the sidebar by button and shortcut; test a narrow
window. Real provider requests incur provider charges.

Optional browser tests require Python Playwright and Chromium (development only):
`python tests/browser_office.py`. All automated AI responses are mocked; tests use
disposable databases. No production Node/React runtime is needed.


### PR #1 corrections: model metadata, retention and parser budgets

OpenAI/OpenRouter `ProviderResponse.model` now reports the selected preset model
sent in the request (with configured-secret redaction), rather than the default
model. This identifies the requested model, not a provider-resolved version alias.

An explicit owner-authenticated `POST /api/chat/attachments/cleanup` removes unused
attachments older than `CHAT_ATTACHMENT_TTL_HOURS` (default 24). It never expires
an attachment with a conversation link, even if the conversation metadata is
missing. The additive `chat_attachment_retention` table records new upload times;
older unlinked records without timestamps receive a fresh grace period on their
first cleanup. No legacy table columns or data are rewritten at startup.
Cleanup also removes old UUID-named regular files with no database record,
checking records for every owner; recent files, symlinks, non-UUID filenames and
other owners' attachment rows are retained. Keep this storage directory dedicated
to the application. Upload, binding and cleanup are serialized with SQLite writer
locks. Failed file deletions keep the row for a later retry. Removed pending
attachments still remain server-side until they expire and cleanup is requested.
There is no automatic scheduler and linked attachments have no expiration policy.

For Windows CMD, with the server running and a private owner token available:

```bat
curl -X POST http://127.0.0.1:8000/api/chat/attachments/cleanup -H "X-Luma-Owner-Token: %LOCAL_OWNER_TOKEN%"
```

The command reports expired-row and orphan-file deletion counts. Cleanup can be
run periodically by the owner; it requires no AI provider and makes no AI call.
Do not run it against a user database during automated testing.

PDF/image validation now runs in a fixed Python parser subprocess rather than
blocking the API event loop. There are two active parsers per server process,
an 8-second wall timeout with worker termination/reaping, the existing 4 MiB
input cap, 30 PDF pages, incremental 20,000-character text limits and 4 MiB PDF
stream-decompression/work limits (pypdf >=6.21.4). Image verification includes
actual decoding and rejects animation, corruption and images above 16 million
pixels. On POSIX workers also enforce 512 MiB address-space and 6-second CPU
limits. Windows supports subprocess isolation and wall timeout but does not
currently impose an OS-level hard memory cap; parser allocations can briefly
exceed input/decoded-content bounds. This mitigates resource exhaustion, not a
full hostile-file sandbox. No OCR, image-secret recognition or metadata stripping
is added. Broad public upload access still requires further operational controls.
