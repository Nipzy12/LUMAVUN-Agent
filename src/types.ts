export type Role = 'user' | 'assistant' | 'tool';

export type Entry = {
  id: string;
  role: Role;
  text: string;
  createdAt: number;
  detail?: string;
};

export type Conversation = {
  id: string;
  title: string;
  mode: 'chat' | 'code';
  model: string;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  entries: Entry[];
};

export type ProviderKind = 'openai' | 'openrouter' | 'custom';

export type Settings = {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  temperature: number;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  description?: string;
  customInstructions?: string;
  memory?: string;
  pinned?: boolean;
  archived?: boolean;
};

export type UserArtifact = {
  id: string;
  title: string;
  content: string;
  path: string;
  projectId: string | null;
  format: 'html' | 'svg' | 'markdown' | 'code';
  createdAt: number;
  updatedAt: number;
};

export type AgentAction = 'list_files' | 'read_file' | 'write_file' | 'replace_in_file' | 'delete_file';

export type Approval = {
  id: string;
  tool: AgentAction;
  path: string;
  proposed: string;
  description: string;
};

export type ModelInfo = { id: string; name: string };
