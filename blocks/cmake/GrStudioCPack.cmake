#[[ SPDX-License-Identifier: MIT ]]

# CPack configuration for the Studio blocks, included at the end of the top-level CMakeLists.txt when
# GR_PACKAGING is on. It follows gr-core's and gr-blocks' configurations and uses gr-core's installer
# helpers (GrInnoSetup, GrProductBuild), so the blocks install into the same root and plugin tree as
# every other GR 4 package.
#
# Components:
#   CORE     the block plugin (REQUIRED). On Windows and macOS it goes to the shared plugin tree the
#            plugin loader searches; on Linux to <libdir>/gnuradio-4/plugins.
#   DEVELOP  the headers, the import library and the gnuradio4StudioBlocks CMake package.
#   SYMBOLS  the plugin's PDB, with MSVC.

set(CPACK_PACKAGE_NAME "gnuradio4-studio-blocks")
set(CPACK_PACKAGE_VENDOR "GNU Radio")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "GNU Radio 4 Studio blocks")
set(CPACK_PACKAGE_CONTACT "admin@gnuradio.org")
# without this CPack substitutes its own placeholder licence into the installer
set(CPACK_RESOURCE_FILE_LICENSE "${PROJECT_SOURCE_DIR}/../LICENSE")
set(CPACK_PACKAGE_VERSION_MAJOR ${PROJECT_VERSION_MAJOR})
set(CPACK_PACKAGE_VERSION_MINOR ${PROJECT_VERSION_MINOR})
set(CPACK_PACKAGE_VERSION_PATCH ${PROJECT_VERSION_PATCH})
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")

include(CPackComponent)

# the components are whatever the install() rules name, read once they have all run, so a new one
# cannot be left out of the installer by a list kept here by hand
get_cmake_property(GR4_STUDIO_CPACK_COMPONENTS COMPONENTS)
set(CPACK_COMPONENTS_ALL ${GR4_STUDIO_CPACK_COMPONENTS})
foreach(_gr4_studio_component IN LISTS CPACK_COMPONENTS_ALL)
  # Inno Setup's compiler rejects any other component name, but only once staging has finished
  if(NOT _gr4_studio_component MATCHES "^[A-Za-z_][A-Za-z0-9_]*$" OR _gr4_studio_component MATCHES "^(not|and|or)$")
    message(FATAL_ERROR "install component '${_gr4_studio_component}' is not a valid Inno Setup component name: "
                        "use letters, digits and underscores, not starting with a digit")
  endif()
endforeach()

cpack_add_component(
  CORE
  DISPLAY_NAME "Studio blocks"
  DESCRIPTION "The GNU Radio 4 Studio block plugin: the sinks GNU Radio Studio plots"
  REQUIRED)
cpack_add_component(
  DEVELOP
  DISPLAY_NAME "Development files"
  DESCRIPTION "Headers, the import library and the gnuradio4StudioBlocks CMake package, to build against the Studio blocks")
# DISABLED, as in gr-core: the preselection that would otherwise deselect it is skipped on upgrades
cpack_add_component(SYMBOLS DISPLAY_NAME "Debug symbols" DESCRIPTION "Program database file for debugging the plugin"
                    DISABLED)

# The manifest records the CMake package and headers under the install root as a component package,
# and the plugin in the shared tree as a plugin package, under its GR_PLUGIN name.
set(GR4_STUDIO_MANIFEST_PACKAGE "gr-studio-blocks=${CPACK_PACKAGE_VERSION}")
set(GR4_STUDIO_MANIFEST_PLUGIN "Gr4StudioBlocks=${CPACK_PACKAGE_VERSION}")

# APPLE implies UNIX, so macOS must be excluded here or it would build a .deb on a Mac
if(UNIX AND NOT APPLE)
  if(NOT CPACK_GENERATOR)
    set(CPACK_GENERATOR "DEB")
  endif()
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
  set(CPACK_DEBIAN_FILE_NAME DEB-DEFAULT)
  # with a non-standard prefix dpkg-shlibdeps cannot find GR 4's own libraries without this
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS_PRIVATE_DIRS "${CMAKE_INSTALL_PREFIX}/${CMAKE_INSTALL_LIBDIR}")
  # the plugin is opened by gr-core's loader and its CMake package finds gnuradio4Library, neither of
  # which dpkg-shlibdeps can see
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "gnuradio4-core, gnuradio4-blocks")
  if(CMAKE_BUILD_TYPE STREQUAL "Debug" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    set(CPACK_DEBIAN_DEBUGINFO_PACKAGE ON)
  endif()
endif()

if(APPLE)
  set(CPACK_GENERATOR "productbuild")
  if(NOT COMMAND gr_configure_productbuild_installer)
    message(FATAL_ERROR "GR_PACKAGING on macOS needs a gnuradio4 core that installs GrProductBuild.cmake")
  endif()
  # the identifier names this installer to pkgutil across releases: never change it or reuse it
  gr_configure_productbuild_installer(
    IDENTIFIER
    "org.gnuradio.gr4.studio-blocks"
    PACKAGES
    "${GR4_STUDIO_MANIFEST_PACKAGE}"
    REGISTER_COMPONENT
    CORE
    PRESELECTED_COMPONENTS
    CORE
    DEVELOP)
  gr_configure_productbuild_plugins(PACKAGES "${GR4_STUDIO_MANIFEST_PLUGIN}" COMPONENTS CORE)
endif()

if(WIN32)
  set(CPACK_GENERATOR "INNOSETUP")
  if(NOT COMMAND gr_configure_innosetup_installer)
    message(FATAL_ERROR "GR_PACKAGING on Windows needs a gnuradio4 core that installs GrInnoSetup.cmake")
  endif()
  set(CPACK_INNOSETUP_USE_CMAKE_BOOL_FORMAT ON)
  set(CPACK_INNOSETUP_USE_MODERN_WIZARD ON)
  set(CPACK_INNOSETUP_ALLOW_CUSTOM_DIRECTORY ON)
  # fallback only: the installer takes the install root from the shared manifest when GR 4 is installed
  set(CPACK_INNOSETUP_INSTALL_ROOT "{autopf}")
  set(CPACK_PACKAGE_INSTALL_DIRECTORY "GNURadio4")
  # the AppId names this installer to Windows across releases: never change it or reuse it
  gr_configure_innosetup_installer(
    APP_ID
    "{{a1e59790-27bb-4de2-9626-be5ae5fddb99}"
    PACKAGES
    "${GR4_STUDIO_MANIFEST_PACKAGE}"
    PRESELECTED_COMPONENTS
    CORE
    DEVELOP)
  gr_configure_innosetup_plugins(PACKAGES "${GR4_STUDIO_MANIFEST_PLUGIN}" COMPONENTS CORE)
endif()

include(CPack)
