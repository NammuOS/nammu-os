export const PROJECT_CATEGORIES = ['All', 'Web', 'Desktop', 'Mobile'] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

export interface PortfolioProject {
  id: string;
  title: string;
  subtitle: string;
  category: Exclude<ProjectCategory, 'All'>;
  description: string;
  url: string;
  domain: string;
  preview?: string;
  accent: string;
  technologies: string[];
}

/**
 * The public portfolio collection. Add future work here and the Projects app
 * will automatically include it in search, category counts, and the gallery.
 */
export const PORTFOLIO_PROJECTS: PortfolioProject[] = [
  {
    id: 'navtube',
    title: 'NavTube',
    subtitle: 'YouTube Clone',
    category: 'Web',
    description:
      'A faithful video discovery experience with familiar navigation, topic filters, subscriptions, and a responsive content feed.',
    url: 'https://navtube.vercel.app/',
    domain: 'navtube.vercel.app',
    preview: '/images/projects/navtube.png',
    accent: '#ff3b5c',
    technologies: ['React', 'Responsive UI', 'Content discovery'],
  },
  {
    id: 'hoobank',
    title: 'HooBank',
    subtitle: 'Modern Banking Website',
    category: 'Web',
    description:
      'A polished fintech landing experience combining strong typography, layered product visuals, and responsive marketing sections.',
    url: 'https://hoobankk.vercel.app/',
    domain: 'hoobankk.vercel.app',
    preview: '/images/projects/hoobank.png',
    accent: '#5ce1e6',
    technologies: ['React', 'Tailwind CSS', 'Landing page'],
  },
  {
    id: 'macos-clone',
    title: 'macOS Clone',
    subtitle: 'Browser Desktop Experience',
    category: 'Desktop',
    description:
      'A browser-based desktop study with a macOS-inspired menu bar, dock, wallpaper system, and application workspace.',
    url: 'https://nammu-os.vercel.app/',
    domain: 'nammu-os.vercel.app',
    preview: '/images/projects/nammu-os.png',
    accent: '#a98cff',
    technologies: ['Next.js', 'React', 'Desktop UI'],
  },
  {
    id: 'timeless-pages',
    title: 'Timeless Pages',
    subtitle: 'Online Bookstore',
    category: 'Web',
    description:
      'An editorial bookstore concept designed to make discovering books feel calm, curated, and beautifully readable.',
    url: 'https://timeless-pages.vercel.app/',
    domain: 'timeless-pages.vercel.app',
    accent: '#d9ae75',
    technologies: ['React', 'Commerce UI', 'Editorial design'],
  },
];

export function filterPortfolioProjects(
  projects: PortfolioProject[],
  query: string,
  category: ProjectCategory,
) {
  const normalizedQuery = query.trim().toLowerCase();

  return projects.filter((project) => {
    const matchesCategory = category === 'All' || project.category === category;
    const searchableText = [
      project.title,
      project.subtitle,
      project.category,
      project.description,
      project.domain,
      ...project.technologies,
    ]
      .join(' ')
      .toLowerCase();

    return matchesCategory && (!normalizedQuery || searchableText.includes(normalizedQuery));
  });
}
