// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/Tag.hpp>

#include <chrono>
#include <httplib.h>

#include <algorithm>
#include <complex>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <functional>
#include <memory>
#include <mutex>
#include <limits>
#include <optional>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

namespace gr::studio {

namespace detail {

enum class SeriesTransport {
    http_snapshot,
    http_poll,
    websocket,
};

enum class SeriesWindowMode {
    rolling,
    buffered,
};

template<typename T>
concept SupportedSample = std::same_as<T, float> || std::same_as<T, std::complex<float>>;

template<SupportedSample T>
class SeriesWindow {
public:
    explicit SeriesWindow(
        std::size_t channel_count = 1UZ,
        std::size_t window_size = 1024UZ,
        SeriesWindowMode mode = SeriesWindowMode::rolling) {
        configure(channel_count, window_size, mode);
    }

    void configure(std::size_t channel_count, std::size_t window_size, SeriesWindowMode mode = SeriesWindowMode::rolling) {
        std::lock_guard lock(_mutex);
        _channels   = std::max<std::size_t>(1UZ, channel_count);
        _windowSize = std::max<std::size_t>(1UZ, window_size);
        _mode       = mode;
        _ring.assign(_channels * _windowSize, T{});
        _published.assign(_channels * _windowSize, T{});
        _pending.clear();
        _writeIndex = 0UZ;
        _filled     = 0UZ;
        _totalFrames = 0UZ;
        _hasPublishedBuffer = false;
        _publishedFrames = 0UZ;
        _publishedOldestAbsolute = 0UZ;
        _lastPublishedTotalFrames = 0UZ;
        _snapshotVersion = 0UZ;
        _tags.clear();
        _publishedTags.clear();
    }

    void pushInputTags(InputSpanLike auto& input) {
        std::lock_guard lock(_mutex);
        for (const auto& [relIndex, tagMapRef] : input.tags()) {
            if (relIndex < 0) {
                continue;
            }
            const std::size_t sampleOffset = static_cast<std::size_t>(relIndex);
            if (sampleOffset >= input.size()) {
                continue;
            }
            const std::size_t frameOffset = sampleOffset / _channels;
            _tags.push_back(WindowTag{
                .absoluteIndex = _totalFrames + frameOffset,
                .map = tagMapRef.get(),
            });
        }
        trimTagsLocked();
    }

    void pushInterleaved(std::span<const T> input) {
        if (input.empty()) {
            return;
        }

        std::lock_guard lock(_mutex);
        _pending.insert(_pending.end(), input.begin(), input.end());

        const std::size_t frames = _pending.size() / _channels;
        for (std::size_t frame = 0UZ; frame < frames; ++frame) {
            for (std::size_t channel = 0UZ; channel < _channels; ++channel) {
                const std::size_t srcIndex = frame * _channels + channel;
                _ring[channel * _windowSize + _writeIndex] = _pending[srcIndex];
            }

            _writeIndex = (_writeIndex + 1UZ) % _windowSize;
            if (_filled < _windowSize) {
                ++_filled;
            }
            ++_totalFrames;
            if (_mode == SeriesWindowMode::buffered) {
                maybePublishBufferedSnapshotLocked();
            }
        }

        const std::size_t consumed = frames * _channels;
        if (consumed > 0UZ) {
            _pending.erase(_pending.begin(), _pending.begin() + static_cast<std::ptrdiff_t>(consumed));
        }
        trimTagsLocked();
        if (frames > 0UZ) {
            if (_mode == SeriesWindowMode::rolling) {
                ++_snapshotVersion;
            }
        }
    }

