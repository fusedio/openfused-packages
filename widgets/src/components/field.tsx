// field.tsx — shared input shell: a card with an optional label, wrapping one
// control. Used by select / slider / text-input.

import React from "react";
import { Card } from "./card";

export function Field({
  label,
  htmlFor,
  style,
  children,
}: {
  label?: string;
  htmlFor?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <Card className="ofw-card--input" style={style}>
      <div className="ofw-field">
        {label ? (
          <label className="ofw-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : null}
        {children}
      </div>
    </Card>
  );
}
