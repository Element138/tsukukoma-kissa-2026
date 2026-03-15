"use client";

import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Dismiss20Regular } from "@fluentui/react-icons";

export type ToastLevel = "info" | "success" | "warning" | "error";

type ToastItem = {
  id: string;
  message: string;
  level: ToastLevel;
  sticky: boolean;
  durationMs: number;
  actions: ToastAction[];
};

type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastInput = {
  id?: string;
  message: string;
  level?: ToastLevel;
  sticky?: boolean;
  durationMs?: number;
  actions?: ToastAction[];
};

type ToastContextValue = {
  toasts: ToastItem[];
  notify: (input: ToastInput) => void;
  dismiss: (id: string) => void;
  clearByPrefix: (prefix: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function createToastId() {
  return `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const clearByPrefix = useCallback((prefix: string) => {
    setToasts((prev) => prev.filter((toast) => !toast.id.startsWith(prefix)));
  }, []);

  const notify = useCallback((input: ToastInput) => {
    const next: ToastItem = {
      id: input.id ?? createToastId(),
      message: input.message,
      level: input.level ?? "info",
      sticky: input.sticky ?? false,
      durationMs: input.durationMs ?? 3500,
      actions: input.actions ?? [],
    };

    setToasts((prev) => {
      const idx = prev.findIndex((toast) => toast.id === next.id);
      if (idx === -1) {
        return [...prev, next];
      }

      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });

    if (!next.sticky) {
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== next.id));
      }, next.durationMs);
    }
  }, []);

  const value = useMemo(
    () => ({
      toasts,
      notify,
      dismiss,
      clearByPrefix,
    }),
    [toasts, notify, dismiss, clearByPrefix],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.level}`}>
            <div className="toast-body">
              <div>{toast.message}</div>
              {toast.actions.length > 0 ? (
                <div className="toast-actions">
                  {toast.actions.map((action, index) => (
                    <button
                      key={`${toast.id}-action-${index}`}
                      type="button"
                      className="toast-action-btn"
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label={"閉じる"}
            >
              <Dismiss20Regular />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
}
