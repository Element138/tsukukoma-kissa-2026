"use client";

import { PropsWithChildren, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DashboardShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  fancyHeader?: boolean;
  hideHeader?: boolean;
  className?: string;
}>;

export function DashboardShell(props: DashboardShellProps) {
  return (
    <main className={cn("dashboard-shell", props.className)}>
      {!props.hideHeader && (
        <Card
          className={cn(
            "dashboard-hero border-white/70 bg-white/90 shadow-lg",
            props.fancyHeader ? "dashboard-hero-fancy" : "dashboard-hero-plain"
          )}
        >
          <CardContent className="flex w-full items-start justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              {props.eyebrow && <p className="dashboard-eyebrow">{props.eyebrow}</p>}
              <h1 className="dashboard-title">{props.title}</h1>
              {props.subtitle && <p className="dashboard-subtitle">{props.subtitle}</p>}
            </div>
            {props.actions && <div className="dashboard-actions ml-auto">{props.actions}</div>}
          </CardContent>
        </Card>
      )}
      <div className="dashboard-body">{props.children}</div>
    </main>
  );
}
