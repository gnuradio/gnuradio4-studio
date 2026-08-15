#[[ SPDX-License-Identifier: MIT ]]

function(gr4_studio_add_block_test test_name)
  add_executable(${test_name} ${test_name}.cpp)
  target_link_libraries(${test_name} PRIVATE gr4_studio::blocks_studio_headers ${ARGN})

  # These tests exercise blocks through both their C++ interfaces and the
  # generated plugin. Ensure a targeted test build produces the plugin and
  # make the build-tree plugin discoverable without requiring an install.
  add_dependencies(${test_name} Gr4StudioBlocksPlugin)
  add_test(
    NAME ${test_name}
    COMMAND
      ${CMAKE_COMMAND} -E env
      "GNURADIO4_PLUGIN_DIRECTORIES=$<TARGET_FILE_DIR:Gr4StudioBlocksPlugin>"
      ${CMAKE_CROSSCOMPILING_EMULATOR}
      $<TARGET_FILE:${test_name}>)
endfunction()

gr4_studio_add_block_test(qa_StudioPowerSpectrumSink)
gr4_studio_add_block_test(qa_StudioAudioSink)
gr4_studio_add_block_test(qa_Studio2DSeriesSink)
gr4_studio_add_block_test(qa_StudioSeriesSink)
gr4_studio_add_block_test(qa_StudioScalarSink ${GR4_STUDIO_HTTPLIB_TARGET})
gr4_studio_add_block_test(qa_StudioWaterfallSink)
