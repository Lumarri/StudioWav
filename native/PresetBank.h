#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "StudioWavPresetData.h"
namespace swbank {
inline const juce::var &instrument() {
  static const juce::var catalog = juce::JSON::parse(juce::String::fromUTF8(swpresets::instruments_json, swpresets::instruments_jsonSize));
  return catalog[STUDIOWAV_INSTRUMENT_ID];
}
inline int count() { return instrument()["presets"].size(); }
inline int clamp(int index) { return juce::jlimit(0, count() - 1, index); }
inline juce::String name(int index) { return instrument()["presets"][clamp(index)]["name"].toString(); }
inline void apply(juce::AudioProcessorValueTreeState &state, int index) {
  const auto &values = instrument()["presets"][clamp(index)]["values"];
  if (auto *object = values.getDynamicObject())
    for (const auto &entry : object->getProperties())
      if (auto *parameter = state.getParameter(entry.name.toString())) {
        parameter->beginChangeGesture();
        parameter->setValueNotifyingHost(parameter->convertTo0to1((float)entry.value));
        parameter->endChangeGesture();
      }
}
}
