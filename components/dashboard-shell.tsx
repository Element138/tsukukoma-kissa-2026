"use client";

import { PropsWithChildren, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DashboardShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}>;

export function DashboardShell(props: DashboardShellProps) {
  return (
    <main className={cn("dashboard-shell", props.className)}>
      <Card className="dashboard-hero border-white/70 bg-white/90 shadow-lg">
        <CardContent className="flex items-start justify-between gap-4 p-5">
          <div>
            {props.eyebrow && <p className="dashboard-eyebrow">{props.eyebrow}</p>}
            <h1 className="dashboard-title">{props.title}</h1>
            {props.subtitle && <p className="dashboard-subtitle">{props.subtitle}</p>}
          </div>
          {props.actions && <div className="dashboard-actions">{props.actions}</div>}
        </CardContent>
      </Card>
      <div className="dashboard-body">{props.children}</div>
    </main>
  );
}
