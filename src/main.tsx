import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { openExternalLinksInBrowser } from "./utils/externalLinks";
import "./App.css";

openExternalLinksInBrowser();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
