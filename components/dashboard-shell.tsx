"use client";

import { PropsWithChildren, ReactNode } from "react";

type DashboardShellProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}>;

export function DashboardShell(props: DashboardShellProps) {
  return (
    <main className={`dashboard-shell ${props.className ?? ""}`.trim()}>
      <section className="dashboard-hero">
        <div>
          {props.eyebrow && <p className="dashboard-eyebrow">{props.eyebrow}</p>}
          <h1 className="dashboard-title">{props.title}</h1>
          {props.subtitle && <p className="dashboard-subtitle">{props.subtitle}</p>}
        </div>
        {props.actions && <div className="dashboard-actions">{props.actions}</div>}
      </section>
      <div className="dashboard-body">{props.children}</div>
    </main>
  );
}