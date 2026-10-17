"use client";

import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  RefreshCw,
  StickyNote,
  Undo2,
  Utensils,
  X,
} from "lucide-react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { useToast } from "@/components/toast";
import { LoadingScreen } from "@/components/loading-screen";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FULFILLMENT_LABEL,
  ORDER_ITEM_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  labelOf,
} from "@/lib/labels";
import { AGE_GROUPS, type AgeGroupCounts } from "@/lib/age-groups";

const TOKYO_TZ = "Asia/Tokyo";
const DAY_MS = 24 * 60 * 60 * 1000;

type MenuSummary = {
  menuId: string;
  name: string;
  count: number;
  salesJpy: number;
};

type SalesEvent = {
  at: string;
  orderId: string;
  orderNo: number;
  menuId: string | null;
  menuName: string | null;
  itemId: string | null;
};

type WaitSummary = {
  key: string;
  label: string;
  sampleSize: number;
  p50Seconds: number | null;
  maxSeconds: number | null;
  lateRatio: number | null;
  severeLateRatio: number | null;
};

type WaitPoint = {
  key: string;
  orderId: string;
  orderNo: number;
  confirmedAt: string;
  finishedAt: string;
  waitSeconds: number;
  itemId: string | null;
  menuId: string | null;
  menuName: string | null;
};

type SalesIncident = {
  id: string;
  orderId: string;
  orderNo: number;
  at: string;
  severity: "warning" | "danger";
  type: string;
  message: string;
  dismissedAt: string | null;
};

type SalesData = {
  date: string;
  timezone: string;
  range: {
    start: string;
    end: string;
    chartStart: string;
    chartEnd: string;
  };
  chartRange: { chartStart: string; chartEnd: string };
  totals: {
    orderCount: number;
    itemCount: number;
    salesJpy: number;
    failedOrCanceledCount: number;
    unconfirmedCount: number;
  };
  menus: MenuSummary[];
  salesEvents: SalesEvent[];
  wait: {
    summaries: WaitSummary[];
    points: WaitPoint[];
    yMaxMinutes: number;
  };
  incidents: SalesIncident[];
};

type ActorRef = { id: string; label: string } | null;

type OrderDetail = {
  id: string;
  orderNo: number;
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  fulfillmentType: string;
  tableNo: number | null;
  partySize: number;
  ageGroupCounts: AgeGroupCounts;
  specialNote: string | null;
  excludeFromWaitStats: boolean;
  lastMutationVersion: number;
  paymentMethod: string;
  paymentStatus: string;
  paymentSkipReasonType: string | null;
  paymentSkipReasonText: string | null;
  orderStatus: string;
  totalPriceJpy: number;
  events: unknown;
  eventActors: Record<string, string>;
  createdBy: { id: string; label: string };
  items: Array<{
    id: string;
    itemNameSnapshot: string;
    unitPriceJpy: number;
    status: string;
    kitchenAssignedAt: string | null;
    readyAt: string | null;
    servedAt: string | null;
    kitchenActor: ActorRef;
    servedBy: ActorRef;
  }>;
  auditLogs: Array<{
    id: string;
    timestamp: string;
    actionType: string;
    result: string;
    reasonType: string | null;
    reasonText: string | null;
    beforeJson: unknown;
    afterJson: unknown;
    actor: ActorRef;
  }>;
  paymentIncidents: Array<{
    id: string;
    messageJa: string;
    createdAt: string;
    dismissedAt: string | null;
    dismissedBy: ActorRef;
  }>;
};

type TimelineRow = {
  id: string;
  at: string;
  type: string;
  title: string;
  detail: string | null;
  actor: string | null;
  tone?: "danger" | "warning" | "normal";
};

function tokyoDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDateDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00+09:00`);
  return tokyoDateKey(new Date(date.getTime() + days * DAY_MS));
}

function formatDay(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    timeZone: TOKYO_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("ja-JP", {
    timeZone: TOKYO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}分 ${String(rest).padStart(2, "0")}秒`;
}

function formatRatio(value: number | null) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
}

function metricTone(value: number | null, warning: number, danger: number) {
  if (value == null) return "";
  if (value >= danger) return "is-danger";
  if (value >= warning) return "is-warning";
  return "";
}

const CHART = {
  width: 920,
  height: 390,
  left: 54,
  right: 18,
  top: 20,
  bottom: 40,
};

function xScaleForWidth(
  at: number,
  start: number,
  end: number,
  chartWidth: number,
) {
  const plotWidth = chartWidth - CHART.left - CHART.right;
  return CHART.left + ((at - start) / (end - start)) * plotWidth;
}

function yScale(value: number, max: number) {
  const height = CHART.height - CHART.top - CHART.bottom;
  return CHART.top + height - (value / Math.max(1, max)) * height;
}

