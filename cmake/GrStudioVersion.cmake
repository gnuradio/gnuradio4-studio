#[[ SPDX-License-Identifier: MIT ]]

# package.json holds the one Studio version, for the app, the blocks and their installers alike.
# Include this before project(). It sets
#
#   GR4_STUDIO_VERSION          the version as package.json writes it, such as 0.2.0-rc.1
#   GR4_STUDIO_NUMERIC_VERSION  its major.minor.patch, which is all project() accepts
#
# and reconfigures the including project whenever package.json changes.
include_guard(GLOBAL)

set(GR4_STUDIO_PACKAGE_JSON "${CMAKE_CURRENT_LIST_DIR}/../package.json")
file(READ "${GR4_STUDIO_PACKAGE_JSON}" _gr4_studio_package_json_text)
string(JSON GR4_STUDIO_VERSION GET "${_gr4_studio_package_json_text}" version)
string(REGEX MATCH "^[0-9]+\\.[0-9]+\\.[0-9]+" GR4_STUDIO_NUMERIC_VERSION "${GR4_STUDIO_VERSION}")
if(NOT GR4_STUDIO_NUMERIC_VERSION)
  message(FATAL_ERROR "package.json version '${GR4_STUDIO_VERSION}' does not start with major.minor.patch")
endif()
set_property(
  DIRECTORY
  APPEND
  PROPERTY CMAKE_CONFIGURE_DEPENDS "${GR4_STUDIO_PACKAGE_JSON}")
unset(_gr4_studio_package_json_text)
