# RMS — restaurant management system

Billing, kitchen and table service for restaurants, with a platform console for running it
as a subscription across several restaurants.

Orders reach cooks by **food category**: every food belongs to a category, every cook is
assigned one or more categories, and each cook's screen shows only their own foods.

## The apps

| App | What it is | Who uses it |
|---|---|---|
| `apps/admin` | Billing, tables, menu, printers, staff, expenses, reports and the platform console. Runs in a browser, or as an Electron desktop app so it can print. | Owner, manager, cashier, and you as the platform owner |
| `apps/worker` | Phone and tablet screens for taking table orders, cooking and packing. | Waiters, cooks, packing staff |
| `apps/backend` | REST API (Express, JWT auth, per-restaurant scoping). | — |
| `apps/ws` | Pushes live updates over WebSockets to the people each change concerns. | — |
| `packages/db` | Database schema and migrations (Drizzle + Postgres). | — |
| `packages/shared` | Types, receipt layouts, ESC/POS encoding, API client, theme. | — |
| `packages/ui` | Shared UI components (shadcn/ui, Tailwind v4). | — |

## How a meal flows through it

1. **The order.** A cashier makes a bill (dine-in, takeaway or delivery), or a waiter picks a
   table on their phone and sends foods to the kitchen. A table's order stays open, so later
   rounds join the same bill.
2. **The kitchen.** Each food appears only for cooks assigned to its category, oldest bill
   first. A cook taps **Start**, then **Done**. Kitchen printers print a KOT with just the
   foods for the categories they cover.
3. **Handover.** Cooked takeaway and delivery goes to **packing**, which checks the items off
   and hands the order over. Table food goes back to the **waiter**, who is alerted the moment
   it's ready and serves it.
4. **The bill.** Takeaway and delivery are paid when the bill is made. A table is settled from
   **Tables**: pick the payment mode, apply a discount, print the bill, and the table is free.

Everyone's screens update live, with a chime and a notification for new and ready food.

## Running it locally

Needs Docker. Everything else runs in containers.

```bash
docker compose up -d
```

This starts Postgres, the API, the live-updates service and both web apps, applies database
migrations and seeds demo data.

| | |
|---|---|
| Admin and billing | http://localhost:5173 |
| Kitchen, packing, waiters | http://localhost:5174 |
| API | http://localhost:3001 |
| Live updates | ws://localhost:3002 |
| Postgres | `localhost:5433`, user/password/database `rms` |

Other devices on the same Wi-Fi use your computer's address instead of `localhost`, for
example `http://192.168.1.20:5174` on a waiter's phone. Find it with
`ipconfig getifaddr en0` on macOS.

### Installing the apps on a phone or tablet

Both web apps install like an app: `apps/worker` as **RMS Worker** (waiters, cooks, packing) and
`apps/admin` as **RMS Admin** (billing, tables, reports). Open one in the browser, then:

- **iPhone (Safari):** Share → **Add to Home Screen**.
- **Android (Chrome):** menu → **Add to Home screen** (or **Install app** when offered).

It then opens full screen with its own icon. Alerts chime and, on Android, **vibrate**; tap
**Turn on alerts** once after opening it (browsers only allow sound and vibration after a tap).

Over plain `http://` on your Wi-Fi, Chrome treats the page as insecure, so it won't offer a full
install, pop-up notifications or offline mode, and the add-to-home-screen result is a shortcut.
Serve the app over **HTTPS** for those. iPhones don't support vibration at all.

### The desktop app (for printing)

Printers are reached from the Electron app, which runs on the computer at the counter, not in
Docker. With the containers running:

```bash
pnpm install   # once
pnpm desktop
```

It loads the admin app and adds printing over USB, network (ESC/POS on port 9100) and
Bluetooth serial. In a plain browser, bills and tickets open the print dialog instead.

### Demo logins

Seeded when `SEED_DEMO=true` (the default in `docker-compose.yml`):

| Who | Email | Password |
|---|---|---|
| Platform owner | `admin@rms.local` | `admin123` |
| Restaurant owner | `owner@demo.local` | `demo123` |
| Cashier | `cashier@demo.local` | `demo123` |
| Waiter | `waiter@demo.local` | `demo123` |
| Cooks | `chinese@`, `tandoor@`, `drinks@demo.local` | `demo123` |
| Packing | `packing@demo.local` | `demo123` |

