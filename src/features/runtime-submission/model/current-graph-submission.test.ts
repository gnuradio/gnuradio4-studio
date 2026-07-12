import { describe, expect, it } from 'vitest';
import { graphDocumentFromEditor } from '../../graph-document/model/fromEditor';
import { toGrctrlContentSubmission } from './toGrctrlPayload';
import { buildCurrentGraphSubmissionFromEditorSnapshot, buildCurrentSessionGraphSubmission } from './current-graph-submission';
import type { GraphDocument } from '../../graph-document/model/types';

describe('buildCurrentGraphSubmissionFromEditorSnapshot', () => {
  it('uses the same GraphDocument -> GRC serializer path as direct submission', () => {
    const snapshot = {
      metadata: {
        name: 'Example.gr4s',
        description: 'Example graph',
        studioPanels: [],
        studioVariables: [],
      },
      nodes: [
        {
          instanceId: 'node-1',
          blockTypeId: 'gr::testing::NullSource<float32>',
          displayName: 'Source',
          category: 'demo',
          parameters: {
            name: { value: 'source', bindingKind: 'literal' as const },
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };

    const helper = buildCurrentGraphSubmissionFromEditorSnapshot(snapshot);
    const direct = toGrctrlContentSubmission(graphDocumentFromEditor(snapshot));

    expect(helper).toEqual(direct);
  });

  it('preserves float-like literal text through editor import and runtime export', () => {
    const snapshot = {
      metadata: {
        name: 'Example.gr4s',
      },
      nodes: [
        {
          instanceId: 'node-1',
          blockTypeId: 'gr::blocks::math::Rotator<std::complex<float32>>',
          displayName: 'Rotator',
          category: 'demo',
          parameters: {
            sample_rate: { value: '20000000.0', bindingKind: 'literal' as const },
            phase_increment: { value: '0.5', bindingKind: 'literal' as const },
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    };

    const submission = buildCurrentGraphSubmissionFromEditorSnapshot(snapshot);

    expect(submission.content).toContain('sample_rate: 20000000.0');
    expect(submission.content).toContain('phase_increment: 0.5');
  });

  it('preserves authored transport for descriptor-adapted Studio blocks in current-session submissions', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: {
        name: 'Managed.gr4s',
      },
      graph: {
        nodes: [
          {
            id: 'series-1',
            blockType: 'gr::studio::StudioSeriesSink<complex<float32>>',
            position: { x: 0, y: 0 },
            parameters: {
              transport: { kind: 'literal', value: 'http_poll' },
              endpoint: { kind: 'literal', value: 'http://127.0.0.1:18080/snapshot' },
            },
          },
          {
            id: 'source-1',
            blockType: 'gr::testing::NullSource<float32>',
            position: { x: 10, y: 0 },
            parameters: {
              transport: { kind: 'literal', value: 'http_poll' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = buildCurrentSessionGraphSubmission(document);

    expect(submission.content).toContain('transport: http_poll');
    expect(submission.content).not.toContain('endpoint:');
    expect(submission.content).toContain('- id: "gr::testing::NullSource<float32>"');
    expect(document.graph.nodes[0]?.parameters.transport).toEqual({ kind: 'literal', value: 'http_poll' });
    expect(submission.content).toContain('- id: "gr::studio::StudioSeriesSink<complex<float32>>"');
  });
});
