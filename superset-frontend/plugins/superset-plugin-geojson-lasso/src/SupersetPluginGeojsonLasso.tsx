/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GeoJsonLayer } from '@deck.gl/layers';
import { WebMercatorViewport } from '@math.gl/web-mercator';
import type { AdhocFilter, DataMask, JsonObject, JsonValue } from '@superset-ui/core';
import type { Feature, Geometry, GeoJsonProperties } from 'geojson';
import { DeckGLContainerHandle, DeckGLContainerStyledWrapper } from '../../legacy-preset-chart-deckgl/src/DeckGLContainer';
import type { TooltipProps } from '../../legacy-preset-chart-deckgl/src/components/Tooltip';
import { DEFAULT_DECKGL_TILES } from '../../legacy-preset-chart-deckgl/src/utilities/Shared_DeckGL';
import {
  MAPBOX_LAYER_PREFIX,
  TILE_LAYER_PREFIX,
} from '../../legacy-preset-chart-deckgl/src/utils';
import fitViewport, { Viewport } from '../../legacy-preset-chart-deckgl/src/utils/fitViewport';
import { getLayer, getPoints } from '../../legacy-preset-chart-deckgl/src/layers/Geojson/Geojson';

const DEFAULT_OSM_MAP_STYLE = DEFAULT_DECKGL_TILES[0][0];

type FilterValue = string | number | boolean;
type LassoPointKind = string;

type ProcessedFeature = Feature<Geometry, GeoJsonProperties> & {
  properties?: Record<string, unknown>;
};
type SelectionMode = 'all' | 'point' | 'line';

type LassoProps = {
  formData: JsonObject & {
    autozoom?: boolean;
    mapbox_style?: string;
    maplibre_style?: string;
    map_renderer?: string;
    slice_id?: number;
  };
  payload: JsonObject & { data?: JsonObject & { mapboxApiKey?: string; features?: unknown[] } };
  setControlValue?: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter?: (...args: unknown[]) => void;
  height: number;
  width: number;
  filterState?: { value?: unknown };
  onContextMenu?: (...args: unknown[]) => void;
  setDataMask?: (dataMask: DataMask) => void;
  emitCrossFilters?: boolean;
  adhocFilters?: AdhocFilter[];
  entityField?: string;
  lineEntityField?: string;
};

const NOOP = () => {};
const AUTOZOOM_MAX_ZOOM = 12;

/** Legacy explore payload is `queriesData[0]` with shape `{ data: { features, mapboxApiKey } }`. */
function getLegacyPayloadData(
  payload: LassoProps['payload'] | undefined,
): JsonObject & { features?: unknown[]; mapboxApiKey?: string } {
  const root = (payload?.data ?? payload) as JsonObject | undefined;
  return root ?? {};
}

/**
 * Legacy deck.gl (6.1.x) basemap: Mapbox vector (`mapbox://…` + token) or raster tiles
 * (`https://…/{z}/{x}/{y}.png`, optional `tile://` prefix). MapLibre style.json URLs
 * are not supported by DeckGLContainer.
 */
function resolveLegacyMapStyle(
  formData: LassoProps['formData'],
  mapboxApiKey?: string,
): string {
  const mapboxStyle =
    typeof formData.mapbox_style === 'string' ? formData.mapbox_style.trim() : '';
  const maplibreStyle =
    typeof formData.maplibre_style === 'string' ? formData.maplibre_style.trim() : '';
  const candidate = mapboxStyle || maplibreStyle;

  if (!candidate) {
    return DEFAULT_OSM_MAP_STYLE;
  }

  if (candidate.includes('style.json')) {
    return DEFAULT_OSM_MAP_STYLE;
  }

  if (
    candidate.startsWith(MAPBOX_LAYER_PREFIX) &&
    !(mapboxApiKey && mapboxApiKey.trim())
  ) {
    return DEFAULT_OSM_MAP_STYLE;
  }

  if (
    candidate.startsWith(TILE_LAYER_PREFIX) ||
    candidate.startsWith(MAPBOX_LAYER_PREFIX) ||
    candidate.includes('openstreetmap') ||
    candidate.includes('/{z}/')
  ) {
    return candidate;
  }

  return DEFAULT_OSM_MAP_STYLE;
}

