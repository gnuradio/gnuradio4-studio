# Studio Blocks Payload Contracts

This document describes the payload shapes used by the Studio block rendering paths in `gr4-studio`.

Related architecture doc:

- `docs/studio-blocks-architecture.md`

## Scope

- scalar series payload
- latest scalar/status payload
- `series2d-xy-json-v1`
- `dataset-xy-json-v1`
- phosphor spectrum rendering on top of `dataset-xy-json-v1` via `StudioPowerSpectrumSink` with `persistence=true` and phosphor tuning via `phosphor_intensity` / `phosphor_decay_ms`
- `waterfall-spectrum-json-v1`
- `audio-float32-binary-v1`

Non-goals:

- FFT-specific UI semantics
- control-plane transport redesign
- layout/editor-owned plot semantics

## Design rules

- UI routes by sink contract shape (`payloadFormat`), not DSP block identity.
- Runtime/parser layer owns payload validation and normalization.
- Renderer adapters receive only normalized plot frames.
- Plot metadata precedence is explicit and stable.

## Scalar series contract

`series-window-json-v1`

Expected payload fields:

- `sample_type` required, string
- `layout` required, string
- `data` required, array of per-channel arrays
- `channels` optional, number
- `samples_per_channel` optional, number
- `tags` optional, array of generic plot tag annotations; see Optional Plot Tags below
- `max_labels` block parameter optional, maximum number of visible tag labels, defaults to `100`; marker lines/points still render when labels are capped

Semantics:

- `data` is channel-major series payload.
- Real scalar payloads normalize to one plotted series per logical channel.
- Complex scalar payloads normalize to two plotted series per logical channel:
  - `<base> (real)`
  - `<base> (imag)`
- Magnitude-only collapse is not the default normalization.

Frontend routing:

- `payloadFormat=series-window-json-v1` routes to the scalar timeseries parser, regardless of whether the sink is served over `http_snapshot`, `http_poll`, or websocket transport.

## Vector XY contract

`series2d-xy-json-v1`

Expected payload fields:

- `layout` required, must be `pairs_xy`
- `points` required, non-negative integer
- `data` required, array of numeric `[x,y]` pairs, length must equal `points`
- `sample_type` optional, string
- `render_mode` optional, `line | scatter`, defaults to `line`
- `point_size` optional, positive number
- `point_alpha` optional, number in `[0,1]`
- `tags` optional, array of generic plot tag annotations; see Optional Plot Tags below
- `max_labels` block parameter optional, maximum number of visible tag labels, defaults to `100`; marker lines/points still render when labels are capped

Semantics:

- One XY trace represented by explicit x/y pairs.
- `render_mode=scatter` enables constellation-style XY rendering without a new plot kind.
- Authored `x_label`, `y_label`, and `series_labels` metadata take precedence over payload metadata and defaults.
- When labels are not authored, `Studio2DSeriesSink` panels use generic `x` / `y` axis labels. Spectrum-like dataset, histogram, and waterfall panels retain `Frequency` / `Power` defaults.
- `autoscale=false` with `x_min`/`x_max` and `y_min`/`y_max` sets manual XY ranges for `Studio2DSeriesSink` panels.

Frontend routing:

- `payloadFormat=series2d-xy-json-v1` routes to the vector XY parser, regardless of whether the sink is served over `http_snapshot`, `http_poll`, or websocket transport.
- `Studio2DSeriesSink` is descriptor-managed when session stream descriptors are present. Browser-facing endpoints come from `session.streams[]`; authored legacy `endpoint` values are hidden from current authoring and omitted from runtime export.

## Optional Plot Tags

`series-window-json-v1`, `series2d-xy-json-v1`, and `dataset-xy-json-v1` payloads may include generic sparse annotations:

```json
{
  "tags": [
    {
      "offset": 123,
      "key": "threshold_crossing",
      "value": true,
      "label": "threshold_crossing",
      "metadata": {
        "confidence": 0.93
      }
    }
  ]
}
```

Tag fields:

- `key` required, non-empty string
- `offset` optional, finite numeric sample offset or frame-local point index
- `x` optional, finite plot x coordinate
- `y` optional, finite plot y coordinate for point annotations
- `value` optional, string, number, boolean, or null
- `label` optional, display string; defaults to `key`
- `metadata` optional, object with string, number, boolean, or null values

Rules:

- `tags` is optional; plots without tags render unchanged.
- A tag must include either `offset` or `x`.
- The frontend currently renders offset/x-only tags as vertical plot markers.
- Tags with both `x` and `y` render as point annotations on XY/scatter plots.
- The frontend bounds each payload to the first 64 tags and labels up to `max_labels` visible markers to limit clutter.
- Start/end span pairing is intentionally deferred; producers may still emit start/end tags as separate generic markers.
- `StudioSeriesSink` extracts recent GNU Radio stream tags from its input span and emits visible-window tags from block-owned data-plane state.
- Other producers that support stream tags should use the same optional field without adding control-plane APIs.

