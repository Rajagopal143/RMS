import { useState } from "react";
import { Check, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import { NativeSelect, NativeSelectOption } from "@workspace/ui/components/native-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui/components/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { api, getServerHost, ROLE_LABEL, STAFF_ROLES, type StaffMember, type StaffRole } from "@workspace/shared";
import { useBootstrap, useSession } from "../lib/session";
import { useApi } from "../lib/hooks";
import { ErrorNote, FormField, PageHeader, ColorDot } from "../components/bits";

interface Draft {
  id?: number;
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  categoryIds: number[];
  isActive: boolean;
}

const ROLE_HELP: Record<StaffRole, string> = {
  manager: "Runs billing and edits the menu, categories, printers and staff.",
  cashier: "Takes orders, settles table bills and prints bills and KOTs.",
  waiter: "Picks a table on their phone, adds foods and sends them to the kitchen, then serves the food when it's ready.",
  cook: "Sees only the foods in their categories on the kitchen screen, oldest bill first, and marks each one done.",
  packer: "Sees orders once every cook is done, packs them and hands them over.",
};

export function StaffPage() {
  const { user } = useSession();
  const { data: setup } = useBootstrap();
  const { data: staff, error, reload } = useApi<StaffMember[]>("/staff");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const categories = setup!.categories;
  const roles = STAFF_ROLES.filter((r) => r !== "manager" || user?.role === "owner");
  const limit = setup!.subscription?.maxStaff;
  const activeCount = staff?.filter((s) => s.role !== "owner" && s.isActive).length ?? 0;

  async function save() {
    if (!draft) return;
    setBusy(true);
    const body: Record<string, unknown> = {
      name: draft.name,
      email: draft.email,
      role: draft.role,
      categoryIds: draft.role === "cook" ? draft.categoryIds : [],
      isActive: draft.isActive,
    };
    if (draft.password) body.password = draft.password;
    try {
      if (draft.id) await api(`/staff/${draft.id}`, { method: "PATCH", body });
      else await api("/staff", { method: "POST", body });
      toast.success(draft.id ? "Login saved" : `Login created for ${draft.name}`);
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Staff logins"
        description={`Every worker gets their own login. Cooks and packing staff sign in on the kitchen screen at http://${getServerHost()}:5174.`}
        actions={
          <Button onClick={() => setDraft({ name: "", email: "", password: "", role: "cook", categoryIds: [], isActive: true })}>
            <Plus /> Add login
          </Button>
        }
      />
      {limit != null && (
        <p className="mb-4 text-sm text-muted-foreground">
          <span className="tabular text-foreground">{activeCount}</span> of {limit} staff logins used on your {setup!.subscription?.planName} plan.
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Food categories</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(staff ?? []).map((s) => {
              const cats = categories.filter((c) => s.categoryIds.includes(c.id));
              const editable = s.role !== "owner" && (s.role !== "manager" || user?.role === "owner");
              return (
                <TableRow key={s.id} className={s.isActive ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email}</TableCell>
                  <TableCell>{ROLE_LABEL[s.role]}</TableCell>
                  <TableCell>
                    {cats.length > 0 ? (
                      <span className="flex flex-wrap gap-x-3 gap-y-1">
                        {cats.map((c) => (
                          <span key={c.id} className="inline-flex items-center gap-1.5">
                            <ColorDot color={c.color} /> {c.name}
                          </span>
                        ))}
                      </span>
                    ) : s.role === "cook" ? (
                      <span className="font-semibold text-chili">None, sees no orders</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{s.isActive ? "Active" : "Disabled"}</TableCell>
                  <TableCell className="text-right">
                    {editable && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`Edit ${s.name}`}
                        onClick={() => setDraft({ id: s.id, name: s.name, email: s.email, password: "", role: s.role as StaffRole, categoryIds: s.categoryIds, isActive: s.isActive })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit login" : "Add login"}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4">
              <FormField label="Role" htmlFor="s-role" hint={ROLE_HELP[draft.role]}>
                <NativeSelect id="s-role" className="w-full" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as StaffRole })}>
                  {roles.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </FormField>
              {draft.role === "cook" && (
                <FormField label="Food categories this cook makes" hint="When a bill has foods from these categories, they show on this cook's screen. Pick one or more.">
                  <div className="flex flex-wrap gap-1.5">
                    {categories.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No categories yet. Add them in <a href="#/menu" className="underline">Menu</a>.
                      </p>
                    )}
                    {categories.map((c) => {
                      const on = draft.categoryIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setDraft({ ...draft, categoryIds: on ? draft.categoryIds.filter((id) => id !== c.id) : [...draft.categoryIds, c.id] })}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm",
                            on ? "border-ink bg-ink text-white" : "bg-card hover:border-ink/40",
                          )}
                        >
                          {on ? <Check className="size-3.5" /> : <ColorDot color={c.color} />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </FormField>
              )}
              <FormField label="Name" htmlFor="s-name">
                <Input id="s-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </FormField>
              <FormField label="Email (used to sign in)" htmlFor="s-email">
                <Input id="s-email" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </FormField>
              <FormField label={draft.id ? "New password (leave empty to keep)" : "Password"} htmlFor="s-pass" hint="At least 6 characters.">
                <Input id="s-pass" type="text" autoComplete="new-password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} /> Can sign in
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={busy || !draft?.name.trim() || !draft?.email.trim() || (!draft?.id && draft!.password.length < 6) || (draft?.role === "cook" && draft.categoryIds.length === 0)}
            >
              {draft?.id ? "Save login" : "Create login"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
