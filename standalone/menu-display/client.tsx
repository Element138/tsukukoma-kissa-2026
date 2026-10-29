import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MenuDisplayView, type MenuDisplayPayload } from "../../components/menu-display-view";

async function loadData(): Promise<MenuDisplayPayload> {
  const response = await fetch("/api/menu-display", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error("Saved menu unavailable");
  return body.data;
}

function LocalMenu() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    const events = new EventSource("/events");
    events.onmessage = update;
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { events.close(); window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  return <MenuDisplayView loadData={loadData} revision={revision} hideControls />;
}

createRoot(document.getElementById("root")!).render(<LocalMenu />);