    [[nodiscard]] std::size_t version() const {
        std::lock_guard lock(_mutex);
        return _snapshotVersion;
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::vector<std::vector<T>> perChannel;
        std::vector<WindowTag>       visibleTags;
        std::size_t                 channelCount = 0UZ;
        std::size_t                 samplesPerChannel = 0UZ;
        std::size_t                 oldestAbsolute = 0UZ;

        {
            std::lock_guard lock(_mutex);
            channelCount       = _channels;
            samplesPerChannel  = _mode == SeriesWindowMode::buffered ? _publishedFrames : _filled;
            oldestAbsolute     = _mode == SeriesWindowMode::buffered ? _publishedOldestAbsolute : (_totalFrames >= _filled ? _totalFrames - _filled : 0UZ);
            perChannel.assign(channelCount, std::vector<T>(samplesPerChannel));

            if (_mode == SeriesWindowMode::buffered) {
                for (std::size_t channel = 0UZ; channel < channelCount; ++channel) {
                    for (std::size_t index = 0UZ; index < samplesPerChannel; ++index) {
                        perChannel[channel][index] = _published[channel * _windowSize + index];
                    }
                }
                visibleTags = _publishedTags;
            } else {
                const std::size_t oldest = (_filled == _windowSize) ? _writeIndex : 0UZ;
                for (std::size_t channel = 0UZ; channel < channelCount; ++channel) {
                    for (std::size_t index = 0UZ; index < samplesPerChannel; ++index) {
                        const std::size_t ringIndex = (oldest + index) % _windowSize;
                        perChannel[channel][index]  = _ring[channel * _windowSize + ringIndex];
                    }
                }

                visibleTags.reserve(_tags.size());
                for (const auto& tag : _tags) {
                    if (tag.absoluteIndex >= oldestAbsolute && tag.absoluteIndex < oldestAbsolute + samplesPerChannel) {
                        visibleTags.push_back(tag);
                    }
                }
            }
        }

        std::ostringstream os;
        os.precision(9);
        if constexpr (std::same_as<T, float>) {
            os << "{\"payload_format\":\"series-window-json-v1\",";
            os << "\"sample_type\":\"float32\",";
            os << "\"channels\":" << channelCount << ",";
            os << "\"samples_per_channel\":" << samplesPerChannel << ",";
            os << "\"layout\":\"channels_first\",";
            os << "\"data\":[";
            for (std::size_t channel = 0UZ; channel < channelCount; ++channel) {
                if (channel > 0UZ) {
                    os << ',';
                }
                os << '[';
                for (std::size_t index = 0UZ; index < samplesPerChannel; ++index) {
                    if (index > 0UZ) {
                        os << ',';
                    }
                    writeJsonNumber(os, perChannel[channel][index]);
                }
                os << ']';
            }
            os << ']';
            writeTagsJson(os, visibleTags, oldestAbsolute);
            os << '}';
        } else {
            os << "{\"payload_format\":\"series-window-json-v1\",";
            os << "\"sample_type\":\"complex64\",";
            os << "\"channels\":" << channelCount << ",";
            os << "\"samples_per_channel\":" << samplesPerChannel << ",";
            os << "\"layout\":\"channels_first_interleaved_complex\",";
            os << "\"data\":[";
            for (std::size_t channel = 0UZ; channel < channelCount; ++channel) {
                if (channel > 0UZ) {
                    os << ',';
                }
                os << '[';
                for (std::size_t index = 0UZ; index < samplesPerChannel; ++index) {
                    if (index > 0UZ) {
                        os << ',';
                    }
                    writeJsonNumber(os, perChannel[channel][index].real());
                    os << ',';
                    writeJsonNumber(os, perChannel[channel][index].imag());
                }
                os << ']';
            }
            os << ']';
            writeTagsJson(os, visibleTags, oldestAbsolute);
            os << '}';
        }

        return os.str();
    }

private:
    mutable std::mutex _mutex;
    std::size_t        _channels   = 1UZ;
    std::size_t        _windowSize = 1024UZ;
    SeriesWindowMode   _mode       = SeriesWindowMode::rolling;
    std::vector<T>     _ring;
    std::vector<T>     _published;
    std::vector<T>     _pending;
    struct WindowTag {
        std::size_t absoluteIndex = 0UZ;
        property_map map;
    };
    std::vector<WindowTag> _tags;
    std::vector<WindowTag> _publishedTags;
    std::size_t        _writeIndex = 0UZ;
    std::size_t        _filled     = 0UZ;
    std::size_t        _totalFrames = 0UZ;
    bool               _hasPublishedBuffer = false;
    std::size_t        _publishedFrames = 0UZ;
    std::size_t        _publishedOldestAbsolute = 0UZ;
    std::size_t        _lastPublishedTotalFrames = 0UZ;
    std::size_t        _snapshotVersion = 0UZ;

