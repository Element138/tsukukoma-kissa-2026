"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCcw,
  X,
} from "lucide-react";
import { apiFetch, fmtJpy } from "@/lib/client";
import { useSession } from "@/components/use-session";
import { TerminalBanner } from "@/components/terminal-banner";
import { DashboardShell } from "@/components/dashboard-shell";
import { LoadingScreen } from "@/components/loading-screen";
import { Input } from "@/components/ui/input";
import { AGE_GROUPS, type AgeGroupCounts } from "@/lib/age-groups";
import {
  FULFILLMENT_LABEL,
  ORDER_ITEM_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  labelOf,
} from "@/lib/labels";
import { addDaysToTokyoDateKey, tokyoDateKey } from "@/lib/time";

type Grain = "order" | "menu";

type WaitSummary = {
  count: number;
  averageSeconds: number | null;
  p50Seconds: number | null;
  p90Seconds: number | null;
  maxSeconds: number | null;
  lateWarnCount: number;
  lateDangerCount: number;
  lateWarnRatio: number;
  lateDangerRatio: number;
};

type WaitRow = {
  id: string;
  orderId: string;
  orderNo: number;
  label: string;
  menuId?: string;
  menuName?: string;
  seconds: number;
  hour: number;
  salesJpy: number;
};

type SalesDayPayload = {
  dateKey: string;
  generatedAt: string;
  thresholds: {
    lateWarnSeconds: number;
    lateDangerSeconds: number;
  };
  totals: {
    salesJpy: number;
    orderCount: number;
    itemCount: number;
    averageTicketJpy: number;
    failedCount: number;
    canceledCount: number;
    activeOrderCount: number;
    incidentCount: number;
  };
  mixes: {
    payment: Array<{ key: string; count: number; salesJpy: number }>;
    fulfillment: Array<{ key: string; count: number; salesJpy: number }>;
  };
  hourly: Array<{
    hour: number;
    salesJpy: number;
    orderCount: number;
    itemCount: number;
    orderAverageWaitSeconds: number | null;
    itemAverageWaitSeconds: number | null;
  }>;
  orderGrain: {
    summary: WaitSummary;
    distribution: Array<{ key: string; label: string; count: number }>;
    trend: Array<{ hour: number; count: number; averageSeconds: number | null; p90Seconds: number | null }>;
    lateRows: WaitRow[];
    activeRows: WaitRow[];
  };
  menuGrain: {
    summary: WaitSummary;
    distribution: Array<{ key: string; label: string; count: number }>;
    trend: Array<{ hour: number; count: number; averageSeconds: number | null; p90Seconds: number | null }>;
    menuRows: Array<{
      menuId: string;
      name: string;
      units: number;
      salesJpy: number;
      completedItemCount: number;
      activeItemCount: number;
      averageWaitSeconds: number | null;
      p90WaitSeconds: number | null;
      maxWaitSeconds: number | null;
      averageProductionSeconds: number | null;
      averageHandoffSeconds: number | null;
      lateWarnCount: number;
      lateDangerCount: number;
      lateWarnRatio: number;
      lateDangerRatio: number;
    }>;
    lateRows: WaitRow[];
    activeRows: WaitRow[];
  };
  incidents: Array<{
    id: string;
    orderId: string;
    orderNo: number;
    messageJa: string;
    dismissedAt: string | null;
    createdAt: string;
  }>;
  orders: Array<{
    id: string;
    orderNo: number;
    createdAt: string;
    confirmedAt: string | null;
    completedAt: string | null;
    fulfillmentType: string;
    paymentMethod: string;
    paymentStatus: string;
    orderStatus: string;
    totalPriceJpy: number;
    itemCount: number;
    waitSeconds: number | null;
    isActive: boolean;
  }>;
};

