// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>

#include <gnuradio-4.0/studio/StudioHttpSnapshot.hpp>
#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

#include <algorithm>
#include <array>
#include <bit>
#include <chrono>
#include <condition_variable>
#include <cctype>
#include <cmath>
#include <complex>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <deque>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include <gnuradio-4.0/algorithm/fourier/fft.hpp>
#include <gnuradio-4.0/algorithm/fourier/fft_common.hpp>
#include <gnuradio-4.0/algorithm/fourier/window.hpp>

namespace gr::studio {

namespace detail {

enum class PowerSpectrumTransport {
    http_poll,
    websocket,
};

template<typename T>
concept SupportedPowerSpectrumSample = std::same_as<T, float> || std::same_as<T, std::complex<float>>;

template<typename T>
void appendLittleEndian(std::string& out, T value) {
    static_assert(std::is_integral_v<T> || std::is_floating_point_v<T>);
    if constexpr (std::is_floating_point_v<T>) {
        if constexpr (sizeof(T) == sizeof(std::uint32_t)) {
            appendLittleEndian(out, std::bit_cast<std::uint32_t>(value));
        } else if constexpr (sizeof(T) == sizeof(std::uint64_t)) {
            appendLittleEndian(out, std::bit_cast<std::uint64_t>(value));
        } else {
            static_assert(sizeof(T) == sizeof(std::uint32_t) || sizeof(T) == sizeof(std::uint64_t));
        }
    } else {
        using Unsigned = std::make_unsigned_t<T>;
        const Unsigned raw = static_cast<Unsigned>(value);
        for (std::size_t index = 0UZ; index < sizeof(T); ++index) {
            out.push_back(static_cast<char>((raw >> (8UZ * index)) & static_cast<Unsigned>(0xFFU)));
        }
    }
}


template<SupportedPowerSpectrumSample T>
class PowerSpectrumWindow {
public:
    using value_type = float;
    using complex_type = std::complex<value_type>;
    using fft_type = gr::algorithm::FFT<T, complex_type>;

    void configure(
        std::size_t fft_size,
        std::size_t num_averages,
        float sample_rate,
        float center_freq,
        std::uint32_t update_ms,
        gr::algorithm::window::Type window,
        bool output_in_db,
        bool persistence_enabled,
        float phosphor_intensity,
        float phosphor_decay_ms,
        bool autoscale_enabled,
        float y_min,
        float y_max) {
        std::lock_guard lock(_mutex);
        _fftSize = std::max<std::size_t>(1UZ, fft_size);
        _numAverages = std::max<std::size_t>(1UZ, num_averages);
        _sampleRate = sample_rate > 0.0F ? sample_rate : 1.0F;
        _centerFreq = center_freq;
        _updateMs = update_ms;
        _windowType = window;
        _windowName = std::string(magic_enum::enum_name(window));
        _outputInDb = output_in_db;
        _persistenceEnabled = persistence_enabled;
        _phosphorIntensity = phosphor_intensity;
        _phosphorDecayMs = phosphor_decay_ms;
        _autoscale = autoscale_enabled;
        _yMin = y_min;
        _yMax = y_max;

        _window.assign(_fftSize, value_type{});
        gr::algorithm::window::create(_window, _windowType);

        _fftInput.assign(_fftSize, T{});
        _fftOutput.assign(_fftSize, complex_type{});
        _currentSpectrum.assign(_spectrumSize(), value_type{});
        _spectrumSum.assign(_spectrumSize(), value_type{});
        _averagedSpectrum.assign(_spectrumSize(), value_type{});
        _frequencies.assign(_spectrumSize(), value_type{});
        _sequence = 0UZ;
        rebuildFrequencyAxisLocked();
        _history.clear();
    }

