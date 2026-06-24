// maps/map-layer.tsx — a per-layer DATA LOADER for `map`. Resolves its UDF's rows
// (via the planner-synthesized "SELECT * FROM {{udf}}" stamped on the layer as
// _sql/_queryId) and reports them up to MapRenderer, which builds the deck.gl layers
// centrally (one MapboxOverlay owns all layers). Renders no DOM of its own — the
// hook just needs to live in the React tree under the widget bridge.
import { useEffect } from "react";
import { useDuckDbSqlQuery } from "@fusedio/widget-sdk";

import type { MapLayerSpec } from "./map-renderer";

export function MapDataLoader({
  layer,
  onData,
}: {
  layer: MapLayerSpec;
  onData: (id: string, rows: ReadonlyArray<Record<string, unknown>>) => void;
}) {
  const { rows } = useDuckDbSqlQuery({
    sql: layer._sql ?? "",
    queryId: layer._queryId,
    enabled: !!layer._queryId,
  });
  const id = layer._queryId ?? layer.udf ?? "";
  useEffect(() => {
    onData(id, rows ?? []);
  }, [id, rows, onData]);
  return null;
}
