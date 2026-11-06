#pragma once
#include <array>
#include <atomic>
#include <iostream>
#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_cryptography/juce_cryptography.h>
#include <map>
#include <memory>
#include <vector>

namespace sw {
using juce::String;
using juce::var;
var object(std::initializer_list<std::pair<juce::Identifier, var>> values);
struct Point {
  double step = 0;
  float value = 0;
};
struct Config {
  String id, instrument, sampleId;
  bool bus = false, muted = false, solo = false, monitor = false;
  float gain = 1, pan = 0, cutoff = 20000, send = 0;
  int manualDelay = 0;
  std::array<std::vector<Point>, 4> automation;
  explicit Config(const var &);
  float at(int lane, double step, float fallback) const;
};
struct Delay {
  juce::AudioBuffer<float> data;
  int position = 0, length = 0;
  void prepare(int samples);
  void clear();
  void add(const juce::AudioBuffer<float> &from, juce::AudioBuffer<float> &to,
           int n, float gain);
  void process(juce::AudioBuffer<float> &buffer, int n);
};
struct SampleData {
  juce::AudioBuffer<float> data;
  double rate = 44100;
  String digest;
};
struct Voice {
  bool active = false;
  int pitch = 60;
  double position = 0, duration = 0, phase = 0;
  float velocity = 0;
  uint32_t random = 12345;
};
struct Plugin {
  String id;
  bool bypassed = false, instrument = false;
  std::unique_ptr<juce::AudioPluginInstance> instance;
};
struct Track {
  Config config;
  std::shared_ptr<SampleData> sample;
  juce::AudioBuffer<float> buffer, source;
  juce::MidiBuffer midi, pendingMidi;
  std::array<int64_t, 128> previewRemaining{};
  std::array<Voice, 64> voices{};
  std::vector<Plugin> plugins;
  Delay ownDelay, localDelay, sendDelay;
  float filterL = 0, filterR = 0, filterL2 = 0, filterR2 = 0, currentGain = .8f,
        currentPan = 0;
  int latency = 0, arrival = 0;
  std::atomic<float> peak{0};
  bool audible = true;
  explicit Track(const var &v) : config(v) {}
};
struct Edge {
  int from = 0, to = -1;
  float gain = 1;
  Delay delay;
  bool send = false;
};
struct Event {
  int track = 0, pitch = 60;
  int64_t frame = 0, duration = 0;
  float velocity = 1;
  bool off = false;
};
class PlayHead final : public juce::AudioPlayHead {
public:
  double rate = 48000, bpm = 120;
  int64_t frame = 0;
  bool playing = false;
  juce::Optional<PositionInfo> getPosition() const override;
};
class EditorWindow final : public juce::DocumentWindow {
public:
  EditorWindow(juce::AudioPluginInstance &p)
      : DocumentWindow(p.getName(), juce::Colour(0xff181b22),
                       DocumentWindow::closeButton) {
    setUsingNativeTitleBar(true);
    auto *editor = p.createEditorIfNeeded();
    if (editor == nullptr)
      editor = new juce::GenericAudioProcessorEditor(p);
    setContentOwned(editor, true);
    setResizable(true, false);
    centreWithSize(juce::jmax(400, editor->getWidth()),
                   juce::jmax(180, editor->getHeight()));
    setVisible(true);
  }
  void closeButtonPressed() override { setVisible(false); }
};
class Engine final : private juce::AudioIODeviceCallback,
                     private juce::MidiInputCallback {
public:
  Engine();
  ~Engine() override;
  var command(const var &);
  var status();
  void load(const var &);
  void process(float *const *, int, int, const float *const *, int);
  void reset();
  int selfTest(const juce::File &directory);

private:
  static constexpr int maxBlock = 16384;
  juce::AudioDeviceManager devices;
  juce::AudioFormatManager formats;
  juce::AudioPluginFormatManager plugins;
  juce::SpinLock lock;
  std::vector<std::unique_ptr<Track>> tracks;
  std::vector<Edge> edges;
  std::vector<int> order;
  std::vector<Event> events;
  std::map<String, std::shared_ptr<SampleData>> samples;
  juce::AudioBuffer<float> master{2, maxBlock}, delayBus{2, maxBlock},
      inputCopy{2, maxBlock};
  juce::AudioBuffer<float> musicalDelay;
  int musicalPosition = 0;
  double sampleRate = 48000, bpm = 120, duration = 4;
  float masterGain = .8f;
  int64_t frame = 0, loopFrames = 192000;
  bool playing = false;
  String focus, signature;
  var project;
  std::vector<std::unique_ptr<EditorWindow>> editors;
  PlayHead playHead;
  juce::MidiMessageCollector midi;
  juce::MidiBuffer liveMidi;
  struct MidiObservation {
    int note = 0;
    float velocity = 0;
    bool on = false;
    double step = 0;
  };
  juce::AbstractFifo midiFifo{1024};
  std::array<MidiObservation, 1024> midiEvents;
  std::atomic<int64_t> observedFrame{0};
  std::atomic<int> overruns{0}, recordDrops{0};
  std::atomic<double> observedStep{0};
  std::atomic<float> masterPeak{0}, inputPeak{0};
  std::atomic<double> cpu{0};
  juce::TimeSliceThread recordingThread{"StudioWav recording"};
  std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> recorder;
  String recordingPath, recordingSource, midiDevice;
  double recordingRate = 0;
  int64_t recordedFrames = 0;
  bool deviceOpened = false;
  int pdcSamples = 0;
  void openDevice();
  var deviceList();
  var configure(const var &);
  void trigger(int, int, float, int64_t, int = 0);
  void renderVoice(Track &, int);
  void buildRouting(const var &);
  void updateConfig(const var &);
  void schedule(int);
  var pluginStates();
  var scan(const var &);
  var render(const var &);
  var startRecording(const var &);
  var stopRecording();
  int indexOf(const String &) const;
  void audioDeviceIOCallbackWithContext(
      const float *const *, int, float *const *, int, int,
      const juce::AudioIODeviceCallbackContext &) override;
  void audioDeviceAboutToStart(juce::AudioIODevice *) override;
  void audioDeviceStopped() override {}
  void handleIncomingMidiMessage(juce::MidiInput *,
                                 const juce::MidiMessage &) override;
};
} // namespace sw
