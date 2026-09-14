import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

// Use the configured Convex URL unless it points at localhost/127.0.0.1 — those
// only resolve inside the sandbox. Local/dev URLs fall back to the app origin's
// /convx proxy, which Vite forwards to the local Convex backend (works from any
// device). A static production build without a build-time env var falls back to
// the hosted deployment URL (public by design — security comes from auth).
const HOSTED_CONVEX_URL = "https://third-wolf-296.convex.cloud";
const envConvexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const isLocal = !envConvexUrl || /\/(localhost|127\.0\.0\.1)/.test(envConvexUrl);
const convexUrl = !isLocal
  ? (envConvexUrl as string)
  : import.meta.env.DEV
    ? `${window.location.origin}/convx`
    : HOSTED_CONVEX_URL;

const convex = new ConvexReactClient(convexUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ConvexAuthProvider>
    </ConvexProvider>
  </StrictMode>,
);
