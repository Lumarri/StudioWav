#pragma once
#include <array>
#include <atomic>
#include <juce_audio_basics/juce_audio_basics.h>

namespace sw {
struct ChannelEffectSettings {
  bool eq = false, compressor = false;
  float low = 0, mid = 0, high = 0, midHz = 1000;
  float threshold = -18, ratio = 4, attack = 10, release = 150, makeup = 0;
  static ChannelEffectSettings read(const juce::var &);
};

// Three biquads followed by a stereo-linked peak compressor, with no lookahead.
class ChannelEffectProcessor {
public:
  void configure(const ChannelEffectSettings &, double sampleRate);
  void process(juce::AudioBuffer<float> &, int samples);
  void reset();
  float reduction() const { return observedReduction.load(); }

private:
  ChannelEffectSettings settings;
  std::array<std::array<juce::IIRFilter, 3>, 2> filters;
  double attack = 0, release = 0, gainReduction = 0;
  std::atomic<float> observedReduction{0};
};
} // namespace sw
