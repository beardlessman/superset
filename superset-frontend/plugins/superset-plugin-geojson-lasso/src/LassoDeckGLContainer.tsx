/* eslint-disable react/jsx-sort-default-props */
/* eslint-disable react/sort-prop-types */
/* eslint-disable react/jsx-handler-names */
/* eslint-disable react/forbid-prop-types */
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
/**
 * Fork of legacy DeckGLContainer with onViewportChange wired on every pan/zoom.
 * Keeps lasso selection projection in sync with the rendered map viewport.
 */
import {
  forwardRef,
  memo,
  ReactNode,
  MouseEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  isValidElement,
  useRef,
} from 'react';
import { isEqual } from 'lodash';
import { StaticMap } from 'react-map-gl';
import DeckGL from '@deck.gl/react';
import type { Layer } from '@deck.gl/core';
import { JsonObject, JsonValue, usePrevious } from '@superset-ui/core';
import { styled } from '@apache-superset/core/theme';
import { Device } from '@luma.gl/core';
import Tooltip, { TooltipProps } from '../../legacy-preset-chart-deckgl/src/components/Tooltip';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Viewport } from '../../legacy-preset-chart-deckgl/src/utils/fitViewport';
import {
  MAPBOX_LAYER_PREFIX,
  OSM_LAYER_KEYWORDS,
  TILE_LAYER_PREFIX,
  buildTileLayer,
} from '../../legacy-preset-chart-deckgl/src/utils';

const TICK = 250; // milliseconds

export type LassoDeckGLContainerProps = {
  viewport: Viewport;
  setControlValue?: (control: string, value: JsonValue) => void;
  mapStyle?: string;
  mapboxApiAccessToken: string;
  children?: ReactNode;
  width: number;
  height: number;
  layers: (Layer | (() => Layer))[];
  onViewportChange?: (viewport: Viewport) => void;
};

export const LassoDeckGLContainer = memo(
  forwardRef((props: LassoDeckGLContainerProps, ref) => {
    const [tooltip, setTooltip] = useState<TooltipProps['tooltip']>(null);
    const [lastUpdate, setLastUpdate] = useState<number | null>(null);
    const [viewState, setViewState] = useState(props.viewport);
    const prevViewport = usePrevious(props.viewport);
    const glContextRef = useRef<WebGL2RenderingContext | null>(null);

    useEffect(
      () => () => {
        glContextRef.current?.getExtension('WEBGL_lose_context')?.loseContext();
      },
      [],
    );

    useImperativeHandle(ref, () => ({ setTooltip }), []);

    const tick = useCallback(() => {
      if (lastUpdate && Date.now() - lastUpdate > TICK) {
        const setCV = props.setControlValue;
        if (setCV) {
          setCV('viewport', viewState);
        }
        setLastUpdate(null);
      }
    }, [lastUpdate, props.setControlValue, viewState]);

    useEffect(() => {
      const timer = setInterval(tick, TICK);
      return clearInterval(timer);
    }, [tick]);

    useEffect(() => {
      if (!isEqual(props.viewport, prevViewport)) {
        setViewState(props.viewport);
      }
    }, [prevViewport, props.viewport]);

    const onViewStateChange = useCallback(
      ({ viewState: nextViewState }: { viewState: JsonObject }) => {
        const viewport = nextViewState as Viewport;
        setViewState(viewport);
        setLastUpdate(Date.now());
        props.onViewportChange?.(viewport);
      },
      [props.onViewportChange],
    );

    const layers = useCallback(() => {
      if (
        (props.mapStyle?.startsWith(TILE_LAYER_PREFIX) ||
          OSM_LAYER_KEYWORDS.some((tilek: string) =>
            props.mapStyle?.includes(tilek),
          )) &&
        props.layers.some(
          l => typeof l !== 'function' && l?.id === 'tile-layer',
        ) === false
      ) {
        props.layers.unshift(
          buildTileLayer(
            (props.mapStyle ?? '').replace(TILE_LAYER_PREFIX, ''),
            'tile-layer',
          ),
        );
      }
      if (props.layers.some(l => typeof l === 'function')) {
        return props.layers.map(l =>
          typeof l === 'function' ? l() : l,
        ) as Layer[];
      }

      return props.layers as Layer[];
    }, [props.layers, props.mapStyle]);

    const isCustomTooltip = (content: ReactNode): boolean =>
      isValidElement(content) &&
      content.props?.['data-tooltip-type'] === 'custom';

    const renderTooltip = (tooltipState: TooltipProps['tooltip']) => {
      if (!tooltipState) return null;

      if (isCustomTooltip(tooltipState.content)) {
        return <Tooltip tooltip={tooltipState} variant="custom" />;
      }

      return <Tooltip tooltip={tooltipState} />;
    };

    const { children = null, height, width } = props;

    return (
      <>
        <div
          style={{ position: 'relative', width, height }}
          onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <DeckGL
            controller
            width={width}
            height={height}
            layers={layers()}
            viewState={viewState}
            onViewStateChange={onViewStateChange}
            onAfterRender={(context: {
              device: Device;
              gl: WebGL2RenderingContext;
            }) => {
              glContextRef.current = context.gl;
            }}
          >
            {props.mapStyle?.startsWith(MAPBOX_LAYER_PREFIX) && (
              <StaticMap
                preserveDrawingBuffer
                mapStyle={props.mapStyle || 'light'}
                mapboxApiAccessToken={props.mapboxApiAccessToken}
              />
            )}
          </DeckGL>
          {children}
        </div>
        {renderTooltip(tooltip)}
      </>
    );
  }),
);

export const LassoDeckGLContainerStyledWrapper = styled(LassoDeckGLContainer)`
  .deckgl-tooltip > div {
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

export type LassoDeckGLContainerHandle = typeof LassoDeckGLContainer & {
  setTooltip: (tooltip: ReactNode) => void;
};
