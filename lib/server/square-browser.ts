import { NextResponse } from "next/server";
export function squareBrowserFailure() {
  return new NextResponse(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Square決済の確認</title></head>
<body><main><h1>決済結果を確認してください</h1><p>Squareとの連携を完了できませんでした。注文や決済をやり直さず、元のSquareアプリとKISSaの状態を確認してください。</p>
<p>この画面が表示されても、決済が取り消されたことにはなりません。</p><p><a href="/pos">KISSaのPOSへ戻る</a></p><p>状態が不明な場合は管理者がSquareの取引履歴と照合してください。</p></main></body></html>`, {
    status: 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'" },
  });
}
