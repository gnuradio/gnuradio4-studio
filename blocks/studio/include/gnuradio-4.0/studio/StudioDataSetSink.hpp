// SPDX-License-Identifier: MIT

#pragma once

#include <gnuradio-4.0/Block.hpp>
#include <gnuradio-4.0/BlockRegistry.hpp>
#include <gnuradio-4.0/DataSet.hpp>

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <span>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include <gnuradio-4.0/studio/StudioHttpSnapshot.hpp>

namespace gr::studio {

namespace detail {

template<typename T>
class DataSetWindow {
public:
    void configure(std::size_t signal_index, std::size_t axis_index, std::int64_t window_size) {
        if (window_size != -1 && window_size < 1) {
            throw gr::exception("StudioDataSetSink window_size must be -1 (all "
                                "points) or a positive integer.");
        }
        std::lock_guard lock(_mutex);
        _signal_index = signal_index;
        _axis_index   = axis_index;
        _window_size  = window_size;
    }

    void push(std::span<const DataSet<T>> input) {
        if (input.empty()) {
            return;
        }
        std::lock_guard lock(_mutex);
        _latest = input.back();
        _has_data = true;
    }

    [[nodiscard]] std::string snapshotJson() const {
        std::size_t signal_index = 0UZ;
        std::size_t axis_index = 0UZ;
        std::int64_t window_size  = -1;
        DataSet<T> copy;
        bool has_data = false;
        {
            std::lock_guard lock(_mutex);
            signal_index = _signal_index;
            axis_index = _axis_index;
            window_size = _window_size;
            copy = _latest;
            has_data = _has_data;
        }

        std::vector<T> x_values;
        std::vector<T> y_values;
        std::string signal_name;
        std::string signal_unit;
        std::string axis_name;
        std::string axis_unit;

        if (has_data) {
            if (signal_index >= copy.size()) {
                return R"({"payload_format":"dataset-xy-json-v1","layout":"pairs_xy","points":0,"data":[],"error":"Signal index is outside the latest DataSet."})";
            }
            if (axis_index >= copy.axis_values.size() && (axis_index != 0UZ || !copy.axis_values.empty())) {
                return R"({"payload_format":"dataset-xy-json-v1","layout":"pairs_xy","points":0,"data":[],"error":"Axis index is outside the latest DataSet."})";
            }
            try {
                auto y_span = copy.signalValues(signal_index);
                y_values.assign(y_span.begin(), y_span.end());
            } catch (...) {
                y_values.clear();
            }

            try {
                auto x_span = copy.axisValues(axis_index);
                x_values.assign(x_span.begin(), x_span.end());
            } catch (...) {
                x_values.clear();
            }

            if (x_values.empty()) {
                x_values.resize(y_values.size());
                for (std::size_t i = 0UZ; i < x_values.size(); ++i) {
                    x_values[i] = static_cast<T>(i);
                }
            }

            try {
                signal_name = std::string(copy.signalName(signal_index));
            } catch (...) {
                signal_name.clear();
            }
            if (signal_index < copy.signal_units.size()) {
                signal_unit = copy.signal_units[signal_index];
            }
            try {
                axis_name = std::string(copy.axisName(axis_index));
            } catch (...) {
                axis_name.clear();
            }
            if (axis_index < copy.axis_units.size()) {
                axis_unit = copy.axis_units[axis_index];
            }
        }

        const std::size_t n = std::min(x_values.size(), y_values.size());
        if (n == 0UZ) {
            return R"({"payload_format":"dataset-xy-json-v1","layout":"pairs_xy","points":0,"data":[]})";
        }

        const std::size_t  clipped = window_size == -1 ? n : std::min(n, static_cast<std::size_t>(window_size));
        const std::size_t begin = n - clipped;
        std::ostringstream os;
        os.precision(9);
        os << "{\"payload_format\":\"dataset-xy-json-v1\",";
        os << "\"layout\":\"pairs_xy\",";
        os << "\"points\":" << clipped << ",";
        if (!signal_name.empty()) {
            os << "\"signal_name\":\"" << escapeJson(signal_name) << "\",";
        }
        if (!signal_unit.empty()) {
            os << "\"signal_unit\":\"" << escapeJson(signal_unit) << "\",";
        }
        if (!axis_name.empty()) {
            os << "\"axis_name\":\"" << escapeJson(axis_name) << "\",";
        }
        if (!axis_unit.empty()) {
            os << "\"axis_unit\":\"" << escapeJson(axis_unit) << "\",";
        }
        os << "\"data\":[";
        for (std::size_t i = 0UZ; i < clipped; ++i) {
            if (i > 0UZ) {
                os << ',';
            }
            const std::size_t idx = begin + i;
            os << '[' << x_values[idx] << ',' << y_values[idx] << ']';
        }
        os << "]}";
        return os.str();
    }

private:
    mutable std::mutex _mutex;
    DataSet<T>         _latest{};
    bool               _has_data = false;
    std::size_t        _signal_index = 0UZ;
    std::size_t        _axis_index = 0UZ;
    std::int64_t       _window_size  = -1;
};

} // namespace detail

GR_REGISTER_BLOCK("gr::studio::StudioDataSetSink", gr::studio::StudioDataSetSink, [T], [ float, double ])

template<typename T>
struct StudioDataSetSink : Block<StudioDataSetSink<T>> {
    using Description = Doc<"@brief Displays a selected signal and axis from the latest DataSet.">;

