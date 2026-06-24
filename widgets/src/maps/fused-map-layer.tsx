// maps/fused-map-layer.tsx — per-layer DATA LOADER for fused-map. Resolves a layer's
// `sql` (the planner stamps _sql/_queryId on each sql layer) and reports the rows up to
// FusedMapRenderer, which builds the deck.gl layers centrally. Renders no DOM.
import { useEffect } from "react";
import { useDuckDbSqlQuery } from "@fusedio/widget-sdk";

import type { FusedLayerDef } from "./fused-deck-layers";

export function FusedMapDataLoader({
  layer,
  onData,
}: {
  layer: FusedLayerDef;
  onData: (id: string, rows: ReadonlyArray<Record<string, unknown>>) => void;
}) {
  const { rows } = useDuckDbSqlQuery({
    sql: layer._sql ?? layer.sql ?? "",
    queryId: layer._queryId,
    enabled: !!layer._queryId,
  });
  const id = layer._queryId ?? layer.id;
  useEffect(() => {
    onData(id, rows ?? []);
  }, [id, rows, onData]);
  return null;
}
