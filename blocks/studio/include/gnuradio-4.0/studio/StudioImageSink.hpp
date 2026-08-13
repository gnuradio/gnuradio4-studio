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
#include <concepts>
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
#include <utility>
#include <vector>

namespace gr::studio {

namespace detail {

template<typename T>
concept SupportedImageSample = std::same_as<T, std::uint8_t>;

class FrameWindow {
public:
    void configure(std::size_t width, std::size_t height, std::size_t channels) {
        std::lock_guard lock(_mutex);
        _width = std::max<std::size_t>(1UZ, width);
        _height = std::max<std::size_t>(1UZ, height);
        _channels = std::max<std::size_t>(1UZ, channels);
        _latestFrame.assign(frameSize(), 0U);
        _pending.clear();
        _hasFrame = false;
    }

    void push(std::span<const std::uint8_t> input) {
        if (input.empty()) {
            return;
        }

        std::lock_guard lock(_mutex);
        _pending.insert(_pending.end(), input.begin(), input.end());

        const std::size_t bytesPerFrame = frameSize();
        while (_pending.size() >= bytesPerFrame) {
            std::copy_n(_pending.begin(), static_cast<std::ptrdiff_t>(bytesPerFrame), _latestFrame.begin());
            _pending.erase(_pending.begin(), _pending.begin() + static_cast<std::ptrdiff_t>(bytesPerFrame));
            _hasFrame = true;
        }
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::vector<std::uint8_t> frame;
        std::size_t width = 0UZ;
        std::size_t height = 0UZ;
        std::size_t channels = 0UZ;
        bool hasFrame = false;

        {
            std::lock_guard lock(_mutex);
            width = _width;
            height = _height;
            channels = _channels;
            frame = _latestFrame;
            hasFrame = _hasFrame;
        }

        std::ostringstream os;
        os << "{\"sample_type\":\"uint8\",";
        os << "\"width\":" << width << ",";
        os << "\"height\":" << height << ",";
        os << "\"channels\":" << channels << ",";
        os << "\"layout\":\"row_major_interleaved\",";
        os << "\"has_frame\":" << (hasFrame ? "true" : "false") << ",";
        os << "\"data\":[";
        for (std::size_t index = 0UZ; index < frame.size(); ++index) {
            if (index > 0UZ) {
                os << ',';
            }
            os << static_cast<unsigned int>(frame[index]);
        }
        os << "]}";
        return os.str();
    }

private:
    [[nodiscard]] std::size_t frameSize() const { return _width * _height * _channels; }

    mutable std::mutex       _mutex;
    std::size_t              _width = 256UZ;
    std::size_t              _height = 256UZ;
    std::size_t              _channels = 1UZ;
    std::vector<std::uint8_t> _latestFrame;
    std::vector<std::uint8_t> _pending;
    bool                     _hasFrame = false;
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
    std::string                      _host{"127.0.0.1"};
    std::uint16_t                    _port{8080U};
    std::uint16_t                    _boundPort{0U};
    std::string                      _path{"/snapshot"};
    JsonProvider                     _provider;
    std::unique_ptr<httplib::Server> _server;
    std::thread                      _serverThread;
};
#endif // defined(__EMSCRIPTEN__)

inline bool isHttpTransport(const std::string& transport) {
    return transport == "http_snapshot" || transport == "http_poll";
}

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioImageSink", gr::studio::StudioImageSink, ([T]), [ std::uint8_t ])

template<detail::SupportedImageSample T>
struct StudioImageSink : Block<StudioImageSink<T>> {
    using Description = Doc<"@brief Studio image/frame sink with explicit transport configuration.">;

    PortIn<T> in;

    Annotated<std::string, "transport", Doc<"Data-plane transport mode">, Visible> transport = "http_poll";
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18082/snapshot";
    Annotated<std::uint32_t, "poll_ms", Doc<"Suggested poll interval in milliseconds for poll transports">, Visible> poll_ms = 250U;
    Annotated<gr::Size_t, "width", Doc<"Frame width in pixels">, Visible> width = 256UZ;
    Annotated<gr::Size_t, "height", Doc<"Frame height in pixels">, Visible> height = 256UZ;
    Annotated<gr::Size_t, "channels", Doc<"Channels per pixel (1=gray,3=rgb,4=rgba)">, Visible> channels = 1UZ;
    Annotated<bool, "autoscale", Doc<"Enable automatic axis scaling in Studio Application">, Visible> autoscale = true;
    Annotated<float, "x_min", Doc<"Optional x-axis minimum when autoscale is disabled">, Visible> x_min = 0.0F;
    Annotated<float, "x_max", Doc<"Optional x-axis maximum when autoscale is disabled">, Visible> x_max = 0.0F;
    Annotated<float, "y_min", Doc<"Optional y-axis minimum when autoscale is disabled">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Optional y-axis maximum when autoscale is disabled">, Visible> y_max = 0.0F;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(StudioImageSink, in, transport, endpoint, poll_ms, width, height, channels, autoscale, x_min, x_max, y_min, y_max, topic);

    using Block<StudioImageSink<T>>::Block;

    void start() {
        _window.configure(static_cast<std::size_t>(width), static_cast<std::size_t>(height), static_cast<std::size_t>(channels));
        startTransport();
    }

    void stop() { _http.stop(); }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("width") || new_settings.contains("height") || new_settings.contains("channels")) {
            _window.configure(static_cast<std::size_t>(width), static_cast<std::size_t>(height), static_cast<std::size_t>(channels));
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            _window.push(std::span<const std::uint8_t>(input.data(), input.size()));
            std::ignore = input.consume(input.size());
        }
        return work::Status::OK;
    }

private:
    void startTransport() {
        if (!detail::isHttpTransport(transport.value)) {
            throw gr::exception("StudioImageSink currently supports only http_snapshot and http_poll transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return _window.snapshotJson(); })) {
            throw gr::exception("StudioImageSink failed to start HTTP transport endpoint.");
        }
    }

    detail::FrameWindow        _window{};
    detail::SnapshotHttpService _http{};
};

} // namespace gr::studio
