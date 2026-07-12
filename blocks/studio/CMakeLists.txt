#[[ SPDX-License-Identifier: MIT ]]

find_package(PkgConfig REQUIRED)
pkg_check_modules(GR4_STUDIO_GNURADIO4 REQUIRED IMPORTED_TARGET gnuradio4)
find_package(OpenSSL REQUIRED COMPONENTS Crypto)
find_package(httplib CONFIG QUIET)
if(httplib_FOUND)
  set(GR4_STUDIO_HTTPLIB_TARGET httplib::httplib)
else()
  pkg_check_modules(GR4_STUDIO_CPPHTTPLIB QUIET IMPORTED_TARGET cpp-httplib)
  if(GR4_STUDIO_CPPHTTPLIB_FOUND)
    set(GR4_STUDIO_HTTPLIB_TARGET PkgConfig::GR4_STUDIO_CPPHTTPLIB)
  else()
    find_path(GR4_STUDIO_CPPHTTPLIB_INCLUDE_DIR
      NAMES httplib.h
      PATH_SUFFIXES include
    )

    if(NOT GR4_STUDIO_CPPHTTPLIB_INCLUDE_DIR)
      message(FATAL_ERROR
        "Could not find cpp-httplib. Install it with a CMake package config or ensure httplib.h is visible to CMake.")
    endif()

    add_library(gr4_studio_cpp_httplib INTERFACE)
    add_library(gr4_studio::cpp_httplib ALIAS gr4_studio_cpp_httplib)
    target_include_directories(gr4_studio_cpp_httplib INTERFACE "${GR4_STUDIO_CPPHTTPLIB_INCLUDE_DIR}")
    set(GR4_STUDIO_HTTPLIB_TARGET gr4_studio::cpp_httplib)
  endif()
endif()
find_program(GR4_STUDIO_PARSE_REGISTRATIONS_EXE NAMES gnuradio_4_0_parse_registrations)
if(NOT GR4_STUDIO_PARSE_REGISTRATIONS_EXE)
  message(FATAL_ERROR
    "gnuradio_4_0_parse_registrations is required for studio plugin generation. "
    "Set PATH or CMAKE_PROGRAM_PATH.")
endif()

add_library(gr4_studio_blocks_studio_headers INTERFACE)
add_library(gr4_studio::blocks_studio_headers ALIAS gr4_studio_blocks_studio_headers)

target_include_directories(gr4_studio_blocks_studio_headers
  INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
)
target_link_libraries(gr4_studio_blocks_studio_headers
  INTERFACE
    PkgConfig::GR4_STUDIO_GNURADIO4
    ${GR4_STUDIO_HTTPLIB_TARGET}
    OpenSSL::Crypto
)

install(TARGETS gr4_studio_blocks_studio_headers)
install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/include/gnuradio-4.0/studio
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/gnuradio-4.0)

file(GLOB GR4_STUDIO_HEADERS CONFIGURE_DEPENDS
  "${CMAKE_CURRENT_SOURCE_DIR}/include/gnuradio-4.0/studio/*.hpp")
gr4_studio_add_block_plugin(Gr4StudioBlocks
  MODULE_NAME_BASE studio
  SPLIT_BLOCK_INSTANTIATIONS
  PARSER_EXE "${GR4_STUDIO_PARSE_REGISTRATIONS_EXE}"
  HEADERS ${GR4_STUDIO_HEADERS}
  LINK_LIBRARIES
    PkgConfig::GR4_STUDIO_GNURADIO4
    ${GR4_STUDIO_HTTPLIB_TARGET}
    OpenSSL::Crypto
  INCLUDE_DIRECTORIES "${CMAKE_CURRENT_SOURCE_DIR}/include")

if(ENABLE_TESTING)
  add_subdirectory(test)
endif()
