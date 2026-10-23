// SPDX-License-Identifier: MIT
#include <cassert>
#include <gnuradio-4.0/studio/StudioDataSetSink.hpp>
#include <string>

gr::DataSet<double> spectrum(std::size_t count) {
    gr::DataSet<double> data;
    data.axis_names = {"frequency"};
    data.axis_units = {"Hz"};
    data.axis_values.resize(1);
    data.signal_names      = {"spectrum"};
    data.signal_units      = {"dBm"};
    data.signal_quantities = {"power"};
    data.extents           = {static_cast<std::int32_t>(count)};
    for (std::size_t i = 0; i < count; ++i) {
        data.axis_values[0].push_back(1000000.0 + static_cast<double>(i));
        data.signal_values.push_back(-static_cast<double>(i));
    }
    return data;
}

int main() {
    gr::studio::StudioDataSetSink<double> sink;
    assert(sink.window_size.value == -1);
    gr::studio::detail::DataSetWindow<double> window;
    const auto                                data = spectrum(4096);
    window.push(std::span(&data, 1));
    auto json = window.snapshotJson();
    assert(json.find("\"points\":4096") != std::string::npos);
    assert(json.find("[1000000,") != std::string::npos);
    assert(json.find("[1004095,-4095]") != std::string::npos);

    window.configure(0, 0, 3);
    json = window.snapshotJson();
    assert(json.find("\"points\":3") != std::string::npos);
    assert(json.find("[1004093,-4093]") != std::string::npos);
    assert(json.find("[1000000,") == std::string::npos);
    window.configure(0, 0, -1);
    assert(window.snapshotJson().find("\"points\":4096") != std::string::npos);

    for (const auto invalid : {0, -2}) {
        bool refused = false;
        try {
            window.configure(0, 0, invalid);
        } catch (const gr::exception&) {
            refused = true;
        }
        assert(refused);
    }
    const auto next = spectrum(2);
    window.push(std::span(&next, 1));
    assert(window.snapshotJson().find("\"points\":2") != std::string::npos);
}