**Change these before using the app for real**, and set `JWT_SECRET` and a real Postgres
password. Set `SEED_DEMO=false` to start with an empty restaurant list.

## Deploying to a server

Works on any Ubuntu server (AWS EC2, Lightsail, any VPS) with a public IP, with no Docker. It
installs **PostgreSQL** directly, builds the two web apps and serves the built folders with
**nginx**, and runs the API and live-updates service under **PM2** (restarted if they crash, and
started again after a reboot). Code is pulled from the `production` branch.

**1. Make the server.** Ubuntu 22.04 or 24.04, at least 2 GB of memory (1 GB can run out while
building). In the provider's firewall, open **22** (SSH), **80**, **8080** and **443**.

**2. Deploy.** SSH in and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Rajagopal143/RMS/production/deploy/deploy.sh -o deploy.sh
bash deploy.sh --admin-email you@example.com
```

It installs the packages, gets the code, creates the database and secrets, builds and starts
everything (the first build takes several minutes) and schedules a nightly database backup. At the end it prints the
two addresses and, once, the platform admin login. Until you have a domain the apps are on plain
`http` at the server's IP: `http://IP` for admin and billing, `http://IP:8080` for waiters,
kitchen and packing. That is fine for trying it out, but passwords travel unencrypted.

**3. Add HTTPS when your domain is ready.** At your domain provider, add three **A records** to the
server's IP: `example.com` (admin and billing), `worker.example.com` (waiters, kitchen, packing)
and `api.example.com` (the API and live updates). Use your own name. Then:

```bash
bash /opt/rms/deploy/deploy.sh --domain example.com
```

It checks both names point at the server, then gets a free Let's Encrypt certificate (renewed
automatically) and switches nginx to HTTPS, with port 80 redirecting. Waiters use
`https://worker.example.com`. HTTPS is also what lets phones fully install the apps and show
pop-up notifications. Close port 8080 afterwards.

**Updating** is the same command again: `bash /opt/rms/deploy/deploy.sh` pulls the latest code,
rebuilds the apps, applies any database migrations and reloads the services.

Good to know:

- Secrets live in `/opt/rms/.env` on the server (owner-only). PostgreSQL only listens on the
  server itself; only SSH and the web ports are open to the outside.
- Check the services with `pm2 status` and `pm2 logs rms-api`; nginx errors are in
  `/var/log/nginx/error.log`.
- Backups go to `/opt/rms/backups` every night and the last two weeks are kept. Also turn on your
  provider's server snapshots, so a lost server doesn't mean lost data. `deploy/backup.sh` explains
  how to restore.
- The desktop app (for printing) points at the server: on its sign-in screen, set **Server** to
  the full address, for example `https://example.com`.

## Setting up a real restaurant

1. Sign in as the platform owner, create **plans**, then add the **restaurant** with its owner
   login. The plan's staff limit and subscription dates are enforced.
2. As that owner: add **categories** (for example Chinese, Tandoor, Juices) and the **foods**
   in each, add **tables**, then create a **login for every worker**. Give each cook their
   categories: a category with no cook is flagged, because its orders would reach nobody.
3. Add **printers**: one for bills at the counter, and a kitchen printer per section with the
   categories it prints. Send a test print.

## Working on the code

```bash
pnpm install
pnpm dev          # run everything outside Docker (needs your own Postgres)
pnpm build
pnpm lint
```

Container logs and a shell:

```bash
docker compose logs -f backend
```

Database changes: edit `packages/db/src/schema.ts`, then

```bash
pnpm --filter @workspace/db db:generate
```

and restart the stack, or run `docker compose run --rm migrate` to apply migrations and
re-seed. After changing dependencies, rebuild the image and refresh the container's modules
with `docker compose up -d --build -V`.

### Notes

- Money is stored in **paise** as whole numbers; `formatMoney` renders it.
- No tax is charged. Bills made before that change keep the tax the customer paid.
- Live updates travel as Postgres `NOTIFY` events, which `apps/ws` fans out to the right
  people: cooks only hear about their own categories.
