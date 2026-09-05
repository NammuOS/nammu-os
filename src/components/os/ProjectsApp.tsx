import { useMemo, useState } from 'react';
import { BookOpen, Check, Copy, ExternalLink, Globe2, Search } from 'lucide-react';
import {
  filterPortfolioProjects,
  PORTFOLIO_PROJECTS,
  PROJECT_CATEGORIES,
  type PortfolioProject,
  type ProjectCategory,
} from '../../lib/portfolioProjects';
import { getPlatformCapabilities } from '../../platform';

function ProjectPreview({ project }: { project: PortfolioProject }) {
  if (project.preview) {
    return (
      <img
        src={project.preview}
        alt={`${project.title} website preview`}
        className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.025]"
        draggable={false}
      />
    );
  }

  return (
    <div
      className="relative grid h-full w-full place-items-center overflow-hidden"
      style={{
        background: `radial-gradient(circle at 70% 20%, ${project.accent}38, transparent 36%), linear-gradient(145deg, color-mix(in srgb, ${project.accent} 18%, var(--color-os-bg)), var(--color-os-bg))`,
      }}
    >
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:28px_28px]" />
      <div className="relative flex items-end gap-2" aria-hidden="true">
        {[68, 92, 78, 106, 84].map((height, index) => (
          <span
            key={height}
            className="block w-8 border border-white/15 shadow-2xl"
            style={{
              height,
              background: index % 2 ? `${project.accent}35` : 'rgba(255,255,255,.055)',
            }}
          />
        ))}
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-2 text-white/70">
        <BookOpen size={16} />
        <span className="text-xs font-medium tracking-wide">Bookstore preview</span>
      </div>
    </div>
  );
}

export function ProjectsApp() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visibleProjects = useMemo(
    () => filterPortfolioProjects(PORTFOLIO_PROJECTS, query, category),
    [category, query],
  );

  const copyProjectLink = async (project: PortfolioProject) => {
    const result = await getPlatformCapabilities().clipboard.writeText(project.url);
    if (result.status === 'success') {
      setCopiedId(project.id);
      window.setTimeout(
        () => setCopiedId((current) => (current === project.id ? null : current)),
        1600,
      );
    } else {
      setCopiedId(null);
    }
  };

  const openProject = async (project: PortfolioProject) => {
    await getPlatformCapabilities().external.openUrl(project.url);
  };

  return (
    <div className="projects-app flex h-full min-h-0 flex-col bg-os-bg text-os-text">
      <header className="shrink-0 border-b border-os-text/10 bg-os-panel/45 px-5 py-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-os-text">
              Project portfolio
            </h1>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-os-text-muted">
              Products, interfaces, and experiments I have designed and built for the web.
            </p>
          </div>

          <div className="rounded-sm border border-os-text/10 bg-os-surface/35 px-4 py-2.5">
            <div>
              <div className="font-display text-lg font-semibold leading-none text-os-text">
                {PORTFOLIO_PROJECTS.length}
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-wider text-os-text-muted">
                Projects
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="flex min-w-52 flex-1 items-center gap-2 rounded-sm border border-os-text/10 bg-os-bg/65 px-3 py-2 focus-within:border-os-accent/50">
            <Search size={14} className="shrink-0 text-os-text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, technologies, or categories"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-os-text outline-none placeholder:text-os-text-dim"
            />
          </label>
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-sm border border-os-text/10 bg-os-bg/45 p-1 os-scrollbar">
            {PROJECT_CATEGORIES.map((item) => {
              const count =
                item === 'All'
                  ? PORTFOLIO_PROJECTS.length
                  : PORTFOLIO_PROJECTS.filter((project) => project.category === item).length;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setCategory(item)}
                  aria-pressed={category === item}
                  className={`flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] transition-colors ${
                    category === item
                      ? 'bg-os-accent/15 text-os-accent'
                      : 'text-os-text-muted hover:bg-os-text/5 hover:text-os-text'
                  }`}
                >
                  {item}
                  <span className="font-mono text-[9px] opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto os-scrollbar">
        <div className="mx-auto max-w-7xl p-5">
          <section>
            {visibleProjects.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleProjects.map((project, index) => (
                  <article
                    key={project.id}
                    className="group flex min-w-0 flex-col overflow-hidden rounded-sm border border-os-text/10 bg-os-panel/35 transition-all hover:-translate-y-0.5 hover:border-os-text/20 hover:bg-os-panel/60 hover:shadow-[0_16px_38px_rgba(0,0,0,.16)]"
                  >
                    <div className="relative aspect-[16/8.5] overflow-hidden border-b border-os-text/10">
                      <ProjectPreview project={project} />
                      <span className="absolute top-2 left-2 rounded-sm border border-black/10 bg-black/60 px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-white/80 backdrop-blur-md">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-os-text-dim">
                        {project.category}
                      </div>
                      <h3 className="mt-2 flex items-center gap-2 text-[15px] font-semibold text-os-text">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            background: project.accent,
                            boxShadow: `0 0 9px ${project.accent}`,
                          }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{project.title}</span>
                      </h3>
                      <p
                        className="mt-0.5 text-[11px] font-medium"
                        style={{ color: project.accent }}
                      >
                        {project.subtitle}
                      </p>
                      <p className="mt-3 line-clamp-2 text-[11px] leading-[1.55] text-os-text-muted">
                        {project.description}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {project.technologies.map((technology) => (
                          <span
                            key={technology}
                            className="rounded-sm border border-os-text/10 bg-os-text/5 px-2 py-1 font-mono text-[8.5px] text-os-text-muted"
                          >
                            {technology}
                          </span>
                        ))}
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-t border-os-text/10 pt-3">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate font-mono text-[9px] text-os-text-dim">
                          <Globe2 size={11} className="shrink-0" /> {project.domain}
                        </span>
                        <button
                          type="button"
                          onClick={() => void openProject(project)}
                          title={`Open ${project.title}`}
                          aria-label={`Open ${project.title}`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-os-text/10 bg-os-text/5 text-os-text-muted transition-colors hover:border-os-accent/35 hover:bg-os-accent/12 hover:text-os-accent"
                        >
                          <ExternalLink size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyProjectLink(project)}
                          title={
                            copiedId === project.id ? 'Link copied' : `Copy ${project.title} link`
                          }
                          aria-label={
                            copiedId === project.id ? 'Link copied' : `Copy ${project.title} link`
                          }
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-sm border transition-colors ${
                            copiedId === project.id
                              ? 'border-os-emerald/35 bg-os-emerald/10 text-os-emerald'
                              : 'border-os-text/10 bg-os-text/5 text-os-text-muted hover:border-os-accent/35 hover:bg-os-accent/12 hover:text-os-accent'
                          }`}
                        >
                          {copiedId === project.id ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid min-h-56 place-items-center rounded-sm border border-dashed border-os-text/15 bg-os-panel/20 px-6 text-center">
                <div>
                  <Search size={22} className="mx-auto text-os-text-dim" />
                  <p className="mt-3 text-[13px] font-medium text-os-text">No matching projects</p>
                  <p className="mt-1 text-[11px] text-os-text-muted">
                    Try another technology, title, or discipline.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setCategory('All');
                    }}
                    className="mt-3 text-[11px] text-os-accent hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            )}
          </section>

          <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-os-text/10 py-3 font-mono text-[9px] uppercase tracking-wider text-os-text-dim">
            <span>More work will be added to this collection</span>
            <span className="flex items-center gap-1.5">
              <ExternalLink size={10} /> Project links open in a new tab
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
