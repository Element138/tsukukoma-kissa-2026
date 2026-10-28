"use client";

import { PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/utils";

type DashboardShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  hideHeader?: boolean;
  className?: string;
}>;

export function DashboardShell(props: DashboardShellProps) {
  return (
    <main className={cn("dashboard-shell", props.className)}>
      {!props.hideHeader && (
        <header className="dashboard-hero">
          <div className="flex w-full items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="dashboard-title">{props.title}</h1>
              {props.subtitle && <p className="dashboard-subtitle">{props.subtitle}</p>}
            </div>
            {props.actions && <div className="dashboard-actions ml-auto">{props.actions}</div>}
          </div>
        </header>
      )}
      <div className="dashboard-body">{props.children}</div>
    </main>
  );
}
