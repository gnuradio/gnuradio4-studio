// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>

#include <algorithm>
#include <complex>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <cmath>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <gnuradio-4.0/studio/StudioHttpSnapshot.hpp>
#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

namespace gr::studio {

namespace detail {

template<typename T>
concept Supported2DSample = std::same_as<T, float> || std::same_as<T, std::complex<float>>;

enum class Series2DTransport {
    http_snapshot,
    http_poll,
    websocket,
};

struct XYPoint {
    float x = 0.0F;
    float y = 0.0F;
};

class XYPointWindow {
public:
    explicit XYPointWindow(std::size_t window_size = 1024UZ) { configure(window_size); }

    void configure(std::size_t window_size) {
        std::lock_guard lock(_mutex);
        _windowSize = std::max<std::size_t>(1UZ, window_size);
        _ring.assign(_windowSize, XYPoint{});
        _pendingFloat.clear();
        _writeIndex = 0UZ;
        _filled     = 0UZ;
    }

    void pushFloatSamples(std::span<const float> input) {
        if (input.empty()) {
            return;
        }

        std::lock_guard lock(_mutex);
        _pendingFloat.insert(_pendingFloat.end(), input.begin(), input.end());

        const std::size_t pairs = _pendingFloat.size() / 2UZ;
        for (std::size_t index = 0UZ; index < pairs; ++index) {
            const float x = _pendingFloat[index * 2UZ];
            const float y = _pendingFloat[index * 2UZ + 1UZ];
            _ring[_writeIndex] = XYPoint{x, y};
            _writeIndex = (_writeIndex + 1UZ) % _windowSize;
            if (_filled < _windowSize) {
                ++_filled;
            }
        }

        const std::size_t consumed = pairs * 2UZ;
        if (consumed > 0UZ) {
            _pendingFloat.erase(_pendingFloat.begin(), _pendingFloat.begin() + static_cast<std::ptrdiff_t>(consumed));
        }
    }

    void pushComplexSamples(std::span<const std::complex<float>> input) {
        if (input.empty()) {
            return;
        }

        std::lock_guard lock(_mutex);
        for (const auto& value : input) {
            _ring[_writeIndex] = XYPoint{value.real(), value.imag()};
            _writeIndex = (_writeIndex + 1UZ) % _windowSize;
            if (_filled < _windowSize) {
                ++_filled;
            }
        }
    }

