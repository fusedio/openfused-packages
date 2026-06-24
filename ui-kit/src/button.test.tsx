import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "./button";

describe("Button (converged)", () => {
  it("stamps data-slot, data-variant, and data-size", () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole("button", { name: "Click" });
    expect(btn).toHaveAttribute("data-slot", "button");
    expect(btn).toHaveAttribute("data-variant", "default");
    expect(btn).toHaveAttribute("data-size", "default");
  });

  it("reflects explicit variant and size on the data attributes", () => {
    render(
      <Button variant="link" size="icon-xs">
        Link
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Link" });
    expect(btn).toHaveAttribute("data-variant", "link");
    expect(btn).toHaveAttribute("data-size", "icon-xs");
  });

  it("resolves the link variant classes", () => {
    const cls = buttonVariants({ variant: "link" });
    expect(cls).toContain("underline-offset-4");
    expect(cls).toContain("hover:underline");
  });

  it("resolves the icon-xs size classes", () => {
    const cls = buttonVariants({ size: "icon-xs" });
    expect(cls).toContain("size-6");
  });

  it("renders the target focus-ring classes on the base", () => {
    const cls = buttonVariants();
    expect(cls).toContain("focus-visible:border-ring");
    expect(cls).toContain("focus-visible:ring-ring/50");
    expect(cls).toContain("focus-visible:ring-[3px]");
  });

  it("renders as a child element when asChild is set", () => {
    render(
      <Button asChild>
        <a href="/udfs">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).toHaveAttribute("href", "/udfs");
  });
});
