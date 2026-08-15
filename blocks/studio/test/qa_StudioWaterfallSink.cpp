// SPDX-License-Identifier: MIT

#include <array>
#include <cassert>
#include <complex>
#include <cstddef>
#include <span>
#include <string>

#include <gnuradio-4.0/Tag.hpp>
#include <gnuradio-4.0/studio/StudioWaterfallSink.hpp>

namespace {

template<typename TBlock>
void configureBlock(TBlock& block, float timeSpanSeconds = 1.0F) {
    block.fft_size = 4UZ;
    block.num_averages = 2UZ;
    block.time_span = timeSpanSeconds;
    block.window = gr::algorithm::window::Type::Rectangular;
    block.sample_rate = 8.0F;
    block.output_in_db = false;
    block.autoscale = true;
    block.z_min = -10.0F;
    block.z_max = 10.0F;

    block.settingsChanged({}, gr::property_map{
                                 {"fft_size", 4UZ},
                                 {"num_averages", 2UZ},
                                 {"time_span", timeSpanSeconds},
                                 {"window", std::string("Rectangular")},
                                 {"sample_rate", 8.0F},
                                 {"autoscale", true},
                                 {"z_min", -10.0F},
                                 {"z_max", 10.0F},
    });
}

void testDefaultTransportAndCadence() {
    gr::studio::StudioWaterfallSink<float> block{};
    assert(block.transport.value == gr::studio::detail::WaterfallTransport::websocket);
    assert(block.update_ms == 10U);
}

void testFloatWaterfall() {
    gr::studio::StudioWaterfallSink<float> block{};
    configureBlock(block, 1.0F);
    assert(block.in.min_samples == 4UZ);
    assert(block.in.max_samples == 4UZ);

    const std::array<float, 4UZ> impulse{1.0F, 0.0F, 0.0F, 0.0F};
    const std::array<float, 4UZ> zeros{0.0F, 0.0F, 0.0F, 0.0F};
    block.processSamples(std::span<const float>(impulse));
    block.processSamples(std::span<const float>(zeros));

    const std::string json = block.snapshotJson();
    assert(json.find("\"payload_format\":\"waterfall-spectrum-json-v1\"") != std::string::npos);
    assert(json.find("\"layout\":\"waterfall_matrix\"") != std::string::npos);
    assert(json.find("\"rows\":2") != std::string::npos);
    assert(json.find("\"columns\":2") != std::string::npos);
    assert(json.find("\"time_span\":1") != std::string::npos);
    assert(json.find("\"sample_rate\":8") != std::string::npos);
    assert(json.find("\"frequencies\":[0,2]") != std::string::npos);
    assert(json.find("\"sample_type\":\"float32\"") != std::string::npos);
    assert(json.find("\"color_map\":\"turbo\"") != std::string::npos);
}

void testManualColorScaleWaterfall() {
    gr::studio::StudioWaterfallSink<float> block{};
    configureBlock(block);
    block.autoscale = false;
    block.z_min = -20.0F;
    block.z_max = 10.0F;
    block.settingsChanged({}, gr::property_map{
                                 {"autoscale", false},
                                 {"z_min", -20.0F},
                                 {"z_max", 10.0F},
                             });

    const std::array<float, 4UZ> impulse{1.0F, 0.0F, 0.0F, 0.0F};
    block.processSamples(std::span<const float>(impulse));

    const std::string json = block.snapshotJson();
    assert(json.find("\"autoscale\":false") != std::string::npos);
    assert(json.find("\"z_min\":-20") != std::string::npos);
    assert(json.find("\"z_max\":10") != std::string::npos);
    assert(json.find("\"min_value\":-20") != std::string::npos);
    assert(json.find("\"max_value\":10") != std::string::npos);
}

void testEmptyAndClampedWaterfall() {
    gr::studio::StudioWaterfallSink<float> block{};
    block.fft_size = 0UZ;
    block.num_averages = 0UZ;
    block.time_span = 0.0F;
    block.sample_rate = 0.0F;
    block.settingsChanged({}, gr::property_map{
                                 {"fft_size", 0UZ},
                                 {"num_averages", 0UZ},
                                 {"time_span", 0.0F},
                                 {"sample_rate", 0.0F},
                             });

    assert(block.in.min_samples == 1UZ);
    assert(block.in.max_samples == 1UZ);
    assert(static_cast<std::size_t>(block.fft_size) == 1UZ);

    const std::string json = block.snapshotJson();
    assert(json.find("\"rows\":1") != std::string::npos);
    assert(json.find("\"columns\":1") != std::string::npos);
    assert(json.find("\"sample_type\":\"float32\"") != std::string::npos);
    assert(json.find("\"time_span\":1") != std::string::npos);
    assert(json.find("\"sample_rate\":1") != std::string::npos);
    assert(json.find("\"min_value\":0") != std::string::npos);
    assert(json.find("\"max_value\":1") != std::string::npos);
    assert(json.find("\"color_map\":\"turbo\"") != std::string::npos);
}

void testInvalidManualRangeFallsBackSafely() {
    gr::studio::StudioWaterfallSink<float> block{};
    block.autoscale = false;
    block.z_min = 10.0F;
    block.z_max = 5.0F;
    block.settingsChanged({}, gr::property_map{
                                 {"autoscale", false},
                                 {"z_min", 10.0F},
                                 {"z_max", 5.0F},
                             });

    const std::string json = block.snapshotJson();
    assert(json.find("\"autoscale\":false") != std::string::npos);
    assert(json.find("\"z_min\":10") != std::string::npos);
    assert(json.find("\"z_max\":5") != std::string::npos);
    assert(json.find("\"min_value\":0") != std::string::npos);
    assert(json.find("\"max_value\":1") != std::string::npos);
}

void testBlankRowsUseFloorValue() {
    gr::studio::StudioWaterfallSink<float> block{};
    block.fft_size = 4UZ;
    block.num_averages = 1UZ;
    block.time_span = 1.0F;
    block.autoscale = false;
    block.z_min = -20.0F;
    block.z_max = 10.0F;
    block.settingsChanged({}, gr::property_map{
                                 {"fft_size", 4UZ},
                                 {"num_averages", 1UZ},
                                 {"time_span", 1.0F},
                                 {"autoscale", false},
                                 {"z_min", -20.0F},
                                 {"z_max", 10.0F},
                             });

    const std::string json = block.snapshotJson();
    assert(json.find("\"rows\":2") != std::string::npos);
    assert(json.find("\"columns\":2") != std::string::npos);
    assert(json.find("\"data\":[[-20,-20],[-20,-20]]") != std::string::npos);
    assert(json.find("\"min_value\":-20") != std::string::npos);
    assert(json.find("\"max_value\":10") != std::string::npos);
}

void testComplexWaterfall() {
    using Complex = std::complex<float>;

    gr::studio::StudioWaterfallSink<Complex> block{};
    configureBlock(block, 1.0F);
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
    assert(json.find("\"payload_format\":\"waterfall-spectrum-json-v1\"") != std::string::npos);
    assert(json.find("\"rows\":2") != std::string::npos);
    assert(json.find("\"columns\":4") != std::string::npos);
    assert(json.find("\"time_span\":1") != std::string::npos);
    assert(json.find("[-4,") != std::string::npos);
    assert(json.find("[2,") != std::string::npos);
    assert(json.find("\"sample_type\":\"complex64\"") != std::string::npos);
}

void testHttpTransportHelpers() {
    const auto parsed = gr::studio::detail::parseHttpEndpoint("http://127.0.0.1:18085/custom/snapshot");
    assert(parsed.host == "127.0.0.1");
    assert(parsed.port == 18085U);
    assert(parsed.path == "/custom/snapshot");
    assert(gr::studio::detail::isHttpTransport("http_poll"));
    assert(gr::studio::detail::isHttpTransport("http_snapshot"));
    assert(gr::studio::detail::isHttpTransport(gr::studio::detail::WaterfallTransport::http_poll));
    assert(!gr::studio::detail::isHttpTransport("sse"));
    assert(gr::studio::detail::isWebSocketTransport(gr::studio::detail::WaterfallTransport::websocket));
}

} // namespace

int main() {
    testDefaultTransportAndCadence();
    testFloatWaterfall();
    testManualColorScaleWaterfall();
    testEmptyAndClampedWaterfall();
    testInvalidManualRangeFallsBackSafely();
    testBlankRowsUseFloorValue();
    testComplexWaterfall();
    testHttpTransportHelpers();
    return 0;
}
