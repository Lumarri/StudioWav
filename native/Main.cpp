#include "Engine.h"
#include <mutex>
#include <thread>

class Reporter final : private juce::Timer {
public:
  explicit Reporter(sw::Engine &engine) : engine(engine) { startTimerHz(20); }
  static void emit(const juce::var &v) {
    static std::mutex output;
    std::lock_guard<std::mutex> guard(output);
    std::cout << juce::JSON::toString(v, true).toStdString() << std::endl;
  }

private:
  sw::Engine &engine;
  void timerCallback() override {
    emit(sw::object({{"event", "status"}, {"data", engine.status()}}));
  }
};
int main(int argc, char **argv) {
  juce::ScopedJuceInitialiser_GUI gui;
  try {
    sw::Engine engine;
    if (argc >= 3 && juce::String(argv[1]) == "--self-test")
      return engine.selfTest(juce::File(juce::String::fromUTF8(argv[2])));
    Reporter reporter(engine);
    std::thread reader([&] {
      std::string line;
      while (std::getline(std::cin, line)) {
        if (line.size() > 250000000) {
          Reporter::emit(
              sw::object({{"id", -1}, {"error", "Mensaje demasiado grande."}}));
          continue;
        }
        juce::var request =
            juce::JSON::parse(juce::String::fromUTF8(line.c_str()));
        if (request["command"].toString() == "quit") {
          juce::MessageManager::callAsync(
              [] { juce::MessageManager::getInstance()->stopDispatchLoop(); });
          return;
        }
        juce::MessageManager::callAsync([request, &engine] {
          try {
            auto result = engine.command(request);
            Reporter::emit(
                sw::object({{"id", request["id"]}, {"result", result}}));
          } catch (const std::exception &error) {
            Reporter::emit(
                sw::object({{"id", request["id"]},
                            {"error", juce::String::fromUTF8(error.what())}}));
          }
        });
      }
      juce::MessageManager::callAsync(
          [] { juce::MessageManager::getInstance()->stopDispatchLoop(); });
    });
    juce::MessageManager::getInstance()->runDispatchLoop();
    reader.join();
    return 0;
  } catch (const std::exception &error) {
    std::cerr << error.what() << std::endl;
    return 1;
  }
}
