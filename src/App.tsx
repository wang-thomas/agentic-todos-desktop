import { DragEvent, FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

type Filter = 'open' | 'running' | 'done'
type View = 'tasks' | 'connected-agents'
type DropPlacement = 'before' | 'after'

const filters: Array<{ key: Filter; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
]

const reorderThreshold = 0.68

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
  const [draggedTodoID, setDraggedTodoID] = useState<string | null>(null)
  const [dropTargetTodoID, setDropTargetTodoID] = useState<string | null>(null)
  const [dropPlacement, setDropPlacement] = useState<DropPlacement>('before')
  const [isReordering, setIsReordering] = useState(false)
  const [runPromptDialog, setRunPromptDialog] = useState<ServerRunPrompt | null>(null)
  const [detailTodoID, setDetailTodoID] = useState<string | null>(null)
  const [detailTitle, setDetailTitle] = useState('')
  const [detailNotes, setDetailNotes] = useState('')
  const [isSavingDetails, setIsSavingDetails] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taskNodes = useRef(new Map<string, HTMLElement>())
  const previousTaskPositions = useRef(new Map<string, DOMRect>())
  const dragOriginTodos = useRef<ServerTodo[] | null>(null)
  const liveTodos = useRef<ServerTodo[]>([])
  const dropHandled = useRef(false)

  useEffect(() => {
    void loadSession()
  }, [])

  useLayoutEffect(() => {
    if (previousTaskPositions.current.size === 0) {
      return
    }
    for (const [todoID, element] of taskNodes.current) {
      const previous = previousTaskPositions.current.get(todoID)
      if (!previous) {
        continue
      }
      const next = element.getBoundingClientRect()
      const deltaY = previous.top - next.top
      if (deltaY !== 0) {
        element.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
      }
    }
    previousTaskPositions.current.clear()
  }, [todos])

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
    setDetailTodoID(null)
    setView('tasks')
    setFilter('open')
  }

  async function toggleConnectedAgent(agentID: ConnectedAgentID, enabled: boolean) {
    if (!window.agenticTodos || !user) {
      return
    }
    setError(null)
    try {
      await window.agenticTodos.updateConnectedAgent(agentID, enabled)
      setConnectedAgents(await window.agenticTodos.listConnectedAgents())
    } catch (updateError) {
      setError(messageFrom(updateError))
    }
  }

  async function setDefaultConnectedAgent(agentID: ConnectedAgentID) {
    if (!window.agenticTodos || !user) {
      return
    }
    setError(null)
    try {
      await window.agenticTodos.setDefaultConnectedAgent(agentID)
      setConnectedAgents(await window.agenticTodos.listConnectedAgents())
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
      if (detailTodoID === todoID) {
        setDetailTodoID(null)
      }
    } catch (deleteError) {
      setError(messageFrom(deleteError))
    }
  }

  function openTodoDetails(todo: ServerTodo) {
    if (draggedTodoID) {
      return
    }
    setDetailTodoID(todo.id)
    setDetailTitle(todo.title)
    setDetailNotes(todo.notes)
    setError(null)
  }

  function closeTodoDetails() {
    if (!isSavingDetails) {
      setDetailTodoID(null)
    }
  }

  async function saveTodoDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.agenticTodos || !detailTodoID) {
      return
    }
    const todo = todos.find((current) => current.id === detailTodoID)
    const title = detailTitle.trim()
    if (!todo || !title) {
      setError('A task description is required.')
      return
    }

    setIsSavingDetails(true)
    setError(null)
    try {
      const updated = await window.agenticTodos.updateTodo(todo.id, {
        title,
        notes: detailNotes.trim(),
        status: todo.status,
      })
      replaceTodo(updated)
      setDetailTitle(updated.title)
      setDetailNotes(updated.notes)
      setDetailTodoID(null)
    } catch (saveError) {
      setError(messageFrom(saveError))
    } finally {
      setIsSavingDetails(false)
    }
  }

  async function saveOpenTodoOrder(reorderedTodos: ServerTodo[], previousTodos: ServerTodo[]) {
    if (!window.agenticTodos || isReordering) {
      return
    }

    const openTodoIDs = reorderedTodos
      .filter((todo) => todo.status === 'pending')
      .map((todo) => todo.id)
    const previousOpenTodoIDs = previousTodos
      .filter((todo) => todo.status === 'pending')
      .map((todo) => todo.id)
    if (openTodoIDs.length === 0 || openTodoIDs.every((todoID, index) => todoID === previousOpenTodoIDs[index])) {
      return
    }

    setIsReordering(true)
    setError(null)
    try {
      await window.agenticTodos.reorderOpenTodos(openTodoIDs)
    } catch (reorderError) {
      captureTaskPositions()
      liveTodos.current = previousTodos
      setTodos(previousTodos)
      setError(messageFrom(reorderError))
    } finally {
      setIsReordering(false)
    }
  }

  function captureTaskPositions() {
    previousTaskPositions.current = new Map(
      Array.from(taskNodes.current, ([todoID, element]) => {
        element.getAnimations().forEach((animation) => animation.cancel())
        return [todoID, element.getBoundingClientRect()]
      }),
    )
  }

  function previewOpenTodoOrder(draggedID: string, targetID: string, placement: DropPlacement) {
    const reorderedTodos = moveOpenTodo(liveTodos.current, draggedID, targetID, placement)
    if (reorderedTodos === liveTodos.current) {
      return reorderedTodos
    }
    captureTaskPositions()
    liveTodos.current = reorderedTodos
    setTodos(reorderedTodos)
    return reorderedTodos
  }

  function beginDrag(event: DragEvent<HTMLElement>, todoID: string) {
    if (isReordering) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', todoID)
    const taskRow = event.currentTarget.closest<HTMLElement>('.task')
    if (taskRow) {
      const bounds = taskRow.getBoundingClientRect()
      event.dataTransfer.setDragImage(taskRow, event.clientX - bounds.left, event.clientY - bounds.top)
    }
    dragOriginTodos.current = todos
    liveTodos.current = todos
    dropHandled.current = false
    setDraggedTodoID(todoID)
  }

  function previewPlacementFor(event: DragEvent<HTMLElement>, sourceID: string, targetID: string): DropPlacement | null {
    const openTodos = liveTodos.current.filter((todo) => todo.status === 'pending')
    const sourceIndex = openTodos.findIndex((todo) => todo.id === sourceID)
    const targetIndex = openTodos.findIndex((todo) => todo.id === targetID)
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
      return null
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const pointerPosition = (event.clientY - bounds.top) / bounds.height
    if (sourceIndex < targetIndex) {
      return pointerPosition >= reorderThreshold ? 'after' : null
    }
    return pointerPosition <= 1 - reorderThreshold ? 'before' : null
  }

  function dragOverTodo(event: DragEvent<HTMLElement>, todoID: string) {
    if (isReordering) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const sourceID = draggedTodoID ?? event.dataTransfer.getData('text/plain')
    if (!sourceID || sourceID === todoID) {
      setDropTargetTodoID(null)
      return
    }
    const placement = previewPlacementFor(event, sourceID, todoID)
    if (!placement) {
      setDropTargetTodoID(null)
      return
    }
    setDropTargetTodoID(todoID)
    setDropPlacement(placement)
    previewOpenTodoOrder(sourceID, todoID, placement)
  }

  function dropOnTodo(event: DragEvent<HTMLElement>, targetID: string) {
    event.preventDefault()
    const sourceID = draggedTodoID ?? event.dataTransfer.getData('text/plain')
    const previousTodos = dragOriginTodos.current
    let reorderedTodos = liveTodos.current
    const placement = sourceID ? previewPlacementFor(event, sourceID, targetID) : null
    if (sourceID && placement) {
      reorderedTodos = previewOpenTodoOrder(sourceID, targetID, placement)
    }
    dropHandled.current = true
    setDraggedTodoID(null)
    setDropTargetTodoID(null)
    setDropPlacement('before')
    if (previousTodos) {
      void saveOpenTodoOrder(reorderedTodos, previousTodos)
    }
  }

  function endDrag() {
    if (!dropHandled.current && dragOriginTodos.current) {
      captureTaskPositions()
      liveTodos.current = dragOriginTodos.current
      setTodos(dragOriginTodos.current)
    }
    dragOriginTodos.current = null
    dropHandled.current = false
    setDraggedTodoID(null)
    setDropTargetTodoID(null)
    setDropPlacement('before')
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
  const defaultAgent = enabledAgents.find((agent) => agent.is_default) ?? enabledAgents[0]
  const detailTodo = todos.find((todo) => todo.id === detailTodoID) ?? null

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
            <div className="account-details">
              <p className="section-label">Signed in</p>
              <strong>{user.display_name}</strong>
              <span>{user.email}</span>
            </div>
            <button className="account-sign-out" onClick={() => void logout()} type="button">
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

            {filter === 'open' ? (
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
            ) : null}

            {error ? (
              <div className="notice" role="alert">
                <strong>Action failed</strong>
                <span>{error}</span>
              </div>
            ) : null}

            <div className={filter === 'open' ? 'task-list reorderable' : 'task-list'} aria-label={`${filter} tasks`}>
              {filter === 'open' && visibleTodos.length > 1 ? (
                <div className="reorder-hint">
                  <span className="reorder-hint-label">Priority order</span>
                  <span>Drag the grip to set what comes next</span>
                </div>
              ) : null}
              {isLoading ? (
                <div className="empty-state">
                  <h3>Loading tasks</h3>
                  <p>Connecting to Agentic Todos Server.</p>
                </div>
              ) : null}

              {!isLoading
                ? visibleTodos.map((todo) => (
                    <article
                      className={`${todo.status === 'completed' ? 'task completed' : 'task'}${
                        dropTargetTodoID === todo.id ? ` drop-${dropPlacement}` : ''
                      }${draggedTodoID === todo.id ? ' dragging' : ''}${
                        todo.status === 'pending' ? ' reorderable-task' : ' static-task'
                      }${openRunMenuTodoID === todo.id ? ' menu-open' : ''}`}
                      key={todo.id}
                      onClick={() => openTodoDetails(todo)}
                      onDragOver={todo.status === 'pending' ? (event) => dragOverTodo(event, todo.id) : undefined}
                      onDrop={todo.status === 'pending' ? (event) => dropOnTodo(event, todo.id) : undefined}
                      ref={(element) => {
                        if (element) {
                          taskNodes.current.set(todo.id, element)
                        } else {
                          taskNodes.current.delete(todo.id)
                        }
                      }}
                    >
                      {todo.status === 'pending' ? (
                        <button
                          aria-label={`Drag to reorder ${todo.title}`}
                          className="drag-handle"
                          draggable={!isReordering}
                          onClick={(event) => event.stopPropagation()}
                          onDragEnd={endDrag}
                          onDragStart={(event) => beginDrag(event, todo.id)}
                          type="button"
                        >
                          <span className="grip-dots" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                            <i />
                            <i />
                            <i />
                          </span>
                        </button>
                      ) : null}
                      <button
                        aria-label={
                          todo.status === 'completed' ? `Mark ${todo.title} open` : `Mark ${todo.title} done`
                        }
                        className="check-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void toggleTodo(todo)
                        }}
                        type="button"
                      />
                      <div className="task-main">
                        <h3>{todo.title}</h3>
                        <div className="task-meta">
                          <span>{formatDate(todo.updated_at)}</span>
                        </div>
                      </div>
                      {todo.status !== 'pending' ? (
                        <span className={`priority ${todo.status}`}>{todo.status}</span>
                      ) : null}
                      {todo.status === 'pending' ? (
                        <div className="run-task-menu" onClick={(event) => event.stopPropagation()}>
                          <div className="run-task-split">
                            <button
                              className="run-task-button run-task-begin"
                              disabled={runningTodoID === todo.id || !defaultAgent}
                              onClick={() => defaultAgent && void runTodoWithAgent(todo.id, defaultAgent.id)}
                              title={defaultAgent ? `Begin with ${connectedAgentLabels[defaultAgent.id]}` : 'Choose a default connected agent'}
                              type="button"
                            >
                              {runningTodoID === todo.id ? 'Opening' : 'Begin'}
                            </button>
                            <button
                              aria-expanded={openRunMenuTodoID === todo.id}
                              aria-label={`Choose an agent for ${todo.title}`}
                              className="run-task-button run-task-dropdown"
                              disabled={runningTodoID === todo.id}
                              onClick={() =>
                                setOpenRunMenuTodoID((current) => (current === todo.id ? null : todo.id))
                              }
                              type="button"
                            >
                              <span className="run-task-caret" aria-hidden="true" />
                            </button>
                          </div>
                          {openRunMenuTodoID === todo.id ? (
                            <div className="run-task-options">
                              {enabledAgents.length > 0 ? (
                                enabledAgents.map((agent) => (
                                  <button
                                    key={agent.id}
                                    onClick={() => void runTodoWithAgent(todo.id, agent.id)}
                                    type="button"
                                  >
                                    {connectedAgentLabels[agent.id]}{agent.id === defaultAgent?.id ? ' · Default' : ''}
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
                <div className="agent-selector-row" key={agent.id}>
                  <div>
                    <strong>{connectedAgentLabels[agent.id]}</strong>
                    <span>{connectedAgentDescriptions[agent.id]}</span>
                  </div>
                  <div className="agent-selector-actions">
                    <button
                      className={agent.id === defaultAgent?.id ? 'default-agent-button selected' : 'default-agent-button'}
                      disabled={!agent.enabled || agent.id === defaultAgent?.id}
                      onClick={() => void setDefaultConnectedAgent(agent.id)}
                      type="button"
                    >
                      {agent.id === defaultAgent?.id ? 'Default' : 'Make default'}
                    </button>
                    <label className="agent-enabled-toggle">
                      <span className="sr-only">Enable {connectedAgentLabels[agent.id]}</span>
                      <input
                        checked={agent.enabled}
                        onChange={(event) => void toggleConnectedAgent(agent.id, event.target.checked)}
                        type="checkbox"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>

      {detailTodo ? (
        <div className="task-details-layer">
          <button aria-label="Close task details" className="task-details-backdrop" onClick={closeTodoDetails} type="button" />
          <aside aria-labelledby="task-details-title" aria-modal="true" className="task-details-panel" role="dialog">
            <header className="task-details-header">
              <div>
                <p className="eyebrow">Task details</p>
                <h2 id="task-details-title">Edit task</h2>
              </div>
              <button aria-label="Close task details" className="task-details-close" onClick={closeTodoDetails} type="button" />
            </header>

            <form className="task-details-form" onSubmit={saveTodoDetails}>
              <label>
                <span>Task description</span>
                <input
                  disabled={isSavingDetails}
                  onChange={(event) => setDetailTitle(event.target.value)}
                  value={detailTitle}
                />
              </label>
              <label>
                <span>Notes for your agent</span>
                <textarea
                  disabled={isSavingDetails}
                  onChange={(event) => setDetailNotes(event.target.value)}
                  placeholder="Add context, constraints, links, or success criteria…"
                  rows={10}
                  value={detailNotes}
                />
              </label>
              <p className="task-details-note">Notes are included when you begin this task with an agent.</p>
              <div className="task-details-actions">
                <button className="secondary-button" disabled={isSavingDetails} onClick={closeTodoDetails} type="button">
                  Cancel
                </button>
                <button className="task-details-save" disabled={isSavingDetails} type="submit">
                  {isSavingDetails ? 'Saving' : 'Save changes'}
                </button>
              </div>
            </form>
          </aside>
        </div>
      ) : null}

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

function moveOpenTodo(
  todos: ServerTodo[],
  draggedID: string,
  targetID: string,
  placement: DropPlacement,
): ServerTodo[] {
  const openTodos = todos.filter((todo) => todo.status === 'pending')
  const draggedIndex = openTodos.findIndex((todo) => todo.id === draggedID)
  const targetIndex = openTodos.findIndex((todo) => todo.id === targetID)
  if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) {
    return todos
  }

  const reorderedOpenTodos = [...openTodos]
  const [draggedTodo] = reorderedOpenTodos.splice(draggedIndex, 1)
  let insertionIndex = targetIndex + (placement === 'after' ? 1 : 0)
  if (draggedIndex < insertionIndex) {
    insertionIndex -= 1
  }
  reorderedOpenTodos.splice(insertionIndex, 0, draggedTodo)
  return [...reorderedOpenTodos, ...todos.filter((todo) => todo.status !== 'pending')]
}

export default App
