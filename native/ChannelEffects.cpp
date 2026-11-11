#include "ChannelEffects.h"
#include <cmath>
#include <stdexcept>

namespace sw {
ChannelEffectSettings ChannelEffectSettings::read(const juce::var &value) {
  ChannelEffectSettings s;
  if (value.isVoid())
    return s;
  if (!value.isObject() || !value["eq"].isObject() ||
      !value["compressor"].isObject())
    throw std::runtime_error("Efectos de canal invalidos.");
  auto &eq = value["eq"];
  auto &comp = value["compressor"];
  if (!eq["enabled"].isBool() || !comp["enabled"].isBool())
    throw std::runtime_error("Bypass de efectos invalido.");
  auto read = [](const juce::var &v, const char *name, double min, double max) {
    auto n = v[name];
    const double number = (double)n;
    if (!(n.isInt() || n.isInt64() || n.isDouble()) || !std::isfinite(number) ||
        number < min || number > max)
      throw std::runtime_error("Parametro de efectos fuera de rango.");
    return (float)number;
  };
  s.eq = (bool)eq["enabled"];
  s.compressor = (bool)comp["enabled"];
  s.low = read(eq, "low", -18, 18);
  s.mid = read(eq, "mid", -18, 18);
  s.high = read(eq, "high", -18, 18);
  s.midHz = read(eq, "midHz", 160, 6000);
  s.threshold = read(comp, "threshold", -60, 0);
  s.ratio = read(comp, "ratio", 1, 20);
  s.attack = read(comp, "attack", .1, 200);
  s.release = read(comp, "release", 10, 2000);
  s.makeup = read(comp, "makeup", 0, 24);
  return s;
}
void ChannelEffectProcessor::configure(const ChannelEffectSettings &s,
                                       double rate) {
  if (s.eq != settings.eq)
    for (auto &channel : filters)
      for (auto &filter : channel)
        filter.reset();
  if (s.compressor != settings.compressor) {
    gainReduction = 0;
    observedReduction.store(0);
  }
  settings = s;
  auto db = [](float n) { return juce::Decibels::decibelsToGain(n); };
  // JUCE's shelving/peaking coefficients implement the standard RBJ biquads.
  // Shelf Q=sqrt(1/2) corresponds to slope S=1; the middle bell uses Q=0.7.
  const auto low = juce::IIRCoefficients::makeLowShelf(
      rate, juce::jmin(120., rate * .45), std::sqrt(.5), db(s.low));
  const auto mid = juce::IIRCoefficients::makePeakFilter(
      rate, juce::jmin((double)s.midHz, rate * .45), .7, db(s.mid));
  const auto high = juce::IIRCoefficients::makeHighShelf(
      rate, juce::jmin(8000., rate * .45), std::sqrt(.5), db(s.high));
  for (auto &channel : filters) {
    channel[0].setCoefficients(low);
    channel[1].setCoefficients(mid);
    channel[2].setCoefficients(high);
  }
  attack = std::exp(-1. / (rate * s.attack * .001));
  release = std::exp(-1. / (rate * s.release * .001));
}
void ChannelEffectProcessor::process(juce::AudioBuffer<float> &buffer, int n) {
  if (settings.eq)
    for (int c = 0; c < 2; ++c)
      for (auto &filter : filters[(size_t)c])
        filter.processSamples(buffer.getWritePointer(c), n);
  if (!settings.compressor) {
    observedReduction.store(0);
    return;
  }
  auto *left = buffer.getWritePointer(0), *right = buffer.getWritePointer(1);
  double peakReduction = 0;
  for (int i = 0; i < n; ++i) {
    const double peak = juce::jmax(std::abs(left[i]), std::abs(right[i]));
    const double level = 20 * std::log10(juce::jmax(1e-9, peak));
    const double target = juce::jmax(0., (level - settings.threshold) *
                                             (1. - 1. / settings.ratio));
    const double coefficient = target > gainReduction ? attack : release;
    gainReduction = coefficient * gainReduction + (1 - coefficient) * target;
    const float gain =
        (float)std::pow(10., (settings.makeup - gainReduction) / 20.);
    left[i] *= gain;
    right[i] *= gain;
    peakReduction = juce::jmax(peakReduction, gainReduction);
  }
  observedReduction.store((float)peakReduction);
}
void ChannelEffectProcessor::reset() {
  for (auto &channel : filters)
    for (auto &filter : channel)
      filter.reset();
  gainReduction = 0;
  observedReduction.store(0);
}
} // namespace sw
