// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/DataSet.hpp>

#if defined(__EMSCRIPTEN__)
#include <gnuradio-4.0/studio/StudioWasmTransport.hpp>
#else
#include <httplib.h>
#endif

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace gr::studio {

namespace detail {

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

struct ParsedHttpEndpoint {
    std::string   host;
    std::uint16_t port;
    std::string   path;
};

inline std::string normalizeSnapshotPath(const std::string& raw_path) {
    if (raw_path.empty()) {
        return "/snapshot";
    }
    if (raw_path.starts_with('/')) {
        return raw_path;
    }
    return "/" + raw_path;
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
    const std::string host_port = slash == std::string::npos ? remaining : remaining.substr(0UZ, slash);
    const std::string path = slash == std::string::npos ? "/snapshot" : normalizeSnapshotPath(remaining.substr(slash));

    std::string   host = "127.0.0.1";
    std::uint16_t port = 8080U;
    if (!host_port.empty()) {
        const std::size_t colon = host_port.rfind(':');
        if (colon == std::string::npos) {
            host = host_port;
        } else {
            host = host_port.substr(0UZ, colon);
            const std::string port_text = host_port.substr(colon + 1UZ);
            if (!port_text.empty()) {
                const int parsed = std::stoi(port_text);
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
        _bound_port = 0U;

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
        _bound_port = static_cast<std::uint16_t>(bound);

        _server_thread = std::thread([this]() {
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
        if (_server_thread.joinable()) {
            _server_thread.join();
        }
        _server.reset();
    }

private:
    std::string                       _host{"127.0.0.1"};
    std::uint16_t                     _port{8080U};
    std::uint16_t                     _bound_port{0U};
    std::string                       _path{"/snapshot"};
    JsonProvider                      _provider;
    std::unique_ptr<httplib::Server> _server;
    std::thread                       _server_thread;
};
#endif // defined(__EMSCRIPTEN__)

inline bool isHttpTransport(const std::string& transport) {
    return transport == "http_snapshot" || transport == "http_poll";
}

template<typename T>
class DataSetWindow {
public:
    void configure(std::size_t signal_index, std::size_t axis_index, std::size_t window_size) {
        std::lock_guard lock(_mutex);
        _signal_index = signal_index;
        _axis_index = axis_index;
        _window_size = std::max<std::size_t>(1UZ, window_size);
    }

    void push(std::span<const DataSet<T>> input) {
        if (input.empty()) {
            return;
        }
        std::lock_guard lock(_mutex);
        _latest = input.back();
        _has_data = true;
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::size_t signal_index = 0UZ;
        std::size_t axis_index = 0UZ;
        std::size_t window_size = 1024UZ;
        DataSet<T> copy;
        bool has_data = false;
        {
            std::lock_guard lock(_mutex);
            signal_index = _signal_index;
            axis_index = _axis_index;
            window_size = _window_size;
            copy = _latest;
            has_data = _has_data;
        }

        std::vector<T> x_values;
        std::vector<T> y_values;
        std::string signal_name;
        std::string signal_unit;
        std::string axis_name;
        std::string axis_unit;

        if (has_data) {
            try {
                auto y_span = copy.signalValues(signal_index);
                y_values.assign(y_span.begin(), y_span.end());
            } catch (...) {
                y_values.clear();
            }

            try {
                auto x_span = copy.axisValues(axis_index);
                x_values.assign(x_span.begin(), x_span.end());
            } catch (...) {
                x_values.clear();
            }

            if (x_values.empty()) {
                x_values.resize(y_values.size());
                for (std::size_t i = 0UZ; i < x_values.size(); ++i) {
                    x_values[i] = static_cast<T>(i);
                }
            }

            try {
                signal_name = std::string(copy.signalName(signal_index));
            } catch (...) {
                signal_name.clear();
            }
            if (signal_index < copy.signal_units.size()) {
                signal_unit = copy.signal_units[signal_index];
            }
            try {
                axis_name = std::string(copy.axisName(axis_index));
            } catch (...) {
                axis_name.clear();
            }
            if (axis_index < copy.axis_units.size()) {
                axis_unit = copy.axis_units[axis_index];
            }
        }

        const std::size_t n = std::min(x_values.size(), y_values.size());
        if (n == 0UZ) {
            return R"({"payload_format":"dataset-xy-json-v1","layout":"pairs_xy","points":0,"data":[]})";
        }

        const std::size_t clipped = std::min(n, window_size);
        const std::size_t begin = n - clipped;
        std::ostringstream os;
        os.precision(9);
        os << "{\"payload_format\":\"dataset-xy-json-v1\",";
        os << "\"layout\":\"pairs_xy\",";
        os << "\"points\":" << clipped << ",";
        if (!signal_name.empty()) {
            os << "\"signal_name\":\"" << escapeJson(signal_name) << "\",";
        }
        if (!signal_unit.empty()) {
            os << "\"signal_unit\":\"" << escapeJson(signal_unit) << "\",";
        }
        if (!axis_name.empty()) {
            os << "\"axis_name\":\"" << escapeJson(axis_name) << "\",";
        }
        if (!axis_unit.empty()) {
            os << "\"axis_unit\":\"" << escapeJson(axis_unit) << "\",";
        }
        os << "\"data\":[";
        for (std::size_t i = 0UZ; i < clipped; ++i) {
            if (i > 0UZ) {
                os << ',';
            }
            const std::size_t idx = begin + i;
            os << '[' << x_values[idx] << ',' << y_values[idx] << ']';
        }
        os << "]}";
        return os.str();
    }

private:
    mutable std::mutex _mutex;
    DataSet<T>         _latest{};
    bool               _has_data = false;
    std::size_t        _signal_index = 0UZ;
    std::size_t        _axis_index = 0UZ;
    std::size_t        _window_size = 1024UZ;
};

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioDataSetSink", gr::studio::StudioDataSetSink, [T], [ float, double ])

template<typename T>
struct StudioDataSetSink : Block<StudioDataSetSink<T>> {
    using Description = Doc<"@brief Studio DataSet sink with explicit transport configuration and dataset-xy-json-v1 payloads.">;

    PortIn<DataSet<T>> in;

    Annotated<std::string, "transport", Doc<"Data-plane transport mode">, Visible> transport = "http_poll";
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18084/snapshot";
    Annotated<std::uint32_t, "poll_ms", Doc<"Suggested poll interval in milliseconds for poll transports">, Visible> poll_ms = 250U;
    Annotated<gr::Size_t, "window_size", Doc<"Maximum XY points included in snapshot payload">, Visible> window_size = 1024UZ;
    Annotated<gr::Size_t, "signal_index", Doc<"Selected DataSet signal index">, Visible> signal_index = 0UZ;
    Annotated<gr::Size_t, "axis_index", Doc<"Selected DataSet axis index">, Visible> axis_index = 0UZ;
    Annotated<bool, "autoscale", Doc<"Enable automatic axis scaling in Studio Application">, Visible> autoscale = true;
    Annotated<float, "x_min", Doc<"Optional x-axis minimum when autoscale is disabled">, Visible> x_min = 0.0F;
    Annotated<float, "x_max", Doc<"Optional x-axis maximum when autoscale is disabled">, Visible> x_max = 0.0F;
    Annotated<float, "y_min", Doc<"Optional y-axis minimum when autoscale is disabled">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Optional y-axis maximum when autoscale is disabled">, Visible> y_max = 0.0F;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(StudioDataSetSink, in, transport, endpoint, poll_ms, window_size, signal_index, axis_index, autoscale, x_min, x_max, y_min, y_max, topic);

    using Block<StudioDataSetSink<T>>::Block;

    void start() {
        _window.configure(static_cast<std::size_t>(signal_index), static_cast<std::size_t>(axis_index), static_cast<std::size_t>(window_size));
        startTransport();
    }

    void stop() {
        _http.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("signal_index") || new_settings.contains("axis_index") || new_settings.contains("window_size")) {
            _window.configure(static_cast<std::size_t>(signal_index), static_cast<std::size_t>(axis_index), static_cast<std::size_t>(window_size));
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(std::span<const DataSet<T>>& input) noexcept {
        _window.push(input);
        return work::Status::OK;
    }

private:
    void startTransport() {
        if (!detail::isHttpTransport(transport.value)) {
            throw gr::exception("StudioDataSetSink currently supports only http_snapshot and http_poll transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return _window.snapshotJson(); })) {
            throw gr::exception("StudioDataSetSink failed to start HTTP transport endpoint.");
        }
    }

    detail::DataSetWindow<T>   _window{};
    detail::SnapshotHttpService _http{};
};

} // namespace gr::studio
