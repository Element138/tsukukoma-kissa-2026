"use client";

import { useId, useState } from "react";
import { fmtJpy } from "@/lib/client";

export function CashChange({ totalJpy, disabled = false }: { totalJpy: number; disabled?: boolean }) {
  const inputId = useId();
  const [received, setReceived] = useState("0");
  const receivedJpy = Number(received);
  const changeJpy = received !== "" && receivedJpy >= totalJpy ? receivedJpy - totalJpy : null;

  return (
    <div className="pos-cash-breakdown">
      <label className="row between" htmlFor={inputId}>
        <span>お預り</span>
        <input
          id={inputId}
          className="pos-cash-received"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={received}
          disabled={disabled}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const value = event.target.value.normalize("NFKC").replace(/[\s,]/g, "");
            if (value === "" || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value)))) {
              setReceived(value);
            }
          }}
          onBlur={() => setReceived(String(receivedJpy))}
        />
      </label>
      <div className="row between">
        <span>お釣り</span>
        <output htmlFor={inputId} aria-label="お釣り" aria-live="polite">
          {changeJpy === null ? "—" : fmtJpy(changeJpy)}
        </output>
      </div>
    </div>
  );
}
