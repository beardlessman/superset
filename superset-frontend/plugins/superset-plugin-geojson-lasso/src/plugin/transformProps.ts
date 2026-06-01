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
import type { ChartProps } from '@superset-ui/core';
import legacyTransformProps from '../../../legacy-preset-chart-deckgl/src/transformProps';

export default function transformProps(chartProps: ChartProps) {
  const result = legacyTransformProps(chartProps) as Record<string, unknown>;
  const pointFilterField =
    typeof chartProps.rawFormData?.lasso_point_filter_field === 'string' &&
    chartProps.rawFormData.lasso_point_filter_field
      ? chartProps.rawFormData.lasso_point_filter_field
      : 'name';
  const lineFilterField =
    typeof chartProps.rawFormData?.lasso_line_filter_field === 'string' &&
    chartProps.rawFormData.lasso_line_filter_field
      ? chartProps.rawFormData.lasso_line_filter_field
      : 'courier_name';

  return {
    ...result,
    emitCrossFilters: chartProps.emitCrossFilters,
    setDataMask: chartProps.hooks?.setDataMask,
    setControlValue: chartProps.emitCrossFilters
      ? undefined
      : chartProps.hooks?.setControlValue,
    filterState: chartProps.filterState,
    adhocFilters: Array.isArray(chartProps.rawFormData?.adhoc_filters)
      ? chartProps.rawFormData.adhoc_filters
      : [],
    entityField: pointFilterField,
    lineEntityField: lineFilterField,
  };
}
