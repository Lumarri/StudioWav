cmake_minimum_required(VERSION 3.22)
project(StudioWavNative VERSION 0.2.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)
add_subdirectory(vendor/JUCE-8.0.12 JUCE)
juce_add_console_app(StudioWavAudio PRODUCT_NAME "StudioWavAudio")
target_sources(StudioWavAudio PRIVATE Main.cpp Engine.cpp Engine.h)
target_compile_definitions(StudioWavAudio PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_ASIO=1 JUCE_PLUGINHOST_VST3=1 JUCE_PLUGINHOST_VST=0
    JUCE_DISPLAY_SPLASH_SCREEN=0 JUCE_REPORT_APP_USAGE=0)
target_link_libraries(StudioWavAudio PRIVATE juce::juce_audio_utils juce::juce_cryptography juce::juce_recommended_config_flags)
if(MSVC)
  target_compile_options(StudioWavAudio PRIVATE /bigobj /utf-8)
endif()

foreach(kind Piano Kick)
  set(instrument_target StudioWav${kind})
  if(kind STREQUAL "Kick")
    set(instrument_code SwKk)
    set(instrument_kick 1)
  else()
    set(instrument_code SwPn)
    set(instrument_kick 0)
  endif()
  juce_add_plugin(${instrument_target} COMPANY_NAME StudioWav PLUGIN_MANUFACTURER_CODE StWv
    PLUGIN_CODE ${instrument_code} FORMATS VST3 PRODUCT_NAME "StudioWav ${kind}"
    VERSION 0.5.0 IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE NEEDS_MIDI_OUTPUT FALSE
    COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(${instrument_target} PRIVATE Instruments.cpp)
  target_compile_definitions(${instrument_target} PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0 STUDIOWAV_KICK=${instrument_kick})
  target_link_libraries(${instrument_target} PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
  juce_add_console_app(${instrument_target}Check PRODUCT_NAME "${instrument_target}Check")
  target_sources(${instrument_target}Check PRIVATE InstrumentCheck.cpp)
  target_include_directories(${instrument_target}Check PRIVATE vendor/JUCE-8.0.12/modules)
  target_compile_definitions(${instrument_target}Check PRIVATE JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
    JUCE_STANDALONE_APPLICATION=1 JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
  target_link_libraries(${instrument_target}Check PRIVATE ${instrument_target})
endforeach()
juce_add_console_app(StudioWavMidiCheck PRODUCT_NAME "StudioWavMidiCheck")
target_sources(StudioWavMidiCheck PRIVATE MidiFileCheck.cpp)
target_include_directories(StudioWavMidiCheck PRIVATE vendor/JUCE-8.0.12/modules)
target_compile_definitions(StudioWavMidiCheck PRIVATE JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
  JUCE_STANDALONE_APPLICATION=1 JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(StudioWavMidiCheck PRIVATE StudioWavPiano)
set_target_properties(StudioWavAudio PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/bin")
option(STUDIOWAV_TEST_PLUGIN "Build the deterministic VST3 integration fixture" ON)
if(STUDIOWAV_TEST_PLUGIN)
  juce_add_plugin(StudioWavTestGain COMPANY_NAME StudioWav PLUGIN_MANUFACTURER_CODE StWv
    PLUGIN_CODE SwTg FORMATS VST3 PRODUCT_NAME "StudioWav Test Gain" IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE NEEDS_MIDI_OUTPUT FALSE COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(StudioWavTestGain PRIVATE TestPlugin.cpp)
  target_compile_definitions(StudioWavTestGain PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
  target_link_libraries(StudioWavTestGain PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()
