import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const apiBaseURL =
  process.env.AGENTIC_TODOS_SERVER_URL ?? 'https://agentic-todos-server-production.up.railway.app/api/v1'
const execFileAsync = promisify(execFile)
const developmentIconPath = path.join(__dirname, '../build/bee.png')

type User = {
  id: string
  email: string
  display_name: string
  avatar_url?: string
}

type Todo = {
  id: string
  user_id: string
  title: string
  notes: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  created_at: string
  updated_at: string
  started_at?: string
  finished_at?: string
}

type ConnectedAgentID = 'codex' | 'claude_desktop' | 'perplexity'

type ConnectedAgent = {
  id: ConnectedAgentID
  enabled: boolean
  is_default: boolean
  updated_at: string
}

type RunPrompt = {
  todo_id: string
  agent_id: ConnectedAgentID
  prompt: string
}

type CreateTodoInput = {
  title: string
  notes?: string
}

type UpdateTodoInput = {
  title: string
  notes: string
  status: Todo['status']
}

function sessionFilePath() {
  return path.join(app.getPath('userData'), 'session.json')
}

async function loadSessionToken(): Promise<string | null> {
  try {
    const body = await fs.readFile(sessionFilePath(), 'utf8')
    const data = JSON.parse(body) as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}

async function saveSessionToken(token: string): Promise<void> {
  await fs.mkdir(path.dirname(sessionFilePath()), { recursive: true })
  await fs.writeFile(sessionFilePath(), JSON.stringify({ token }), 'utf8')
}

async function clearSessionToken(): Promise<void> {
  try {
    await fs.rm(sessionFilePath())
  } catch {
    // Missing session files are already logged out.
  }
}

async function apiRequest<T>(pathName: string, init?: RequestInit, options?: { auth?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  if (options?.auth) {
    const token = await loadSessionToken()
    if (!token) {
      throw new Error('Please sign in with Google.')
    }
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${apiBaseURL}${pathName}`, {
    ...init,
    headers,
  })
  if (response.status === 401 && options?.auth) {
    await clearSessionToken()
  }
  if (!response.ok) {
    let message = `Agentic Todos server returned ${response.status}`
    try {
      const body = (await response.json()) as { error?: { message?: string } }
      message = body.error?.message ?? message
    } catch {
      // Keep the status-based message when the server did not return JSON.
    }
    throw new Error(message)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

async function currentUser(): Promise<User | null> {
  const token = await loadSessionToken()
  if (!token) {
    return null
  }
  try {
    return await apiRequest<User>('/me', undefined, { auth: true })
  } catch {
    return null
  }
}

async function loginWithGoogle(): Promise<User> {
  const callback = await createAuthCallbackServer()
  try {
    const authURL = `${apiBaseURL}/auth/google/start?redirect_uri=${encodeURIComponent(callback.redirectURI)}`
    await shell.openExternal(authURL)
    const token = await callback.token
    await saveSessionToken(token)
    const user = await currentUser()
    if (!user) {
      throw new Error('Login completed, but the session could not be loaded.')
    }
    return user
  } finally {
    callback.close()
  }
}

async function logout(): Promise<void> {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST' }, { auth: true })
  } catch {
    // Local logout should still happen if the server is unavailable.
  }
  await clearSessionToken()
}

async function listTodos(): Promise<Todo[]> {
  return apiRequest<Todo[]>('/todos', undefined, { auth: true })
}

async function createTodo(input: CreateTodoInput): Promise<Todo> {
  return apiRequest<Todo>(
    '/todos',
    {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      notes: input.notes ?? '',
    }),
    },
    { auth: true },
  )
}

async function updateTodo(id: string, input: UpdateTodoInput): Promise<Todo> {
  return apiRequest<Todo>(
    `/todos/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
    { auth: true },
  )
}

async function reorderOpenTodos(todoIDs: string[]): Promise<void> {
  await apiRequest<void>(
    '/todos/reorder',
    {
      method: 'POST',
      body: JSON.stringify({ todo_ids: todoIDs }),
    },
    { auth: true },
  )
}

async function deleteTodo(id: string): Promise<void> {
  await apiRequest<void>(`/todos/${id}`, { method: 'DELETE' }, { auth: true })
}

async function listConnectedAgents(): Promise<ConnectedAgent[]> {
  return apiRequest<ConnectedAgent[]>('/connected-agents', undefined, { auth: true })
}

async function updateConnectedAgent(id: ConnectedAgentID, enabled: boolean): Promise<ConnectedAgent> {
  return apiRequest<ConnectedAgent>(
    `/connected-agents/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    },
    { auth: true },
  )
}

async function setDefaultConnectedAgent(id: ConnectedAgentID): Promise<ConnectedAgent> {
  return apiRequest<ConnectedAgent>(
    `/connected-agents/${id}/default`,
    {
      method: 'PATCH',
    },
    { auth: true },
  )
}

async function runTodoWithAgent(todoID: string, agentID: ConnectedAgentID): Promise<RunPrompt> {
  const runPrompt = await apiRequest<RunPrompt>(
    `/todos/${todoID}/run-prompt`,
    {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentID }),
    },
    { auth: true },
  )
  clipboard.writeText(runPrompt.prompt)
  await openAgentApp(agentID)
  return runPrompt
}

async function openAgentApp(agentID: ConnectedAgentID): Promise<void> {
  const appName = agentAppNames[agentID]
  try {
    await execFileAsync('open', ['-a', appName])
  } catch (error) {
    throw new Error(`Prompt copied, but ${appName} could not be opened. Make sure it is installed.`)
  }
}

const agentAppNames: Record<ConnectedAgentID, string> = {
  codex: 'Codex',
  claude_desktop: 'Claude',
  perplexity: 'Perplexity',
}

async function createAuthCallbackServer(): Promise<{
  redirectURI: string
  token: Promise<string>
  close: () => void
}> {
  let server!: http.Server
  const token = new Promise<string>((resolve, reject) => {
    server = http.createServer((request, response) => {
      const requestURL = new URL(request.url ?? '/', 'http://127.0.0.1')
      const authToken = requestURL.searchParams.get('token')
      const error = requestURL.searchParams.get('error')
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      if (authToken) {
        response.end(
          '<!doctype html><title>Agentic Todos</title><p>Login complete. You can return to Agentic Todos.</p>',
        )
        resolve(authToken)
        return
      }
      response.end('<!doctype html><title>Agentic Todos</title><p>Login failed. You can close this window.</p>')
      reject(new Error(error ?? 'Google login failed.'))
    })
    server.on('error', reject)
  })

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve())
    server.on('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not start local login callback.')
  }
  return {
    redirectURI: `http://127.0.0.1:${address.port}/auth/callback`,
    token,
    close: () => server.close(),
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: 'Agentic Todos',
    icon: isDevelopment ? developmentIconPath : undefined,
    backgroundColor: '#f7f3ec',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDevelopment) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL as string)
    window.webContents.openDevTools({ mode: 'detach' })
    return
  }

  window.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  if (isDevelopment && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(developmentIconPath)
  }
  ipcMain.handle('app-info', () => ({
    name: 'Agentic Todos Desktop',
    version: '0.1.0',
    platform: process.platform,
    apiBaseURL,
  }))
  ipcMain.handle('auth:current-user', () => currentUser())
  ipcMain.handle('auth:login-google', () => loginWithGoogle())
  ipcMain.handle('auth:logout', () => logout())
  ipcMain.handle('todos:list', () => listTodos())
  ipcMain.handle('todos:create', (_event, input: CreateTodoInput) => createTodo(input))
  ipcMain.handle('todos:update', (_event, id: string, input: UpdateTodoInput) => updateTodo(id, input))
  ipcMain.handle('todos:reorder', (_event, todoIDs: string[]) => reorderOpenTodos(todoIDs))
  ipcMain.handle('todos:delete', (_event, id: string) => deleteTodo(id))
  ipcMain.handle('connected-agents:list', () => listConnectedAgents())
  ipcMain.handle('connected-agents:update', (_event, id: ConnectedAgentID, enabled: boolean) =>
    updateConnectedAgent(id, enabled),
  )
  ipcMain.handle('connected-agents:set-default', (_event, id: ConnectedAgentID) => setDefaultConnectedAgent(id))
  ipcMain.handle('todos:run-with-agent', (_event, todoID: string, agentID: ConnectedAgentID) =>
    runTodoWithAgent(todoID, agentID),
  )

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
