import { useState, type FormEvent } from "react";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { getServerHost, setServerHost } from "@workspace/shared";
import { useSession } from "../lib/session";
import { ErrorNote, FormField } from "../components/bits";

export function LoginPage() {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState(getServerHost());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setServerHost(server);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-svh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-display text-4xl font-bold text-white">
          RMS<span className="text-turmeric">.</span>
        </p>
        <form onSubmit={submit} className="ticket space-y-4 px-6 pb-8 pt-6" style={{ ["--ticket-accent" as string]: "var(--color-turmeric)" }}>
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Admin · Billing</p>
            <h1 className="mt-1 text-2xl font-semibold">Sign in</h1>
          </div>
          <hr className="ticket-rule" />
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {showServer ? (
            <FormField label="Server address" htmlFor="server" hint="IP or hostname of the computer running RMS.">
              <Input id="server" value={server} onChange={(e) => setServer(e.target.value)} placeholder="192.168.1.20" />
            </FormField>
          ) : (
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowServer(true)}>
              Server: {server}
            </button>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
