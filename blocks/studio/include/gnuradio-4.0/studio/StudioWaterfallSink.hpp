// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>

#if defined(__EMSCRIPTEN__)
#include <gnuradio-4.0/studio/StudioWasmTransport.hpp>
#else
#include <httplib.h>
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <complex>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <span>
#include <cstdio>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include <gnuradio-4.0/algorithm/fourier/fft.hpp>
#include <gnuradio-4.0/algorithm/fourier/fft_common.hpp>
#include <gnuradio-4.0/algorithm/fourier/window.hpp>
#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

namespace gr::studio {

namespace detail {

template<typename T>
concept SupportedWaterfallSample = std::same_as<T, float> || std::same_as<T, std::complex<float>>;

enum class WaterfallTransport {
    http_snapshot,
    http_poll,
    websocket,
};

inline std::string escapeJson(std::string_view text) {
    std::string out;
    out.reserve(text.size() + 8U);
    for (const char c : text) {
        switch (c) {
        case '\"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\b': out += "\\b"; break;
        case '\f': out += "\\f"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default: out += c; break;
        }
    }
    return out;
}

template<SupportedWaterfallSample T>
class WaterfallWindow {
public:
    using value_type = float;
    using complex_type = std::complex<value_type>;
    using fft_type = gr::algorithm::FFT<T, complex_type>;

    [[nodiscard]] static constexpr const char* sampleTypeName() noexcept {
        if constexpr (std::same_as<T, float>) {
            return "float32";
        } else {
            return "complex64";
        }
    }

    void configure(std::size_t fft_size, std::size_t num_averages, float time_span, float sample_rate, gr::algorithm::window::Type window, bool output_in_db) {
        std::lock_guard lock(_mutex);
        _fftSize = std::max<std::size_t>(1UZ, fft_size);
        _numAverages = std::max<std::size_t>(1UZ, num_averages);
        _timeSpan = std::max<value_type>(0.0F, time_span);
        const std::size_t quantizedSamples = _quantizeSampleCountLocked(_samplesFromDurationLocked(_timeSpan, sample_rate));
        _timeSpanSamples = quantizedSamples;
        _historyRows = std::max<std::size_t>(1UZ, quantizedSamples / _fftSize);
        _sampleRate = sample_rate > 0.0F ? sample_rate : 1.0F;
        _windowType = window;
        _windowName = std::string(magic_enum::enum_name(window));
        _outputInDb = output_in_db;

        _window.assign(_fftSize, value_type{});
        gr::algorithm::window::create(_window, _windowType);

        _fftInput.assign(_fftSize, T{});
        _fftOutput.assign(_fftSize, complex_type{});
        _currentSpectrum.assign(_spectrumSize(), value_type{});
        _spectrumSum.assign(_spectrumSize(), value_type{});
        _averagedSpectrum.assign(_spectrumSize(), value_type{});
        _frequencies.assign(_spectrumSize(), value_type{});
        _averagingHistory.clear();
        rebuildFrequencyAxisLocked();
        _history.clear();
    }

