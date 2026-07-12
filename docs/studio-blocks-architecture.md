# Studio Blocks Architecture

This document describes the Studio-specific block architecture used by `gr4-studio`.

Current implementation lives in:

- `blocks/studio`
- `src/features/graph-editor/runtime/known-block-bindings.ts`
- `src/features/application/plotting/runtime/timeseries-live-runtime.ts`
- `src/features/runtime-session/model/runtime-binding-resolution.ts`
- `src/features/graph-editor/runtime/studio-managed-runtime-authoring.ts`

## Current Implemented Scope

The current descriptor-adapted stream slice is intentionally narrow.

Generic `session.streams[]` descriptor resolution is used in Studio for any known Studio block that has an authored stream export.

Current Studio behavior for descriptor-adapted bindings:

- current-session runtime connectivity is descriptor-driven from `session.streams[]` when available
- authored `transport` remains part of the Studio-side contract and must match the advertised stream transport
- authored `endpoint` is not part of the supported descriptor-driven runtime contract
- absent `streams[]` falls back to the legacy authored-endpoint path
- present-but-unusable `streams[]` fails explicitly instead of falling back to authored endpoint data
- authoring keeps `transport` visible
- authoring hides `endpoint` for descriptor-adapted current-session bindings that use runtime routes

Intentionally deferred:

- additional managed sink families
- schema removal of legacy `endpoint` fields
- generic transport UX/framework cleanup

## Purpose

`gr4-studio` ships first-party Studio-oriented GR4 runtime blocks in-tree.
The app recognizes those blocks by exact reflected block ID and binds them to Studio-specific UI behavior.

This architecture keeps three concerns separate:

- the block owns the data plane
- Studio owns binding and rendering policy
- the control plane stays minimal and session-focused

## Compatibility key

Studio compatibility is keyed by exact fully qualified reflected block ID.

Rules:

- exact ID match only
- no fuzzy matching
- no alias fallback
- no generic metadata assumption

## Current included families

- `StudioSeriesSink`
- `Studio2DSeriesSink`
- `StudioDataSetSink`
- `StudioPowerSpectrumSink`
- `StudioWaterfallSink`
- `StudioScalarSink`
- `StudioStatusSink`
- `StudioAudioSink`
- `StudioImageSink`

The code currently registers concrete type variants for each family, for example:

- `gr::studio::StudioSeriesSink<...>`
- `gr::studio::Studio2DSeriesSink<...>`
- `gr::studio::StudioDataSetSink<...>`
- `gr::studio::StudioPowerSpectrumSink<...>`
- `gr::studio::StudioWaterfallSink<...>`
- `gr::studio::StudioScalarSink<...>`
- `gr::studio::StudioStatusSink<...>`
- `gr::studio::StudioAudioSink<...>`
- `gr::studio::StudioImageSink<...>`

See `src/features/graph-editor/runtime/known-block-bindings.ts` for the exact reflected IDs currently enabled.

## Transport configuration

Transport is an explicit block parameter, typically `transport`.

Current supported transport modes for the included blocks:

- `http_snapshot`
- `http_poll`
- `websocket`

Reserved for future expansion:

- `zmq_sub`

Rules:

- each block family supports only a subset of valid transports
- do not assume all combinations are valid
- validate parameters locally, not authoritatively

Websocket transport currently exists for selected sinks only. Descriptor-adapted current-session bindings currently include `StudioSeriesSink`, `Studio2DSeriesSink`, `StudioPowerSpectrumSink`, `StudioWaterfallSink`, `StudioScalarSink`, `StudioStatusSink`, and `StudioAudioSink`. When adding websocket support to a new sink, follow the implementation checklist in `docs/studio-websocket-integration.md`.
For websocket-capable sinks, `update_ms` is the live cadence control used by the native send path.

## Standard parameters

The current registry resolves these parameter names where relevant:

- `transport`
- `endpoint`
- `poll_ms`
- `update_ms`
- `sample_rate`
- `channels`
- `topic`

Not every family uses every parameter. Parameter usage is explicit per block family.

## Data plane ownership

The block owns its data plane interface.

Implications:

- for descriptor-adapted current-session bindings, browser-facing routes come from `session.streams[]` when present
- legacy `endpoint` values may still persist in saved documents, but Studio does not use them for descriptor-driven runtime resolution
- Studio binds directly to the runtime-advertised interface when present
- control plane stays separate from payload semantics
- optional plot tag annotations are payload metadata owned by the producing sink/block, not a separate control-plane event API

## HTTP behavior

Where HTTP snapshot/polling is used, model behavior after `HttpTimeSeriesSink` from the GR4 incubator codebase.

## Binding and rendering

Studio binding resolves the block family and payload format.
Rendering is handled separately:

