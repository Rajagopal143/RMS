# RMS — folder structure

Monorepo layout (`pnpm` workspaces + Turborepo). Paths are relative to the repository root.

```
RMS/
├── apps/
│   ├── admin/                 # Vite + React admin UI
│   │   ├── public/
│   │   ├── src/
│   │   │   ├── assets/
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── vite-env.d.ts
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── postcss.config.mjs
│   │   ├── eslint.config.js
│   │   └── tsconfig*.json
│   │
│   ├── backend/               # REST API (Express + TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── ws.ts
│   │   │   └── routes/
│   │   │       └── v1/
│   │   │           └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── worker/                # Vite + React worker app
│   │   ├── public/
│   │   ├── src/
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── tsconfig*.json
│   │
│   └── ws/                    # Standalone WebSocket service (`ws-app`)
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── db/                    # Drizzle ORM + Postgres (`@workspace/db`)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── schema.ts
│   │   │   └── load-env.ts
│   │   ├── drizzle/           # generated SQL migrations (Drizzle Kit)
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ui/                    # Shared UI (`@workspace/ui`, shadcn-style)
│   │   ├── src/
│   │   │   ├── components/    # many *.tsx UI primitives
│   │   │   ├── hooks/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   ├── components.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── eslint-config/         # `@workspace/eslint-config`
│   └── typescript-config/     # `@workspace/typescript-config` (shared tsconfigs)
│
├── package.json               # root scripts & tooling
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.json
├── README.md
└── FOLDER_STRUCTURE.md        # this file
```

## Workspace packages (names)

| Path | `package.json` name | Role |
|------|---------------------|------|
| `apps/admin` | `admin` | Admin frontend |
| `apps/backend` | `backend` | HTTP API |
| `apps/worker` | `worker` | Worker frontend |
| `apps/ws` | `ws-app` | WebSocket server |
| `packages/db` | `@workspace/db` | Database schema + Drizzle client |
| `packages/ui` | `@workspace/ui` | Shared React components / styles |
| `packages/eslint-config` | `@workspace/eslint-config` | ESLint presets |
| `packages/typescript-config` | `@workspace/typescript-config` | Base TS configs |

## Generated / local (not committed or optional)

- **`node_modules/`** — dependencies (per package and hoisted).
- **`dist/`** — TypeScript build output where packages emit builds (e.g. backend); some packages use source-only workflows.
- **`.turbo/`** — Turborepo cache.
- **`.env` / `.env.*`** — local secrets (see root `.gitignore`).

## Related config

- **`pnpm-workspace.yaml`** — includes `apps/*` and `packages/*`.
- **`turbo.json`** — pipeline for `build`, `dev`, `lint`, `check-types`.
