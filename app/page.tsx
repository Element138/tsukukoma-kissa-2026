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
              {"\u30b9\u30de\u30fc\u30c8\u30aa\u30da\u30ec\u30fc\u30b7\u30e7\u30f3\u7ba1\u7406"}
            </p>
          </div>
          <LogoPlaceholder />
        </div>

        <div style={{ marginTop: 18 }} className="row wrap">
          <Link href="/login">
            <button>{"\u30ed\u30b0\u30a4\u30f3"}</button>
          </Link>
          <Link href="/pos">
            <button className="ghost-btn">POS</button>
          </Link>
          <Link href="/kitchen">
            <button className="ghost-btn">{"\u30ad\u30c3\u30c1\u30f3"}</button>
          </Link>
          <Link href="/waiter">
            <button className="ghost-btn">{"\u914d\u81a3"}</button>
          </Link>
          <Link href="/menu-display">
            <button className="ghost-btn">{"\u30e1\u30cb\u30e5\u30fc\u8868\u793a"}</button>
          </Link>
          <Link href="/admin">
            <button className="ghost-btn">{"\u7ba1\u7406"}</button>
          </Link>
        </div>
      </div>
    </main>
  );
}
