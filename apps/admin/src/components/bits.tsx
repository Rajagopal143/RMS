import type { ReactNode } from "react";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import type { OrderStatus } from "@workspace/shared";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function FormField({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-card/60 px-6 py-12 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{children}</p>;
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  placed: "bg-steel text-ink",
  cooking: "bg-turmeric-soft text-ink",
  packing: "bg-basil-soft text-basil",
  serving: "bg-basil text-white",
  served: "bg-steel text-ink",
  completed: "bg-ink text-white",
  cancelled: "bg-chili/10 text-chili line-through",
};

const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: "In kitchen",
  cooking: "Cooking",
  packing: "Ready to pack",
  serving: "Ready to serve",
  served: "Awaiting bill",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}
