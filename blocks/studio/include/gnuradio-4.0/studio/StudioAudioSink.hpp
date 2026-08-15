// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/studio/StudioWebSocketTransport.hpp>

#include <algorithm>
#include <bit>
#include <chrono>
#include <cmath>
#include <concepts>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace gr::studio {

namespace audio_sink_detail {

enum class AudioSinkTransport {
    websocket,
};

template<typename T>
concept SupportedAudioSinkSample = std::same_as<T, float>;

struct ParsedEndpoint {
    std::string host;
    std::uint16_t port;
    std::string path;
};

inline std::string normalizePath(const std::string& rawPath) {
    if (rawPath.empty()) {
        return "/audio";
    }
    if (rawPath.starts_with('/')) {
        return rawPath;
    }
    return "/" + rawPath;
}

inline ParsedEndpoint parseEndpoint(const std::string& endpoint) {
    std::string remaining = endpoint;
    for (const std::string_view prefix : {"http://", "https://", "ws://", "wss://"}) {
        if (remaining.starts_with(prefix)) {
            remaining.erase(0UZ, prefix.size());
            break;
        }
    }

    const std::size_t slash = remaining.find('/');
    const std::string hostPort = slash == std::string::npos ? remaining : remaining.substr(0UZ, slash);
    const std::string path = slash == std::string::npos ? "/audio" : normalizePath(remaining.substr(slash));

    std::string host = "127.0.0.1";
    std::uint16_t port = 18084U;
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

    return ParsedEndpoint{
        .host = host,
        .port = port,
        .path = path,
    };
}

template<typename T>
void appendLittleEndian(std::string& out, T value) {
    static_assert(std::is_integral_v<T> || std::is_floating_point_v<T>);
    const auto* bytes = reinterpret_cast<const unsigned char*>(&value);
    if constexpr (std::endian::native == std::endian::little) {
        out.append(reinterpret_cast<const char*>(bytes), sizeof(T));
    } else {
        for (std::size_t index = 0UZ; index < sizeof(T); ++index) {
            out.push_back(static_cast<char>(bytes[sizeof(T) - 1UZ - index]));
        }
    }
}

inline float sanitizeSample(float value, bool clip) noexcept {
    if (!std::isfinite(value)) {
        return 0.0F;
    }
    if (clip) {
        return std::clamp(value, -1.0F, 1.0F);
    }
    return value;
}

inline std::uint64_t timestampNowNs() {
    const auto now = std::chrono::steady_clock::now().time_since_epoch();
    return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(now).count());
}

inline std::string makeAudioFrame(
    std::span<const float> samples,
    std::uint16_t channels,
    std::uint32_t sampleRate,
    std::uint32_t frames,
    std::uint64_t sequence,
    std::uint64_t timestampNs,
    bool clip) {
    std::string payload;
    payload.reserve(36UZ + samples.size() * sizeof(float));
    appendLittleEndian<std::uint32_t>(payload, 0x44554153U); // "SAUD"
    appendLittleEndian<std::uint16_t>(payload, 1U);
    appendLittleEndian<std::uint16_t>(payload, 0U);
    appendLittleEndian<std::uint16_t>(payload, channels);
    appendLittleEndian<std::uint16_t>(payload, 1U); // float32
    appendLittleEndian<std::uint32_t>(payload, sampleRate);
    appendLittleEndian<std::uint32_t>(payload, frames);
    appendLittleEndian<std::uint64_t>(payload, sequence);
    appendLittleEndian<std::uint64_t>(payload, timestampNs);
    for (float sample : samples) {
        appendLittleEndian<float>(payload, sanitizeSample(sample, clip));
    }
    return payload;
}

} // namespace audio_sink_detail

GR_REGISTER_BLOCK("gr::studio::StudioAudioSink", gr::studio::StudioAudioSink, ([T]), [ float ])

template<audio_sink_detail::SupportedAudioSinkSample T>
struct StudioAudioSink : Block<StudioAudioSink<T>> {
    using Description = Doc<"@brief Studio websocket audio playback sink for interleaved float32 audio.">;

    PortIn<T> in;

