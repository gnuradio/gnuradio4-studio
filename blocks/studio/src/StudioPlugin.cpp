// SPDX-License-Identifier: MIT

// Entry point of the native Studio block plugin. The generated registration units add every block
// to the registry GR_PLUGIN defines here; WebAssembly builds link the blocks statically instead and
// do not compile this file.

#include <gnuradio-4.0/Plugin.hpp>

GR_PLUGIN("Gr4StudioBlocks", "gr4-studio", "MIT", GR4_STUDIO_VERSION)
