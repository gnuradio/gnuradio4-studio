# AGENTS.md

## Purpose

This file defines how coding agents (e.g., Codex, ChatGPT, Claude Code) should operate within the `gr4-studio` repository.

The goal is to ensure consistent, incremental, and architecture-aligned changes while integrating Studio-compatible GR4 blocks and the new control/data plane model.

---

## Core Principles

### 1. Minimal, Incremental Changes

* Always prefer small, reviewable changes
* Avoid large rewrites unless explicitly requested
* Keep commits scoped to a single concern

### 2. No Legacy Control Plane Assumptions

* Do NOT assume old GNU Radio control plane APIs exist
* Only use the minimal control plane (sessions + blocks)
* Do not invent backend endpoints

### 3. Data Plane is Block-Owned

* Blocks expose their own data interfaces (ZMQ, HTTP, WebSocket, etc.)
* The control plane is NOT responsible for data streaming
* UI binds directly to block-defined interfaces

### 4. Exact Block ID Matching

* Studio compatibility is based on exact fully qualified reflected block IDs
* Do NOT use fuzzy matching or heuristics
* Do NOT assume metadata capability exists

### 5. Separation of Concerns

* Exposure/binding ≠ rendering
* Graph model ≠ execution model
* Frontend ≠ GR4 runtime blocks

### 6. Prefer Explicit Over Implicit

* Transport must be explicitly configured (e.g., `transport` param)
* Do not infer behavior from strings (e.g., endpoint prefixes)

---

## Studio-Compatible Blocks

The repo includes first-party blocks under `blocks/`.

Initial block families:

* `StudioSeriesSink`
* `Studio2DSeriesSink`
* `StudioDataSetSink`
* `StudioImageSink`

These are:

* Real GR4 blocks
* Installed into the GR4 prefix
* Reflected via `/blocks`

They are NOT frontend-only abstractions.

---

## Binding Contract (Frontend)

Studio uses an internal registry:

* keyed by exact fully qualified block ID
* maps to a binding adapter

The adapter defines:

* binding kind (series, 2D, image, audio)
* transport kind
* payload format
* parameter mappings

Standard parameter names:

* `transport`
* `endpoint`
* `poll_ms`
* `sample_rate`
* `channels`
* `topic`

---

## Transport Modes

Supported transport modes (explicit via parameter):

* `http_snapshot`
* `http_poll`
* `zmq_sub`
* `websocket`

Rules:

* The current included blocks support `http_snapshot` and `http_poll` only
* Each block supports only a subset of valid transports
* Do NOT assume all combinations are valid
* Validate parameters locally (non-authoritative)

---

## HTTP Behavior Reference

When implementing HTTP-based sinks:

* Model behavior after:

  * `gr4-incubator HttpTimeSeriesSink`

This applies to:

* polling semantics
* snapshot semantics
* endpoint structure

---

## Frontend Rules

* Do NOT simulate backend state
* Use polling for session updates
* Keep execution logic simple and deterministic
* Avoid async race conditions

Binding layer responsibilities:

* resolve connection info from node params
* validate configuration
* expose normalized binding object

Rendering is handled separately.

---

## Blocks Subproject Rules

* Must build as real GR4 components
* Must be installable into prefix
* Must not depend on frontend runtime
* Keep transport logic encapsulated per block

---

## What NOT to Do

* Do NOT add SSE or streaming to control plane
* Do NOT invent graph persistence APIs
* Do NOT embed block definitions in frontend only
* Do NOT overgeneralize transport abstraction early
* Do NOT couple UI rendering to block identity

---

## Implementation Workflow

Use the current contract docs for implementation context:

* `docs/studio-blocks-architecture.md`
* `docs/studio-blocks-payload-contracts.md`

Execution rules:

1. One step at a time
2. Review changes after each step
3. Do not skip steps
4. Do not expand scope beyond the current step

---

## When in Doubt

Prefer:

* simpler over more abstract
* explicit over implicit
* concrete over generic
* working over perfect

And always align with:

> "The correct direction is simpler, not more abstract."

## Local Artifacts

* Store implementation plans, working notes, and audits under `.doc/`.
* Store generated screenshots, validation reports, and other evidence under `.evidence/`.
* Keep both directories ignored. Never stage or commit their contents.
