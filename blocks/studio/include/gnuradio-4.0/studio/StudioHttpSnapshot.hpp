// SPDX-License-Identifier: MIT

#pragma once

// The pull side every studio sink shares: parsing the block's endpoint parameter and serving the
// latest JSON snapshot over HTTP. Natively that is a cpp-httplib server; the Emscripten build hands
// snapshots to the in-process registry in StudioWasmTransport.hpp instead.

#if defined(__EMSCRIPTEN__)
#include <gnuradio-4.0/studio/StudioWasmTransport.hpp>
#else
#include <httplib.h>
#endif

#include <cstddef>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <string>
#include <string_view>
#include <thread>
#include <utility>

namespace gr::studio::detail {

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

// for sinks whose transport parameter is a plain string
inline bool isHttpTransport(const std::string& transport) {
    return transport == "http_snapshot" || transport == "http_poll";
}

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

    const std::size_t slash    = remaining.find('/');
    const std::string hostPort = slash == std::string::npos ? remaining : remaining.substr(0UZ, slash);
    const std::string path     = slash == std::string::npos ? "/snapshot" : normalizeSnapshotPath(remaining.substr(slash));

    std::string   host = "127.0.0.1";
    std::uint16_t port = 8080U;
    if (!hostPort.empty()) {
        const std::size_t colon = hostPort.rfind(':');
        if (colon == std::string::npos) {
            host = hostPort;
        } else {
            host                       = hostPort.substr(0UZ, colon);
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
        // httplib's stop() does nothing until the server is listening, so a stop() that came first would
        // leave the thread listening and stop()'s join waiting for it forever
        _server->wait_until_ready();
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

} // namespace gr::studio::detail
