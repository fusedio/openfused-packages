// card.tsx — shared card chrome and in-card status states (loading / error /
// waiting). Data components render these so one failing query never blanks the
// whole dashboard (§6).

import React from "react";

export function Card({
  title,
  className,
  children,
  bodyClassName,
  style,
}: {
  title?: string;
  className?: string;
  bodyClassName?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div className={`ofw-card${className ? " " + className : ""}`} style={style}>
      {title ? <div className="ofw-card__title">{title}</div> : null}
      <div className={`ofw-card__body${bodyClassName ? " " + bodyClassName : ""}`}>
        {children}
      </div>
    </div>
  );
}

export function Spinner() {
  return <span className="ofw-spinner" aria-hidden="true" />;
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="ofw-state ofw-state--loading">
      <Spinner />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

/**
 * SkeletonState — the shared loading placeholder for data-bound DISPLAY widgets
 * (charts, table, metric, text, markdown). It fills the card body with shimmer
 * blocks shaped to hint at the eventual content, instead of a bare spinner, so a
 * loading dashboard reads as "content is on the way" rather than blank. Every
 * display widget uses this while its query is in flight (one common look across
 * the catalog). Input controls keep their inline "Loading…" label instead — a
 * skeleton would hide the control the user is about to interact with. See
 * packages/widgets/specs/rendering.md § Loading states.
 */
export function SkeletonState({
  variant = "block",
}: {
  variant?: "chart" | "table" | "text" | "metric" | "block";
}) {
  let inner: React.ReactNode;
  if (variant === "chart") {
    const heights = [42, 68, 54, 80, 60, 90, 48, 72];
    inner = (
      <div className="ofw-skeleton__chart">
        {heights.map((h, i) => (
          <span
            key={i}
            className="ofw-skeleton__bar ofw-skeleton__shimmer"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    );
  } else if (variant === "table") {
    inner = (
      <div className="ofw-skeleton__table">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="ofw-skeleton__row ofw-skeleton__shimmer" />
        ))}
      </div>
    );
  } else if (variant === "text") {
    const widths = ["92%", "78%", "85%", "60%"];
    inner = (
      <div className="ofw-skeleton__text">
        {widths.map((w, i) => (
          <span
            key={i}
            className="ofw-skeleton__line ofw-skeleton__shimmer"
            style={{ width: w }}
          />
        ))}
      </div>
    );
  } else if (variant === "metric") {
    inner = (
      <div className="ofw-skeleton__metric">
        <span className="ofw-skeleton__value ofw-skeleton__shimmer" />
        <span className="ofw-skeleton__label ofw-skeleton__shimmer" />
      </div>
    );
  } else {
    inner = <span className="ofw-skeleton__block ofw-skeleton__shimmer" />;
  }
  return (
    <div className="ofw-state ofw-state--loading ofw-skeleton" role="status" aria-busy="true" aria-label="Loading">
      {inner}
    </div>
  );
}

export function WaitingState({ params }: { params: string[] }) {
  const list = params.join(", ");
  return (
    <div className="ofw-state ofw-state--waiting">
      <span className="ofw-state__icon" aria-hidden="true">
        ◴
      </span>
      <span>
        waiting for input:{" "}
        {params.map((p, i) => (
          <React.Fragment key={p}>
            {i > 0 ? ", " : ""}
            <code className="ofw-param">${p}</code>
          </React.Fragment>
        ))}
        {list ? "" : ""}
      </span>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="ofw-state ofw-state--error" role="alert">
      <span className="ofw-state__icon" aria-hidden="true">
        !
      </span>
      <span className="ofw-error-msg">{message}</span>
    </div>
  );
}

export function EmptyState({ label }: { label?: string }) {
  return (
    <div className="ofw-state ofw-state--empty">
      <span>{label ?? "No data"}</span>
    </div>
  );
}
