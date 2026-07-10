// SPDX-License-Identifier: MIT

#include <array>
#include <algorithm>
#include <atomic>
#include <cassert>
#include <chrono>
#include <cmath>
#include <complex>
#include <limits>
#include <string>
#include <thread>

#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/Graph.hpp>
#include <gnuradio-4.0/Scheduler.hpp>
#include <gnuradio-4.0/studio/StudioSeriesSink.hpp>
#include <gnuradio-4.0/testing/NullSources.hpp>
#include <gnuradio-4.0/testing/TagMonitors.hpp>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace {

template<typename T, std::size_t N>
void pushSeriesInputs(
    gr::studio::detail::SeriesWindow<T>& window,
    const std::array<std::span<const T>, N>& inputs) {
    auto spans = inputs;
    const std::size_t sampleCount = std::ranges::min(spans | std::views::transform([](const auto input) { return input.size(); }));
    window.pushInputs(std::span(spans), sampleCount);
}

void testSeriesRegistered() {
    const auto keys = gr::globalBlockRegistry().keys();
    const bool foundSeries = std::ranges::any_of(keys, [](const std::string& key) {
        return key.find("StudioSeriesSink") != std::string::npos;
    });
    assert(foundSeries);
}

void testDefaultTransportAndCadence() {
    gr::studio::StudioSeriesSink<float> block{};
    assert(block.transport.value == gr::studio::detail::SeriesTransport::http_poll);
    assert(block.window_mode.value == gr::studio::detail::SeriesWindowMode::rolling);
    assert(block.update_ms == 250U);
    assert(block.n_inputs == 1UZ);
    assert(block.in.size() == 1UZ);
}

void testWebSocketTransportLifecycle() {
    gr::studio::StudioSeriesSink<float> block{};
    block.transport = gr::studio::detail::SeriesTransport::websocket;
    block.endpoint = "http://127.0.0.1:0/snapshot";
    block.update_ms = 10U;

    block.start();
    const std::string json = block.snapshotJson();
    assert(json.find("\"payload_format\":\"series-window-json-v1\"") != std::string::npos);
    assert(json.find("\"sample_type\":\"float32\"") != std::string::npos);
    block.stop();
}

void testSnapshotJsonSanitizesNonFiniteFloatSamples() {
    gr::studio::detail::SeriesWindow<float> window{1UZ, 4UZ};
    const float negativeNan = -std::numeric_limits<float>::quiet_NaN();
    const float samples[] = {
        1.0F,
        std::numeric_limits<float>::infinity(),
        -std::numeric_limits<float>::infinity(),
        negativeNan,
    };

    pushSeriesInputs(window, std::array{std::span<const float>(samples)});

    const std::string json = window.snapshotJson();
    assert(json.find("nan") == std::string::npos);
    assert(json.find("inf") == std::string::npos);
    assert(json.find("-nan") == std::string::npos);
    assert(json.find("-inf") == std::string::npos);
    assert(json.find("\"data\":[[1,0,0,0]]") != std::string::npos);
}

void testSnapshotJsonSanitizesNonFiniteComplexSamples() {
    gr::studio::detail::SeriesWindow<std::complex<float>> window{1UZ, 2UZ};
    const std::complex<float> samples[] = {
        {1.0F, std::numeric_limits<float>::quiet_NaN()},
        {-std::numeric_limits<float>::infinity(), 2.0F},
    };

    pushSeriesInputs(window, std::array{std::span<const std::complex<float>>(samples)});

    const std::string json = window.snapshotJson();
    assert(json.find("nan") == std::string::npos);
    assert(json.find("inf") == std::string::npos);
    assert(json.find("-inf") == std::string::npos);
    assert(json.find("\"data\":[[1,0,0,2]]") != std::string::npos);
}

