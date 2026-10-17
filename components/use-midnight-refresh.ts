"use client";
import { useEffect, useRef } from "react";
import { tokyoDateKey, tokyoDayRangeUtc } from "@/lib/time";

export function useMidnightRefresh(enabled: boolean, refresh: (dayChanged: boolean) => void) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let dayKey=tokyoDateKey();
    const update=()=>{const next=tokyoDateKey();const changed=next!==dayKey;dayKey=next;latest.current(changed);};
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer=setTimeout(()=>{update();schedule();},Math.max(50,tokyoDayRangeUtc().end.getTime()-Date.now()+50));
    };
    const visible = () => {if(document.visibilityState==="visible"){update();schedule();}};
    schedule();document.addEventListener("visibilitychange",visible);
    return ()=>{clearTimeout(timer);document.removeEventListener("visibilitychange",visible);};
  },[enabled]);
}
