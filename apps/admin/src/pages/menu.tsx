import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { api, formatMoney, TAG_COLORS, type Category, type MenuItem, type StaffMember } from "@workspace/shared";
import { useBootstrap } from "../lib/session";
import { toPaise, toRupees, useApi } from "../lib/hooks";
import { ColorDot, EmptyState, FormField, PageHeader } from "../components/bits";

interface Draft {
  id?: number;
  name: string;
  price: string;
  isVeg: boolean;
  isAvailable: boolean;
  categoryId: number | null;
}

type CategoryDraft = { id?: number; name: string; color: string };

export function MenuPage() {
  const { data, reload } = useBootstrap();
  const { menuItems, categories } = data!;
  const { data: staff } = useApi<StaffMember[]>("/staff");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [filter, setFilter] = useState<number | "all">("all");
  const [busy, setBusy] = useState(false);

  const categoryOf = (id: number | null) => categories.find((c) => c.id === id);
  const cooksFor = (id: number) => (staff ?? []).filter((s) => s.role === "cook" && s.isActive && s.categoryIds.includes(id));
  const uncategorised = menuItems.filter((m) => m.categoryId === null).length;
  const uncovered = staff ? categories.filter((c) => cooksFor(c.id).length === 0 && menuItems.some((m) => m.categoryId === c.id)) : [];
  const nextColor = TAG_COLORS[categories.length % TAG_COLORS.length]!;

  function edit(m: MenuItem) {
    setDraft({
      id: m.id,
      name: m.name,
      price: toRupees(m.price),
      isVeg: m.isVeg,
      isAvailable: m.isAvailable,
      categoryId: m.categoryId,
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body = {
      name: draft.name,
      price: toPaise(draft.price),
      isVeg: draft.isVeg,
      isAvailable: draft.isAvailable,
      categoryId: draft.categoryId,
    };
    try {
      if (draft.id) await api(`/menu-items/${draft.id}`, { method: "PATCH", body });
      else await api("/menu-items", { method: "POST", body });
      toast.success(draft.id ? "Food saved" : `Added ${draft.name}`);
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailable(m: MenuItem) {
    try {
      await api(`/menu-items/${m.id}`, { method: "PATCH", body: { isAvailable: !m.isAvailable } });
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(m: MenuItem) {
    if (!confirm(`Delete ${m.name} from the menu?`)) return;
    await api(`/menu-items/${m.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    await reload();
  }

  async function saveCategory() {
    if (!categoryDraft) return;
    try {
      const body = { name: categoryDraft.name, color: categoryDraft.color };
      const saved = categoryDraft.id
        ? await api<Category>(`/categories/${categoryDraft.id}`, { method: "PATCH", body })
        : await api<Category>("/categories", { method: "POST", body: { ...body, sortOrder: categories.length + 1 } });
      toast.success(categoryDraft.id ? "Category saved" : `Added ${saved.name}`);
      setCategoryDraft(null);
      // A category created from the food form is picked for that food straight away.
      if (!categoryDraft.id && draft) setDraft({ ...draft, categoryId: saved.id });
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeCategory(c: Category) {
    const count = menuItems.filter((m) => m.categoryId === c.id).length;
    const warning = count ? ` ${count} ${count === 1 ? "food" : "foods"} will have no category and won't reach any cook.` : "";
    if (!confirm(`Delete the ${c.name} category?${warning}`)) return;
    await api(`/categories/${c.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    if (filter === c.id) setFilter("all");
    await reload();
  }

  const rows = menuItems.filter((m) => filter === "all" || m.categoryId === filter);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Menu"
        description="Your foods and prices. Each food's category decides which cooks see it on their kitchen screen."
        actions={
          <Button onClick={() => setDraft({ name: "", price: "", isVeg: true, isAvailable: true, categoryId: filter === "all" ? (categories[0]?.id ?? null) : filter })}>
            <Plus /> Add food
          </Button>
        }
      />
      {uncovered.length > 0 && (
        <p className="mb-4 rounded-md bg-chili/10 px-3 py-2 text-sm text-chili">
          <b>No cook sees {uncovered.map((c) => c.name).join(", ")}.</b> Orders with these foods won't reach the kitchen. Give a cook{" "}
          {uncovered.length === 1 ? "this category" : "these categories"} in{" "}
          <a href="#/staff" className="font-semibold underline">
            Staff logins
          </a>
          , or move the foods to a category a cook has.
        </p>
      )}
      {uncategorised > 0 && (
        <p className="mb-4 rounded-md bg-turmeric-soft px-3 py-2 text-sm">
          {uncategorised} {uncategorised === 1 ? "food has" : "foods have"} no category, so no cook will see {uncategorised === 1 ? "it" : "them"}. Edit {uncategorised === 1 ? "it" : "them"} to pick a category.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[240px_1fr]">
        <aside>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categories</p>
          <button
            onClick={() => setFilter("all")}
            className={cn("mb-0.5 w-full rounded-md px-2 py-1.5 text-left text-sm", filter === "all" ? "bg-ink text-white" : "hover:bg-muted")}
          >
            All foods ({menuItems.length})
          </button>
          {categories.map((c) => {
            const cooks = cooksFor(c.id);
            return (
              <div key={c.id} className="group flex items-center">
                <button
                  onClick={() => setFilter(c.id)}
                  className={cn("min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm", filter === c.id ? "bg-ink text-white" : "hover:bg-muted")}
                >
                  <span className="flex items-center gap-2">
                    <ColorDot color={c.color} />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className={cn("block pl-4.5 text-xs", filter === c.id ? "text-white/70" : cooks.length ? "text-muted-foreground" : "font-semibold text-chili")}>
                    {staff && (cooks.length ? cooks.map((s) => s.name).join(", ") : "No cook assigned")}
                  </span>
                </button>
                <div className="invisible flex group-hover:visible">
                  <button onClick={() => setCategoryDraft({ id: c.id, name: c.name, color: c.color })} className="p-1 text-muted-foreground hover:text-foreground" aria-label={`Edit ${c.name}`}>
                    <Pencil className="size-3.5" />
                  </button>
                  <button onClick={() => removeCategory(c)} className="p-1 text-muted-foreground hover:text-chili" aria-label={`Delete ${c.name}`}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
          <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setCategoryDraft({ name: "", color: nextColor })}>
            <Plus /> New category
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Give cooks their categories in <a href="#/staff" className="underline">Staff logins</a>.
          </p>
        </aside>

        {categories.length === 0 ? (
          <EmptyState title="Start with a category" action={<Button onClick={() => setCategoryDraft({ name: "", color: nextColor })}>New category</Button>}>
            Make a category for each kind of food your kitchen cooks, like Chinese, Tandoor or Juices. Then add foods to it.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState title="No foods here yet">Add a food with its price and category.</EmptyState>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Food</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => {
                  const category = categoryOf(m.categoryId);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        <span className={cn("mr-2 inline-block size-2 rounded-full", m.isVeg ? "bg-basil" : "bg-chili")} title={m.isVeg ? "Veg" : "Non-veg"} />
                        {m.name}
                      </TableCell>
                      <TableCell>
                        {category ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ColorDot color={category.color} /> {category.name}
                          </span>
                        ) : (
                          <span className="font-semibold text-chili">No category</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">{formatMoney(m.price)}</TableCell>
                      <TableCell>
                        <Switch checked={m.isAvailable} onCheckedChange={() => toggleAvailable(m)} aria-label={`${m.name} available`} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" className="size-8" onClick={() => edit(m)} aria-label={`Edit ${m.name}`}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-8 text-chili" onClick={() => remove(m)} aria-label={`Delete ${m.name}`}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!draft && !categoryDraft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit food" : "Add food"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <FormField label="Name" htmlFor="m-name">
                <Input id="m-name" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </FormField>
              <FormField label="Price (₹)" htmlFor="m-price">
                <Input id="m-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value.replace(/[^\d.]/g, "") })} />
              </FormField>
              <FormField label="Category" hint="Cooks assigned to this category get this food on their screen when it's ordered.">
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setDraft({ ...draft, categoryId: c.id })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                        draft.categoryId === c.id ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40",
                      )}
                    >
                      <ColorDot color={c.color} />
                      {c.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCategoryDraft({ name: "", color: nextColor })}
                    className="rounded-full border border-dashed px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    + New category
                  </button>
                </div>
              </FormField>
              <div className="flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <Switch checked={draft.isVeg} onCheckedChange={(v) => setDraft({ ...draft, isVeg: v })} /> Vegetarian
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={draft.isAvailable} onCheckedChange={(v) => setDraft({ ...draft, isAvailable: v })} /> Available
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !draft?.name.trim() || !draft?.price || !draft?.categoryId}>
              {draft?.id ? "Save food" : "Add food"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!categoryDraft} onOpenChange={(o) => !o && setCategoryDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{categoryDraft?.id ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>Foods in a category go to the cooks you assign to it.</DialogDescription>
          </DialogHeader>
          {categoryDraft && (
            <div className="grid gap-4">
              <FormField label="Name" htmlFor="c-name">
                <Input
                  id="c-name"
                  autoFocus
                  placeholder="e.g. Chinese"
                  value={categoryDraft.name}
                  onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && categoryDraft.name.trim() && saveCategory()}
                />
              </FormField>
              <FormField label="Colour" hint="Shown on tickets and kitchen screens.">
                <div className="flex gap-2">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategoryDraft({ ...categoryDraft, color: c })}
                      className={cn("size-7 rounded-full ring-offset-2", categoryDraft.color === c && "ring-2 ring-ink")}
                      style={{ background: c }}
                      aria-label={`Colour ${c}`}
                    />
                  ))}
                </div>
              </FormField>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDraft(null)}>
              Cancel
            </Button>
            <Button onClick={saveCategory} disabled={!categoryDraft?.name.trim()}>
              {categoryDraft?.id ? "Save category" : "Add category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
