#[[ SPDX-License-Identifier: MIT ]]

# Builds the Studio desktop app with npm and installs it into a GR 4 prefix, so that CPack can package
# it. scripts/install-desktop.mjs lays the app out, as it does for `npm run desktop:install`; this
# project only drives it. gr-super builds it with SOURCE_SUBDIR packaging/desktop.

cmake_minimum_required(VERSION 3.27)

# the version comes from package.json, shared with the blocks
include("${CMAKE_CURRENT_SOURCE_DIR}/../../cmake/GrStudioVersion.cmake")

project(
  gnuradio4Studio
  VERSION ${GR4_STUDIO_NUMERIC_VERSION}
  LANGUAGES NONE)

include(GNUInstallDirs)

option(GR_PACKAGING "Allow the Studio desktop app to be packaged with CPack" OFF)

# the npm project this one builds
cmake_path(SET GR4_STUDIO_SOURCE_ROOT NORMALIZE "${CMAKE_CURRENT_SOURCE_DIR}/../..")

# Node and npm are build tools only: the installed app runs on the Electron runtime it bundles.
find_program(GR4_STUDIO_NODE node REQUIRED)
# on Windows npm is a batch file, which only its .cmd name runs
find_program(GR4_STUDIO_NPM NAMES npm.cmd npm REQUIRED)
execute_process(
  COMMAND "${GR4_STUDIO_NODE}" --version
  OUTPUT_VARIABLE GR4_STUDIO_NODE_VERSION
  OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
string(REGEX REPLACE "^v" "" GR4_STUDIO_NODE_VERSION "${GR4_STUDIO_NODE_VERSION}")
if(GR4_STUDIO_NODE_VERSION VERSION_LESS 22)
  message(FATAL_ERROR "The Studio app needs Node 22 or later; ${GR4_STUDIO_NODE} is ${GR4_STUDIO_NODE_VERSION}")
endif()
message(STATUS "Node ${GR4_STUDIO_NODE_VERSION}: ${GR4_STUDIO_NODE}")

# npm ci only when the lock file changes. The Electron runtime is not downloaded here:
# install-desktop.mjs fetches it, through @electron/get's cache, when the app is installed.
set(GR4_STUDIO_NPM_STAMP "${CMAKE_CURRENT_BINARY_DIR}/npm-ci.stamp")
add_custom_command(
  OUTPUT "${GR4_STUDIO_NPM_STAMP}"
  COMMAND "${CMAKE_COMMAND}" -E env ELECTRON_SKIP_BINARY_DOWNLOAD=1 "${GR4_STUDIO_NPM}" ci --no-audit --no-fund
  COMMAND "${CMAKE_COMMAND}" -E touch "${GR4_STUDIO_NPM_STAMP}"
  DEPENDS "${GR4_STUDIO_SOURCE_ROOT}/package-lock.json"
  WORKING_DIRECTORY "${GR4_STUDIO_SOURCE_ROOT}"
  COMMENT "Installing the Studio app's npm dependencies"
  USES_TERMINAL VERBATIM)

# Vite rebuilds quickly and tracks its own inputs, so the bundle is rebuilt on every build.
add_custom_target(
  gr4-studio-desktop ALL
  COMMAND "${GR4_STUDIO_NPM}" run desktop:build
  DEPENDS "${GR4_STUDIO_NPM_STAMP}"
  WORKING_DIRECTORY "${GR4_STUDIO_SOURCE_ROOT}"
  COMMENT "Building the Studio desktop app"
  USES_TERMINAL VERBATIM)

# The script takes the project (dist/, desktop/, node_modules/electron) from its working directory, and
# unpacks the Electron archive with `cmake -E tar`. It lays the files out below DESTDIR and takes the
# paths it writes into them from the install prefix, so a staged package points at its final location.
install(
  CODE "
  execute_process(
    COMMAND \"\${CMAKE_COMMAND}\" -E env \"CMAKE_COMMAND=\${CMAKE_COMMAND}\"
            \"${GR4_STUDIO_NODE}\" scripts/install-desktop.mjs
            --prefix \"\$ENV{DESTDIR}\${CMAKE_INSTALL_PREFIX}\"
            --install-prefix \"\${CMAKE_INSTALL_PREFIX}\"
    WORKING_DIRECTORY \"${GR4_STUDIO_SOURCE_ROOT}\"
    COMMAND_ERROR_IS_FATAL ANY)"
  COMPONENT CORE)

if(GR_PACKAGING)
  include(cmake/GrStudioDesktopCPack.cmake)
endif()
