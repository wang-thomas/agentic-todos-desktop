/// <reference types="vite/client" />

type TodoStatus = 'pending' | 'running' | 'completed' | 'failed'

type ServerTodo = {
  id: string
  user_id: string
  title: string
  notes: string
  status: TodoStatus
  created_at: string
  updated_at: string
  started_at?: string
  finished_at?: string
}

type ServerUser = {
  id: string
  email: string
  display_name: string
  avatar_url?: string
  created_at: string
  updated_at: string
}

type ConnectedAgentID = 'codex' | 'claude_desktop' | 'perplexity'

type ServerConnectedAgent = {
  id: ConnectedAgentID
  enabled: boolean
  updated_at: string
}

type ServerRunPrompt = {
  todo_id: string
  agent_id: ConnectedAgentID
  prompt: string
}

interface Window {
  agenticTodos?: {
    appInfo: () => Promise<{
      name: string
      version: string
      platform: string
      apiBaseURL: string
    }>
    currentUser: () => Promise<ServerUser | null>
    loginWithGoogle: () => Promise<ServerUser>
    logout: () => Promise<void>
    listTodos: () => Promise<ServerTodo[]>
    createTodo: (input: { title: string; notes?: string }) => Promise<ServerTodo>
    updateTodo: (
      id: string,
      input: { title: string; notes: string; status: TodoStatus },
    ) => Promise<ServerTodo>
    deleteTodo: (id: string) => Promise<void>
    listConnectedAgents: () => Promise<ServerConnectedAgent[]>
    updateConnectedAgent: (id: ConnectedAgentID, enabled: boolean) => Promise<ServerConnectedAgent>
    runTodoWithAgent: (todoID: string, agentID: ConnectedAgentID) => Promise<ServerRunPrompt>
  }
}
