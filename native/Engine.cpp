#include "Engine.h"
#include <algorithm>
#include <cmath>
#include <functional>
#include <set>
#include <stdexcept>

namespace sw {
namespace {
constexpr double pi = 3.14159265358979323846;
float number(const var &v, const char *key, float fallback = 0) {
  return (float)v.getProperty(key, fallback);
}
bool boolean(const var &v, const char *key, bool fallback = false) {
  return (bool)v.getProperty(key, fallback);
}
String text(const var &v, const char *key) { return v[key].toString(); }
void require(bool condition, const char *message) {
  if (!condition)
    throw std::runtime_error(message);
}
var array() { return var(juce::Array<var>{}); }
String graphSignature(const var &v) {
  var shape = array();
  if (auto *list = v["tracks"].getArray())
    for (const auto &item : *list) {
      var sends = array();
      if (auto *entries = item["sends"].getArray())
        for (auto &entry : *entries)
          sends.append(entry["trackId"]);
      shape.append(object({{"id", item["id"]},
                           {"sampleId", item["sampleId"]},
                           {"plugins", item["plugins"]},
                           {"outputId", item["outputId"]},
                           {"sends", sends},
                           {"delaySamples", item["delaySamples"]}}));
    }
  return juce::JSON::toString(shape, true);
}
} // namespace
var object(std::initializer_list<std::pair<juce::Identifier, var>> values) {
  auto *o = new juce::DynamicObject;
  for (auto &v : values)
    o->setProperty(v.first, v.second);
  return var(o);
}
Config::Config(const var &v) {
  effects = ChannelEffectSettings::read(v["effects"]);
  id = text(v, "id");
  instrument = text(v, "instrument");
  sampleId = text(v, "sampleId");
  bus = text(v, "kind") == "bus";
  muted = boolean(v, "muted");
  solo = boolean(v, "solo");
  monitor = boolean(v, "monitorInput");
  gain = juce::jlimit(0.f, 1.f, number(v, "gain", .8f));
  pan = juce::jlimit(-1.f, 1.f, number(v, "pan"));
  cutoff = juce::jlimit(80.f, 20000.f, number(v, "cutoff", 20000));
  send = juce::jlimit(0.f, .6f, number(v, "send"));
  manualDelay = juce::jlimit(0, 96000, (int)v.getProperty("delaySamples", 0));
  const char *names[] = {"gain", "pan", "cutoff", "send"};
  for (int lane = 0; lane < 4; ++lane)
    if (auto *points = v["automation"][names[lane]].getArray()) {
      require(points->size() <= 4096, "Demasiados puntos de automatización.");
      for (const auto &point : *points)
        automation[lane].push_back(
            {(double)point["step"], number(point, "value")});
      std::sort(automation[lane].begin(), automation[lane].end(),
                [](auto a, auto b) { return a.step < b.step; });
    }
}
float Config::at(int lane, double step, float fallback) const {
  const auto &points = automation[(size_t)lane];
  if (points.empty())
    return fallback;
  if (step <= points.front().step)
    return points.front().value;
  auto upper =
      std::upper_bound(points.begin(), points.end(), step,
                       [](double x, const Point &p) { return x < p.step; });
  if (upper == points.end())
    return points.back().value;
  const auto &a = *(upper - 1);
  return a.value + (upper->value - a.value) *
                       (float)((step - a.step) /
                               juce::jmax(.000001, upper->step - a.step));
}
void Delay::prepare(int samples) {
  length = juce::jmax(0, samples);
  data.setSize(2, juce::jmax(1, length));
  clear();
}
void Delay::clear() {
  data.clear();
  position = 0;
}
void Delay::add(const juce::AudioBuffer<float> &from,
                juce::AudioBuffer<float> &to, int n, float gain) {
  if (length == 0) {
    for (int c = 0; c < 2; ++c)
      to.addFrom(c, 0, from, c, 0, n, gain);
    return;
  }
  for (int i = 0; i < n; ++i) {
    for (int c = 0; c < 2; ++c) {
      float old = data.getSample(c, position);
      data.setSample(c, position, from.getSample(c, i));
      to.addSample(c, i, old * gain);
    }
    if (++position == length)
      position = 0;
  }
}
void Delay::process(juce::AudioBuffer<float> &buffer, int n) {
  if (length == 0)
    return;
  for (int i = 0; i < n; ++i) {
    for (int c = 0; c < 2; ++c) {
      float old = data.getSample(c, position);
      data.setSample(c, position, buffer.getSample(c, i));
      buffer.setSample(c, i, old);
    }
    if (++position == length)
      position = 0;
  }
}
juce::Optional<juce::AudioPlayHead::PositionInfo>
PlayHead::getPosition() const {
  PositionInfo info;
  info.setBpm(bpm);
  info.setTimeInSamples(frame);
  info.setTimeInSeconds((double)frame / rate);
  info.setPpqPosition((double)frame / rate * bpm / 60);
  info.setIsPlaying(playing);
  info.setTimeSignature(TimeSignature{4, 4});
  return info;
}
Engine::Engine() {
  formats.registerBasicFormats();
  juce::addDefaultFormatsToManager(plugins);
  midi.reset(sampleRate);
  musicalDelay.setSize(2, 192001);
  musicalDelay.clear();
  recordingThread.startThread();
}
Engine::~Engine() {
  devices.removeAudioCallback(this);
  if (midiDevice.isNotEmpty()) {
    devices.removeMidiInputDeviceCallback(midiDevice, this);
    devices.setMidiInputDeviceEnabled(midiDevice, false);
  }
  recorder.reset();
  editors.clear();
  tracks.clear();
  recordingThread.stopThread(3000);
  devices.closeAudioDevice();
}
int Engine::indexOf(const String &id) const {
  for (size_t i = 0; i < tracks.size(); ++i)
    if (tracks[i]->config.id == id)
      return (int)i;
  return -1;
}
void Engine::openDevice() {
  if (deviceOpened)
    return;
  auto error = devices.initialise(0, 2, nullptr, true);
  require(error.isEmpty(), error.toRawUTF8());
  if (auto *device = devices.getCurrentAudioDevice())
    audioDeviceAboutToStart(device);
  if (project.isObject()) {
    signature.clear();
    load(project);
  }
  devices.addAudioCallback(this);
  deviceOpened = true;
}
void Engine::audioDeviceAboutToStart(juce::AudioIODevice *device) {
  sampleRate = device->getCurrentSampleRate();
  midi.reset(sampleRate);
  playHead.rate = sampleRate;
  musicalDelay.setSize(2, (int)(sampleRate * 2) + 1);
  musicalDelay.clear();
  musicalPosition = 0;
}
void Engine::audioDeviceIOCallbackWithContext(
    const float *const *input, int inputs, float *const *output, int outputs,
    int n, const juce::AudioIODeviceCallbackContext &) {
  const auto start = juce::Time::getHighResolutionTicks();
  juce::SpinLock::ScopedTryLockType guard(lock);
  if (!guard.isLocked() || n > maxBlock) {
    for (int c = 0; c < outputs; ++c)
      if (output[c])
        juce::FloatVectorOperations::clear(output[c], n);
    overruns.fetch_add(1);
    return;
  }
  process(output, outputs, n, input, inputs);
  const auto elapsed = juce::Time::highResolutionTicksToSeconds(
      juce::Time::getHighResolutionTicks() - start);
  cpu.store(cpu.load() * .9 + elapsed * sampleRate / n * .1);
  if (elapsed > (double)n / sampleRate)
    overruns.fetch_add(1);
}
var Engine::deviceList() {
  var types = array();
  for (auto *type : devices.getAvailableDeviceTypes()) {
    type->scanForDevices();
    var outputs = array(), inputs = array();
    for (const auto &name : type->getDeviceNames(false))
      outputs.append(name);
    for (const auto &name : type->getDeviceNames(true))
      inputs.append(name);
    types.append(object({{"name", type->getTypeName()},
                         {"outputs", outputs},
                         {"inputs", inputs}}));
  }
  var midiInputs = array();
  for (auto &item : juce::MidiInput::getAvailableDevices())
    midiInputs.append(object({{"id", item.identifier}, {"name", item.name}}));
  var rates = array(), sizes = array();
  if (auto *d = devices.getCurrentAudioDevice()) {
    for (auto rate : d->getAvailableSampleRates())
      rates.append(rate);
    for (auto size : d->getAvailableBufferSizes())
      sizes.append(size);
  }
  auto setup = devices.getAudioDeviceSetup();
  return object({{"types", types},
                 {"midiInputs", midiInputs},
                 {"sampleRates", rates},
                 {"bufferSizes", sizes},
                 {"type", devices.getCurrentAudioDeviceType()},
                 {"output", setup.outputDeviceName},
                 {"input", setup.inputDeviceName},
                 {"sampleRate", setup.sampleRate},
                 {"bufferSize", setup.bufferSize},
                 {"midiDevice", midiDevice}});
}
var Engine::configure(const var &v) {
  require(!recorder, "Detén la grabación antes de cambiar de dispositivo.");
  playing = false;
  devices.removeAudioCallback(this);
  const auto old = devices.getAudioDeviceSetup();
  auto previous = devices.createStateXml();
  try {
    juce::XmlElement xml("DEVICESETUP");
    xml.setAttribute("deviceType", text(v, "type"));
    xml.setAttribute("audioOutputDeviceName", text(v, "output"));
    xml.setAttribute("audioInputDeviceName", text(v, "input"));
    xml.setAttribute("audioDeviceRate",
                     juce::jlimit(8000., 192000.,
                                  (double)v.getProperty("sampleRate", 48000)));
    xml.setAttribute(
        "audioDeviceBufferSize",
        juce::jlimit(32, 8192, (int)v.getProperty("bufferSize", 256)));
    const bool input = text(v, "input").isNotEmpty();
    xml.setAttribute("audioDeviceInChans", input ? "11" : "0");
    xml.setAttribute("audioDeviceOutChans", "11");
    auto error = devices.initialise(input ? 2 : 0, 2, &xml, false);
    require(error.isEmpty(), error.toRawUTF8());
    if (midiDevice.isNotEmpty())
      devices.setMidiInputDeviceEnabled(midiDevice, true);
    if (auto *device = devices.getCurrentAudioDevice())
      audioDeviceAboutToStart(device);
    auto next = project;
    signature.clear();
    if (next.isObject())
      load(next);
    devices.addAudioCallback(this);
    deviceOpened = true;
    return deviceList();
  } catch (...) {
    if (previous)
      devices.initialise(old.inputChannels.isZero() ? 0 : 2, 2, previous.get(),
                         false);
    if (auto *d = devices.getCurrentAudioDevice())
      audioDeviceAboutToStart(d);
    devices.addAudioCallback(this);
    throw;
  }
}
void Engine::buildRouting(const var &v) {
  edges.clear();
  order.clear();
  pdcSamples = 0;
  const auto *list = v["tracks"].getArray();
  const int count = (int)tracks.size();
  std::vector<int> degree((size_t)count, 0);
  for (int from = 0; from < count; ++from) {
    const auto &item = (*list)[from];
    String dest = text(item, "outputId");
    int to = dest.isEmpty() || dest == "master" ? -1 : indexOf(dest);
    require(to >= 0 || dest.isEmpty() || dest == "master",
            "El destino de salida no existe.");
    edges.push_back({from, to, 1, {}, false});
    if (to >= 0)
      degree[(size_t)to]++;
    if (auto *sends = item["sends"].getArray()) {
      require(sends->size() <= 32, "Demasiados envíos.");
      for (auto &send : *sends) {
        int target = indexOf(text(send, "trackId"));
        require(target >= 0, "El destino del envío no existe.");
        edges.push_back({from,
                         target,
                         juce::jlimit(0.f, 1.f, number(send, "gain")),
                         {},
                         true});
        degree[(size_t)target]++;
      }
    }
  }
  for (int i = 0; i < count; ++i)
    if (degree[(size_t)i] == 0)
      order.push_back(i);
  for (size_t i = 0; i < order.size(); ++i)
    for (auto &edge : edges)
      if (edge.from == order[i] && edge.to >= 0 &&
          --degree[(size_t)edge.to] == 0)
        order.push_back(edge.to);
  require((int)order.size() == count,
          "El ruteo contiene un ciclo de realimentación.");
  int64_t memoryFrames = 0;
  for (int index : order) {
    auto &t = *tracks[(size_t)index];
    t.arrival = 0;
    for (auto &e : edges)
      if (e.to == index)
        t.arrival = juce::jmax(t.arrival, tracks[(size_t)e.from]->arrival +
                                              tracks[(size_t)e.from]->latency);
    require(t.arrival + t.latency <= sampleRate * 8,
            "La latencia acumulada supera ocho segundos.");
    t.localDelay.prepare(t.arrival);
    memoryFrames += t.arrival;
  }
  for (auto &e : edges)
    if (e.to < 0)
      pdcSamples = juce::jmax(pdcSamples, tracks[(size_t)e.from]->arrival +
                                              tracks[(size_t)e.from]->latency);
  for (auto &t : tracks)
    t->sendDelay.prepare(juce::jmax(0, pdcSamples - t->arrival - t->latency));
  for (auto &e : edges) {
    int to = e.to < 0 ? pdcSamples : tracks[(size_t)e.to]->arrival;
    int from =
        tracks[(size_t)e.from]->arrival + tracks[(size_t)e.from]->latency;
    const int delay = juce::jmax(0, to - from);
    memoryFrames += delay;
    require(memoryFrames <= 16000000,
            "El grafo requiere demasiada memoria de compensación.");
    e.delay.prepare(delay);
  }
}
void Engine::updateConfig(const var &v) {
  const auto *list = v["tracks"].getArray();
  std::vector<Config> configs;
  for (const auto &item : *list)
    configs.emplace_back(item);
  std::vector<Event> next;
  if (auto *entries = v["events"].getArray()) {
    require(entries->size() <= 1000000,
            "El proyecto contiene demasiados eventos.");
    for (auto &event : *entries) {
      int track = indexOf(text(event, "trackId"));
      if (track < 0)
        continue;
      const double seconds = (double)event["time"],
                   length = (double)event["duration"];
      require(std::isfinite(seconds) && std::isfinite(length) && seconds >= 0 &&
                  seconds <= 600 && length > 0 && length <= 600,
              "Tiempo de nota inválido.");
      const int pitch = juce::jlimit(0, 127, (int)event["pitch"]);
      auto at = (int64_t)std::llround(seconds * sampleRate);
      auto durationSamples = (int64_t)std::llround(length * sampleRate);
      next.push_back({track, pitch, at, durationSamples,
                      juce::jlimit(0.f, 1.f, number(event, "velocity", 1)),
                      false});
      next.push_back(
          {track, pitch, at + durationSamples, durationSamples, 0, true});
    }
  }
  std::stable_sort(next.begin(), next.end(), [](auto a, auto b) {
    if (a.frame == b.frame)
      return a.off && !b.off;
    return a.frame < b.frame;
  });
  juce::SpinLock::ScopedLockType guard(lock);
  for (size_t i = 0; i < tracks.size(); ++i) {
    tracks[i]->config = std::move(configs[i]);
    tracks[i]->effects.configure(tracks[i]->config.effects, sampleRate);
    if (samples.count(tracks[i]->config.sampleId))
      tracks[i]->sample = samples[tracks[i]->config.sampleId];
  }
  for (auto &edge : edges)
    if (edge.send) {
      const auto &item = (*list)[edge.from];
      if (auto *sends = item["sends"].getArray())
        for (auto &send : *sends)
          if (text(send, "trackId") == tracks[(size_t)edge.to]->config.id)
            edge.gain = juce::jlimit(0.f, 1.f, number(send, "gain"));
    }
  events.swap(next);
  bpm = juce::jlimit(40., 240., (double)v.getProperty("bpm", 120));
  duration = juce::jlimit(.1, 600., (double)v.getProperty("duration", 4));
  loopFrames =
      juce::jmax((int64_t)1, (int64_t)std::llround(duration * sampleRate));
  frame %= loopFrames;
  masterGain = juce::jlimit(0.f, 1.f, number(v, "master", .8f));
  project = v.clone();
  project.getDynamicObject()->removeProperty("restoreStates");
  bool solo = false;
  for (auto &t : tracks)
    solo |= t->config.solo;
  std::vector<bool> active(tracks.size(), !solo);
  for (size_t i = 0; i < tracks.size(); ++i)
    if (tracks[i]->config.solo)
      active[i] = true;
  // A soloed bus includes its ancestors, and a soloed source keeps its output
  // path.
  if (solo) {
    std::vector<bool> ancestors(tracks.size(), false);
    for (size_t i = 0; i < tracks.size(); ++i)
      ancestors[i] = tracks[i]->config.solo && tracks[i]->config.bus;
    bool changed = true;
    while (changed) {
      changed = false;
      for (auto &e : edges)
        if (e.to >= 0 && ancestors[(size_t)e.to] &&
            !ancestors[(size_t)e.from]) {
          ancestors[(size_t)e.from] = true;
          changed = true;
        }
    }
    for (size_t i = 0; i < tracks.size(); ++i)
      active[i] = active[i] || ancestors[i];
    changed = true;
    while (changed) {
      changed = false;
      for (auto &e : edges)
        if (e.to >= 0 && active[(size_t)e.from] && !active[(size_t)e.to]) {
          active[(size_t)e.to] = true;
          changed = true;
        }
    }
  }
  for (size_t i = 0; i < tracks.size(); ++i)
    tracks[i]->audible = active[i] && !tracks[i]->config.muted;
}
void Engine::load(const var &v) {
  auto *list = v["tracks"].getArray();
  require(list && list->size() > 0 && list->size() <= 32,
          "El proyecto requiere entre 1 y 32 pistas.");
  struct SampleTransaction {
    std::map<String, std::shared_ptr<SampleData>> &cache;
    std::map<String, std::shared_ptr<SampleData>> previous;
    bool committed = false;
    ~SampleTransaction() {
      if (!committed)
        cache.swap(previous);
    }
  } transaction{samples, samples};
  std::set<String> usedSamples;
  if (auto *identifiers = v["sampleIds"].getArray())
    for (auto &id : *identifiers)
      usedSamples.insert(id.toString());
  for (const auto &item : *list)
    usedSamples.insert(text(item, "sampleId"));
  if (auto *sampleList = v["samples"].getArray())
    for (const auto &s : *sampleList) {
      String id = text(s, "id"), encoded = text(s, "data");
      if (samples.count(id) && encoded.isEmpty())
        continue;
      juce::MemoryBlock bytes;
      juce::MemoryOutputStream decoded(bytes, false);
      require(juce::Base64::convertFromBase64(
                  decoded, encoded.fromFirstOccurrenceOf(",", false, false)),
              "Muestra base64 inválida.");
      require(bytes.getSize() <= 100000000, "Muestra demasiado grande.");
      auto digest = juce::SHA256(bytes).toHexString();
      if (samples.count(id) && samples[id]->digest == digest)
        continue;
      auto stream = std::make_unique<juce::MemoryInputStream>(bytes, true);
      auto reader = std::unique_ptr<juce::AudioFormatReader>(
          formats.createReaderFor(std::move(stream)));
      require(reader != nullptr,
              "No se pudo decodificar una muestra de audio.");
      require(reader->sampleRate > 0 && reader->sampleRate <= 384000 &&
                  reader->lengthInSamples > 0,
              "Formato de muestra fuera de rango.");
      require(reader->lengthInSamples <= reader->sampleRate * 600,
              "Muestra demasiado larga.");
      int64_t decodedBytes = reader->lengthInSamples * 2 * 4;
      for (auto &[key, cached] : samples)
        if (key != id && usedSamples.count(key))
          decodedBytes += (int64_t)cached->data.getNumSamples() * 2 * 4;
      require(decodedBytes <= 512ll * 1024 * 1024,
              "Las muestras decodificadas del proyecto superan 512 MB.");
      auto data = std::make_shared<SampleData>();
      data->digest = digest;
      data->rate = reader->sampleRate;
      data->data.setSize(2, (int)reader->lengthInSamples);
      reader->read(&data->data, 0, data->data.getNumSamples(), 0, true, true);
      if (reader->numChannels == 1)
        data->data.copyFrom(1, 0, data->data, 0, 0, data->data.getNumSamples());
      samples[id] = data;
    }
  String nextSignature = graphSignature(v);
  if (nextSignature != signature || boolean(v, "restoreStates")) {
    var currentStates = pluginStates();
    std::map<String, String> previousStates;
    if (auto *previous = project["tracks"].getArray())
      for (auto &track : *previous)
        if (auto *slots = track["plugins"].getArray())
          for (auto &slot : *slots)
            previousStates[text(slot, "id")] = text(slot, "state");
    std::vector<std::unique_ptr<Track>> next;
    for (const auto &item : *list) {
      auto t = std::make_unique<Track>(item);
      t->buffer.setSize(2, maxBlock);
      t->source.setSize(2, maxBlock);
      t->midi.ensureSize(262144);
      t->pendingMidi.ensureSize(32768);
      t->currentGain = t->config.gain;
      t->currentPan = t->config.pan;
      if (samples.count(t->config.sampleId))
        t->sample = samples[t->config.sampleId];
      if (auto *slots = item["plugins"].getArray()) {
        require(slots->size() <= 8, "Se admiten hasta ocho plugins por canal.");
        for (auto &slot : *slots) {
          juce::PluginDescription desc;
          auto xml = juce::parseXML(text(slot, "description"));
          require(xml && desc.loadFromXml(*xml),
                  "Descripción de plugin inválida.");
          String error;
          auto instance =
              plugins.createPluginInstance(desc, sampleRate, maxBlock, error);
          require(instance != nullptr, error.toRawUTF8());
          auto layout = instance->getBusesLayout();
          for (auto &bus : layout.inputBuses)
            bus = juce::AudioChannelSet::disabled();
          for (auto &bus : layout.outputBuses)
            bus = juce::AudioChannelSet::disabled();
          if (!layout.inputBuses.isEmpty())
            layout.inputBuses.getReference(0) = juce::AudioChannelSet::stereo();
          if (!layout.outputBuses.isEmpty())
            layout.outputBuses.getReference(0) =
                juce::AudioChannelSet::stereo();
          require(instance->setBusesLayout(layout),
                  "El plugin no admite la configuración estéreo del host.");
          require(instance->getTotalNumOutputChannels() <= 2 &&
                      instance->getTotalNumInputChannels() <= 2,
                  "El plugin necesita más de dos canales principales.");
          instance->setPlayHead(&playHead);
          instance->setRateAndBufferSizeDetails(sampleRate, maxBlock);
          instance->prepareToPlay(sampleRate, maxBlock);
          String stateText = text(slot, "state"), slotId = text(slot, "id");
          if (!boolean(v, "restoreStates") && previousStates.count(slotId) &&
              previousStates[slotId] == stateText) {
            String captured =
                currentStates.getProperty(juce::Identifier(slotId), var())
                    .toString();
            if (captured.isNotEmpty())
              stateText = captured;
          }
          if (stateText.isNotEmpty()) {
            juce::MemoryBlock state;
            require(state.fromBase64Encoding(stateText),
                    "Estado de plugin inválido.");
            instance->setStateInformation(state.getData(),
                                          (int)state.getSize());
          }
          bool bypassed = boolean(slot, "bypassed");
          if (!bypassed)
            t->latency += instance->getLatencySamples();
          t->plugins.push_back({text(slot, "id"), bypassed, desc.isInstrument,
                                std::move(instance)});
        }
      }
      t->ownDelay.prepare(t->config.manualDelay);
      t->latency += t->config.manualDelay;
      next.push_back(std::move(t));
    }
    juce::SpinLock::ScopedLockType guard(lock);
    editors.clear();
    auto previous = std::move(tracks);
    auto oldEdges = std::move(edges);
    auto oldOrder = std::move(order);
    int oldPdc = pdcSamples;
    tracks = std::move(next);
    try {
      buildRouting(v);
    } catch (...) {
      tracks = std::move(previous);
      edges = std::move(oldEdges);
      order = std::move(oldOrder);
      pdcSamples = oldPdc;
      throw;
    }
    signature = nextSignature;
  }
  updateConfig(v);
  for (auto it = samples.begin(); it != samples.end();)
    if (!usedSamples.count(it->first))
      it = samples.erase(it);
    else
      ++it;
  transaction.committed = true;
}

void Engine::trigger(int track, int pitch, float velocity, int64_t length,
                     int offset) {
  if (track < 0 || track >= (int)tracks.size())
    return;
  auto &t = *tracks[(size_t)track];
  if (t.config.bus)
    return;
  auto voice = std::find_if(t.voices.begin(), t.voices.end(),
                            [](auto &v) { return !v.active; });
  if (voice == t.voices.end())
    voice = std::max_element(
        t.voices.begin(), t.voices.end(),
        [](auto &a, auto &b) { return a.position < b.position; });
  *voice = {true,
            pitch,
            -(double)offset,
            (double)length,
            0,
            velocity,
            12345u + (uint32_t)pitch * 1023u};
}
void Engine::renderVoice(Track &t, int n) {
  bool pluginInstrument = false;
  for (auto &p : t.plugins)
    if (p.instrument)
      pluginInstrument = true;
  if (pluginInstrument || t.config.bus)
    return;
  const auto &kind = t.config.instrument;
  const bool sample = kind == "sample", kick = kind == "kick",
             hat = kind == "hat" || kind == "openhat", snare = kind == "snare",
             clap = kind == "clap", bass = kind == "bass", pad = kind == "pad";
  for (auto &v : t.voices) {
    if (!v.active)
      continue;
    const double frequency = 440 * std::pow(2., (v.pitch - 69) / 12.);
    const double seconds = v.duration / sampleRate;
    const double end = sample            ? seconds
                       : kick            ? .4
                       : hat             ? (kind == "hat" ? .08 : .32)
                       : (snare || clap) ? .23
                                         : seconds + (pad ? .4 : .12);
    for (int i = 0; i < n; ++i, ++v.position) {
      if (v.position < 0)
        continue;
      const double age = v.position / sampleRate;
      if (age >= end) {
        v.active = false;
        break;
      }
      float left = 0, right = 0;
      v.random = 1664525u * v.random + 1013904223u;
      float noise = (float)((double)v.random / 2147483648. - 1.);
      if (sample) {
        if (!t.sample) {
          v.active = false;
          break;
        }
        double at = v.position * t.sample->rate / sampleRate *
                    std::pow(2., (v.pitch - 60) / 12.);
        int index = (int)at;
        if (index + 1 >= t.sample->data.getNumSamples()) {
          v.active = false;
          break;
        }
        float f = (float)(at - index),
              fade = (float)juce::jlimit(0., 1., (seconds - age) / .015);
        left = (t.sample->data.getSample(0, index) * (1 - f) +
                t.sample->data.getSample(0, index + 1) * f) *
               .8f * fade;
        right = (t.sample->data.getSample(1, index) * (1 - f) +
                 t.sample->data.getSample(1, index + 1) * f) *
                .8f * fade;
      } else if (kick) {
        double hz = 45 + 110 * std::exp(-age * 27);
        v.phase += 2 * pi * hz / sampleRate;
        left = right = (float)(std::sin(v.phase) * std::exp(-age * 18) * 1.1);
      } else if (hat || snare || clap) {
        double decay = hat ? (kind == "hat" ? 85 : 22) : 25;
        float a = (float)std::exp(-age * decay);
        left = right = noise * a * (hat ? .23f : .5f);
        if (snare)
          left = right = left + (float)(std::sin(2 * pi * 175 * age) *
                                        std::exp(-age * 35) * .3);
        if (clap)
          left = right =
              left * (float)(.35 + .65 * std::pow(std::sin(age * 260), 2));
      } else {
        v.phase += frequency / sampleRate;
        double phase = v.phase - std::floor(v.phase);
        double wave =
            bass  ? (phase * 2 - 1) * .7 + std::sin(pi * v.phase) * .3
            : pad ? ((phase * 2 - 1) + std::sin(2 * pi * v.phase * 1.004)) * .5
                  : std::sin(2 * pi * v.phase) * .8 +
                        std::sin(4 * pi * v.phase) * .2;
        double attack = pad ? .08 : .007, release = pad ? .4 : .12;
        double env = juce::jlimit(0., 1., age / attack) *
                     (age > seconds ? std::exp(-(age - seconds) * 7 / release)
                                    : (.65 + .35 * std::exp(-age * 5)));
        left = right = (float)(wave * env * (bass ? .25 : pad ? .13 : .24));
      }
      t.source.addSample(0, i, left * v.velocity);
      t.source.addSample(1, i, right * v.velocity);
    }
  }
}
void Engine::schedule(int n) {
  if (!playing)
    return;
  int offset = 0;
  int64_t current = frame;
  if (current == 0)
    for (auto &t : tracks)
      t->midi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
  while (offset < n) {
    int count = (int)juce::jmin((int64_t)(n - offset), loopFrames - current);
    auto first =
        std::lower_bound(events.begin(), events.end(), current,
                         [](const auto &e, int64_t p) { return e.frame < p; });
    for (auto it = first; it != events.end() && it->frame < current + count;
         ++it) {
      int at = offset + (int)(it->frame - current);
      auto &t = *tracks[(size_t)it->track];
      if (it->off)
        t.midi.addEvent(juce::MidiMessage::noteOff(1, it->pitch), at);
      else {
        trigger(it->track, it->pitch, it->velocity, it->duration, at);
        t.midi.addEvent(juce::MidiMessage::noteOn(1, it->pitch, it->velocity),
                        at);
      }
    }
    offset += count;
    current += count;
    if (current == loopFrames) {
      current = 0;
      if (offset < n)
        for (auto &t : tracks)
          t->midi.addEvent(juce::MidiMessage::allNotesOff(1), offset);
    }
  }
}
void Engine::process(float *const *output, int outputs, int n,
                     const float *const *input, int inputs) {
  if (n <= 0 || n > maxBlock)
    return;
  master.clear(0, n);
  delayBus.clear(0, n);
  inputCopy.clear(0, n);
  for (int c = 0; c < 2; ++c)
    if (inputs > 0 && input && input[juce::jmin(c, inputs - 1)])
      inputCopy.copyFrom(c, 0, input[juce::jmin(c, inputs - 1)], n);
  float inPeak = juce::jmax(inputCopy.getMagnitude(0, 0, n),
                            inputCopy.getMagnitude(1, 0, n));
  inputPeak.store(inPeak);
  for (auto &t : tracks) {
    t->buffer.clear(0, n);
    t->source.clear(0, n);
    t->midi.clear();
    t->midi.addEvents(t->pendingMidi, 0, n, 0);
    t->pendingMidi.clear();
    for (int note = 0; note < 128; ++note)
      if (t->previewRemaining[(size_t)note] > 0) {
        if (t->previewRemaining[(size_t)note] <= n)
          t->midi.addEvent(juce::MidiMessage::noteOff(1, note),
                           (int)t->previewRemaining[(size_t)note] - 1);
        t->previewRemaining[(size_t)note] =
            juce::jmax((int64_t)0, t->previewRemaining[(size_t)note] - n);
      }
  }
  schedule(n);
  liveMidi.clear();
  midi.removeNextBlockOfMessages(liveMidi, n);
  int target = indexOf(focus);
  if (target >= 0) {
    auto &t = *tracks[(size_t)target];
    t.midi.addEvents(liveMidi, 0, n, 0);
    for (auto message : liveMidi) {
      const auto &m = message.getMessage();
      if (m.isNoteOn())
        trigger(target, m.getNoteNumber(), m.getFloatVelocity(),
                (int64_t)(sampleRate * 600), message.samplePosition);
      else if (m.isNoteOff())
        for (auto &voice : t.voices)
          if (voice.active && voice.pitch == m.getNoteNumber())
            voice.duration = juce::jmin(
                voice.duration, voice.position + message.samplePosition);
    }
  }
  playHead.frame = frame;
  playHead.rate = sampleRate;
  playHead.bpm = bpm;
  playHead.playing = playing;
  const double samplesPerStep = sampleRate * 60 / bpm / 4;
  const float smooth = 1 - (float)std::exp(-1 / (sampleRate * .008));
  for (int index : order) {
    auto &t = *tracks[(size_t)index];
    renderVoice(t, n);
    if (t.config.monitor)
      for (int c = 0; c < 2; ++c)
        t.source.addFrom(c, 0, inputCopy, c, 0, n);
    t.localDelay.process(t.source, n);
    for (int c = 0; c < 2; ++c)
      t.buffer.addFrom(c, 0, t.source, c, 0, n);
    float *channels[] = {t.buffer.getWritePointer(0),
                         t.buffer.getWritePointer(1)};
    juce::AudioBuffer<float> block(channels, 2, n);
    for (auto &p : t.plugins)
      if (!p.bypassed)
        p.instance->processBlock(block, t.midi);
    t.effects.process(t.buffer, n);
    t.ownDelay.process(t.buffer, n);
    for (int i = 0; i < n; ++i) {
      double step =
          (double)((frame + (playing ? i : 0)) % loopFrames) / samplesPerStep;
      float gain = t.audible ? t.config.at(0, step, t.config.gain) : 0;
      float pan = t.config.at(1, step, t.config.pan),
            cutoff = t.config.at(2, step, t.config.cutoff);
      t.currentGain += (gain - t.currentGain) * smooth;
      t.currentPan += (pan - t.currentPan) * smooth;
      float alpha =
          1 -
          (float)std::exp(
              -2 * pi * juce::jlimit(80.f, (float)(sampleRate * .45), cutoff) /
              sampleRate);
      t.filterL += alpha * (t.buffer.getSample(0, i) - t.filterL);
      t.filterR += alpha * (t.buffer.getSample(1, i) - t.filterR);
      t.filterL2 += alpha * (t.filterL - t.filterL2);
      t.filterR2 += alpha * (t.filterR - t.filterR2);
      float left = t.filterL2 * t.currentGain *
                   std::sqrt(juce::jmax(0.f, 1 - t.currentPan)),
            right = t.filterR2 * t.currentGain *
                    std::sqrt(juce::jmax(0.f, 1 + t.currentPan));
      t.buffer.setSample(0, i, left);
      t.buffer.setSample(1, i, right);
      float send = t.config.at(3, step, t.config.send);
      t.source.setSample(0, i, left * send);
      t.source.setSample(1, i, right * send);
    }
    t.sendDelay.add(t.source, delayBus, n, 1);
    t.peak.store(juce::jmax(t.buffer.getMagnitude(0, 0, n),
                            t.buffer.getMagnitude(1, 0, n)));
    for (auto &e : edges)
      if (e.from == index)
        e.delay.add(t.buffer, e.to < 0 ? master : tracks[(size_t)e.to]->buffer,
                    n, e.gain);
  }
  const int delayLength = juce::jlimit(1, musicalDelay.getNumSamples() - 1,
                                       (int)(sampleRate * 60 / bpm / 2));
  for (int i = 0; i < n; ++i) {
    int read = (musicalPosition - delayLength + musicalDelay.getNumSamples()) %
               musicalDelay.getNumSamples();
    for (int c = 0; c < 2; ++c) {
      float delayed = musicalDelay.getSample(c, read);
      musicalDelay.setSample(c, musicalPosition,
                             delayBus.getSample(c, i) + delayed * .26f);
      float value = (master.getSample(c, i) + delayed * .32f) * masterGain;
      master.setSample(c, i, juce::jlimit(-1.f, 1.f, value));
    }
    if (++musicalPosition == musicalDelay.getNumSamples())
      musicalPosition = 0;
  }
  masterPeak.store(
      juce::jmax(master.getMagnitude(0, 0, n), master.getMagnitude(1, 0, n)));
  if (recorder) {
    const auto &source = recordingSource == "master" ? master : inputCopy;
    if (!recorder->write(source.getArrayOfReadPointers(), n))
      recordDrops.fetch_add(1);
    recordedFrames += n;
  }
  for (int c = 0; c < outputs; ++c)
    if (output[c]) {
      if (c < 2)
        juce::FloatVectorOperations::copy(output[c], master.getReadPointer(c),
                                          n);
      else
        juce::FloatVectorOperations::clear(output[c], n);
    }
  if (playing)
    frame = (frame + n) % loopFrames;
  observedFrame.store(frame);
  observedStep.store((double)frame / sampleRate * bpm / 60 * 4);
}
void Engine::reset() {
  const double step = (double)frame / sampleRate * bpm / 60 * 4;
  for (auto &t : tracks) {
    for (auto &voice : t->voices)
      voice.active = false;
    t->midi.clear();
    t->pendingMidi.clear();
    t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
    t->previewRemaining.fill(0);
    t->filterL = t->filterR = t->filterL2 = t->filterR2 = 0;
    t->effects.reset();
    t->currentGain = t->audible ? t->config.at(0, step, t->config.gain) : 0;
    t->currentPan = t->config.at(1, step, t->config.pan);
    t->localDelay.clear();
    t->ownDelay.clear();
    t->sendDelay.clear();
    for (auto &p : t->plugins)
      p.instance->reset();
  }
  for (auto &e : edges)
    e.delay.clear();
  musicalDelay.clear();
  musicalPosition = 0;
}
void Engine::handleIncomingMidiMessage(juce::MidiInput *,
                                       const juce::MidiMessage &message) {
  midi.addMessageToQueue(message);
  if (!message.isNoteOnOrOff())
    return;
  int a, n, b, m;
  midiFifo.prepareToWrite(1, a, n, b, m);
  if (n) {
    midiEvents[(size_t)a] = {message.getNoteNumber(),
                             message.getFloatVelocity(), message.isNoteOn(),
                             observedStep.load()};
    midiFifo.finishedWrite(1);
  }
}
var Engine::status() {
  juce::SpinLock::ScopedLockType guard(lock);
  std::vector<int> previous;
  bool changed = false;
  String warning;
  for (auto &t : tracks) {
    previous.push_back(t->latency);
    int64_t latency = t->config.manualDelay;
    for (auto &p : t->plugins)
      if (!p.bypassed)
        latency += juce::jmax(0, p.instance->getLatencySamples());
    if (latency > sampleRate * 8)
      warning = "La latencia de un plugin supera el límite del mezclador.";
    else {
      changed |= t->latency != (int)latency;
      t->latency = (int)latency;
    }
  }
  if (changed && warning.isEmpty())
    try {
      buildRouting(project);
    } catch (const std::exception &e) {
      warning = juce::String::fromUTF8(e.what());
    }
  if (warning.isNotEmpty()) {
    for (size_t i = 0; i < tracks.size(); ++i)
      tracks[i]->latency = previous[i];
    buildRouting(project);
    playing = false;
  }
  var meters = object({{"master", masterPeak.load()}}), latencies = object({}), reductions = object({});
  for (auto &t : tracks) {
    meters.getDynamicObject()->setProperty(t->config.id, t->peak.load());
    latencies.getDynamicObject()->setProperty(t->config.id, t->latency);
    reductions.getDynamicObject()->setProperty(t->config.id, t->effects.reduction());
  }
  var observations = array();
  int a, n, b, m;
  midiFifo.prepareToRead(midiFifo.getNumReady(), a, n, b, m);
  auto add = [&](int at) {
    auto &e = midiEvents[(size_t)at];
    observations.append(object({{"note", e.note},
                                {"velocity", e.velocity},
                                {"on", e.on},
                                {"step", e.step}}));
  };
  for (int i = 0; i < n; ++i)
    add(a + i);
  for (int i = 0; i < m; ++i)
    add(b + i);
  midiFifo.finishedRead(n + m);
  auto *device = devices.getCurrentAudioDevice();
  return object(
      {{"ready", true},
       {"backend", "native"},
       {"playing", playing},
       {"step", (double)frame / sampleRate * bpm / 60 * 4},
       {"sampleRate", sampleRate},
       {"bufferSize", device ? device->getCurrentBufferSizeSamples() : 0},
       {"driver", devices.getCurrentAudioDeviceType()},
       {"device", device ? device->getName() : String()},
       {"inputLatency", device && !device->getActiveInputChannels().isZero()
                            ? device->getInputLatencyInSamples()
                            : 0},
       {"outputLatency", device ? device->getOutputLatencyInSamples() : 0},
       {"pdcSamples", pdcSamples},
       {"trackLatencies", latencies},
       {"gainReduction", reductions},
       {"cpu", cpu.load()},
       {"overruns", overruns.load()},
       {"levels", meters},
       {"inputLevel", inputPeak.load()},
       {"recording", recorder != nullptr},
       {"recordedSeconds",
        recordingRate > 0 ? (double)recordedFrames / recordingRate : 0},
       {"recordDrops", recordDrops.load()},
       {"midi", observations},
       {"warning", warning}});
}
var Engine::startRecording(const var &v) {
  require(!recorder, "Ya hay una grabación en curso.");
  openDevice();
  if (text(v, "source") != "master") {
    auto setup = devices.getAudioDeviceSetup();
    if (setup.inputChannels.isZero()) {
      auto *type = devices.getCurrentDeviceTypeObject();
      type->scanForDevices();
      auto names = type->getDeviceNames(true);
      require(!names.isEmpty(), "No hay dispositivo de entrada de audio.");
      const bool wasPlaying = playing;
      configure(object({{"type", devices.getCurrentAudioDeviceType()},
                        {"output", setup.outputDeviceName},
                        {"input", names.contains(setup.outputDeviceName)
                                      ? setup.outputDeviceName
                                      : names[0]},
                        {"sampleRate", setup.sampleRate},
                        {"bufferSize", setup.bufferSize}}));
      playing = wasPlaying;
    }
  }
  juce::File file(text(v, "path"));
  require(file.isAbsolutePath(file.getFullPathName()),
          "Ruta de grabación inválida.");
  file.getParentDirectory().createDirectory();
  require(!file.exists(), "El archivo de grabación ya existe.");
  auto stream = file.createOutputStream();
  require(stream != nullptr, "No se pudo crear la grabación.");
  juce::WavAudioFormat wav;
  auto *writer = wav.createWriterFor(stream.get(), sampleRate, 2, 24, {}, 0);
  require(writer != nullptr, "No se pudo crear el codificador WAV.");
  stream.release();
  auto next = std::make_unique<juce::AudioFormatWriter::ThreadedWriter>(
      writer, recordingThread, 131072);
  {
    juce::SpinLock::ScopedLockType guard(lock);
    recordingPath = file.getFullPathName();
    recordingSource = text(v, "source");
    recordingRate = sampleRate;
    recordedFrames = 0;
    recordDrops = 0;
    recorder = std::move(next);
  }
  return object({{"recording", true}});
}
var Engine::stopRecording() {
  std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> previous;
  {
    juce::SpinLock::ScopedLockType guard(lock);
    require(recorder != nullptr, "No hay una grabación activa.");
    previous = std::move(recorder);
  }
  previous.reset();
  return object({{"path", recordingPath},
                 {"sampleRate", recordingRate},
                 {"frames", (double)recordedFrames},
                 {"drops", recordDrops.load()}});
}

var Engine::pluginStates() {
  juce::SpinLock::ScopedLockType guard(lock);
  var states = object({});
  for (auto &t : tracks)
    for (auto &p : t->plugins) {
      juce::MemoryBlock bytes;
      p.instance->getStateInformation(bytes);
      states.getDynamicObject()->setProperty(p.id, bytes.toBase64Encoding());
    }
  return states;
}
var Engine::scan(const var &v) {
  var found = array();
  juce::FileSearchPath paths;
  if (auto *entries = v["paths"].getArray())
    for (auto &path : *entries)
      paths.add(juce::File(path.toString()));
  for (auto *format : plugins.getFormats()) {
    if (format->getName() != "VST3")
      continue;
    auto search =
        paths.getNumPaths() > 0 ? paths : format->getDefaultLocationsToSearch();
    auto files = format->searchPathsForPlugins(search, true, false);
    if (text(v, "file").isNotEmpty()) {
      files.clear();
      files.add(text(v, "file"));
    }
    require(files.size() <= 256,
            "Selecciona una carpeta con un máximo de 256 plugins.");
    for (const auto &file : files) {
      juce::OwnedArray<juce::PluginDescription> descriptions;
      format->findAllTypesForFile(descriptions, file);
      for (auto *desc : descriptions) {
        auto xml = desc->createXml();
        found.append(object({{"name", desc->name},
                             {"manufacturer", desc->manufacturerName},
                             {"instrument", desc->isInstrument},
                             {"description", xml->toString()},
                             {"path", file}}));
      }
    }
  }
  return found;
}
var Engine::render(const var &v) {
  require(!recorder, "Detén la grabación antes de exportar.");
  juce::File file(text(v, "path"));
  require(!file.exists(), "El archivo de exportación ya existe.");
  file.getParentDirectory().createDirectory();
  var original = project.clone();
  var saved = original.clone();
  auto states = pluginStates();
  saved.getDynamicObject()->setProperty("restoreStates", true);
  if (auto *list = saved["tracks"].getArray())
    for (auto &t : *list)
      if (auto *slots = t["plugins"].getArray())
        for (auto &slot : *slots)
          slot.getDynamicObject()->setProperty(
              "state",
              states.getProperty(juce::Identifier(text(slot, "id")), var()));
  double previousRate = sampleRate;
  int64_t previousFrame = frame;
  playing = false;
  devices.removeAudioCallback(this);
  try {
    sampleRate = juce::jlimit(8000., 192000.,
                              (double)v.getProperty("sampleRate", 44100));
    signature.clear();
    load(saved);
    frame = 0;
    reset();
    playing = true;
    for (auto &t : tracks)
      for (auto &p : t->plugins)
        p.instance->setNonRealtime(true);
    auto stream = file.createOutputStream();
    require(stream != nullptr, "No se pudo crear el archivo WAV.");
    juce::WavAudioFormat wav;
    int bits = (int)v.getProperty("bitDepth", 16);
    require(bits == 16 || bits == 24 || bits == 32,
            "Profundidad WAV no compatible.");
    auto writer = std::unique_ptr<juce::AudioFormatWriter>(wav.createWriterFor(
        stream.get(), sampleRate, 2, (unsigned int)bits, {}, 0));
    require(writer != nullptr, "No se pudo crear el codificador WAV.");
    stream.release();
    int64_t musicFrames = loopFrames;
    int64_t remaining = musicFrames + (int64_t)(sampleRate * 3) + pdcSamples,
            skip = pdcSamples, processed = 0;
    juce::AudioBuffer<float> output(2, 256);
    float *pointers[] = {output.getWritePointer(0), output.getWritePointer(1)};
    while (remaining > 0) {
      int n = (int)juce::jmin((int64_t)256, remaining);
      if (processed < musicFrames && processed + n > musicFrames)
        n = (int)(musicFrames - processed);
      if (processed >= musicFrames && playing) {
        playing = false;
        for (auto &t : tracks)
          t->pendingMidi.addEvent(juce::MidiMessage::allNotesOff(1), 0);
      }
      process(pointers, 2, n, nullptr, 0);
      int omit = (int)juce::jmin(skip, (int64_t)n);
      skip -= omit;
      if (n > omit)
        require(writer->writeFromAudioSampleBuffer(output, omit, n - omit),
                "Error de escritura durante la exportación.");
      processed += n;
      remaining -= n;
    }
    writer.reset();
    playing = false;
    sampleRate = previousRate;
    signature.clear();
    load(saved);
    reset();
    frame = previousFrame % loopFrames;
    project = original;
    signature = graphSignature(original);
    if (deviceOpened)
      devices.addAudioCallback(this);
    return object({{"path", file.getFullPathName()},
                   {"sampleRate", v.getProperty("sampleRate", 44100)},
                   {"bitDepth", bits}});
  } catch (...) {
    playing = false;
    sampleRate = previousRate;
    signature.clear();
    try {
      load(saved);
      reset();
      project = original;
      signature = graphSignature(original);
    } catch (...) {
    }
    if (deviceOpened)
      devices.addAudioCallback(this);
    throw;
  }
}
var Engine::command(const var &request) {
  String name = text(request, "command");
  const var &v = request["args"];
  if (name == "init") {
    openDevice();
    return status();
  }
  if (name == "status")
    return status();
  if (name == "devices")
    return deviceList();
  if (name == "configure")
    return configure(v);
  if (name == "project") {
    load(v);
    return object({{"accepted", true}, {"pdcSamples", pdcSamples}});
  }
  if (name == "play") {
    openDevice();
    juce::SpinLock::ScopedLockType guard(lock);
    frame =
        (int64_t)(juce::jlimit(0., 1024., (double)v.getProperty("step", 0)) *
                  sampleRate * 60 / bpm / 4) %
        loopFrames;
    reset();
    playing = true;
    return object({{"playing", true}});
  }
  if (name == "stop" || name == "pause") {
    juce::SpinLock::ScopedLockType guard(lock);
    playing = false;
    reset();
    if (name == "stop")
      frame = 0;
    return object({{"playing", false},
                   {"step", (double)frame / sampleRate * bpm / 60 * 4}});
  }
  if (name == "preview") {
    openDevice();
    juce::SpinLock::ScopedLockType guard(lock);
    int index = indexOf(text(v, "trackId"));
    int note = juce::jlimit(0, 127, (int)v.getProperty("pitch", 60));
    require(index >= 0, "No se encontró el canal seleccionado.");
    auto &t = *tracks[(size_t)index];
    int64_t length = (int64_t)(sampleRate * .3);
    if (t.config.instrument == "sample" && t.sample)
      length =
          juce::jmax((int64_t)1,
                     (int64_t)(t.sample->data.getNumSamples() / t.sample->rate *
                               sampleRate / std::pow(2., (note - 60) / 12.)));
    trigger(index, note, .8f, length);
    t.pendingMidi.addEvent(juce::MidiMessage::noteOn(1, note, .8f), 0);
    t.previewRemaining[(size_t)note] = length;
    return object({{"played", true}});
  }
  if (name == "focus") {
    juce::SpinLock::ScopedLockType guard(lock);
    focus = text(v, "trackId");
    return object({});
  }
  if (name == "midi") {
    if (midiDevice.isNotEmpty()) {
      devices.removeMidiInputDeviceCallback(midiDevice, this);
      devices.setMidiInputDeviceEnabled(midiDevice, false);
    }
    midiDevice = text(v, "deviceId");
    if (midiDevice.isNotEmpty()) {
      devices.setMidiInputDeviceEnabled(midiDevice, true);
      require(devices.isMidiInputDeviceEnabled(midiDevice),
              "No se pudo abrir el dispositivo MIDI.");
      devices.addMidiInputDeviceCallback(midiDevice, this);
    }
    return object({{"deviceId", midiDevice}});
  }
  if (name == "scan")
    return scan(v);
  if (name == "states")
    return pluginStates();
  if (name == "parameters" || name == "parameter") {
    int index = indexOf(text(v, "trackId"));
    require(index >= 0, "No se encontró el canal.");
    for (auto &p : tracks[(size_t)index]->plugins)
      if (p.id == text(v, "pluginId")) {
        auto &parameters = p.instance->getParameters();
        if (name == "parameter") {
          int parameter = (int)v["index"];
          require(parameter >= 0 && parameter < parameters.size(),
                  "Parámetro fuera de rango.");
          auto *value = parameters[parameter];
          value->beginChangeGesture();
          value->setValueNotifyingHost(
              juce::jlimit(0.f, 1.f, number(v, "value")));
          value->endChangeGesture();
          return object({});
        }
        var values = array();
        for (int i = 0; i < parameters.size(); ++i) {
          auto *value = parameters[i];
          values.append(object({{"index", i},
                                {"name", value->getName(100)},
                                {"value", value->getValue()},
                                {"text", value->getCurrentValueAsText()},
                                {"label", value->getLabel()}}));
        }
        return values;
      }
    throw std::runtime_error("El plugin no está cargado.");
  }
  if (name == "editor") {
    int index = indexOf(text(v, "trackId"));
    require(index >= 0, "No se encontró el canal.");
    for (auto &p : tracks[(size_t)index]->plugins)
      if (p.id == text(v, "pluginId")) {
        editors.clear();
        editors.push_back(std::make_unique<EditorWindow>(*p.instance));
        return object({{"opened", true}});
      }
    throw std::runtime_error("El plugin no está cargado.");
  }
  if (name == "controlPanel") {
    auto *d = devices.getCurrentAudioDevice();
    require(d && d->hasControlPanel(),
            "El driver no ofrece un panel de control.");
    return object({{"opened", d->showControlPanel()}});
  }
  if (name == "recordStart")
    return startRecording(v);
  if (name == "recordStop")
    return stopRecording();
  if (name == "render")
    return render(v);
  if (name == "resetStats") {
    overruns = 0;
    recordDrops = 0;
    return object({});
  }
  throw std::runtime_error("Comando de audio desconocido.");
}
int Engine::selfTest(const juce::File &directory) {
  directory.createDirectory();
  var p = juce::JSON::parse(
      R"({"bpm":120,"master":0.8,"duration":1,"tracks":[{"id":"a","instrument":"sample","sampleId":"impulse","gain":0.5,"cutoff":20000,"delaySamples":64},{"id":"b","instrument":"sample","sampleId":"impulse","gain":0.5,"cutoff":20000}],"events":[{"trackId":"a","time":0,"duration":0.1,"pitch":60,"velocity":1},{"trackId":"b","time":0,"duration":0.1,"pitch":60,"velocity":1}]})");
  auto impulse = std::make_shared<SampleData>();
  impulse->rate = 48000;
  impulse->data.setSize(2, 256);
  impulse->data.clear();
  impulse->data.setSample(0, 0, 1);
  impulse->data.setSample(1, 0, 1);
  samples["impulse"] = impulse;
  load(p);
  reset();
  playing = true;
  juce::AudioBuffer<float> block(2, 256);
  float *data[] = {block.getWritePointer(0), block.getWritePointer(1)};
  process(data, 2, 256, nullptr, 0);
  int first = -1, peakAt = 0;
  float peak = 0;
  for (int i = 0; i < 256; ++i) {
    float x = std::abs(block.getSample(0, i));
    if (first < 0 && x > 1e-6f)
      first = i;
    if (x > peak) {
      peak = x;
      peakAt = i;
    }
  }
  require(pdcSamples == 64 && first == 64 && peakAt == 64 && peak > .4f,
          "La compensación no alineó los impulsos.");
  bool cycleRejected = false;
  auto cycle = juce::JSON::parse(juce::JSON::toString(p));
  cycle["tracks"][0].getDynamicObject()->setProperty("outputId", "b");
  cycle["tracks"][1].getDynamicObject()->setProperty("outputId", "a");
  try {
    load(cycle);
  } catch (...) {
    cycleRejected = true;
  }
  require(cycleRejected, "El grafo aceptó un ciclo.");
  auto midiNote = juce::MidiMessage::noteOn(1, 64, .7f);
  midiNote.setTimeStamp(juce::Time::getMillisecondCounterHiRes() * .001);
  handleIncomingMidiMessage(nullptr, midiNote);
  var observed = status();
  require(observed["midi"].size() == 1 &&
              (int)observed["midi"][0]["note"] == 64,
          "No se recibió el evento MIDI sintético.");
  playing = false;
  const int testedPdc = pdcSamples;
  var inputProject = juce::JSON::parse(
      R"({"bpm":120,"master":1,"duration":1,"tracks":[{"id":"monitor","instrument":"keys","kind":"bus","monitorInput":true,"gain":1,"cutoff":20000}],"events":[]})");
  load(inputProject);
  frame = 0;
  reset();
  juce::AudioBuffer<float> input(2, 256);
  input.clear();
  input.setSample(0, 0, .5f);
  input.setSample(1, 0, .25f);
  const float *inputChannels[] = {input.getReadPointer(0),
                                  input.getReadPointer(1)};
  process(data, 2, 256, inputChannels, 2);
  require(block.getMagnitude(0, 0, 256) > .3f &&
              std::abs(block.getMagnitude(0, 0, 256) /
                           block.getMagnitude(1, 0, 256) -
                       2) < .001f,
          "La entrada sintética no llegó al mezclador estéreo.");
  var result = object({{"pdcSamples", testedPdc},
                       {"firstNonzeroSample", first},
                       {"peakSample", peakAt},
                       {"peak", peak},
                       {"routingCycleRejected", cycleRejected},
                       {"midiEventObserved", true},
                       {"syntheticInputMonitoring", true},
                       {"callbackFrames", 256},
                       {"passed", true}});
  directory.getChildFile("native-self-test.json")
      .replaceWithText(juce::JSON::toString(result, false));
  std::cout << juce::JSON::toString(result, true) << std::endl;
  return 0;
}
} // namespace sw
