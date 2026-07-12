# Studio-Compatible GR4 Blocks

SPDX-License-Identifier: MIT

This directory contains the first-party Studio-compatible GR4 runtime blocks that ship with `gr4-studio`.

Current families in `blocks/studio`:

- `StudioSeriesSink`
- `Studio2DSeriesSink`
- `StudioDataSetSink`
- `StudioPowerSpectrumSink`
- `StudioWaterfallSink`
- `StudioScalarSink`
- `StudioStatusSink`
- `StudioAudioSink`
- `StudioImageSink`

Transport support is block-specific. Current modes used by the included blocks are:

- `http_snapshot`
- `http_poll`
- `websocket`

Spectrum and waterfall sinks expose FFT window selection through reflected enum metadata so Studio can render dropdown controls.

Studio series, 2D series, spectrum, waterfall, scalar/status, and audio sinks use runtime-managed stream descriptors for Studio browser-facing endpoints when session stream descriptors are available. Scalar/status sinks support only `http_poll` and `websocket`.

`StudioSeriesSink` uses `n_inputs` to expose independent dynamic input ports, with one plotted series per input.

## License

The contents of this `blocks/` directory are licensed under the MIT License. See `LICENSE`.

Binding and payload conventions are documented in:

- `docs/studio-blocks-architecture.md`
- `docs/studio-blocks-payload-contracts.md`