    Annotated<audio_sink_detail::AudioSinkTransport, "transport", Doc<"Data-plane transport mode">, Visible> transport = audio_sink_detail::AudioSinkTransport::websocket;
    Annotated<std::string, "endpoint", Doc<"WebSocket endpoint URL/path">, Visible> endpoint = "ws://127.0.0.1:18084/audio";
    Annotated<std::uint32_t, "sample_rate", Doc<"Audio sample rate in Hz">, Visible> sample_rate = 48000U;
    Annotated<gr::Size_t, "channels", Doc<"Interleaved audio channel count">, Visible> channels = 1UZ;
    Annotated<std::uint32_t, "frame_ms", Doc<"Audio packet duration in milliseconds">, Visible> frame_ms = 20U;
    Annotated<std::uint32_t, "buffer_ms", Doc<"Suggested client playback buffer target in milliseconds">, Visible> buffer_ms = 120U;
    Annotated<float, "gain", Doc<"Server-side gain applied before publishing">, Visible> gain = 1.0F;
    Annotated<bool, "clip", Doc<"Clamp published samples to [-1, 1]">, Visible> clip = true;
    Annotated<std::string, "topic", Doc<"Optional stream topic for pub/sub transports">, Visible> topic = "";

    GR_MAKE_REFLECTABLE(StudioAudioSink, in, transport, endpoint, sample_rate, channels, frame_ms, buffer_ms, gain, clip, topic);

    using Block<StudioAudioSink<T>>::Block;

    void start() {
        _pending.clear();
        _sequence = 0UZ;
        startTransport();
    }

    void stop() { _websocket.stop(); }

    void settingsChanged(const property_map&, const property_map& newSettings) {
        if (newSettings.contains("sample_rate") || newSettings.contains("channels") || newSettings.contains("frame_ms")) {
            _pending.clear();
        }
        if (newSettings.contains("transport") || newSettings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(InputSpanLike auto& input) noexcept {
        if (!input.empty()) {
            const auto span = std::span<const T>(input.data(), input.size());
            appendInput(span);
            publishCompleteFrames();
            std::ignore = input.consume(input.size());
        }
        return work::Status::OK;
    }

private:
    websocket_transport::SnapshotWebSocketService _websocket{};
    std::vector<float> _pending{};
    std::uint64_t _sequence{0UZ};

    [[nodiscard]] std::size_t samplesPerAudioFrame() const noexcept {
        const auto channelCount = std::max<std::size_t>(1UZ, static_cast<std::size_t>(channels.value));
        const auto rate = std::max<std::uint32_t>(1U, sample_rate.value);
        const auto durationMs = std::max<std::uint32_t>(1U, frame_ms.value);
        const auto frames = std::max<std::size_t>(1UZ, (static_cast<std::size_t>(rate) * durationMs) / 1000UZ);
        return frames * channelCount;
    }

    [[nodiscard]] std::uint32_t framesPerAudioFrame() const noexcept {
        const auto channelCount = std::max<std::size_t>(1UZ, static_cast<std::size_t>(channels.value));
        return static_cast<std::uint32_t>(samplesPerAudioFrame() / channelCount);
    }

    void appendInput(std::span<const T> input) {
        _pending.reserve(_pending.size() + input.size());
        std::ranges::transform(input, std::back_inserter(_pending), [this](T sample) {
            return static_cast<float>(sample) * gain.value;
        });
    }

    void publishCompleteFrames() {
        const auto frameSamples = samplesPerAudioFrame();
        if (frameSamples == 0UZ) {
            return;
        }

        std::size_t offset = 0UZ;
        while (_pending.size() - offset >= frameSamples) {
            const auto frame = audio_sink_detail::makeAudioFrame(
                std::span<const float>(_pending.data() + offset, frameSamples),
                static_cast<std::uint16_t>(std::max<std::size_t>(1UZ, static_cast<std::size_t>(channels.value))),
                std::max<std::uint32_t>(1U, sample_rate.value),
                framesPerAudioFrame(),
                _sequence++,
                audio_sink_detail::timestampNowNs(),
                clip.value);
            _websocket.publishBinary(frame);
            offset += frameSamples;
        }

        if (offset > 0UZ) {
            _pending.erase(_pending.begin(), _pending.begin() + static_cast<std::ptrdiff_t>(offset));
        }
    }

    void startTransport() {
        if (transport.value != audio_sink_detail::AudioSinkTransport::websocket) {
            throw gr::exception("StudioAudioSink currently supports only websocket transport.");
        }

        const auto parsed = audio_sink_detail::parseEndpoint(endpoint.value);
        if (!_websocket.start(parsed.host, parsed.port, parsed.path)) {
            const auto reason = _websocket.lastErrorMessage();
            throw gr::exception(reason.empty() ? "StudioAudioSink failed to start websocket transport endpoint." : reason);
        }
    }
};

} // namespace gr::studio
