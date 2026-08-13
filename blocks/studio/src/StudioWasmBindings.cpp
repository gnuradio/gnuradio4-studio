// SPDX-License-Identifier: MIT

// embind surface over the sinks' in-process snapshot registry.
//
// Natively the studio reads a sink by connecting to the socket that sink owns. On Emscripten it
// runs in the same process as the graph, so it reads the registry directly instead. This is the
// data-plane counterpart to gnuradio4-control-plane's Module.handleRequest() control plane.
//
// Compiled into the WASM blocks library only; see studio/CMakeLists.txt.

#include <gnuradio-4.0/studio/StudioWasmTransport.hpp>

#include <cstddef>
#include <cstdint>
#include <string>

#include <emscripten/bind.h>
#include <emscripten/val.h>

namespace {

using gr::studio::wasm_bridge::PayloadKind;
using gr::studio::wasm_bridge::SnapshotRegistry;

// Endpoint keys are "host:port/path" -- the same triple the block's `endpoint` setting carries, so
// the studio can address a sink from its graph description without a discovery round trip.
emscripten::val studioSinkEndpoints() {
    const auto keys = SnapshotRegistry::instance().endpoints();

    auto out = emscripten::val::array();
    for (std::size_t index = 0UZ; index < keys.size(); ++index) {
        out.set(index, emscripten::val(keys[index]));
    }
    return out;
}

// Returns null when no sink is registered at `endpoint`, otherwise
// {sequence, kind: 'text'|'binary', payload}. `sequence` advances once per published frame, so a
// caller polling faster than the sink produces can skip repeats.
emscripten::val studioSinkSnapshot(const std::string& endpoint) {
    const auto frame = SnapshotRegistry::instance().snapshot(endpoint);
    if (!frame) {
        return emscripten::val::null();
    }

    auto out = emscripten::val::object();
    out.set("sequence", emscripten::val(static_cast<double>(frame->sequence)));

    if (frame->kind == PayloadKind::Binary) {
        // Binary frames must not go through embind's std::string conversion, which assumes UTF-8
        // and would mangle raw bytes. The typed_memory_view aliases WASM memory, so the
        // Uint8Array constructor is what copies it out before `frame` dies.
        const auto view = emscripten::typed_memory_view(frame->payload.size(), reinterpret_cast<const std::uint8_t*>(frame->payload.data()));
        out.set("kind", emscripten::val("binary"));
        out.set("payload", emscripten::val::global("Uint8Array").new_(view));
    } else {
        out.set("kind", emscripten::val("text"));
        out.set("payload", emscripten::val(frame->payload));
    }
    return out;
}

} // namespace

namespace gr::studio::wasm_bridge {

// See the declaration in StudioWasmTransport.hpp: this exists only to give the sinks a symbol in
// this translation unit to reference, so it survives static-archive extraction.
void ensureWasmBindingsLinked() {}

} // namespace gr::studio::wasm_bridge

EMSCRIPTEN_BINDINGS(gr4_studio_sinks) {
    emscripten::function("studioSinkEndpoints", &studioSinkEndpoints);
    emscripten::function("studioSinkSnapshot", &studioSinkSnapshot);
}
