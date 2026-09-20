import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  api,
  getToken,
  login as apiLogin,
  setToken,
  setUnauthorizedHandler,
  type Category,
  type DiningTable,
  type MenuItem,
  type Printer,
  type Restaurant,
  type SessionUser,
} from "@workspace/shared";

interface SessionState {
  user: SessionUser | null;
  checking: boolean;
  login(email: string, password: string): Promise<SessionUser>;
  logout(): void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(!!getToken());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    api<SessionUser>("/auth/me")
      .then(setUser)
      .catch(() => logout())
      .finally(() => setChecking(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin(email, password);
    if (u.role === "cook" || u.role === "packer") {
      setToken(null);
      throw new Error("Cooks and packing staff sign in on the kitchen screen, not the admin app.");
    }
    setUser(u);
    return u;
  }, []);

  return <SessionContext.Provider value={{ user, checking, login, logout }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}

export interface Bootstrap {
  restaurant: Restaurant;
  subscription: { endsAt: string; planName: string | null; maxStaff: number | null } | null;
  categories: Category[];
  menuItems: MenuItem[];
  printers: Printer[];
  tables: DiningTable[];
}

interface BootstrapState {
  data: Bootstrap | null;
  error: string | null;
  reload(): Promise<void>;
}

const BootstrapContext = createContext<BootstrapState | null>(null);

/** Restaurant setup data (menu, categories, printers) shared by every restaurant page. */
export function BootstrapProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await api<Bootstrap>("/bootstrap"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <BootstrapContext.Provider value={{ data, error, reload }}>{children}</BootstrapContext.Provider>;
}

export function useBootstrap() {
  const ctx = useContext(BootstrapContext);
  if (!ctx) throw new Error("useBootstrap outside BootstrapProvider");
  return ctx;
}