void testSeriesSinkSerializesInputTags() {
    gr::Graph graph;
    auto& source = graph.emplaceBlock<gr::testing::TagSource<float, gr::testing::ProcessFunction::USE_PROCESS_BULK>>({
        {"n_samples_max", gr::Size_t{40UZ}},
        {"mark_tag", false},
    });
    source._tags.push_back(gr::Tag{
        25UZ,
        gr::property_map{
            {std::pmr::string("demo_tag"), true},
            {std::pmr::string("key"), std::string("demo_tag")},
            {std::pmr::string("label"), std::string("Demo tag")},
            {std::pmr::string("sample_index"), 25.0},
            {std::pmr::string("time_s"), 0.025},
            {std::pmr::string("value"), 0.707},
        },
    });

    auto& sink = graph.emplaceBlock<gr::studio::StudioSeriesSink<float>>();
    sink.transport = gr::studio::detail::SeriesTransport::http_poll;
    sink.endpoint = "http://127.0.0.1:0/snapshot";
    sink.window_size = 64UZ;

    assert(graph.connect(source, "out", sink, "in#0").has_value());
    gr::scheduler::Simple sched;
    assert(sched.exchange(std::move(graph)).has_value());
    assert(sched.runAndWait().has_value());

    const std::string json = sink.snapshotJson();
    assert(json.find("\"payload_format\":\"series-window-json-v1\"") != std::string::npos);
    assert(json.find("\"tags\":[") != std::string::npos);
    assert(json.find("\"offset\":25") != std::string::npos);
    assert(json.find("\"key\":\"demo_tag\"") != std::string::npos);
    assert(json.find("\"label\":\"Demo tag\"") != std::string::npos);
    assert(json.find("\"value\":true") != std::string::npos);
    assert(json.find("\"sample_index\":25") != std::string::npos);
    assert(json.find("\"time_s\":0.025") != std::string::npos);
}

void testSeriesSinkTagOffsetsFollowSlidingWindow() {
    gr::Graph graph;
    auto& source = graph.emplaceBlock<gr::testing::TagSource<float, gr::testing::ProcessFunction::USE_PROCESS_BULK>>({
        {"n_samples_max", gr::Size_t{300UZ}},
        {"mark_tag", false},
    });
    for (const std::size_t offset : {25UZ, 148UZ, 271UZ}) {
        source._tags.push_back(gr::Tag{
            offset,
            gr::property_map{
                {std::pmr::string("demo_tag"), true},
                {std::pmr::string("key"), std::string("demo_tag")},
                {std::pmr::string("label"), std::string("Demo tag")},
                {std::pmr::string("sample_index"), static_cast<double>(offset)},
            },
        });
    }

    auto& sink = graph.emplaceBlock<gr::studio::StudioSeriesSink<float>>();
    sink.transport = gr::studio::detail::SeriesTransport::http_poll;
    sink.endpoint = "http://127.0.0.1:0/snapshot";
    sink.window_size = 123UZ;

    assert(graph.connect(source, "out", sink, "in#0").has_value());
    gr::scheduler::Simple sched;
    assert(sched.exchange(std::move(graph)).has_value());
    assert(sched.runAndWait().has_value());

    const std::string json = sink.snapshotJson();
    assert(json.find("\"samples_per_channel\":123") != std::string::npos);
    assert(json.find("\"offset\":94") != std::string::npos);
    assert(json.find("\"sample_index\":271") != std::string::npos);
    assert(json.find("\"sample_index\":25") == std::string::npos);
    assert(json.find("\"sample_index\":148") == std::string::npos);
}

void testSeriesSinkPublishesOneSeriesPerInputPort() {
    gr::Graph graph;
    auto& first = graph.emplaceBlock<gr::testing::CountingSource<float>>({
        {"default_value", 0.0F},
        {"n_samples_max", gr::Size_t{4UZ}},
    });
    auto& second = graph.emplaceBlock<gr::testing::CountingSource<float>>({
        {"default_value", 100.0F},
        {"n_samples_max", gr::Size_t{4UZ}},
    });
    auto& sink = graph.emplaceBlock<gr::studio::StudioSeriesSink<float>>({
        {"n_inputs", gr::Size_t{2UZ}},
        {"transport", std::string("http_poll")},
        {"endpoint", std::string("http://127.0.0.1:0/snapshot")},
        {"window_size", gr::Size_t{4UZ}},
    });

    assert(sink.in.size() == 2UZ);
    assert(graph.connect(first, "out", sink, "in#0").has_value());
    assert(graph.connect(second, "out", sink, "in#1").has_value());

    gr::scheduler::Simple sched;
    assert(sched.exchange(std::move(graph)).has_value());
    assert(sched.runAndWait().has_value());

    const std::string json = sink.snapshotJson();
    assert(json.find("\"channels\":2") != std::string::npos);
    assert(json.find("\"samples_per_channel\":4") != std::string::npos);
    assert(json.find("\"data\":[[1,2,3,4],[101,102,103,104]]") != std::string::npos);
}