type OrderDetail = {
  id: string;
  orderNo: number;
  createdAt: string;
  confirmedAt: string | null;
  completedAt: string | null;
  fulfillmentType: "DINE_IN" | "TAKEOUT";
  tableNo: number | null;
  partySize: number;
  ageGroupCounts: AgeGroupCounts;
  specialNote: string | null;
  paymentMethod: string;
  paymentStatus: string;
  orderStatus: string;
  totalPriceJpy: number;
  createdBy: {
    id: string;
    label: string;
    actorType: string;
  };
  durations: {
    createdToConfirmedSeconds: number | null;
    confirmedToReadySeconds: number | null;
    readyToServedSeconds: number | null;
    confirmedToServedSeconds: number | null;
  };
  items: Array<{
    id: string;
    menuId: string;
    name: string;
    unitPriceJpy: number;
    status: string;
    kitchenId: string | null;
    kitchenLabel: string | null;
    readyAt: string | null;
    servedAt: string | null;
    productionSeconds: number | null;
    handoffSeconds: number | null;
    customerWaitSeconds: number | null;
  }>;
  timeline: Array<{
    id: string;
    at: string;
    title: string;
    detail: string | null;
    actorLabel: string | null;
    tone: "info" | "success" | "warning" | "danger";
  }>;
};

function initialParam(name: string) {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get(name);
}

function formatDateLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function formatShortTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null) {
  if (seconds == null) {
    return "-";
  }
  const min = Math.floor(seconds / 60);
  const sec = Math.max(0, seconds % 60);
  if (min >= 60) {
    const hour = Math.floor(min / 60);
    const rest = min % 60;
    return `${hour}h ${rest}m`;
  }
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function safeMax(values: number[]) {
  return Math.max(1, ...values);
}

function MetricCard(props: { label: string; value: string; detail?: string; tone?: "plain" | "warn" | "danger" }) {
  return (
    <div className={`sales-metric-card ${props.tone ?? "plain"}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail ? <small>{props.detail}</small> : null}
    </div>
  );
}

function ChartFrame(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="sales-chart-frame">
      <header>
        <div>
          <strong>{props.title}</strong>
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
      </header>
      {props.children}
    </section>
  );
}

function BarChart(props: {
  rows: Array<{ label: string; value: number; secondary?: number }>;
  formatValue?: (value: number) => string;
}) {
  const max = safeMax(props.rows.flatMap((row) => [row.value, row.secondary ?? 0]));
  return (
    <div className="sales-bar-chart">
      {props.rows.map((row) => (
        <div key={row.label} className="sales-bar-column">
          <div className="sales-bar-stack">
            {row.secondary != null ? (
              <div
                className="sales-bar-secondary"
                style={{ height: `${Math.max(3, (row.secondary / max) * 100)}%` }}
                title={`${row.label}: ${props.formatValue?.(row.secondary) ?? row.secondary}`}
              />
            ) : null}
            <div
              className="sales-bar-primary"
              style={{ height: `${Math.max(row.value > 0 ? 3 : 0, (row.value / max) * 100)}%` }}
              title={`${row.label}: ${props.formatValue?.(row.value) ?? row.value}`}
            />
          </div>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}

function LineChart(props: { rows: Array<{ label: string; value: number | null; p90?: number | null }> }) {
  const width = 640;
  const height = 170;
  const pad = 18;
  const values = props.rows.flatMap((row) => [row.value ?? 0, row.p90 ?? 0]);
  const max = safeMax(values);
  const pointFor = (value: number | null, index: number) => {
    const x = pad + (index / Math.max(1, props.rows.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value ?? 0) / max) * (height - pad * 2);
    return `${x},${y}`;
  };
  const avgPoints = props.rows.map((row, index) => pointFor(row.value, index)).join(" ");
  const p90Points = props.rows.map((row, index) => pointFor(row.p90 ?? null, index)).join(" ");

  return (
    <div className="sales-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="待ち時間推移">
        <polyline className="sales-line sales-line-muted" points={p90Points} />
        <polyline className="sales-line" points={avgPoints} />
        {props.rows.map((row, index) => {
          const [x, y] = pointFor(row.value, index).split(",").map(Number);
          return <circle key={row.label} cx={x} cy={y} r="3" />;
        })}
      </svg>
      <div className="sales-chart-legend">
        <span>平均</span>
        <span>P90</span>
      </div>
    </div>
  );
}

function HorizontalBars(props: {
  rows: Array<{ key: string; label: string; value: number; detail?: string }>;
  formatValue?: (value: number) => string;
}) {
  const max = safeMax(props.rows.map((row) => row.value));
  return (
    <div className="sales-horizontal-bars">
      {props.rows.map((row) => (
        <div key={row.key} className="sales-horizontal-row">
          <span>{row.label}</span>
          <div>
            <i style={{ width: `${Math.max(row.value > 0 ? 3 : 0, (row.value / max) * 100)}%` }} />
          </div>
          <strong>{props.formatValue?.(row.value) ?? row.value}</strong>
          {row.detail ? <small>{row.detail}</small> : null}
        </div>
      ))}
    </div>
  );
}

function WaitRows(props: { rows: WaitRow[]; empty: string; onOpen: (orderId: string) => void }) {
  if (props.rows.length === 0) {
    return <div className="muted">{props.empty}</div>;
  }
  return (
    <div className="sales-risk-list">
      {props.rows.map((row) => (
        <button key={row.id} type="button" onClick={() => props.onOpen(row.orderId)}>
          <span>{row.label}</span>
          <strong>{formatDuration(row.seconds)}</strong>
        </button>
      ))}
    </div>
  );
}

export default function SalesPage() {
  const { loading, session } = useSession(["POS", "KITCHEN", "WAITER", "ADMIN"]);
  const [dateKey, setDateKey] = useState(() => initialParam("date") ?? tokyoDateKey());
  const [grain, setGrain] = useState<Grain>(() => (initialParam("grain") === "menu" ? "menu" : "order"));
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(() => initialParam("order"));
  const [data, setData] = useState<SalesDayPayload | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const firstUrlSyncRef = useRef(true);

  const syncUrl = (nextDate: string, nextGrain: Grain, nextOrderId: string | null) => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams();
    params.set("date", nextDate);
    if (nextGrain === "menu") {
      params.set("grain", nextGrain);
    }
    if (nextOrderId) {
      params.set("order", nextOrderId);
    }
    const next = `/sales?${params.toString()}`;
    if (window.location.pathname + window.location.search !== next) {
      window.history.pushState(null, "", next);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      const payload = await apiFetch<SalesDayPayload>(`/api/sales/day?date=${encodeURIComponent(dateKey)}`);
      setData(payload);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    void reload();
  }, [session, dateKey]);

  useEffect(() => {
    if (firstUrlSyncRef.current) {
      firstUrlSyncRef.current = false;
      return;
    }
    syncUrl(dateKey, grain, selectedOrderId);
  }, [dateKey, grain, selectedOrderId]);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setDateKey(params.get("date") ?? tokyoDateKey());
      setGrain(params.get("grain") === "menu" ? "menu" : "order");
      setSelectedOrderId(params.get("order"));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!selectedOrderId) {
      setOrderDetail(null);
      return;
    }
    setDetailBusy(true);
    apiFetch<{ order: OrderDetail | null }>(`/api/sales/orders/${selectedOrderId}`)
      .then((payload) => setOrderDetail(payload.order))
      .finally(() => setDetailBusy(false));
  }, [selectedOrderId]);

  const selectedSummary = grain === "order" ? data?.orderGrain.summary : data?.menuGrain.summary;
  const selectedDistribution =
    grain === "order" ? data?.orderGrain.distribution : data?.menuGrain.distribution;
  const selectedTrend = grain === "order" ? data?.orderGrain.trend : data?.menuGrain.trend;
  const selectedLateRows = grain === "order" ? data?.orderGrain.lateRows : data?.menuGrain.lateRows;
  const selectedActiveRows = grain === "order" ? data?.orderGrain.activeRows : data?.menuGrain.activeRows;

  const menuContribution = useMemo(
    () =>
      (data?.menuGrain.menuRows ?? []).slice(0, 10).map((row) => ({
        key: row.menuId,
        label: row.name,
        value: row.salesJpy,
        detail: `${row.units}品`,
      })),
    [data],
  );

  if (loading || !session) {
    return <LoadingScreen />;
  }

  return (
    <>
      <TerminalBanner
        actorId={session.actor.actorId}
        actorType={session.actor.actorType}
        actorLabel={session.actor.label}
        offlineActors={session.offlineActors}
      />
      <DashboardShell
        eyebrow="SALES & EXPERIENCE"
        title="売上・体験ダッシュボード"
        subtitle="日別の売上、待ち時間、注文体験をまとめて確認"
        actions={
          <div className="row wrap">
            <Link href="/order-book" className="btn-link ghost-btn">
              オーダーブック
            </Link>
            <button type="button" className="ghost-btn" onClick={() => void reload()} disabled={busy}>
              <RefreshCcw aria-hidden="true" size={16} />
              更新
            </button>
          </div>
        }
      >
        <div className="sales-page">
          <section className="card sales-controls">
            <div>
              <strong>{formatDateLabel(dateKey)}</strong>
              <span className="muted">
                {data ? `生成 ${formatDateTime(data.generatedAt)}` : "読み込み中"}
              </span>
            </div>
            <div className="order-book-day-switcher">
              <button
                type="button"
                className="ghost-btn order-book-day-arrow"
                aria-label="前日"
                onClick={() => setDateKey((value) => addDaysToTokyoDateKey(value, -1))}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
              <Input
                aria-label="集計日"
                type="date"
                value={dateKey}
                onChange={(event) => event.target.value && setDateKey(event.target.value)}
                className="order-book-day-input"
              />
              <button
                type="button"
                className="ghost-btn order-book-day-arrow"
                aria-label="翌日"
                onClick={() => setDateKey((value) => addDaysToTokyoDateKey(value, 1))}
              >
                <ChevronRight aria-hidden="true" />
              </button>
              <button type="button" className="ghost-btn order-book-today-btn" onClick={() => setDateKey(tokyoDateKey())}>
                今日
              </button>
            </div>
            <div className="sales-grain-toggle" role="group" aria-label="集計単位">
              <button type="button" className={grain === "order" ? "active" : ""} onClick={() => setGrain("order")}>
                注文単位
              </button>
              <button type="button" className={grain === "menu" ? "active" : ""} onClick={() => setGrain("menu")}>
                メニュー単位
              </button>
            </div>
          </section>

          <section className="sales-metric-grid">
            <MetricCard label="売上" value={fmtJpy(data?.totals.salesJpy ?? 0)} detail={`${data?.totals.orderCount ?? 0} 件`} />
            <MetricCard label="商品数" value={`${data?.totals.itemCount ?? 0}`} detail={`平均 ${fmtJpy(data?.totals.averageTicketJpy ?? 0)}`} />
            <MetricCard label="平均待ち" value={formatDuration(selectedSummary?.averageSeconds ?? null)} detail={`P90 ${formatDuration(selectedSummary?.p90Seconds ?? null)}`} />
            <MetricCard
              label={`>${data ? Math.round(data.thresholds.lateWarnSeconds / 60) : 25}分`}
              value={formatPercent(selectedSummary?.lateWarnRatio ?? 0)}
              detail={`${selectedSummary?.lateWarnCount ?? 0} 件`}
              tone={(selectedSummary?.lateWarnCount ?? 0) > 0 ? "warn" : "plain"}
            />
            <MetricCard
              label={`>${data ? Math.round(data.thresholds.lateDangerSeconds / 60) : 40}分`}
              value={formatPercent(selectedSummary?.lateDangerRatio ?? 0)}
              detail={`${selectedSummary?.lateDangerCount ?? 0} 件`}
              tone={(selectedSummary?.lateDangerCount ?? 0) > 0 ? "danger" : "plain"}
            />
          </section>

          <section className="sales-chart-grid">
            <ChartFrame title="時間帯別売上" subtitle="JST">
              <BarChart
                rows={(data?.hourly ?? []).map((row) => ({
                  label: String(row.hour),
                  value: row.salesJpy,
                }))}
                formatValue={fmtJpy}
              />
            </ChartFrame>
            <ChartFrame title={grain === "order" ? "時間帯別 注文件数" : "時間帯別 商品数"}>
              <BarChart
                rows={(data?.hourly ?? []).map((row) => ({
                  label: String(row.hour),
                  value: grain === "order" ? row.orderCount : row.itemCount,
                }))}
              />
            </ChartFrame>
            <ChartFrame title="待ち時間推移" subtitle={grain === "order" ? "注文単位" : "メニュー単位"}>
              <LineChart
                rows={(selectedTrend ?? []).map((row) => ({
                  label: String(row.hour),
                  value: row.averageSeconds,
                  p90: row.p90Seconds,
                }))}
              />
            </ChartFrame>
            <ChartFrame title="待ち時間分布" subtitle="完了済みのみ">
              <BarChart
                rows={(selectedDistribution ?? []).map((row) => ({
                  label: row.label,
                  value: row.count,
                }))}
              />
            </ChartFrame>
          </section>

          <section className="sales-split-grid">
            <ChartFrame title="メニュー別売上" subtitle="上位10件">
              <HorizontalBars rows={menuContribution} formatValue={fmtJpy} />
            </ChartFrame>
            <ChartFrame title={grain === "menu" ? "メニュー別待ち時間" : "体験リスク"}>
              {grain === "menu" ? (
                <HorizontalBars
                  rows={(data?.menuGrain.menuRows ?? [])
                    .filter((row) => row.averageWaitSeconds != null)
                    .slice()
                    .sort((a, b) => (b.p90WaitSeconds ?? 0) - (a.p90WaitSeconds ?? 0))
                    .slice(0, 10)
                    .map((row) => ({
                      key: row.menuId,
                      label: row.name,
                      value: row.p90WaitSeconds ?? 0,
                      detail: `平均 ${formatDuration(row.averageWaitSeconds)}`,
                    }))}
                  formatValue={formatDuration}
                />
              ) : (
                <div className="sales-risk-columns">
                  <div>
                    <strong>遅延</strong>
                    <WaitRows rows={selectedLateRows ?? []} empty="遅延はありません" onOpen={setSelectedOrderId} />
                  </div>
                  <div>
                    <strong>進行中</strong>
                    <WaitRows rows={selectedActiveRows ?? []} empty="進行中リスクはありません" onOpen={setSelectedOrderId} />
                  </div>
                </div>
              )}
            </ChartFrame>
          </section>

          <section className="sales-split-grid">
            <div className="card sales-panel">
              <header>
                <BarChart3 aria-hidden="true" />
                <strong>メニュー管理</strong>
              </header>
              <div className="table-scroll">
                <table className="table sales-menu-table">
                  <thead>
                    <tr>
                      <th>メニュー</th>
                      <th>売上</th>
                      <th>品数</th>
                      <th>平均待ち</th>
                      <th>P90</th>
                      <th>調理</th>
                      <th>提供</th>
                      <th>&gt;25分</th>
                      <th>&gt;40分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.menuGrain.menuRows ?? []).map((row) => (
                      <tr key={row.menuId}>
                        <td>{row.name}</td>
                        <td>{fmtJpy(row.salesJpy)}</td>
                        <td>{row.units}</td>
                        <td>{formatDuration(row.averageWaitSeconds)}</td>
                        <td>{formatDuration(row.p90WaitSeconds)}</td>
                        <td>{formatDuration(row.averageProductionSeconds)}</td>
                        <td>{formatDuration(row.averageHandoffSeconds)}</td>
                        <td>{formatPercent(row.lateWarnRatio)}</td>
                        <td>{formatPercent(row.lateDangerRatio)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card sales-panel">
              <header>
                <Clock aria-hidden="true" />
                <strong>注文明細</strong>
              </header>
              <div className="sales-order-list">
                {(data?.orders ?? []).map((order) => (
                  <button key={order.id} type="button" onClick={() => setSelectedOrderId(order.id)}>
                    <span>
                      <strong>#{order.orderNo}</strong>
                      <small>{formatShortTime(order.createdAt)}</small>
                    </span>
                    <span>{fmtJpy(order.totalPriceJpy)}</span>
                    <span>{order.itemCount}品</span>
                    <span>{formatDuration(order.waitSeconds)}</span>
                    <i className={`order-status-badge ${order.orderStatus.toLowerCase()}`}>
                      {labelOf(ORDER_STATUS_LABEL, order.orderStatus)}
                    </i>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </DashboardShell>

      {selectedOrderId ? (
        <div className="sales-drawer-shell" role="dialog" aria-modal="true">
          <button type="button" className="sales-drawer-backdrop" aria-label="閉じる" onClick={() => setSelectedOrderId(null)} />
          <aside className="sales-drawer">
            <header>
              <div>
                <span>ORDER DETAIL</span>
                <strong>{orderDetail ? `注文 #${orderDetail.orderNo}` : "読み込み中"}</strong>
              </div>
              <button type="button" className="ghost-btn order-book-day-arrow" aria-label="閉じる" onClick={() => setSelectedOrderId(null)}>
                <X aria-hidden="true" />
              </button>
            </header>
            {detailBusy || !orderDetail ? (
              <div className="muted">注文を読み込んでいます</div>
            ) : (
              <div className="sales-drawer-body">
                <section className="sales-detail-summary">
                  <MetricCard label="合計" value={fmtJpy(orderDetail.totalPriceJpy)} detail={`${orderDetail.items.length}品`} />
                  <MetricCard label="待ち時間" value={formatDuration(orderDetail.durations.confirmedToServedSeconds)} detail="確定から提供" />
                  <MetricCard label="調理" value={formatDuration(orderDetail.durations.confirmedToReadySeconds)} detail="確定から全品調理済み" />
                  <MetricCard label="提供" value={formatDuration(orderDetail.durations.readyToServedSeconds)} detail="調理済みから提供" />
                </section>

                <section className="sales-detail-facts">
                  <span>{labelOf(ORDER_STATUS_LABEL, orderDetail.orderStatus)}</span>
                  <span>{labelOf(PAYMENT_STATUS_LABEL, orderDetail.paymentStatus)}</span>
                  <span>{labelOf(PAYMENT_METHOD_LABEL, orderDetail.paymentMethod)}</span>
                  <span>{labelOf(FULFILLMENT_LABEL, orderDetail.fulfillmentType)}</span>
                  {orderDetail.tableNo ? <span>テーブル {orderDetail.tableNo}</span> : null}
                  <span>担当 {orderDetail.createdBy.label}</span>
                </section>

                {orderDetail.specialNote ? <div className="notice">備考: {orderDetail.specialNote}</div> : null}

                <section>
                  <h3>年齢構成</h3>
                  <div className="sales-detail-facts">
                    {AGE_GROUPS.map((group) => (
                      <span key={group.key}>
                        {group.label} x {orderDetail.ageGroupCounts[group.key] ?? 0}
                      </span>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>商品</h3>
                  <div className="sales-detail-items">
                    {orderDetail.items.map((item) => (
                      <div key={item.id}>
                        <strong>{item.name}</strong>
                        <span>{fmtJpy(item.unitPriceJpy)}</span>
                        <span>{labelOf(ORDER_ITEM_STATUS_LABEL, item.status)}</span>
                        <small>
                          調理 {formatDuration(item.productionSeconds)} / 提供 {formatDuration(item.handoffSeconds)} / 合計{" "}
                          {formatDuration(item.customerWaitSeconds)}
                        </small>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>タイムライン</h3>
                  <div className="sales-timeline">
                    {orderDetail.timeline.map((event) => (
                      <div key={event.id} className={`sales-timeline-event ${event.tone}`}>
                        <time>{formatDateTime(event.at)}</time>
                        <strong>{event.title}</strong>
                        {event.detail ? <span>{event.detail}</span> : null}
                        {event.actorLabel ? <small>{event.actorLabel}</small> : null}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </>
  );
}