    static void writeJsonNumber(std::ostream& os, float value) {
        if (std::isfinite(value)) {
            os << value;
            return;
        }
        os << '0';
    }

    static void writeJsonString(std::ostream& os, std::string_view value) {
        os << '"';
        for (const char ch : value) {
            switch (ch) {
            case '"': os << "\\\""; break;
            case '\\': os << "\\\\"; break;
            case '\b': os << "\\b"; break;
            case '\f': os << "\\f"; break;
            case '\n': os << "\\n"; break;
            case '\r': os << "\\r"; break;
            case '\t': os << "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20U) {
                    constexpr char hex[] = "0123456789abcdef";
                    os << "\\u00";
                    os << hex[(static_cast<unsigned char>(ch) >> 4U) & 0x0FU];
                    os << hex[static_cast<unsigned char>(ch) & 0x0FU];
                } else {
                    os << ch;
                }
                break;
            }
        }
        os << '"';
    }

    static std::optional<std::string> stringValue(const property_map& map, std::string_view key) {
        const auto it = map.find(std::pmr::string(key));
        if (it == map.end() || !it->second.is_string()) {
            return std::nullopt;
        }
        return it->second.value_or(std::string{});
    }

    static std::string eventKeyForTag(const property_map& map) {
        if (auto key = stringValue(map, "key"); key && !key->empty()) {
            return *key;
        }
        for (const auto& [key, value] : map) {
            if (key != "label" && key != "key" && value.get_if<bool>() != nullptr) {
                return std::string(key);
            }
        }
        return map.empty() ? std::string("tag") : std::string(map.begin()->first);
    }

    static bool writeJsonScalarValue(std::ostream& os, const pmt::Value& value) {
        if (const auto* item = value.get_if<bool>()) {
            os << (*item ? "true" : "false");
            return true;
        }
        if (value.is_string()) {
            writeJsonString(os, value.value_or(std::string{}));
            return true;
        }
        if (const auto* item = value.get_if<std::int64_t>()) {
            os << *item;
            return true;
        }
        if (const auto* item = value.get_if<std::uint64_t>()) {
            os << *item;
            return true;
        }
        if (const auto* item = value.get_if<float>()) {
            if (std::isfinite(*item)) {
                os << *item;
            } else {
                os << "null";
            }
            return true;
        }
        if (const auto* item = value.get_if<double>()) {
            if (std::isfinite(*item)) {
                os << *item;
            } else {
                os << "null";
            }
            return true;
        }
        return false;
    }

    static void writeTagsJson(std::ostream& os, const std::vector<WindowTag>& tags, std::size_t oldestAbsolute) {
        if (tags.empty()) {
            return;
        }

        os << ",\"tags\":[";
        for (std::size_t index = 0UZ; index < tags.size(); ++index) {
            const auto& tag = tags[index];
            if (index > 0UZ) {
                os << ',';
            }

            const std::string key = eventKeyForTag(tag.map);
            const std::string label = stringValue(tag.map, "label").value_or(key);
            os << "{\"offset\":" << (tag.absoluteIndex - oldestAbsolute);
            os << ",\"key\":";
            writeJsonString(os, key);
            os << ",\"label\":";
            writeJsonString(os, label);

            const auto eventValueIt = tag.map.find(std::pmr::string(key));
            if (eventValueIt != tag.map.end()) {
                os << ",\"value\":";
                if (!writeJsonScalarValue(os, eventValueIt->second)) {
                    os << "null";
                }
            }

            bool wroteMetadata = false;
            for (const auto& [metadataKey, value] : tag.map) {
                if (metadataKey == "key" || metadataKey == "label" || metadataKey == std::pmr::string(key)) {
                    continue;
                }
                if (!wroteMetadata) {
                    os << ",\"metadata\":{";
                    wroteMetadata = true;
                } else {
                    os << ',';
                }
                writeJsonString(os, metadataKey);
                os << ':';
                if (!writeJsonScalarValue(os, value)) {
                    os << "null";
                }
            }
            if (wroteMetadata) {
                os << '}';
            }
            os << '}';
        }
        os << ']';
    }

