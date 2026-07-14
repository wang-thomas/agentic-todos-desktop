import { FormEvent, useEffect, useMemo, useState } from 'react'

type Filter = 'open' | 'running' | 'done'
type View = 'tasks' | 'connected-agents'

const filters: Array<{ key: Filter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
]

const connectedAgentLabels: Record<ConnectedAgentID, string> = {
  codex: 'Codex',
  claude_desktop: 'Claude Desktop',
  perplexity: 'Perplexity',
}

const connectedAgentDescriptions: Record<ConnectedAgentID, string> = {
  codex: 'Use Codex for coding tasks and repo-aware implementation work.',
  claude_desktop: 'Use Claude Desktop for app-assisted reasoning and document-heavy tasks.',
  perplexity: 'Use Perplexity Desktop for research and web-answer workflows.',
}

function App() {
  const [todos, setTodos] = useState<ServerTodo[]>([])
  const [connectedAgents, setConnectedAgents] = useState<ServerConnectedAgent[]>([])
  const [user, setUser] = useState<ServerUser | null>(null)
  const [view, setView] = useState<View>('tasks')
  const [filter, setFilter] = useState<Filter>('open')
  const [draft, setDraft] = useState('')
  const [openRunMenuTodoID, setOpenRunMenuTodoID] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [runningTodoID, setRunningTodoID] = useState<string | null>(null)
  const [runPromptDialog, setRunPromptDialog] = useState<ServerRunPrompt | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadSession()
  }, [])

  const counts = useMemo(
    () => ({
      open: todos.filter((todo) => todo.status === 'pending').length,
      running: todos.filter((todo) => todo.status === 'running').length,
      done: todos.filter((todo) => todo.status === 'completed' || todo.status === 'failed').length,
    }),
    [todos],
  )

  const visibleTodos = useMemo(() => {
    if (filter === 'running') {
      return todos.filter((todo) => todo.status === 'running')
    }
    if (filter === 'done') {
      return todos.filter((todo) => todo.status === 'completed' || todo.status === 'failed')
    }
    return todos.filter((todo) => todo.status === 'pending')
  }, [filter, todos])

  async function loadSession() {
    if (!window.agenticTodos) {
      setError('Desktop bridge is unavailable.')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const currentUser = await window.agenticTodos.currentUser()
      setUser(currentUser)
      if (!currentUser) {
        setTodos([])
        setConnectedAgents([])
        return
      }
      const [serverTodos, serverConnectedAgents] = await Promise.all([
        window.agenticTodos.listTodos(),
        window.agenticTodos.listConnectedAgents(),
      ])
      setTodos(serverTodos)
      setConnectedAgents(serverConnectedAgents)
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setIsLoading(false)
    }
  }

  async function loadTodos() {
    if (!user || !window.agenticTodos) {
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      setTodos(await window.agenticTodos.listTodos())
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setIsLoading(false)
    }
  }

  async function login() {
    if (!window.agenticTodos) {
      return
    }
    setIsLoggingIn(true)
    setError(null)
    try {
      const loggedInUser = await window.agenticTodos.loginWithGoogle()
      setUser(loggedInUser)
      const [serverTodos, serverConnectedAgents] = await Promise.all([
        window.agenticTodos.listTodos(),
        window.agenticTodos.listConnectedAgents(),
      ])
      setTodos(serverTodos)
      setConnectedAgents(serverConnectedAgents)
    } catch (loginError) {
      setError(messageFrom(loginError))
    } finally {
      setIsLoggingIn(false)
      setIsLoading(false)
    }
  }

  async function logout() {
    if (!window.agenticTodos) {
      return
    }
    await window.agenticTodos.logout()
    setUser(null)
    setTodos([])
    setConnectedAgents([])
    setDraft('')
    setView('tasks')
    setFilter('open')
  }

  async function toggleConnectedAgent(agentID: ConnectedAgentID, enabled: boolean) {
    if (!window.agenticTodos || !user) {
      return
    }
    setError(null)
    try {
      const updated = await window.agenticTodos.updateConnectedAgent(agentID, enabled)
      setConnectedAgents((current) =>
        current.map((agent) => (agent.id === updated.id ? updated : agent)),
      )
    } catch (updateError) {
      setError(messageFrom(updateError))
    }
  }

  async function addTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const title = draft.trim()
    if (!title || !window.agenticTodos || !user) {
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      const created = await window.agenticTodos.createTodo({ title })
      setTodos((current) => [created, ...current])
      setDraft('')
      setFilter('open')
    } catch (saveError) {
      setError(messageFrom(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  async function toggleTodo(todo: ServerTodo) {
    if (!window.agenticTodos) {
      return
    }

    const nextStatus: TodoStatus = todo.status === 'completed' ? 'pending' : 'completed'
    setError(null)
    try {
      const updated = await window.agenticTodos.updateTodo(todo.id, {
        title: todo.title,
        notes: todo.notes,
        status: nextStatus,
      })
      replaceTodo(updated)
    } catch (updateError) {
      setError(messageFrom(updateError))
    }
  }

  async function deleteTodo(todoID: string) {
    if (!window.agenticTodos) {
      return
    }

    setError(null)
    try {
      await window.agenticTodos.deleteTodo(todoID)
      setTodos((current) => current.filter((todo) => todo.id !== todoID))
    } catch (deleteError) {
      setError(messageFrom(deleteError))
    }
  }

  async function runTodoWithAgent(todoID: string, agentID: ConnectedAgentID) {
    if (!window.agenticTodos) {
      return
    }
    setRunningTodoID(todoID)
    setOpenRunMenuTodoID(null)
    setError(null)
    try {
      const runPrompt = await window.agenticTodos.runTodoWithAgent(todoID, agentID)
      setRunPromptDialog(runPrompt)
    } catch (runError) {
      setError(messageFrom(runError))
    } finally {
      setRunningTodoID(null)
    }
  }

  function replaceTodo(updated: ServerTodo) {
    setTodos((current) => current.map((todo) => (todo.id === updated.id ? updated : todo)))
  }

  const openCount = counts.open + counts.running
  const completedCount = counts.done
  const enabledAgents = connectedAgents.filter((agent) => agent.enabled)

  if (!user) {
    return (
      <main className="auth-shell">
        <div className="window-drag" />
        <div className="login-panel">
          <div>
            <p className="eyebrow">Agentic Todos Desktop</p>
            <h2>{isLoading ? 'Loading' : 'Sign in'}</h2>
          </div>
          <p>Your tasks are saved to your account and stay separate from everyone else’s.</p>
          {isLoading ? (
            <div className="empty-state compact">
              <h3>Checking session</h3>
              <p>Looking for an existing login.</p>
            </div>
          ) : (
            <button className="login-button" disabled={isLoggingIn} onClick={() => void login()} type="button">
              {isLoggingIn ? 'Opening Google' : 'Continue with Google'}
            </button>
          )}
          {error ? (
            <div className="notice" role="alert">
              <strong>Login failed</strong>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="window-drag" />
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <p className="eyebrow">Agentic Todos</p>
            <h1>Tasks</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="Task filters">
          <button
            className={view === 'connected-agents' ? 'nav-item active' : 'nav-item'}
            onClick={() => setView('connected-agents')}
            type="button"
          >
            <span>Connected Agents</span>
            <span className="nav-count">{connectedAgents.filter((agent) => agent.enabled).length}</span>
          </button>
          <div className="nav-divider" />
          {filters.map((item) => (
            <button
              className={view === 'tasks' && filter === item.key ? 'nav-item active' : 'nav-item'}
              key={item.key}
              onClick={() => {
                setView('tasks')
                setFilter(item.key)
              }}
              type="button"
            >
              <span>{item.label}</span>
              <span className="nav-count">{counts[item.key]}</span>
            </button>
          ))}
        </nav>

        {user ? (
          <div className="account-panel">
            <p className="section-label">Signed in</p>
            <strong>{user.display_name}</strong>
            <span>{user.email}</span>
          </div>
        ) : null}

        {user ? (
          <div className="sidebar-actions">
            <button className="refresh-button" onClick={() => void loadTodos()} type="button">
              Refresh
            </button>
            <button className="secondary-button" onClick={() => void logout()} type="button">
              Sign out
            </button>
          </div>
        ) : null}
      </aside>

      <section className="content">
        {view === 'tasks' ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">Desktop workspace</p>
                <h2>{filters.find((item) => item.key === filter)?.label}</h2>
              </div>
              <div className="stats" aria-label="Task summary">
                <div>
                  <strong>{openCount}</strong>
                  <span>Open</span>
                </div>
                <div>
                  <strong>{completedCount}</strong>
                  <span>Done</span>
                </div>
              </div>
            </header>

            <form className="quick-add" onSubmit={addTodo}>
              <span className="plus" aria-hidden="true">
                +
              </span>
              <input
                aria-label="Add a task"
                disabled={isSaving}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a task"
                value={draft}
              />
              <button disabled={isSaving} type="submit">
                {isSaving ? 'Adding' : 'Add'}
              </button>
            </form>

            {error ? (
              <div className="notice" role="alert">
                <strong>Action failed</strong>
                <span>{error}</span>
              </div>
            ) : null}

            <div className="task-list" aria-label={`${filter} tasks`}>
              {isLoading ? (
                <div className="empty-state">
                  <h3>Loading tasks</h3>
                  <p>Connecting to Agentic Todos Server.</p>
                </div>
              ) : null}

              {!isLoading
                ? visibleTodos.map((todo) => (
                    <article className={todo.status === 'completed' ? 'task completed' : 'task'} key={todo.id}>
                      <button
                        aria-label={
                          todo.status === 'completed' ? `Mark ${todo.title} open` : `Mark ${todo.title} done`
                        }
                        className="check-button"
                        onClick={() => void toggleTodo(todo)}
                        type="button"
                      >
                        {todo.status === 'completed' ? '✓' : ''}
                      </button>
                      <div className="task-main">
                        <h3>{todo.title}</h3>
                        <div className="task-meta">
                          <span>{todo.notes || 'No notes'}</span>
                          <span>{formatDate(todo.updated_at)}</span>
                        </div>
                      </div>
                      {todo.status !== 'pending' ? (
                        <span className={`priority ${todo.status}`}>{todo.status}</span>
                      ) : null}
                      {todo.status === 'pending' ? (
                        <div className="run-task-menu">
                          <button
                            className="run-task-button"
                            disabled={runningTodoID === todo.id}
                            onClick={() =>
                              setOpenRunMenuTodoID((current) => (current === todo.id ? null : todo.id))
                            }
                            type="button"
                          >
                            <span>{runningTodoID === todo.id ? 'Opening' : 'Run task'}</span>
                            <span className="run-task-caret" aria-hidden="true" />
                          </button>
                          {openRunMenuTodoID === todo.id ? (
                            <div className="run-task-options">
                              {enabledAgents.length > 0 ? (
                                enabledAgents.map((agent) => (
                                  <button
                                    key={agent.id}
                                    onClick={() => void runTodoWithAgent(todo.id, agent.id)}
                                    type="button"
                                  >
                                    {connectedAgentLabels[agent.id]}
                                  </button>
                                ))
                              ) : (
                                <span>No connected agents</span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  ))
                : null}

              {!isLoading && visibleTodos.length === 0 ? (
                <div className="empty-state">
                  <h3>No tasks here</h3>
                  <p>Add a task or switch filters to keep moving.</p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <section className="connected-page">
            <header className="topbar">
              <div>
                <p className="eyebrow">Desktop workspace</p>
                <h2>Connected Agents</h2>
              </div>
            </header>

            {error ? (
              <div className="notice" role="alert">
                <strong>Could not update agents</strong>
                <span>{error}</span>
              </div>
            ) : null}

            <div className="agent-selector-list">
              {connectedAgents.map((agent) => (
                <label className="agent-selector-row" key={agent.id}>
                  <div>
                    <strong>{connectedAgentLabels[agent.id]}</strong>
                    <span>{connectedAgentDescriptions[agent.id]}</span>
                  </div>
                  <input
                    checked={agent.enabled}
                    onChange={(event) => void toggleConnectedAgent(agent.id, event.target.checked)}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </section>
        )}
      </section>

      {runPromptDialog ? (
        <div
          aria-labelledby="run-prompt-title"
          aria-modal="true"
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRunPromptDialog(null)
            }
          }}
          role="dialog"
        >
          <section className="run-prompt-dialog">
            <div className="run-prompt-header">
              <div className="clipboard-badge" aria-hidden="true" />
              <div>
                <p className="eyebrow">{connectedAgentLabels[runPromptDialog.agent_id]}</p>
                <h2 id="run-prompt-title">Prompt copied</h2>
              </div>
            </div>
            <p className="run-prompt-copy">
              The task prompt is on your clipboard and ready to paste into the app that just opened.
            </p>
            <pre className="run-prompt-preview">{runPromptDialog.prompt}</pre>
            <div className="run-prompt-actions">
              <button className="secondary-button" onClick={() => setRunPromptDialog(null)} type="button">
                Close
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function messageFrom(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  return 'Unexpected connection error.'
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Recently'
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export default App
