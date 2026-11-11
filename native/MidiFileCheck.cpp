#include <juce_audio_basics/juce_audio_basics.h>
#include <iostream>

// Independent codec verification using JUCE, never the TypeScript reader.
int main(int argc, char **argv) {
  if (argc != 2 && argc != 3) return 2;
  if (argc == 3 && juce::String(argv[1]) == "--fixture") {
    juce::MidiFile file; file.setTicksPerQuarterNote(480);
    juce::MidiMessageSequence sequence;
    auto add = [&](juce::MidiMessage message, double tick) {
      message.setTimeStamp(tick); sequence.addEvent(message);
    };
    add(juce::MidiMessage::textMetaEvent(3, "JUCE piano"), 0);
    add(juce::MidiMessage::tempoMetaEvent(500000), 0);
    add(juce::MidiMessage::controllerEvent(1, 64, 127), 0);
    add(juce::MidiMessage::noteOn(1, 67, .8f), 60);
    add(juce::MidiMessage::noteOff(1, 67), 180);
    add(juce::MidiMessage::controllerEvent(1, 64, 0), 480);
    add(juce::MidiMessage::endOfTrack(), 960);
    file.addTrack(sequence);
    auto output = juce::File(argv[2]).createOutputStream();
    if (!output || !file.writeTo(*output, 0)) return 3;
    std::cout << "{\"fixture\":true}\n"; return 0;
  }
  juce::FileInputStream input{juce::File(argv[1])};
  juce::MidiFile file; int format = -1;
  if (!input.openedOk() || !file.readFrom(input, false, &format)) return 4;
  int ons = 0, offs = 0; double first = -1;
  juce::Array<juce::var> pitches;
  for (int track = 0; track < file.getNumTracks(); ++track) {
    const auto *sequence = file.getTrack(track);
    for (int i = 0; i < sequence->getNumEvents(); ++i) {
      const auto &message = sequence->getEventPointer(i)->message;
      if (message.isNoteOn()) {
        ons++; pitches.add(message.getNoteNumber());
        if (first < 0 || message.getTimeStamp() < first) first = message.getTimeStamp();
      } else if (message.isNoteOff()) offs++;
    }
  }
  auto *object = new juce::DynamicObject;
  object->setProperty("format", format); object->setProperty("ppq", file.getTimeFormat());
  object->setProperty("tracks", file.getNumTracks()); object->setProperty("noteOns", ons);
  object->setProperty("noteOffs", offs); object->setProperty("firstTick", first);
  object->setProperty("endTick", file.getLastTimestamp()); object->setProperty("pitches", pitches);
  std::cout << juce::JSON::toString(juce::var(object), true).toStdString() << "\n";
}
