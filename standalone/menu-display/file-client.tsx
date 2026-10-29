import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MenuDisplayView } from "../../components/menu-display-view";
import { createFileMenuStore, type FileMenuConfig } from "./file-cache";

const config: FileMenuConfig = JSON.parse(document.getElementById("menu-config")!.textContent!);

function FileMenu() {
  const [revision, setRevision] = useState(0);
  const [store] = useState(() => createFileMenuStore(config, () => setRevision(value => value + 1)));
  useEffect(() => {
    const update = () => { void store.refresh(); };
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    return () => { window.clearInterval(timer);window.removeEventListener("focus", update);window.removeEventListener("online", update); };
  }, [store]);
  return <MenuDisplayView loadData={store.loadData} revision={revision} hideControls logoSrc={config.logo} />;
}

createRoot(document.getElementById("root")!).render(<FileMenu />);
