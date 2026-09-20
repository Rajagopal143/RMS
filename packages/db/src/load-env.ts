import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loads env files relative to this package and the monorepo root (cwd-independent).
 */
export function loadDbEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, "..");
  const repoRoot = path.resolve(pkgRoot, "../..");

  config({ path: path.join(repoRoot, ".env") });
  config({ path: path.join(repoRoot, ".env.local") });
  config({ path: path.join(pkgRoot, ".env"), override: true });
  config({ path: path.join(pkgRoot, ".env.local"), override: true });
}
