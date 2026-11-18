#[[ SPDX-License-Identifier: MIT ]]

# gnuradio4::gr-testing, for the test sources and tag monitors
find_package(gnuradio4Blocks CONFIG REQUIRED)

# gr4_studio_add_block_test(<name> [<link library>...])
#
# The tests exercise the blocks both through their C++ interfaces and through the plugin, so each
# depends on the plugin target and finds it in the build tree without an install.
function(gr4_studio_add_block_test name)
  add_executable(${name} ${name}.cpp)
  target_link_libraries(${name} PRIVATE gnuradio4::gr-studio ${ARGN})
  # the tests check their results with assert(), which NDEBUG would compile out of release builds
  target_compile_options(${name} PRIVATE $<IF:$<CXX_COMPILER_ID:MSVC>,/UNDEBUG,-UNDEBUG>)
  add_dependencies(${name} Gr4StudioBlocksPlugin)

  add_test(NAME ${name} COMMAND ${name})
  set_tests_properties(${name} PROPERTIES ENVIRONMENT
                                          "GNURADIO4_PLUGIN_DIRECTORIES=$<TARGET_FILE_DIR:Gr4StudioBlocksPlugin>")
  if(WIN32)
    # Windows has no RPATH: the DLLs the test and the plugin load are found through PATH
    set_property(
      TEST ${name}
      APPEND
      PROPERTY ENVIRONMENT_MODIFICATION
               "$<LIST:TRANSFORM,$<TARGET_RUNTIME_DLL_DIRS:${name}>,PREPEND,PATH=path_list_prepend:>")
  endif()
endfunction()

gr4_studio_add_block_test(qa_Studio2DSeriesSink)
gr4_studio_add_block_test(qa_StudioAudioSink)
gr4_studio_add_block_test(qa_StudioDataSetSink)
gr4_studio_add_block_test(qa_StudioPowerSpectrumSink)
gr4_studio_add_block_test(qa_StudioScalarSink)
gr4_studio_add_block_test(qa_StudioSeriesSink gnuradio4::gr-testing)
gr4_studio_add_block_test(qa_StudioWaterfallSink)
