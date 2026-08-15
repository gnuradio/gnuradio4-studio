// SPDX-License-Identifier: MIT

#include <cassert>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <ranges>
#include <string>

#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/PluginLoader.hpp>
#include <gnuradio-4.0/studio/StudioAudioSink.hpp>

namespace {

template<typename T>
T readLittleEndian(const std::string& payload, std::size_t offset) {
    T value{};
    std::memcpy(&value, payload.data() + offset, sizeof(T));
    return value;
}

void testAudioSinkRegistered() {
    const auto keys = gr::globalPluginLoader().availableBlocks();
    const bool found = std::ranges::any_of(keys, [](const std::string& key) {
        return key.find("StudioAudioSink") != std::string::npos;
    });
    assert(found);
}

void testEndpointParsing() {
    const auto parsed = gr::studio::audio_sink_detail::parseEndpoint("ws://127.0.0.1:19084/live/audio");
    assert(parsed.host == "127.0.0.1");
    assert(parsed.port == 19084U);
    assert(parsed.path == "/live/audio");

    const auto defaultPath = gr::studio::audio_sink_detail::parseEndpoint("127.0.0.1:19084");
    assert(defaultPath.path == "/audio");
}

void testAudioFrameLayoutAndSanitization() {
    const float samples[] = {
        0.25F,
        2.0F,
        -2.0F,
        std::numeric_limits<float>::quiet_NaN(),
    };
    const std::string frame = gr::studio::audio_sink_detail::makeAudioFrame(
        std::span<const float>(samples),
        2U,
        48000U,
        2U,
        42U,
        123456789U,
        true);

    assert(frame.size() == 36UZ + 4UZ * sizeof(float));
    assert(readLittleEndian<std::uint32_t>(frame, 0UZ) == 0x44554153U);
    assert(readLittleEndian<std::uint16_t>(frame, 4UZ) == 1U);
    assert(readLittleEndian<std::uint16_t>(frame, 6UZ) == 0U);
    assert(readLittleEndian<std::uint16_t>(frame, 8UZ) == 2U);
    assert(readLittleEndian<std::uint16_t>(frame, 10UZ) == 1U);
    assert(readLittleEndian<std::uint32_t>(frame, 12UZ) == 48000U);
    assert(readLittleEndian<std::uint32_t>(frame, 16UZ) == 2U);
    assert(readLittleEndian<std::uint64_t>(frame, 20UZ) == 42U);
    assert(readLittleEndian<std::uint64_t>(frame, 28UZ) == 123456789U);

    assert(readLittleEndian<float>(frame, 36UZ) == 0.25F);
    assert(readLittleEndian<float>(frame, 40UZ) == 1.0F);
    assert(readLittleEndian<float>(frame, 44UZ) == -1.0F);
    assert(readLittleEndian<float>(frame, 48UZ) == 0.0F);
}

} // namespace

int main() {
    testAudioSinkRegistered();
    testEndpointParsing();
    testAudioFrameLayoutAndSanitization();
    return 0;
}