    void processFrame(std::span<const T> input) {
        if (input.size() != _fftSize) {
            return;
        }

        std::lock_guard lock(_mutex);
        if (_fftInput.size() != _fftSize) {
            _fftInput.assign(_fftSize, T{});
        }
        if (_window.size() != _fftSize) {
            _window.assign(_fftSize, value_type{});
            gr::algorithm::window::create(_window, _windowType);
        }

        std::copy_n(input.begin(), static_cast<std::ptrdiff_t>(_fftSize), _fftInput.begin());
        std::transform(
            _fftInput.begin(),
            _fftInput.end(),
            _window.begin(),
            _fftInput.begin(),
            [](T sample, value_type windowValue) {
                if constexpr (gr::meta::complex_like<T>) {
                    sample.real(sample.real() * windowValue);
                    sample.imag(sample.imag() * windowValue);
                    return sample;
                } else {
                    return static_cast<T>(sample * windowValue);
                }
            });

        _fftOutput = _fftImpl.compute(_fftInput);

        const bool computeFullSpectrum = gr::meta::complex_like<T>;
        _currentSpectrum = gr::algorithm::fft::computeMagnitudeSpectrum(
            _fftOutput,
            {},
            gr::algorithm::fft::ConfigMagnitude{
                .computeHalfSpectrum = !computeFullSpectrum,
                .outputInDb = false,
                .shiftSpectrum = computeFullSpectrum,
            });

        const value_type normalization = static_cast<value_type>(1.0F);
        std::ranges::transform(_currentSpectrum, _currentSpectrum.begin(), [normalization](const value_type magnitude) {
            return (magnitude * magnitude) * normalization;
        });

        if (_history.size() == _numAverages) {
            const auto& oldest = _history.front();
            std::transform(_spectrumSum.begin(), _spectrumSum.end(), oldest.begin(), _spectrumSum.begin(), std::minus<>{});
            _history.pop_front();
        }

        if (_spectrumSum.size() != _currentSpectrum.size()) {
            _spectrumSum.assign(_currentSpectrum.size(), value_type{});
        }

        std::transform(_spectrumSum.begin(), _spectrumSum.end(), _currentSpectrum.begin(), _spectrumSum.begin(), std::plus<>{});

        _history.push_back(_currentSpectrum);
        const value_type denominator = static_cast<value_type>(_history.size());
        _averagedSpectrum.resize(_currentSpectrum.size());
        std::transform(_spectrumSum.begin(), _spectrumSum.end(), _averagedSpectrum.begin(), [denominator](const value_type value) {
            return value / denominator;
        });
        ++_sequence;
    }

    void clearAverageHistory() {
        std::lock_guard lock(_mutex);
        _history.clear();
        std::ranges::fill(_spectrumSum, value_type{});
        std::ranges::fill(_averagedSpectrum, value_type{});
    }

    [[nodiscard]] std::vector<value_type> frequencyAxis() const {
        std::lock_guard lock(_mutex);
        return _frequencies;
    }

