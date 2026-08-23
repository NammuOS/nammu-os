import React, { useState, useEffect, useMemo } from 'react';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Pin,
  PinOff,
  Tag,
  Copy,
  Check,
  Download,
  Eye,
  Edit3,
  Folder,
  Star,
  Clock,
  Hash,
  Sparkles,
  BookOpen,
} from 'lucide-react';

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  folder: 'work' | 'personal' | 'ideas' | 'archive';
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

const INITIAL_NOTES: NoteItem[] = [
  {
    id: 'note-1',
    title: 'Nammu OS Architecture Overview',
    content: `# Nammu OS Architecture Overview\n\nNammu OS is a high-performance, browser-native operating system designed with an ultra-sleek cyberpunk visual language.\n\n### Core Tenets\n- **Micro-Window Manager**: Smooth dragging, floating, snapping, and minimizing with full taskbar sync.\n- **Zero-Eval Tool Engine**: AST-parsed mathematical expressions with high accuracy and safety.\n- **Unified System State**: Reactive event bus connecting audio, taskbar, cloud storage, and system settings.\n\n### Active Tasks\n- [x] Implement Calculator Suite with Cloud sidebar\n- [x] Full Taskbar volume sync with mouse-wheel popover\n- [ ] Persist workspace layouts`,
    folder: 'work',
    tags: ['Architecture', 'React', 'Nammu'],
    pinned: true,
    createdAt: Date.now() - 86400000 * 2,
    updatedAt: Date.now() - 3600000,
  },
  {
    id: 'note-2',
    title: 'Orbit Satellite Telemetry Protocol',
    content: `# Orbit Satellite Telemetry\n\nDirect carrier downlink telemetry notes:\n- Frequency band: 2.4 GHz ISM / S-band\n- Jitter buffer: 12ms target\n- Modulation: QPSK with forward error correction.\n\n*Check antenna azimuth during next pass.*`,
    folder: 'ideas',
    tags: ['Orbit', 'Telemetry', 'Hardware'],
    pinned: false,
    createdAt: Date.now() - 86400000 * 4,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: 'note-3',
    title: 'Weekly Focus & Goals',
    content: `# Weekly Focus\n\n1. Complete Nammu OS 4.1 polish.\n2. Review test suite and build bundle sizes.\n3. Implement persistent notes and calendar schedules.\n4. Design sound effects feedback for OS window events.`,
    folder: 'personal',
    tags: ['Productivity', 'Goals'],
    pinned: false,
    createdAt: Date.now() - 86400000 * 5,
    updatedAt: Date.now() - 86400000 * 2,
  },
];