void testSeriesWindowRollingModePublishesLatestSamples() {
    gr::studio::detail::SeriesWindow<float> window{1UZ, 4UZ};
    const float samples[] = {1.0F, 2.0F, 3.0F, 4.0F, 5.0F};

    pushSeriesInputs(window, std::array{std::span<const float>(samples)});

    const std::string json = window.snapshotJson();
    assert(json.find("\"samples_per_channel\":4") != std::string::npos);
    assert(json.find("\"data\":[[2,3,4,5]]") != std::string::npos);
}

void testSeriesWindowBufferedModePublishesOnlyFullBuffers() {
    gr::studio::detail::SeriesWindow<float> window{1UZ, 4UZ, gr::studio::detail::SeriesWindowMode::buffered};
    const float firstPartial[] = {1.0F, 2.0F, 3.0F};
    const float completesFirst[] = {4.0F};
    const float secondPartial[] = {5.0F, 6.0F, 7.0F};
    const float completesSecond[] = {8.0F};
    const float oversizedThird[] = {9.0F, 10.0F, 11.0F, 12.0F, 13.0F};

    pushSeriesInputs(window, std::array{std::span<const float>(firstPartial)});
    std::string json = window.snapshotJson();
    assert(json.find("\"samples_per_channel\":0") != std::string::npos);
    assert(json.find("\"data\":[[]]") != std::string::npos);

    pushSeriesInputs(window, std::array{std::span<const float>(completesFirst)});
    json = window.snapshotJson();
    assert(json.find("\"samples_per_channel\":4") != std::string::npos);
    assert(json.find("\"data\":[[1,2,3,4]]") != std::string::npos);

    pushSeriesInputs(window, std::array{std::span<const float>(secondPartial)});
    json = window.snapshotJson();
    assert(json.find("\"data\":[[1,2,3,4]]") != std::string::npos);
    assert(json.find("\"data\":[[4,5,6,7]]") == std::string::npos);

    pushSeriesInputs(window, std::array{std::span<const float>(completesSecond)});
    json = window.snapshotJson();
    assert(json.find("\"data\":[[5,6,7,8]]") != std::string::npos);

    pushSeriesInputs(window, std::array{std::span<const float>(oversizedThird)});
    json = window.snapshotJson();
    assert(json.find("\"data\":[[9,10,11,12]]") != std::string::npos);
    assert(json.find("\"data\":[[10,11,12,13]]") == std::string::npos);
}

void testHttpTransportHelpers() {
    const auto parsed = gr::studio::detail::parseHttpEndpoint("http://127.0.0.1:18080/custom/snapshot");
    assert(parsed.host == "127.0.0.1");
    assert(parsed.port == 18080U);
    assert(parsed.path == "/custom/snapshot");

    const auto parsedWebSocket = gr::studio::detail::parseHttpEndpoint("ws://127.0.0.1:48055/stream");
    assert(parsedWebSocket.host == "127.0.0.1");
    assert(parsedWebSocket.port == 48055U);
    assert(parsedWebSocket.path == "/stream");

    assert(gr::studio::detail::isHttpTransport(gr::studio::detail::SeriesTransport::http_poll));
    assert(gr::studio::detail::isHttpTransport(gr::studio::detail::SeriesTransport::http_snapshot));
    assert(gr::studio::detail::isWebSocketTransport(gr::studio::detail::SeriesTransport::websocket));
    assert(!gr::studio::detail::isWebSocketTransport(gr::studio::detail::SeriesTransport::http_poll));
}

#if !defined(_WIN32)
void testWebSocketStopUnblocksIncompleteHandshake() {
    gr::studio::websocket_transport::SnapshotWebSocketService service{};
    assert(service.start("127.0.0.1", 0U, "/stream"));
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
    testSeriesSinkSerializesInputTags();
    testSeriesSinkTagOffsetsFollowSlidingWindow();
    testSeriesSinkPublishesOneSeriesPerInputPort();
    testSeriesWindowRollingModePublishesLatestSamples();
    testSeriesWindowBufferedModePublishesOnlyFullBuffers();
    testSeriesRegistered();
    testDefaultTransportAndCadence();
    testWebSocketTransportLifecycle();
    testSnapshotJsonSanitizesNonFiniteFloatSamples();
    testSnapshotJsonSanitizesNonFiniteComplexSamples();
    testHttpTransportHelpers();
#if !defined(_WIN32)
    testWebSocketStopUnblocksIncompleteHandshake();
#endif
    return 0;
}