    void configureColorScale(bool autoscale, value_type z_min, value_type z_max) {
        std::lock_guard lock(_mutex);
        _autoscale = autoscale;
        _zMin = z_min;
        _zMax = z_max;
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
        for (std::size_t index = 0UZ; index < _fftSize; ++index) {
            if constexpr (gr::meta::complex_like<T>) {
                _fftInput[index].real(_fftInput[index].real() * _window[index]);
                _fftInput[index].imag(_fftInput[index].imag() * _window[index]);
            } else {
                _fftInput[index] *= _window[index];
            }
        }

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

        if (_averagingHistory.size() == _numAverages) {
            const auto& oldest = _averagingHistory.front();
            for (std::size_t index = 0UZ; index < _spectrumSum.size(); ++index) {
                _spectrumSum[index] -= oldest[index];
            }
            _averagingHistory.pop_front();
        }

        if (_spectrumSum.size() != _currentSpectrum.size()) {
            _spectrumSum.assign(_currentSpectrum.size(), value_type{});
        }

        if (_history.size() == _historyRows) {
            _history.pop_front();
        }

        _averagingHistory.push_back(_currentSpectrum);
        for (std::size_t index = 0UZ; index < _currentSpectrum.size(); ++index) {
            _spectrumSum[index] += _currentSpectrum[index];
        }

        const value_type denominator = static_cast<value_type>(_averagingHistory.size());
        _averagedSpectrum.resize(_currentSpectrum.size());
        for (std::size_t index = 0UZ; index < _currentSpectrum.size(); ++index) {
            _averagedSpectrum[index] = _spectrumSum[index] / denominator;
        }
        _history.push_back(_displaySpectrumLocked());
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::vector<value_type> frequencies;
        std::deque<std::vector<value_type>> history;
        std::size_t fftSize = 0UZ;
        std::size_t numAverages = 0UZ;
        std::size_t historyRows = 0UZ;
        std::size_t timeSpanSamples = 0UZ;
        value_type sampleRate = 0.0F;
        std::string window;
        bool outputInDb = false;
        bool autoscale = true;
        value_type zMin = 0.0F;
        value_type zMax = 1.0F;

        {
            std::lock_guard lock(_mutex);
            frequencies = _frequencies;
            history = _history;
            fftSize = _fftSize;
            numAverages = _numAverages;
            historyRows = _historyRows;
            timeSpanSamples = _timeSpanSamples;
            sampleRate = _sampleRate;
            window = _windowName;
            outputInDb = _outputInDb;
            autoscale = _autoscale;
            zMin = _zMin;
            zMax = _zMax;
        }

        const auto [resolvedMinValue, resolvedMaxValue] = _resolveColorScaleLocked(history, frequencies.size(), autoscale, zMin, zMax);
        const value_type effectiveTimeSpan = sampleRate > 0.0F ? static_cast<value_type>(timeSpanSamples) / sampleRate : 0.0F;

        if (frequencies.empty()) {
            std::ostringstream empty;
            empty << "{\"payload_format\":\"waterfall-spectrum-json-v1\",";
            empty << "\"layout\":\"waterfall_matrix\",";
            empty << "\"rows\":0,";
            empty << "\"columns\":0,";
            empty << "\"sample_type\":\"" << sampleTypeName() << "\",";
            empty << "\"axis_name\":\"Frequency\",";
            empty << "\"axis_unit\":\"Hz\",";
            empty << "\"signal_name\":\"Waterfall\",";
            empty << "\"signal_unit\":\"" << (outputInDb ? "dB" : "power") << "\",";
            empty << "\"fft_size\":" << fftSize << ",";
            empty << "\"num_averages\":" << numAverages << ",";
            empty << "\"time_span\":" << effectiveTimeSpan << ",";
            empty << "\"sample_rate\":" << sampleRate << ",";
            empty << "\"history_rows\":" << historyRows << ",";
            empty << "\"window\":\"" << escapeJson(window) << "\",";
            empty << "\"output_in_db\":" << (outputInDb ? "true" : "false") << ",";
            empty << "\"autoscale\":" << (autoscale ? "true" : "false") << ",";
            empty << "\"z_min\":" << zMin << ",";
            empty << "\"z_max\":" << zMax << ",";
            empty << "\"min_value\":" << resolvedMinValue << ",";
            empty << "\"max_value\":" << resolvedMaxValue << ",";
            empty << "\"color_map\":\"turbo\",";
            empty << "\"frequencies\":[],";
            empty << "\"data\":[]}";
            return empty.str();
        }

        const std::size_t rows = historyRows;
        const std::size_t columns = history.empty() ? frequencies.size() : std::min(frequencies.size(), history.front().size());
        std::ostringstream os;
        os.precision(9);
        os << "{\"payload_format\":\"waterfall-spectrum-json-v1\",";
        os << "\"layout\":\"waterfall_matrix\",";
        os << "\"rows\":" << rows << ",";
        os << "\"columns\":" << columns << ",";
        os << "\"sample_type\":\"" << sampleTypeName() << "\",";
        os << "\"axis_name\":\"Frequency\",";
        os << "\"axis_unit\":\"Hz\",";
        os << "\"signal_name\":\"Waterfall\",";
        os << "\"signal_unit\":\"" << (outputInDb ? "dB" : "power") << "\",";
        os << "\"fft_size\":" << fftSize << ",";
        os << "\"num_averages\":" << numAverages << ",";
        os << "\"time_span\":" << effectiveTimeSpan << ",";
        os << "\"sample_rate\":" << sampleRate << ",";
        os << "\"history_rows\":" << historyRows << ",";
        os << "\"window\":\"" << escapeJson(window) << "\",";
        os << "\"output_in_db\":" << (outputInDb ? "true" : "false") << ",";
        os << "\"autoscale\":" << (autoscale ? "true" : "false") << ",";
        os << "\"z_min\":" << zMin << ",";
        os << "\"z_max\":" << zMax << ",";
        os << "\"min_value\":" << resolvedMinValue << ",";
        os << "\"max_value\":" << resolvedMaxValue << ",";
        os << "\"color_map\":\"turbo\",";
        os << "\"frequencies\":[";
        for (std::size_t index = 0UZ; index < columns; ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            os << frequencies[index];
        }
        os << "],";
        os << "\"data\":[";
        std::size_t rowIndex = 0UZ;
        for (const auto& row : history) {
            if (rowIndex > 0UZ) {
                os << ',';
            }
            os << '[';
            for (std::size_t index = 0UZ; index < columns; ++index) {
                if (index > 0UZ) {
                    os << ',';
                }
                os << row[index];
            }
            os << ']';
            rowIndex += 1UZ;
        }
        const std::vector<value_type> blankRow(columns, resolvedMinValue);
        for (; rowIndex < rows; ++rowIndex) {
            if (rowIndex > 0UZ) {
                os << ',';
            }
            os << '[';
            for (std::size_t index = 0UZ; index < columns; ++index) {
                if (index > 0UZ) {
                    os << ',';
                }
                os << blankRow[index];
            }
            os << ']';
        }
        os << "]}";
        return os.str();
    }

private:
    [[nodiscard]] std::size_t _spectrumSize() const noexcept {
        return gr::meta::complex_like<T> ? _fftSize : std::max<std::size_t>(1UZ, _fftSize / 2UZ);
    }

