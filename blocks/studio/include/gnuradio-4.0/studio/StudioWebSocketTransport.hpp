// SPDX-License-Identifier: MIT

#pragma once

#include <algorithm>
#include <array>
#include <bit>
#include <cerrno>
#include <condition_variable>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <functional>
#include <limits>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <tuple>
#include <unordered_map>
#include <utility>

#include <boost/beast/core/detail/base64.hpp>
#include <httplib.h>
#include <openssl/sha.h>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace gr::studio::websocket_transport {

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

enum class WebSocketFrameKind {
    Text,
    Binary,
};

class SnapshotWebSocketService {
public:
    SnapshotWebSocketService() = default;
    SnapshotWebSocketService(const SnapshotWebSocketService&) = delete;
    SnapshotWebSocketService& operator=(const SnapshotWebSocketService&) = delete;
    SnapshotWebSocketService(SnapshotWebSocketService&&) = delete;
    SnapshotWebSocketService& operator=(SnapshotWebSocketService&&) = delete;

    ~SnapshotWebSocketService() {
        stop();
    }

    [[nodiscard]] bool start(const std::string& host, std::uint16_t port, const std::string& path) {
        stop();

        _host = host;
        _port = port;
        _path = path.empty() ? "/snapshot" : path;
        _boundPort = 0U;
        _lastError.clear();
        _stopping = false;
        _hasPendingFrame = false;
        _pendingFrame.clear();
        _pendingFrameKind = WebSocketFrameKind::Text;

#if defined(_WIN32)
        _lastError = "websocket transport is not implemented on this platform";
        return false;
#else
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_flags = AI_PASSIVE;

        addrinfo* resolved = nullptr;
        const std::string portText = std::to_string(_port);
        if (const int rc = ::getaddrinfo(_host.empty() ? nullptr : _host.c_str(), portText.c_str(), &hints, &resolved); rc != 0 || resolved == nullptr) {
            _lastError = "getaddrinfo failed for websocket endpoint " + _host + ":" + portText + " (" + std::string(::gai_strerror(rc)) + ")";
            return false;
        }

        for (addrinfo* candidate = resolved; candidate != nullptr; candidate = candidate->ai_next) {
            int listenFd = ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
            if (listenFd < 0) {
                _lastError = "socket() failed for websocket endpoint " + _host + ":" + portText + " (" + std::string(std::strerror(errno)) + ")";
                continue;
            }

            configureSocket(listenFd);

            int reuseAddress = 1;
            std::ignore = ::setsockopt(listenFd, SOL_SOCKET, SO_REUSEADDR, &reuseAddress, sizeof(reuseAddress));

            if (::bind(listenFd, candidate->ai_addr, candidate->ai_addrlen) != 0) {
                _lastError = "bind() failed for websocket endpoint " + _host + ":" + portText + _path + " (" + std::string(std::strerror(errno)) + ")";
                closeSocket(listenFd);
                continue;
            }

            if (::listen(listenFd, 1) != 0) {
                _lastError = "listen() failed for websocket endpoint " + _host + ":" + portText + _path + " (" + std::string(std::strerror(errno)) + ")";
                closeSocket(listenFd);
                continue;
            }

            _listenFd = listenFd;
            break;
        }

        ::freeaddrinfo(resolved);
        if (_listenFd < 0) {
            if (_lastError.empty()) {
                _lastError = "Unable to bind websocket endpoint " + _host + ":" + portText + _path;
            }
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

        _acceptThread = std::thread([this]() {
            try {
                acceptLoop();
            } catch (const std::exception& error) {
                _lastError = std::string("acceptLoop thread exception: ") + error.what();
            } catch (...) {
                _lastError = "acceptLoop thread exception: unknown";
            }
        });

        _senderThread = std::thread([this]() {
            try {
                sendLoop();
            } catch (const std::exception& error) {
                _lastError = std::string("sendLoop thread exception: ") + error.what();
            } catch (...) {
                _lastError = "sendLoop thread exception: unknown";
            }
        });
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

    [[nodiscard]] const std::string& lastErrorMessage() const noexcept { return _lastError; }

    void publishText(std::string frame) { publish(std::move(frame), WebSocketFrameKind::Text); }

    void publishBinary(std::string frame) { publish(std::move(frame), WebSocketFrameKind::Binary); }

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

    bool writeFrame(int fd, std::string_view payload, WebSocketFrameKind kind) const {
        std::string frame;
        frame.reserve(payload.size() + 16UZ);
        frame.push_back(static_cast<char>(0x80 | (kind == WebSocketFrameKind::Binary ? 0x02 : 0x01)));
        appendWebSocketLength(frame, payload.size());
        frame.append(payload.begin(), payload.end());
        return sendAll(fd, frame);
    }

    bool performHandshake(int fd) const {
        const auto fail = [this](std::string reason) {
            _lastError = std::move(reason);
            return false;
        };

        std::string request;
        request.reserve(4096UZ);
        char buffer[1024];
        while (request.find("\r\n\r\n") == std::string::npos) {
            const auto received = ::recv(fd, buffer, sizeof(buffer), 0);
            if (received <= 0) {
                return fail("acceptLoop handshake failed: websocket request ended before headers were complete");
            }
            request.append(buffer, buffer + received);
            if (request.size() > 8192UZ) {
                return fail("acceptLoop handshake failed: websocket request headers exceeded 8192 bytes");
            }
        }

        const std::size_t headerEnd = request.find("\r\n\r\n");
        std::istringstream stream(request.substr(0UZ, headerEnd));
        std::string requestLine;
        if (!std::getline(stream, requestLine)) {
            return fail("acceptLoop handshake failed: missing websocket request line");
        }
        if (!requestLine.empty() && requestLine.back() == '\r') {
            requestLine.pop_back();
        }
        if (!requestLine.starts_with("GET ")) {
            return fail("acceptLoop handshake failed: websocket request line is not a GET");
        }

        const std::size_t pathEnd = requestLine.find(' ', 4UZ);
        if (pathEnd == std::string::npos) {
            return fail("acceptLoop handshake failed: websocket request line is malformed");
        }
        if (requestLine.substr(4UZ, pathEnd - 4UZ) != _path) {
            std::ostringstream os;
            os << "acceptLoop handshake failed: websocket path mismatch (expected " << _path
               << ", got " << requestLine.substr(4UZ, pathEnd - 4UZ) << ")";
            return fail(os.str());
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
            return fail("acceptLoop handshake failed: websocket upgrade headers are incomplete");
        }

        if (toLowerAscii(upgrade->second) != "websocket") {
            return fail("acceptLoop handshake failed: Upgrade header is not websocket");
        }
        const std::string connectionValue = toLowerAscii(connection->second);
        if (connectionValue.find("upgrade") == std::string::npos) {
            return fail("acceptLoop handshake failed: Connection header does not include upgrade");
        }

        const std::string accept = computeWebSocketAcceptKey(key->second);
        std::ostringstream response;
        response << "HTTP/1.1 101 Switching Protocols\r\n";
        response << "Upgrade: websocket\r\n";
        response << "Connection: Upgrade\r\n";
        response << "Sec-WebSocket-Accept: " << accept << "\r\n\r\n";
        if (!sendAll(fd, response.str())) {
            return fail("acceptLoop handshake failed: websocket handshake response could not be written");
        }
        return true;
    }

    void acceptLoop() {
        while (true) {
            sockaddr_storage clientAddr{};
            socklen_t clientAddrLen = sizeof(clientAddr);
            int clientFd = ::accept(_listenFd, reinterpret_cast<sockaddr*>(&clientAddr), &clientAddrLen);
            if (clientFd < 0) {
                std::lock_guard lock(_mutex);
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
            WebSocketFrameKind frameKind = WebSocketFrameKind::Text;
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
                frameKind = _pendingFrameKind;
                _hasPendingFrame = false;
            }

            if (!writeFrame(clientFd, frame, frameKind)) {
                std::lock_guard lock(_mutex);
                if (_clientFd == clientFd) {
                    closeSocket(_clientFd);
                } else {
                    closeSocket(clientFd);
                }
            }
        }
    }

    void publish(std::string frame, WebSocketFrameKind kind) {
        if (frame.empty()) {
            return;
        }

        {
            std::lock_guard lock(_mutex);
            if (_stopping) {
                return;
            }
            _pendingFrame = std::move(frame);
            _pendingFrameKind = kind;
            _hasPendingFrame = true;
        }
        _cv.notify_all();
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
    WebSocketFrameKind _pendingFrameKind{WebSocketFrameKind::Text};
    int _listenFd{-1};
    int _clientFd{-1};
    mutable std::string _lastError;
    std::thread _acceptThread;
    std::thread _senderThread;
#else
    std::string _host{"127.0.0.1"};
    std::uint16_t _port{8080U};
    std::uint16_t _boundPort{0U};
    std::string _path{"/snapshot"};
    mutable std::string _lastError;
#endif
};

} // namespace gr::studio::websocket_transport
