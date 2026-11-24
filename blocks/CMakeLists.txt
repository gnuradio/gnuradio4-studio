#[[ SPDX-License-Identifier: MIT ]]

cmake_minimum_required(VERSION 3.27)

# the version comes from package.json, shared with the desktop app
include("${CMAKE_CURRENT_SOURCE_DIR}/../cmake/GrStudioVersion.cmake")

project(
  gnuradio4StudioBlocks
  VERSION ${GR4_STUDIO_NUMERIC_VERSION}
  LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
include(GrStudioCompilerLauncher)

option(ENABLE_TESTING "Build Studio block tests" OFF)
option(GR_PACKAGING "Allow the Studio blocks to be packaged with CPack" OFF)

# Every dependency is found as an installed package. Build the third-party ones with gr-deps
# (TARGET_GR_STUDIO) and the GNU Radio ones with gr-core and gr-blocks, then point
# CMAKE_PREFIX_PATH at the prefixes.
find_package(gnuradio4 CONFIG REQUIRED)
find_package(GnuRadioBlockLib CONFIG REQUIRED)
# gnuradio4::gnuradio-algorithm, for the FFTs of the spectrum and waterfall sinks
find_package(gnuradio4Library CONFIG REQUIRED)
if(NOT EMSCRIPTEN)
  # the sinks' HTTP and WebSocket servers; under Emscripten they use StudioWasmTransport instead
  find_package(httplib CONFIG REQUIRED)
  find_package(OpenSSL REQUIRED COMPONENTS Crypto)
endif()

if(ENABLE_TESTING)
  enable_testing()
endif()

include(GrStudioBlockPlugin)

add_subdirectory(studio)

# installed package: find_package(gnuradio4StudioBlocks) gives gnuradio4::gr-studio
set(GR4_STUDIO_CMAKE_INSTALL_DIR "${CMAKE_INSTALL_LIBDIR}/cmake/gnuradio4StudioBlocks")

configure_package_config_file(
  "${CMAKE_CURRENT_SOURCE_DIR}/cmake/gnuradio4StudioBlocksConfig.cmake.in"
  "${CMAKE_CURRENT_BINARY_DIR}/gnuradio4StudioBlocksConfig.cmake" INSTALL_DESTINATION "${GR4_STUDIO_CMAKE_INSTALL_DIR}")

write_basic_package_version_file(
  "${CMAKE_CURRENT_BINARY_DIR}/gnuradio4StudioBlocksConfigVersion.cmake"
  VERSION "${PROJECT_VERSION}"
  COMPATIBILITY SameMinorVersion)

install(
  FILES "${CMAKE_CURRENT_BINARY_DIR}/gnuradio4StudioBlocksConfig.cmake"
        "${CMAKE_CURRENT_BINARY_DIR}/gnuradio4StudioBlocksConfigVersion.cmake"
  DESTINATION "${GR4_STUDIO_CMAKE_INSTALL_DIR}"
  COMPONENT DEVELOP)

install(
  EXPORT gnuradio4StudioBlocksTargets
  NAMESPACE gnuradio4::
  DESTINATION "${GR4_STUDIO_CMAKE_INSTALL_DIR}"
  COMPONENT DEVELOP)

if(GR_PACKAGING)
  include(GrStudioCPack)
endif()
