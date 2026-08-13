// SPDX-License-Identifier: MIT

#pragma once

// In-process replacement for the snapshot servers the sinks run natively.
//
// Every studio sink natively owns a listening socket -- a cpp-httplib server for the pull
// endpoints, a hand-rolled WebSocket server for the push ones -- that gnuradio4-studio connects to
// over the network. A browser cannot listen on a socket, so the Emscripten build routes snapshots
// through the process-wide registry below instead: the sinks keep calling the same
// start()/stop()/publish*() API, and the studio drains the registry through the embind surface in
// StudioWasmBindings.cpp. This mirrors the way gnuradio4-control-plane swaps its HttpServer for
// WasmApi::dispatch on the same target.
//
// The registry itself is plain C++ and compiles everywhere so it stays unit-testable on the host;
// only the sinks' choice to use it is guarded by __EMSCRIPTEN__.

#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace gr::studio::wasm_bridge {

enum class PayloadKind {
    Text,
    Binary,
};

struct Snapshot {
    std::uint64_t sequence{0UL};
    PayloadKind   kind{PayloadKind::Text};
    std::string   payload;
};

#if defined(__EMSCRIPTEN__)
// Defined in StudioWasmBindings.cpp. The services below call it when they register an endpoint,
// purely so the linker keeps that translation unit: it is reached only through EMSCRIPTEN_BINDINGS,
// and a static archive drops any object nothing references -- silently taking the studio's embind
// exports with it while the blocks themselves still link fine.
void ensureWasmBindingsLinked();
#endif

// Endpoints keep the addressing the native transports use: host, port and snapshot path. The port
// stays in the key because it is what separates two sinks that both serve "/snapshot" natively.
[[nodiscard]] inline std::string endpointKey(const std::string& host, std::uint16_t port, const std::string& path) {
    return host + ":" + std::to_string(port) + (path.empty() ? "/snapshot" : path);
}

class SnapshotRegistry {
public:
    [[nodiscard]] static SnapshotRegistry& instance() {
        static SnapshotRegistry registry;
        return registry;
    }

    // Pull endpoint: `provider` is invoked when the studio reads, matching the native HTTP GET.
    void registerProvider(std::string key, std::function<std::string()> provider) {
        std::lock_guard lock(_mutex);
        _entries[std::move(key)].provider = std::move(provider);
    }

    // Push endpoint: declared up front so the studio can see an endpoint before its first frame,
    // the way it would see a WebSocket accepting connections before any data flows.
    void registerPushEndpoint(std::string key) {
        std::lock_guard lock(_mutex);
        _entries.try_emplace(std::move(key));
    }

    void publish(const std::string& key, std::string payload, PayloadKind kind) {
        std::lock_guard lock(_mutex);
        Entry& entry = _entries[key];
        entry.latest.payload = std::move(payload);
        entry.latest.kind    = kind;
        ++entry.latest.sequence;
    }

    void unregister(const std::string& key) {
        std::lock_guard lock(_mutex);
        _entries.erase(key);
    }

    [[nodiscard]] std::vector<std::string> endpoints() const {
        std::lock_guard lock(_mutex);
        std::vector<std::string> keys;
        keys.reserve(_entries.size());
        for (const auto& [key, entry] : _entries) {
            keys.push_back(key);
        }
        return keys;
    }

    // Returns nullopt when nothing is registered at `key`. Pull endpoints serialise on read rather
    // than on publish, so a sink nobody is watching never pays for a snapshot.
    [[nodiscard]] std::optional<Snapshot> snapshot(const std::string& key) {
        std::function<std::string()> provider;
        Snapshot                     frame;
        {
            std::lock_guard lock(_mutex);
            const auto entry = _entries.find(key);
            if (entry == _entries.end()) {
                return std::nullopt;
            }
            provider = entry->second.provider;
            if (provider) {
                // Reads are what advance a pull endpoint; there is no publisher to count.
                ++entry->second.latest.sequence;
            }
            frame = entry->second.latest;
        }

        if (provider) {
            // Deliberately invoked outside the registry lock: the callback reaches back into the
            // sink, which holds its own mutex while publishing.
            frame.kind    = PayloadKind::Text;
            frame.payload = provider();
        }
        return frame;
    }

private:
    struct Entry {
        std::function<std::string()> provider;
        Snapshot                     latest;
    };

