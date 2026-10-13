import { describe, expect, it } from 'vitest';
import type { BlockCatalogItem } from '../../lib/api/blocks';
import {
  abbreviateTypeExpr,
  buildCategoryTree,
  collectCategoryPaths,
  deriveNamespaceCategoryPath,
  normalizeCategoryPath,
  parseTypeId,
} from './catalog-tree';

function makeBlock(overrides: Partial<BlockCatalogItem>): BlockCatalogItem {
  return {
    blockTypeId: 'gr::basic::SignalGenerator<float32>',
    displayName: 'SignalGenerator<float32>',
    category: 'basic',
    description: '',
    inputs: [],
    outputs: [],
    parameters: [],
    ...overrides,
  };
}

describe('catalog tree helpers', () => {
  it('derives namespace category paths from reflected block ids', () => {
    expect(deriveNamespaceCategoryPath('gr::incubator::analog::QuadratureDemod')).toBe(
      'incubator/analog',
    );
    expect(deriveNamespaceCategoryPath('gr::basic::SignalGenerator<float32>')).toBe('basic');
    expect(deriveNamespaceCategoryPath('ClockSource')).toBe('uncategorized');
  });

  it('falls back to namespace category path when backend category is malformed', () => {
    const noisy = makeBlock({
      blockTypeId: 'gr::basic::ClockSource<uint8, std::chrono::nanoseconds>',
      category: 'basic/ClockSource<uint8, std::chrono::nanoseconds>',
    });

    expect(normalizeCategoryPath(noisy)).toBe('basic');
  });

  it('derives the catalog category from the reflected block id', () => {
    const block = makeBlock({
      blockTypeId: 'gr::incubator::http::HttpTimeSeriesSink<float32>',
      category: 'incubator/http',
    });

    expect(normalizeCategoryPath(block)).toBe('incubator/http');
  });

  it('ignores drawable ui categories like Content when grouping blocks', () => {
    const block = makeBlock({
      blockTypeId: 'gr::testing::ImChartMonitor<float32>',
      category: 'Content',
    });

    expect(normalizeCategoryPath(block)).toBe('testing');
  });

  it('parses family name and first template variant label', () => {
    const parsed = parseTypeId(
      'gr::basic::StreamFilterImpl<pmtcomplex<float32>, true, gr::trigger::BasicTriggerNameCtxMatcher>',
    );

    expect(parsed.familyName).toBe('StreamFilterImpl');
    expect(parsed.variantLabel).toBe('<pmtcomplex<float32>>');
  });

  it('builds nested category tree nodes from slash-delimited categories', () => {
    const tree = buildCategoryTree([
      makeBlock({
        blockTypeId: 'gr::incubator::analog::QuadratureDemod<float32>',
        displayName: 'QuadratureDemod<float32>',
        category: 'incubator/analog',
      }),
      makeBlock({
        blockTypeId: 'gr::incubator::http::HttpTimeSeriesSink<float32>',
        displayName: 'HttpTimeSeriesSink<float32>',
        category: 'incubator/http',
      }),
    ]);

    const incubator = tree.children.get('incubator');
    expect(incubator).toBeDefined();
    expect(Array.from(incubator?.children.keys() ?? [])).toEqual(['analog', 'http']);
    expect(incubator?.children.get('analog')?.types.has('QuadratureDemod')).toBe(true);
    expect(incubator?.children.get('http')?.types.has('HttpTimeSeriesSink')).toBe(true);
  });

  it('collects nested category paths for expand/collapse controls', () => {
    const tree = buildCategoryTree([
      makeBlock({
        blockTypeId: 'gr::incubator::analog::QuadratureDemod<float32>',
        displayName: 'QuadratureDemod<float32>',
        category: 'incubator/analog',
      }),
      makeBlock({
        blockTypeId: 'gr::basic::SignalGenerator<float32>',
        displayName: 'SignalGenerator<float32>',
        category: 'basic',
      }),
    ]);

    expect(collectCategoryPaths(tree)).toEqual(['basic', 'incubator', 'incubator/analog']);
  });

  it('abbreviates variant type expressions', () => {
    expect(abbreviateTypeExpr('float32')).toBe('f32');
    expect(abbreviateTypeExpr('std::complex<float>')).toBe('c<f32>');
    expect(abbreviateTypeExpr('pmtcomplex<float32>')).toBe('c<f32>');
    expect(abbreviateTypeExpr('gr::DataSet<float32>')).toBe('DataSet<f32>');
  });
});
