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
              Backend-first cafe operation platform
            </p>
          </div>
          <LogoPlaceholder />
        </div>

        <div style={{ marginTop: 18 }} className="row wrap">
          <Link href="/login">
            <button>Login</button>
          </Link>
          <Link href="/pos">
            <button className="ghost-btn">POS</button>
          </Link>
          <Link href="/kitchen">
            <button className="ghost-btn">Kitchen</button>
          </Link>
          <Link href="/waiter">
            <button className="ghost-btn">Waiter</button>
          </Link>
          <Link href="/menu-display">
            <button className="ghost-btn">Menu Display</button>
          </Link>
          <Link href="/admin">
            <button className="ghost-btn">Admin</button>
          </Link>
        </div>
      </div>
    </main>
  );
}


