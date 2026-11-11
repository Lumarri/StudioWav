#include "PresetBank.h"
#include <array>
#include <atomic>
#include <cmath>
#include <vector>

// Original StudioWav DSP: polyBLEP oscillators, a three-operator FM chain,
// and a fractional-delay plucked string. No external samples or plugin code.
namespace {
constexpr int kind = STUDIOWAV_KIND;
constexpr bool triple = kind == 2, fm = kind == 3, pluck = kind == 4;
constexpr double pi = juce::MathConstants<double>::pi;
double polyBlep(double phase, double delta) {
  if (phase < delta) { const auto x = phase / delta; return x + x - x*x - 1; }
  if (phase > 1 - delta) { const auto x = (phase - 1) / delta; return x*x + x + x + 1; }
  return 0;
}
double oscillator(double phase, double delta, int shape) {
  if (shape == 0) return std::sin(2 * pi * phase);
  if (shape == 1) return 2 * phase - 1 - polyBlep(phase, delta);
  if (shape == 2) return (phase < .5 ? 1. : -1.) + polyBlep(phase, delta) - polyBlep(std::fmod(phase + .5, 1.), delta);
  return 1 - 4 * std::abs(phase - .5);
}
struct Voice {
  juce::ADSR envelope;
  bool held = false, sustained = false;
  int note = 60, channel = 1, write = 0;
  double hz = 440, age = 0, previous = 0, feedback = 0, filter1 = 0, filter2 = 0;
  float velocity = 0;
  std::array<double, 3> phase{};
};
class Synth final : public juce::AudioProcessor {
public:
  Synth() : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)),
            state(*this, nullptr, "StudioWavSynth", layout()) { bend.fill(1); }
  static juce::AudioProcessorValueTreeState::ParameterLayout layout() {
    juce::AudioProcessorValueTreeState::ParameterLayout p;
    auto add = [&](const char *id, const char *name, float low, float high, float initial, float skew = 1, float step = .001f) {
      p.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID(id, 1), name,
        juce::NormalisableRange<float>(low, high, step, skew), initial));
    };
    add("level", "Level", 0, 1, triple ? .75f : pluck ? .9f : .85f);
    add("attack", "Attack ms", 1, 3000, triple ? 10 : pluck ? 1 : 3, .35f);
    add("decay", "Decay ms", 20, 12000, triple ? 700 : pluck ? 2800 : 1800, .4f);
    add("sustain", "Sustain", 0, 1, triple ? .7f : .2f);
    add("release", "Release ms", 10, 5000, fm ? 550 : 350, .4f);
    add("cutoff", "Cutoff Hz", 80, 18000, triple ? 9500 : pluck ? 10000 : 14000, .4f);
    if (triple) {
      add("wave1", "Osc 1: sine/saw/pulse/triangle", 0, 3, 1, 1, 1);
      add("wave2", "Osc 2: sine/saw/pulse/triangle", 0, 3, 1, 1, 1);
      add("wave3", "Osc 3: sine/saw/pulse/triangle", 0, 3, 1, 1, 1);
      add("detune", "Detune cents", 0, 35, 9);
      add("mix", "Osc 2+3 mix", 0, 1, .65f);
      add("tune3", "Osc 3 semitones", -24, 24, 0, 1, 1);
    } else if (fm) {
      add("ratio1", "Modulator 1 ratio", .5f, 12, 2, 1, .5f);
      add("ratio2", "Modulator 2 ratio", .5f, 12, 3, 1, .5f);
      add("index1", "Modulator 1 index", 0, 12, 2.5f);
      add("index2", "Modulator 2 index", 0, 8, .8f);
      add("feedback", "Feedback", 0, .9f, .1f);
      add("modDecay", "Modulation decay ms", 20, 8000, 800, .4f);
    } else {
      add("brightness", "String brightness", .05f, .99f, .65f);
      add("damping", "String resonance", .1f, .999f, .9f);
      add("pick", "Pick position", 0, 1, .2f);
      add("body", "Body resonance", 0, 1, .25f);
    }
    return p;
  }
  float value(const char *id) const { return state.getRawParameterValue(id)->load(); }
  const juce::String getName() const override { return swbank::instrument()["name"].toString(); }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  bool isBusesLayoutSupported(const BusesLayout &layout) const override {
    return layout.getMainInputChannelSet().isDisabled() && layout.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
  }
  void prepareToPlay(double rate, int) override {
    sampleRate = rate;
    if (pluck) for (auto &buffer : strings) buffer.resize((size_t)std::ceil(rate / 6) + 8);
    for (auto &v : voices) v.envelope.setSampleRate(rate);
    reset();
  }
  void releaseResources() override {}
  void reset() override {
    for (auto &v : voices) { v.envelope.reset(); v.held = v.sustained = false; }
    pedal.fill(false); bend.fill(1);
  }
  void handle(const juce::MidiMessage &message) {
    const int channel = juce::jlimit(1, 16, message.getChannel());
    const size_t ch = (size_t)(channel - 1);
    if (message.isNoteOn()) {
      int index = -1;
      for (int i = 0; i < (int)voices.size(); ++i)
        if (voices[(size_t)i].held && voices[(size_t)i].note == message.getNoteNumber() && voices[(size_t)i].channel == channel) { index = i; break; }
      if (index < 0) for (int i = 0; i < (int)voices.size(); ++i)
        if (!voices[(size_t)i].envelope.isActive()) { index = i; break; }
      if (index < 0) {
        index = 0;
        for (int i = 1; i < (int)voices.size(); ++i) if (voices[(size_t)i].age > voices[(size_t)index].age) index = i;
      }
      auto &v = voices[(size_t)index];
      v.envelope.reset(); v.envelope.setParameters(envelopeParameters());
      v.held = true; v.sustained = false; v.note = message.getNoteNumber(); v.channel = channel;
      v.hz = juce::MidiMessage::getMidiNoteInHertz(v.note); v.velocity = message.getFloatVelocity();
      v.age = v.previous = v.feedback = v.filter1 = v.filter2 = 0; v.phase = {}; v.write = 0;
      if (pluck) {
        auto &buffer = strings[(size_t)index];
        uint32_t random = (uint32_t)(v.note * 1907 + channel * 673 + 1);
        double smooth = 0;
        const double brightness = value("brightness"), pick = value("pick");
        for (auto &x : buffer) {
          random = 1664525u * random + 1013904223u;
          const double noise = (double)random / 2147483648. - 1;
          smooth += brightness * (noise - smooth);
          x = (float)(smooth * (1 - pick * .6) + noise * pick * .25);
        }
      }
      v.envelope.noteOn();
    } else if (message.isNoteOff() || message.isAllNotesOff()) {
      for (auto &v : voices) if (v.channel == channel && (message.isAllNotesOff() || v.note == message.getNoteNumber())) {
        v.held = false; v.sustained = pedal[ch];
        if (!v.sustained) v.envelope.noteOff();
      }
    } else if (message.isAllSoundOff()) {
      for (auto &v : voices) if (v.channel == channel) { v.envelope.reset(); v.held = v.sustained = false; }
    } else if (message.isPitchWheel()) {
      bend[ch] = std::pow(2., (message.getPitchWheelValue() - 8192.) / 8192. * 2 / 12);
    } else if (message.isController() && (message.getControllerNumber() == 64 || message.getControllerNumber() == 121)) {
      pedal[ch] = message.getControllerNumber() == 64 && message.getControllerValue() >= 64;
      if (message.getControllerNumber() == 121) bend[ch] = 1;
      if (!pedal[ch]) for (auto &v : voices) if (v.channel == channel && v.sustained) {
        v.sustained = false; if (!v.held) v.envelope.noteOff();
      }
    }
  }
  juce::ADSR::Parameters envelopeParameters() const {
    return { value("attack") / 1000, value("decay") / 1000, value("sustain"), value("release") / 1000 };
  }
  void render(juce::AudioBuffer<float> &output, int from, int count) {
    if (count <= 0) return;
    const double level = value("level"), cutoff = juce::jmin((double)value("cutoff"), sampleRate * .4);
    const double alpha = 1 - std::exp(-2 * pi * cutoff / sampleRate);
    const double decaySeconds = value("decay") / 1000.;
    std::array<int, 3> shapes{}; std::array<double, 3> tuning{1, 1, 1};
    double mix = 0, r1 = 1, r2 = 1, index1 = 0, index2 = 0, feedback = 0, modDecay = 1;
    double brightness = .5, damping = .9, body = 0;
    if (triple) {
      shapes = {(int)value("wave1"), (int)value("wave2"), (int)value("wave3")};
      const double detune = value("detune"); mix = value("mix");
      tuning[1] = std::pow(2., detune / 1200); tuning[2] = std::pow(2., value("tune3") / 12. - detune / 1200);
    } else if (fm) {
      r1 = value("ratio1"); r2 = value("ratio2"); index1 = value("index1"); index2 = value("index2");
      feedback = value("feedback"); modDecay = value("modDecay") / 1000;
    } else { brightness = value("brightness"); damping = value("damping"); body = value("body"); }
    for (size_t index = 0; index < voices.size(); ++index) {
      auto &v = voices[index]; if (!v.envelope.isActive()) continue;
      v.envelope.setParameters(envelopeParameters());
      const double hz = juce::jlimit(6., sampleRate * .4, v.hz * bend[(size_t)(v.channel - 1)]);
      const double stringLoss = pluck ? std::pow(.001, 1 / (hz * decaySeconds)) * (.985 + damping * .01499) : 0;
      for (int i = from; i < from + count; ++i) {
        if (!v.envelope.isActive()) { v.held = false; break; }
        double x = 0;
        if (triple) {
          for (size_t o = 0; o < 3; ++o) {
            const double delta = juce::jmin(.4, hz * tuning[o] / sampleRate);
            x += oscillator(v.phase[o], delta, shapes[o]) * (o == 0 ? 1 : mix);
            v.phase[o] += delta; v.phase[o] -= std::floor(v.phase[o]);
          }
          x /= 1 + 2 * mix;
        } else if (fm) {
          const double modEnv = std::exp(-v.age / modDecay);
          // Twice-rate phase integration and averaging reduce high-frequency products.
          for (int sub = 0; sub < 2; ++sub) {
            const double m2 = std::sin(2 * pi * v.phase[2] + feedback * v.feedback);
            v.feedback = m2;
            const double m1 = std::sin(2 * pi * v.phase[1] + (hz*r2 < sampleRate*.4 ? index2 : 0) * modEnv * m2);
            x += .5 * std::sin(2 * pi * v.phase[0] + (hz*r1 < sampleRate*.4 ? index1 : 0) * modEnv * m1);
            for (size_t o = 0; o < 3; ++o) {
              v.phase[o] += hz * (o == 0 ? 1 : o == 1 ? r1 : r2) / (sampleRate * 2);
              v.phase[o] -= std::floor(v.phase[o]);
            }
          }
        } else {
          auto &buffer = strings[index]; const int size = (int)buffer.size();
          const double delay = juce::jlimit(2., (double)size - 2, sampleRate / hz - (1 - brightness));
          double read = v.write - delay; if (read < 0) read += size;
          const int a = (int)read; const double fraction = read - a;
          x = buffer[(size_t)a] * (1 - fraction) + buffer[(size_t)((a + 1) % size)] * fraction;
          const double filtered = brightness * x + (1 - brightness) * v.previous;
          v.previous = x;
          buffer[(size_t)v.write] = (float)(filtered * stringLoss);
          if (++v.write == size) v.write = 0;
          x = x * .8 + body * std::sin(2 * pi * v.phase[0]) * std::exp(-v.age * 3);
          v.phase[0] += hz / sampleRate; v.phase[0] -= std::floor(v.phase[0]);
        }
        v.filter1 += alpha * (x - v.filter1); v.filter2 += alpha * (v.filter1 - v.filter2);
        const double sound = v.filter2 * v.envelope.getNextSample() * v.velocity * level * (pluck ? .64 : .32);
        const double pan = juce::jlimit(-.3, .3, (v.note - 60) / 120.);
        output.addSample(0, i, (float)(sound * std::sqrt((1 - pan) * .5)));
        output.addSample(1, i, (float)(sound * std::sqrt((1 + pan) * .5)));
        v.age += 1 / sampleRate;
      }
    }
  }
  void processBlock(juce::AudioBuffer<float> &output, juce::MidiBuffer &messages) override {
    juce::ScopedNoDenormals noDenormals; output.clear(); int position = 0;
    for (const auto message : messages) {
      const int at = juce::jlimit(position, output.getNumSamples(), message.samplePosition);
      render(output, position, at - position); handle(message.getMessage()); position = at;
    }
    render(output, position, output.getNumSamples() - position); messages.clear();
    for (int c = 0; c < output.getNumChannels(); ++c) for (int i = 0; i < output.getNumSamples(); ++i)
      output.setSample(c, i, (float)(.95 * std::tanh(output.getSample(c, i) / .95)));
  }
  double getTailLengthSeconds() const override { return 5; }
  int getNumPrograms() override { return swbank::count(); }
  int getCurrentProgram() override { return program.load(); }
  const juce::String getProgramName(int index) override { return swbank::name(index); }
  void setCurrentProgram(int index) override { index = swbank::clamp(index); program.store(index); swbank::apply(state, index); }
  void changeProgramName(int, const juce::String &) override {}
  bool hasEditor() const override { return true; }
  class Editor final : public juce::AudioProcessorEditor, private juce::Timer {
  public:
    explicit Editor(Synth &p) : AudioProcessorEditor(p), owner(p) {
      addAndMakeVisible(title); title.setText(p.getName() + " | Original synthesis", juce::dontSendNotification);
      title.setColour(juce::Label::textColourId, juce::Colour(0xffb5dfc5));
      for (int i = 0; i < p.getNumPrograms(); ++i) presets.addItem(p.getProgramName(i), i+1);
      presets.setSelectedId(p.getCurrentProgram()+1, juce::dontSendNotification);
      presets.onChange = [&] { owner.setCurrentProgram(presets.getSelectedId()-1); };
      addAndMakeVisible(presets);
      for (auto *parameter : p.getParameters()) if (auto *ranged = dynamic_cast<juce::RangedAudioParameter *>(parameter)) {
        auto slider = std::make_unique<juce::Slider>();
        slider->setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag); slider->setTextBoxStyle(juce::Slider::TextBoxBelow, false, 100, 20);
        slider->setColour(juce::Slider::rotarySliderFillColourId, juce::Colour(0xff9dceb4));
        auto label = std::make_unique<juce::Label>(); label->setText(parameter->getName(64), juce::dontSendNotification);
        label->setJustificationType(juce::Justification::centred); label->setFont(juce::FontOptions(11));
        addAndMakeVisible(*slider); addAndMakeVisible(*label);
        attachments.push_back(std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(p.state, ranged->paramID, *slider));
        sliders.push_back(std::move(slider)); labels.push_back(std::move(label));
      }
      setSize(600, 90 + ((int)sliders.size()+2)/3*108); startTimerHz(5);
    }
    void resized() override {
      title.setBounds(16, 8, getWidth()-32, 25); presets.setBounds(18, 40, getWidth()-36, 28);
      for (size_t i = 0; i < sliders.size(); ++i) {
        const int x = 10+(int)(i%3)*196, y = 85+(int)(i/3)*108;
        labels[i]->setBounds(x, y, 190, 22); sliders[i]->setBounds(x+20, y+22, 150, 85);
      }
    }
    void paint(juce::Graphics &g) override { g.fillAll(juce::Colour(0xff202832)); }
  private:
    void timerCallback() override { presets.setSelectedId(owner.getCurrentProgram()+1, juce::dontSendNotification); }
    Synth &owner; juce::Label title; juce::ComboBox presets;
    std::vector<std::unique_ptr<juce::Slider>> sliders;
    std::vector<std::unique_ptr<juce::Label>> labels;
    std::vector<std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment>> attachments;
  };
  juce::AudioProcessorEditor *createEditor() override { return new Editor(*this); }
  void getStateInformation(juce::MemoryBlock &block) override {
    auto tree = state.copyState(); tree.setProperty("program", program.load(), nullptr); tree.setProperty("instrument", STUDIOWAV_INSTRUMENT_ID, nullptr);
    if (auto xml = tree.createXml()) copyXmlToBinary(*xml, block);
  }
  void setStateInformation(const void *data, int bytes) override {
    if (auto xml = getXmlFromBinary(data, bytes)) if (xml->hasTagName(state.state.getType()) && xml->getStringAttribute("instrument") == STUDIOWAV_INSTRUMENT_ID) {
      const auto tree = juce::ValueTree::fromXml(*xml); program.store(swbank::clamp((int)tree.getProperty("program", 0))); state.replaceState(tree);
    }
  }
private:
  juce::AudioProcessorValueTreeState state;
  std::array<Voice, 32> voices;
  std::array<std::vector<float>, 32> strings;
  std::array<double, 16> bend{};
  std::array<bool, 16> pedal{};
  std::atomic<int> program{0};
  double sampleRate = 48000;
};
}
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new Synth; }
