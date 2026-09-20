import { useState } from "react";
import { Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import {
  api,
  EXPENSE_PAYMENT_MODES,
  formatMoney,
  TAG_COLORS,
  type Expense,
  type ExpensePaymentMode,
  type ExpenseSummary,
  type ExpenseTag,
} from "@workspace/shared";
import { useSession } from "../lib/session";
import { todayIso, toPaise, toRupees, useApi } from "../lib/hooks";
import { EmptyState, ErrorNote, FormField, PageHeader } from "../components/bits";

const UNTAGGED = "#9aa0a6";

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Today", range: () => ({ from: todayIso(), to: todayIso() }) },
  {
    label: "Last 7 days",
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return { from: iso(d), to: todayIso() };
    },
  },
  {
    label: "This month",
    range: () => {
      const d = new Date();
      return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: todayIso() };
    },
  },
  {
    label: "Last month",
    range: () => {
      const d = new Date();
      return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
    },
  },
];

interface Draft {
  id?: number;
  amount: string;
  spentOn: string;
  tagId: number | null;
  vendor: string;
  note: string;
  paymentMode: ExpensePaymentMode;
}

const shortDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function ExpensesPage() {
  const { user } = useSession();
  const isManager = user?.role === "owner" || user?.role === "manager";
  const [range, setRange] = useState(PRESETS[2]!.range());
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [managingTags, setManagingTags] = useState(false);
  const [busy, setBusy] = useState(false);

  const qs = `from=${range.from}&to=${range.to}`;
  const tags = useApi<ExpenseTag[]>("/expense-tags");
  const list = useApi<Expense[]>(`/expenses?${qs}${tagFilter ? `&tagId=${tagFilter}` : ""}`);
  const summary = useApi<ExpenseSummary>(isManager ? `/expenses/summary?${qs}` : null);

  const tagOf = (id: number | null) => tags.data?.find((t) => t.id === id);
  const refresh = () => Promise.all([list.reload(), summary.reload()]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      amount: toPaise(draft.amount),
      spentOn: draft.spentOn,
      tagId: draft.tagId,
      vendor: draft.vendor || null,
      note: draft.note || null,
      paymentMode: draft.paymentMode,
    };
    try {
      if (draft.id) await api(`/expenses/${draft.id}`, { method: "PATCH", body });
      else await api("/expenses", { method: "POST", body });
      toast.success(draft.id ? "Expense saved" : `Added ${formatMoney(body.amount)} expense`);
      setDraft(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(e: Expense) {
    if (!confirm(`Delete this ${formatMoney(e.amount)} expense?`)) return;
    await api(`/expenses/${e.id}`, { method: "DELETE" }).catch((err) => toast.error(err.message));
    await refresh();
  }

  const newDraft = (): Draft => ({ amount: "", spentOn: todayIso(), tagId: tagFilter ?? tags.data?.[0]?.id ?? null, vendor: "", note: "", paymentMode: "cash" });

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Expenses"
        description="Record what the restaurant spends and tag each expense, like Vegetables, Gas or Salary, to see where the money goes."
        actions={
          <>
            <Button variant="outline" onClick={() => setManagingTags(true)}>
              <Tags /> Tags
            </Button>
            <Button onClick={() => setDraft(newDraft())}>
              <Plus /> Add expense
            </Button>
          </>
        }
      />

      {/* Filters: one row above everything they affect. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => {
          const r = p.range();
          const on = r.from === range.from && r.to === range.to;
          return (
            <button
              key={p.label}
              onClick={() => setRange(r)}
              className={cn("rounded-full border px-3 py-1.5 text-sm", on ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40")}
            >
              {p.label}
            </button>
          );
        })}
        <div className="flex w-full items-center gap-2 text-sm sm:ml-auto sm:w-auto">
          <Input type="date" className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} aria-label="From" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} aria-label="To" />
        </div>
      </div>

      {summary.data && (
        <>
          <div className="grid divide-y rounded-lg border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <Stat label="Sales" value={formatMoney(summary.data.sales)} />
            <Stat label="Expenses" value={formatMoney(summary.data.total)} />
            <Stat
              label="Net"
              value={`${summary.data.net < 0 ? "−" : ""}${formatMoney(Math.abs(summary.data.net))}`}
              badge={summary.data.net >= 0 ? { text: "Profit", cls: "bg-basil-soft text-basil" } : { text: "Loss", cls: "bg-chili/10 text-chili" }}
            />
          </div>
          <SpendByTag summary={summary.data} tagOf={tagOf} selected={tagFilter} onSelect={setTagFilter} />
        </>
      )}

      <div className="mb-3 mt-8 flex items-center gap-2">
        <h2 className="text-xl font-semibold">Entries</h2>
        {tagFilter !== null && (
          <button onClick={() => setTagFilter(null)} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-sm">
            <span className="size-2.5 rounded-full" style={{ background: tagOf(tagFilter)?.color }} />
            {tagOf(tagFilter)?.name}
            <X className="size-3.5" aria-label="Clear tag filter" />
          </button>
        )}
      </div>
      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {list.data && list.data.length === 0 ? (
        <EmptyState title="No expenses in this period" action={<Button onClick={() => setDraft(newDraft())}>Add expense</Button>}>
          Record purchases and bills as they happen so your net profit stays accurate.
        </EmptyState>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Paid to / note</TableHead>
                <TableHead>Paid by</TableHead>
                <TableHead>Added by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {isManager && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(list.data ?? []).map((e) => {
                const tag = tagOf(e.tagId);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="tabular text-sm">{shortDate(e.spentOn)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: tag?.color ?? UNTAGGED }} />
                        {tag?.name ?? <span className="text-muted-foreground">Untagged</span>}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <p className="truncate">{e.vendor ?? "—"}</p>
                      {e.note && <p className="truncate text-xs text-muted-foreground">{e.note}</p>}
                    </TableCell>
                    <TableCell className="text-sm uppercase">{e.paymentMode ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.addedBy ?? "—"}</TableCell>
                    <TableCell className="tabular text-right font-medium">{formatMoney(e.amount)}</TableCell>
                    {isManager && (
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label="Edit expense"
                          onClick={() =>
                            setDraft({ id: e.id, amount: toRupees(e.amount), spentOn: e.spentOn, tagId: e.tagId, vendor: e.vendor ?? "", note: e.note ?? "", paymentMode: e.paymentMode ?? "cash" })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8 text-chili" aria-label="Delete expense" onClick={() => remove(e)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit expense" : "Add expense"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Amount (₹)" htmlFor="x-amount">
                  <Input id="x-amount" autoFocus inputMode="decimal" className="font-mono text-lg" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d.]/g, "") })} />
                </FormField>
                <FormField label="Date" htmlFor="x-date">
                  <Input id="x-date" type="date" max={todayIso()} value={draft.spentOn} onChange={(e) => setDraft({ ...draft, spentOn: e.target.value })} />
                </FormField>
              </div>
              <FormField label="Tag">
                <div className="flex flex-wrap gap-1.5">
                  {(tags.data ?? []).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, tagId: t.id })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                        draft.tagId === t.id ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40",
                      )}
                    >
                      <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                      {t.name}
                    </button>
                  ))}
                  <button type="button" onClick={() => setManagingTags(true)} className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:text-foreground">
                    + New tag
                  </button>
                </div>
              </FormField>
              <FormField label="Paid to" htmlFor="x-vendor">
                <Input id="x-vendor" placeholder="e.g. Koyambedu market" value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
              </FormField>
              <FormField label="Note" htmlFor="x-note">
                <Input id="x-note" placeholder="Optional" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </FormField>
              <FormField label="Paid by">
                <div className="grid grid-cols-4 gap-1">
                  {EXPENSE_PAYMENT_MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft({ ...draft, paymentMode: m })}
                      className={cn("rounded border py-1.5 text-sm uppercase", draft.paymentMode === m ? "border-ink bg-ink text-white" : "bg-card")}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </FormField>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !toPaise(draft?.amount ?? "")}>
              {draft?.id ? "Save expense" : "Add expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {managingTags && (
        <TagManager
          tags={tags.data ?? []}
          canEdit={isManager}
          onClose={() => setManagingTags(false)}
          onChanged={async (created) => {
            await Promise.all([tags.reload(), refresh()]);
            if (created && draft) setDraft({ ...draft, tagId: created.id });
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, badge }: { label: string; value: string; badge?: { text: string; cls: string } }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2">
        <span className="tabular text-2xl font-semibold">{value}</span>
        {badge && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", badge.cls)}>{badge.text}</span>}
      </p>
    </div>
  );
}

/** Part-to-whole: one stacked bar of spend by tag, with a labelled legend that doubles as the table view. */
function SpendByTag({
  summary,
  tagOf,
  selected,
  onSelect,
}: {
  summary: ExpenseSummary;
  tagOf: (id: number | null) => ExpenseTag | undefined;
  selected: number | null;
  onSelect: (id: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (summary.total === 0) return null;
  const rows = summary.byTag.map((r) => ({ ...r, tag: tagOf(r.tagId), share: r.total / summary.total }));
  const hovered = hover === null ? null : rows[hover];

  return (
    <section className="mt-6 rounded-lg border bg-card p-5">
      <h2 className="text-lg font-semibold">Spend by tag</h2>
      <div className="relative mt-3">
        <div className="flex h-7 gap-[2px] overflow-hidden rounded" role="img" aria-label="Share of spend by tag">
          {rows.map((r, i) => (
            <button
              key={r.tagId ?? "none"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => r.tagId !== null && onSelect(selected === r.tagId ? null : r.tagId)}
              className={cn("h-full min-w-1 transition-opacity first:rounded-l last:rounded-r", selected !== null && selected !== r.tagId && "opacity-35")}
              style={{ flexGrow: r.total, flexBasis: 0, background: r.tag?.color ?? UNTAGGED }}
              aria-label={`${r.tag?.name ?? "Untagged"}: ${formatMoney(r.total)}`}
            />
          ))}
        </div>
        {hovered && (
          <div className="pointer-events-none absolute top-9 z-10 rounded-md border bg-popover px-3 py-2 text-sm shadow-md" style={{ left: `${Math.min(80, rows.slice(0, hover!).reduce((s, r) => s + r.share, 0) * 100)}%` }}>
            <p className="font-semibold">{hovered.tag?.name ?? "Untagged"}</p>
            <p className="tabular">
              {formatMoney(hovered.total)} · {(hovered.share * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              {hovered.count} {hovered.count === 1 ? "entry" : "entries"}
            </p>
          </div>
        )}
      </div>
      <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
        {rows.map((r) => (
          <button
            key={r.tagId ?? "none"}
            onClick={() => r.tagId !== null && onSelect(selected === r.tagId ? null : r.tagId)}
            className={cn("flex items-center gap-2.5 border-b py-2 text-left text-sm last:border-0 hover:bg-muted/50", selected === r.tagId && "font-semibold")}
          >
            <span className="size-3 shrink-0 rounded-sm" style={{ background: r.tag?.color ?? UNTAGGED }} />
            <span className="flex-1">{r.tag?.name ?? "Untagged"}</span>
            <span className="text-xs text-muted-foreground">{r.count}×</span>
            <span className="tabular w-12 text-right text-muted-foreground">{Math.round(r.share * 100)}%</span>
            <span className="tabular w-28 text-right">{formatMoney(r.total)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TagManager({
  tags,
  canEdit,
  onClose,
  onChanged,
}: {
  tags: ExpenseTag[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: (created?: ExpenseTag) => Promise<void>;
}) {
  const nextColor = TAG_COLORS[tags.length % TAG_COLORS.length]!;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(nextColor);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  async function add() {
    try {
      const created = await api<ExpenseTag>("/expense-tags", { method: "POST", body: { name, color } });
      setName("");
      setColor(TAG_COLORS[(tags.length + 1) % TAG_COLORS.length]!);
      await onChanged(created);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function rename() {
    if (!editing) return;
    try {
      await api(`/expense-tags/${editing.id}`, { method: "PATCH", body: { name: editing.name } });
      setEditing(null);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(t: ExpenseTag) {
    if (!confirm(`Delete the ${t.name} tag? Its expenses stay, marked Untagged.`)) return;
    await api(`/expense-tags/${t.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    await onChanged();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Expense tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          {tags.length === 0 && <p className="text-sm text-muted-foreground">No tags yet. Add one for each kind of spending.</p>}
          {tags.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-muted/50">
              <span className="size-3 rounded-sm" style={{ background: t.color }} />
              {editing?.id === t.id ? (
                <Input className="h-8" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && rename()} onBlur={rename} />
              ) : (
                <span className="flex-1 text-sm">{t.name}</span>
              )}
              {canEdit && editing?.id !== t.id && (
                <>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditing({ id: t.id, name: t.name })} aria-label={`Rename ${t.name}`}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7 text-chili" onClick={() => remove(t)} aria-label={`Delete ${t.name}`}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t pt-4">
          <FormField label="New tag" htmlFor="t-name">
            <Input id="t-name" placeholder="e.g. Dairy" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && add()} />
          </FormField>
          <div className="flex gap-2">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn("size-7 rounded-full ring-offset-2", color === c && "ring-2 ring-ink")}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button onClick={add} disabled={!name.trim()}>
            Add tag
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
