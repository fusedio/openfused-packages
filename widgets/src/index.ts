// @fusedio/widgets — the JSON-UI render surface barrel.
//
// This is the package's "." entry. Consumers usually import the specific module
// they need by subpath (e.g. `@fusedio/widgets/render`,
// `@fusedio/widgets/data-store`) — the `exports` map exposes every src module.
// This barrel re-exports the most common surface as a convenience and gives the
// package a stable default entrypoint.
//
// The render REGISTRY is derived from `componentDefs` (the defineComponent
// catalog in ./widgets); the Python-artifact generator (scripts/generate.ts)
// walks the SAME `componentDefs` to emit components.json. One source, two
// consumers — they cannot drift (spec/ui/ui-architecture.md §2.1).

export { registry, componentDefs } from "./widgets";
export type {
  ComponentDef,
  ComponentDefMap,
  ComponentRegistry,
  ComponentRenderer,
} from "./widgets";

export { RenderTree, RenderNode, type UINode } from "./render";

export {
  CodeBlock,
  useHighlightedHtml,
  normalizeLang,
  CODE_LANGS,
  type CodeBlockProps,
} from "./components/CodeBlock";
export { CodeEditor, type CodeEditorProps } from "./components/CodeEditor";