export function NotesApp() {
  const [notes, setNotes] = useState<NoteItem[]>(() => {
    try {
      const saved = localStorage.getItem('nammu-notes');
      return saved ? JSON.parse(saved) : INITIAL_NOTES;
    } catch {
      return INITIAL_NOTES;
    }
  });

  const [activeNoteId, setActiveNoteId] = useState<string>(() => {
    return notes[0]?.id || '';
  });

  const [activeFolder, setActiveFolder] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newTagInput, setNewTagInput] = useState('');

  // Persist notes
  useEffect(() => {
    try {
      localStorage.setItem('nammu-notes', JSON.stringify(notes));
    } catch {}
  }, [notes]);

  const activeNote = useMemo(() => {
    return notes.find((n) => n.id === activeNoteId) || notes[0] || null;
  }, [notes, activeNoteId]);

  // Create new note
  const handleCreateNote = () => {
    const newNote: NoteItem = {
      id: `note-${Date.now()}`,
      title: 'Untitled Note',
      content: '',
      folder: activeFolder === 'all' || activeFolder === 'archive' ? 'work' : (activeFolder as any),
      tags: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setNotes((prev) => [newNote, ...prev]);
    setActiveNoteId(newNote.id);
    setPreviewMode(false);
  };

  // Update active note field
  const updateNote = (field: Partial<NoteItem>) => {
    if (!activeNote) return;
    setNotes((prev) =>
      prev.map((n) => (n.id === activeNote.id ? { ...n, ...field, updatedAt: Date.now() } : n)),
    );
  };

  // Delete note
  const deleteNote = (id: string) => {
    setNotes((prev) => {
      const filtered = prev.filter((n) => n.id !== id);
      if (activeNoteId === id && filtered.length > 0) {
        setActiveNoteId(filtered[0].id);
      }
      return filtered;
    });
  };

  // Toggle pin
  const togglePin = (id: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  };

  // Tag management
  const addTag = () => {
    if (!newTagInput.trim() || !activeNote) return;
    const tag = newTagInput.trim();
    if (!activeNote.tags.includes(tag)) {
      updateNote({ tags: [...activeNote.tags, tag] });
    }
    setNewTagInput('');
  };

  const removeTag = (tagToRemove: string) => {
    if (!activeNote) return;
    updateNote({ tags: activeNote.tags.filter((t) => t !== tagToRemove) });
  };

  // Copy note
  const copyNote = () => {
    if (!activeNote) return;
    navigator.clipboard.writeText(`${activeNote.title}\n\n${activeNote.content}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Download note as Markdown
  const downloadNote = () => {
    if (!activeNote) return;
    const blob = new Blob([`${activeNote.title}\n\n${activeNote.content}`], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeNote.title.replace(/[^a-z0-9_-]/gi, '_') || 'note'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // All distinct tags across all notes
  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => n.tags?.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [notes]);

  // Filtered notes list
  const filteredNotes = useMemo(() => {
    return notes
      .filter((n) => {
        const matchesFolder = activeFolder === 'all' || n.folder === activeFolder;
        const matchesTag = selectedTag === 'all' || n.tags?.includes(selectedTag);
        const matchesQuery =
          !searchQuery.trim() ||
          n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          n.content.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesFolder && matchesTag && matchesQuery;
      })
      .sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.updatedAt - a.updatedAt;
      });
  }, [notes, activeFolder, selectedTag, searchQuery]);

  // Statistics
  const words = activeNote
    ? activeNote.content.trim()
      ? activeNote.content.trim().split(/\s+/).length
      : 0
    : 0;
  const chars = activeNote ? activeNote.content.length : 0;
  const readingTime = Math.ceil(words / 200);

  return (
    <div className="flex h-full min-h-0 bg-[#05080d] text-[11px] select-none">
      {/* Left Folders & Tags Sidebar */}
      <aside className="w-40 shrink-0 border-r border-white/[0.06] bg-white/[0.012] p-2 flex flex-col justify-between select-none">
        <div className="flex-1 overflow-y-auto os-scrollbar">
          <button
            onClick={handleCreateNote}
            className="w-full mb-3 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[3px] bg-[#4aa3ff]/15 border border-[#4aa3ff]/30 text-[#8ec4ff] hover:bg-[#4aa3ff]/25 transition-colors font-medium text-[11px]"
          >
            <Plus size={12} /> New Note
          </button>

          {/* Folders */}
          <div className="mb-3">
            <div className="mb-1 px-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
              Folders
            </div>
            <div className="space-y-0.5">
              {[
                { id: 'all', label: 'All Notes', count: notes.length },
                {
                  id: 'work',
                  label: 'Work',
                  count: notes.filter((n) => n.folder === 'work').length,
                },
                {
                  id: 'personal',
                  label: 'Personal',
                  count: notes.filter((n) => n.folder === 'personal').length,
                },
                {
                  id: 'ideas',
                  label: 'Ideas',
                  count: notes.filter((n) => n.folder === 'ideas').length,
                },
                {
                  id: 'archive',
                  label: 'Archive',
                  count: notes.filter((n) => n.folder === 'archive').length,
                },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setActiveFolder(f.id);
                    setSelectedTag('all');
                  }}
                  className={`flex w-full items-center justify-between rounded-[3px] px-2 py-1.5 text-left text-[10.5px] transition-colors ${
                    activeFolder === f.id
                      ? 'bg-[#4aa3ff]/10 text-[#cfe6ff] font-medium border-l-2 border-[#4aa3ff]'
                      : 'text-[#71889d] hover:bg-white/[0.035] hover:text-[#bcd0df]'
                  }`}
                >
                  <span className="truncate">{f.label}</span>
                  <span className="font-mono text-[8px] text-[#476077]">{f.count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div>
              <div className="mb-1 px-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#476077]">
                Tags
              </div>
              <div className="space-y-0.5">
                <button
                  onClick={() => setSelectedTag('all')}
                  className={`flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1 text-left text-[10px] ${
                    selectedTag === 'all'
                      ? 'text-[#8ec4ff] font-semibold'
                      : 'text-[#71889d] hover:text-[#bcd0df]'
                  }`}
                >
                  <Hash size={10} /> All Tags
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag)}
                    className={`flex w-full items-center gap-1.5 rounded-[3px] px-2 py-1 text-left text-[10px] truncate ${
                      selectedTag === tag
                        ? 'text-[#8ec4ff] font-semibold'
                        : 'text-[#71889d] hover:text-[#bcd0df]'
                    }`}
                  >
                    <Tag size={10} /> {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-white/[0.05] font-mono text-[8px] text-[#476077] px-1">
          {notes.length} total notes
        </div>
      </aside>

      {/* Note List Pane */}
      <div className="w-56 shrink-0 border-r border-white/[0.06] flex flex-col bg-[#060a12]/70">
        {/* Search */}
        <div className="p-2 border-b border-white/[0.05]">
          <div className="flex items-center gap-1.5 border border-white/[0.06] bg-black/30 px-2 py-1 rounded-[3px]">
            <Search size={10} className="text-[#4aa3ff]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="min-w-0 flex-1 bg-transparent text-[9.5px] text-[#c9d8e4] outline-none"
            />
          </div>
        </div>

        {/* Notes Items List */}
        <div className="flex-1 overflow-y-auto os-scrollbar p-1 space-y-1">
          {filteredNotes.length === 0 ? (
            <div className="text-center py-8 text-[10px] text-[#476077]">No matching notes</div>
          ) : (
            filteredNotes.map((note) => {
              const isSelected = activeNote?.id === note.id;
              return (
                <div
                  key={note.id}
                  onClick={() => setActiveNoteId(note.id)}
                  className={`p-2 rounded-[3px] border transition-all cursor-pointer group ${
                    isSelected
                      ? 'border-[#4aa3ff]/40 bg-[#4aa3ff]/10 shadow-sm'
                      : 'border-white/[0.03] hover:border-white/[0.08] hover:bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-[11px] font-medium truncate ${isSelected ? 'text-[#e2e8f0]' : 'text-[#a6b8c7]'}`}
                    >
                      {note.title || 'Untitled'}
                    </span>
                    {note.pinned && <Pin size={10} className="text-[#4aa3ff] shrink-0" />}
                  </div>

                  <p className="text-[9.5px] text-[#61788c] truncate mt-0.5">
                    {note.content.replace(/^#+\s+/g, '') || 'Empty note...'}
                  </p>

                  <div className="flex items-center justify-between font-mono text-[7.5px] text-[#476077] mt-1.5">
                    <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                    <span className="capitalize">{note.folder}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Editor & Content Pane */}
      {activeNote ? (
        <section className="flex-1 flex flex-col min-w-0 bg-[#05080d]">
          {/* Top Note Action Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05] bg-white/[0.01]">
            <div className="flex items-center gap-2">
              <select
                value={activeNote.folder}
                onChange={(e) => updateNote({ folder: e.target.value as any })}
                className="os-input font-mono text-[9px] bg-[#090e18] px-1.5 py-0.5"
              >
                <option value="work">Work</option>
                <option value="personal">Personal</option>
                <option value="ideas">Ideas</option>
                <option value="archive">Archive</option>
              </select>

              <button
                onClick={() => togglePin(activeNote.id)}
                className={`p-1 rounded transition-colors ${
                  activeNote.pinned
                    ? 'text-[#4aa3ff] bg-[#4aa3ff]/15'
                    : 'text-[#547086] hover:text-[#bcd0df]'
                }`}
                title={activeNote.pinned ? 'Unpin note' : 'Pin note to top'}
              >
                <Pin size={12} />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setPreviewMode(!previewMode)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-mono border transition-colors ${
                  previewMode
                    ? 'border-[#4aa3ff]/50 bg-[#4aa3ff]/15 text-[#8ec4ff]'
                    : 'border-white/[0.06] text-[#71889d] hover:text-white'
                }`}
              >
                {previewMode ? <Edit3 size={10} /> : <Eye size={10} />}
                {previewMode ? 'Edit' : 'Preview'}
              </button>

              <button
                onClick={copyNote}
                className="p-1 rounded text-[#71889d] hover:text-[#bcd0df] transition-colors"
                title="Copy Markdown"
              >
                {copied ? <Check size={12} className="text-[#2ee6a6]" /> : <Copy size={12} />}
              </button>

              <button
                onClick={downloadNote}
                className="p-1 rounded text-[#71889d] hover:text-[#bcd0df] transition-colors"
                title="Download .md"
              >
                <Download size={12} />
              </button>

              <button
                onClick={() => deleteNote(activeNote.id)}
                className="p-1 rounded text-[#71889d] hover:text-[#f43f5e] transition-colors"
                title="Delete note"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>

          {/* Title input */}
          <div className="px-5 pt-3 pb-1">
            <input
              type="text"
              value={activeNote.title}
              onChange={(e) => updateNote({ title: e.target.value })}
              placeholder="Note Title"
              className="w-full bg-transparent text-base font-semibold text-[#e8eef4] outline-none border-b border-transparent focus:border-white/[0.08] pb-1"
            />
          </div>

          {/* Tags bar */}
          <div className="px-5 py-1.5 flex flex-wrap items-center gap-1">
            {activeNote.tags?.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] text-[8.5px] font-mono text-[#8aa0b2]"
              >
                #{t}
                <button onClick={() => removeTag(t)} className="hover:text-[#f43f5e]">
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTag()}
              placeholder="+ add tag"
              className="bg-transparent text-[8.5px] font-mono text-[#547086] outline-none w-16"
            />
          </div>

          {/* Editor / Preview Body */}
          <div className="flex-1 min-h-0 overflow-y-auto os-scrollbar px-5 py-3">
            {previewMode ? (
              <div className="prose prose-invert max-w-none text-[12px] leading-relaxed text-[#c6d7e6] space-y-2 whitespace-pre-wrap font-sans">
                {activeNote.content || (
                  <span className="text-[#476077]">Empty note content...</span>
                )}
              </div>
            ) : (
              <textarea
                value={activeNote.content}
                onChange={(e) => updateNote({ content: e.target.value })}
                placeholder="Write your note with Markdown formatting..."
                spellCheck={false}
                className="w-full h-full resize-none bg-transparent font-mono text-[11.5px] leading-relaxed text-[#c5d4e0] outline-none"
              />
            )}
          </div>

          {/* Bottom stats footer */}
          <div className="flex items-center justify-between px-5 py-1.5 border-t border-white/[0.05] font-mono text-[8px] text-[#476077]">
            <div className="flex items-center gap-3">
              <span>{words} words</span>
              <span>{chars} characters</span>
              <span>{readingTime} min read</span>
            </div>
            <div>
              Updated{' '}
              {new Date(activeNote.updatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </section>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[#476077]">
          <FileText size={32} strokeWidth={1.2} className="mb-2 text-[#243547]" />
          <p className="text-xs">No note selected</p>
          <button
            onClick={handleCreateNote}
            className="mt-3 px-3 py-1.5 rounded bg-os-accent/20 border border-os-accent/40 text-os-accent text-[11px]"
          >
            Create a new note
          </button>
        </div>
      )}
    </div>
  );
}