    [[nodiscard]] std::vector<value_type> powerSpectrum() const {
        std::lock_guard lock(_mutex);
        return _displaySpectrumLocked();
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::vector<value_type> frequencies;
        std::vector<value_type> spectrum;
        std::size_t fftSize = 0UZ;
        std::size_t numAverages = 0UZ;
        value_type sampleRate = static_cast<value_type>(1.0F);
        value_type centerFreq = static_cast<value_type>(0.0F);
        std::uint32_t updateMs = 0U;
        std::string window;
        bool outputInDb = false;
        bool persistenceEnabled = false;
        value_type phosphorIntensity = static_cast<value_type>(1.1F);
        value_type phosphorDecayMs = static_cast<value_type>(1024.0F);
        bool autoscaleEnabled = true;
        value_type yMin = static_cast<value_type>(0.0F);
        value_type yMax = static_cast<value_type>(0.0F);

        {
            std::lock_guard lock(_mutex);
            frequencies = _frequencies;
            spectrum = _displaySpectrumLocked();
            fftSize = _fftSize;
            numAverages = _numAverages;
            sampleRate = _sampleRate;
            centerFreq = _centerFreq;
            updateMs = _updateMs;
            window = _windowName;
            outputInDb = _outputInDb;
            persistenceEnabled = _persistenceEnabled;
            phosphorIntensity = _phosphorIntensity;
            phosphorDecayMs = _phosphorDecayMs;
            autoscaleEnabled = _autoscale;
            yMin = _yMin;
            yMax = _yMax;
        }

        if (frequencies.empty() || spectrum.empty()) {
            std::ostringstream os;
            os << "{\"payload_format\":\"dataset-xy-json-v1\",";
            os << "\"layout\":\"pairs_xy\",";
            os << "\"points\":0,";
            os << "\"sample_type\":\"float32\",";
            os << "\"axis_name\":\"Frequency\",";
            os << "\"axis_unit\":\"Hz\",";
            os << "\"signal_name\":\"Power Spectrum\",";
            os << "\"signal_unit\":\"" << (outputInDb ? "dB" : "power") << "\",";
            os << "\"fft_size\":" << fftSize << ",";
            os << "\"num_averages\":" << numAverages << ",";
            os << "\"sample_rate\":" << sampleRate << ",";
            os << "\"center_freq\":" << centerFreq << ",";
            os << "\"update_ms\":" << updateMs << ",";
            os << "\"window\":\"" << escapeJson(window) << "\",";
            os << "\"output_in_db\":" << (outputInDb ? "true" : "false") << ",";
            os << "\"persistence\":" << (persistenceEnabled ? "true" : "false") << ",";
            os << "\"phosphor_intensity\":" << phosphorIntensity << ",";
            os << "\"phosphor_decay_ms\":" << phosphorDecayMs << ",";
            os << "\"autoscale\":" << (autoscaleEnabled ? "true" : "false") << ",";
            os << "\"y_min\":" << yMin << ",";
            os << "\"y_max\":" << yMax << ",";
            os << "\"data\":[]}";
            return os.str();
        }

        const std::size_t points = std::min(frequencies.size(), spectrum.size());
        std::ostringstream os;
        os.precision(9);
        os << "{\"payload_format\":\"dataset-xy-json-v1\",";
        os << "\"layout\":\"pairs_xy\",";
        os << "\"points\":" << points << ",";
        os << "\"sample_type\":\"float32\",";
        os << "\"axis_name\":\"Frequency\",";
        os << "\"axis_unit\":\"Hz\",";
        os << "\"signal_name\":\"Power Spectrum\",";
        os << "\"signal_unit\":\"" << (outputInDb ? "dB" : "power") << "\",";
        os << "\"fft_size\":" << fftSize << ",";
        os << "\"num_averages\":" << numAverages << ",";
        os << "\"sample_rate\":" << sampleRate << ",";
        os << "\"center_freq\":" << centerFreq << ",";
        os << "\"update_ms\":" << updateMs << ",";
        os << "\"window\":\"" << escapeJson(window) << "\",";
        os << "\"output_in_db\":" << (outputInDb ? "true" : "false") << ",";
        os << "\"persistence\":" << (persistenceEnabled ? "true" : "false") << ",";
        os << "\"phosphor_intensity\":" << phosphorIntensity << ",";
        os << "\"phosphor_decay_ms\":" << phosphorDecayMs << ",";
        os << "\"autoscale\":" << (autoscaleEnabled ? "true" : "false") << ",";
        os << "\"y_min\":" << yMin << ",";
        os << "\"y_max\":" << yMax << ",";
        os << "\"data\":[";
        for (std::size_t index = 0UZ; index < points; ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            os << '[' << frequencies[index] << ',' << spectrum[index] << ']';
        }
        os << "]}";
        return os.str();
    }

    [[nodiscard]] std::string snapshotWebSocketBinaryFrame() const {
        std::vector<value_type> frequencies;
        std::vector<value_type> spectrum;
        std::uint64_t seq = 0UZ;
        value_type timestampSec = static_cast<value_type>(0.0F);

        {
            std::lock_guard lock(_mutex);
            frequencies = _frequencies;
            spectrum = _displaySpectrumLocked();
            seq = _sequence;
            const auto now = std::chrono::system_clock::now().time_since_epoch();
            timestampSec = std::chrono::duration_cast<std::chrono::duration<value_type>>(now).count();
        }

        const std::size_t bins = std::min(frequencies.size(), spectrum.size());
        if (bins == 0UZ) {
            return {};
        }

        const value_type centerHz = (frequencies.front() + frequencies.back()) / static_cast<value_type>(2.0F);
        value_type spanHz = frequencies.back() - frequencies.front();
        if (!(spanHz > static_cast<value_type>(0.0F))) {
            spanHz = _sampleRate > 0.0F ? static_cast<value_type>(_sampleRate) : static_cast<value_type>(1.0F);
        }

        std::string payload;
        payload.reserve(44UZ + bins * sizeof(value_type));
        appendLittleEndian(payload, static_cast<std::uint32_t>(0x53505753U));
        appendLittleEndian(payload, static_cast<std::uint16_t>(1U));
        appendLittleEndian(payload, static_cast<std::uint16_t>(0U));
        appendLittleEndian(payload, static_cast<std::uint32_t>(bins));
        appendLittleEndian(payload, static_cast<double>(centerHz));
        appendLittleEndian(payload, static_cast<double>(spanHz));
        appendLittleEndian(payload, static_cast<std::uint64_t>(seq));
        appendLittleEndian(payload, static_cast<double>(timestampSec));
        for (std::size_t index = 0UZ; index < bins; ++index) {
            appendLittleEndian(payload, static_cast<float>(spectrum[index]));
        }
        return payload;
    }

private:
    [[nodiscard]] std::size_t _spectrumSize() const noexcept {
        return gr::meta::complex_like<T> ? _fftSize : (_fftSize / 2UZ);
    }

