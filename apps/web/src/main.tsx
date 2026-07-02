import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@hearthside/pixel-ui/src/tokens.css";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
