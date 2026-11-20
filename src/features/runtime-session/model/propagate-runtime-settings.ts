import type { BlockDetails } from '../../../lib/api/block-details';
import { setBlockSettings, type RuntimeSettingsObject } from '../../../lib/api/block-settings';
import { editorNodeIdentity, type EditorGraphNode } from '../../graph-editor/model/types';
import { shouldPropagateResolvedRuntimeSetting } from '../../inspector/runtime-settings-model';
import type { ResolvedGraphVariables } from '../../variables/model/resolveGraphVariables';

export async function propagateRuntimeSettings({
  sessionId,
  submittedNodeIdentities,
  nodes,
  blockDetailsByType,
  parametersByNodeId,
}: {
  sessionId: string;
  submittedNodeIdentities: ReadonlyMap<string, symbol>;
  nodes: readonly EditorGraphNode[];
  blockDetailsByType: ReadonlyMap<string, BlockDetails>;
  parametersByNodeId: ResolvedGraphVariables['parametersByNodeId'];
}): Promise<void> {
  const requests = nodes.flatMap((node) => {
    // The same editor ID can now belong to a different block than the one submitted.
    const identity = node[editorNodeIdentity];
    if (!identity || submittedNodeIdentities.get(node.instanceId) !== identity) {
      return [];
    }

    const blockDetails = blockDetailsByType.get(node.blockTypeId);
    const resolvedParameters = parametersByNodeId[node.instanceId];
    if (!blockDetails || !resolvedParameters) {
      return [];
    }

    const patch: RuntimeSettingsObject = {};
    for (const parameter of blockDetails.parameters) {
      const resolved = resolvedParameters[parameter.name];
      if (
        parameter.readOnly || !parameter.mutable ||
        resolved?.state !== 'resolved' || resolved.value === undefined ||
        !shouldPropagateResolvedRuntimeSetting({ name: parameter.name, bindingKind: resolved.binding.kind })
      ) {
        continue;
      }
      patch[parameter.name] = resolved.value;
    }

    return Object.keys(patch).length > 0 ? [setBlockSettings(sessionId, node.instanceId, patch, 'staged')] : [];
  });

  await Promise.all(requests);
}
