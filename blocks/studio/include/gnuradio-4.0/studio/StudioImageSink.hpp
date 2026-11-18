// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>

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

#include <gnuradio-4.0/studio/StudioHttpSnapshot.hpp>

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

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioImageSink", gr::studio::StudioImageSink, ([T]), [ std::uint8_t ])

template<detail::SupportedImageSample T>
struct StudioImageSink : Block<StudioImageSink<T>> {
    using Description = Doc<"@brief Collects input samples into image frames.">;

    PortIn<T> in;

    Annotated<std::string, "transport", Doc<"Connection method">, Visible> transport = "http_poll";
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18082/snapshot";
    Annotated<std::uint32_t, "poll_ms", Doc<"Display polling interval in milliseconds">, Visible> poll_ms = 50U;
    Annotated<gr::Size_t, "width", Doc<"Frame width in pixels">, Visible> width = 256UZ;
    Annotated<gr::Size_t, "height", Doc<"Frame height in pixels">, Visible> height = 256UZ;
    Annotated<gr::Size_t, "channels", Doc<"Pixel format: 1 = grayscale, 3 = RGB, 4 = RGBA">, Visible> channels = 1UZ;
    Annotated<bool, "autoscale", Doc<"Scale the plotted values automatically">, Visible> autoscale = true;
    Annotated<float, "x_min", Doc<"Horizontal axis minimum with automatic scaling off">, Visible> x_min = 0.0F;
    Annotated<float, "x_max", Doc<"Horizontal axis maximum with automatic scaling off">, Visible> x_max = 256.0F;
    Annotated<float, "y_min", Doc<"Vertical axis minimum with automatic scaling off">, Visible> y_min = 0.0F;
    Annotated<float, "y_max", Doc<"Vertical axis maximum with automatic scaling off">, Visible> y_max = 256.0F;
    Annotated<std::string, "topic", Doc<"Reserved topic setting">> topic = "";

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
