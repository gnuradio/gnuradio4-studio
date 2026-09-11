#[[ SPDX-License-Identifier: MIT ]]

include_guard(GLOBAL)

function(gr4_studio_add_block_plugin plugin_target_base)
  set(options SPLIT_BLOCK_INSTANTIATIONS)
  set(oneValueArgs MODULE_NAME_BASE)
  set(multiValueArgs HEADERS SOURCES LINK_LIBRARIES INCLUDE_DIRECTORIES)
  cmake_parse_arguments(GR4S_PLUGIN "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

  if(NOT GR4S_PLUGIN_HEADERS)
    message(FATAL_ERROR "No HEADERS passed to gr4_studio_add_block_plugin(${plugin_target_base})")
  endif()

  if(NOT GR4S_PLUGIN_MODULE_NAME_BASE)
    set(GR4S_PLUGIN_MODULE_NAME_BASE "${plugin_target_base}")
  endif()

  if(GR4S_PLUGIN_SPLIT_BLOCK_INSTANTIATIONS)
    set(_split_arg SPLIT_BLOCK_INSTANTIATIONS)
  else()
    set(_split_arg "")
  endif()

  set(_gen_dir "${CMAKE_BINARY_DIR}/plugins/${GR4S_PLUGIN_MODULE_NAME_BASE}")
  file(MAKE_DIRECTORY "${_gen_dir}")

  set(_plugin_sources ${GR4S_PLUGIN_SOURCES})

  if(EMSCRIPTEN)
    set(_registry_args "")
  else()
    set(_registry_args
      REGISTRY_HEADER plugin_instance.hpp
      REGISTRY_INSTANCE grPluginInstance)

    set(_plugin_instance_header "${_gen_dir}/plugin_instance.hpp")
    set(_plugin_entry_cpp "${_gen_dir}/plugin_entry.cpp")
    file(WRITE "${_plugin_instance_header}"
      "#pragma once\n"
      "#include <gnuradio-4.0/Plugin.hpp>\n"
      "gr::plugin<>& grPluginInstance();\n")
    file(WRITE "${_plugin_entry_cpp}"
      "#include <gnuradio-4.0/Plugin.hpp>\n"
      "GR_PLUGIN(\"${plugin_target_base}\", \"gr4-studio\", \"MIT\", \"${PROJECT_VERSION}\")\n")
    list(APPEND _plugin_sources "${_plugin_entry_cpp}")
  endif()

  add_library(${plugin_target_base} OBJECT ${_plugin_sources})
  set_target_properties(${plugin_target_base} PROPERTIES POSITION_INDEPENDENT_CODE ON)
  gr_generate_block_instantiations(${plugin_target_base}
    HEADERS ${GR4S_PLUGIN_HEADERS}
    MODULE_NAME_BASE ${GR4S_PLUGIN_MODULE_NAME_BASE}
    ${_split_arg}
    ${_registry_args})
  target_include_directories(${plugin_target_base} PRIVATE "${_gen_dir}" ${GR4S_PLUGIN_INCLUDE_DIRECTORIES})
  target_link_libraries(${plugin_target_base}
    PUBLIC
      ${GR4S_PLUGIN_LINK_LIBRARIES}
  )

  if(EMSCRIPTEN)
    set(_static_lib_name "${plugin_target_base}Static")
    add_library(${_static_lib_name} STATIC)
    target_sources(${_static_lib_name} PRIVATE $<TARGET_OBJECTS:${plugin_target_base}>)
    target_link_libraries(${_static_lib_name} PUBLIC ${GR4S_PLUGIN_LINK_LIBRARIES})
    install(TARGETS ${_static_lib_name} ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}/gnuradio-4/plugins)
    install(FILES "${CMAKE_BINARY_DIR}/include/gnuradio-4.0/${GR4S_PLUGIN_MODULE_NAME_BASE}.hpp"
      DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/gnuradio-4.0)
  else()
    set(_plugin_lib_name "${plugin_target_base}Plugin")
    add_library(${_plugin_lib_name} SHARED)
    target_link_libraries(${_plugin_lib_name} PRIVATE ${plugin_target_base})
    install(TARGETS ${_plugin_lib_name} LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR})
  endif()
endfunction()
