// PM2 process list for the API and the live-updates service. deploy.sh starts it with:
//   pm2 startOrReload deploy/ecosystem.config.cjs --update-env
// Secrets are read from the .env file next to the deploy folder, so none are kept in this file.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf("=");
    if (at > 0 && !line.trim().startsWith("#")) env[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return env;
}

const env = readEnv(path.join(root, ".env"));

const common = {
  interpreter: "none",
  autorestart: true,
  max_restarts: 20,
  restart_delay: 2000,
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: "rms-api",
      cwd: path.join(root, "apps/backend"),
      script: "./node_modules/.bin/tsx",
      args: "src/index.ts",
      env: { NODE_ENV: "production", PORT: "3001", DATABASE_URL: env.DATABASE_URL, JWT_SECRET: env.JWT_SECRET, TZ: env.TZ || "Asia/Kolkata" },
    },
    {
      ...common,
      name: "rms-live",
      cwd: path.join(root, "apps/ws"),
      script: "./node_modules/.bin/tsx",
      args: "src/index.ts",
      env: { NODE_ENV: "production", PORT: "3002", DATABASE_URL: env.DATABASE_URL, JWT_SECRET: env.JWT_SECRET, TZ: env.TZ || "Asia/Kolkata" },
    },
  ],
};
