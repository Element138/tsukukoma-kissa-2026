"use client";

import { useEffect, useRef } from "react";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export function useWakeLock(enabled: boolean) {
  const lockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock?.request) {
      return;
    }

    let disposed = false;

    const releaseLock = async () => {
      const current = lockRef.current;
      lockRef.current = null;
      if (!current) {
        return;
      }
      try {
        await current.release();
      } catch {
        // Ignore release failures; the OS/browser may already have released it.
      }
    };

    const requestLock = async () => {
      if (disposed || document.visibilityState !== "visible") {
        return;
      }
      if (lockRef.current && !lockRef.current.released) {
        return;
      }
      try {
        lockRef.current = await nav.wakeLock.request("screen");
      } catch {
        // Wake Lock may be denied by browser policy or platform settings.
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestLock();
        return;
      }
      void releaseLock();
    };

    void requestLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void releaseLock();
    };
  }, [enabled]);
}
