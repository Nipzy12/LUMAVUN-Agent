-- Optional schema foundation. Runtime API is not connected to these tables yet.
create extension if not exists pgcrypto;

create table if not exists public.lumavun_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.lumavun_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lumavun_workspaces(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);

create table if not exists public.lumavun_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.lumavun_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.lumavun_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lumavun_workspaces(id) on delete cascade,
  description text not null,
  state text not null default 'pending' check (state in ('pending','approved','running','completed','failed','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.lumavun_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.lumavun_tasks(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.lumavun_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lumavun_workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lumavun_conversations_workspace_idx on public.lumavun_conversations(workspace_id);
create index if not exists lumavun_messages_conversation_idx on public.lumavun_messages(conversation_id);
create index if not exists lumavun_tasks_workspace_idx on public.lumavun_tasks(workspace_id);
create index if not exists lumavun_approvals_task_idx on public.lumavun_approvals(task_id);
create index if not exists lumavun_audit_workspace_idx on public.lumavun_audit_events(workspace_id);

alter table public.lumavun_workspaces enable row level security;
alter table public.lumavun_conversations enable row level security;
alter table public.lumavun_messages enable row level security;
alter table public.lumavun_tasks enable row level security;
alter table public.lumavun_approvals enable row level security;
alter table public.lumavun_audit_events enable row level security;

create policy "owner manages workspaces" on public.lumavun_workspaces
for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "owner manages conversations" on public.lumavun_conversations
for all to authenticated
using (exists (select 1 from public.lumavun_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.lumavun_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

create policy "owner manages messages" on public.lumavun_messages
for all to authenticated
using (exists (select 1 from public.lumavun_conversations c join public.lumavun_workspaces w
  on w.id = c.workspace_id where c.id = conversation_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.lumavun_conversations c join public.lumavun_workspaces w
  on w.id = c.workspace_id where c.id = conversation_id and w.owner_id = (select auth.uid())));

create policy "owner manages tasks" on public.lumavun_tasks
for all to authenticated
using (exists (select 1 from public.lumavun_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.lumavun_workspaces w where w.id = workspace_id and w.owner_id = (select auth.uid())));

create policy "owner manages approvals" on public.lumavun_approvals
for all to authenticated
using (exists (select 1 from public.lumavun_tasks t join public.lumavun_workspaces w
  on w.id = t.workspace_id where t.id = task_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.lumavun_tasks t join public.lumavun_workspaces w
  on w.id = t.workspace_id where t.id = task_id and w.owner_id = (select auth.uid())));

-- Audit events are append-only to authenticated clients. Service operations must use privileged audited paths.
create policy "owner reads audit events" on public.lumavun_audit_events
for select to authenticated using (exists (select 1 from public.lumavun_workspaces w
  where w.id = workspace_id and w.owner_id = (select auth.uid())));
