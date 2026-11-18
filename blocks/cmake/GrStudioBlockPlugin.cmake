#[[ SPDX-License-Identifier: MIT ]]

include_guard(GLOBAL)

# Where the plugin is installed. gr-core's plugin loader searches <libdir>/gnuradio-4/plugins of
# its own prefix when GNURADIO4_PLUGIN_DIRECTORIES is unset, so installing into the same prefix
# makes the plugin load without any environment.
set(GR4_STUDIO_PLUGIN_INSTALL_DIR
    "${CMAKE_INSTALL_LIBDIR}/gnuradio-4/plugins"
    CACHE STRING "Install directory of the Studio block plugin, relative to the prefix")

# gr4_studio_add_block_plugin(<name>
#   HEADERS <header>...                 headers whose GR_REGISTER_BLOCK entries are registered
#   [SOURCES <source>...]               compiled on every platform
#   [PLUGIN_SOURCES <source>...]        compiled only into the native plugin (the GR_PLUGIN entry)
#   [LINK_LIBRARIES <target>...]
#   [UNREGISTERED_HEADERS <header>...]  block headers deliberately left out on this platform
#   [SPLIT_BLOCK_INSTANTIATIONS])
#
# Builds the blocks with gr-core's block-library macros, in the form each platform loads them:
#
#   native      <name>Plugin, a GR_PLUGIN shared library the runtime loads from
#               GR4_STUDIO_PLUGIN_INSTALL_DIR.
#   Emscripten  <name>Static and the generated gnuradio-4.0/<name>.hpp initializer header, which the
#               control-plane WebAssembly build links; gr-core has no plugin loader there.
#
# gr_add_block_plugin installs to a fixed `LIBRARY DESTINATION lib`, which is not the loader's
# directory and not where a Windows DLL (a RUNTIME artifact) goes, so the plugin is built
# NO_INSTALL and installed here.
function(gr4_studio_add_block_plugin name)
  set(options SPLIT_BLOCK_INSTANTIATIONS)
  set(multiValueArgs
      HEADERS
      SOURCES
      PLUGIN_SOURCES
      LINK_LIBRARIES
      UNREGISTERED_HEADERS)
  cmake_parse_arguments(arg "${options}" "" "${multiValueArgs}" ${ARGN})

  if(NOT arg_HEADERS)
    message(FATAL_ERROR "gr4_studio_add_block_plugin(${name}): no HEADERS given")
  endif()

  set(split "")
  if(arg_SPLIT_BLOCK_INSTANTIATIONS)
    set(split SPLIT_BLOCK_INSTANTIATIONS)
  endif()

  if(EMSCRIPTEN)
    gr_add_block_library(
      ${name}
      MAKE_STATIC_LIBRARY
      ${split}
      HEADERS ${arg_HEADERS}
      SOURCES ${arg_SOURCES}
      LINK_LIBRARIES ${arg_LINK_LIBRARIES}
      UNREGISTERED_HEADERS ${arg_UNREGISTERED_HEADERS})
    return()
  endif()

  gr_add_block_plugin(
    ${name}
    NO_INSTALL
    ${split}
    HEADERS ${arg_HEADERS}
    SOURCES ${arg_SOURCES} ${arg_PLUGIN_SOURCES}
    LINK_LIBRARIES ${arg_LINK_LIBRARIES})

  # the import library MSVC writes beside the DLL is of no use to anyone loading a plugin
  install(
    TARGETS ${name}Plugin
    RUNTIME DESTINATION "${GR4_STUDIO_PLUGIN_INSTALL_DIR}"
    LIBRARY DESTINATION "${GR4_STUDIO_PLUGIN_INSTALL_DIR}"
    ARCHIVE DESTINATION "${CMAKE_INSTALL_LIBDIR}" COMPONENT Development EXCLUDE_FROM_ALL)
endfunction()
