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

#if !defined(__EMSCRIPTEN__)
#include <boost/beast/core/detail/base64.hpp>
#include <openssl/sha.h>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif
#endif

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

#if !defined(__EMSCRIPTEN__)

inline std::string toLowerAscii(std::string_view text) {
    std::string out{text};
    std::ranges::transform(out, out.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    return out;
}

inline std::string trimAscii(std::string_view text) {
    const auto first = text.find_first_not_of(" \t\r\n");
    if (first == std::string_view::npos) {
        return {};
    }
    const auto last = text.find_last_not_of(" \t\r\n");
    return std::string(text.substr(first, last - first + 1UZ));
}

inline std::string encodeBase64(std::string_view bytes) {
    std::string encoded(boost::beast::detail::base64::encoded_size(bytes.size()), '\0');
    const auto written = boost::beast::detail::base64::encode(encoded.data(), bytes.data(), bytes.size());
    encoded.resize(written);
    return encoded;
}
#endif // !defined(__EMSCRIPTEN__)

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

#if !defined(__EMSCRIPTEN__)

inline std::string computeWebSocketAcceptKey(std::string_view clientKey) {
    constexpr std::string_view wsGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const std::string input{clientKey.begin(), clientKey.end()};
    const std::string handshakeKey = input + std::string(wsGuid);

    std::array<unsigned char, SHA_DIGEST_LENGTH> digest{};
    SHA1(reinterpret_cast<const unsigned char*>(handshakeKey.data()), handshakeKey.size(), digest.data());
    const std::string digestBytes{reinterpret_cast<const char*>(digest.data()), digest.size()};
    return encodeBase64(digestBytes);
}

inline void appendWebSocketLength(std::string& frame, std::size_t payloadSize) {
    if (payloadSize <= 125UZ) {
        frame.push_back(static_cast<char>(payloadSize));
        return;
    }
    if (payloadSize <= 0xFFFFU) {
        frame.push_back(static_cast<char>(126));
        frame.push_back(static_cast<char>((payloadSize >> 8UZ) & 0xFFU));
        frame.push_back(static_cast<char>(payloadSize & 0xFFU));
        return;
    }

    frame.push_back(static_cast<char>(127));
    for (int shift = 56; shift >= 0; shift -= 8) {
        frame.push_back(static_cast<char>((static_cast<std::uint64_t>(payloadSize) >> shift) & 0xFFU));
    }
}

inline std::string buildWebSocketBinaryFrame(std::span<const std::byte> payload) {
    std::string frame;
    frame.reserve(payload.size() + 16UZ);
    frame.push_back(static_cast<char>(0x82)); // FIN + binary opcode

    const std::size_t payloadSize = payload.size();
    appendWebSocketLength(frame, payloadSize);

    const auto* data = reinterpret_cast<const char*>(payload.data());
    frame.append(data, data + payload.size());
    return frame;
}
#endif // !defined(__EMSCRIPTEN__)

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
                if (parsed > 0 && parsed <= static_cast<int>(std::numeric_limits<std::uint16_t>::max())) {
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

class SnapshotWebSocketService {
public:
    [[nodiscard]] bool start(const ParsedHttpEndpoint& endpoint) { return _service.start(endpoint.host, endpoint.port, endpoint.path); }

    void stop() { _service.stop(); }

    [[nodiscard]] bool          isRunning() const noexcept { return _service.isRunning(); }
    [[nodiscard]] std::uint16_t boundPort() const noexcept { return _service.boundPort(); }

    void publish(std::string payload) { _service.publishBinary(std::move(payload)); }

private:
    wasm_bridge::InProcessSnapshotWebSocketService _service;
};

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

class SnapshotWebSocketService {
public:
    ~SnapshotWebSocketService() { stop(); }

    [[nodiscard]] bool start(const ParsedHttpEndpoint& endpoint) {
        stop();

        _host = endpoint.host;
        _port = endpoint.port;
        _path = endpoint.path;
        _boundPort = 0U;
        _stopping = false;
        _hasPendingFrame = false;
        _pendingFrame.clear();

#if defined(_WIN32)
        return false;
#else
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_flags = AI_PASSIVE;

        addrinfo* resolved = nullptr;
        const std::string portText = std::to_string(_port);
        if (const int rc = ::getaddrinfo(_host.empty() ? nullptr : _host.c_str(), portText.c_str(), &hints, &resolved); rc != 0 || resolved == nullptr) {
            return false;
        }

        for (addrinfo* candidate = resolved; candidate != nullptr; candidate = candidate->ai_next) {
            int listenFd = ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
            if (listenFd < 0) {
                continue;
            }

            configureSocket(listenFd);

            int reuseAddress = 1;
            std::ignore = ::setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, &reuseAddress, sizeof(reuseAddress));

            if (::bind(listenFd, candidate->ai_addr, candidate->ai_addrlen) != 0) {
                closeSocket(listenFd);
                continue;
            }

            if (::listen(listenFd, 1) != 0) {
                closeSocket(listenFd);
                continue;
            }

            _listenFd = listenFd;
            break;
        }

        ::freeaddrinfo(resolved);
        if (_listenFd < 0) {
            return false;
        }

        {
            sockaddr_storage addr{};
            socklen_t addrLen = sizeof(addr);
            if (::getsockname(_listenFd, reinterpret_cast<sockaddr*>(&addr), &addrLen) == 0) {
                if (addr.ss_family == AF_INET) {
                    _boundPort = ntohs(reinterpret_cast<sockaddr_in*>(&addr)->sin_port);
                } else if (addr.ss_family == AF_INET6) {
                    _boundPort = ntohs(reinterpret_cast<sockaddr_in6*>(&addr)->sin6_port);
                } else {
                    _boundPort = _port;
                }
            } else {
                _boundPort = _port;
            }
        }

        _acceptThread = std::thread([this]() { acceptLoop(); });
        _senderThread = std::thread([this]() { sendLoop(); });
        return true;
#endif
    }

    void stop() {
        {
            std::lock_guard lock(_mutex);
            _stopping = true;
            _hasPendingFrame = false;
        }
        _cv.notify_all();

        closeSocket(_listenFd);
        _listenFd = -1;

        closeCurrentClient();

        if (_acceptThread.joinable()) {
            _acceptThread.join();
        }
        if (_senderThread.joinable()) {
            _senderThread.join();
        }
    }

    [[nodiscard]] bool isRunning() const noexcept { return _listenFd >= 0; }
    [[nodiscard]] std::uint16_t boundPort() const noexcept { return _boundPort; }

    void publish(std::string frame) {
        if (frame.empty()) {
            return;
        }

        {
            std::lock_guard lock(_mutex);
            if (_stopping) {
                return;
            }
            _pendingFrame = std::move(frame);
            _hasPendingFrame = true;
        }
        _cv.notify_all();
    }

private:
#if !defined(_WIN32)
    static void configureSocket(int fd) {
#if defined(SO_NOSIGPIPE)
        int disableSigpipe = 1;
        std::ignore = ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &disableSigpipe, sizeof(disableSigpipe));
#else
        (void)fd;
#endif
    }

    static void closeSocket(int& fd) {
        if (fd >= 0) {
            std::ignore = ::shutdown(fd, SHUT_RDWR);
            ::close(fd);
            fd = -1;
        }
    }

    void closeCurrentClient() {
        std::lock_guard lock(_mutex);
        if (_clientFd >= 0) {
            closeSocket(_clientFd);
        }
    }

    static bool sendAll(int fd, std::string_view payload) {
        constexpr int sendFlags =
#if defined(MSG_NOSIGNAL)
            MSG_NOSIGNAL;
#else
            0;
#endif

        const char* data = payload.data();
        std::size_t remaining = payload.size();
        while (remaining > 0UZ) {
            const auto sent = ::send(fd, data, remaining, sendFlags);
            if (sent <= 0) {
                return false;
            }
            data += sent;
            remaining -= static_cast<std::size_t>(sent);
        }
        return true;
    }

    bool writeBinaryFrame(int fd, std::string_view payload) const {
        std::string frame;
        frame.reserve(payload.size() + 16UZ);
        frame.push_back(static_cast<char>(0x82));

        appendWebSocketLength(frame, payload.size());
        frame.append(payload.begin(), payload.end());
        return sendAll(fd, frame);
    }

    bool performHandshake(int fd) const {
        std::string request;
        request.reserve(4096UZ);
        char buffer[1024];
        while (request.find("\r\n\r\n") == std::string::npos) {
            const auto received = ::recv(fd, buffer, sizeof(buffer), 0);
            if (received <= 0) {
                return false;
            }
            request.append(buffer, buffer + received);
            if (request.size() > 8192UZ) {
                return false;
            }
        }

        const std::size_t headerEnd = request.find("\r\n\r\n");
        std::istringstream stream(request.substr(0UZ, headerEnd));
        std::string requestLine;
        if (!std::getline(stream, requestLine)) {
            return false;
        }
        if (!requestLine.empty() && requestLine.back() == '\r') {
            requestLine.pop_back();
        }
        if (!requestLine.starts_with("GET ")) {
            return false;
        }

        const std::size_t pathEnd = requestLine.find(' ', 4UZ);
        if (pathEnd == std::string::npos) {
            return false;
        }
        if (requestLine.substr(4UZ, pathEnd - 4UZ) != _path) {
            return false;
        }

        std::unordered_map<std::string, std::string> headers;
        std::string line;
        while (std::getline(stream, line)) {
            if (!line.empty() && line.back() == '\r') {
                line.pop_back();
            }
            if (line.empty()) {
                continue;
            }
            const std::size_t colon = line.find(':');
            if (colon == std::string::npos) {
                continue;
            }
            headers.emplace(
                toLowerAscii(trimAscii(line.substr(0UZ, colon))),
                trimAscii(line.substr(colon + 1UZ)));
        }

        const auto upgrade = headers.find("upgrade");
        const auto connection = headers.find("connection");
        const auto key = headers.find("sec-websocket-key");
        if (upgrade == headers.end() || connection == headers.end() || key == headers.end()) {
            return false;
        }

        if (toLowerAscii(upgrade->second) != "websocket") {
            return false;
        }
        const std::string connectionValue = toLowerAscii(connection->second);
        if (connectionValue.find("upgrade") == std::string::npos) {
            return false;
        }

        const std::string accept = computeWebSocketAcceptKey(key->second);
        std::ostringstream response;
        response << "HTTP/1.1 101 Switching Protocols\r\n";
        response << "Upgrade: websocket\r\n";
        response << "Connection: Upgrade\r\n";
        response << "Sec-WebSocket-Accept: " << accept << "\r\n\r\n";
        return sendAll(fd, response.str());
    }

    void acceptLoop() {
        while (true) {
            sockaddr_storage clientAddr{};
            socklen_t clientAddrLen = sizeof(clientAddr);
            int clientFd = ::accept(_listenFd, reinterpret_cast<sockaddr*>(&clientAddr), &clientAddrLen);
            if (clientFd < 0) {
                if (_stopping) {
                    break;
                }
                continue;
            }

            configureSocket(clientFd);
            if (!performHandshake(clientFd)) {
                closeSocket(clientFd);
                continue;
            }

            {
                std::lock_guard lock(_mutex);
                if (_stopping) {
                    closeSocket(clientFd);
                    break;
                }
                if (_clientFd >= 0) {
                    closeSocket(_clientFd);
                }
                _clientFd = clientFd;
                _cv.notify_all();
            }
        }
    }

    void sendLoop() {
        std::string frame;
        while (true) {
            int clientFd = -1;
            {
                std::unique_lock lock(_mutex);
                _cv.wait(lock, [this]() { return _stopping || (_clientFd >= 0 && _hasPendingFrame); });
                if (_stopping) {
                    break;
                }
                if (_clientFd < 0 || !_hasPendingFrame) {
                    continue;
                }
                clientFd = _clientFd;
                frame = std::move(_pendingFrame);
                _hasPendingFrame = false;
            }

            if (!writeBinaryFrame(clientFd, frame)) {
                std::lock_guard lock(_mutex);
                if (_clientFd == clientFd) {
                    closeSocket(_clientFd);
                } else {
                    closeSocket(clientFd);
                }
            }
        }
    }

    std::string _host{"127.0.0.1"};
    std::uint16_t _port{8080U};
    std::uint16_t _boundPort{0U};
    std::string _path{"/snapshot"};
    mutable std::mutex _mutex;
    std::condition_variable _cv;
    bool _stopping{false};
    bool _hasPendingFrame{false};
    std::string _pendingFrame;
    int _listenFd{-1};
    int _clientFd{-1};
    std::thread _acceptThread;
    std::thread _senderThread;
#else
    std::string _host{"127.0.0.1"};
    std::uint16_t _port{8080U};
    std::uint16_t _boundPort{0U};
    std::string _path{"/snapshot"};
#endif
};
#endif // defined(__EMSCRIPTEN__)

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

    Annotated<detail::PowerSpectrumTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = detail::PowerSpectrumTransport::websocket;
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18085/snapshot";
    Annotated<std::uint32_t, "update_ms", Doc<"Suggested update interval in milliseconds for http_poll and websocket transports">, Visible> update_ms = 10U;
    Annotated<gr::Size_t, "fft_size", Doc<"FFT size used for each spectrum frame">, Visible> fft_size = 1024UZ;
    Annotated<gr::Size_t, "num_averages", Doc<"Number of FFT frames averaged into the displayed spectrum">, Visible> num_averages = 8UZ;
    Annotated<gr::algorithm::window::Type, "window", Doc<"FFT window function">, Visible> window = gr::algorithm::window::Type::BlackmanHarris;
    Annotated<float, "sample_rate", Doc<"Input sample rate in Hz">, Visible> sample_rate = 1.0F;
    Annotated<float, "center_freq", Doc<"Optional RF center frequency in Hz added to the displayed frequency axis">, Visible> center_freq = 0.0F;
    Annotated<bool, "output_in_db", Doc<"Render the averaged power spectrum in dB">, Visible> output_in_db = true;
    Annotated<bool, "persistence", Doc<"Enable phosphor persistence rendering in Studio Application">, Visible> persistence = false;
    Annotated<float, "phosphor_intensity", Doc<"Phosphor intensity multiplier when persistence is enabled">, Visible> phosphor_intensity = 1.1F;
    Annotated<float, "phosphor_decay_ms", Doc<"Phosphor persistence decay time in milliseconds">, Visible> phosphor_decay_ms = 1024.0F;
    Annotated<std::string, "plot_title", Doc<"Optional semantic plot title for Studio Application">, Visible> plot_title = "Power Spectrum";
    Annotated<std::string, "x_label", Doc<"Optional semantic x-axis label for Studio Application">, Visible> x_label = "Frequency";
    Annotated<std::string, "y_label", Doc<"Optional semantic y-axis label for Studio Application">, Visible> y_label = "Power";
    Annotated<std::string, "series_labels", Doc<"Optional comma-separated series labels for Studio Application">, Visible> series_labels = "Power";
    Annotated<bool, "autoscale", Doc<"Enable automatic axis scaling in Studio Application">, Visible> autoscale = true;
    Annotated<float, "y_min", Doc<"Optional y-axis minimum when autoscale is disabled">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Optional y-axis maximum when autoscale is disabled">, Visible> y_max = 0.0F;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

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
