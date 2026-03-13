"use client";

export function LogoPlaceholder() {
  return (
    <div className="logo-placeholder rounded-lg border border-dashed border-border bg-card" aria-label="KISSa ロゴ">
      <img src="/logo-placeholder.svg" alt="KISSa ロゴ" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    </div>
  );
}