function chartHours(start: number, end: number) {
  const hours: Array<{ at: number; label: string }> = [];
  const hourMs = 60 * 60 * 1000;
  for (let at = start; at <= end; at += hourMs) {
    hours.push({
      at,
      label: new Date(at).toLocaleTimeString("ja-JP", {
        timeZone: TOKYO_TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    });
  }
  return hours;
}

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CHART.width);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () =>
      setWidth(Math.max(560, Math.round(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function ChartAxes({
  yMax,
  yLabel,
  start,
  end,
  width,
}: {
  yMax: number;
  yLabel: string;
  start: number;
  end: number;
  width: number;
}) {
  const plotBottom = CHART.height - CHART.bottom;
  const plotRight = width - CHART.right;
  const yTicks = [0, yMax / 2, yMax];
  const hours = chartHours(start, end);
  const labelEvery = Math.max(1, Math.ceil((hours.length - 1) / Math.max(1, Math.floor((plotRight - CHART.left) / 65))));
  return (
    <g className="sales-chart-axes" aria-hidden="true">
      {hours.map((hour, index) => {
        const x = xScaleForWidth(hour.at, start, end, width);
        return (
          <g key={hour.at}>
            <line x1={x} x2={x} y1={CHART.top} y2={plotBottom} />
            {index % labelEvery === 0 && <text x={x} y={CHART.height - 13} textAnchor="middle">
              {hour.label}
            </text>}
          </g>
        );
      })}
      {yTicks.map((tick) => {
        const y = yScale(tick, yMax);
        return (
          <g key={tick}>
            <line x1={CHART.left} x2={plotRight} y1={y} y2={y} />
            <text x={CHART.left - 9} y={y + 4} textAnchor="end">
              {yLabel === "分" ? Math.round(tick) : Math.round(tick)}
            </text>
          </g>
        );
      })}
      <text className="sales-chart-y-label" x={8} y={12}>
        {yLabel}
      </text>
    </g>
  );
}

function CumulativeChart({
  events,
  start,
  end,
  label,
  onOpenOrder,
}: {
  events: SalesEvent[];
  start: string;
  end: string;
  label: string;
  onOpenOrder: (orderId: string) => void;
}) {
  const chart = useChartWidth();
  const [hovered, setHovered] = useState<{
    event: SalesEvent;
    count: number;
    x: number;
    y: number;
  } | null>(null);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const sorted = [...events].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
  let count = sorted.filter(
    (event) => new Date(event.at).getTime() < startMs,
  ).length;
  const initialCount = count;
  const visible = sorted.filter((event) => {
    const at = new Date(event.at).getTime();
    return at >= startMs && at <= endMs;
  });
  const endCount = initialCount + visible.length;
  const yMax = Math.max(1, endCount);
  const commands = [`M ${CHART.left} ${yScale(initialCount, yMax)}`];
  const dots: Array<{
    x: number;
    y: number;
    event: SalesEvent;
    count: number;
  }> = [];
  for (const event of visible) {
    const x = xScaleForWidth(
      new Date(event.at).getTime(),
      startMs,
      endMs,
      chart.width,
    );
    commands.push(`H ${x}`);
    count += 1;
    const y = yScale(count, yMax);
    commands.push(`V ${y}`);
    dots.push({ x, y, event, count });
  }
  commands.push(`H ${chart.width - CHART.right}`);

  const openFromKeyboard = (
    event: React.KeyboardEvent<SVGGElement>,
    orderId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenOrder(orderId);
    }
  };

  return (
    <div className="sales-chart-wrap" ref={chart.ref}>
      <svg
        className="sales-chart"
        viewBox={`0 0 ${chart.width} ${CHART.height}`}
        role="img"
        aria-label={`${label}の累計販売数。注文稼働時間を実時刻で表示`}
      >
        <ChartAxes
          yMax={yMax}
          yLabel="累計"
          start={startMs}
          end={endMs}
          width={chart.width}
        />
        <path className="sales-step-line" d={commands.join(" ")} />
        {dots.map((dot, index) => (
          <g
            key={`${dot.event.orderId}:${dot.event.itemId ?? "order"}:${index}`}
            className="sales-step-point"
            role="button"
            tabIndex={0}
            aria-label={`注文 #${dot.event.orderNo}、${formatTime(dot.event.at)}、累計 ${dot.count}。注文を開く`}
            onClick={() => onOpenOrder(dot.event.orderId)}
            onKeyDown={(event) => openFromKeyboard(event, dot.event.orderId)}
            onMouseEnter={() => setHovered(dot)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(dot)}
            onBlur={() => setHovered(null)}
          >
            <circle className="sales-step-dot" cx={dot.x} cy={dot.y} r={4.5} />
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className={`sales-plot-tooltip sales-plot-tooltip-overlay ${hovered.y > 90 ? "is-above" : "is-below"}`}
          style={{
            left: `${Math.min(88, Math.max(12, (hovered.x / chart.width) * 100))}%`,
            top: `${(hovered.y / CHART.height) * 100}%`,
          }}
        >
          <div>
            <strong>注文 #{hovered.event.orderNo}</strong>
            <b>累計 {hovered.count}</b>
          </div>
          <span>
            {hovered.event.menuName ? `${hovered.event.menuName} · ` : ""}
            {formatTime(hovered.event.at)}
          </span>
        </div>
      )}
      {events.length === 0 && (
        <div className="sales-chart-empty">販売データなし</div>
      )}
    </div>
  );
}

function WaitChart({
  points,
  start,
  end,
  yMax,
  onOpenOrder,
}: {
  points: WaitPoint[];
  start: string;
  end: string;
  yMax: number;
  onOpenOrder: (orderId: string) => void;
}) {
  const chart = useChartWidth();
  const [hovered, setHovered] = useState<{
    point: WaitPoint;
    x: number;
    y: number;
  } | null>(null);
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const relevant = points.filter((point) => {
    const confirmed = new Date(point.confirmedAt).getTime();
    return confirmed >= startMs && confirmed <= endMs;
  });
  const openFromKeyboard = (
    event: React.KeyboardEvent<SVGGElement>,
    orderId: string,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenOrder(orderId);
    }
  };

  return (
    <div className="sales-chart-wrap" ref={chart.ref}>
      <svg
        className="sales-chart sales-wait-chart"
        viewBox={`0 0 ${chart.width} ${CHART.height}`}
        role="img"
        aria-label="確定時刻と最終待ち時間の散布図"
      >
        <ChartAxes
          yMax={yMax}
          yLabel="分"
          start={startMs}
          end={endMs}
          width={chart.width}
        />
        {relevant.map((point, index) => {
          const confirmedMs = new Date(point.confirmedAt).getTime();
          const finishedMs = new Date(point.finishedAt).getTime();
          const finalMinutes = point.waitSeconds / 60;
          const color =
            point.waitSeconds > 40 * 60
              ? "#d92d20"
              : point.waitSeconds > 25 * 60
                ? "#d99a00"
                : "#11998e";
          const title = `注文 #${point.orderNo} / ${formatTime(point.confirmedAt)} → ${formatTime(point.finishedAt)} / ${formatDuration(point.waitSeconds)}`;
          const x1 = xScaleForWidth(confirmedMs, startMs, endMs, chart.width);
          const x2 = xScaleForWidth(
            Math.min(finishedMs, endMs),
            startMs,
            endMs,
            chart.width,
          );
          const y = yScale(finalMinutes, yMax);
          return (
            <g
              key={`${point.key}:${point.itemId ?? point.orderId}:${index}`}
              className="sales-wait-point"
              role="button"
              tabIndex={0}
              aria-label={`${title}。注文を開く`}
              onClick={() => onOpenOrder(point.orderId)}
              onKeyDown={(event) => openFromKeyboard(event, point.orderId)}
              onMouseEnter={() => setHovered({ point, x: x1, y })}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered({ point, x: x1, y })}
              onBlur={() => setHovered(null)}
            >
              <line
                className="sales-wait-extension"
                x1={x1}
                x2={Math.max(x1, x2)}
                y1={y}
                y2={y}
              />
              <circle cx={x1} cy={y} r={5.5} style={{ fill: color }} />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className={`sales-plot-tooltip sales-plot-tooltip-overlay ${hovered.y > 90 ? "is-above" : "is-below"}`}
          style={{
            left: `${Math.min(88, Math.max(12, (hovered.x / chart.width) * 100))}%`,
            top: `${(hovered.y / CHART.height) * 100}%`,
          }}
        >
          <div>
            <strong>注文 #{hovered.point.orderNo}</strong>
            <b>{formatDuration(hovered.point.waitSeconds)}</b>
          </div>
          <span>
            {hovered.point.menuName ? `${hovered.point.menuName} · ` : ""}
            {formatTime(hovered.point.confirmedAt)} →{" "}
            {formatTime(hovered.point.finishedAt)}
          </span>
        </div>
      )}
      {relevant.length === 0 && (
        <div className="sales-chart-empty">完了した待ち時間データなし</div>
      )}
    </div>
  );
}

function eventDetail(detail: unknown) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return null;
  const value = detail as Record<string, unknown>;
  const parts = [value.reasonType, value.reasonText].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return parts.length > 0 ? parts.join(" / ") : null;
}

const EVENT_LABEL: Record<string, string> = {
  PAYMENT_STARTED: "決済開始",
  PAYMENT_SUCCESS: "決済完了",
  PAYMENT_FAILED: "決済失敗",
  ORDER_CONFIRMED: "注文確定",
  ORDER_FAILED: "注文失敗",
  MANUAL_CLOSURE: "手動完了",
  ORDER_STATISTICS_UPDATED: "備考・集計設定更新",
  PAYMENT_SUCCESS_CALLBACK_AFTER_FAILED: "失敗後に決済成功通知",
};

function buildTimeline(order: OrderDetail): TimelineRow[] {
  const rows: TimelineRow[] = [
    {
      id: "created",
      at: order.createdAt,
      type: "CREATED",
      title: "注文作成",
      detail: null,
      actor: order.createdBy.label,
    },
  ];
  const rawEvents = Array.isArray(order.events) ? order.events : [];
  const combineCash =
    (order.paymentMethod === "CASH" ||
      order.paymentMethod === "PAYMENT_SKIPPED") &&
    order.confirmedAt;
  if (combineCash) {
    rows.push({
      id: "cash-confirmed",
      at: order.confirmedAt!,
      type: "PAYMENT_SUCCESS",
      title:
        order.paymentMethod === "CASH"
          ? "現金決済・注文確定"
          : "決済スキップ・注文確定",
      detail:
        order.paymentMethod === "PAYMENT_SKIPPED"
          ? [order.paymentSkipReasonType, order.paymentSkipReasonText]
              .filter(Boolean)
              .join(" / ") || null
          : null,
      actor: order.createdBy.label,
      tone: order.paymentMethod === "PAYMENT_SKIPPED" ? "warning" : "normal",
    });
  }
  rawEvents.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const event = raw as Record<string, unknown>;
    const type = typeof event.type === "string" ? event.type : "";
    const at = typeof event.at === "string" ? event.at : "";
    if (!type || !at || type === "SPECIAL_NOTE_UPDATED") return;
    if (
      combineCash &&
      (type === "PAYMENT_STARTED" ||
        type === "PAYMENT_SUCCESS" ||
        type === "ORDER_CONFIRMED")
    ) {
      return;
    }
    const actorId = typeof event.actorId === "string" ? event.actorId : null;
    rows.push({
      id: `event:${index}`,
      at,
      type,
      title: EVENT_LABEL[type] ?? type,
      detail: eventDetail(event.detail),
      actor: actorId ? (order.eventActors[actorId] ?? actorId) : null,
      tone: type.includes("FAILED") ? "danger" : "normal",
    });
  });
  const servedItems = order.items.filter((item) => item.servedAt);
  const allItemsServed =
    order.items.length > 0 && servedItems.length === order.items.length;
  const lastServedMs = Math.max(
    0,
    ...servedItems.map((item) => new Date(item.servedAt!).getTime()),
  );
  order.items.forEach((item) => {
    if (item.readyAt) {
      rows.push({
        id: `ready:${item.id}`,
        at: item.readyAt,
        type: "ITEM_READY",
        title: "調理完了",
        detail: item.itemNameSnapshot,
        actor: item.kitchenActor?.label ?? null,
      });
    }
    if (item.servedAt) {
      rows.push({
        id: `served:${item.id}`,
        at: item.servedAt,
        type: "ITEM_SERVED",
        title:
          allItemsServed && new Date(item.servedAt).getTime() === lastServedMs
            ? "提供完了"
            : "一部提供完了",
        detail: item.itemNameSnapshot,
        actor: item.servedBy?.label ?? null,
      });
    }
  });
  order.auditLogs
    .filter(
      (log) =>
        log.actionType === "UNDO" || log.actionType === "SPECIAL_NOTE_UPDATED",
    )
    .forEach((log) => {
      rows.push({
        id: `audit:${log.id}`,
        at: log.timestamp,
        type: log.actionType,
        title: log.actionType === "UNDO" ? "操作を取消" : "備考更新",
        detail:
          log.reasonText ??
          (log.actionType === "SPECIAL_NOTE_UPDATED"
            ? order.specialNote
            : null),
        actor: log.actor?.label ?? null,
        tone: log.result === "FAILURE" ? "danger" : "normal",
      });
    });
  order.paymentIncidents.forEach((incident) => {
    rows.push({
      id: `incident:${incident.id}`,
      at: incident.createdAt,
      type: "INCIDENT",
      title: "決済インシデント",
      detail: incident.messageJa,
      actor: null,
      tone: "danger",
    });
    if (incident.dismissedAt) {
      rows.push({
        id: `incident-dismissed:${incident.id}`,
        at: incident.dismissedAt,
        type: "INCIDENT_DISMISSED",
        title: "インシデント確認済み",
        detail: null,
        actor: incident.dismissedBy?.label ?? null,
      });
    }
  });
  if (order.canceledAt) {
    rows.push({
      id: "canceled",
      at: order.canceledAt,
      type: "ORDER_FAILED",
      title: "注文取消",
      detail: null,
      actor: null,
      tone: "danger",
    });
  }
  return rows.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );
}