/**
 * deck.gl defaults give TextLayer a fixed ASCII characterSet array; we must use 'auto'
 * so glyphs for Cyrillic are rasterized (see TextLayer characterSet / FontAtlasManager).
 */
const CYRILLIC_LABEL_FONT =
  'system-ui, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';

function getAllowedLassoPointKinds(rawValue: unknown): Set<LassoPointKind> {
  const fallback = new Set<LassoPointKind>([
    'warehouse',
    'courier',
    'order',
    'service_zone',
  ]);
  if (!Array.isArray(rawValue)) {
    return fallback;
  }
  const allowed = rawValue
    .filter(kind => typeof kind === 'string' && kind.trim().length > 0)
    .map(kind => kind.trim().toLowerCase() as LassoPointKind);
  return allowed.length ? new Set<LassoPointKind>(allowed) : fallback;
}

function isPointAllowedByKind(
  feature: ProcessedFeature,
  allowedKinds: Set<LassoPointKind>,
): boolean {
  const rawKind = feature.properties?.kind ?? feature.properties?.feature_kind;
  const kind = typeof rawKind === 'string' ? rawKind.toLowerCase() : '';
  if (!kind) {
    return false;
  }
  if (allowedKinds.has(kind)) {
    return true;
  }
  if (kind === 'warehouse') {
    return allowedKinds.has('warehouse');
  }
  if (kind.includes('courier')) {
    return allowedKinds.has('courier');
  }
  return false;
}

function isPointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean {
  const cross = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
  ) => (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
  const onSegment = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) =>
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y &&
    q.y <= Math.max(p.y, r.y);

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function lineIntersectsPolygon(
  line: { x: number; y: number }[],
  polygon: { x: number; y: number }[],
): boolean {
  if (line.length < 2 || polygon.length < 4) return false;
  // Any line vertex inside polygon => intersection.
  if (line.some(p => isPointInPolygon(p, polygon))) return true;
  // Any segment intersection.
  for (let i = 0; i < line.length - 1; i += 1) {
    const a1 = line[i];
    const a2 = line[i + 1];
    for (let j = 0; j < polygon.length - 1; j += 1) {
      const b1 = polygon[j];
      const b2 = polygon[j + 1];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function flattenGeoJsonFeatures(node: unknown): ProcessedFeature[] {
  const result: ProcessedFeature[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const obj = n as Record<string, unknown>;
    if (Array.isArray(obj.features)) {
      obj.features.forEach(visit);
      return;
    }
    if (obj.geometry) {
      result.push(n as ProcessedFeature);
    }
  };
  visit(node);
  return result;
}

function applySelfFilterToGeoJson(
  node: unknown,
  pointFilterEntity: string,
  lineFilterEntity: string,
  allowedPointValues: Set<string>,
  allowedLineValues: Set<string>,
): unknown {
  if (!node || typeof node !== 'object') return node;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.features)) {
    return {
      ...obj,
      features: obj.features
        .map(child =>
          applySelfFilterToGeoJson(
            child,
            pointFilterEntity,
            lineFilterEntity,
            allowedPointValues,
            allowedLineValues,
          ),
        )
        .filter(Boolean),
    };
  }
  if (obj.geometry) {
    const properties = (obj.properties ?? {}) as Record<string, unknown>;
    const rawPointValue = properties[pointFilterEntity];
    const rawLineValue = properties[lineFilterEntity];
    const pointMatch =
      rawPointValue !== null &&
      rawPointValue !== undefined &&
      allowedPointValues.has(String(rawPointValue));
    const lineMatch =
      rawLineValue !== null &&
      rawLineValue !== undefined &&
      allowedLineValues.has(String(rawLineValue));
    return pointMatch || lineMatch ? obj : null;
  }
  return obj;
}

function getSelectedEntityValues(
  selected: ProcessedFeature[],
  entity: string,
): FilterValue[] {
  const values = new Set<FilterValue>();
  selected.forEach(feature => {
    const rawVal = feature.properties?.[entity];
    if (
      rawVal !== null &&
      rawVal !== undefined &&
      (typeof rawVal === 'string' ||
        typeof rawVal === 'number' ||
        typeof rawVal === 'boolean')
    ) {
      values.add(rawVal);
    }
  });
  return Array.from(values);
}

function getUniqueFilterValues(values: FilterValue[]): FilterValue[] {
  return Array.from(new Set(values));
}

function hasActiveFilterStateValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

const SupersetPluginGeojsonLasso = (props: LassoProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [isLassoActive, setIsLassoActive] = useState(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('all');
  const [isDrawing, setIsDrawing] = useState(false);
  const [lassoPath, setLassoPath] = useState<{ x: number; y: number }[]>([]);
  const [selectedFeatures, setSelectedFeatures] = useState<ProcessedFeature[]>([]);
  const [currentViewport, setCurrentViewport] = useState<Viewport>(props.viewport);
  const [selfFilterValues, setSelfFilterValues] = useState<{
    names: string[];
    couriers: string[];
  } | null>(null);
  const isLassoActiveRef = useRef(isLassoActive);
  const isDrawingRef = useRef(isDrawing);
  const lassoPathRef = useRef(lassoPath);
  const pointFeaturesRef = useRef<ProcessedFeature[]>([]);
  const lineFeaturesRef = useRef<ProcessedFeature[]>([]);
  const currentViewportRef = useRef(currentViewport);

  const formData = props.formData ?? {};
  const payloadData = getLegacyPayloadData(props.payload);
  const mapboxToken = (payloadData.mapboxApiKey as string) || '';
  const mapStyle = resolveLegacyMapStyle(formData, mapboxToken);
  const setControlValue = props.setControlValue ?? NOOP;
  const onAddFilter = props.onAddFilter ?? NOOP;
  const onContextMenu = props.onContextMenu ?? NOOP;
  const setDataMask = props.setDataMask ?? NOOP;
  const pointEntity = props.entityField || 'name';
  const lineEntity = props.lineEntityField || 'courier_name';
  const allowedPointKinds = useMemo(
    () =>
      getAllowedLassoPointKinds(
        (formData as Record<string, unknown>).lasso_point_kinds,
      ),
    [formData],
  );

  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) current.setTooltip(tooltip);
  }, []);

  const viewport: Viewport = useMemo(() => {
    if (formData.autozoom) {
      const normalizedFeatures = flattenGeoJsonFeatures(payloadData);
      const points =
        normalizedFeatures.length > 0
          ? getPoints(normalizedFeatures as never) || []
          : [];
      if (points.length) {
        return fitViewport(props.viewport, {
          width: props.width,
          height: props.height,
          points,
          maxZoom: AUTOZOOM_MAX_ZOOM,
        });
      }
    }
    return props.viewport;
  }, [formData.autozoom, payloadData, props.viewport, props.width, props.height]);

  const filteredPayloadForSelf = useMemo(() => {
    if (!props.emitCrossFilters || !selfFilterValues) {
      return props.payload;
    }
    const allowedPointValues = new Set(selfFilterValues.names);
    const allowedLineValues = new Set(selfFilterValues.couriers);
    return {
      ...props.payload,
      data: applySelfFilterToGeoJson(
        props.payload?.data ?? {},
        pointEntity,
        lineEntity,
        allowedPointValues,
        allowedLineValues,
      ) as JsonObject,
    } as JsonObject;
  }, [lineEntity, pointEntity, props.emitCrossFilters, props.payload, selfFilterValues]);

  /** Bumped after fonts load so deck.gl TextLayer can rebuild the atlas with the right glyphs. */
  const [labelFontEpoch, setLabelFontEpoch] = useState(0);
  const labelsEnabled = Boolean((formData as Record<string, unknown>).enable_labels);

  useEffect(() => {
    if (!labelsEnabled || typeof document === 'undefined') return undefined;

    let cancelled = false;
    const bump = () => {
      if (!cancelled) setLabelFontEpoch(c => c + 1);
    };

    if (document.fonts?.ready) {
      document.fonts.ready.then(bump);
    } else {
      bump();
    }

    return () => {
      cancelled = true;
    };
  }, [labelsEnabled]);

  const layer = useMemo(() => {
    const base = getLayer({
      onContextMenu,
      filterState: props.emitCrossFilters ? (props.filterState as any) : undefined,
      setDataMask: setDataMask as any,
      setTooltip,
      onAddFilter: onAddFilter as any,
      payload: filteredPayloadForSelf as any,
      formData: formData as any,
      emitCrossFilters: props.emitCrossFilters,
    }) as GeoJsonLayer;

    const fd = formData as Record<string, unknown>;
    const radius = parseInt(String(fd.lasso_point_radius ?? 10), 10);
    const radiusScale = Number(fd.lasso_point_radius_scale ?? 1);
    const radiusUnits =
      fd.lasso_point_radius_units === 'meters' ||
      fd.lasso_point_radius_units === 'common'
        ? fd.lasso_point_radius_units
        : 'pixels';
    const jsLabelMode = Boolean(fd.enable_label_javascript_mode);

    // Do not use ?? with p.textCharacterSet: deck.gl's default is a truthy ASCII-only array.
    const overlay: Record<string, unknown> = {
      getPointRadius: Number.isFinite(radius) ? radius : 10,
      pointRadiusScale: Number.isFinite(radiusScale) ? radiusScale : 1,
      pointRadiusUnits: radiusUnits,
      textCharacterSet: 'auto',
      textFontFamily: CYRILLIC_LABEL_FONT,
    };

    if (labelsEnabled && !jsLabelMode) {
      const ox = parseInt(String(fd.lasso_label_offset_x ?? 8), 10);
      const oy = parseInt(String(fd.lasso_label_offset_y ?? 0), 10);
      const rawAnchor = fd.lasso_label_anchor;
      const anchor =
        rawAnchor === 'start' || rawAnchor === 'middle' || rawAnchor === 'end'
          ? rawAnchor
          : 'start';
      overlay.getTextPixelOffset = [
        Number.isFinite(ox) ? ox : 0,
        Number.isFinite(oy) ? oy : 0,
      ];
      overlay.getTextAnchor = anchor;
    }

    return base.clone(overlay);
  }, [
    onContextMenu,
    props.filterState,
    setDataMask,
    setTooltip,
    onAddFilter,
    filteredPayloadForSelf,
    formData,
    props.emitCrossFilters,
    labelsEnabled,
    labelFontEpoch,
  ]);

  const pointFeatures = useMemo(() => {
    // Use the same processed data that deck.gl layer renders.
    // This avoids mismatches across different payload shapes.
    const layerData = ((layer as unknown as { props?: { data?: unknown } }).props
      ?.data ?? []) as unknown;
    const base = Array.isArray(layerData)
      ? (layerData as ProcessedFeature[])
      : flattenGeoJsonFeatures(payloadData);
    return base
      .filter(f => f.geometry?.type === 'Point')
      .filter(feature => isPointAllowedByKind(feature, allowedPointKinds));
  }, [allowedPointKinds, layer, payloadData]);
  const lineFeatures = useMemo(() => {
    const layerData = ((layer as unknown as { props?: { data?: unknown } }).props
      ?.data ?? []) as unknown;
    const base = Array.isArray(layerData)
      ? (layerData as ProcessedFeature[])
      : flattenGeoJsonFeatures(payloadData);
    return base.filter(f => f.geometry?.type === 'LineString');
  }, [layer, payloadData]);

  useEffect(() => {
    isLassoActiveRef.current = isLassoActive;
  }, [isLassoActive]);
  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);
  useEffect(() => {
    lassoPathRef.current = lassoPath;
  }, [lassoPath]);
  useEffect(() => {
    pointFeaturesRef.current = pointFeatures;
  }, [pointFeatures]);
  useEffect(() => {
    lineFeaturesRef.current = lineFeatures;
  }, [lineFeatures]);
  useEffect(() => {
    currentViewportRef.current = currentViewport;
  }, [currentViewport]);

  const projectToScreen = useCallback(
    (lon: number, lat: number) => {
      const { longitude, latitude, zoom, bearing = 0, pitch = 0 } =
        currentViewportRef.current;
      const mercator = new WebMercatorViewport({
        width: props.width,
        height: props.height,
        longitude,
        latitude,
        zoom,
        bearing,
        pitch,
      });
      const [x, y] = mercator.project([lon, lat]);
      return { x, y };
    },
    [props.height, props.width],
  );

  const getSvgPointFromClient = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const handleLassoMouseDown = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!isLassoActive) return;
      const startPoint = getSvgPointFromClient(event.clientX, event.clientY);
      if (!startPoint) return;
      setIsDrawing(true);
      setLassoPath([startPoint]);
    },
    [getSvgPointFromClient, isLassoActive],
  );

  const handleLassoMouseMove = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!isLassoActive || !isDrawing) return;
      const nextPoint = getSvgPointFromClient(event.clientX, event.clientY);
      if (!nextPoint) return;
      setLassoPath(prev => [...prev, nextPoint]);
    },
    [getSvgPointFromClient, isDrawing, isLassoActive],
  );

  const handleLassoMouseUp = useCallback(() => {
    const active = isLassoActiveRef.current;
    const drawing = isDrawingRef.current;
    const currentPath = lassoPathRef.current;
    if (!active || !drawing || currentPath.length < 3) {
      setIsDrawing(false);
      return;
    }
    const polygon = [...currentPath, currentPath[0]];
    const selectedPoints = pointFeaturesRef.current.filter(feature => {
      const coordinates =
        feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
      if (!coordinates || !Array.isArray(coordinates)) return false;
      const [lon, lat] = coordinates as [number, number];
      const screenPoint = projectToScreen(lon, lat);
      return isPointInPolygon(screenPoint, polygon);
    });
    const selectedLines = lineFeaturesRef.current.filter(feature => {
      const coordinates =
        feature.geometry?.type === 'LineString'
          ? (feature.geometry.coordinates as [number, number][])
          : null;
      if (!coordinates || coordinates.length < 2) return false;
      const projected = coordinates.map(([lon, lat]) => projectToScreen(lon, lat));
      return lineIntersectsPolygon(projected, polygon);
    });
    const selected =
      selectionMode === 'point'
        ? selectedPoints
        : selectionMode === 'line'
          ? selectedLines
          : [...selectedPoints, ...selectedLines];
    // Debug selected features captured by lasso selection.
    // eslint-disable-next-line no-console
    console.log('Geojson lasso selected features:', selected);
    setSelectedFeatures(selected);
    setIsDrawing(false);
  }, [projectToScreen, selectionMode]);

  useEffect(() => {
    // Keep selection projection in sync with the effective viewport
    // (important when autozoom changes map position without user interaction).
    setCurrentViewport(viewport);
  }, [viewport]);

  useEffect(() => {
    if (!isDrawing) return undefined;
    const onWindowMouseMove = (event: MouseEvent) => {
      if (!isDrawingRef.current || !isLassoActiveRef.current) return;
      const nextPoint = getSvgPointFromClient(event.clientX, event.clientY);
      if (!nextPoint) return;
      setLassoPath(prev => [...prev, nextPoint]);
    };
    const onWindowMouseUp = () => {
      handleLassoMouseUp();
    };
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [getSvgPointFromClient, isDrawing, handleLassoMouseUp]);

  useEffect(() => {
    // When cross-filter is cleared from the dashboard filter bar,
    // restore full dataset on the source chart.
    if (!props.emitCrossFilters) return;
    if (!hasActiveFilterStateValue(props.filterState?.value)) {
      setSelfFilterValues(null);
    }
  }, [props.emitCrossFilters, props.filterState?.value]);

  const applyCrossFilter = useCallback(
    (
      selected: ProcessedFeature[],
      filterEntity: string,
      sqlExpression?: string,
      filterStateValues?: FilterValue[],
    ) => {
      if (!props.emitCrossFilters || !props.setDataMask) return;
      const val =
        filterStateValues && filterStateValues.length > 0
          ? filterStateValues
          : getSelectedEntityValues(selected, filterEntity);
      const extraFormData = (sqlExpression
        ? {
            adhoc_filters: [
              {
                clause: 'WHERE',
                expressionType: 'SQL',
                sqlExpression,
              } as AdhocFilter,
            ],
          }
        : { filters: val.length ? [{ col: filterEntity, op: 'IN' as const, val }] : [] }) as
        | DataMask['extraFormData']
        | undefined;
      props.setDataMask({
        extraFormData,
        filterState: {
          label: val.length ? val.map(String).join(', ') : null,
          value: val.length ? val : null,
          selectedValues: val.length ? val.map(String) : null,
          filters: val.length
            ? {
                [filterEntity]: val,
              }
            : null,
        },
      });
    },
    [props],
  );

  const applyToFilters = useCallback(() => {
    const keepLassoPathAfterApply = () => {
      // Keep lasso overlay visible after apply for visual feedback.
      setIsDrawing(false);
    };

    const filterEntity = selectionMode === 'line' ? lineEntity : pointEntity;
    const val = getSelectedEntityValues(selectedFeatures, filterEntity);
    const pointValues =
      selectionMode === 'all'
        ? getSelectedEntityValues(selectedFeatures, pointEntity)
        : [];
    const lineValues =
      selectionMode === 'all'
        ? getSelectedEntityValues(selectedFeatures, lineEntity)
        : [];
    if (!val.length && !pointValues.length && !lineValues.length) return;

    if (props.emitCrossFilters) {
      if (selectionMode === 'all') {
        const pointQuoted = pointValues
          .map(v => String(v).replaceAll("'", "''"))
          .map(v => `'${v}'`)
          .join(', ');
        const lineQuoted = lineValues
          .map(v => String(v).replaceAll("'", "''"))
          .map(v => `'${v}'`)
          .join(', ');
        const geojsonColumn =
          typeof (formData as Record<string, unknown>).geojson === 'string'
            ? ((formData as Record<string, unknown>).geojson as string)
            : 'feature';
        const parts: string[] = [];
        if (pointValues.length) {
          parts.push(
            `(${geojsonColumn})::jsonb->'properties'->>'${pointEntity}' IN (${pointQuoted})`,
          );
        }
        if (lineValues.length) {
          parts.push(
            `(${geojsonColumn})::jsonb->'properties'->>'${lineEntity}' IN (${lineQuoted})`,
          );
        }
        if (parts.length) {
          const filterStateValues = getUniqueFilterValues([
            ...pointValues,
            ...lineValues,
          ]);
          setSelfFilterValues({
            names: pointValues.map(String),
            couriers: lineValues.map(String),
          });
          applyCrossFilter(
            selectedFeatures,
            pointEntity,
            `(${parts.join(' OR ')})`,
            filterStateValues,
          );
          keepLassoPathAfterApply();
        }
      } else {
        setSelfFilterValues({
          names:
            selectionMode === 'point'
              ? getSelectedEntityValues(selectedFeatures, pointEntity).map(String)
              : [],
          couriers:
            selectionMode === 'line'
              ? getSelectedEntityValues(selectedFeatures, lineEntity).map(String)
              : [],
        });
        applyCrossFilter(selectedFeatures, filterEntity);
        keepLassoPathAfterApply();
      }
      return;
    }

    if (!props.setControlValue) return;
    const geojsonColumn =
      typeof (formData as Record<string, unknown>).geojson === 'string'
        ? ((formData as Record<string, unknown>).geojson as string)
        : 'feature';
    const quotedList = val
      .map(v => String(v).replaceAll("'", "''"))
      .map(v => `'${v}'`)
      .join(', ');
    const pointQuoted = pointValues
      .map(v => String(v).replaceAll("'", "''"))
      .map(v => `'${v}'`)
      .join(', ');
    const lineQuoted = lineValues
      .map(v => String(v).replaceAll("'", "''"))
      .map(v => `'${v}'`)
      .join(', ');
    const sqlExpression =
      selectionMode === 'all'
        ? [
            pointValues.length
              ? `(${geojsonColumn})::jsonb->'properties'->>'${pointEntity}' IN (${pointQuoted})`
              : '',
            lineValues.length
              ? `(${geojsonColumn})::jsonb->'properties'->>'${lineEntity}' IN (${lineQuoted})`
              : '',
          ]
            .filter(Boolean)
            .join(' OR ')
        : `(${geojsonColumn})::jsonb->'properties'->>'${filterEntity}' IN (${quotedList})`;
    const nextFilter: AdhocFilter = {
      clause: 'WHERE',
      expressionType: 'SQL',
      sqlExpression: selectionMode === 'all' ? `(${sqlExpression})` : sqlExpression,
      isExtra: true,
    } as AdhocFilter;
    const prev = Array.isArray(props.adhocFilters) ? props.adhocFilters : [];
    const withoutPrevLasso = prev.filter(
      f =>
        !(
          f.expressionType === 'SQL' &&
          f.clause === 'WHERE' &&
          typeof (f as any).sqlExpression === 'string' &&
          ((f as any).sqlExpression.includes(`->>'${pointEntity}'`) ||
            (f as any).sqlExpression.includes(`->>'${lineEntity}'`)) &&
          (f as any).isExtra === true
        ),
    );
    setControlValue('adhoc_filters', [...withoutPrevLasso, nextFilter]);
    keepLassoPathAfterApply();
  }, [
    selectedFeatures,
    pointEntity,
    lineEntity,
    selectionMode,
    props.emitCrossFilters,
    props.setControlValue,
    props.adhocFilters,
    setControlValue,
    applyCrossFilter,
  ]);

  useEffect(() => {
    const features = flattenGeoJsonFeatures(payloadData);
    const isMapboxStyle = mapStyle.startsWith(MAPBOX_LAYER_PREFIX);
    const isTileStyle =
      mapStyle.startsWith(TILE_LAYER_PREFIX) ||
      mapStyle.includes('openstreetmap') ||
      mapStyle.includes('/{z}/');
    // Temporary diagnostics for local map rendering issues.
    // eslint-disable-next-line no-console
    console.log('[geojson-lasso:map-debug]', {
      sliceId: formData.slice_id,
      mapboxStyle: formData.mapbox_style,
      maplibreStyle: formData.maplibre_style,
      resolvedMapStyle: mapStyle,
      hasMapboxToken: Boolean(mapboxToken),
      mapboxTokenPrefix: mapboxToken ? mapboxToken.slice(0, 6) : '',
      mapMode: isMapboxStyle ? 'mapbox' : isTileStyle ? 'tile' : 'none',
      featuresCount: features.length,
      viewport,
      chartSize: { width: props.width, height: props.height },
    });
  }, [
    formData.mapbox_style,
    formData.maplibre_style,
    formData.slice_id,
    mapStyle,
    mapboxToken,
    payloadData,
    props.width,
    props.height,
    viewport,
  ]);

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={mapboxToken}
      viewport={viewport}
      layers={[layer]}
      mapStyle={mapStyle}
      setControlValue={setControlValue}
      height={props.height}
      width={props.width}
      onViewportChange={setCurrentViewport}
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 8,
          zIndex: 3,
        }}
      >
        <button
          type="button"
          onClick={() => {
            setSelectionMode('all');
            setIsLassoActive(v => !v || selectionMode !== 'all');
            setIsDrawing(false);
            setLassoPath([]);
            setSelectedFeatures([]);
          }}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.25)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            backgroundColor:
              isLassoActive && selectionMode === 'all' ? '#fa8c16' : '#fff7e6',
            color: '#000000',
          }}
        >
          Lasso
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectionMode('point');
            setIsLassoActive(v => !v || selectionMode !== 'point');
            setIsDrawing(false);
            setLassoPath([]);
            setSelectedFeatures([]);
          }}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.25)',
            fontSize: 11,
            cursor: 'pointer',
            backgroundColor:
              isLassoActive && selectionMode === 'point' ? '#1677ff' : '#ffffff',
            color: isLassoActive && selectionMode === 'point' ? '#ffffff' : '#000000',
          }}
        >
          Lasso Point
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectionMode('line');
            setIsLassoActive(v => !v || selectionMode !== 'line');
            setIsDrawing(false);
            setLassoPath([]);
            setSelectedFeatures([]);
          }}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.25)',
            fontSize: 11,
            cursor: 'pointer',
            backgroundColor:
              isLassoActive && selectionMode === 'line' ? '#1677ff' : '#ffffff',
            color: isLassoActive && selectionMode === 'line' ? '#ffffff' : '#000000',
          }}
        >
          Lasso Line
        </button>
        <button
          type="button"
          onClick={applyToFilters}
          disabled={!selectedFeatures.length}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.25)',
            backgroundColor: '#ffffff',
            cursor: selectedFeatures.length ? 'pointer' : 'not-allowed',
            fontSize: 11,
            opacity: selectedFeatures.length ? 1 : 0.5,
          }}
        >
          {`Apply to filters${
            selectedFeatures.length > 0 ? ` (${selectedFeatures.length})` : ''
          }`}
        </button>
      </div>

      {isLassoActive ? (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'auto',
            zIndex: 2,
          }}
          onMouseDown={handleLassoMouseDown}
          onMouseMove={handleLassoMouseMove}
          onMouseUp={handleLassoMouseUp}
        >
          {lassoPath.length > 1 ? (
            <polyline
              points={lassoPath.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#00f"
              strokeWidth={2}
            />
          ) : null}
        </svg>
      ) : null}
    </DeckGLContainerStyledWrapper>
  );
};

export default memo(SupersetPluginGeojsonLasso);
