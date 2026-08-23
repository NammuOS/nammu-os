# Nammu OS 🌌

[![CI Pipeline](https://github.com/nammu-os/nammu-os/actions/workflows/ci.yml/badge.svg)](https://github.com/nammu-os/nammu-os/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun%201.3-black.svg)](https://bun.sh/)
[![Next.js](https://img.shields.io/badge/Next.js-15%20App%20Router-black.svg)](https://nextjs.org/)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596be.svg)](https://trpc.io/)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Supabase-336791.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Cache-Redis%20%2F%20Upstash-DC382D.svg)](https://redis.io/)

**Nammu OS** is a unicorn-grade web operating system featuring multi-cloud storage virtualization, 50+ built-in developer & media suites, windowing environments, dynamic audio workspace, and complete full-stack integration.

---

## 🏛️ Architecture Overview

```
                                  [ User / Browser ]
                                          │
                                 (HTTPS / WebSocket)
                                          ▼
                       ┌─────────────────────────────────────┐
                       │      Next.js 15 App Router          │
                       │   (React 19, Turbopack, SSR/SSG)    │
                       └──────────────────┬──────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
      ┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
      │   Desktop UI & Apps   │ │    tRPC v11 API   │ │ Next.js Route Handler │
      │ Windowing, Context,   │ │ Auth, Files, Sync │ │ OAuth, Storage, Proxy │
      │ 50+ Integrated Tools  │ │ Notes, Projects   │ │ Telemetry & Probes    │
      └───────────────────────┘ └─────────┬─────────┘ └───────────┬───────────┘
                                          │                       │
                                          ▼                       ▼
                       ┌─────────────────────────────────────┐
                       │        Drizzle ORM + Redis          │
                       │   PostgreSQL / Supabase Connection  │
                       └──────────────────┬──────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
            Google Drive              OneDrive                 Dropbox
            MEGA / Yandex             AWS S3 Storage           pCloud
```

---

## 🚀 Key Features

- 🖥️ **Native Desktop Windowing System**: Multi-window management, docking, snapping, drag-and-drop, taskbar, start menu, and deep contextual menus.
- ☁️ **Unified Multi-Cloud Virtualization**: Striping and aggregation across Google Drive, Microsoft OneDrive, Dropbox, MEGA, Yandex Disk, AWS S3, and pCloud.
- 🛠️ **50+ Built-in Native Tools**:
  - **Developer Tools**: JSON Formatter, Regex Tester, Diff Checker, Minifiers, JWT Inspector, UUID/Hash generators.
  - **Media Processors**: Image/Video/Audio converters, WebP/AVIF compressors, MP4 transcoders, Waveform analyzers, ID3 taggers.
  - **PDF Suite**: PDF Merge, Split, Compress, Watermarking, Metadata stripper, Password protection.
  - **Calculators & Converters**: Unit matrices, Subnet CIDR calculators, Luhn check engines, Timezone clocks.
- 🎵 **Spatial Ambient Music Suite**: Real-time canvas audio visualizer, frequency spectrum analyzer, custom stream synthesis.
- 🔒 **End-to-End Type Safety**: 100% TypeScript with strict compiler validation, Zod runtime parsers, and type-safe tRPC client-server contracts.
- ⚡ **Bun-Powered Performance**: Fast package resolution, sub-second unit tests (`bun test`), and multi-stage container optimization.

---

## 📦 Technology Stack

| Layer                    | Technologies                                                                                                                                                                          |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Runtime & Tooling**    | [Bun](https://bun.sh/) 1.3+, [TypeScript](https://www.typescriptlang.org/) 5.9, [ESLint](https://eslint.org/) 9, [Prettier](https://prettier.io/)                                     |
| **Framework & Frontend** | [Next.js](https://nextjs.org/) 15 (App Router), [React](https://react.dev/) 19, [Tailwind CSS](https://tailwindcss.com/) v4                                                           |
| **API & RPC**            | [tRPC](https://trpc.io/) v11, [TanStack Query](https://tanstack.com/query/latest), Next.js Server Actions                                                                             |
| **Database & Cache**     | [Drizzle ORM](https://orm.drizzle.team/), [PostgreSQL](https://www.postgresql.org/) / [Supabase](https://supabase.com/), [Redis](https://redis.io/) / [Upstash](https://upstash.com/) |
| **DevOps & Deploy**      | [Docker](https://www.docker.com/), [Kubernetes](https://kubernetes.io/), [Cloudflare](https://www.cloudflare.com/), GitHub Actions                                                    |

---

## ⚡ Quick Start

### Prerequisites

- [Bun](https://bun.sh/) 1.3+ installed (`curl -fsSL https://bun.sh/install | bash` or `powershell -c "irm bun.sh/install.ps1 | iex"`)
- Node.js 20+ (optional fallback)

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/nammu-os/nammu-os.git
cd nammu-os

# Install dependencies using Bun
bun install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your database URL and optional cloud provider credentials.

### 3. Database Migration

```bash
# Push schema to database
bun run db:push

# Or generate SQL migrations
bun run db:generate
```

### 4. Start Development Server

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Development & Quality Commands

```bash
# Start development server
bun dev

# Run full test suite with Bun
bun test

# Typecheck workspace with TypeScript
bun run typecheck

# Check and fix code style with ESLint
bun run lint
bun run lint:fix

# Format codebase with Prettier
bun run format
bun run format:check

# Production build
bun run build

# Start production server
bun start

# Launch Drizzle Studio (Database GUI)
bun run db:studio
```

---

## 🐳 Docker & Kubernetes Deployment

### Docker Compose

Run the complete stack (Next.js app, PostgreSQL 16, Redis 7):

```bash
docker compose up -d --build
```

### Kubernetes Deployment

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml
```

---

## 📁 Repository Structure

```
├── .github/workflows/         # Automated CI/CD pipelines (Bun setup, lint, typecheck, test, build)
├── drizzle/                   # Drizzle ORM SQL migration snapshots
├── k8s/                       # Kubernetes manifests (Deployment, HPA, Ingress, Services)
├── public/                    # Static assets, wallpapers, and icons
├── src/
│   ├── app/                   # Next.js App Router (Layout, Page, Actions, API Route Handlers)
│   ├── components/
│   │   ├── desktop/           # Master Desktop windowing manager (DesktopApp.tsx)
│   │   ├── os/                # Desktop shell, Taskbar, StartMenu, Rail, Music workspace
│   │   ├── cloud/             # Multi-cloud file manager and storage suite
│   │   ├── browser/ & chrome/ # Web browser and tab navigation
│   │   └── context-menu/      # Context menu providers & positioning engines
│   ├── db/                    # Drizzle ORM schema definitions & connection pool
│   ├── hooks/                 # Window manager & OS lifecycle hooks
│   ├── lib/                   # Redis caching, Zod environment parser, Tool registries
│   ├── server/                # tRPC routers, Cloud adapters, and allocation services
│   ├── tools/                 # Native tool implementations (Developer, Media, Calculators, etc.)
│   └── trpc/                  # React Query tRPC client and providers
├── tests/                     # Unit and integration test suites (runnable with bun test)
├── Dockerfile                 # Multi-stage production container
├── docker-compose.yml         # Full-stack composition
└── wrangler.jsonc             # Cloudflare Edge / CDN deployment config
```

---

## 📄 License

MIT License. Crafted with precision for the next generation of web computing.
