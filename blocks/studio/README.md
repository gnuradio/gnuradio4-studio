# Studio Blocks Module

SPDX-License-Identifier: MIT

This folder hosts the Studio-specific GR4 block implementations.

Current constraints:

- exact fully qualified reflected block IDs are the Studio compatibility key
- data plane is owned by each block
- transport is explicit block configuration
- rendering behavior lives outside this module

Current included blocks:

- `StudioSeriesSink`
- `Studio2DSeriesSink`
- `StudioDataSetSink`
- `StudioPowerSpectrumSink`
- `StudioWaterfallSink`
- `StudioScalarSink`
- `StudioStatusSink`
- `StudioAudioSink`
- `StudioImageSink`

Notes:

- HTTP snapshot/poll semantics for series-style sinks should follow `HttpTimeSeriesSink` behavior where applicable.
- `StudioSeriesSink` exposes `n_inputs` independent dynamic input ports. Each input maps directly to one plotted series; it does not accept interleaved channels on a single input.
- `Studio2DSeriesSink` exposes generic XY `series2d-xy-json-v1` payloads and supports websocket transport using the same JSON frame contract as its HTTP snapshot path. Live cadence is controlled by `update_ms`; authored labels, render mode, ranges, and plot style are handled by Studio's generic XY renderer.
- `StudioDataSetSink` exposes `dataset-xy-json-v1` payloads (`layout: pairs_xy`) for DataSet-backed visualization paths.
- `StudioPowerSpectrumSink` also exposes `dataset-xy-json-v1` payloads and is intended for FFT-based averaged power spectrum visualization.
- `StudioPowerSpectrumSink` uses `fft_size`, `sample_rate`, and `center_freq` to define the x axis. It does not expose `x_min` / `x_max`; `autoscale=false` applies to the y axis through `y_min` / `y_max`.
- `StudioPowerSpectrumSink` with `persistence=true` uses the same `dataset-xy-json-v1` payload path, but the Studio UI renders it as a GQRX-style phosphor spectrum with a persistent glow behind the live trace. The phosphor look is tuned with `phosphor_intensity` and `phosphor_decay_ms`.
- `StudioWaterfallSink` exposes `waterfall-spectrum-json-v1` payloads and is intended for bounded FFT-history waterfall visualization.
- `StudioWaterfallSink` uses `time_span` together with `sample_rate` as the fixed depth controls and quantizes the resulting duration to the configured FFT size.
- `StudioWaterfallSink` emits the effective quantized `time_span` together with `sample_rate`.
- `StudioWaterfallSink` uses `autoscale`, `z_min`, and `z_max` to control the rendered colormap range.
- Waterfall rendering ignores generic `x_min` / `x_max` / `y_min` / `y_max` axis-range settings.
- `StudioPowerSpectrumSink` and `StudioWaterfallSink` expose `window` as `gr::algorithm::window::Type` so reflection can provide enum choices to the UI.
- `StudioScalarSink` and `StudioStatusSink` expose `scalar-status-json-v1` payloads for latest-value metric cards and status rows.
- `StudioScalarSink` and `StudioStatusSink` support only `http_poll` and `websocket`; endpoints are runtime descriptor-managed, not authored directly.
- `StudioAudioSink` exposes `audio-float32-binary-v1` websocket payloads for browser playback.

Native QA target:

- `qa_StudioSeriesSink`
- `qa_Studio2DSeriesSink`
- `qa_StudioPowerSpectrumSink`
- `qa_StudioWaterfallSink`
- `qa_StudioScalarSink`
- `qa_StudioAudioSink`

Notes:

- `qa_StudioPowerSpectrumSink` checks the exact `StudioPowerSpectrumSink` registration and its optional phosphor persistence metadata.

Grounded candidate commands based on the checked-in CMake layout:

1. Configure the blocks tree with testing enabled:
   - `cmake -S blocks -B build/blocks -DENABLE_TESTING=ON`
2. Build the native spectrum QA target:
   - `cmake --build build/blocks --target qa_StudioPowerSpectrumSink`
3. Build the native 2D series QA target:
   - `cmake --build build/blocks --target qa_Studio2DSeriesSink`
4. Build the native waterfall QA target:
   - `cmake --build build/blocks --target qa_StudioWaterfallSink`
5. Build the native scalar/status QA target:
   - `cmake --build build/blocks --target qa_StudioScalarSink`
6. Run the tests through CTest:
   - `ctest --test-dir build/blocks -R 'qa_Studio(2DSeries|PowerSpectrum|Waterfall|Scalar)Sink' --output-on-failure`

If your local build tree uses a different path or generator, keep the target name the same and adjust `build/blocks` accordingly.
