import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceToPattern } from "./voice-to-strudel.js";
import { transpiler } from "./transpiler-patch.js";
import { evalScope, evaluate } from "@strudel/core";
import * as core from "@strudel/core";
import * as mini from "@strudel/mini";

const notes = [
  { midi: 60, time: 1, duration: 0.5, velocity: 0.8 },
  { midi: 64, time: 2, duration: 0.5, velocity: 0.8 },
];

test("voice transcription generates melodic Strudel with rests and removes lead-in", () => {
  const code = voiceToPattern(
    { notes: notes.slice().reverse() },
    { bpm: 120, gridSubdivision: 8 },
  );
  assert.match(code, /setcpm\(120\/4\)/);
  assert.match(code, /c4/);
  assert.match(code, /e4/);
  assert.match(code, /~/);
  assert.match(code, /\.s\("gm_piano"\)/);
  assert.doesNotMatch(code, /bar 2/);
  assert.equal(notes[0].time, 1, "input is not mutated");
});

test("reject invalid model data and unbounded tempo/grid inputs", () => {
  for (const bad of [
    null,
    { notes: [] },
    { notes: [{ ...notes[0], midi: 128 }] },
    { notes: [{ ...notes[0], duration: -1 }] },
    { notes: [{ ...notes[0], time: NaN }] },
    { notes: [{ ...notes[0], velocity: Infinity }] },
    { notes: [{ ...notes[0], time: 31 }] },
  ]) {
    assert.throws(() => voiceToPattern(bad));
  }
  assert.throws(() => voiceToPattern({ notes }, { bpm: 0 }));
  assert.throws(() => voiceToPattern({ notes }, { bpm: 301 }));
  assert.throws(() => voiceToPattern({ notes }, { gridSubdivision: -1 }));
});

test("generated code evaluates into the expected timed note events", async () => {
  const tempoChanges = [];
  await evalScope(core, mini, { setcpm: (cpm) => tempoChanges.push(cpm) });
  // Sound assignment is already covered by the shared MIDI codegen tests;
  // use a minimal s() registration here to avoid loading WebAudio in Node.
  core.register("s", (sound, pat) =>
    pat.fmap((value) => ({ ...value, s: sound })),
  );
  core.register("room", (_, pat) => pat);
  core.register("p", (_, pat) => pat);
  const code = voiceToPattern({ notes }, { bpm: 120, gridSubdivision: 8 });
  const { pattern } = await evaluate(code, transpiler);
  const events = pattern.queryArc(0, 1);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => e.value.note),
    ["c4", "e4"],
  );
  assert.equal(Number(events[0].whole.begin), 0);
  assert.equal(Number(events[1].whole.begin), 0.5);
  assert.deepEqual(tempoChanges, [30]);
});
