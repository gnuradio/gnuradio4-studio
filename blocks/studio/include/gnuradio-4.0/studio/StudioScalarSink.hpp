// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>

#include <gnuradio-4.0/studio/StudioSeriesSink.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace gr::studio {

namespace detail {

inline std::string trimScalarToken(std::string token) {
    const auto first = token.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) {
        return {};
    }
    const auto last = token.find_last_not_of(" \t\r\n");
    return token.substr(first, last - first + 1UZ);
}

inline std::vector<std::string> splitScalarCsv(std::string_view text) {
    std::vector<std::string> values;
    std::size_t              start = 0UZ;
    while (start <= text.size()) {
        const std::size_t comma = text.find(',', start);
        const std::size_t end   = comma == std::string_view::npos ? text.size() : comma;
        values.push_back(trimScalarToken(std::string(text.substr(start, end - start))));
        if (comma == std::string_view::npos) {
            break;
        }
        start = comma + 1UZ;
    }
    return values;
}

inline void writeJsonEscapedString(std::ostream& os, std::string_view value) {
    os << '"';
    for (const char ch : value) {
        switch (ch) {
        case '"':
            os << "\\\"";
            break;
        case '\\':
            os << "\\\\";
            break;
        case '\b':
            os << "\\b";
            break;
        case '\f':
            os << "\\f";
            break;
        case '\n':
            os << "\\n";
            break;
        case '\r':
            os << "\\r";
            break;
        case '\t':
            os << "\\t";
            break;
        default:
            if (static_cast<unsigned char>(ch) < 0x20U) {
                os << "\\u00";
                constexpr char hex[] = "0123456789abcdef";
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

class ScalarStatusSnapshot {
public:
    explicit ScalarStatusSnapshot(std::size_t channel_count = 1UZ) { configure(channel_count, "", ""); }

    void configure(std::size_t channel_count, std::string labels_csv, std::string units_csv) {
        std::lock_guard lock(_mutex);
        _channels = std::max<std::size_t>(1UZ, channel_count);
        _labels   = splitScalarCsv(labels_csv);
        _units    = splitScalarCsv(units_csv);
        _values.assign(_channels, 0.0F);
        _pending.clear();
        _sequence = 0ULL;
        _hasValue = false;
    }

    void pushInterleaved(std::span<const float> input) {
        if (input.empty()) {
            return;
        }

        std::lock_guard lock(_mutex);
        _pending.insert(_pending.end(), input.begin(), input.end());

        const std::size_t frames = _pending.size() / _channels;
        for (std::size_t frame = 0UZ; frame < frames; ++frame) {
            for (std::size_t channel = 0UZ; channel < _channels; ++channel) {
                const std::size_t srcIndex = frame * _channels + channel;
                _values[channel] = sanitize(_pending[srcIndex]);
            }
            ++_sequence;
            _hasValue = true;
        }

        const std::size_t consumed = frames * _channels;
        if (consumed > 0UZ) {
            _pending.erase(_pending.begin(), _pending.begin() + static_cast<std::ptrdiff_t>(consumed));
        }
    }

    [[nodiscard]] std::string snapshotJson(std::string_view presentation) const {
        std::vector<float>       values;
        std::vector<std::string> labels;
        std::vector<std::string> units;
        std::size_t              channels = 0UZ;
        std::uint64_t            sequence = 0ULL;
        bool                     hasValue = false;

        {
            std::lock_guard lock(_mutex);
            values   = _values;
            labels   = _labels;
            units    = _units;
            channels = _channels;
            sequence = _sequence;
            hasValue = _hasValue;
        }

        std::ostringstream os;
        os.precision(9);
        os << "{\"payload_format\":\"scalar-status-json-v1\",";
        os << "\"sample_type\":\"float32\",";
        os << "\"layout\":\"latest_scalars\",";
        os << "\"presentation\":";
        writeJsonEscapedString(os, presentation);
        os << ",\"channels\":" << channels << ",";
        os << "\"sequence\":" << sequence << ",";
        os << "\"has_value\":" << (hasValue ? "true" : "false") << ",";
        os << "\"labels\":[";
        for (std::size_t index = 0UZ; index < channels; ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            const std::string fallback = "Channel " + std::to_string(index + 1UZ);
            writeJsonEscapedString(os, index < labels.size() && !labels[index].empty() ? labels[index] : fallback);
        }
        os << "],\"units\":[";
        for (std::size_t index = 0UZ; index < channels; ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            writeJsonEscapedString(os, index < units.size() ? units[index] : "");
        }
        os << "],\"values\":[";
        for (std::size_t index = 0UZ; index < channels; ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            os << (index < values.size() ? values[index] : 0.0F);
        }
        os << "]}";
        return os.str();
    }

private:
    mutable std::mutex       _mutex;
    std::size_t              _channels = 1UZ;
    std::vector<std::string> _labels;
    std::vector<std::string> _units;
    std::vector<float>       _values;
    std::vector<float>       _pending;
    std::uint64_t            _sequence = 0ULL;
    bool                     _hasValue = false;

    static float sanitize(float value) {
        return std::isfinite(value) ? value : 0.0F;
    }
};

enum class ScalarStatusTransport {
    http_poll,
    websocket,
};

inline bool isScalarStatusWebSocketTransport(const ScalarStatusTransport transport) {
    return transport == ScalarStatusTransport::websocket;
}

inline bool isScalarStatusHttpTransport(const ScalarStatusTransport transport) {
    return transport == ScalarStatusTransport::http_poll;
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioScalarSink", gr::studio::StudioScalarSink, ([T]), [ float ])
GR_REGISTER_BLOCK("gr::studio::StudioStatusSink", gr::studio::StudioStatusSink, ([T]), [ float ])

template<typename T>
    requires std::same_as<T, float>
struct StudioScalarSink : Block<StudioScalarSink<T>> {
    using Description = Doc<"@brief Studio latest-value scalar sink for compact dashboards.">;

    PortIn<T> in;

    Annotated<detail::ScalarStatusTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = detail::ScalarStatusTransport::http_poll;
    Annotated<std::string, "endpoint", Doc<"Runtime-managed stream endpoint URL/path">> endpoint = "http://127.0.0.1:18080/scalars";
    Annotated<std::uint32_t, "update_ms", Doc<"Suggested update interval in milliseconds for http_poll and websocket transports">, Visible> update_ms = 250U;
    Annotated<gr::Size_t, "channels", Doc<"Interleaved input channel count">, Visible> channels = 1UZ;
    Annotated<std::string, "labels", Doc<"Comma-separated channel labels">, Visible> labels = "";
    Annotated<std::string, "units", Doc<"Comma-separated channel units">, Visible> units = "";
    Annotated<std::string, "title", Doc<"Optional semantic panel title for Studio Application">, Visible> title = "";
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(StudioScalarSink, in, transport, endpoint, update_ms, channels, labels, units, title, topic);

    using Block<StudioScalarSink<T>>::Block;

    void start() {
        _snapshot.configure(static_cast<std::size_t>(channels), labels.value, units.value);
        startTransport();
    }

    void stop() {
        _http.stop();
        _websocket.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("channels") || new_settings.contains("labels") || new_settings.contains("units")) {
            _snapshot.configure(static_cast<std::size_t>(channels), labels.value, units.value);
        }
        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] std::string snapshotJson() const { return _snapshot.snapshotJson("scalar"); }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            _snapshot.pushInterleaved(std::span<const float>(input.data(), input.size()));
            publishWebSocketFrame();
            std::ignore = input.consume(input.size());
        }
        return work::Status::OK;
    }

private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = {};

        if (detail::isScalarStatusWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
                throw gr::exception("StudioScalarSink failed to start websocket transport endpoint.");
            }
            return;
        }

        if (!detail::isScalarStatusHttpTransport(transport.value)) {
            throw gr::exception("StudioScalarSink currently supports only http_poll and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return snapshotJson(); })) {
            throw gr::exception("StudioScalarSink failed to start HTTP transport endpoint.");
        }
    }

    void publishWebSocketFrame() {
        if (!_websocket.isRunning()) {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const auto interval = std::chrono::milliseconds(std::max<std::uint32_t>(1U, update_ms));
        if (_lastWebSocketPublishAt != std::chrono::steady_clock::time_point{} && now - _lastWebSocketPublishAt < interval) {
            return;
        }

        _lastWebSocketPublishAt = now;
        _websocket.publishText(snapshotJson());
    }

    detail::ScalarStatusSnapshot _snapshot{};
    detail::SnapshotHttpService  _http{};
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};
};

template<typename T>
    requires std::same_as<T, float>
struct StudioStatusSink : Block<StudioStatusSink<T>> {
    using Description = Doc<"@brief Studio latest-value status sink for compact dashboards.">;

    PortIn<T> in;

    Annotated<detail::ScalarStatusTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = detail::ScalarStatusTransport::http_poll;
    Annotated<std::string, "endpoint", Doc<"Runtime-managed stream endpoint URL/path">> endpoint = "http://127.0.0.1:18080/status";
    Annotated<std::uint32_t, "update_ms", Doc<"Suggested update interval in milliseconds for http_poll and websocket transports">, Visible> update_ms = 250U;
    Annotated<gr::Size_t, "channels", Doc<"Interleaved input channel count">, Visible> channels = 1UZ;
    Annotated<std::string, "labels", Doc<"Comma-separated channel labels">, Visible> labels = "";
    Annotated<std::string, "units", Doc<"Comma-separated channel units">, Visible> units = "";
    Annotated<std::string, "title", Doc<"Optional semantic panel title for Studio Application">, Visible> title = "";
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(StudioStatusSink, in, transport, endpoint, update_ms, channels, labels, units, title, topic);

    using Block<StudioStatusSink<T>>::Block;

    void start() {
        _snapshot.configure(static_cast<std::size_t>(channels), labels.value, units.value);
        startTransport();
    }

    void stop() {
        _http.stop();
        _websocket.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("channels") || new_settings.contains("labels") || new_settings.contains("units")) {
            _snapshot.configure(static_cast<std::size_t>(channels), labels.value, units.value);
        }
        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] std::string snapshotJson() const { return _snapshot.snapshotJson("status"); }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            _snapshot.pushInterleaved(std::span<const float>(input.data(), input.size()));
            publishWebSocketFrame();
            std::ignore = input.consume(input.size());
        }
        return work::Status::OK;
    }

private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = {};

        if (detail::isScalarStatusWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
                throw gr::exception("StudioStatusSink failed to start websocket transport endpoint.");
            }
            return;
        }

        if (!detail::isScalarStatusHttpTransport(transport.value)) {
            throw gr::exception("StudioStatusSink currently supports only http_poll and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return snapshotJson(); })) {
            throw gr::exception("StudioStatusSink failed to start HTTP transport endpoint.");
        }
    }

    void publishWebSocketFrame() {
        if (!_websocket.isRunning()) {
            return;
        }

        const auto now = std::chrono::steady_clock::now();
        const auto interval = std::chrono::milliseconds(std::max<std::uint32_t>(1U, update_ms));
        if (_lastWebSocketPublishAt != std::chrono::steady_clock::time_point{} && now - _lastWebSocketPublishAt < interval) {
            return;
        }

        _lastWebSocketPublishAt = now;
        _websocket.publishText(snapshotJson());
    }

    detail::ScalarStatusSnapshot _snapshot{};
    detail::SnapshotHttpService  _http{};
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};
};

} // namespace gr::studio
