import Link from "next/link";
import { LogoPlaceholder } from "@/components/ui";

export default function HomePage() {
  return (
    <main>
      <div className="card">
        <div className="row between wrap">
          <div>
            <h1 style={{ margin: "0 0 8px" }}>KISSa</h1>
            <p className="muted" style={{ margin: 0 }}>
              {"スマートオペレーション管理"}
            </p>
          </div>
          <LogoPlaceholder />
        </div>

        <div style={{ marginTop: 18 }} className="row wrap">
          <Link href="/login">
            <button>{"ログイン"}</button>
          </Link>
          <Link href="/pos">
            <button className="ghost-btn">POS</button>
          </Link>
          <Link href="/kitchen">
            <button className="ghost-btn">{"キッチン"}</button>
          </Link>
          <Link href="/waiter">
            <button className="ghost-btn">{"配膳"}</button>
          </Link>
          <Link href="/menu-display">
            <button className="ghost-btn">{"メニュー表示"}</button>
          </Link>
          <Link href="/admin">
            <button className="ghost-btn">{"管理"}</button>
          </Link>
        </div>
      </div>
    </main>
  );
}
