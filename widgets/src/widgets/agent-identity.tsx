// Identity — the avatar + display-name pair for an agent (the widgets-package twin
// of the app's `Identity.tsx`; widgets cannot import from `app`). One small,
// reusable component so the agent's "AR + name" reads the same everywhere it
// appears: the agent-detail header, the task board's assignee swimlanes/groups,
// and any future agent surface. Sizes: `sm` (compact lists/columns), `default`,
// and `lg` (the detail header).
import { Avatar, AvatarFallback, cn } from "@kit";
import { deriveInitials } from "./task-board-shared";

export type IdentitySize = "sm" | "default" | "lg";

const nameClass: Record<IdentitySize, string> = {
  sm: "text-xs",
  default: "text-sm",
  lg: "text-lg font-semibold leading-tight",
};

export function Identity({
  name,
  size = "default",
  className,
}: {
  name: string;
  size?: IdentitySize;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", size === "lg" && "gap-2", className)}
    >
      <Avatar size={size}>
        <AvatarFallback>{deriveInitials(name)}</AvatarFallback>
      </Avatar>
      <span className={cn("truncate", nameClass[size])}>{name}</span>
    </span>
  );
}
