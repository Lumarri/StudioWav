#include <juce_audio_utils/juce_audio_utils.h>
#include <array>
#include <atomic>
#include <cmath>
#include "PresetBank.h"

// Original StudioWav synthesis. No Image-Line code, binaries or samples.
namespace {
constexpr bool kick = STUDIOWAV_KICK != 0;
constexpr double pi = juce::MathConstants<double>::pi;
struct Voice {
  bool active = false, held = false, sustained = false;
  int note = 60, channel = 1;
  double age = 0, phase = 0, release = 1, hz = 440;
  float velocity = 0, pan = 0;
  uint32_t noise = 1;
  std::array<double, 12> partial{};
};
class Instrument final : public juce::AudioProcessor {
public:
  Instrument()
      : AudioProcessor(BusesProperties().withOutput(
            "Output", juce::AudioChannelSet::stereo(), true)),
        state(*this, nullptr, "StudioWavInstrument", layout()) {
    for (int c = 0; c < 16; ++c) bend[(size_t)c] = 1;
  }
  static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
    juce::AudioProcessorValueTreeState::ParameterLayout result;
    auto add = [&](const char *id, const char *name, float low, float high,
                   float initial, float skew = 1) {
      result.add(std::make_unique<juce::AudioParameterFloat>(
          juce::ParameterID(id, 1), name,
          juce::NormalisableRange<float>(low, high, 0.001f, skew), initial));
    };
    add("level", "Level", 0, 1, .75f);
    if (kick) {
      add("tune", "Tune Hz", 30, 100, 48);
      add("sweep", "Pitch sweep", 0, 300, 125);
      add("pitchDecay", "Pitch decay ms", 5, 180, 38, .5f);
      add("decay", "Decay ms", 60, 2400, 440, .5f);
      add("click", "Click", 0, 1, .18f);
      add("drive", "Drive", 0, 1, .12f);
    } else {
      add("tone", "Brightness", 0, 1, .48f);
      add("decay", "Decay seconds", .3f, 12, 4.2f, .5f);
      add("release", "Release ms", 20, 1800, 180, .5f);
      add("hammer", "Hammer", 0, 1, .22f);
      add("width", "Stereo width", 0, 1, .65f);
    }
    return result;
  }
  float value(const char *id) const { return state.getRawParameterValue(id)->load(); }
  const juce::String getName() const override {
    return kick ? "StudioWav Kick" : "StudioWav Piano";
  }
  void prepareToPlay(double rate, int) override { sampleRate = rate; reset(); }
  void releaseResources() override {}
  void reset() override {
    voices = {};
    pedal.fill(false);
    bend.fill(1);
  }
  bool isBusesLayoutSupported(const BusesLayout &l) const override {
    return l.getMainInputChannelSet().isDisabled() &&
           l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
  }
  void handle(const juce::MidiMessage &m) {
    const auto ch = (size_t)juce::jlimit(0, 15, m.getChannel() - 1);
    if (m.isNoteOn()) {
      // Retrigger a held pitch, otherwise use a free/oldest voice.
      Voice *selected = nullptr;
      for (auto &v : voices)
        if (v.active && v.held && v.note == m.getNoteNumber() &&
            v.channel == m.getChannel()) { selected = &v; break; }
      if (!selected)
        for (auto &v : voices) if (!v.active) { selected = &v; break; }
      if (!selected) {
        selected = &voices[0];
        for (auto &v : voices) if (v.age > selected->age) selected = &v;
      }
      *selected = {};
      selected->active = selected->held = true;
      selected->note = m.getNoteNumber(); selected->channel = m.getChannel();
      selected->hz = juce::MidiMessage::getMidiNoteInHertz(m.getNoteNumber());
      selected->velocity = m.getFloatVelocity();
      selected->pan = (float)juce::jlimit(-1., 1., (m.getNoteNumber() - 60) / 36.);
      selected->noise = (uint32_t)(m.getNoteNumber() * 1907 + 1);
    } else if (m.isNoteOff()) {
      for (auto &v : voices)
        if (v.active && v.channel == m.getChannel() && v.note == m.getNoteNumber()) {
          v.held = false; v.sustained = pedal[ch];
        }
    } else if (m.isController() && m.getControllerNumber() == 64) {
      pedal[ch] = m.getControllerValue() >= 64;
      if (!pedal[ch]) for (auto &v : voices)
        if (v.channel == m.getChannel()) v.sustained = false;
    } else if (m.isAllSoundOff() || m.isAllNotesOff()) {
      for (auto &v : voices) if (v.channel == m.getChannel()) v.active = false;
      pedal[ch] = false;
    } else if (m.isPitchWheel()) {
      bend[ch] = std::pow(2., ((m.getPitchWheelValue() - 8192) / 8192.) * 2. / 12.);
    } else if (m.isController() && m.getControllerNumber() == 121) {
      pedal[ch] = false; bend[ch] = 1;
      for (auto &v : voices) if (v.channel == m.getChannel()) v.sustained = false;
    }
  }
  void render(juce::AudioBuffer<float> &b, int from, int count) {
    if (count <= 0) return;
    const float level = value("level"), decay = value("decay");
    const float a = value(kick ? "tune" : "tone");
    const float bb = value(kick ? "sweep" : "release");
    const float cc = value(kick ? "pitchDecay" : "hammer");
    const float d = value(kick ? "click" : "width");
    const float drive = kick ? value("drive") : 0;
    const double releaseFactor = kick ? 1 : std::exp(-1. / (sampleRate * bb / 1000.));
    for (auto &v : voices) {
      if (!v.active) continue;
      const double pitchBend = bend[(size_t)(v.channel - 1)];
      for (int i = from; i < from + count; ++i) {
        double x = 0;
        v.noise = 1664525u * v.noise + 1013904223u;
        double noise = (double)v.noise / 2147483648. - 1;
        if (kick) {
          const double hz = (a + bb * std::exp(-v.age / (cc / 1000.))) *
                            std::pow(2., (v.note - 60) / 12.) * pitchBend;
          v.phase = std::fmod(v.phase + 2 * pi * juce::jmin(hz, sampleRate * .4) / sampleRate, 2 * pi);
          const double env = std::exp(-v.age * 6.907755 / (decay / 1000.));
          x = std::sin(v.phase) * env + noise * d * std::exp(-v.age * 600);
          x = std::tanh(x * (1 + drive * 6)) / std::tanh(1 + drive * 6);
          x *= juce::jmin(1., v.age * 1800.) * v.velocity * .8;
          if (env < .00003) { v.active = false; break; }
        } else {
          // Inharmonic decaying strings with a velocity-dependent hammer spectrum.
          const double hz = v.hz * pitchBend;
          const double bright = .22 + a * .65 + v.velocity * .28;
          for (int h = 0; h < 12; ++h) {
            const double harmonic = h + 1.;
            const double partialHz = hz * harmonic * std::sqrt(1 + .00008 * harmonic * harmonic);
            if (partialHz >= sampleRate * .45) continue;
            v.partial[(size_t)h] = std::fmod(v.partial[(size_t)h] + 2 * pi * partialHz / sampleRate, 2 * pi);
            const double amp = std::pow(bright, h) / harmonic;
            const double stringDecay = decay / (1 + h * .22) * std::pow(440. / hz, .16);
            x += std::sin(v.partial[(size_t)h]) * amp * std::exp(-v.age * 3.5 / stringDecay);
          }
          x += noise * cc * (.3 + v.velocity * .7) * std::exp(-v.age * 650) * .35;
          if (!v.held && !v.sustained) v.release *= releaseFactor;
          x *= (1 - std::exp(-v.age * 1900)) * v.release * v.velocity * v.velocity * .27;
          if (v.release < .00003 || v.age > decay * 4) { v.active = false; break; }
        }
        const double pan = kick ? 0 : v.pan * d * .7;
        b.addSample(0, i, (float)(x * level * std::sqrt((1 - pan) * .5)));
        b.addSample(1, i, (float)(x * level * std::sqrt((1 + pan) * .5)));
        v.age += 1. / sampleRate;
      }
    }
  }
  void processBlock(juce::AudioBuffer<float> &b, juce::MidiBuffer &midi) override {
    juce::ScopedNoDenormals noDenormals;
    b.clear();
    int pos = 0;
    for (const auto event : midi) {
      const int at = juce::jlimit(pos, b.getNumSamples(), event.samplePosition);
      render(b, pos, at - pos); handle(event.getMessage()); pos = at;
    }
    render(b, pos, b.getNumSamples() - pos);
    midi.clear();
  }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  double getTailLengthSeconds() const override { return kick ? 4 : 48; }
  int getNumPrograms() override { return swbank::count(); }
  int getCurrentProgram() override { return program.load(); }
  const juce::String getProgramName(int index) override {
    return swbank::name(index);
  }
  void setCurrentProgram(int index) override {
    index = swbank::clamp(index); program.store(index);
    swbank::apply(state, index);
  }
  void changeProgramName(int, const juce::String &) override {}
  bool hasEditor() const override { return true; }
  class Editor final : public juce::AudioProcessorEditor, private juce::Timer {
  public:
    explicit Editor(Instrument &p) : AudioProcessorEditor(p), owner(p), controls(p) {
      title.setText(p.getName() + " | Original synthesis", juce::dontSendNotification);
      title.setColour(juce::Label::textColourId, juce::Colours::lightgreen);
      addAndMakeVisible(title); addAndMakeVisible(presets); addAndMakeVisible(controls);
      for (int i = 0; i < p.getNumPrograms(); ++i) presets.addItem(p.getProgramName(i), i + 1);
      presets.setSelectedId(p.getCurrentProgram() + 1, juce::dontSendNotification);
      presets.onChange = [&] { owner.setCurrentProgram(presets.getSelectedId() - 1); };
      setSize(480, controls.getHeight() + 88); startTimerHz(5);
    }
    void paint(juce::Graphics &g) override { g.fillAll(juce::Colour(0xff202832)); }
    void resized() override {
      title.setBounds(12, 8, getWidth() - 24, 24);
      presets.setBounds(16, 39, getWidth() - 32, 26);
      controls.setBounds(0, 80, getWidth(), getHeight() - 80);
    }
  private:
    void timerCallback() override { presets.setSelectedId(owner.getCurrentProgram() + 1, juce::dontSendNotification); }
    Instrument &owner;
    juce::Label title;
    juce::ComboBox presets;
    juce::GenericAudioProcessorEditor controls;
  };
  juce::AudioProcessorEditor *createEditor() override { return new Editor(*this); }
  void getStateInformation(juce::MemoryBlock &b) override {
    auto tree = state.copyState();
    tree.setProperty("program", program.load(), nullptr);
    if (auto xml = tree.createXml()) copyXmlToBinary(*xml, b);
  }
  void setStateInformation(const void *data, int bytes) override {
    if (auto xml = getXmlFromBinary(data, bytes))
      if (xml->hasTagName(state.state.getType())) {
        auto tree = juce::ValueTree::fromXml(*xml);
        program.store(swbank::clamp((int)tree.getProperty("program", 0)));
        state.replaceState(tree);
      }
  }
private:
  juce::AudioProcessorValueTreeState state;
  std::array<Voice, 64> voices{};
  std::array<bool, 16> pedal{};
  std::array<double, 16> bend{};
  std::atomic<int> program{0};
  double sampleRate = 48000;
};
}
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new Instrument; }
