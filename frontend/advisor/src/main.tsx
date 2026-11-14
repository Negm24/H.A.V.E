import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createAppI18n } from "@have/shared/i18n";
import { initializeTelemetry } from "@have/shared/telemetry/react";
import "@have/shared/styles";
import App from "./app/App";
import { advisorResources } from "./app/i18n";

initializeTelemetry("advisor");
const i18n = await createAppI18n("advisor");
i18n.addResourceBundle("en", "advisor", advisorResources.en);
i18n.addResourceBundle("ar", "advisor", advisorResources.ar);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
