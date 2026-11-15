import { describe, expect, it } from 'vitest';
import {
  coerceBlockPropertyLiteralValue,
  getBlockParameterEnumTypeLabel,
  getBlockParameterHoverTitle,
  getBlockParameterTypeLabel,
  isBooleanBlockParameter,
} from './block-properties-modal';
import {
  getAuthoringParameterLabel,
  isDescriptorBindingHiddenParameter,
} from '../graph-editor/runtime/studio-managed-runtime-authoring';

describe('coerceBlockPropertyLiteralValue', () => {
  it('preserves float-like text as text', () => {
    expect(coerceBlockPropertyLiteralValue('20000000.0')).toBe('20000000.0');
  });

  it('preserves other non-special literal text verbatim', () => {
    expect(coerceBlockPropertyLiteralValue(' 1.25 ')).toBe(' 1.25 ');
  });

  it('still coerces boolean and null literals', () => {
    expect(coerceBlockPropertyLiteralValue('true')).toBe(true);
    expect(coerceBlockPropertyLiteralValue('false')).toBe(false);
    expect(coerceBlockPropertyLiteralValue('null')).toBeNull();
  });

  it('identifies boolean parameters and exposes compact metadata labels', () => {
    expect(
      isBooleanBlockParameter({
        name: 'enabled',
        label: 'Enabled',
        valueKind: 'scalar',
        valueType: 'bool',
        mutable: true,
        readOnly: false,
      }),
    ).toBe(true);
    expect(
      isBooleanBlockParameter({
        name: 'mode',
        label: 'Mode',
        valueKind: 'enum',
        mutable: true,
        readOnly: false,
      }),
    ).toBe(false);

    expect(
      getBlockParameterTypeLabel({
        name: 'mode',
        label: 'Mode',
        valueKind: 'enum',
        mutable: true,
        readOnly: false,
      }),
    ).toBe('enum');
    expect(
      getBlockParameterTypeLabel({
        name: 'gain',
        label: 'Gain',
        valueKind: 'scalar',
        valueType: 'float',
        mutable: true,
        readOnly: false,
      }),
    ).toBe('float');
    expect(
      getBlockParameterHoverTitle({
        name: 'gain',
        label: 'Gain',
        description: 'Amplifier gain in dB.',
        valueKind: 'scalar',
        mutable: true,
        readOnly: false,
      }),
    ).toBe('Amplifier gain in dB.');
  });

  it('exposes enum type hints', () => {
    expect(
      getBlockParameterEnumTypeLabel({
        name: 'mode',
        label: 'Mode',
        valueKind: 'enum',
        enumType: 'MyEnum',
        mutable: true,
        readOnly: false,
      }),
    ).toBe('MyEnum');
  });

  it('hides endpoint from descriptor-based Studio block authoring surfaces', () => {
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioSeriesSink<float32>', 'endpoint')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::Studio2DSeriesSink<float32>', 'endpoint')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioPowerSpectrumSink<float32>', 'endpoint')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioWaterfallSink<float32>', 'endpoint')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioAudioSink<float32>', 'endpoint')).toBe(true);
    expect(getAuthoringParameterLabel('gr::studio::StudioSeriesSink<float32>', 'endpoint', 'Endpoint')).toBe('Address');
  });

  it('keeps unsupported families unchanged', () => {
    expect(isDescriptorBindingHiddenParameter('gr::blocks::NullSink<float32>', 'endpoint')).toBe(false);
    expect(getAuthoringParameterLabel('gr::blocks::NullSink<float32>', 'endpoint', 'Endpoint')).toBe('Endpoint');
  });
});