    void trimTagsLocked() {
        const std::size_t oldestAbsolute = _totalFrames >= _windowSize ? _totalFrames - _windowSize : 0UZ;
        const auto firstKeep = std::ranges::find_if(_tags, [oldestAbsolute](const WindowTag& tag) {
            return tag.absoluteIndex >= oldestAbsolute;
        });
        _tags.erase(_tags.begin(), firstKeep);

        constexpr std::size_t maxTags = 256UZ;
        if (_tags.size() > maxTags) {
            _tags.erase(_tags.begin(), _tags.end() - static_cast<std::ptrdiff_t>(maxTags));
        }
    }

    void maybePublishBufferedSnapshotLocked() {
        if (_filled < _windowSize) {
            return;
        }
        if (_hasPublishedBuffer && _totalFrames - _lastPublishedTotalFrames < _windowSize) {
            return;
        }

        _publishedFrames = _windowSize;
        _publishedOldestAbsolute = _totalFrames - _windowSize;
        const std::size_t oldest = _writeIndex;
        for (std::size_t channel = 0UZ; channel < _channels; ++channel) {
            for (std::size_t index = 0UZ; index < _publishedFrames; ++index) {
                const std::size_t ringIndex = (oldest + index) % _windowSize;
                _published[channel * _windowSize + index] = _ring[channel * _windowSize + ringIndex];
            }
        }

        _publishedTags.clear();
        _publishedTags.reserve(_tags.size());
        for (const auto& tag : _tags) {
            if (tag.absoluteIndex >= _publishedOldestAbsolute && tag.absoluteIndex < _publishedOldestAbsolute + _publishedFrames) {
                _publishedTags.push_back(tag);
            }
        }

        _hasPublishedBuffer = true;
        _lastPublishedTotalFrames = _totalFrames;
        ++_snapshotVersion;
    }
};

struct ParsedHttpEndpoint {
    std::string   host;
    std::uint16_t port;
    std::string   path;
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

class SnapshotHttpService {
public:
    using JsonProvider = std::function<std::string()>;

    ~SnapshotHttpService() { stop(); }

