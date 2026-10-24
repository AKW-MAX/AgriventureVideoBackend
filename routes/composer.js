const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const router = express.Router();
const OUTPUT_DIRECTORY = path.join(__dirname, '..', 'tmp');
const SAMPLE_RATE = 22050;
const STEPS_PER_BAR = 16;
const BAR_COUNT = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const NOTE_FREQUENCIES = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392,
  A4: 440,
};

function writeWav(samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}

function makeLoop({ bpm, drums, melody }) {
  const secondsPerStep = 60 / bpm / 4;
  const sampleCount = Math.ceil(
    secondsPerStep * STEPS_PER_BAR * BAR_COUNT * SAMPLE_RATE
  );
  const output = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    const position = index / SAMPLE_RATE;
    const step = Math.floor(position / secondsPerStep);
    const stepPosition = position - step * secondsPerStep;
    const patternStep = step % STEPS_PER_BAR;
    let sample = 0;

    if (drums.kick[patternStep] && stepPosition < 0.45) {
      const frequency = 48 + 120 * Math.exp(-stepPosition * 28);
      sample += Math.sin(2 * Math.PI * frequency * stepPosition)
        * Math.exp(-stepPosition * 11) * 0.78;
    }

    if (drums.snare[patternStep] && stepPosition < 0.24) {
      const noise = Math.sin(index * 12.9898 + step * 78.233) * 0.5
        + Math.sin(index * 4.1414 + 32.31) * 0.25;
      sample += noise * Math.exp(-stepPosition * 19) * 0.38;
      sample += Math.sin(2 * Math.PI * 180 * stepPosition)
        * Math.exp(-stepPosition * 22) * 0.2;
    }

    if (drums.hat[patternStep] && stepPosition < 0.08) {
      const noise = Math.sin(index * 93.9898 + 78.233)
        * Math.sin(index * 17.719 + 21.17);
      sample += noise * Math.exp(-stepPosition * 48) * 0.2;
    }

    const note = melody[patternStep];
    if (note && stepPosition < secondsPerStep * 0.92) {
      const frequency = NOTE_FREQUENCIES[note];
      const envelope = Math.exp(-stepPosition * 5.2)
        * Math.min(1, stepPosition * 100);
      sample += (
        Math.sin(2 * Math.PI * frequency * stepPosition)
        + Math.sin(2 * Math.PI * frequency * 2 * stepPosition) * 0.2
      ) * envelope * 0.26;
    }

    output[index] = Math.tanh(sample * 1.2);
  }

  return writeWav(output);
}

router.post('/create', async (req, res) => {
  try {
    const { bpm, drums, melody } = req.body || {};
    if (!Number.isInteger(bpm) || bpm < 70 || bpm > 160) {
      return res.status(400).json({
        success: false,
        message: 'Tempo must be a whole number between 70 and 160 BPM.',
      });
    }

    const trackNames = ['kick', 'snare', 'hat'];
    if (
      !drums
      || trackNames.some((track) =>
        !Array.isArray(drums[track])
        || drums[track].length !== STEPS_PER_BAR
        || drums[track].some((step) => typeof step !== 'boolean')
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Each drum pattern must contain 16 on/off steps.',
      });
    }

    if (
      !Array.isArray(melody)
      || melody.length !== STEPS_PER_BAR
      || melody.some((note) => note !== null && !Object.hasOwn(NOTE_FREQUENCIES, note))
    ) {
      return res.status(400).json({
        success: false,
        message: 'The melody must contain 16 valid note steps.',
      });
    }

    const audio = makeLoop({ bpm, drums, melody });
    if (audio.length > MAX_FILE_BYTES) {
      return res.status(413).json({ success: false, message: 'The generated audio is too large.' });
    }

    await fs.promises.mkdir(OUTPUT_DIRECTORY, { recursive: true });
    const filename = `composer-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.wav`;
    const outputPath = path.join(OUTPUT_DIRECTORY, filename);
    await fs.promises.writeFile(outputPath, audio, { flag: 'wx' });

    return res.json({
      success: true,
      audioUrl: `${req.protocol}://${req.get('host')}/api/composer/audio/${filename}`,
    });
  } catch (error) {
    console.error('Beat and melody generation error:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to generate the music loop.',
    });
  }
});

router.get('/audio/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^composer-\d+-[a-f0-9]+\.wav$/i.test(filename)) {
    return res.status(404).json({ success: false, message: 'Audio file not found.' });
  }

  const filePath = path.join(OUTPUT_DIRECTORY, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Audio file not found.' });
  }
  return res.type('audio/wav').sendFile(filePath);
});

module.exports = router;
