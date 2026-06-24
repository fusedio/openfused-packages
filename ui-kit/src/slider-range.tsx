// slider-range.tsx — a pure, dumb range-slider control (props in, JSX out).
//
// L1 ui-kit primitive: NO data/router/store/transport. It is a thin styled
// wrapper around the native `<input type="range">` with a controlled
// `value`/`onValueChange` pair (no param store — the binding lives in the
// consuming widget). A `--slider-pct` CSS variable drives the filled portion of
// the track (left of the thumb), mirroring the prior `--ofw-pct` track fill, and
// the thumb/track are styled with Tailwind tokens + the WebKit/Moz pseudo
// elements (no external CSS sheet required).
//
// Named `SliderRange` to keep the export unambiguous in the kit barrel.

import * as React from "react";
import { cn } from "./cn";

export interface SliderRangeProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onValueChange: (value: number) => void;
}

export const SliderRange = React.forwardRef<HTMLInputElement, SliderRangeProps>(
  ({ value, onValueChange, min = 0, max = 100, step = 1, className, style, ...props }, ref) => {
    const lo = typeof min === "number" ? min : Number(min);
    const hi = typeof max === "number" ? max : Number(max);
    const pct = hi > lo ? ((value - lo) / (hi - lo)) * 100 : 0;

    return (
      <input
        ref={ref}
        type="range"
        data-slot="slider-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        style={{ ["--slider-pct" as string]: `${pct}%`, ...style }}
        className={cn(
          // Track: full-width, thin, rounded; filled to --slider-pct with the
          // primary token, remainder muted. appearance-none lets us style it.
          "my-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none",
          "bg-[linear-gradient(90deg,var(--color-primary)_0_var(--slider-pct,0%),var(--color-muted)_var(--slider-pct,0%)_100%)]",
          // WebKit thumb
          "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-110",
          // Moz thumb
          "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:shadow-sm",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);

SliderRange.displayName = "SliderRange";
