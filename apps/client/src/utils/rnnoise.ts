import rnnoiseModuleUrl from '@shiguredo/rnnoise-wasm?url';

let workletUrl: string | null = null;
let workletReady: Promise<string> | null = null;

function rnnoiseWorkletSource(moduleUrl: string) {
  return `
    import { Rnnoise } from ${JSON.stringify(moduleUrl)};

    class RnnoiseProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.enabled = true;
        this.ready = false;
        this.destroyed = false;
        this.frameSize = 480;
        this.inputFrame = new Float32Array(this.frameSize);
        this.outputQueue = [];
        this.outputReadIndex = 0;
        this.inputOffset = 0;
        this.port.onmessage = (event) => {
          if (event.data?.type === 'set-enabled') {
            this.enabled = Boolean(event.data.enabled);
            this.outputQueue = [];
            this.outputReadIndex = 0;
            this.inputOffset = 0;
          }
          if (event.data?.type === 'destroy') this.destroy();
        };
        Rnnoise.load()
          .then((rnnoise) => {
            if (this.destroyed) return;
            this.rnnoise = rnnoise;
            this.state = rnnoise.createDenoiseState();
            this.frameSize = rnnoise.frameSize;
            this.inputFrame = new Float32Array(this.frameSize);
            this.outputQueue = [];
            this.outputReadIndex = 0;
            this.inputOffset = 0;
            this.ready = true;
            this.port.postMessage({ type: 'ready' });
          })
          .catch(() => {
            this.ready = false;
            this.port.postMessage({ type: 'error' });
          });
      }

      destroy() {
        this.destroyed = true;
        this.state?.destroy?.();
        this.state = null;
        this.ready = false;
      }

      process(inputs, outputs) {
        const input = inputs[0]?.[0];
        const outputChannels = outputs[0] ?? [];
        if (!input || outputChannels.length === 0) return true;

        if (!this.enabled || !this.ready || !this.state) {
          for (const output of outputChannels) output.set(input);
          return true;
        }

        const firstOutput = outputChannels[0];
        for (let i = 0; i < firstOutput.length; i += 1) {
          const inputSample = input[i] || 0;
          this.inputFrame[this.inputOffset] = Math.max(-1, Math.min(1, inputSample)) * 32768;
          this.inputOffset += 1;

          let outputSample = inputSample;
          if (this.outputReadIndex < this.outputQueue.length) {
            outputSample = this.outputQueue[this.outputReadIndex];
            this.outputReadIndex += 1;
          }
          firstOutput[i] = outputSample;

          if (this.inputOffset >= this.frameSize) {
            try {
              this.state.processFrame(this.inputFrame);
              for (let j = 0; j < this.frameSize; j += 1) {
                this.outputQueue.push(Math.max(-1, Math.min(1, this.inputFrame[j] / 32768)));
              }
            } catch {
              for (let j = 0; j < this.frameSize; j += 1) {
                this.outputQueue.push(Math.max(-1, Math.min(1, this.inputFrame[j] / 32768)));
              }
            }
            this.inputOffset = 0;
            if (this.outputReadIndex > 2048) {
              this.outputQueue = this.outputQueue.slice(this.outputReadIndex);
              this.outputReadIndex = 0;
            }
          }
        }

        for (let channel = 1; channel < outputChannels.length; channel += 1) {
          outputChannels[channel].set(firstOutput);
        }
        return true;
      }
    }

    registerProcessor('notoc-rnnoise', RnnoiseProcessor);
  `;
}

async function loadRnnoiseWorklet(ctx: AudioContext) {
  if (!workletReady) {
    workletReady = Promise.resolve().then(() => {
      if (!workletUrl) {
        const moduleUrl = new URL(rnnoiseModuleUrl, window.location.href).href;
        workletUrl = URL.createObjectURL(new Blob([rnnoiseWorkletSource(moduleUrl)], { type: 'text/javascript' }));
      }
      return workletUrl;
    });
  }
  await ctx.audioWorklet.addModule(await workletReady);
}

export async function createRnnoiseNode(ctx: AudioContext, enabled: boolean): Promise<AudioWorkletNode | null> {
  if (!('audioWorklet' in ctx) || typeof AudioWorkletNode === 'undefined') return null;
  try {
    await loadRnnoiseWorklet(ctx);
    const node = new AudioWorkletNode(ctx, 'notoc-rnnoise', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    node.port.postMessage({ type: 'set-enabled', enabled });
    return node;
  } catch {
    return null;
  }
}

export function setRnnoiseEnabled(node: AudioWorkletNode | null, enabled: boolean) {
  node?.port.postMessage({ type: 'set-enabled', enabled });
}

export function destroyRnnoiseNode(node: AudioWorkletNode | null) {
  try {
    node?.port.postMessage({ type: 'destroy' });
    node?.disconnect();
  } catch {
    /* ignore */
  }
}
