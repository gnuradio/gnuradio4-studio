// SPDX-License-Identifier: MIT

#ifndef GR4_STUDIO_TEST_LOOPBACK_CLIENT_HPP
#define GR4_STUDIO_TEST_LOOPBACK_CLIENT_HPP

#include <cstdint>

#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

namespace gr::studio::test {

// A TCP connection to 127.0.0.1:<port> that never sends anything, which leaves the server waiting
// part way through a websocket handshake.
class LoopbackClient {
    using Handle = websocket_transport::socket_api::Handle;

public:
    explicit LoopbackClient(std::uint16_t port) {
        namespace socket_api = websocket_transport::socket_api;
        _handle              = ::socket(AF_INET, SOCK_STREAM, 0);
        if (!socket_api::isValid(_handle)) {
            return;
        }

        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port   = htons(port);
        if (::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr) != 1 || ::connect(_handle, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr)) != 0) {
            socket_api::close(_handle);
        }
    }

    ~LoopbackClient() { websocket_transport::socket_api::close(_handle); }

    LoopbackClient(const LoopbackClient&)            = delete;
    LoopbackClient& operator=(const LoopbackClient&) = delete;

    [[nodiscard]] bool connected() const noexcept { return websocket_transport::socket_api::isValid(_handle); }

private:
    websocket_transport::socket_api::Session _session; // declared first so Winsock outlives the handle
    Handle                                   _handle{websocket_transport::socket_api::kInvalid};
};

} // namespace gr::studio::test

#endif // GR4_STUDIO_TEST_LOOPBACK_CLIENT_HPP
