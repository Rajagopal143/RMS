import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Toaster } from "@workspace/ui/components/sonner";
import {
  api,
  getServerHost,
  getToken,
  login,
  setServerHost,
  setToken,
  setUnauthorizedHandler,
  type Category,
  type MenuItem,
  type SessionUser,
} from "@workspace/shared";
import { KitchenScreen } from "./kitchen";
import { PackingScreen } from "./packing";
import { WaiterScreen } from "./waiter";

export interface Workspace {
  user: SessionUser;
  categories: Category[];
  menu: MenuItem[];
  logout(): void;
}

export function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [checking, setChecking] = useState(!!getToken());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const load = useCallback(async (u: SessionUser) => {
    const boot = await api<{ categories: Category[]; menuItems: MenuItem[] }>("/bootstrap");
    setCategories(boot.categories);
    setMenu(boot.menuItems);
    setUser(u);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api<SessionUser>("/auth/me")
      .then(load)
      .catch(logout)
      .finally(() => setChecking(false));
  }, [load, logout]);

  // Keep role, categories and menu current: a manager may change them while this screen is open.
  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      if (!getToken()) return;
      api<SessionUser>("/auth/me")
        .then(load)
        .catch(() => undefined);
    };
    const timer = setInterval(refresh, 30_000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) return <div className="grid min-h-svh place-items-center bg-ink text-white/60">Loading…</div>;
  if (!user) return <Login onLogin={load} />;
  const ws: Workspace = { user, categories, menu, logout };
  return (
    <>
      <Home ws={ws} />
      <Toaster position="top-center" richColors />
    </>
  );
}

/** Waiters get their tables; cooks their foods; packers packing; managers can switch between categories. */
function Home({ ws }: { ws: Workspace }) {
  const { user, categories } = ws;
  const [view, setView] = useState<number | "packing">(
    user.role === "packer" || user.role === "cashier" ? "packing" : (categories[0]?.id ?? "packing"),
  );

  if (user.role === "cook") {
    const mine = categories.filter((c) => user.categoryIds.includes(c.id));
    if (mine.length === 0) {
      return (
        <Message ws={ws} title="No food categories yet">
          Your manager hasn't picked which foods you cook. Ask them to add categories to your login.
        </Message>
      );
    }
    return <KitchenScreen ws={ws} title={mine.map((c) => c.name).join(" · ")} color={mine[0]!.color} />;
  }
  if (user.role === "waiter") return <WaiterScreen ws={ws} menu={ws.menu} />;
  if (user.role === "packer" || user.role === "cashier") return <PackingScreen ws={ws} />;

  const switcher = (
    <div className="flex gap-1 overflow-x-auto">
      {categories.map((c) => (
        <button
          key={c.id}
          onClick={() => setView(c.id)}
          className="whitespace-nowrap rounded-full px-3 py-1 text-sm"
          style={view === c.id ? { background: c.color, color: "#16191d", fontWeight: 600 } : { color: "rgb(255 255 255 / 0.7)" }}
        >
          {c.name}
        </button>
      ))}
      <button
        onClick={() => setView("packing")}
        className={`rounded-full px-3 py-1 text-sm ${view === "packing" ? "bg-white font-semibold text-ink" : "text-white/70"}`}
      >
        Packing
      </button>
    </div>
  );

  const category = categories.find((c) => c.id === view);
  return category ? (
    <KitchenScreen key={category.id} ws={ws} title={category.name} color={category.color} categoryId={category.id} switcher={switcher} />
  ) : (
    <PackingScreen ws={ws} switcher={switcher} />
  );
}

function Message({ ws, title, children }: { ws: Workspace; title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-ink px-6 text-center text-white">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-white/70">{children}</p>
        <Button variant="secondary" className="mt-6" onClick={ws.logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (u: SessionUser) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(getServerHost());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setServerHost(server);
    try {
      const u = await login(email, password);
      if (u.role === "super_admin") {
        setToken(null);
        throw new Error("Platform accounts use the admin app.");
      }
      await onLogin(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-svh place-items-center bg-ink px-4">
      <form onSubmit={submit} className="ticket w-full max-w-sm space-y-4 px-6 pb-8 pt-6" style={{ ["--ticket-accent" as string]: "var(--color-turmeric)" }}>
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Waiters · Kitchen · Packing</p>
          <h1 className="mt-1 text-3xl font-semibold">Start your shift</h1>
        </div>
        <hr className="ticket-rule" />
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" className="h-11" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" className="h-11" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="server">Server</Label>
          <Input id="server" className="font-mono" value={server} onChange={(e) => setServer(e.target.value)} />
        </div>
        {error && <p className="rounded-md bg-chili/10 px-3 py-2 font-sans text-sm text-chili">{error}</p>}
        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
