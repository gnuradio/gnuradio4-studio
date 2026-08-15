// SPDX-License-Identifier: MIT

#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <string>
#include <thread>

#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/PluginLoader.hpp>
#include <gnuradio-4.0/studio/Studio2DSeriesSink.hpp>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace {

void testSeries2DRegistered() {
    const auto keys = gr::globalPluginLoader().availableBlocks();
    const bool found = std::ranges::any_of(keys, [](const std::string& key) {
        return key.find("Studio2DSeriesSink") != std::string::npos;
    });
    assert(found);
}

void testDefaultTransportAndCadence() {
    gr::studio::Studio2DSeriesSink<float> block{};
    assert(block.transport.value == gr::studio::detail::Series2DTransport::http_poll);
    assert(block.update_ms == 250U);
}

void testWebSocketTransportLifecycle() {
    gr::studio::Studio2DSeriesSink<float> block{};
    block.transport = gr::studio::detail::Series2DTransport::websocket;
    block.endpoint = "http://127.0.0.1:0/xy";
    block.update_ms = 10U;
    block.render_mode = "scatter";
    block.point_size = 6.0F;
    block.point_alpha = 0.5F;

    block.start();
    const std::string json = block.snapshotJson();
    assert(json.find("\"layout\":\"pairs_xy\"") != std::string::npos);
    assert(json.find("\"render_mode\":\"scatter\"") != std::string::npos);
    assert(json.find("\"point_size\":6") != std::string::npos);
    assert(json.find("\"point_alpha\":0.5") != std::string::npos);
    block.stop();
}

#if !defined(_WIN32)
void testWebSocketStopUnblocksIncompleteHandshake() {
    gr::studio::websocket_transport::SnapshotWebSocketService service{};
    assert(service.start("127.0.0.1", 0U, "/xy"));
    const auto port = service.boundPort();
    assert(port != 0U);

    const int clientFd = ::socket(AF_INET, SOCK_STREAM, 0);
    assert(clientFd >= 0);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    const int inetResult = ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
    assert(inetResult == 1);
    const int connectResult = ::connect(clientFd, reinterpret_cast<const sockaddr*>(&addr), sizeof(addr));
    assert(connectResult == 0);

    std::atomic_bool stopReturned = false;
    std::thread stopper([&]() {
        service.stop();
        stopReturned.store(true);
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    assert(stopReturned.load());

    stopper.join();
    ::close(clientFd);
}
#endif

} // namespace

int main() {
    testSeries2DRegistered();
    testDefaultTransportAndCadence();
    testWebSocketTransportLifecycle();
#if !defined(_WIN32)
    testWebSocketStopUnblocksIncompleteHandshake();
#endif
    return 0;
}
