"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/toast";
import { Switch } from "@/components/ui/switch";

export function MenuDisplayVisibilitySwitch({ menuId, menuName, visible, onSaved }: {
  menuId: string; menuName: string; visible: boolean; onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { notify } = useToast();
  return <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
    <span className="text-xs font-medium">メニュー表示</span>
    <label className="inline-flex items-center gap-2 text-xs">
      <span>{visible ? "表示" : "非表示"}</span>
      <Switch aria-label={`${menuName}をメニュー表示に掲載`} checked={visible} disabled={busy} onCheckedChange={async checked => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true);
        try {
          await apiFetch("/api/admin/menus", { method: "PATCH", body: JSON.stringify({ id: menuId, showOnMenuDisplay: checked }) });
          await onSaved();
        } catch (error) { notify({ level: "error", message: error instanceof Error ? error.message : "表示設定を保存できませんでした" }); }
        finally { inFlight.current = false; setBusy(false); }
      }} />
    </label>
  </div>;
}
