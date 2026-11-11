#include <juce_audio_utils/juce_audio_utils.h>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <set>
#include <cstdint>
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter();
static void require(bool condition, const char *message) {
  if (!condition) throw std::runtime_error(message);
}
int main() {
  juce::ScopedJuceInitialiser_GUI gui;
  try {
    std::unique_ptr<juce::AudioProcessor> p(createPluginFilter());
    p->prepareToPlay(48000, 4096);
    juce::AudioBuffer<float> block(2, 4096);
    auto run = [&](juce::MidiBuffer &midi) {
      p->processBlock(block, midi);
      for (int c = 0; c < 2; ++c)
        for (int i = 0; i < block.getNumSamples(); ++i)
          require(std::isfinite(block.getSample(c, i)), "Non-finite output");
      return block.getRMSLevel(0, 0, block.getNumSamples());
    };
    juce::MidiBuffer midi;
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 100);
    require(run(midi) > .001f, "Instrument did not play");
    require(block.getMagnitude(0, 0, 100) == 0, "MIDI sample offset lost");
    p->reset();
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, .25f), 0);
    auto soft = run(midi);
    p->reset();
    midi.addEvent(juce::MidiMessage::noteOn(1, 60, 1.f), 0);
    auto loud = run(midi);
    require(loud > soft * 2.5f, "Velocity has no effect");
    midi.addEvent(juce::MidiMessage::allSoundOff(1), 0);
    require(run(midi) == 0, "All sound off left stuck voices");
    require(p->getNumPrograms() == 8, "Missing presets");
    p->setCurrentProgram(1);
    juce::MemoryBlock saved;
    p->getStateInformation(saved);
    auto &params = p->getParameters();
    const float presetParameter = params[1]->getValue();
    p->setCurrentProgram(3);
    params[0]->setValueNotifyingHost(0);
    p->setStateInformation(saved.getData(), (int)saved.getSize());
    require(p->getCurrentProgram() == 1 && std::abs(params[1]->getValue() - presetParameter) < .0001,
            "Preset state was not restored");
    require(params[0]->getValue() > 0, "Parameter state was not restored");
    if (STUDIOWAV_KIND == 0) {
      // A short damper release must be held by CC64, then release on pedal-up.
      for (auto *parameter : params)
        if (parameter->getName(64) == "Release ms") parameter->setValueNotifyingHost(0);
      p->reset();
      midi.addEvent(juce::MidiMessage::controllerEvent(1, 64, 127), 0);
      midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 0);
      run(midi);
      midi.addEvent(juce::MidiMessage::noteOff(1, 60), 0);
      float held = 0;
      for (int i = 0; i < 8; ++i) held = run(midi);
      require(held > .001f, "Sustain pedal did not hold the string");
      midi.addEvent(juce::MidiMessage::controllerEvent(1, 64, 0), 0);
      float released = 1;
      for (int i = 0; i < 8; ++i) released = run(midi);
      require(released < .000001f, "Pedal-up left a stuck string");
      p->reset();
      for (int note : {48, 52, 55, 60, 64, 67})
        midi.addEvent(juce::MidiMessage::noteOn(1, note, .7f), 0);
      require(run(midi) > .01f, "Polyphonic chord was silent");
    }
    // Every factory program must produce a distinct, finite audio response.
    std::set<uint64_t> sounds;
    std::set<juce::String> names;
    for (int preset = 0; preset < p->getNumPrograms(); ++preset) {
      p->setCurrentProgram(preset); p->reset();
      names.insert(p->getProgramName(preset));
      midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 0);
      float peak = 0; uint64_t digest = 1469598103934665603ULL;
      for (int b = 0; b < 20; ++b) {
        run(midi); peak = juce::jmax(peak, block.getMagnitude(0, 0, block.getNumSamples()));
        for (int i = 0; i < block.getNumSamples(); i += 17) {
          digest ^= (uint64_t)(int64_t)std::llround(block.getSample(0, i) * 1000000);
          digest *= 1099511628211ULL;
        }
      }
      require(peak > .001f, "A factory preset is silent"); sounds.insert(digest);
    }
    require(sounds.size() == 8 && names.size() == 8, "Factory programs are duplicated");
    if (STUDIOWAV_KIND >= 2) {
      p->setCurrentProgram(0);
      for (auto *parameter : params)
        if (parameter->getName(64) == "Release ms") parameter->setValueNotifyingHost(0);
      p->reset();
      midi.addEvent(juce::MidiMessage::controllerEvent(1, 64, 127), 0);
      midi.addEvent(juce::MidiMessage::noteOn(1, 60, .8f), 0); run(midi);
      midi.addEvent(juce::MidiMessage::noteOff(1, 60), 0);
      for (int i = 0; i < 4; ++i) run(midi);
      require(block.getMagnitude(0, 0, block.getNumSamples()) > .0001f, "Sustain did not hold the voice");
      midi.addEvent(juce::MidiMessage::controllerEvent(1, 64, 0), 0);
      for (int i = 0; i < 8; ++i) run(midi);
      require(block.getMagnitude(0, 0, block.getNumSamples()) == 0, "Release left stuck voices");
      p->reset();
      for (int note = 0; note < 100; ++note) midi.addEvent(juce::MidiMessage::noteOn(1, note, 1.f), 0);
      run(midi);
      require(block.getMagnitude(0, 0, block.getNumSamples()) <= .951f, "Voice stealing produced unbounded output");
      midi.addEvent(juce::MidiMessage::allSoundOff(1), 0);
      require(run(midi) == 0, "Voice stealing left stuck voices");
    }
    std::cout << "{\"passed\":true,\"name\":\"" << p->getName()
              << "\",\"sampleOffset\":100,\"presets\":8,\"velocity\":true,\"state\":true,\"allSoundOff\":true,\"sustainTested\":"
              << (STUDIOWAV_KIND == 1 ? "false" : "true") << ",\"distinctPresetSounds\":" << sounds.size() << "}\n";
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << "\n";
    return 1;
  }
}
