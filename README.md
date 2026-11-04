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
`ProviderRegistry` selects the configured adapter. The first adapter uses OpenAI
Chat Completions via the existing httpx dependency, with bounded output, timeout,
and no automatic retries. No Docker, Ollama, GPU, or local model is required.
Only the selected task title and description are sent to OpenAI. Do not include
secrets in task text. Real calls require a provider account and may incur costs.

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
