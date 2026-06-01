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
import { t } from '@apache-superset/core/translation';
import type { ControlPanelConfig } from '@superset-ui/chart-controls';
import {
  FeatureFlag,
  isFeatureEnabled,
  legacyValidateInteger,
  validateInteger,
  validateNumber,
  type QueryFormData,
} from '@superset-ui/core';
import geojsonControlPanel from '../../../legacy-preset-chart-deckgl/src/layers/Geojson/controlPanel';
import { formatSelectOptions } from '../../../legacy-preset-chart-deckgl/src/utilities/utils';

const lassoKindsControl = {
  name: 'lasso_point_kinds',
  config: {
    type: 'SelectControl',
    label: t('Lasso point kinds'),
    description: t(
      'Choose which point kinds can be selected by lasso. "courier" matches any kind containing "courier".',
    ),
    choices: [
      ['warehouse', t('warehouse')],
      ['courier', t('courier')],
      ['order', t('order')],
      ['service_zone', t('service_zone')],
    ],
    default: ['warehouse', 'courier', 'order', 'service_zone'],
    multi: true,
    freeForm: true,
    clearable: false,
    renderTrigger: true,
  },
};

const lassoPointFilterFieldControl = {
  name: 'lasso_point_filter_field',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Point filter field'),
    description: t(
      'GeoJSON properties key used for point filter values.',
    ),
    default: 'name',
    clearable: false,
    renderTrigger: true,
    choices: [['name', 'name']],
  },
};

const lassoLineFilterFieldControl = {
  name: 'lasso_line_filter_field',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Line filter field'),
    description: t(
      'GeoJSON properties key used for line filter values.',
    ),
    default: 'courier_name',
    clearable: false,
    renderTrigger: true,
    choices: [['courier_name', 'courier_name']],
  },
};

const labelOffsetXControl = {
  name: 'lasso_label_offset_x',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Label offset X'),
    description: t(
      'Horizontal offset of point labels in pixels. Positive moves right.',
    ),
    visibility: ({ form_data }: { form_data: QueryFormData }) =>
      !!form_data.enable_labels &&
      (!form_data.enable_label_javascript_mode ||
        !isFeatureEnabled(FeatureFlag.EnableJavascriptControls)),
    validators: [legacyValidateInteger],
    choices: formatSelectOptions([-32, -16, -8, 0, 8, 16, 32]),
    default: 8,
    renderTrigger: true,
    resetOnHide: false,
  },
};

const labelOffsetYControl = {
  name: 'lasso_label_offset_y',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Label offset Y'),
    description: t(
      'Vertical offset of point labels in pixels. Negative moves up.',
    ),
    visibility: ({ form_data }: { form_data: QueryFormData }) =>
      !!form_data.enable_labels &&
      (!form_data.enable_label_javascript_mode ||
        !isFeatureEnabled(FeatureFlag.EnableJavascriptControls)),
    validators: [legacyValidateInteger],
    choices: formatSelectOptions([-32, -16, -8, 0, 8, 16, 32]),
    default: 0,
    renderTrigger: true,
    resetOnHide: false,
  },
};

const labelAnchorControl = {
  name: 'lasso_label_anchor',
  config: {
    type: 'SelectControl',
    label: t('Label anchor'),
    description: t(
      'Horizontal anchor point of the label relative to its position.',
    ),
    visibility: ({ form_data }: { form_data: QueryFormData }) =>
      !!form_data.enable_labels &&
      (!form_data.enable_label_javascript_mode ||
        !isFeatureEnabled(FeatureFlag.EnableJavascriptControls)),
    choices: [
      ['start', t('Start')],
      ['middle', t('Middle')],
      ['end', t('End')],
    ],
    default: 'start',
    clearable: false,
    renderTrigger: true,
    resetOnHide: false,
  },
};

const pointRadiusControl = {
  name: 'lasso_point_radius',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Point Radius'),
    description: t(
      'The radius of point features, in the units specified below. The final rendered size is this value multiplied by Point Radius Scale.',
    ),
    validators: [validateInteger],
    default: 10,
    choices: formatSelectOptions([1, 5, 10, 20, 50, 100]),
    renderTrigger: true,
  },
};

const pointRadiusScaleControl = {
  name: 'lasso_point_radius_scale',
  config: {
    type: 'SelectControl',
    freeForm: true,
    label: t('Point Radius Scale'),
    description: t(
      'A multiplier applied to the point radius. Use this to uniformly scale all points.',
    ),
    validators: [validateNumber],
    default: 1,
    choices: formatSelectOptions([0.1, 0.5, 1, 2, 5, 10]),
    renderTrigger: true,
  },
};

const pointRadiusUnitsControl = {
  name: 'lasso_point_radius_units',
  config: {
    type: 'SelectControl',
    label: t('Point Radius Units'),
    description: t(
      'The unit for point radius. Use "pixels" for consistent screen-space sizing regardless of zoom level.',
    ),
    default: 'pixels',
    choices: [
      ['pixels', t('Pixels')],
      ['meters', t('Meters')],
      ['common', t('Common (unit per pixel at zoom 0)')],
    ],
    renderTrigger: true,
  },
};

const config: ControlPanelConfig = {
  ...geojsonControlPanel,
  controlPanelSections: [
    ...(geojsonControlPanel.controlPanelSections || []).map(section => {
      if (!section) {
        return section;
      }

      if (section.label !== t('GeoJson Settings')) {
        return section;
      }

      return {
        ...section,
        controlSetRows: [
          ...(section.controlSetRows || []),
          [pointRadiusControl, pointRadiusScaleControl],
          [pointRadiusUnitsControl],
          [labelOffsetXControl, labelOffsetYControl],
          [labelAnchorControl],
        ],
      };
    }),
    {
      label: t('Lasso Settings'),
      expanded: true,
      controlSetRows: [
        [lassoKindsControl],
        [lassoPointFilterFieldControl],
        [lassoLineFilterFieldControl],
      ],
    },
  ],
};

export default config;