    [[nodiscard]] bool start(const ParsedHttpEndpoint& endpoint, JsonProvider provider) {
        stop();

        _host      = endpoint.host;
        _port      = endpoint.port;
        _path      = endpoint.path;
        _provider  = std::move(provider);
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
    std::string                     _host{"127.0.0.1"};
    std::uint16_t                   _port{8080U};
    std::uint16_t                   _boundPort{0U};
    std::string                     _path{"/snapshot"};
    JsonProvider                    _provider;
    std::unique_ptr<httplib::Server> _server;
    std::thread                     _serverThread;
};

inline bool isHttpTransport(const SeriesTransport transport) {
    return transport == SeriesTransport::http_snapshot || transport == SeriesTransport::http_poll;
}

inline bool isWebSocketTransport(const SeriesTransport transport) {
    return transport == SeriesTransport::websocket;
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioSeriesSink", gr::studio::StudioSeriesSink, ([T]), [ float, std::complex<float> ])

template<detail::SupportedSample T>
struct StudioSeriesSink : Block<StudioSeriesSink<T>> {
    using Description = Doc<"@brief Studio 1D series sink with explicit transport configuration.">;

    PortIn<T> in;

    Annotated<detail::SeriesTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = detail::SeriesTransport::http_poll;
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18080/snapshot";
    Annotated<std::uint32_t, "update_ms", Doc<"Suggested update interval in milliseconds for http_poll and websocket transports">, Visible> update_ms = 250U;
    Annotated<gr::Size_t, "window_size", Doc<"Samples per channel kept in memory">, Visible> window_size = 1024UZ;
    Annotated<detail::SeriesWindowMode, "window_mode", Doc<"Window update mode">, Visible> window_mode = detail::SeriesWindowMode::rolling;
    Annotated<gr::Size_t, "channels", Doc<"Interleaved input channel count">, Visible> channels = 1UZ;
    Annotated<std::string, "plot_title", Doc<"Optional semantic plot title for Studio Application">, Visible> plot_title = "";
    Annotated<std::string, "x_label", Doc<"Optional semantic x-axis label for Studio Application">, Visible> x_label = "";
    Annotated<std::string, "y_label", Doc<"Optional semantic y-axis label for Studio Application">, Visible> y_label = "";
    Annotated<std::string, "series_labels", Doc<"Optional comma-separated series labels for Studio Application">, Visible> series_labels = "";
    Annotated<gr::Size_t, "max_labels", Doc<"Maximum visible tag labels in Studio Application">, Visible> max_labels = 100UZ;
    Annotated<bool, "autoscale", Doc<"Enable automatic axis scaling in Studio Application">, Visible> autoscale = true;
    Annotated<float, "y_min", Doc<"Optional y-axis minimum when autoscale is disabled">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Optional y-axis maximum when autoscale is disabled">, Visible> y_max = 0.0F;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(
        StudioSeriesSink,
        in,
        transport,
        endpoint,
        update_ms,
        window_size,
        window_mode,
        channels,
        plot_title,
        x_label,
        y_label,
        series_labels,
        max_labels,
        autoscale,
        y_min,
        y_max,
        topic);

    using Block<StudioSeriesSink<T>>::Block;

    void start() {
        _window.configure(
            static_cast<std::size_t>(channels),
            static_cast<std::size_t>(window_size),
            window_mode.value);
        startTransport();
    }

    void stop() {
        _http.stop();
        _websocket.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("channels") || new_settings.contains("window_size") || new_settings.contains("window_mode")) {
            _window.configure(
                static_cast<std::size_t>(channels),
                static_cast<std::size_t>(window_size),
                window_mode.value);
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            _window.pushInputTags(input);
            _window.pushInterleaved(std::span<const T>(input.data(), input.size()));
            publishWebSocketFrame();
            std::ignore = input.consume(input.size());
        }
        return work::Status::OK;
    }

    [[nodiscard]] std::string snapshotJson() const { return _window.snapshotJson(); }

private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = {};
        _lastWebSocketWindowVersion = 0UZ;

        if (detail::isWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
                std::ostringstream message;
                message << "StudioSeriesSink failed to start websocket transport endpoint at ";
                message << endpoint.value << " (parsed host=" << parsed.host << ", port=" << parsed.port << ", path=" << parsed.path << ")";
                const auto reason = _websocket.lastErrorMessage();
                if (!reason.empty()) {
                    message << ": " << reason;
                }
                throw gr::exception(message.str());
            }
            return;
        }

        if (!detail::isHttpTransport(transport.value)) {
            throw gr::exception("StudioSeriesSink currently supports only http_snapshot, http_poll, and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return snapshotJson(); })) {
            throw gr::exception("StudioSeriesSink failed to start HTTP transport endpoint.");
        }
    }

    detail::SeriesWindow<T>     _window{};
    detail::SnapshotHttpService _http{};
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};
    std::size_t _lastWebSocketWindowVersion = 0UZ;

    void publishWebSocketFrame() {
        if (!_websocket.isRunning()) {
            return;
        }

        const std::size_t windowVersion = _window.version();
        if (windowVersion == _lastWebSocketWindowVersion) {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const auto interval = std::chrono::milliseconds(std::max<std::uint32_t>(1U, update_ms));
        if (_lastWebSocketPublishAt != std::chrono::steady_clock::time_point{} &&
            now - _lastWebSocketPublishAt < interval) {
            return;
        }

        _lastWebSocketWindowVersion = windowVersion;
        _lastWebSocketPublishAt = now;
        _websocket.publishText(snapshotJson());
    }
};

} // namespace gr::studio