    void rebuildFrequencyAxisLocked() {
        const std::size_t bins = _spectrumSize();
        _frequencies.assign(bins, value_type{});
        const value_type freqWidth = _sampleRate / static_cast<value_type>(_fftSize);

        if constexpr (gr::meta::complex_like<T>) {
            const value_type freqOffset = static_cast<value_type>(bins / 2UZ) * freqWidth;
            for (std::size_t index = 0UZ; index < bins; ++index) {
                _frequencies[index] = static_cast<value_type>(index) * freqWidth - freqOffset;
            }
        } else {
            for (std::size_t index = 0UZ; index < bins; ++index) {
                _frequencies[index] = static_cast<value_type>(index) * freqWidth;
            }
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
        for (auto& value : display) {
            const value_type clamped = std::max(value, minimumPower);
            value = static_cast<value_type>(10.0F) * std::log10(clamped);
        }
        return display;
    }

    [[nodiscard]] std::pair<value_type, value_type> _minMaxLocked(
        const std::deque<std::vector<value_type>>& history,
        std::size_t columns) const {
        value_type minValue = std::numeric_limits<value_type>::infinity();
        value_type maxValue = -std::numeric_limits<value_type>::infinity();
        for (const auto& row : history) {
            for (std::size_t index = 0UZ; index < std::min(columns, row.size()); ++index) {
                minValue = std::min(minValue, row[index]);
                maxValue = std::max(maxValue, row[index]);
            }
        }
        if (!std::isfinite(minValue) || !std::isfinite(maxValue)) {
            minValue = 0.0F;
            maxValue = 1.0F;
        }
        return {minValue, maxValue};
    }

    [[nodiscard]] std::pair<value_type, value_type> _resolveColorScaleLocked(
        const std::deque<std::vector<value_type>>& history,
        std::size_t columns,
        bool autoscale,
        value_type zMin,
        value_type zMax) const {
        const bool manualRangeValid = std::isfinite(zMin) && std::isfinite(zMax) && zMax >= zMin;
        if (!autoscale && manualRangeValid) {
            return {zMin, zMax};
        }

        if (!history.empty()) {
            const auto [minValue, maxValue] = _minMaxLocked(history, columns);
            if (std::isfinite(minValue) && std::isfinite(maxValue)) {
                return {minValue, maxValue};
            }
        }

        if (manualRangeValid) {
            return {zMin, zMax};
        }

        return {0.0F, 1.0F};
    }

    [[nodiscard]] std::size_t _samplesFromDurationLocked(value_type time_span, value_type sample_rate) const noexcept {
        const value_type duration = std::max<value_type>(0.0F, time_span);
        const value_type rate = sample_rate > 0.0F ? sample_rate : 1.0F;
        const auto rawSamples = static_cast<std::size_t>(std::ceil(duration * rate));
        return std::max<std::size_t>(1UZ, rawSamples);
    }

    [[nodiscard]] std::size_t _quantizeSampleCountLocked(std::size_t sample_count) const noexcept {
        const std::size_t frameSize = std::max<std::size_t>(1UZ, _fftSize);
        const std::size_t normalized = std::max<std::size_t>(frameSize, sample_count);
        const std::size_t remainder = normalized % frameSize;
        return remainder == 0UZ ? normalized : (normalized + frameSize - remainder);
    }

    mutable std::mutex _mutex;
    std::size_t _fftSize = 1024UZ;
    std::size_t _numAverages = 8UZ;
    std::size_t _timeSpanSamples = 262144UZ;
    std::size_t _historyRows = 256UZ;
    float _sampleRate = 1.0F;
    value_type _timeSpan = 256.0F;
    std::string _windowName = std::string(magic_enum::enum_name(gr::algorithm::window::Type::BlackmanHarris));
    bool _outputInDb = true;
    gr::algorithm::window::Type _windowType = gr::algorithm::window::Type::BlackmanHarris;
    fft_type _fftImpl{};
    std::vector<value_type> _window{};
    std::vector<T> _fftInput{};
    std::vector<complex_type> _fftOutput{};
    std::vector<value_type> _currentSpectrum{};
    std::vector<value_type> _spectrumSum{};
    std::vector<value_type> _averagedSpectrum{};
    std::vector<value_type> _frequencies{};
    std::deque<std::vector<value_type>> _averagingHistory{};
    std::deque<std::vector<value_type>> _history{};
    bool _autoscale = true;
    value_type _zMin = 0.0F;
    value_type _zMax = 1.0F;
};

struct ParsedHttpEndpoint {
    std::string host;
    std::uint16_t port;
    std::string path;
};

inline std::string normalizeSnapshotPath(const std::string& rawPath) {
    if (rawPath.empty()) {
        return "/snapshot";
    }
    if (rawPath.starts_with('/')) {
        return rawPath;
    }
    return "/" + rawPath;
}

inline ParsedHttpEndpoint parseHttpEndpoint(const std::string& endpoint) {
    std::string remaining = endpoint;
    for (const std::string_view prefix : {"http://", "https://", "ws://", "wss://"}) {
        if (remaining.starts_with(prefix)) {
            remaining.erase(0UZ, prefix.size());
            break;
        }
    }

    const std::size_t slash = remaining.find('/');
    const std::string hostPort = slash == std::string::npos ? remaining : remaining.substr(0UZ, slash);
    const std::string path = slash == std::string::npos ? "/snapshot" : normalizeSnapshotPath(remaining.substr(slash));

    std::string host = "127.0.0.1";
    std::uint16_t port = 8080U;
    if (!hostPort.empty()) {
        const std::size_t colon = hostPort.rfind(':');
        if (colon == std::string::npos) {
            host = hostPort;
        } else {
            host = hostPort.substr(0UZ, colon);
            const std::string portText = hostPort.substr(colon + 1UZ);
            if (!portText.empty()) {
                const int parsed = std::stoi(portText);
                if (parsed >= 0 && parsed <= static_cast<int>(std::numeric_limits<std::uint16_t>::max())) {
                    port = static_cast<std::uint16_t>(parsed);
                }
            }
        }
    }

    if (host.empty()) {
        host = "127.0.0.1";
    }

    return ParsedHttpEndpoint{
        .host = host,
        .port = port,
        .path = path,
    };
}

#if defined(__EMSCRIPTEN__)
using SnapshotHttpService = wasm_bridge::InProcessSnapshotHttpService;
#else

class SnapshotHttpService {
public:
    using JsonProvider = std::function<std::string()>;