    void rebuildFrequencyAxisLocked() {
        const std::size_t bins = _spectrumSize();
        _frequencies.assign(bins, value_type{});
        const value_type freqWidth = _sampleRate / static_cast<value_type>(_fftSize);

        if constexpr (gr::meta::complex_like<T>) {
            const value_type freqOffset = static_cast<value_type>(bins / 2UZ) * freqWidth;
            std::generate(_frequencies.begin(), _frequencies.end(), [index = 0UZ, freqWidth, freqOffset]() mutable {
                const auto next = static_cast<value_type>(index) * freqWidth - freqOffset;
                ++index;
                return next;
            });
        } else {
            std::generate(_frequencies.begin(), _frequencies.end(), [index = 0UZ, freqWidth]() mutable {
                const auto next = static_cast<value_type>(index) * freqWidth;
                ++index;
                return next;
            });
        }

        if (_centerFreq != static_cast<value_type>(0.0F)) {
            std::ranges::transform(_frequencies, _frequencies.begin(), [this](const value_type frequency) {
                return frequency + _centerFreq;
            });
        }
    }

    [[nodiscard]] std::vector<value_type> _displaySpectrumLocked() const {
        if (_averagedSpectrum.empty()) {
            return {};
        }

        if (! _outputInDb) {
            return _averagedSpectrum;
        }

        std::vector<value_type> display = _averagedSpectrum;
        constexpr value_type minimumPower = static_cast<value_type>(1.0e-16F);
        std::ranges::transform(display, display.begin(), [minimumPower](const value_type value) {
            const value_type clamped = std::max(value, minimumPower);
            return static_cast<value_type>(10.0F) * std::log10(clamped);
        });
        return display;
    }

    mutable std::mutex _mutex;
    std::size_t _fftSize = 1024UZ;
    std::size_t _numAverages = 8UZ;
    float _sampleRate = 1.0F;
    value_type _centerFreq = static_cast<value_type>(0.0F);
    std::uint32_t _updateMs = 250U;
    std::string _windowName = std::string(magic_enum::enum_name(gr::algorithm::window::Type::BlackmanHarris));
    bool _outputInDb = true;
    bool _persistenceEnabled = false;
    value_type _phosphorIntensity = static_cast<value_type>(1.1F);
    value_type _phosphorDecayMs = static_cast<value_type>(1024.0F);
    bool _autoscale = true;
    value_type _yMin = static_cast<value_type>(0.0F);
    value_type _yMax = static_cast<value_type>(0.0F);
    std::uint64_t _sequence = 0UZ;
    gr::algorithm::window::Type _windowType = gr::algorithm::window::Type::BlackmanHarris;
    fft_type _fftImpl{};
    std::vector<value_type> _window{};
    std::vector<T> _fftInput{};
    std::vector<complex_type> _fftOutput{};
    std::vector<value_type> _currentSpectrum{};
    std::vector<value_type> _spectrumSum{};
    std::vector<value_type> _averagedSpectrum{};
    std::vector<value_type> _frequencies{};
    std::deque<std::vector<value_type>> _history{};
};

// Streams the latest spectrum frame as binary WebSocket messages. A slow client never sees a backlog:
// the shared service holds one pending frame and replaces it with each newer one.
class SnapshotWebSocketService {
public:
    [[nodiscard]] bool start(const ParsedHttpEndpoint& endpoint) { return _service.start(endpoint.host, endpoint.port, endpoint.path); }

    void stop() { _service.stop(); }

    [[nodiscard]] bool          isRunning() const noexcept { return _service.isRunning(); }
    [[nodiscard]] std::uint16_t boundPort() const noexcept { return _service.boundPort(); }