- `StudioSeriesSink` uses the live `series` renderer path for JSON snapshots and websocket frames
- `Studio2DSeriesSink` uses the `series2d-xy-json-v1` path for XY/vector rendering over HTTP snapshots and websocket frames
- `series2d-xy-json-v1` and `dataset-xy-json-v1` -> XY/vector plot path
- `series-window-json-v1`, `series2d-xy-json-v1`, and `dataset-xy-json-v1` may carry optional generic `tags[]` metadata. The renderer shows these as plot annotations without interpreting domain-specific tag keys.
- `StudioPowerSpectrumSink` uses the `dataset-xy-json-v1` path for FFT-based spectrum rendering
- `StudioPowerSpectrumSink` uses `sample_rate` for FFT-bin spacing and optional `center_freq` to offset the x axis from relative baseband Hz to absolute RF Hz
- `StudioPowerSpectrumSink` owns its x axis through FFT metadata and emitted frequency bins. It does not expose `x_min` / `x_max`; with `autoscale=false`, Studio applies only `y_min` / `y_max` to the rendered spectrum range.
- `StudioPowerSpectrumSink` with `persistence=true` also uses the `dataset-xy-json-v1` path, but routes to the phosphor spectrum renderer with a persistent glow behind the live trace. The phosphor look is tuned via `phosphor_intensity` and `phosphor_decay_ms`.
- `StudioWaterfallSink` uses the `waterfall-spectrum-json-v1` path for bounded FFT-history waterfall rendering
- `StudioWaterfallSink` uses `time_span` and `sample_rate` as the fixed waterfall depth controls and quantizes the resulting duration to the FFT size
- `StudioWaterfallSink` emits the effective quantized `time_span` together with `sample_rate`
- `StudioWaterfallSink` also carries `autoscale`, `z_min`, and `z_max` parameters that control the rendered waterfall colormap range
- Waterfall plots ignore the generic `x_min` / `x_max` / `y_min` / `y_max` axis-range parameters
- `StudioScalarSink` and `StudioStatusSink` use the `scalar-status-json-v1` path for latest-value metric cards and status rows
- `StudioScalarSink` and `StudioStatusSink` are descriptor-managed and support `http_poll` and `websocket`; `http_snapshot` is not a valid transport for these sinks
- `StudioAudioSink` is a playback-oriented sink and uses `audio-float32-binary-v1` over websocket
- image and audio panel kinds -> separate renderers

## Virtual Graph Routing

Studio supports editor-only virtual routing blocks modeled after GNU Radio Companion virtual source/sink usage:

- `studio::VirtualSink`
- `studio::VirtualSource`

These blocks are graph-document/editor constructs only. They are preserved in `.gr4s` documents, but they are removed before runtime `.gr4c` submission. Runtime export connects the real upstream edge of a matching `VirtualSink(stream_id=...)` directly to the real downstream edges of matching `VirtualSource(stream_id=...)` blocks.

Rules:

- `stream_id` must be a literal, non-empty route name.
- one virtual sink is allowed per `stream_id`.
- one or more virtual sources may consume a matching `stream_id`.
- a virtual source without a matching virtual sink is an error.
- a virtual sink without a matching virtual source is reported as a warning.
- legacy temporary ids `gr4-studio::VirtualSink` and `gr4-studio::VirtualSource` are normalized to the `studio::...` ids when graph documents are loaded.

Studio also supports an editor-only note block:

- `studio::Note`

The note block displays its `text` parameter directly on the graph canvas. It is preserved in `.gr4s` documents and omitted from runtime `.gr4c` submission.

## Display Application Lifecycle

The runtime display application can render in-app or as an application-only display route. The selected mode is persisted in graph document `metadata.application`.

Supported display modes:

- `in_app`: the main Studio center view shows the display as an **In-app** tab.
- `new_tab`: Studio launches `/app-runtime/:launchId` as a separate display client.
- `popout`: Studio launches `/app-runtime/:launchId` as a popup/window. In Electron this is a native `BrowserWindow`.

The display route is a runtime client, not an editor:

- it receives a launch snapshot with visible panel entries, layout, resolved bindings, and session id
- it does not own graph editor state
- it does not mark documents dirty
- closing it does not stop or delete the session
- parameter-bound controls write to the running session through block settings APIs
- variable-bound controls publish runtime override commands back to the owning Studio tab when launched from Studio; those overrides are per-session and are not saved as graph defaults

Use the main Studio runtime controls to stop or delete sessions. Use **Open Display** to reopen a display client for an already running linked session.

More detail: `docs/display-application-popout-plan.md`.

For manual waterfall validation, the repo also ships canonical fixture payloads under `public/demo/`:

- `waterfall-spectrum-json-v1.normal.json`
- `waterfall-spectrum-json-v1.smallest.json`
- `waterfall-spectrum-json-v1.malformed.json`
- `public/demo/phosphor-spectrum-demo.gr4s`

Payload details live in:

- `docs/studio-blocks-payload-contracts.md`
