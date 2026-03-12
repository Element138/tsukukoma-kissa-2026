"use client";

import { PropsWithChildren } from "react";
import { Card as ShadCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function LogoPlaceholder() {
  return (
    <div className="logo-placeholder rounded-lg border border-dashed border-border bg-card" aria-label={"KISSa ���S"}>
      <img src="/logo-placeholder.svg" alt={"KISSa ���S"} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
}

export function Card(props: PropsWithChildren<{ className?: string }>) {
  return <ShadCard className={cn("card", props.className)}>{props.children}</ShadCard>;
}

export function SectionTitle(props: PropsWithChildren) {
  return <h2 className="section-title text-base font-semibold tracking-tight">{props.children}</h2>;
}
