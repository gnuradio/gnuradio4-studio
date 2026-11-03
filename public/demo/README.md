# Demo Assets

This folder holds payload fixtures for manual validation of Studio features. Demo graphs live in `examples/`.

## Waterfall demo graph

- [`examples/waterfall-demo.gr4s`](../../examples/waterfall-demo.gr4s)

What it demonstrates:

- a minimal `SignalGenerator<float32> -> StudioWaterfallSink<float32>` graph
- waterfall live rendering
- fixed waterfall depth driven by `time_span` and `sample_rate`
- a deterministic starting point for live waterfall validation in Studio

## Phosphor spectrum demo graph

- [`examples/phosphor-spectrum-demo.gr4s`](../../examples/phosphor-spectrum-demo.gr4s)

What it demonstrates:

- a minimal `SignalGenerator<float32> -> StudioPowerSpectrumSink<float32>` graph with `persistence=true`
- phosphor tuning via `phosphor_intensity` and `phosphor_decay_ms`
- power-spectrum live rendering
- a crisp live spectrum trace with a colored persistent glow behind it
- a deterministic starting point for live phosphor-spectrum validation in Studio
- it reuses the same `dataset-xy-json-v1` payload contract as `StudioPowerSpectrumSink`
- the x axis comes from FFT metadata and payload bins; `autoscale=false` uses `y_min` / `y_max`

Canonical payload fixtures are shared with the power spectrum path because the payload contract is the same.

## Canonical waterfall fixtures

- `waterfall-spectrum-json-v1.normal.json` - normal payload reference
- `waterfall-spectrum-json-v1.smallest.json` - smallest valid payload reference
- `waterfall-spectrum-json-v1.malformed.json` - malformed payload reference for parser error checks

Phosphor spectrum uses the same dataset XY contract as the power spectrum sink, so the demo graph is the main manual-validation entry point for that view.

## Quickest validation path

1. Start Studio with `npm run dev`.
2. Open `examples/phosphor-spectrum-demo.gr4s` for the phosphor spectrum view or `examples/waterfall-demo.gr4s` for the waterfall view.
3. Run the graph.
4. Confirm the panel appears and responds to hover.
5. For the phosphor spectrum, check that the current line stays crisp while old energy glows behind it.
6. Adjust `phosphor_intensity` and `phosphor_decay_ms` to change how brightly and how long the phosphor field persists.
7. For the power spectrum, set `autoscale=false` and adjust `y_min` / `y_max`.
8. For the waterfall, set `autoscale=false` and adjust `z_min` / `z_max`, then adjust `time_span` and `sample_rate` to verify fixed depth.

## Native QA pointers

The native QA targets are:

- `qa_StudioPowerSpectrumSink`
- `qa_StudioWaterfallSink`

`qa_StudioPowerSpectrumSink` covers the exact `StudioPowerSpectrumSink` registration and its optional persistence metadata.

Grounded candidate commands based on the checked-in CMake layout:

1. `cmake -S blocks -B build/blocks -DENABLE_TESTING=ON`
2. `cmake --build build/blocks --target qa_StudioPowerSpectrumSink`
3. `cmake --build build/blocks --target qa_StudioWaterfallSink`
4. `ctest --test-dir build/blocks -R 'qa_Studio(PowerSpectrum|Waterfall)Sink' --output-on-failure`

## More detail

See the main repository docs for the full manual validation workflow and payload contract notes:

- [`README.md`](../../README.md)
- [`docs/studio-blocks-payload-contracts.md`](../../docs/studio-blocks-payload-contracts.md)
