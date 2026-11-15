# Studio examples

Open a `.gr4s` file, press **Run**, and select **In-app**. These graphs generate their own signals and need no hardware.

| Flowgraph | Displays | Live controls |
| --- | --- | --- |
| [Waterfall](studio-blocks-waterfall.gr4s) | Pulsed FM and band-limited noise; spectrum and burst envelope | Pulse rate, noise amplitude |
| [Sidebands](studio-blocks-sidebands.gr4s) | AM, pulsed interference, and spectrum persistence | Modulation and interferer frequencies |
| [XY](studio-blocks-xy.gr4s) | Slowly changing Lissajous trace, points, and X/Y waveforms | Y frequency and phase |
| [QPSK](studio-blocks-qpsk.gr4s) | Transmitted and recovered constellations; pulse-shaped spectrum | Noise power, carrier offset |
| [Filter](studio-blocks-filter.gr4s) | Input/output spectra, waveforms, and a linear FFT DataSet | Edit filter edges in block properties |
| [Audio](studio-blocks-audio.gr4s) | Three-tone chord, waveform, and spectrum | Third and fifth frequencies; playback in the audio panel |

- Each graph shares a `sample_rate` variable. Signal generators use one sample clock; QPSK uses a throttle after pulse shaping.
- Waterfall fills eight seconds of history: 256 rows with 32 Hz frequency bins.
- QPSK uses four samples/symbol and 0.35-rolloff pulse-shaping taps. Carrier offset is in cycles/sample: `0.0001` is 0.8192 Hz at the default rate. Allow a few seconds for recovery.
- Live controls affect the current run. Edit block properties and save to change starting values.
- Arrange panels in **Layout Editor** and save the graph to retain the layout. Resizing the running display is temporary.

[fm_radio_mono.gr4s](fm_radio_mono.gr4s) requires SDR hardware.