function TimelineIcon({ type }: { type: string }) {
  if (type.includes("PAYMENT")) return <CircleDollarSign aria-hidden="true" />;
  if (type === "ORDER_CONFIRMED") return <CheckCircle2 aria-hidden="true" />;
  if (type === "ITEM_READY") return <Bell aria-hidden="true" />;
  if (type === "ITEM_SERVED") return <Utensils aria-hidden="true" />;
  if (type === "UNDO") return <Undo2 aria-hidden="true" />;
  if (type === "SPECIAL_NOTE_UPDATED") return <StickyNote aria-hidden="true" />;
  if (type.includes("FAILED") || type === "INCIDENT") {
    return <AlertTriangle aria-hidden="true" />;
  }
  return <Clock3 aria-hidden="true" />;
}

const OrderDrawer = memo(function OrderDrawer({
  order,
  loading,
  onClose,
  canEdit,
  onSaved,
  onDirtyChange,
}: {
  order: OrderDetail | null;
  loading: boolean;
  onClose: () => void;
  canEdit: boolean;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const timeline = useMemo(() => (order ? buildTimeline(order) : []), [order]);
  const { notify } = useToast();
  const [note, setNote] = useState(order?.specialNote ?? "");
  const [excluded, setExcluded] = useState(order?.excludeFromWaitStats ?? false);
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(order && (note !== (order.specialNote ?? "") || excluded !== order.excludeFromWaitStats));
  useEffect(()=>{onDirtyChange(dirty);return ()=>onDirtyChange(false);},[dirty,onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty]);
  const save = async () => {
    if (!order || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/api/sales/orders/${order.id}`,{method:"PATCH",body:JSON.stringify({expectedVersion:order.lastMutationVersion,specialNote:note,excludeFromWaitStats:excluded})});
      await onSaved();
      notify({level:"success",message:"変更をすべて保存しました"});
    } catch(error) {notify({level:"error",message:error instanceof Error?error.message:"保存に失敗しました"});}
    finally {setSaving(false);}
  };
  return (
    <aside className="sales-order-drawer" aria-label="注文詳細">
      <div className="sales-drawer-head">
        <div>
          <h2>{order ? `注文 #${order.orderNo}` : "注文詳細"}</h2>
        </div>
        <button
          type="button"
          className="ghost-btn sales-icon-btn"
          disabled={saving}
          onClick={() => {if (!dirty || window.confirm("未保存の変更を破棄しますか？")) onClose();}}
          aria-label="閉じる"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {loading && !order && (
        <div className="sales-drawer-loading">読み込み中…</div>
      )}
      {!loading && !order && (
        <div className="sales-drawer-loading">注文を取得できませんでした</div>
      )}
      {order && (
        <div className="sales-drawer-body">
          <div className="sales-drawer-summary">
            <div className="row between wrap">
              <div className="row wrap">
                <span className="badge">
                  {labelOf(ORDER_STATUS_LABEL, order.orderStatus)}
                </span>
                <span className="badge">
                  {labelOf(PAYMENT_STATUS_LABEL, order.paymentStatus)}
                </span>
              </div>
              <strong>{fmtJpy(order.totalPriceJpy)}</strong>
            </div>
            <dl className="sales-meta-grid">
              <div>
                <dt>作成</dt>
                <dd>{formatTime(order.createdAt)}</dd>
              </div>
              <div>
                <dt>確定</dt>
                <dd>{formatTime(order.confirmedAt)}</dd>
              </div>
              <div>
                <dt>形態</dt>
                <dd>{labelOf(FULFILLMENT_LABEL, order.fulfillmentType)}</dd>
              </div>
              <div>
                <dt>決済</dt>
                <dd>{labelOf(PAYMENT_METHOD_LABEL, order.paymentMethod)}</dd>
              </div>
              <div className="sales-party-meta">
                <dt>人数</dt>
                <dd>
                  <strong>{order.partySize}名</strong>
                  <span className="sales-age-groups">
                    {AGE_GROUPS.filter(
                      (group) => (order.ageGroupCounts[group.key] ?? 0) > 0,
                    ).map((group) => (
                      <span key={group.key}>
                        {group.label} {order.ageGroupCounts[group.key]}
                      </span>
                    ))}
                  </span>
                </dd>
              </div>
              <div>
                <dt>担当</dt>
                <dd>{order.createdBy.label}</dd>
              </div>
            </dl>
            {!canEdit && order.specialNote && (
              <div className="sales-note">
                <StickyNote aria-hidden="true" />
                {order.specialNote}
              </div>
            )}
            {canEdit && <div className="grid gap-3 mt-3">
              <label className="grid gap-1 font-semibold">備考
                <textarea aria-label="備考" className="rounded-md border bg-background p-2 font-normal" maxLength={500} value={note} disabled={saving} onChange={event=>setNote(event.target.value)} />
              </label>
              <label className="sales-setting-toggle"><input type="checkbox" checked={excluded} disabled={saving} onChange={event=>setExcluded(event.target.checked)} />待ち時間統計から除外する</label>
              <p className="muted text-xs">売上集計には含まれます。</p>
              {dirty && <p className="text-sm" role="status">未保存の変更があります。</p>}
              <button type="button" className="order-call-btn" disabled={!dirty || saving} onClick={()=>void save()}>{saving?"保存中…":"すべて保存"}</button>
            </div>}
          </div>

          <section>
            <h3 className="sales-drawer-section-title">
              <ChefHat aria-hidden="true" />
              商品
            </h3>
            <div className="sales-drawer-items">
              {order.items.map((item) => (
                <div key={item.id} className="sales-drawer-item">
                  <div className="row between">
                    <strong>{item.itemNameSnapshot}</strong>
                    <span className="badge">
                      {labelOf(ORDER_ITEM_STATUS_LABEL, item.status)}
                    </span>
                  </div>
                  <div className="sales-item-times">
                    <span>配属 {formatTime(item.kitchenAssignedAt)}</span>
                    <span>調理完了 {formatTime(item.readyAt)}</span>
                    <span>提供 {formatTime(item.servedAt)}</span>
                  </div>
                  <div className="muted">
                    {item.kitchenActor?.label ?? "担当未記録"} →{" "}
                    {item.servedBy?.label ?? "提供担当未記録"}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="sales-drawer-section-title">
              <FileText aria-hidden="true" />
              タイムライン
            </h3>
            <ol className="sales-timeline">
              {timeline.map((row) => (
                <li
                  key={row.id}
                  className={`sales-timeline-row ${row.tone ? `is-${row.tone}` : ""}`}
                >
                  <div className="sales-timeline-icon">
                    <TimelineIcon type={row.type} />
                  </div>
                  <time>{formatTime(row.at)}</time>
                  <div>
                    <strong>{row.title}</strong>
                    {row.detail && <p>{row.detail}</p>}
                    {row.actor && <span>{row.actor}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  );
});

function SalesPageContent() {
  const { loading: sessionLoading, session } = useSession([
    "POS",
    "KITCHEN",
    "WAITER",
    "ADMIN",
  ]);
  const { notify } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date");
  const selectedOrderId = searchParams.get("order");
  const [selectedDate, setSelectedDate] = useState(() =>
    isDateKey(urlDate) ? urlDate : tokyoDateKey(),
  );
  const [data, setData] = useState<SalesData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [salesMode, setSalesMode] = useState("orders");
  const [waitKey, setWaitKey] = useState("order:complete");
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [businessHoursOnly, setBusinessHoursOnly] = useState(true);
  const [detailDirty, setDetailDirty] = useState(false);
  const sessionActorId = session?.actor.actorId ?? null;

  useEffect(() => {
    if (isDateKey(urlDate) && urlDate !== selectedDate)
      setSelectedDate(urlDate);
  }, [urlDate, selectedDate]);

  const reload = useCallback(async () => {
    if (!sessionActorId) return;
    setDataLoading(true);
    try {
      const next = await apiFetch<SalesData>(
        `/api/sales?date=${encodeURIComponent(selectedDate)}&businessHoursOnly=${businessHoursOnly}`,
      );
      setData(next);
    } catch (error) {
      notify({
        level: "error",
        message:
          error instanceof Error
            ? error.message
            : "売上データの取得に失敗しました",
      });
    } finally {
      setDataLoading(false);
    }
  }, [notify, selectedDate, sessionActorId, businessHoursOnly]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!data) return;
    if (!data.wait.summaries.some((row) => row.key === waitKey)) {
      setWaitKey("order:complete");
    }
    if (
      salesMode !== "orders" &&
      !data.menus.some((menu) => `menu:${menu.menuId}` === salesMode)
    ) {
      setSalesMode("orders");
    }
  }, [data, salesMode, waitKey]);

  useEffect(() => {
    if (!selectedOrderId || !sessionActorId) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    let active = true;
    setDetail((current) => {
      const keepCurrent = current?.id === selectedOrderId;
      setDetailLoading(!keepCurrent);
      return keepCurrent ? current : null;
    });
    void apiFetch<{ order: OrderDetail }>(
      `/api/sales/orders/${encodeURIComponent(selectedOrderId)}`,
    )
      .then((result) => {
        if (active) setDetail(result.order);
      })
      .catch((error) => {
        if (!active) return;
        setDetail(null);
        notify({
          level: "error",
          message:
            error instanceof Error
              ? error.message
              : "注文詳細の取得に失敗しました",
        });
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify, selectedOrderId, sessionActorId]);

  const updateDate = (nextDate: string) => {
    if (detailDirty && !window.confirm("未保存の変更を破棄しますか？")) return;
    setSelectedDate(nextDate);
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", nextDate);
    params.delete("order");
    router.replace(`/sales?${params.toString()}` as Route, { scroll: false });
  };

  const openOrder = (orderId: string) => {
    if (orderId!==selectedOrderId && detailDirty && !window.confirm("未保存の変更を破棄しますか？")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", selectedDate);
    params.set("order", orderId);
    router.push(`/sales?${params.toString()}` as Route, { scroll: false });
  };

  const closeOrder = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("order");
    params.set("date", selectedDate);
    router.replace(`/sales?${params.toString()}` as Route, { scroll: false });
  }, [router, searchParams, selectedDate]);

  const selectedSalesEvents = useMemo(() => {
    if (!data) return [];
    if (salesMode === "orders") {
      return data.salesEvents.filter((event) => event.menuId == null);
    }
    const menuId = salesMode.replace(/^menu:/, "");
    return data.salesEvents.filter((event) => event.menuId === menuId);
  }, [data, salesMode]);

  const selectedWaitPoints = useMemo(
    () => data?.wait.points.filter((point) => point.key === waitKey) ?? [],
    [data, waitKey],
  );

  if (sessionLoading || !session) return <LoadingScreen />;

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        title="売上・待ち時間"
        subtitle="売上や待ち時間の統計を確認"
        className="sales-shell"
        actions={
          <div className="row wrap">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => void reload()}
              disabled={dataLoading}
            >
              <RefreshCw aria-hidden="true" />
              更新
            </button>
          </div>
        }
      >
        <div
          className={`sales-workspace ${selectedOrderId ? "has-drawer" : ""}`}
        >
          <div className="sales-dashboard">
            <section className="card sales-day-bar">
              <div>
                <strong>{formatDay(selectedDate)}</strong>
                <small>
                  {/* JST 00:00–24:00 集計 / グラフ{" "} */}
                  {data && data.date === selectedDate
                    ? `${formatTime(data.chartRange.chartStart).slice(0, 5)}–${(new Date(data.chartRange.chartEnd).getTime() === new Date(data.range.end).getTime() ? "24:00" : formatTime(data.chartRange.chartEnd).slice(0, 5))}`
                    : "09:00–18:00"}
                </small>
              </div>
              <div className="sales-day-controls">
                <label className="sales-setting-toggle font-semibold"><input type="checkbox" checked={businessHoursOnly} onChange={event=>setBusinessHoursOnly(event.target.checked)} />営業時間のみ表示</label>
                <button
                  type="button"
                  className="ghost-btn sales-icon-btn"
                  aria-label="前日"
                  onClick={() => updateDate(addDateDays(selectedDate, -1))}
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <label className="sales-date-input">
                  <CalendarDays aria-hidden="true" />
                  <Input
                    type="date"
                    value={selectedDate}
                    onClick={(event) => event.currentTarget.showPicker?.()}
                    onChange={(event) =>
                      event.target.value && updateDate(event.target.value)
                    }
                    aria-label="営業日"
                  />
                </label>
                <button
                  type="button"
                  className="ghost-btn sales-icon-btn"
                  aria-label="翌日"
                  onClick={() => updateDate(addDateDays(selectedDate, 1))}
                >
                  <ChevronRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => updateDate(tokyoDateKey())}
                >
                  今日
                </button>
              </div>
            </section>

            {!data || data.date !== selectedDate ? (
              <div className="card sales-inline-loading">集計中…</div>
            ) : data ? (
              <>
                <section className="card sales-panel">
                  <div className="sales-panel-head">
                    <div>
                      <h2>売上</h2>
                    </div>
                  </div>
                  <div className="sales-metric-strip">
                    <div className="sales-primary-metric">
                      <span>総売上</span>
                      <strong>{fmtJpy(data.totals.salesJpy)}</strong>
                    </div>
                    <div>
                      <span>注文</span>
                      <strong>
                        {data.totals.orderCount}
                        <small>件</small>
                      </strong>
                    </div>
                    <div>
                      <span>商品</span>
                      <strong>
                        {data.totals.itemCount}
                        <small>点</small>
                      </strong>
                    </div>
                  </div>
                  <div className="sales-panel-grid">
                    <div className="sales-menu-table-wrap">
                      <table className="sales-compact-table">
                        <thead>
                          <tr>
                            <th>メニュー</th>
                            <th>点数</th>
                            <th>売上</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.menus.map((menu) => (
                            <tr
                              key={menu.menuId}
                              className={
                                salesMode === `menu:${menu.menuId}`
                                  ? "is-selected"
                                  : ""
                              }
                              onClick={() =>
                                setSalesMode(`menu:${menu.menuId}`)
                              }
                            >
                              <td>{menu.name}</td>
                              <td>{menu.count}</td>
                              <td>{fmtJpy(menu.salesJpy)}</td>
                            </tr>
                          ))}
                          {data.menus.length === 0 && (
                            <tr>
                              <td colSpan={3} className="muted">
                                対象データなし
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {data.menus.length > 0 && (
                          <tfoot>
                            <tr
                              className={
                                salesMode === "orders" ? "is-selected" : ""
                              }
                              onClick={() => setSalesMode("orders")}
                            >
                              <th>注文数</th>
                              <th>{data.totals.orderCount}件</th>
                              <th>{fmtJpy(data.totals.salesJpy)}</th>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    <div className="sales-chart-column">
                      <div className="sales-chart-caption sales-sales-chart-caption">
                        <strong>累計販売</strong>
                        <div className="sales-chart-select">
                          <Select
                            value={salesMode}
                            onValueChange={setSalesMode}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="orders">注文数</SelectItem>
                              {data.menus.map((menu) => (
                                <SelectItem
                                  key={menu.menuId}
                                  value={`menu:${menu.menuId}`}
                                >
                                  {menu.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <CumulativeChart
                        events={selectedSalesEvents}
                        start={data.chartRange.chartStart}
                        end={data.chartRange.chartEnd}
                        label={
                          salesMode === "orders"
                            ? "注文数"
                            : (data.menus.find(
                                (menu) => `menu:${menu.menuId}` === salesMode,
                              )?.name ?? "メニュー")
                        }
                        onOpenOrder={openOrder}
                      />
                    </div>
                  </div>
                </section>

                <section className="card sales-panel">
                  <div className="sales-panel-head">
                    <div>
                      <h2>実待ち時間</h2>
                    </div>
                    <div className="sales-wait-controls">
                      <Select value={waitKey} onValueChange={setWaitKey}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {data.wait.summaries.map((summary) => (
                            <SelectItem key={summary.key} value={summary.key}>
                              {summary.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="sales-wait-layout">
                    <div className="sales-wait-table-wrap">
                      <table className="sales-compact-table sales-wait-table">
                        <thead>
                          <tr>
                            <th>基準</th>
                            <th>n</th>
                            <th>中央値</th>
                            <th>最大</th>
                            <th>&gt;25分</th>
                            <th>&gt;40分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.wait.summaries.map((summary) => (
                            <tr
                              key={summary.key}
                              className={
                                summary.key === waitKey ? "is-selected" : ""
                              }
                              onClick={() => setWaitKey(summary.key)}
                            >
                              <td>{summary.label}</td>
                              <td>{summary.sampleSize}</td>
                              <td
                                className={metricTone(
                                  summary.p50Seconds,
                                  25 * 60,
                                  40 * 60,
                                )}
                              >
                                {formatDuration(summary.p50Seconds)}
                              </td>
                              <td
                                className={metricTone(
                                  summary.maxSeconds,
                                  25 * 60,
                                  40 * 60,
                                )}
                              >
                                {formatDuration(summary.maxSeconds)}
                              </td>
                              <td
                                className={metricTone(
                                  summary.lateRatio,
                                  0.1,
                                  0.25,
                                )}
                              >
                                {formatRatio(summary.lateRatio)}
                              </td>
                              <td
                                className={metricTone(
                                  summary.severeLateRatio,
                                  0.05,
                                  0.15,
                                )}
                              >
                                {formatRatio(summary.severeLateRatio)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="sales-chart-caption">
                        <strong>
                          {
                            data.wait.summaries.find(
                              (row) => row.key === waitKey,
                            )?.label
                          }
                        </strong>
                        <span>点＝注文確定時刻 / 線＝完了まで</span>
                      </div>
                      <WaitChart
                        points={selectedWaitPoints}
                        start={data.chartRange.chartStart}
                        end={data.chartRange.chartEnd}
                        yMax={data.wait.yMaxMinutes}
                        onOpenOrder={openOrder}
                      />
                    </div>
                  </div>
                </section>

                <section className="card sales-panel sales-experience-panel">
                  <div className="sales-panel-head">
                    <div>
                      <h2>異常</h2>
                    </div>
                    <div className="sales-exclusion-note">
                      <span>
                        失敗・取消 {data.totals.failedOrCanceledCount}
                      </span>
                      <span>未確定 {data.totals.unconfirmedCount}</span>
                    </div>
                  </div>
                  {/* <p className="sales-policy-note">
                    売上・待ち時間は「決済済み／スキップ済みかつ注文確定済み」を対象とし、失敗・取消・未確定は除外します。決済スキップは売上に含み、下記で明示します。
                  </p> */}
                  {data.incidents.length > 0 ? (
                    <div className="sales-incident-list">
                      {data.incidents.map((incident) => (
                        <button
                          type="button"
                          key={incident.id}
                          className={`sales-incident is-${incident.severity}`}
                          onClick={() => openOrder(incident.orderId)}
                        >
                          <AlertTriangle aria-hidden="true" />
                          <span>
                            <strong>注文 #{incident.orderNo}</strong>
                            <small>{incident.message}</small>
                          </span>
                          <time>{formatTime(incident.at)}</time>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="sales-all-clear">
                      <CheckCircle2 aria-hidden="true" />
                      異常はありません
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </div>
          {selectedOrderId && (
            <OrderDrawer
              key={`${detail?.id}:${detail?.lastMutationVersion}`}
              order={detail}
              loading={detailLoading}
              onClose={closeOrder}
              canEdit={["POS","ADMIN"].includes(session.actor.actorType)}
              onDirtyChange={setDetailDirty}
              onSaved={async()=>{
                const result=await apiFetch<{order:OrderDetail}>(`/api/sales/orders/${selectedOrderId}`);
                setDetail(result.order);
                await reload();
              }}
            />
          )}
        </div>
      </DashboardShell>
    </>
  );
}

export default function SalesPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <SalesPageContent />
    </Suspense>
  );
}