    PortIn<DataSet<T>> in;

    Annotated<std::string, "transport", Doc<"Connection method">, Visible> transport = "http_poll";
    Annotated<std::string, "endpoint", Doc<"Transport endpoint URL/path">, Visible> endpoint = "http://127.0.0.1:18084/snapshot";
    Annotated<std::uint32_t, "poll_ms", Doc<"Display polling interval in milliseconds">, Visible> poll_ms = 50U;
    Annotated<std::int64_t, "window_size",
        Doc<"Maximum XY points in snapshot; -1 includes the complete "
            "latest DataSet">,
        Visible>
                                                                                                      window_size  = -1;
    Annotated<gr::Size_t, "signal_index", Doc<"Signal to display (zero-based index)">, Visible> signal_index = 0UZ;
    Annotated<gr::Size_t, "axis_index", Doc<"Horizontal axis to display (zero-based index)">, Visible> axis_index = 0UZ;
    Annotated<bool, "autoscale", Doc<"Scale the plotted values automatically">, Visible> autoscale = true;
    Annotated<float, "x_min", Doc<"Horizontal axis minimum with automatic scaling off">, Visible> x_min = -1.0F;
    Annotated<float, "x_max", Doc<"Horizontal axis maximum with automatic scaling off">, Visible> x_max = 1.0F;
    Annotated<float, "y_min", Doc<"Vertical axis minimum with automatic scaling off">, Visible> y_min = -1.0F;
    Annotated<float, "y_max", Doc<"Vertical axis maximum with automatic scaling off">, Visible> y_max = 1.0F;
    Annotated<std::string, "topic", Doc<"Reserved topic setting">> topic = "";

    GR_MAKE_REFLECTABLE(StudioDataSetSink, in, transport, endpoint, poll_ms, window_size, signal_index, axis_index, autoscale, x_min, x_max, y_min, y_max, topic);

    using Block<StudioDataSetSink<T>>::Block;

    void start() {
        _window.configure(static_cast<std::size_t>(signal_index), static_cast<std::size_t>(axis_index), window_size.value);
        startTransport();
    }

    void stop() {
        _http.stop();
    }

    void settingsChanged(const property_map&, const property_map& new_settings) {
        if (new_settings.contains("signal_index") || new_settings.contains("axis_index") || new_settings.contains("window_size")) {
            _window.configure(static_cast<std::size_t>(signal_index), static_cast<std::size_t>(axis_index), window_size.value);
        }

        if (new_settings.contains("transport") || new_settings.contains("endpoint")) {
            startTransport();
        }
    }

    [[nodiscard]] work::Status processBulk(std::span<const DataSet<T>>& input) noexcept {
        _window.push(input);
        return work::Status::OK;
    }

private:
    void startTransport() {
        if (!detail::isHttpTransport(transport.value)) {
            throw gr::exception("StudioDataSetSink currently supports only http_snapshot and http_poll transports.");
        }

        const auto parsed = detail::parseHttpEndpoint(endpoint.value);
        if (!_http.start(parsed, [this]() { return _window.snapshotJson(); })) {
            throw gr::exception("StudioDataSetSink failed to start HTTP transport endpoint.");
        }
    }

    detail::DataSetWindow<T>   _window{};
    detail::SnapshotHttpService _http{};
};

} // namespace gr::studio
