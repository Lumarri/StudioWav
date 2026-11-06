#include <juce_audio_utils/juce_audio_utils.h>
class TestGain final : public juce::AudioProcessor {
public:
  TestGain()
      : AudioProcessor(
            BusesProperties()
                .withInput("Input", juce::AudioChannelSet::stereo(), true)
                .withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    addParameter(
        gain = new juce::AudioParameterFloat("gain", "Gain", 0.0f, 1.0f, 0.5f));
    setLatencySamples(64);
  }
  const juce::String getName() const override { return "StudioWav Test Gain"; }
  void prepareToPlay(double, int) override {
    delay.clear();
    pos = 0;
  }
  void releaseResources() override {}
  bool isBusesLayoutSupported(const BusesLayout &l) const override {
    return l.getMainInputChannelSet() == juce::AudioChannelSet::stereo() &&
           l.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
  }
  void processBlock(juce::AudioBuffer<float> &b, juce::MidiBuffer &) override {
    for (int i = 0; i < b.getNumSamples(); ++i) {
      for (int c = 0; c < 2; ++c) {
        float x = b.getSample(c, i);
        b.setSample(c, i, delay.getSample(c, pos) * gain->get());
        delay.setSample(c, pos, x);
      }
      pos = (pos + 1) % 64;
    }
  }
  juce::AudioProcessorEditor *createEditor() override {
    return new juce::GenericAudioProcessorEditor(*this);
  }
  bool hasEditor() const override { return true; }
  bool acceptsMidi() const override { return false; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  double getTailLengthSeconds() const override { return 0; }
  int getNumPrograms() override { return 1; }
  int getCurrentProgram() override { return 0; }
  void setCurrentProgram(int) override {}
  const juce::String getProgramName(int) override { return {}; }
  void changeProgramName(int, const juce::String &) override {}
  void getStateInformation(juce::MemoryBlock &b) override {
    float v = gain->get();
    b.replaceWith(&v, sizeof(v));
  }
  void setStateInformation(const void *p, int n) override {
    if (n == sizeof(float)) {
      float v;
      memcpy(&v, p, sizeof(v));
      *gain = juce::jlimit(0.0f, 1.0f, v);
    }
  }

private:
  juce::AudioParameterFloat *gain{};
  juce::AudioBuffer<float> delay{2, 64};
  int pos = 0;
};
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() {
  return new TestGain;
}
