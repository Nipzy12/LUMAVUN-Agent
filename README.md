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
   - A database unique constraint on `(department_id, agent_type, managed_department_id)`.
   - A defensive re-select after a flush-time integrity error, so concurrent
     requests that race to create the first manager still result in exactly one.
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
  - `POST /api/departments` — create department
  - `PATCH /api/departments/{id}` — update department
  - `DELETE /api/departments/{id}` — delete department
  - `POST /api/approval-requests` — create approval request
  - `POST /api/approval-requests/{id}/approve` — approve request
  - `POST /api/approval-requests/{id}/deny` — deny request
- **Public endpoints** (no token required):
  - Health, list endpoints, get endpoints (read-only)
- Unauthenticated requests are never labeled as "local-owner" in audit logs.
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
- Concurrent manager creation prevents duplicates.
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
