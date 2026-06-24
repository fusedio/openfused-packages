# @fusedio shared packages

Shared front-end packages used across the OpenFused (`fusedio/openfused`) and
Flow (`fusedio/flow`) repositories. This repo is the single source of truth and
is consumed by both as a git submodule mounted at `packages/`.

## Packages

| Package | Name | Description | Consumed via |
| --- | --- | --- | --- |
| `ui-kit/` | `@fusedio/ui-kit` | Shared UI primitives (Radix-based components, styling). | `workspace:*` |
| `widgets/` | `@fusedio/widgets` | JSON-UI widget renderer, canvas, maps, and widget specs. | `workspace:*` |
| `dev-serve-client/` | `@fusedio/dev-serve-client` | Client/parsers for the dev-serve protocol. | `workspace:*` |
| `widget-sdk/` | `@fusedio/widget-sdk` | React hooks + bridge contract for building custom JSON-UI components. | **published npm package (pinned version)** |

## ⚠️ `widget-sdk` is the exception — consumed via npm, not the workspace

`widget-sdk/` is the source of truth for `@fusedio/widget-sdk`, but unlike the
other packages here it is **also published as a standalone package on npm** and
consumers depend on it **via that published package — not via the pnpm
workspace**.

Why it's different: `@fusedio/widget-sdk` is the public, versioned contract that
in-the-wild third-party component catalogs build against (they mark it
`external` and the host resolves it through a runtime import map). Consumers must
build against the *exact published version* they ship, so they pin an explicit
version rather than floating on the local checkout:

```jsonc
// a consumer's package.json
"@fusedio/ui-kit":     "workspace:*",   // linked from this submodule
"@fusedio/widgets":    "workspace:*",   // linked from this submodule
"@fusedio/widget-sdk": "0.3.1"          // resolved from the npm registry, NOT linked
```

Even though `widget-sdk/` sits under the `packages/*` glob, pnpm does **not**
symlink it (consumers use a plain version specifier, not `workspace:*`, and
`link-workspace-packages` is off), so the dependency resolves from the npm
registry. The directory lives here so the source stays alongside its siblings;
shipping changes still means **publishing a new version to npm and bumping the
pinned version** in each consumer — a `git submodule update` alone does not pick
up `widget-sdk` changes.

See `widget-sdk/README.md` and `widget-sdk/AGENTS.md` for the publishing flow
and the wire-contract rules.

## Usage as a submodule

Each consuming repo includes this repo as a submodule at `packages/`, which is
matched by their `pnpm-workspace.yaml` `packages/*` glob. The `workspace:*`
packages above are resolved within the host pnpm workspace (they are not
published). `@fusedio/widget-sdk` is the exception described above — it is
consumed from npm at a pinned version, not linked from the workspace.

```bash
# Initial clone of a consumer repo
git clone --recurse-submodules <consumer-repo>

# Or, after a plain clone
git submodule update --init --recursive

# Pulling submodule updates later
git submodule update --remote packages
```

## Making changes

For the `workspace:*` packages (`ui-kit`, `widgets`, `dev-serve-client`): edit
here, commit, and push to `main`. Then in each consumer repo bump the submodule
pointer:

```bash
cd packages && git pull origin main && cd ..
git add packages && git commit -m "chore: bump @fusedio/* packages"
```

For `widget-sdk` the submodule bump is **not** enough — it is consumed from npm,
not linked. After editing, **publish a new version and bump the pinned version**
in each consumer:

```bash
cd widget-sdk
# bump "version" in package.json, then:
npm publish        # runs prepublishOnly (clean + build + bundle)
# then in each consumer repo, set "@fusedio/widget-sdk": "<new version>"
```