    void publish(std::string payload) { _service.publishBinary(std::move(payload)); }

private:
    websocket_transport::SnapshotWebSocketService _service;
};

inline bool isHttpPollTransport(const PowerSpectrumTransport transport) {
    return transport == PowerSpectrumTransport::http_poll;
}

inline bool isWebSocketTransport(const PowerSpectrumTransport transport) {
    return transport == PowerSpectrumTransport::websocket;
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioPowerSpectrumSink", gr::studio::StudioPowerSpectrumSink, ([T]), [ float, std::complex<float> ])

template<detail::SupportedPowerSpectrumSample T>
struct StudioPowerSpectrumSink : Block<StudioPowerSpectrumSink<T>> {
    using Description = Doc<"@brief Studio power spectrum sink with FFT windowing, averaged spectra, and optional phosphor persistence.">;

    PortIn<T> in;

    Annotated<detail::PowerSpectrumTransport, "transport", Doc<"Connection method">, Visible> transport = detail::PowerSpectrumTransport::websocket;
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18085/snapshot";
    Annotated<std::uint32_t, "update_ms", Doc<"Display update interval in milliseconds; independent of the input sample rate">, Visible> update_ms = 50U;
    Annotated<gr::Size_t, "fft_size", Doc<"FFT size used for each spectrum frame">, Visible> fft_size = 1024UZ;
    Annotated<gr::Size_t, "num_averages", Doc<"Number of FFT frames averaged into the displayed spectrum">, Visible> num_averages = 8UZ;
    Annotated<gr::algorithm::window::Type, "window", Doc<"FFT window function">, Visible> window = gr::algorithm::window::Type::BlackmanHarris;
    Annotated<float, "sample_rate", Doc<"Input sample rate in Hz">, Visible> sample_rate = 48000.0F;
    Annotated<float, "center_freq", Doc<"Optional RF center frequency in Hz added to the displayed frequency axis">, Visible> center_freq = 0.0F;
    Annotated<bool, "output_in_db", Doc<"Render the averaged power spectrum in dB">, Visible> output_in_db = true;
    Annotated<bool, "persistence", Doc<"Keep a fading trail behind the spectrum">, Visible> persistence = false;
    Annotated<float, "phosphor_intensity", Doc<"Phosphor intensity multiplier when persistence is enabled">, Visible> phosphor_intensity = 1.1F;
    Annotated<float, "phosphor_decay_ms", Doc<"Phosphor persistence decay time in milliseconds">, Visible> phosphor_decay_ms = 1024.0F;
    Annotated<std::string, "plot_title", Doc<"Plot title">, Visible> plot_title = "Power Spectrum";
    Annotated<std::string, "x_label", Doc<"Horizontal axis label">, Visible> x_label = "Frequency";
    Annotated<std::string, "y_label", Doc<"Vertical axis label">, Visible> y_label = "Power";
    Annotated<std::string, "series_labels", Doc<"Series labels in input order, separated by commas">, Visible> series_labels = "Power";
    Annotated<bool, "autoscale", Doc<"Scale the plotted values automatically">, Visible> autoscale = true;
    Annotated<float, "y_min", Doc<"Vertical axis minimum with automatic scaling off">, Visible> y_min = -140.0F;
    Annotated<float, "y_max", Doc<"Vertical axis maximum with automatic scaling off">, Visible> y_max = 10.0F;
    Annotated<std::string, "topic", Doc<"Reserved topic setting">> topic = "";

    GR_MAKE_REFLECTABLE(
        StudioPowerSpectrumSink,
        in,
        transport,
        endpoint,
        update_ms,
        fft_size,
        num_averages,
        window,
        sample_rate,
        center_freq,
        output_in_db,
        persistence,
        phosphor_intensity,
        phosphor_decay_ms,
        plot_title,
        x_label,
        y_label,
        series_labels,
        autoscale,
        y_min,
        y_max,
        topic);

    using Block<StudioPowerSpectrumSink<T>>::Block;

    void start() {
        _window.configure(
            static_cast<std::size_t>(fft_size),
            static_cast<std::size_t>(num_averages),
            sample_rate,
            center_freq,
            update_ms,
            window.value,
            output_in_db,
            persistence,
            phosphor_intensity,
            phosphor_decay_ms,
            autoscale,
            y_min,
            y_max);
        _lastFrameProcessAt = {};
        _sampleCache.clear();
        syncInputPortConstraints();
        startTransport();
    }

    void stop() {
        _http.stop();
        _websocket.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (
            new_settings.contains("fft_size") ||
            new_settings.contains("num_averages") ||
            new_settings.contains("window") ||
            new_settings.contains("sample_rate") ||
            new_settings.contains("center_freq") ||
            new_settings.contains("output_in_db") ||
            new_settings.contains("persistence") ||
            new_settings.contains("phosphor_intensity") ||
            new_settings.contains("phosphor_decay_ms") ||
            new_settings.contains("autoscale") ||
            new_settings.contains("y_min") ||
            new_settings.contains("y_max")) {
            _window.configure(
                static_cast<std::size_t>(fft_size),
                static_cast<std::size_t>(num_averages),
                sample_rate,
                center_freq,
                update_ms,
                window.value,
                output_in_db,
                persistence,
                phosphor_intensity,
                phosphor_decay_ms,
                autoscale,
                y_min,
                y_max);
            _lastFrameProcessAt = {};
            _sampleCache.clear();
            syncInputPortConstraints();
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    void processSamples(std::span<const T> input) {
        appendSamples(input);
        processCachedFrames();
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            const std::size_t available = input.size();
            appendSamples(std::span<const T>(input.data(), available));
            processCachedFrames();
            std::ignore = input.consume(available);
        }

        return work::Status::OK;
    }

    [[nodiscard]] std::string snapshotJson() const { return _window.snapshotJson(); }

private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = {};

        if (detail::isWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed)) {
                throw gr::exception("StudioPowerSpectrumSink failed to start websocket transport endpoint.");
            }
            return;
        }

        if (!detail::isHttpPollTransport(transport.value)) {
            throw gr::exception("StudioPowerSpectrumSink currently supports only http_poll and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return _window.snapshotJson(); })) {
            throw gr::exception("StudioPowerSpectrumSink failed to start HTTP transport endpoint.");
        }
    }

    detail::PowerSpectrumWindow<T> _window{};
    detail::SnapshotHttpService _http{};
    detail::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};
    std::chrono::steady_clock::time_point _lastFrameProcessAt{};
    std::vector<T> _sampleCache{};

