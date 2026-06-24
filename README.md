# @fusedio shared packages

Shared front-end packages used across the OpenFused (`fusedio/openfused`) and
Flow (`fusedio/flow`) repositories. This repo is the single source of truth and
is consumed by both as a git submodule mounted at `packages/`.

## Packages

| Package | Name | Description |
| --- | --- | --- |
| `ui-kit/` | `@fusedio/ui-kit` | Shared UI primitives (Radix-based components, styling). |
| `widgets/` | `@fusedio/widgets` | JSON-UI widget renderer, canvas, maps, and widget specs. |
| `dev-serve-client/` | `@fusedio/dev-serve-client` | Client/parsers for the dev-serve protocol. |

## Usage as a submodule

Each consuming repo includes this repo as a submodule at `packages/`, which is
matched by their `pnpm-workspace.yaml` `packages/*` glob. The packages are
resolved within the host pnpm workspace (they are not published; consumers use
`workspace:*`).

```bash
# Initial clone of a consumer repo
git clone --recurse-submodules <consumer-repo>

# Or, after a plain clone
git submodule update --init --recursive

# Pulling submodule updates later
git submodule update --remote packages
```

## Making changes

Edit packages here, commit, and push to `main`. Then in each consumer repo bump
the submodule pointer:

```bash
cd packages && git pull origin main && cd ..
git add packages && git commit -m "chore: bump @fusedio/* packages"
```
