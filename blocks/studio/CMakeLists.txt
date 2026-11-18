#[[ SPDX-License-Identifier: MIT ]]

# header-only interface of the Studio blocks, for the plugin and for anyone embedding them directly
add_library(gr-studio INTERFACE)
add_library(gnuradio4::gr-studio ALIAS gr-studio)
target_include_directories(gr-studio INTERFACE $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
                                               $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)
target_link_libraries(gr-studio INTERFACE gnuradio4::gnuradio-core gnuradio4::gnuradio-algorithm)
if(NOT EMSCRIPTEN)
  target_link_libraries(gr-studio INTERFACE httplib::httplib OpenSSL::Crypto)
endif()

install(TARGETS gr-studio EXPORT gnuradio4StudioBlocksTargets)
install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/include/gnuradio-4.0/studio"
        DESTINATION "${CMAKE_INSTALL_INCLUDEDIR}/gnuradio-4.0")

set(GR4_STUDIO_BLOCK_HEADERS
    include/gnuradio-4.0/studio/Studio2DSeriesSink.hpp
    include/gnuradio-4.0/studio/StudioDataSetSink.hpp
    include/gnuradio-4.0/studio/StudioImageSink.hpp
    include/gnuradio-4.0/studio/StudioPowerSpectrumSink.hpp
    include/gnuradio-4.0/studio/StudioScalarSink.hpp
    include/gnuradio-4.0/studio/StudioSeriesSink.hpp
    include/gnuradio-4.0/studio/StudioWaterfallSink.hpp)
set(GR4_STUDIO_UNREGISTERED_HEADERS "")
set(GR4_STUDIO_SOURCES "")

if(EMSCRIPTEN)
  # the audio sink plays through the host's audio device, which the browser build does not have
  list(APPEND GR4_STUDIO_UNREGISTERED_HEADERS include/gnuradio-4.0/studio/StudioAudioSink.hpp)
  list(APPEND GR4_STUDIO_SOURCES src/StudioWasmBindings.cpp)
else()
  list(APPEND GR4_STUDIO_BLOCK_HEADERS include/gnuradio-4.0/studio/StudioAudioSink.hpp)
endif()

set_source_files_properties(src/StudioPlugin.cpp PROPERTIES COMPILE_DEFINITIONS
                                                            "GR4_STUDIO_VERSION=\"${PROJECT_VERSION}\"")

gr4_studio_add_block_plugin(
  Gr4StudioBlocks
  SPLIT_BLOCK_INSTANTIATIONS
  HEADERS ${GR4_STUDIO_BLOCK_HEADERS}
  UNREGISTERED_HEADERS ${GR4_STUDIO_UNREGISTERED_HEADERS}
  SOURCES ${GR4_STUDIO_SOURCES}
  PLUGIN_SOURCES src/StudioPlugin.cpp
  LINK_LIBRARIES gr-studio)

if(ENABLE_TESTING AND NOT EMSCRIPTEN)
  add_subdirectory(test)
endif()