    void appendSamples(std::span<const T> input) {
        if (input.empty()) {
            return;
        }

        const auto frameSize = static_cast<std::size_t>(fft_size);
        const auto framesToCache = std::max<std::size_t>(1UZ, static_cast<std::size_t>(num_averages));
        const auto maxSamples = frameSize * framesToCache;
        if (maxSamples == 0UZ) {
            return;
        }

        if (input.size() >= maxSamples) {
            _sampleCache.assign(input.end() - static_cast<std::ptrdiff_t>(maxSamples), input.end());
            return;
        }

        _sampleCache.insert(_sampleCache.end(), input.begin(), input.end());
        if (_sampleCache.size() > maxSamples) {
            const auto excess = _sampleCache.size() - maxSamples;
            _sampleCache.erase(_sampleCache.begin(), _sampleCache.begin() + static_cast<std::ptrdiff_t>(excess));
        }
    }

    void processCachedFrames() {
        const auto frameSize = static_cast<std::size_t>(fft_size);
        if (frameSize == 0UZ || _sampleCache.size() < frameSize) {
            return;
        }
        if (!shouldProcessFrame()) {
            return;
        }

        const auto availableFrames = _sampleCache.size() / frameSize;
        const auto framesToProcess = std::min<std::size_t>(std::max<std::size_t>(1UZ, static_cast<std::size_t>(num_averages)), availableFrames);
        const auto startOffset = _sampleCache.size() - framesToProcess * frameSize;

        _window.clearAverageHistory();
        for (std::size_t frame = 0UZ; frame < framesToProcess; ++frame) {
            const auto offset = startOffset + frame * frameSize;
            _window.processFrame(std::span<const T>(_sampleCache.data() + offset, frameSize));
        }
        publishWebSocketFrame();
    }

    bool shouldProcessFrame() {
        const auto now = std::chrono::steady_clock::now();
        const auto interval = std::chrono::milliseconds(std::max<std::uint32_t>(1U, update_ms));
        if (_lastFrameProcessAt != std::chrono::steady_clock::time_point{} &&
            now - _lastFrameProcessAt < interval) {
            return false;
        }
        _lastFrameProcessAt = now;
        return true;
    }

    void publishWebSocketFrame() {
        if (!_websocket.isRunning()) {
            return;
        }
        const auto now = std::chrono::steady_clock::now();
        const auto interval = std::chrono::milliseconds(std::max<std::uint32_t>(1U, update_ms));
        if (_lastWebSocketPublishAt != std::chrono::steady_clock::time_point{} &&
            now - _lastWebSocketPublishAt < interval) {
            return;
        }
        _lastWebSocketPublishAt = now;
        const auto payload = _window.snapshotWebSocketBinaryFrame();
        _websocket.publish(payload);
    }

    void syncInputPortConstraints() {
        const auto chunkSize = static_cast<std::size_t>(fft_size);
        in.min_samples = chunkSize;
        in.max_samples = chunkSize;
    }
};

} // namespace gr::studio
