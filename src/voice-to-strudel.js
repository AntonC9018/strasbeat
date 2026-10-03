import {
  analyzeTranslationInput,
  generatePatternDraft,
  midiToName,
} from "./midi-to-strudel.js";

// Keep model data at the same translation seam used by MIDI import/capture.
// Voice is always melodic: MIDI file drum heuristics do not apply here.
export function voiceToPattern(payload, { bpm = 120, gridSubdivision } = {}) {
  if (!Number.isFinite(bpm) || bpm < 30 || bpm > 300) {
    throw new Error("Tempo must be between 30 and 300 BPM.");
  }
  if (gridSubdivision != null && ![4, 8, 16, 32].includes(gridSubdivision)) {
    throw new Error("Choose a supported quantization grid.");
  }
  if (
    !Array.isArray(payload?.notes) ||
    !payload.notes.length ||
    payload.notes.length > 4096
  ) {
    throw new Error("No notes detected. Try a clear sung or hummed melody.");
  }
  const notes = payload.notes
    .map(({ midi, time, duration, velocity }) => {
      if (
        !Number.isInteger(midi) ||
        midi < 0 ||
        midi > 127 ||
        !Number.isFinite(time) ||
        time < 0 ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        time + duration > 30.1 ||
        !Number.isFinite(velocity) ||
        velocity < 0 ||
        velocity > 1
      ) {
        throw new Error("The transcription service returned invalid notes.");
      }
      return {
        midi,
        time,
        duration,
        velocity,
        name: midiToName(midi),
      };
    })
    .sort((a, b) => a.time - b.time || a.midi - b.midi);
  // Remove microphone lead-in, but preserve rests within the phrase.
  const start = notes[0].time;
  for (const note of notes) note.time -= start;
  const input = {
    sourceName: "voice",
    bpm,
    timeSignature: [4, 4],
    ppq: 480,
    hasTempoChanges: false,
    hasTimeSigChanges: false,
    tracks: [
      {
        name: "voice",
        channel: 0,
        isDrum: false,
        gmInstrument: "acoustic grand piano",
        gmProgram: 0,
        notes,
      },
    ],
  };
  const analysis = analyzeTranslationInput(input, { gridSubdivision });
  return `// Sung or hummed melody · Basic Pitch transcription\n${generatePatternDraft(analysis)}`;
}
