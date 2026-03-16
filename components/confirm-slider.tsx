"use client";

import { ArrowRightFilled } from "@fluentui/react-icons";
import { useCallback, useEffect, useRef, useState } from "react";

type ConfirmSliderProps = {
  disabled?: boolean;
  text: string;
  processingText: string;
  tone?: "green" | "red";
  onConfirm: () => Promise<void> | void;
};

export function ConfirmSlider(props: ConfirmSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const positionRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [position, setPosition] = useState(0);
  const [processing, setProcessing] = useState(false);

  const maxPosition = useCallback(() => {
    const width = trackRef.current?.clientWidth ?? 0;
    return Math.max(0, width - 52);
  }, []);

  const updatePosition = useCallback((next: number) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  const pointerMove = useCallback((clientX: number) => {
    if (!draggingRef.current || !trackRef.current) {
      return;
    }

    const rect = trackRef.current.getBoundingClientRect();
    const next = Math.min(Math.max(0, clientX - rect.left - 26), maxPosition());
    updatePosition(next);
  }, [maxPosition, updatePosition]);

  const finishDrag = useCallback(async () => {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    pointerIdRef.current = null;
    setDragging(false);

    const threshold = maxPosition() * 0.88;
    if (positionRef.current >= threshold && !props.disabled && !processing) {
      try {
        setProcessing(true);
        await props.onConfirm();
      } finally {
        setProcessing(false);
      }
    }

    updatePosition(0);
  }, [maxPosition, processing, props, updatePosition]);

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      pointerMove(event.clientX);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      void finishDrag();
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (pointerIdRef.current !== event.pointerId) {
        return;
      }
      void finishDrag();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [dragging, finishDrag, pointerMove]);

  return (
    <div
      ref={trackRef}
      className={`confirm-slider tone-${props.tone ?? "green"} ${props.disabled || processing ? "disabled" : ""}`}
      style={{ touchAction: "none" }}
    >
      <div className="confirm-slider-text">
        {processing ? props.processingText : props.text}
      </div>
      <button
        type="button"
        className="confirm-slider-thumb"
        style={{ transform: `translateX(${position}px)` }}
        disabled={props.disabled || processing}
        onPointerDown={(event) => {
          if (props.disabled || processing) {
            return;
          }
          pointerIdRef.current = event.pointerId;
          draggingRef.current = true;
          setDragging(true);
          updatePosition(0);
          pointerMove(event.clientX);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      >
        <ArrowRightFilled />
      </button>
    </div>
  );
}
