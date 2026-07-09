// SPDX-License-Identifier: MIT

#include <cassert>
#include <limits>
#include <string>

#include <gnuradio-4.0/studio/StudioScalarSink.hpp>

namespace {

void testDefaultTransportAndCadence() {
    gr::studio::StudioScalarSink<float> scalar{};
    gr::studio::StudioStatusSink<float> status{};
    assert(scalar.transport.value == gr::studio::detail::ScalarStatusTransport::http_poll);
    assert(status.transport.value == gr::studio::detail::ScalarStatusTransport::http_poll);
    assert(scalar.update_ms == 250U);
    assert(status.update_ms == 250U);
}

void testScalarSnapshotJson() {
    gr::studio::detail::ScalarStatusSnapshot snapshot{2UZ};
    snapshot.configure(2UZ, "Quality, Locked", ",");
    const float samples[] = {0.25F, 0.0F, 0.75F, 1.0F};
    snapshot.pushInterleaved(samples);

    const std::string json = snapshot.snapshotJson("scalar");
    assert(json.find("\"payload_format\":\"scalar-status-json-v1\"") != std::string::npos);
    assert(json.find("\"presentation\":\"scalar\"") != std::string::npos);
    assert(json.find("\"channels\":2") != std::string::npos);
    assert(json.find("\"sequence\":2") != std::string::npos);
    assert(json.find("\"has_value\":true") != std::string::npos);
    assert(json.find("\"labels\":[\"Quality\",\"Locked\"]") != std::string::npos);
    assert(json.find("\"values\":[0.75,1]") != std::string::npos);
}

void testStatusSnapshotSanitizesNonFiniteValues() {
    gr::studio::detail::ScalarStatusSnapshot snapshot{2UZ};
    snapshot.configure(2UZ, "Range Error,Velocity Error", "m,m/s");
    const float samples[] = {std::numeric_limits<float>::infinity(), -std::numeric_limits<float>::quiet_NaN()};
    snapshot.pushInterleaved(samples);

    const std::string json = snapshot.snapshotJson("status");
    assert(json.find("\"presentation\":\"status\"") != std::string::npos);
    assert(json.find("\"units\":[\"m\",\"m/s\"]") != std::string::npos);
    assert(json.find("inf") == std::string::npos);
    assert(json.find("nan") == std::string::npos);
    assert(json.find("\"values\":[0,0]") != std::string::npos);
}

} // namespace

int main() {
    testDefaultTransportAndCadence();
    testScalarSnapshotJson();
    testStatusSnapshotSanitizesNonFiniteValues();
    return 0;
}