## Latest Scalar/Status Contract

`scalar-status-json-v1`

Expected payload fields:

- `payload_format` required, must be `scalar-status-json-v1`
- `layout` required, must be `latest_scalars`
- `sample_type` optional, normally `float32`
- `presentation` optional, `scalar | status`
- `channels` required, positive integer
- `sequence` optional, monotonically increasing integer
- `has_value` required, boolean
- `labels` required, array of display labels, one per channel when available
- `units` required, array of unit labels, one per channel when available
- `values` required, numeric latest-value array

Example:

```json
{
  "payload_format": "scalar-status-json-v1",
  "sample_type": "float32",
  "layout": "latest_scalars",
  "presentation": "scalar",
  "channels": 2,
  "sequence": 42,
  "has_value": true,
  "labels": ["Quality", "Locked"],
  "units": ["", ""],
  "values": [0.91, 1]
}
```

Semantics:

- `StudioScalarSink<float32>` and `StudioStatusSink<float32>` both publish this contract.
- Input samples are interleaved by channel; each complete frame replaces the latest value for all channels.
- Non-finite values are emitted as `0`.
- `StudioScalarSink` is intended for compact latest-value metric cards.
- `StudioStatusSink` is intended for latest-value status rows.
- `has_value=false` means no complete scalar frame has arrived yet; the frontend should not render placeholder zeroes as live data.

Frontend routing:

- `payloadFormat=scalar-status-json-v1` routes to the scalar/status renderer, not to a scrolling plot.
- `StudioScalarSink` and `StudioStatusSink` are descriptor-managed sinks. Browser-facing endpoints come from `session.streams[]`.
- Authored legacy `endpoint` values are ignored/omitted by current runtime export for these sinks.
- Supported transports are `http_poll` and `websocket`; `http_snapshot` is intentionally not supported.

## Dataset XY contract

`dataset-xy-json-v1`

Expected payload fields:

- `payload_format` required, must be `dataset-xy-json-v1`
- `layout` required, must be `pairs_xy`
- `points` required, non-negative integer
- `data` required, array of numeric `[x,y]` pairs, length must equal `points`
- `signal_name` optional, string
- `signal_unit` optional, string
- `axis_name` optional, string
- `axis_unit` optional, string
- `sample_rate` optional, positive number in Hz when emitted by spectrum-producing sinks
- `center_freq` optional, number in Hz added to relative FFT bin frequencies when emitted by `StudioPowerSpectrumSink`
- `tags` optional, array of generic plot tag annotations; see Optional Plot Tags above

Semantics:

- DataSet semantics remain sink/runtime-side.
- Payload normalizes to one XY trace for plotting.
- `StudioPowerSpectrumSink` uses this contract to publish FFT frequency bins against averaged power values.
- `StudioPowerSpectrumSink` uses `sample_rate` to space FFT bins and `center_freq` to offset those bins onto an absolute RF frequency axis. With `center_freq=0`, the x axis remains relative baseband frequency.
- `StudioPowerSpectrumSink` does not use `x_min` / `x_max`; the emitted frequency bins define the x axis. When `autoscale=false`, Studio applies `y_min` / `y_max` to the rendered power range.
- `StudioPowerSpectrumSink` with `persistence=true` uses the same contract to publish FFT frequency bins for the live phosphor spectrum renderer. Its phosphor look is controlled by `phosphor_intensity` and `phosphor_decay_ms`.

Frontend routing:

- `payloadFormat=dataset-xy-json-v1` routes to the dataset XY parser, then into the existing vector XY rendering path.
- `StudioPowerSpectrumSink` with `persistence=true` routes through the same dataset parser, then into the GQRX-style phosphor spectrum renderer. The phosphor panel reads `phosphor_intensity` and `phosphor_decay_ms` from the block parameters.

## Audio Float32 Binary Contract

`audio-float32-binary-v1`

Expected transport:

- WebSocket binary frames
- one complete audio packet per WebSocket message

Header layout, little-endian:

- `magic`: `uint32`, ASCII `"SAUD"` as little-endian `0x44554153`
- `version`: `uint16`, currently `1`
- `flags`: `uint16`, currently `0`
- `channels`: `uint16`, interleaved channel count
- `sample_type`: `uint16`, currently `1` for float32
- `sample_rate`: `uint32`, Hz
- `frames`: `uint32`, sample frames per channel in this packet
- `sequence`: `uint64`, monotonically increasing packet sequence
- `timestamp_ns`: `uint64`, producer timestamp in nanoseconds
- `payload`: `float32[frames * channels]`, interleaved by frame

Semantics:

- Samples are normalized float audio, normally in `[-1, 1]`.
- Non-finite values are emitted as `0`.
- The initial native sink clamps samples to `[-1, 1]` when `clip=true`.
- The frontend audio runtime should validate sequence continuity and surface gaps as underrun/stall indicators.

Frontend routing:

