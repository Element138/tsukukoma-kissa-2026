import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MenuDisplayView } from "../../components/menu-display-view";
import { createFileMenuStore, type FileMenuConfig } from "./file-cache";

const config: FileMenuConfig = JSON.parse(document.getElementById("menu-config")!.textContent!);
const retrievalTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

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
  const retrievedAt = store.getLastRetrievedAt();
  return <>
    <MenuDisplayView loadData={store.loadData} revision={revision} hideControls logoSrc={config.logo} brandTitle="喫茶「翡翠」" />
    {retrievedAt && <time className="file-menu-last-retrieved" dateTime={retrievedAt}>最終取得 {retrievalTime.format(new Date(retrievedAt))} JST</time>}
  </>;
}

createRoot(document.getElementById("root")!).render(<FileMenu />);