    [[nodiscard]] std::string snapshotJson(const char* sample_type,
                                           std::string_view render_mode,
                                           float point_size,
                                           float point_alpha) const {
        std::vector<XYPoint> points;
        points.reserve(_filled);
        {
            std::lock_guard lock(_mutex);
            const std::size_t oldest = (_filled == _windowSize) ? _writeIndex : 0UZ;
            for (std::size_t index = 0UZ; index < _filled; ++index) {
                const std::size_t ringIndex = (oldest + index) % _windowSize;
                points.push_back(_ring[ringIndex]);
            }
        }

        std::ostringstream os;
        os.precision(9);
        os << "{\"sample_type\":\"" << sample_type << "\",";
        os << "\"points\":" << points.size() << ",";
        os << "\"layout\":\"pairs_xy\",";
        os << "\"render_mode\":\"" << render_mode << "\",";
        if (std::isfinite(point_size) && point_size > 0.0F) {
            os << "\"point_size\":" << point_size << ",";
        }
        if (std::isfinite(point_alpha)) {
            const float clamped = std::clamp(point_alpha, 0.0F, 1.0F);
            os << "\"point_alpha\":" << clamped << ",";
        }
        os << "\"data\":[";
        for (std::size_t index = 0UZ; index < points.size(); ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            os << '[' << points[index].x << ',' << points[index].y << ']';
        }
        os << "]}";
        return os.str();
    }

private:
    mutable std::mutex _mutex;
    std::size_t        _windowSize = 1024UZ;
    std::vector<XYPoint> _ring;
    std::vector<float> _pendingFloat;
    std::size_t        _writeIndex = 0UZ;
    std::size_t        _filled     = 0UZ;
};

inline bool isHttpTransport(const Series2DTransport transport) {
    return transport == Series2DTransport::http_snapshot || transport == Series2DTransport::http_poll;
}

inline bool isWebSocketTransport(const Series2DTransport transport) {
    return transport == Series2DTransport::websocket;
}

inline std::string_view normalizeRenderMode(std::string_view render_mode) {
    return render_mode == "scatter" ? "scatter" : "line";
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::Studio2DSeriesSink", gr::studio::Studio2DSeriesSink, ([T]), [ float, std::complex<float> ])

template<detail::Supported2DSample T>
struct Studio2DSeriesSink : Block<Studio2DSeriesSink<T>> {
    using Description = Doc<"@brief Displays XY pairs or complex samples as a line or scatter plot.">;

    PortIn<T> in;

    Annotated<detail::Series2DTransport, "transport", Doc<"Connection method">, Visible> transport = detail::Series2DTransport::websocket;
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18081/snapshot";
    Annotated<std::uint32_t, "update_ms", Doc<"Display update interval in milliseconds; independent of the input sample rate">, Visible> update_ms = 50U;
    Annotated<gr::Size_t, "window_size", Doc<"Number of XY points displayed">, Visible> window_size = 1024UZ;
    Annotated<std::string, "render_mode", Doc<"Plot style: line or scatter">, Visible> render_mode = "line";
    Annotated<float, "point_size", Doc<"Scatter point diameter in pixels">, Visible> point_size = 4.0F;
    Annotated<float, "point_alpha", Doc<"Scatter point opacity from 0 (transparent) to 1 (opaque)">, Visible> point_alpha = 0.9F;
    Annotated<gr::Size_t, "max_labels", Doc<"Maximum number of displayed tag labels">, Visible> max_labels = 100UZ;
    Annotated<bool, "autoscale", Doc<"Scale the plotted values automatically">, Visible> autoscale = true;
    Annotated<float, "x_min", Doc<"Horizontal axis minimum with automatic scaling off">, Visible> x_min = -2.0F;
    Annotated<float, "x_max", Doc<"Horizontal axis maximum with automatic scaling off">, Visible> x_max = 2.0F;
    Annotated<float, "y_min", Doc<"Vertical axis minimum with automatic scaling off">, Visible> y_min = -2.0F;
    Annotated<float, "y_max", Doc<"Vertical axis maximum with automatic scaling off">, Visible> y_max = 2.0F;
    Annotated<std::string, "topic", Doc<"Reserved topic setting">> topic = "";

    GR_MAKE_REFLECTABLE(Studio2DSeriesSink, in, transport, endpoint, update_ms, window_size, render_mode, point_size, point_alpha, max_labels, autoscale, x_min, x_max, y_min, y_max, topic);

    using Block<Studio2DSeriesSink<T>>::Block;

    void start() {
        _window.configure(static_cast<std::size_t>(window_size));
        startTransport();
    }

    void stop() {
        _http.stop();
        _websocket.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("window_size")) {
            _window.configure(static_cast<std::size_t>(window_size));
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (input.empty()) {
            return work::Status::OK;
        }

        if constexpr (std::same_as<T, float>) {
            _window.pushFloatSamples(std::span<const float>(input.data(), input.size()));
        } else {
            _window.pushComplexSamples(std::span<const std::complex<float>>(input.data(), input.size()));
        }
        publishWebSocketFrame();
        std::ignore = input.consume(input.size());
        return work::Status::OK;
    }

    [[nodiscard]] std::string snapshotJson() const {
        const char* sampleType = std::same_as<T, float> ? "xy_float32" : "xy_complex64";
        return _window.snapshotJson(sampleType, detail::normalizeRenderMode(render_mode.value), point_size, point_alpha);
    }

private:
    void startTransport() {
        _http.stop();
        _websocket.stop();
        _lastWebSocketPublishAt = {};

        if (detail::isWebSocketTransport(transport.value)) {
            const auto parsed = detail::parseHttpEndpoint(endpoint.value);
            if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
                std::ostringstream message;
                message << "Studio2DSeriesSink failed to start websocket transport endpoint at ";
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
            throw gr::exception("Studio2DSeriesSink currently supports only http_snapshot, http_poll, and websocket transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed,
                         [this]() {
                             return snapshotJson();
                         })) {
            throw gr::exception("Studio2DSeriesSink failed to start HTTP transport endpoint.");
        }
    }

    detail::XYPointWindow      _window{};
    detail::SnapshotHttpService _http{};
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::chrono::steady_clock::time_point _lastWebSocketPublishAt{};

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
        _websocket.publishText(snapshotJson());
    }
};

} // namespace gr::studio