    ~SnapshotHttpService() { stop(); }

    [[nodiscard]] bool start(const ParsedHttpEndpoint& endpoint, JsonProvider provider) {
        stop();

        _host = endpoint.host;
        _port = endpoint.port;
        _path = endpoint.path;
        _provider = std::move(provider);
        _boundPort = 0U;

        _server = std::make_unique<httplib::Server>();
        _server->Get(_path, [this](const httplib::Request&, httplib::Response& res) {
            res.set_header("Cache-Control", "no-store");
            res.set_content(_provider ? _provider() : std::string("{}"), "application/json");
        });

        const int bound = _server->bind_to_port(_host, static_cast<int>(_port));
        if (bound < 0) {
            _server.reset();
            return false;
        }
        _boundPort = static_cast<std::uint16_t>(bound);

        _serverThread = std::thread([this]() {
            if (_server) {
                _server->listen_after_bind();
            }
        });
        return true;
    }

    void stop() {
        if (_server) {
            _server->stop();
        }
        if (_serverThread.joinable()) {
            _serverThread.join();
        }
        _server.reset();
    }

private:
    std::string _host{"127.0.0.1"};
    std::uint16_t _port{8080U};
    std::uint16_t _boundPort{0U};
    std::string _path{"/snapshot"};
    JsonProvider _provider;
    std::unique_ptr<httplib::Server> _server;
    std::thread _serverThread;
};
#endif // defined(__EMSCRIPTEN__)

inline bool isHttpTransport(const WaterfallTransport transport) {
    return transport == WaterfallTransport::http_snapshot || transport == WaterfallTransport::http_poll;
}

inline bool isHttpTransport(const std::string& transport) {
    return transport == "http_snapshot" || transport == "http_poll";
}

inline bool isWebSocketTransport(const WaterfallTransport transport) {
    return transport == WaterfallTransport::websocket;
}

inline bool isWebSocketTransport(const std::string& transport) {
    return transport == "websocket";
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioWaterfallSink", gr::studio::StudioWaterfallSink, ([T]), [ float, std::complex<float> ])

template<detail::SupportedWaterfallSample T>
struct StudioWaterfallSink : Block<StudioWaterfallSink<T>> {
    using Description = Doc<"@brief Studio waterfall sink with FFT windowing and bounded history.">;

    PortIn<T> in;

    Annotated<detail::WaterfallTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = detail::WaterfallTransport::websocket;
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18085/snapshot";
    Annotated<std::uint32_t, "update_ms", Doc<"Suggested update interval in milliseconds for http_poll and websocket transports">, Visible> update_ms = 10U;
    Annotated<gr::Size_t, "fft_size", Doc<"FFT size used for each spectrum frame">, Visible> fft_size = 1024UZ;
    Annotated<gr::Size_t, "num_averages", Doc<"Number of FFT frames averaged into each history row">, Visible> num_averages = 8UZ;
    Annotated<float, "time_span", Doc<"Total waterfall history span in seconds (quantized to fft_size using sample_rate)">, Visible> time_span = 256.0F;
    Annotated<gr::algorithm::window::Type, "window", Doc<"FFT window function">, Visible> window = gr::algorithm::window::Type::BlackmanHarris;
    Annotated<float, "sample_rate", Doc<"Input sample rate in Hz">, Visible> sample_rate = 1.0F;
    Annotated<bool, "output_in_db", Doc<"Render the waterfall history in dB">, Visible> output_in_db = true;
    Annotated<bool, "autoscale", Doc<"Automatically derive the waterfall colormap range from live data">, Visible> autoscale = true;
    Annotated<float, "z_min", Doc<"Manual waterfall colormap minimum when autoscale is disabled">, Visible> z_min = 0.0F;
    Annotated<float, "z_max", Doc<"Manual waterfall colormap maximum when autoscale is disabled">, Visible> z_max = 1.0F;
    Annotated<std::string, "plot_title", Doc<"Optional semantic plot title for Studio Application">, Visible> plot_title = "Waterfall";
    Annotated<std::string, "x_label", Doc<"Optional semantic x-axis label for Studio Application">, Visible> x_label = "Frequency";
    Annotated<std::string, "y_label", Doc<"Optional semantic y-axis label for Studio Application">, Visible> y_label = "Power";
    Annotated<std::string, "series_labels", Doc<"Optional comma-separated series labels for Studio Application">, Visible> series_labels = "Waterfall";
    Annotated<float, "x_min", Doc<"Optional x-axis minimum when autoscale is disabled">, Visible> x_min = 0.0F;
    Annotated<float, "x_max", Doc<"Optional x-axis maximum when autoscale is disabled">, Visible> x_max = 0.0F;
    Annotated<float, "y_min", Doc<"Optional y-axis minimum when autoscale is disabled">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Optional y-axis maximum when autoscale is disabled">, Visible> y_max = 0.0F;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(
        StudioWaterfallSink,
        in,
        transport,
        endpoint,
        update_ms,
        fft_size,
        num_averages,
        time_span,
        window,
        sample_rate,
        output_in_db,
        autoscale,
        z_min,
        z_max,
        plot_title,
        x_label,
        y_label,
        series_labels,
        x_min,
        x_max,
        y_min,
        y_max,
        topic);

    using Block<StudioWaterfallSink<T>>::Block;

    void start() {
        _window.configure(
            static_cast<std::size_t>(fft_size),
            static_cast<std::size_t>(num_averages),
            time_span,
            sample_rate,
            window.value,
            output_in_db);
        _window.configureColorScale(autoscale, z_min, z_max);
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
            new_settings.contains("time_span") ||
            new_settings.contains("window") ||
            new_settings.contains("sample_rate") ||
            new_settings.contains("output_in_db") ||
            new_settings.contains("autoscale") ||
            new_settings.contains("z_min") ||
            new_settings.contains("z_max")) {
            _window.configure(
                static_cast<std::size_t>(fft_size),
                static_cast<std::size_t>(num_averages),
                time_span,
                sample_rate,
                window.value,
                output_in_db);
            _window.configureColorScale(autoscale, z_min, z_max);
            syncInputPortConstraints();
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    void processSamples(std::span<const T> input) {
        if (input.size() < static_cast<std::size_t>(fft_size)) {
            return;
        }

        try {
            _window.processFrame(input.first(static_cast<std::size_t>(fft_size)));
            publishWebSocketFrame();
        } catch (const std::exception& error) {
            if (detail::isWebSocketTransport(transport.value)) {
                std::fprintf(stderr, "StudioWaterfallSink websocket processSamples failed: %s\n", error.what());
                std::fflush(stderr);
                return;
            }
            throw;
        } catch (...) {
            if (detail::isWebSocketTransport(transport.value)) {
                std::fprintf(stderr, "StudioWaterfallSink websocket processSamples failed: unknown exception\n");
                std::fflush(stderr);
                return;
            }
            throw;
        }
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            const std::size_t available = input.size();
            const std::size_t frameSize  = static_cast<std::size_t>(fft_size);
            const std::size_t frames     = available / frameSize;

            try {
                for (std::size_t frame = 0UZ; frame < frames; ++frame) {
                    const std::size_t offset = frame * frameSize;
                    _window.processFrame(std::span<const T>(input.data() + offset, frameSize));
                    publishWebSocketFrame();
                }

                std::ignore = input.consume(available);
            } catch (const std::exception& error) {
                if (detail::isWebSocketTransport(transport.value)) {
                    std::fprintf(stderr, "StudioWaterfallSink websocket processBulk failed: %s\n", error.what());
                    std::fflush(stderr);
                    return work::Status::OK;
                }
                throw;
            } catch (...) {
                if (detail::isWebSocketTransport(transport.value)) {
                    std::fprintf(stderr, "StudioWaterfallSink websocket processBulk failed: unknown exception\n");
                    std::fflush(stderr);
                    return work::Status::OK;
                }
                throw;
            }
        }

        return work::Status::OK;
    }

    [[nodiscard]] std::string snapshotJson() const { return _window.snapshotJson(); }

    private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = std::chrono::steady_clock::time_point{};

        if (detail::isWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
                std::ostringstream message;
                message << "StudioWaterfallSink failed to start websocket transport endpoint at ";
                message << endpoint.value << " (parsed host=" << parsed.host << ", port=" << parsed.port << ", path=" << parsed.path << ")";
                const auto reason = _websocket.lastErrorMessage();
                if (!reason.empty()) {
                    message << ": " << reason;
                }
                std::fprintf(stderr, "%s\n", message.str().c_str());
                throw gr::exception(message.str());
            }
            return;
        }

        if (!detail::isHttpTransport(transport.value)) {
            throw gr::exception("StudioWaterfallSink currently supports only http_snapshot, http_poll, and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return _window.snapshotJson(); })) {
            throw gr::exception("StudioWaterfallSink failed to start HTTP transport endpoint.");
        }
    }

    detail::WaterfallWindow<T> _window{};
    detail::SnapshotHttpService _http{};
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};

    void syncInputPortConstraints() {
        const auto chunkSize = std::max<std::size_t>(1UZ, static_cast<std::size_t>(fft_size));
        fft_size = chunkSize;
        in.min_samples = chunkSize;
        in.max_samples = chunkSize;
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

        _websocket.publishText(_window.snapshotJson());
    }
};

} // namespace gr::studio
