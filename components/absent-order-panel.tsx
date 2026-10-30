"use client";

import { useEffect, useRef } from "react";

export function AbsentOrderPanel({ orders }: { orders: Array<{ id: string; orderNo: number }> }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const signature = orders.map(order => `${order.id}:${order.orderNo}`).join("|");
  useEffect(() => {
    const viewport = viewportRef.current, track = trackRef.current;
    if (!viewport || !track) return;
    let animation: Animation | undefined;
    const layout = () => {
      animation?.cancel();
      const overflow = Math.max(0, track.scrollHeight - viewport.clientHeight);
      if (overflow > 1) animation = track.animate([
        { transform: "translateY(0)", offset: 0 },
        { transform: "translateY(0)", offset: .15 },
        { transform: `translateY(-${overflow}px)`, offset: .7 },
        { transform: `translateY(-${overflow}px)`, offset: .9 },
        { transform: "translateY(0)", offset: 1 },
      ], { duration: Math.max(16000, overflow * 100), iterations: Infinity });
    };
    const observer = new ResizeObserver(layout);
    observer.observe(viewport); observer.observe(track); layout();
    return () => { observer.disconnect(); animation?.cancel(); };
  }, [signature]);
  if (!orders.length) return null;
  return <section className="order-display-absent" aria-label="ご不在">
    <h2>ご不在</h2>
    <div ref={viewportRef} className="order-display-absent-viewport">
      <div ref={trackRef} className="order-display-absent-numbers">
        {orders.map(order => <span key={order.id}>{order.orderNo}</span>)}
      </div>
    </div>
  </section>;
}
