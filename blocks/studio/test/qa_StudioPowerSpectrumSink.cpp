// SPDX-License-Identifier: MIT

#include <cassert>
#include <array>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <complex>
#include <cstddef>
#include <span>
#include <string>
#include <thread>

#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/PluginLoader.hpp>
#include <gnuradio-4.0/Tag.hpp>
#include <gnuradio-4.0/studio/StudioPowerSpectrumSink.hpp>

#if !defined(_WIN32)
#include <arpa/inet.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace {

template<typename TBlock>
void configureBlock(TBlock& block) {
    block.fft_size = 4UZ;
    block.num_averages = 2UZ;
    block.window = gr::algorithm::window::Type::Rectangular;
    block.sample_rate = 8.0F;
    block.center_freq = 100.0F;
    block.update_ms = 125U;
    block.output_in_db = false;
    block.persistence = true;
    block.phosphor_intensity = 1.25F;
    block.phosphor_decay_ms = 750.0F;
    block.autoscale = false;
    block.y_min = -1.5F;
    block.y_max = 1.5F;

    block.settingsChanged({}, gr::property_map{
                                 {"fft_size", 4UZ},
                                 {"num_averages", 2UZ},
                                 {"window", std::string("Rectangular")},
                                 {"sample_rate", 8.0F},
                                 {"center_freq", 100.0F},
                                 {"update_ms", 125U},
                                 {"output_in_db", false},
                                 {"persistence", true},
                                 {"phosphor_intensity", 1.25F},
                                 {"phosphor_decay_ms", 750.0F},
                                 {"autoscale", false},
                                 {"y_min", -1.5F},
                                 {"y_max", 1.5F},
                             });
}

void testPowerSpectrumRegistered() {
    const auto keys = gr::globalPluginLoader().availableBlocks();
    const bool foundPowerSpectrum = std::ranges::any_of(keys, [](const std::string& key) {
        return key.find("StudioPowerSpectrumSink") != std::string::npos;
    });
    assert(foundPowerSpectrum);
}

void testDefaultTransportAndCadence() {
    gr::studio::StudioPowerSpectrumSink<float> block{};
    assert(block.transport.value == gr::studio::detail::PowerSpectrumTransport::websocket);
    assert(block.update_ms == 10U);
}

#if !defined(_WIN32)
void testWebSocketStopUnblocksIncompleteHandshake() {
    const auto endpoint = gr::studio::detail::parseHttpEndpoint("ws://127.0.0.1:0/stream");
    gr::studio::detail::SnapshotWebSocketService service{};
    assert(service.start(endpoint));
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

void testFloatSpectrum() {
    gr::studio::StudioPowerSpectrumSink<float> block{};
    configureBlock(block);
    assert(block.in.min_samples == 4UZ);
    assert(block.in.max_samples == 4UZ);

    const std::array<float, 4UZ> impulse{1.0F, 0.0F, 0.0F, 0.0F};
    const std::array<float, 4UZ> zeros{0.0F, 0.0F, 0.0F, 0.0F};
    block.processSamples(std::span<const float>(impulse));
    block.processSamples(std::span<const float>(zeros));

    const std::string json = block.snapshotJson();
    assert(json.find("\"payload_format\":\"dataset-xy-json-v1\"") != std::string::npos);
    assert(json.find("\"points\":2") != std::string::npos);
    assert(json.find("\"sample_rate\":8") != std::string::npos);
    assert(json.find("\"center_freq\":100") != std::string::npos);
    assert(json.find("\"update_ms\":125") != std::string::npos);
    assert(json.find("\"persistence\":true") != std::string::npos);
    assert(json.find("\"phosphor_intensity\":1.25") != std::string::npos);
    assert(json.find("\"phosphor_decay_ms\":750") != std::string::npos);
    assert(json.find("\"autoscale\":false") != std::string::npos);
    assert(json.find("\"x_min\"") == std::string::npos);
    assert(json.find("\"x_max\"") == std::string::npos);
    assert(json.find("\"y_min\":-1.5") != std::string::npos);
    assert(json.find("\"y_max\":1.5") != std::string::npos);
    assert(json.find("[100,0.25]") != std::string::npos);
    assert(json.find("[102,0.25]") != std::string::npos);
}

void testPowerSpectrumComputationIsThrottledByUpdateMs() {
    gr::studio::StudioPowerSpectrumSink<float> block{};
    configureBlock(block);

    const std::array<float, 4UZ> impulse{1.0F, 0.0F, 0.0F, 0.0F};
    const std::array<float, 4UZ> zeros{0.0F, 0.0F, 0.0F, 0.0F};
    block.processSamples(std::span<const float>(impulse));
    block.processSamples(std::span<const float>(zeros));

    std::string json = block.snapshotJson();
    assert(json.find("[100,0.25]") != std::string::npos);

    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    const std::array<float, 8UZ> consecutiveFrames{
        1.0F,
        0.0F,
        0.0F,
        0.0F,
        0.0F,
        0.0F,
        0.0F,
        0.0F,
    };
    block.processSamples(std::span<const float>(consecutiveFrames));

    json = block.snapshotJson();
    assert(json.find("[100,0.125]") != std::string::npos);
}

void testDbFloorIsFinite() {
    gr::studio::StudioPowerSpectrumSink<float> block{};
    configureBlock(block);
    block.output_in_db = true;
    block.settingsChanged({}, gr::property_map{{"fft_size", 4UZ}});

    const std::array<float, 4UZ> zeros{0.0F, 0.0F, 0.0F, 0.0F};
    block.processSamples(std::span<const float>(zeros));

    const std::string json = block.snapshotJson();
    assert(json.find("-3.40282e+38") == std::string::npos);
    assert(json.find("-160") != std::string::npos);
}

void testComplexSpectrum() {
    using Complex = std::complex<float>;

    gr::studio::StudioPowerSpectrumSink<Complex> block{};
    configureBlock(block);
    assert(block.in.min_samples == 4UZ);
    assert(block.in.max_samples == 4UZ);

    const std::array<Complex, 4UZ> impulse{
        Complex{1.0F, 0.0F},
        Complex{0.0F, 0.0F},
        Complex{0.0F, 0.0F},
        Complex{0.0F, 0.0F},
    };
    block.processSamples(std::span<const Complex>(impulse));

    const std::string json = block.snapshotJson();
    assert(json.find("\"payload_format\":\"dataset-xy-json-v1\"") != std::string::npos);
    assert(json.find("\"points\":4") != std::string::npos);
    assert(json.find("[96,0.25]") != std::string::npos);
    assert(json.find("[102,0.25]") != std::string::npos);
}

} // namespace

int main() {
    testPowerSpectrumRegistered();
    testDefaultTransportAndCadence();
#if !defined(_WIN32)
    testWebSocketStopUnblocksIncompleteHandshake();
#endif
    testFloatSpectrum();
    testPowerSpectrumComputationIsThrottledByUpdateMs();
    testDbFloorIsFinite();
    testComplexSpectrum();
    return 0;
}
