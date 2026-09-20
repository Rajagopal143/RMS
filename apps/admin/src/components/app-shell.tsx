import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import {
  BarChart3,
  Building2,
  ClipboardList,
  CreditCard,
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  ReceiptText,
  Settings,
  UsersRound,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import { ROLE_LABEL, type Role, type SessionUser } from "@workspace/shared";
import { useBootstrap, useSession } from "../lib/session";
import { desktop } from "../lib/desktop";
import { ErrorNote } from "./bits";
import { RealtimeAlerts } from "./realtime-alerts";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Platform",
    items: [
      { to: "/platform/restaurants", label: "Restaurants", icon: Building2, roles: ["super_admin"] },
      { to: "/platform/plans", label: "Plans", icon: CreditCard, roles: ["super_admin"] },
    ],
  },
  {
    heading: "Service",
    items: [
      { to: "/pos", label: "Billing", icon: ReceiptText, roles: ["owner", "manager", "cashier"] },
      { to: "/tables", label: "Tables", icon: LayoutGrid, roles: ["owner", "manager", "cashier"] },
      { to: "/orders", label: "Live orders", icon: ClipboardList, roles: ["owner", "manager", "cashier"] },
      { to: "/expenses", label: "Expenses", icon: Wallet, roles: ["owner", "manager", "cashier"] },
      { to: "/dashboard", label: "Sales report", icon: BarChart3, roles: ["owner", "manager"] },
    ],
  },
  {
    heading: "Setup",
    items: [
      { to: "/menu", label: "Menu", icon: UtensilsCrossed, roles: ["owner", "manager"] },
      { to: "/printers", label: "Printers", icon: Printer, roles: ["owner", "manager"] },
      { to: "/staff", label: "Staff logins", icon: UsersRound, roles: ["owner", "manager"] },
      { to: "/settings", label: "Restaurant", icon: Settings, roles: ["owner"] },
    ],
  },
];

const COLLAPSE_KEY = "rms.sidebarCollapsed";

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Sidebar contents, shared by the desktop rail and the phone drawer. */
function Nav({ user, collapsed, onLogout }: { user: SessionUser; collapsed: boolean; onLogout: () => void }) {
  return (
    <>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV.map((group) => {
          const items = group.items.filter((i) => i.roles.includes(user.role));
          if (items.length === 0) return null;
          return (
            <div key={group.heading}>
              {collapsed ? (
                <div className="mx-2 mb-2 border-t border-white/10" />
              ) : (
                <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{group.heading}</p>
              )}
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-white/5 hover:text-white",
                      collapsed && "justify-center",
                      isActive && "bg-white/10 font-medium text-white shadow-[inset_3px_0_0_var(--color-turmeric)]",
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" />
                  {!collapsed && item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className={cn("border-t border-white/10 py-4 text-xs", collapsed ? "px-2 text-center" : "px-5")}>
        {!collapsed && (
          <>
            <p className="truncate font-medium text-white">{user.name}</p>
            <p className="text-white/50">
              {ROLE_LABEL[user.role]} · {desktop ? "Desktop" : "Browser"}
            </p>
          </>
        )}
        <button
          onClick={onLogout}
          title="Sign out"
          className={cn("inline-flex items-center gap-1.5 text-white/70 hover:text-white", !collapsed && "mt-3")}
        >
          <LogOut className="size-3.5" /> {!collapsed && "Sign out"}
        </button>
      </div>
    </>
  );
}

function Brand({ user, collapsed }: { user: SessionUser; collapsed?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-xl font-bold text-white">
        {collapsed ? "R" : "RMS"}
        <span className="text-turmeric">.</span>
      </p>
      {!collapsed && <p className="mt-0.5 truncate text-xs text-sidebar-foreground">{user.restaurant?.name ?? "Platform console"}</p>}
    </div>
  );
}

/** `restaurant` pages wait for the restaurant's setup data before rendering. */
export function AppShell({ restaurant = false }: { restaurant?: boolean }) {
  const { user, logout } = useSession();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the phone drawer after picking a page.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  if (!user) return null;

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // per-session only
      }
      return !c;
    });
  }

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      {/* Phone and tablet: top bar with a menu button. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
        <button onClick={() => setDrawerOpen(true)} className="-ml-1 rounded-md p-1.5 text-white hover:bg-white/10" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Brand user={user} />
      </header>
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Pages you can open</SheetDescription>
          <div className="px-5 pb-4 pt-6">
            <Brand user={user} />
          </div>
          <Nav user={user} collapsed={false} onLogout={logout} />
        </SheetContent>
      </Sheet>

      {/* Laptop and desktop: sidebar that collapses to icons. */}
      <aside
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className={cn("flex items-start justify-between pb-4 pt-6", collapsed ? "flex-col items-center gap-3 px-2" : "px-5")}>
          <Brand user={user} collapsed={collapsed} />
          <button
            onClick={toggleCollapsed}
            className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
        </div>
        <Nav user={user} collapsed={collapsed} onLogout={logout} />
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{restaurant ? <BootstrapGate /> : <Outlet />}</main>
    </div>
  );
}

function BootstrapGate() {
  const { data, error } = useBootstrap();
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <p className="text-muted-foreground">Loading restaurant…</p>;
  return (
    <>
      <RealtimeAlerts />
      <Outlet />
    </>
  );
}
