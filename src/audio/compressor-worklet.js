// Original stereo-linked, hard-knee compressor. Same gain law as the C++ engine.
class StudioWavCompressor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => {
      if (e.data === "reset") {
        this.reduction = 0;
        this.meterPeak = 0;
        this.meterFrames = 0;
      }
    };
  }
  static get parameterDescriptors() {
    return [
      {
        name: "enabled",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "threshold",
        defaultValue: -18,
        minValue: -60,
        maxValue: 0,
        automationRate: "k-rate",
      },
      {
        name: "ratio",
        defaultValue: 4,
        minValue: 1,
        maxValue: 20,
        automationRate: "k-rate",
      },
      {
        name: "attack",
        defaultValue: 10,
        minValue: 0.1,
        maxValue: 200,
        automationRate: "k-rate",
      },
      {
        name: "release",
        defaultValue: 150,
        minValue: 10,
        maxValue: 2000,
        automationRate: "k-rate",
      },
      {
        name: "makeup",
        defaultValue: 0,
        minValue: 0,
        maxValue: 24,
        automationRate: "k-rate",
      },
    ];
  }
  reduction = 0;
  enabled = false;
  meterFrames = 0;
  meterPeak = 0;
  process(inputs, outputs, parameters) {
    const input = inputs[0],
      output = outputs[0];
    if (!output?.length) return true;
    const enabled = parameters.enabled[0] >= 0.5;
    if (enabled !== this.enabled) this.reduction = 0;
    this.enabled = enabled;
    const attack = Math.exp(-1 / (sampleRate * parameters.attack[0] * 0.001));
    const release = Math.exp(-1 / (sampleRate * parameters.release[0] * 0.001));
    const threshold = parameters.threshold[0],
      ratio = parameters.ratio[0],
      makeup = parameters.makeup[0];
    let peakReduction = 0;
    for (let i = 0; i < output[0].length; ++i) {
      const left = input?.[0]?.[i] ?? 0,
        right = input?.[1]?.[i] ?? left;
      let gain = 1;
      if (enabled) {
        const level =
          20 * Math.log10(Math.max(1e-9, Math.abs(left), Math.abs(right)));
        const target = Math.max(0, (level - threshold) * (1 - 1 / ratio));
        const coefficient = target > this.reduction ? attack : release;
        this.reduction =
          coefficient * this.reduction + (1 - coefficient) * target;
        gain = 10 ** ((makeup - this.reduction) / 20);
        peakReduction = Math.max(peakReduction, this.reduction);
      }
      output[0][i] = left * gain;
      if (output[1]) output[1][i] = right * gain;
    }
    this.meterPeak = Math.max(this.meterPeak, peakReduction);
    this.meterFrames += output[0].length;
    if (this.meterFrames >= sampleRate / 20) {
      this.port.postMessage(this.meterPeak);
      this.meterFrames = 0;
      this.meterPeak = 0;
    }
    return true;
  }
}
registerProcessor("studiowav-compressor", StudioWavCompressor);
