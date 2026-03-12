"use client";

import { PropsWithChildren } from "react";

export function LogoPlaceholder() {
  return (
    <div className="logo-placeholder" aria-label={"KISSa \u30ed\u30b4"}>
      <img src="/logo-placeholder.svg" alt={"KISSa \u30ed\u30b4"} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
}

export function Card(props: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${props.className ?? ""}`.trim()}>{props.children}</section>;
}

export function SectionTitle(props: PropsWithChildren) {
  return <h2 className="section-title">{props.children}</h2>;
}
