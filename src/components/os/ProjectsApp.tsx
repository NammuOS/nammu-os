import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderKanban,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  Circle,
  Archive,
  Play,
  Clock,
  Check,
  Layers,
  AlertCircle,
  X,
  ChevronRight,
  ListTodo,
  Sparkles,
  Filter,
  MoreVertical,
} from 'lucide-react';

export interface ProjectTask {
  id: string;
  title: string;
  completed: boolean;
  priority?: 'low' | 'medium' | 'high';
}

export interface ProjectItem {
  id: string;
  name: string;
  space: string;
  description: string;
  status: 'active' | 'in-progress' | 'completed' | 'archived';
  color: string;
  dueDate?: string;
  tasks: ProjectTask[];
  createdAt: number;
}

const INITIAL_PROJECTS: ProjectItem[] = [
  {
    id: 'proj-1',
    name: 'Core Runtime',
    space: 'Deep Work',
    description: 'Strict-mode runtime, WebAssembly optimization, and residual checks',
    status: 'in-progress',
    color: '#4aa3ff',
    dueDate: '2026-09-01',
    tasks: [
      {
        id: 't-1',
        title: 'Implement safe AST parser for calculators',
        completed: true,
        priority: 'high',
      },
      {
        id: 't-2',
        title: 'Integrate dynamic taskbar volume event bus',
        completed: true,
        priority: 'medium',
      },
      {
        id: 't-3',
        title: 'Compile WebAssembly micro-kernels for audio synthesis',
        completed: false,
        priority: 'high',
      },
      {
        id: 't-4',
        title: 'Benchmark memory allocation overhead',
        completed: false,
        priority: 'low',
      },
    ],
    createdAt: Date.now() - 86400000 * 5,
  },
  {
    id: 'proj-2',
    name: 'Night Horizon Visuals',
    space: 'Studio',
    description: 'Visual study, cybernetic shaders, and final render handoff',
    status: 'active',
    color: '#6ec8d4',
    dueDate: '2026-09-15',
    tasks: [
      {
        id: 't-5',
        title: 'Refine glassmorphism window reflections',
        completed: true,
        priority: 'medium',
      },
      {
        id: 't-6',
        title: 'Create CRT scanline phosphor pulse overlay',
        completed: false,
        priority: 'medium',
      },
    ],
    createdAt: Date.now() - 86400000 * 3,
  },
  {
    id: 'proj-3',
    name: 'Polar Window Downlink',
    space: 'Field',
    description: 'Satellite visibility, telemetry carrier signals, and doppler correction',
    status: 'archived',
    color: '#2ee6a6',
    dueDate: '2026-08-15',
    tasks: [
      {
        id: 't-7',
        title: 'Verify S-band antenna array coordinates',
        completed: true,
        priority: 'high',
      },
      { id: 't-8', title: 'Log carrier lock time-series', completed: true, priority: 'medium' },
    ],
    createdAt: Date.now() - 86400000 * 10,
  },
];

const SPACES = ['All Spaces', 'Deep Work', 'Studio', 'Field', 'DevOps'];
const COLOR_PRESETS = ['#4aa3ff', '#2ee6a6', '#6ec8d4', '#a855f7', '#f59e0b', '#f43f5e'];

