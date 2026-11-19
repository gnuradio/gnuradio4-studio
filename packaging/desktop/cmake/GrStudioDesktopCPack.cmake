#[[ SPDX-License-Identifier: MIT ]]

# CPack configuration for the Studio desktop app, included at the end of packaging/desktop's
# CMakeLists.txt when GR_PACKAGING is on. Like the Studio blocks it uses gr-core's installer helpers,
# so the app installs into the same root as the control plane it starts (bin/gr4cp_server), which is
# how it finds its prefix.
#
# One component, CORE: the app, its bundled Electron runtime and its launchers.

if(WIN32 OR APPLE)
  # gr-core's installer helpers, and GR_PLUGIN_API_VERSION, which keys the install root
  find_package(gnuradio4 CONFIG REQUIRED)
endif()

set(CPACK_PACKAGE_NAME "gnuradio4-studio")
set(CPACK_PACKAGE_VENDOR "GNU Radio")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "GNU Radio 4 Studio, the desktop app for building and running flowgraphs")
set(CPACK_PACKAGE_CONTACT "admin@gnuradio.org")
# without this CPack substitutes its own placeholder licence into the installer
set(CPACK_RESOURCE_FILE_LICENSE "${GR4_STUDIO_SOURCE_ROOT}/LICENSE")
set(CPACK_PACKAGE_VERSION_MAJOR ${PROJECT_VERSION_MAJOR})
set(CPACK_PACKAGE_VERSION_MINOR ${PROJECT_VERSION_MINOR})
set(CPACK_PACKAGE_VERSION_PATCH ${PROJECT_VERSION_PATCH})
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")

include(CPackComponent)
set(CPACK_COMPONENTS_ALL CORE)
cpack_add_component(
  CORE
  DISPLAY_NAME "Studio"
  DESCRIPTION "GNU Radio 4 Studio and the Electron runtime it runs on"
  REQUIRED)

set(GR4_STUDIO_MANIFEST_PACKAGE "gr-studio=${CPACK_PACKAGE_VERSION}")

# APPLE implies UNIX, so macOS must be excluded here or it would build a .deb on a Mac
if(UNIX AND NOT APPLE)
  if(NOT CPACK_GENERATOR)
    set(CPACK_GENERATOR "DEB")
  endif()
  set(CPACK_DEBIAN_FILE_NAME DEB-DEFAULT)
  # Electron's own system libraries (GTK, NSS and the rest) come from dpkg-shlibdeps. The libraries it
  # bundles beside its executable are private to it.
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)
  set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS_PRIVATE_DIRS
      "${CMAKE_INSTALL_PREFIX}/libexec/gr4-studio/electron")
  # local mode starts gr4cp_server, which serves the blocks, the Studio ones among them
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "gnuradio4-control-plane, gnuradio4-studio-blocks")
  set(CPACK_DEBIAN_PACKAGE_SECTION "hamradio")

  # load and unload the AppArmor profile Electron needs where user namespaces are restricted
  set(GR4_STUDIO_PACKAGE_PREFIX "${CPACK_PACKAGING_INSTALL_PREFIX}")
  if(NOT GR4_STUDIO_PACKAGE_PREFIX)
    set(GR4_STUDIO_PACKAGE_PREFIX "/usr")
    set(CPACK_PACKAGING_INSTALL_PREFIX "/usr")
  endif()
  foreach(_gr4_studio_script IN ITEMS postinst prerm)
    configure_file("${CMAKE_CURRENT_LIST_DIR}/../debian/${_gr4_studio_script}.in"
                   "${CMAKE_CURRENT_BINARY_DIR}/debian/${_gr4_studio_script}" @ONLY NEWLINE_STYLE LF
                   FILE_PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE GROUP_READ GROUP_EXECUTE WORLD_READ
                                    WORLD_EXECUTE)
  endforeach()
  set(CPACK_DEBIAN_PACKAGE_CONTROL_EXTRA "${CMAKE_CURRENT_BINARY_DIR}/debian/postinst"
                                         "${CMAKE_CURRENT_BINARY_DIR}/debian/prerm")
  set(CPACK_DEBIAN_PACKAGE_CONTROL_STRICT_PERMISSION ON)
endif()

if(APPLE)
  set(CPACK_GENERATOR "productbuild")
  if(NOT COMMAND gr_configure_productbuild_installer)
    message(FATAL_ERROR "GR_PACKAGING on macOS needs a gnuradio4 core that installs GrProductBuild.cmake")
  endif()
  # the identifier names this installer to pkgutil across releases: never change it or reuse it
  gr_configure_productbuild_installer(
    IDENTIFIER
    "org.gnuradio.gr4.studio"
    PACKAGES
    "${GR4_STUDIO_MANIFEST_PACKAGE}"
    REGISTER_COMPONENT
    CORE)
endif()

if(WIN32)
  set(CPACK_GENERATOR "INNOSETUP")
  if(NOT COMMAND gr_configure_innosetup_installer)
    message(FATAL_ERROR "GR_PACKAGING on Windows needs a gnuradio4 core that installs GrInnoSetup.cmake")
  endif()
  # The project compiles nothing, so CMake cannot tell the architecture. The one that matters is the
  # bundled Electron's, which install-desktop.mjs downloads for Node's own architecture.
  execute_process(
    COMMAND "${GR4_STUDIO_NODE}" -p process.arch
    OUTPUT_VARIABLE GR4_STUDIO_ELECTRON_ARCH
    OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  if(GR4_STUDIO_ELECTRON_ARCH STREQUAL "x64")
    set(CPACK_INNOSETUP_ARCHITECTURE x64)
    set(CPACK_SYSTEM_NAME win64)
  elseif(GR4_STUDIO_ELECTRON_ARCH STREQUAL "arm64")
    set(CPACK_INNOSETUP_ARCHITECTURE arm64)
    set(CPACK_SYSTEM_NAME winarm64)
  else()
    message(FATAL_ERROR "No Windows installer architecture for Electron's '${GR4_STUDIO_ELECTRON_ARCH}'")
  endif()
  set(CPACK_INNOSETUP_USE_CMAKE_BOOL_FORMAT ON)
  set(CPACK_INNOSETUP_USE_MODERN_WIZARD ON)
  set(CPACK_INNOSETUP_ALLOW_CUSTOM_DIRECTORY ON)
  # fallback only: the installer takes the install root from the shared manifest when GR 4 is installed
  set(CPACK_INNOSETUP_INSTALL_ROOT "{autopf}")
  set(CPACK_PACKAGE_INSTALL_DIRECTORY "GNURadio4")
  # the AppId names this installer to Windows across releases: never change it or reuse it
  gr_configure_innosetup_installer(APP_ID "{{5b2bc818-6629-4934-bb0a-b753abc687ab}" PACKAGES
                                   "${GR4_STUDIO_MANIFEST_PACKAGE}")
  # The Start Menu shortcut. install-desktop.mjs writes the app's files rather than an install()
  # rule, so CPack's CPACK_START_MENU_SHORTCUTS property has nothing to attach to; the entry is added
  # to the script directly, after gr_configure_innosetup_installer() has set its own extra scripts.
  configure_file("${CMAKE_CURRENT_LIST_DIR}/../innosetup/shortcuts.iss.in"
                 "${CMAKE_CURRENT_BINARY_DIR}/packaging/innosetup/gr4_studio_shortcuts.iss" @ONLY)
  list(APPEND CPACK_INNOSETUP_EXTRA_SCRIPTS "${CMAKE_CURRENT_BINARY_DIR}/packaging/innosetup/gr4_studio_shortcuts.iss")
endif()

include(CPack)
