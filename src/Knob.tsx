import { useRef } from "react";
import type { CSSProperties } from "react";
import { clamp } from "./model.ts";

export function Knob({
  label,
  value,
  min = 0,
  max = 1,
  reset = 0,
  onChange,
  onGrab,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  reset?: number;
  onChange: (value: number) => void;
  onGrab: () => void;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  return (
    <label
      className="rotary-control"
      title={`${label}: ${value.toFixed(2)} · Doble clic para restablecer`}
      style={
        {
          "--knob-angle": `${((value - min) / (max - min)) * 270 - 135}deg`,
        } as CSSProperties
      }
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onGrab();
        drag.current = { y: event.clientY, value };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(
          Math.round(
            clamp(
              drag.current.value +
                ((drag.current.y - event.clientY) / 110) * (max - min),
              min,
              max,
            ) * 100,
          ) / 100,
        );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => {
        onGrab();
        onChange(reset);
      }}
    >
      <span className="knob-face">
        <i />
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        step="0.01"
        onChange={(event) => {
          onGrab();
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}