export function ProjectsApp() {
  const [projects, setProjects] = useState<ProjectItem[]>(() => {
    try {
      const saved = localStorage.getItem('nammu-projects');
      return saved ? JSON.parse(saved) : INITIAL_PROJECTS;
    } catch {
      return INITIAL_PROJECTS;
    }
  });

  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return projects[0]?.id || '';
  });

  const [spaceFilter, setSpaceFilter] = useState('All Spaces');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Project Form
  const [newName, setNewName] = useState('');
  const [newSpace, setNewSpace] = useState('Deep Work');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState('#4aa3ff');
  const [newDueDate, setNewDueDate] = useState('');

  // Task Input in active project
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');

  // Persist projects
  useEffect(() => {
    try {
      localStorage.setItem('nammu-projects', JSON.stringify(projects));
    } catch {}
  }, [projects]);

  const activeProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) || projects[0] || null;
  }, [projects, selectedProjectId]);

  // Create Project
  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newProj: ProjectItem = {
      id: `proj-${Date.now()}`,
      name: newName.trim(),
      space: newSpace,
      description: newDescription.trim() || 'Active project workspace',
      status: 'active',
      color: newColor,
      dueDate: newDueDate || undefined,
      tasks: [],
      createdAt: Date.now(),
    };

    setProjects((prev) => [newProj, ...prev]);
    setSelectedProjectId(newProj.id);
    setNewName('');
    setNewDescription('');
    setShowCreateModal(false);
  };

  // Add Task to active project
  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !activeProject) return;

    const task: ProjectTask = {
      id: `task-${Date.now()}`,
      title: newTaskTitle.trim(),
      completed: false,
      priority: newTaskPriority,
    };

    setProjects((prev) =>
      prev.map((p) => (p.id === activeProject.id ? { ...p, tasks: [...p.tasks, task] } : p)),
    );
    setNewTaskTitle('');
  };

  // Toggle task completion
  const toggleTask = (projectId: string, taskId: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== projectId) return p;
        const updatedTasks = p.tasks.map((t) =>
          t.id === taskId ? { ...t, completed: !t.completed } : t,
        );
        const allDone = updatedTasks.length > 0 && updatedTasks.every((t) => t.completed);
        return {
          ...p,
          tasks: updatedTasks,
          status: allDone ? 'completed' : p.status === 'completed' ? 'in-progress' : p.status,
        };
      }),
    );
  };

  // Delete task
  const deleteTask = (projectId: string, taskId: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p,
      ),
    );
  };

  // Toggle project status (active <-> archived)
  const toggleArchiveProject = (id: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: p.status === 'archived' ? 'active' : 'archived' } : p,
      ),
    );
  };

  // Delete project
  const deleteProject = (id: string) => {
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      if (selectedProjectId === id && filtered.length > 0) {
        setSelectedProjectId(filtered[0].id);
      }
      return filtered;
    });
  };

  // Filtered projects list
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      const matchesSpace = spaceFilter === 'All Spaces' || p.space === spaceFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && p.status !== 'archived') ||
        (statusFilter === 'archived' && p.status === 'archived');
      const matchesQuery =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSpace && matchesStatus && matchesQuery;
    });
  }, [projects, spaceFilter, statusFilter, searchQuery]);

  return (
    <div className="flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Left Projects Sidebar */}
      <aside className="w-60 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
        <div className="flex-1 overflow-y-auto os-scrollbar pr-1">
          {/* Action button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="w-full mb-2.5 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[3px] bg-[#4aa3ff]/15 border border-[#4aa3ff]/30 text-[#8ec4ff] hover:bg-[#4aa3ff]/25 transition-colors font-medium text-[11px]"
          >
            <Plus size={12} /> New Project
          </button>

          {/* Quick Search */}
          <div className="mb-2 flex items-center gap-1.5 border border-white/[0.06] bg-black/30 px-2 py-1 rounded-[3px]">
            <Search size={10} className="text-[#4aa3ff]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter environments..."
              className="min-w-0 flex-1 bg-transparent text-[9.5px] text-[#c9d8e4] outline-none"
            />
          </div>

          {/* Spaces / Status Filters */}
          <div className="mb-2 space-y-1">
            <div className="flex gap-1 overflow-x-auto os-scrollbar pb-1">
              {(['active', 'all', 'archived'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-1.5 py-0.5 rounded text-[8.5px] font-mono capitalize transition-colors ${
                    statusFilter === st
                      ? 'bg-white/[0.08] text-[#cfe6ff] font-semibold border border-white/10'
                      : 'text-[#61788c] hover:text-[#9eb2c4]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <select
              value={spaceFilter}
              onChange={(e) => setSpaceFilter(e.target.value)}
              className="w-full os-input font-mono text-[9px] bg-[#090d14] px-1.5 py-1"
            >
              {SPACES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Project List */}
          <div className="space-y-1 mt-2">
            {filteredProjects.length === 0 ? (
              <div className="text-center py-8 text-[10px] text-[#476077]">No projects found</div>
            ) : (
              filteredProjects.map((proj) => {
                const isSelected = activeProject?.id === proj.id;
                const totalTasks = proj.tasks.length;
                const doneTasks = proj.tasks.filter((t) => t.completed).length;
                const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

                return (
                  <div
                    key={proj.id}
                    onClick={() => setSelectedProjectId(proj.id)}
                    className={`p-2 rounded-[3px] border transition-all cursor-pointer group relative ${
                      isSelected
                        ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/10 shadow-sm'
                        : 'border-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-1.5 h-6 rounded-full shrink-0"
                        style={{ background: proj.color, boxShadow: `0 0 6px ${proj.color}40` }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span
                            className={`text-[11px] font-medium truncate ${isSelected ? 'text-[#e2e8f0]' : 'text-[#a6b8c7]'}`}
                          >
                            {proj.name}
                          </span>
                          <span className="font-mono text-[7px] uppercase tracking-wider text-[#547086]">
                            {proj.status}
                          </span>
                        </div>
                        <div className="font-mono text-[8px] text-[#52697c] truncate mt-0.5">
                          {proj.space} · {totalTasks} tasks ({progressPct}%)
                        </div>
                      </div>
                    </div>

                    {/* Mini Progress Line */}
                    {totalTasks > 0 && (
                      <div className="mt-1.5 h-0.5 bg-white/[0.05] rounded-full overflow-hidden">
                        <div
                          className="h-full transition-all duration-300"
                          style={{ width: `${progressPct}%`, background: proj.color }}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="pt-2 border-t border-white/[0.05] font-mono text-[8px] text-[#476077] px-1 flex justify-between items-center">
          <span>{projects.length} environments</span>
          <span>{projects.filter((p) => p.status === 'active').length} active</span>
        </div>
      </aside>

      {/* Project Details & Task Execution Board */}
      {activeProject ? (
        <section className="flex-1 flex flex-col min-w-0 bg-[#05080d]">
          {/* Project Header Banner */}
          <div className="p-4 border-b border-white/[0.06] bg-white/[0.01] flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{
                    background: activeProject.color,
                    boxShadow: `0 0 8px ${activeProject.color}`,
                  }}
                />
                <h1 className="text-sm font-semibold text-[#e8eef4] truncate">
                  {activeProject.name}
                </h1>
                <span className="px-1.5 py-0.2 rounded bg-white/[0.04] border border-white/[0.06] text-[8px] font-mono text-[#8aa0b2] uppercase">
                  {activeProject.space}
                </span>
                <span className="px-1.5 py-0.2 rounded bg-[#4aa3ff]/10 text-[8px] font-mono text-[#8ec4ff] uppercase">
                  {activeProject.status}
                </span>
              </div>

              <p className="text-[10.5px] text-[#8aa0b2] mt-1 leading-relaxed">
                {activeProject.description}
              </p>

              {activeProject.dueDate && (
                <div className="flex items-center gap-1 font-mono text-[8.5px] text-[#547086] mt-1.5">
                  <Clock size={9} /> Target Completion: {activeProject.dueDate}
                </div>
              )}
            </div>

            {/* Top Project Action Buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => toggleArchiveProject(activeProject.id)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[9.5px] text-[#8aa0b2] transition-colors"
                title={activeProject.status === 'archived' ? 'Restore project' : 'Archive project'}
              >
                {activeProject.status === 'archived' ? <Play size={10} /> : <Archive size={10} />}
                {activeProject.status === 'archived' ? 'Activate' : 'Archive'}
              </button>

              <button
                onClick={() => deleteProject(activeProject.id)}
                className="p-1 rounded bg-white/[0.04] hover:bg-[#f43f5e]/20 text-[#8aa0b2] hover:text-[#f43f5e] transition-colors"
                title="Delete project"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Task Progress Bar */}
          <div className="px-4 py-2 border-b border-white/[0.04] bg-black/20 flex items-center justify-between font-mono text-[8.5px] text-[#71889d]">
            <div className="flex items-center gap-2">
              <ListTodo size={11} className="text-[#4aa3ff]" />
              <span>
                {activeProject.tasks.filter((t) => t.completed).length} of{' '}
                {activeProject.tasks.length} tasks completed
              </span>
            </div>
            <span>
              {activeProject.tasks.length > 0
                ? Math.round(
                    (activeProject.tasks.filter((t) => t.completed).length /
                      activeProject.tasks.length) *
                      100,
                  )
                : 0}
              %
            </span>
          </div>

          {/* Add New Task Form */}
          <form
            onSubmit={handleAddTask}
            className="p-3 border-b border-white/[0.04] flex items-center gap-2"
          >
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="+ Add task or action item..."
              className="flex-1 os-input text-xs"
            />
            <select
              value={newTaskPriority}
              onChange={(e) => setNewTaskPriority(e.target.value as any)}
              className="os-input font-mono text-[9.5px] bg-[#090e18]"
            >
              <option value="low">Low Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="high">High Priority</option>
            </select>
            <button
              type="submit"
              className="px-2.5 py-1.5 rounded bg-os-accent/20 border border-os-accent/40 text-os-accent hover:bg-os-accent/30 text-[10px] font-medium transition-colors"
            >
              Add Task
            </button>
          </form>

          {/* Task List */}
          <div className="flex-1 overflow-y-auto os-scrollbar p-3 space-y-1.5">
            {activeProject.tasks.length === 0 ? (
              <div className="text-center py-12 text-[10.5px] text-[#476077]">
                No action items yet. Add a task to start tracking progress.
              </div>
            ) : (
              activeProject.tasks.map((task) => {
                const isHigh = task.priority === 'high';
                const isMedium = task.priority === 'medium';
                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-2.5 p-2 rounded border bg-white/[0.015] transition-all group ${
                      task.completed
                        ? 'opacity-50 border-white/[0.02]'
                        : 'border-white/[0.04] hover:border-white/[0.08]'
                    }`}
                  >
                    <button
                      onClick={() => toggleTask(activeProject.id, task.id)}
                      className="text-os-text-muted hover:text-os-accent transition-colors shrink-0"
                    >
                      {task.completed ? (
                        <CheckCircle2 size={13} className="text-[#2ee6a6]" />
                      ) : (
                        <Circle size={13} />
                      )}
                    </button>

                    <span
                      className={`flex-1 text-[11px] leading-tight ${
                        task.completed ? 'line-through text-[#547086]' : 'text-[#d5e0ea]'
                      }`}
                    >
                      {task.title}
                    </span>

                    {task.priority && (
                      <span
                        className={`font-mono text-[7.5px] uppercase px-1 py-0.2 rounded border ${
                          isHigh
                            ? 'bg-[#f43f5e]/10 text-[#fda4af] border-[#f43f5e]/30'
                            : isMedium
                              ? 'bg-[#f59e0b]/10 text-[#fcd34d] border-[#f59e0b]/30'
                              : 'bg-white/[0.04] text-[#8aa0b2] border-white/[0.06]'
                        }`}
                      >
                        {task.priority}
                      </span>
                    )}

                    <button
                      onClick={() => deleteTask(activeProject.id, task.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[#547086] hover:text-[#f43f5e] transition-opacity"
                      title="Delete task"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[#476077]">
          <FolderKanban size={32} strokeWidth={1.2} className="mb-2 text-[#243547]" />
          <p className="text-xs">No project selected</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-3 px-3 py-1.5 rounded bg-os-accent/20 border border-os-accent/40 text-os-accent text-[11px]"
          >
            Create environment
          </button>
        </div>
      )}

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#090e18] border border-os-border/50 rounded-md p-4 w-full max-w-sm shadow-2xl animate-fade-in space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
              <span className="text-xs font-semibold text-[#d5e0ea] flex items-center gap-1.5">
                <FolderKanban size={12} className="text-os-accent" /> Create Project Environment
              </span>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-os-text-muted hover:text-os-text"
              >
                <X size={13} />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-2.5">
              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Project Name</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Telemetry Engine"
                  className="os-input w-full text-xs"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">
                    Workspace Space
                  </label>
                  <select
                    value={newSpace}
                    onChange={(e) => setNewSpace(e.target.value)}
                    className="os-input w-full text-xs bg-[#05080d]"
                  >
                    {SPACES.filter((s) => s !== 'All Spaces').map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Target Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="os-input w-full font-mono text-[10px]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Accent Color</label>
                <div className="flex gap-2">
                  {COLOR_PRESETS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setNewColor(col)}
                      className={`w-5 h-5 rounded-full border transition-all ${
                        newColor === col
                          ? 'border-white scale-110 shadow-[0_0_8px_white]'
                          : 'border-transparent opacity-70'
                      }`}
                      style={{ background: col }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9.5px] text-[#8aa0b2] block mb-0.5">Description</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Project goals, scope, and technical intent..."
                  className="os-input w-full text-xs h-16 resize-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.05]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1 text-[11px] rounded bg-white/[0.04] text-[#8aa0b2] hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1 text-[11px] rounded bg-os-accent text-black font-semibold hover:bg-os-accent/90"
                >
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