- `payloadFormat=audio-float32-binary-v1` routes to the audio WebSocket parser and browser playback engine.
- Playback uses a browser-owned clock; received frames are buffered for an `AudioWorklet` renderer rather than plotted.

## Waterfall spectrum contract

`waterfall-spectrum-json-v1`

Expected payload fields:

- `payload_format` required, must be `waterfall-spectrum-json-v1`
- `layout` required, must be `waterfall_matrix`
- `rows` required, non-negative integer
- `columns` required, non-negative integer
- `data` required, array of row arrays, each row length must equal `columns`
- `frequencies` optional, numeric array of bin centers, length must equal `columns` when present
- `sample_type` optional, string
- `signal_name` optional, string
- `signal_unit` optional, string
- `axis_name` optional, string
- `axis_unit` optional, string
- `fft_size` optional, positive integer
- `num_averages` optional, positive integer
- `time_span` required, positive number in seconds and quantized to `fft_size` together with `sample_rate`
- `sample_rate` required, positive number in Hz
- `history_rows` optional, derived row-count metadata preserved for compatibility
- `window` optional, string
- `output_in_db` optional, boolean
- `autoscale` optional, boolean
- `z_min` / `z_max` optional, numeric manual colormap bounds used when autoscale is disabled
- `min_value` / `max_value` optional, numeric normalization hints for the effective color range

Semantics:

- Bounded waterfall history is represented as a frequency-by-time matrix.
- `time_span` and `sample_rate` control the fixed waterfall depth on the y axis; the block quantizes the resulting duration to the configured FFT size before emitting rows.
- Unfilled history rows are emitted at the current color-range floor so they render black, but autoscale continues to use only real spectrum rows.
- The browser normalizes the matrix into a waterfall image frame.
- The block owns the bounded history and acts as the source of truth for the visualized window.
- The block also owns the color scale range:
  - when `autoscale` is true, it derives `min_value` / `max_value` from the live data
  - when `autoscale` is false, it uses `z_min` / `z_max` as the color range and mirrors that range back through `min_value` / `max_value`
- Waterfall plots do not use `x_min` / `x_max` / `y_min` / `y_max`; those ranges are reserved for non-waterfall plot kinds.
- The payload emits the effective quantized `time_span` and `sample_rate` used for the raster size.

Frontend routing:

- `payloadFormat=waterfall-spectrum-json-v1` routes to the waterfall parser, then into the waterfall canvas renderer.

Canonical fixtures:

- `src/features/application/plotting/runtime/fixtures/waterfall-contract-fixtures.ts`
- `public/demo/waterfall-spectrum-json-v1.normal.json`
- `public/demo/waterfall-spectrum-json-v1.smallest.json`
- `public/demo/waterfall-spectrum-json-v1.malformed.json`
- `public/demo/waterfall-demo.gr4s`

Phosphor spectrum validation uses the same `dataset-xy-json-v1` contract as `StudioPowerSpectrumSink` with `persistence=true`; the demo graph is `public/demo/phosphor-spectrum-demo.gr4s`.

These fixtures are used by the TS contract tests and provide canonical payload references for manual payload inspection.

## Metadata precedence

For displayed plot labels:

1. Explicit graph/block plot metadata params (`series_labels`, `x_label`, `y_label`, `plot_title`, etc.)
2. Sink payload metadata
3. Stable defaults (`chN`, `vector`, `sample`, `value`)

Layout metadata never owns these semantics.

## Current implementation map

- Contract routing: `src/features/application/plotting/runtime/timeseries-live-runtime.ts`
- Scalar parser: `src/features/graph-editor/runtime/http-time-series.ts`
- Vector/dataset parser: `src/features/application/plotting/runtime/vector-frame.ts`
- Scalar/status renderer: `src/features/workspace/renderers/scalar-status-live-renderer.tsx`
- Plot metadata precedence: `src/features/application/plotting/model/panel-spec.ts`
- Visible-state derivation: `src/features/application/plotting/components/plot-visible-state.ts`

## Failure behavior

Validation failures are explicit and deterministic:

- missing required fields -> error
- wrong type/shape -> error
- unsupported layout/format tokens -> error

Runtime surface behavior:

- malformed payloads become runtime error state with actionable message
- invalid binding remains a separate invalid-binding state

Manual validation path:

1. Run the Studio dev server.
2. Open `public/demo/waterfall-demo.gr4s` in Studio.
3. Run the graph with the default waterfall endpoint settings.
4. Confirm the waterfall panel renders and scrolls.
5. Hover the waterfall to verify the readout updates.
6. To verify manual color scaling, set `autoscale=false` and adjust `z_min` / `z_max` on the sink, then confirm the waterfall colors change on the next poll.
7. To verify fixed history depth, adjust `time_span` on the sink together with `sample_rate` and confirm the waterfall keeps a fixed row count quantized to the FFT size.
8. Use the TS fixtures above to inspect the exact payload shape and error cases outside the runtime path if needed.
