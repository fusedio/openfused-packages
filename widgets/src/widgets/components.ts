// widgets/components.ts — the component CATALOG: type-string → ComponentDef.
//
// This is the ONE module the barrel (./index.ts) imports its `componentDefs`
// from. The barrel derives the render `registry` from it (each def's
// `.component`) and generate.ts walks it to emit one JSON Schema per entry plus
// the components.json manifest.
//
// Adding a component is a ONE-LINE edit: author `./<type>.tsx`
// (default-exporting `{ ...defineComponent({...}), writesParam }`) and add a
// single `"<type>": <import>` line to the map below. Keep the key EQUAL to the
// component's json-ui `type` string (the schema file is named `<type>.json`).
//
// NOTE: importing each module evaluates its top-level `z.object({...})` prop
// schema — under the RENDER bundle that `z` is the inert zod-stub (build.mjs
// aliases it), and under generate.ts it is the real zod (so the schemas emit).

import type { ComponentDefMap } from "./types";

import agentDetail from "./agent-detail";
import secretsManager from "./secrets-manager";
import barChart from "./bar-chart";
import tabs from "./tabs";
import button from "./button";
import cameraInput from "./camera-input";
import canvas from "./canvas";
import checkboxGroup from "./checkbox-group";
import choice from "./choice";
import collapsible from "./collapsible";
import colorInput from "./color-input";
import datetimeInput from "./datetime-input";
import diff from "./diff";
import div from "./div";
import donutChart from "./donut-chart";
import dropdown from "./dropdown";
import fileUpload from "./file-upload";
import form from "./form";
import galleryInput from "./gallery-input";
import heatmapChart from "./heatmap-chart";
import html from "./html";
import iframe from "./iframe";
import image from "./image";
import fusedMap from "./fused-map";
import lineChart from "./line-chart";
import map from "./map";
import mapBounds from "./map-bounds";
import markdown from "./markdown";
import metric from "./metric";
import numberInput from "./number-input";
import scatterChart from "./scatter-chart";
import slider from "./slider";
import sqlRunner from "./sql-runner";
import sqlTable from "./sql-table";
import stackedAreaChart from "./stacked-area-chart";
import stackedBarChart from "./stacked-bar-chart";
import taskBoard from "./task-board";
import text from "./text";
import textArea from "./text-area";
import textInput from "./text-input";
import video from "./video";
import videoReview from "./video-review";

/**
 * type-string → component definition. Generate.ts re-sorts on output, so this
 * order is cosmetic. The first 15 are v0; then the `video-review` feedback
 * primitive and the `canvas` widget; the rest are batch 1
 * (spec/ui/json-ui-widgets-batch1.md): 3 charts, 4 simple inputs, 4 media widgets,
 * and the form container.
 */
export const componentDefs: ComponentDefMap = {
  text,
  markdown,
  diff,
  div,
  metric,
  button,
  dropdown,
  slider,
  "text-input": textInput,
  "bar-chart": barChart,
  "line-chart": lineChart,
  "stacked-area-chart": stackedAreaChart,
  "donut-chart": donutChart,
  "sql-table": sqlTable,
  image,
  html,
  iframe,
  "video-review": videoReview,
  canvas,
  // Fused-owned primitives (NOT app parity): the task board + the agent detail
  // view, both backed by the packaged _core CRUD UDFs.
  "task-board": taskBoard,
  "agent-detail": agentDetail,
  "secrets-manager": secretsManager,
  tabs,
  // batch 1 — charts
  "stacked-bar-chart": stackedBarChart,
  "scatter-chart": scatterChart,
  "heatmap-chart": heatmapChart,
  // batch 1 — simple inputs
  "text-area": textArea,
  "number-input": numberInput,
  "datetime-input": datetimeInput,
  "color-input": colorInput,
  "checkbox-group": checkboxGroup,
  // batch 1 — media widgets
  video,
  "camera-input": cameraInput,
  "file-upload": fileUpload,
  "gallery-input": galleryInput,
  // batch 1 — container
  form,
  // agent_core-owned layout + feedback primitives (no Fused app parity):
  //   collapsible — disclosure container for the architect's summary+detail specs
  //   choice      — single/multi question with an "Other" free-text escape hatch
  collapsible,
  choice,
  // maps (native-app render; the deployed bundle shows a placeholder — build.mjs)
  map,
  "map-bounds": mapBounds,
  "fused-map": fusedMap,
  // sql-runner — a named-query SOURCE container (resolver-coupled; renders everywhere)
  "sql-runner": sqlRunner,
};
