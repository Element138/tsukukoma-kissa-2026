"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";
import { useToast } from "@/components/toast";
import { useRealtimeSubscription } from "@/components/use-realtime-subscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Entry = { date: string; time: string; closesAt: string };

export function MenuLastOrdersSettings() {
  const { notify } = useToast();
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<{ today: string; entries: Entry[] }>("/api/admin/menu-last-orders");
      setToday(data.today); setDate(value => value || data.today); setEntries(data.entries); setError(null);
    } catch { setError("ラストオーダー時刻を読み込めません"); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useRealtimeSubscription({ enabled: true, channels: ["settings"], onEvent: () => void reload(), onResync: () => void reload() });
  const mutate = async (method: "PUT" | "DELETE", selectedDate: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch("/api/admin/menu-last-orders", { method, body: JSON.stringify({ date: selectedDate, ...(method === "PUT" ? { time } : {}) }) });
      await reload();
      notify({ level: "success", message: method === "PUT" ? "ラストオーダー時刻を保存しました" : "ラストオーダー時刻を削除しました" });
    } catch (cause) { notify({ level: "error", message: cause instanceof Error ? cause.message : "保存できませんでした" }); }
    finally { setBusy(false); }
  };
  return <Card>
    <CardHeader className="pb-3"><CardTitle className="text-sm">ラストオーダー時刻</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void mutate("PUT", date); }}>
        <label className="space-y-1 text-sm">日付（JST）<Input type="date" min={today || undefined} value={date} required disabled={busy || !today} onChange={event => { const value=event.target.value;setDate(value);setTime(entries.find(entry=>entry.date===value)?.time || ""); }} /></label>
        <label className="space-y-1 text-sm">時刻<Input type="time" value={time} required disabled={busy || !today} onChange={event => setTime(event.target.value)} /></label>
        <Button type="submit" disabled={busy || !date || !time}>保存</Button>
      </form>
      {error && <div className="flex items-center gap-2 text-sm text-rose-700" role="alert">{error}<Button variant="outline" size="sm" onClick={() => void reload()}>再読込</Button></div>}
      {entries.map(entry => <div key={entry.date} className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
        <span className="tabular-nums">{entry.date.replaceAll("-", "/")}　{entry.time}</span>
        <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setDate(entry.date); setTime(entry.time); }}>編集</Button><Button type="button" size="sm" variant="outline" className="text-red-700 hover:text-red-800" disabled={busy} onClick={() => { if(window.confirm(`${entry.date} のラストオーダー時刻を削除しますか？`))void mutate("DELETE",entry.date); }}>削除</Button></div>
      </div>)}
    </CardContent>
  </Card>;
}
