import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('agenticTodos', {
  appInfo: () => ipcRenderer.invoke('app-info'),
  currentUser: () => ipcRenderer.invoke('auth:current-user'),
  loginWithGoogle: () => ipcRenderer.invoke('auth:login-google'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listTodos: () => ipcRenderer.invoke('todos:list'),
  createTodo: (input: { title: string; notes?: string }) => ipcRenderer.invoke('todos:create', input),
  updateTodo: (
    id: string,
    input: { title: string; notes: string; status: 'pending' | 'running' | 'completed' | 'failed' },
  ) => ipcRenderer.invoke('todos:update', id, input),
  deleteTodo: (id: string) => ipcRenderer.invoke('todos:delete', id),
  listConnectedAgents: () => ipcRenderer.invoke('connected-agents:list'),
  updateConnectedAgent: (id: 'codex' | 'claude_desktop' | 'perplexity', enabled: boolean) =>
    ipcRenderer.invoke('connected-agents:update', id, enabled),
  runTodoWithAgent: (todoID: string, agentID: 'codex' | 'claude_desktop' | 'perplexity') =>
    ipcRenderer.invoke('todos:run-with-agent', todoID, agentID),
})
