#[[ SPDX-License-Identifier: MIT ]]

include_guard(GLOBAL)

# Where the plugin is installed. With GNURADIO4_PLUGIN_DIRECTORIES unset, gr-core's plugin loader
# searches <libdir>/gnuradio-4/plugins of the prefix gr-core was configured with, so installing into
# that prefix makes the plugin load without any environment. The Windows and macOS installers put
# plugins in the shared plugin tree the loader also searches (.gnuradio-4/plugins/v<api>) instead,
# and give CPack that tree as the install directory of the plugin's component, so the destination
# below it is ".".
if(GR_PACKAGING AND (WIN32 OR APPLE))
  set(GR4_STUDIO_PLUGIN_INSTALL_DIR ".")
else()
  set(GR4_STUDIO_PLUGIN_INSTALL_DIR "${CMAKE_INSTALL_LIBDIR}/gnuradio-4/plugins")
endif()

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

  # gr_add_block_plugin makes no target when the block registry or the compiled block libraries are
  # turned off (GR_ENABLE_BLOCK_REGISTRY, GR_BLOCKLIB_BUILD_LIBS)
  if(NOT TARGET ${name}Plugin)
    return()
  endif()

  # the import library MSVC writes beside the DLL is of no use to anyone loading a plugin
  install(
    TARGETS ${name}Plugin
    RUNTIME DESTINATION "${GR4_STUDIO_PLUGIN_INSTALL_DIR}" COMPONENT CORE
    LIBRARY DESTINATION "${GR4_STUDIO_PLUGIN_INSTALL_DIR}" COMPONENT CORE
    ARCHIVE DESTINATION "${CMAKE_INSTALL_LIBDIR}" COMPONENT DEVELOP EXCLUDE_FROM_ALL)
  if(MSVC)
    # as gr-core's gr_install_artifact() does; OPTIONAL because a build without /Zi has no PDB
    install(
      FILES "$<TARGET_PDB_FILE:${name}Plugin>"
      DESTINATION "${GR4_STUDIO_PLUGIN_INSTALL_DIR}"
      COMPONENT SYMBOLS
      OPTIONAL)
  endif()

  # Earlier builds installed the plugin straight into <libdir>, under the same file name. The desktop
  # launcher lists <libdir> in GNURADIO4_PLUGIN_DIRECTORIES, so a copy left there by an upgrade in
  # place would load beside this one.
  if(NOT GR4_STUDIO_PLUGIN_INSTALL_DIR STREQUAL CMAKE_INSTALL_LIBDIR)
    install(
      CODE "file(REMOVE \"\$ENV{DESTDIR}\${CMAKE_INSTALL_PREFIX}/${CMAKE_INSTALL_LIBDIR}/$<TARGET_FILE_NAME:${name}Plugin>\")"
      COMPONENT CORE)
  endif()
endfunction()
