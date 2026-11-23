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

#include "LoopbackClient.hpp"

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
    assert(block.transport.value == gr::studio::detail::Series2DTransport::websocket);
    assert(block.update_ms == 50U);
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

void testWebSocketStopUnblocksIncompleteHandshake() {
    gr::studio::websocket_transport::SnapshotWebSocketService service{};
    assert(service.start("127.0.0.1", 0U, "/xy"));
    const auto port = service.boundPort();
    assert(port != 0U);

    const gr::studio::test::LoopbackClient client{port};
    assert(client.connected());

    std::atomic_bool stopReturned = false;
    std::thread stopper([&]() {
        service.stop();
        stopReturned.store(true);
    });

    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    assert(stopReturned.load());

    stopper.join();
}

} // namespace

int main() {
    testSeries2DRegistered();
    testDefaultTransportAndCadence();
    testWebSocketTransportLifecycle();
    testWebSocketStopUnblocksIncompleteHandshake();
    return 0;
}
