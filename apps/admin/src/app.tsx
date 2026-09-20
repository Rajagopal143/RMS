import { HashRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { Toaster } from "@workspace/ui/components/sonner";
import { BootstrapProvider, SessionProvider, useSession } from "./lib/session";
import { AppShell } from "./components/app-shell";
import { LoginPage } from "./pages/login";
import { PosPage } from "./pages/pos";
import { OrdersPage } from "./pages/orders";
import { DashboardPage } from "./pages/dashboard";
import { MenuPage } from "./pages/menu";
import { PrintersPage } from "./pages/printers";
import { StaffPage } from "./pages/staff";
import { SettingsPage } from "./pages/settings";
import { ExpensesPage } from "./pages/expenses";
import { TablesPage } from "./pages/tables";
import { RestaurantsPage } from "./pages/platform/restaurants";
import { PlansPage } from "./pages/platform/plans";
import type { Role } from "@workspace/shared";

function Guard({ roles }: { roles: Role[] }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function Home() {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "super_admin") return <Navigate to="/platform/restaurants" replace />;
  return <Navigate to="/pos" replace />;
}

function Routed() {
  const { user, checking } = useSession();
  if (checking) return <div className="grid min-h-svh place-items-center text-muted-foreground">Loading…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/" element={<Home />} />
      <Route element={<Guard roles={["super_admin"]} />}>
        <Route element={<AppShell />}>
          <Route path="/platform/restaurants" element={<RestaurantsPage />} />
          <Route path="/platform/plans" element={<PlansPage />} />
        </Route>
      </Route>
      <Route element={<Guard roles={["owner", "manager", "cashier"]} />}>
        <Route
          element={
            <BootstrapProvider>
              <AppShell restaurant />
            </BootstrapProvider>
          }
        >
          <Route path="/pos" element={<PosPage />} />
          <Route path="/tables" element={<TablesPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route element={<Guard roles={["owner", "manager"]} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/printers" element={<PrintersPage />} />
            <Route path="/staff" element={<StaffPage />} />
          </Route>
          <Route element={<Guard roles={["owner"]} />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
      <Toaster position="bottom-right" richColors />
    </SessionProvider>
  );
}