    mutable std::mutex           _mutex;
    std::map<std::string, Entry> _entries;
};

// Drop-in stand-in for the sinks' cpp-httplib SnapshotHttpService. start() is templated on the
// endpoint struct because each sink declares its own ParsedHttpEndpoint in its own namespace; all
// of them expose the same host/port/path members.
class InProcessSnapshotHttpService {
public:
    using JsonProvider = std::function<std::string()>;

    InProcessSnapshotHttpService()                                               = default;
    InProcessSnapshotHttpService(const InProcessSnapshotHttpService&)            = delete;
    InProcessSnapshotHttpService& operator=(const InProcessSnapshotHttpService&) = delete;
    InProcessSnapshotHttpService(InProcessSnapshotHttpService&&)                 = delete;
    InProcessSnapshotHttpService& operator=(InProcessSnapshotHttpService&&)      = delete;

    ~InProcessSnapshotHttpService() { stop(); }

    template<typename Endpoint>
    [[nodiscard]] bool start(const Endpoint& endpoint, JsonProvider provider) {
        stop();
#if defined(__EMSCRIPTEN__)
        ensureWasmBindingsLinked();
#endif
        _key = endpointKey(endpoint.host, endpoint.port, endpoint.path);
        SnapshotRegistry::instance().registerProvider(_key, std::move(provider));
        return true;
    }

    void stop() {
        if (_key.empty()) {
            return;
        }
        SnapshotRegistry::instance().unregister(_key);
        _key.clear();
    }

private:
    std::string _key;
};

// Drop-in stand-in for SnapshotWebSocketService. There is no handshake and no client to wait for:
// frames are retained for whenever the studio next reads them.
class InProcessSnapshotWebSocketService {
public:
    InProcessSnapshotWebSocketService()                                                    = default;
    InProcessSnapshotWebSocketService(const InProcessSnapshotWebSocketService&)            = delete;
    InProcessSnapshotWebSocketService& operator=(const InProcessSnapshotWebSocketService&) = delete;
    InProcessSnapshotWebSocketService(InProcessSnapshotWebSocketService&&)                 = delete;
    InProcessSnapshotWebSocketService& operator=(InProcessSnapshotWebSocketService&&)      = delete;

    ~InProcessSnapshotWebSocketService() { stop(); }

    [[nodiscard]] bool start(const std::string& host, std::uint16_t port, const std::string& path) {
        stop();
#if defined(__EMSCRIPTEN__)
        ensureWasmBindingsLinked();
#endif
        _key       = endpointKey(host, port, path);
        _boundPort = port;
        SnapshotRegistry::instance().registerPushEndpoint(_key);
        return true;
    }

    void stop() {
        if (_key.empty()) {
            return;
        }
        SnapshotRegistry::instance().unregister(_key);
        _key.clear();
        _boundPort = 0U;
    }

    [[nodiscard]] bool          isRunning() const noexcept { return !_key.empty(); }
    [[nodiscard]] std::uint16_t boundPort() const noexcept { return _boundPort; }

    // Nothing here can fail the way a bind() can, so this stays empty to keep the sinks' error
    // reporting paths compiling unchanged.
    [[nodiscard]] const std::string& lastErrorMessage() const noexcept { return _lastError; }

    void publishText(std::string frame) { publish(std::move(frame), PayloadKind::Text); }

    void publishBinary(std::string frame) { publish(std::move(frame), PayloadKind::Binary); }

private:
    void publish(std::string frame, PayloadKind kind) {
        // Empty frames are dropped rather than published, matching the native services: a sink with
        // nothing to say must not advance the sequence its readers use to detect new data.
        if (_key.empty() || frame.empty()) {
            return;
        }
        SnapshotRegistry::instance().publish(_key, std::move(frame), kind);
    }

    std::string   _key;
    std::uint16_t _boundPort{0U};
    std::string   _lastError;
};

} // namespace gr::studio::wasm_bridge
