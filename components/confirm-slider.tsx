"use client";

import { useRef, useState } from "react";

type ConfirmSliderProps = {
  disabled?: boolean;
  text: string;
  processingText: string;
  onConfirm: () => Promise<void> | void;
};

export function ConfirmSlider(props: ConfirmSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState(0);
  const [processing, setProcessing] = useState(false);

  const maxPosition = () => {
    const width = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, width - 52);
  };

  const pointerMove = (clientX: number) => {
    if (!dragging || !trackRef.current) {
      return;
    }

    const rect = trackRef.current.getBoundingClientRect();
    const next = Math.min(Math.max(0, clientX - rect.left - 26), maxPosition());
    setPosition(next);
  };

  const finishDrag = async () => {
    if (!dragging) {
      return;
    }

    setDragging(false);

    const threshold = maxPosition() * 0.88;
    if (position >= threshold && !props.disabled && !processing) {
      try {
        setProcessing(true);
        await props.onConfirm();
      } finally {
        setProcessing(false);
      }
    }

    setPosition(0);
  };

  return (
    <div
      ref={trackRef}
      className={`confirm-slider ${props.disabled || processing ? "disabled" : ""}`}
      onPointerMove={(e) => pointerMove(e.clientX)}
      onPointerUp={() => {
        void finishDrag();
      }}
      onPointerLeave={() => {
        void finishDrag();
      }}
    >
      <div className="confirm-slider-text">{processing ? props.processingText : props.text}</div>
      <button
        type="button"
        className="confirm-slider-thumb"
        style={{ transform: `translateX(${position}px)` }}
        disabled={props.disabled || processing}
        onPointerDown={() => setDragging(true)}
      >
        ?
      </button>
    </div>
  );
}