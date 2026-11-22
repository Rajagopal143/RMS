import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/figtree";
import "@fontsource-variable/jetbrains-mono";
import "./index.css";
import { App } from "./app";
import { desktop } from "./lib/desktop";

// Offline support and installability, for the web version only. The Electron app loads from a file,
// where service workers don't apply, and browsers only allow them on https or localhost.
if ("serviceWorker" in navigator && window.isSecureContext && location.protocol.startsWith("http") && !desktop) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
