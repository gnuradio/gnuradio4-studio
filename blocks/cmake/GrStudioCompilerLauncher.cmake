#[[ SPDX-License-Identifier: MIT ]]

include_guard(GLOBAL)

# Compiles through ccache when it is installed. A launcher given on the command line or by a preset
# (CMAKE_CXX_COMPILER_LAUNCHER) is kept as it is.
option(USE_CCACHE "Use ccache if available" ON)

if(USE_CCACHE AND NOT DEFINED CMAKE_CXX_COMPILER_LAUNCHER)
  find_program(CCACHE_PROGRAM ccache)
  if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
  endif()
endif()

if(CMAKE_CXX_COMPILER_LAUNCHER)
  message(STATUS "Compiler launcher: ${CMAKE_CXX_COMPILER_LAUNCHER}")
endif()

# Ninja and ccache both capture compiler output, which defeats the compiler's own terminal
# detection, so ask for colour explicitly unless the user already chose.
if((CMAKE_GENERATOR MATCHES "Ninja" OR CMAKE_CXX_COMPILER_LAUNCHER) AND NOT DEFINED CMAKE_COLOR_DIAGNOSTICS)
  set(CMAKE_COLOR_DIAGNOSTICS ON)
endif()
