import { useEffect, useState, type ReactNode } from "react";
import { BellOff, BellRing, LogOut } from "lucide-react";
import { enableAlerts, notificationBlocker } from "./alerts";
import type { Workspace } from "./app";

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Topbar({
  ws,
  title,
  color,
  live,
  count,
  switcher,
}: {
  ws: Workspace;
  title: string;
  color: string;
  live: boolean;
  count: string;
  switcher?: ReactNode;
}) {
  const now = useNow(15_000);
  const [sound, setSound] = useState(false);

  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 bg-ink/95 px-4 py-3 text-white backdrop-blur sm:px-5">
      <div className="flex items-baseline gap-3">
        <span className="size-3 self-center rounded-full" style={{ background: color }} />
        <h1 className="text-2xl font-semibold">{title}</h1>
        <span className="tabular hidden text-sm text-white/60 sm:inline">{count}</span>
      </div>
      {switcher}
      <div className="ml-auto flex items-center gap-3 text-sm sm:gap-4">
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <span className={`size-2 rounded-full ${live ? "bg-basil" : "animate-pulse bg-chili"}`} />
          {live ? "Live" : "Reconnecting"}
        </span>
        <button
          onClick={async () => setSound(sound ? false : await enableAlerts())}
          title={notificationBlocker() ?? undefined}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${sound ? "bg-white/10" : "bg-turmeric font-semibold text-ink"}`}
        >
          {sound ? <BellRing className="size-4" /> : <BellOff className="size-4" />}
          {sound ? "Alerts on" : "Turn on alerts"}
        </button>
        <span className="tabular hidden text-lg sm:inline">{new Date(now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="hidden text-white/60 md:inline">{ws.user.name}</span>
        <button onClick={ws.logout} className="rounded p-1.5 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Sign out">
          <LogOut className="size-4" />
        </button>
      </div>
    </header>
  );
}
