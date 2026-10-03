# Reconstructing Strudel patterns from audio

Research date: 2026-10-03.

## Finding

[MIDI-grep][midi-grep] is the closest community project to the proposed feature:
it combines source separation, transcription, Strudel generation, and comparison
between the input and rendered output. It provides an integration reference for
building an audio-to-pattern workflow.

I did not find a mature, single pretrained model that reconstructs arbitrary
mixed audio directly into Strudel code. Community models cover the component
problems. The main integration work is recovering musical events and matching
sounds against the samples, synthesizers, and effects available in Strudel.

The practical goal is editable code whose rendered audio resembles the input.
An audio waveform does not uniquely identify the original source code or synth
settings: several instruments, effects, and patterns can produce similar audio.

This research inspected project documentation and selected implementation files.
It does not establish reconstruction quality through a comparative benchmark.
The Basic Pitch voice implementation in [PR #1][voice-pr] was tested separately;
the complete pipelines described here have not been run or benchmarked in this
research.

## Separate the problem into four stages

1. **Source separation:** split a mixed recording into stems such as drums,
   bass, vocals, and other instruments. A stem can still contain multiple
   instruments; separation does not automatically recover each oscillator or
   every original track.
2. **Musical transcription:** estimate pitches, note boundaries, drum hits,
   tempo, and repeating phrases from those stems.
3. **Sound reconstruction:** identify suitable samples or infer oscillators,
   envelopes, filters, and effects that approximate each source's timbre.
4. **Code generation and refinement:** turn those events and settings into
   Strudel, render the candidate, compare it with the recording, and improve it.

The current voice PR supplies a transcription endpoint and connects detected
notes to Strasbeat's existing MIDI-to-Strudel translation core. Mixed samples,
stem separation, and timbre reconstruction are further work.

## Projects that already generate Strudel

### MIDI-grep: closest overall match

The [documented pipeline][midi-grep] includes:

- Demucs separation into melodic, drums, bass, and vocals stems.
- Basic Pitch transcription and separate drum-onset detection.
- Tempo, key, genre, section, and loop analysis.
- Ollama generation of Strudel using note data and a restricted sound palette.
- Rendering, audio-feature comparison, and iterative improvement.

The [orchestrator][midi-grep-orchestrator] actually invokes `ollama_codegen.py`
with analysis and optional note data. A failed generation can fall back to a
minimal placeholder, so successful command completion alone is insufficient to
judge reconstruction quality.

Sound/effect estimation in [audio_to_strudel_params.py][midi-grep-params] uses
spectral, dynamic, and rhythmic features with hand-written rules. These rules
and LLM suggestions are useful starting points, but they do not constitute a
trained inverse model of Strudel's synthesizers.

Its [comparison code][midi-grep-comparison] combines frequency balance, MFCC,
energy, brightness, tempo, and chroma similarities. A percentage from that
weighted feature score should not be interpreted as a measured percentage of
faithful reconstruction. A/B listening and event-level checks remain necessary.

The existing rendering workflow also includes a macOS BlackHole recorder. A
server integration needs a rendering path that works in the chosen environment.

### audio-reference: another direct experiment

[audio-reference][audio-reference] combines deterministic audio analysis,
optional Basic Pitch, optional Demucs stems, and Gemini interpretation. It
produces per-track playable Strudel expressions and validates them headlessly.

It is a useful reference for structured track output and generated-code
validation. Its generation depends on a hosted Gemini model, and its author
explicitly describes the current results as poor. It should be evaluated as an
exploration, not an established reconstruction solution.

## Community models and inverse-synthesis approaches

| Project | Output | Relevance and integration limits |
| --- | --- | --- |
| [Demucs][demucs] | Drums, bass, vocals, and other audio stems | Practical fixed-stem separation with pretrained models. The original repository is archived. The other stem is not guaranteed to isolate individual melodic instruments. |
| [SAM Audio][sam-audio] | A target sound and residual audio, selected using text, visual, or temporal prompts | Potentially useful for extracting a particular instrument. Checkpoints require Hugging Face access approval; CUDA is recommended. It does not emit notes or Strudel. |
| [MT3][mt3] | Multi-instrument note transcription | Has pretrained inference checkpoints and can recover musical events from a mixture. Its output is symbolic music, with additional work needed for Strudel code and sound matching. |
| [Syntheon][syntheon] | Synthesizer preset data, including inferred wavetables and envelopes | A Vital inference implementation and checkpoint are present. Useful for timbre reconstruction, but its preset format and synthesis engine need adaptation to Strudel. |
| [INSTRUMENTAL][instrumental] | Parameters for its own subtractive synthesizer | Uses pitch detection and CMA-ES optimization of a 28-parameter synth against spectral losses. Particularly relevant to matching sound; it is a per-sample optimization approach rather than a general pretrained audio-to-Strudel model. |
| [Sound2Synth][sound2synth] | Dexed FM synthesizer parameters | Relevant research on inverse synthesis. Its README describes training requirements and says pretrained checkpoints will be released later; it is not a ready-to-use pretrained backend based on the inspected material. |

Syntheon's [Vital inferencer][syntheon-inferencer] loads a packaged checkpoint,
predicts wavetables and attack/decay/sustain parameters, and converts them to a
Vital preset. This is a concrete example of learned sound reconstruction, but
exporting its settings as Strudel calls would not guarantee equivalent sound.

INSTRUMENTAL reports a separation → pitch detection → parameter search pipeline
and includes original/matched demo audio. Its reported losses and timings are
the project's own examples, not a broad validation of arbitrary recordings.
Its central approach can inform a search over Strudel patches rendered through
Strudel's actual engine.

## Recommended approach for Strasbeat

Start with a short mixed loop and retain intermediate results so that failures
in separation, transcription, and sound matching can be inspected independently.

1. **Add sample upload and stem preview.** Begin with fixed-stem separation;
   evaluate prompted separation if multiple instruments remain blended. Preserve
   relative stem levels and timing.
2. **Transcribe stems into the existing translation model.** Use pitched-note
   transcription for melodic stems and a drum-specific path for percussive
   events. Expose tempo and quantization controls rather than silently forcing
   uncertain timing onto a grid.
3. **Match a bounded palette of actual Strudel sounds.** Generate candidate
   samples and synth patches using supported names and a small parameter set.
   Render candidates and compare their timbre with each source stem. Estimate
   envelopes and effects progressively after the basic source sound matches.
4. **Generate readable code and refine the complete rendering.** Keep the shared
   code generator as the default. Validate generated code, render the whole
   pattern, compare aligned audio, and show the source/reconstruction for A/B
   listening. An LLM can suggest changes within the allowed palette.

The important architectural choice is to evaluate the final candidate with
Strudel's actual renderer. A close match in Vital or a custom Python synthesizer
can sound different after its parameters are translated to another engine.

If a source cannot be reproduced adequately with the available synth palette,
an explicit alternative is to retain an isolated one-shot as a custom sample
and generate an editable pattern that triggers it. That recovers arrangement
and timing while retaining recorded timbre; it does not recover the original
synthesis patch. Make the distinction visible in the result.

## Evaluation before integrating a full reconstruction pipeline

Use several short examples: a clean synth phrase, a drum loop, a bass/drum mix,
and a mixture with overlapping pitched instruments. For each, retain the stems,
detected events, generated code, and final rendered audio.

Assess note/onset accuracy where references exist, rhythm and tempo alignment,
instrument separation, audible timbre similarity, valid Strudel execution, and
processing cost. Listen to A/B examples alongside the feature scores. Repeat
with real recordings as well as Strudel-generated fixtures; synthetic fixtures
alone would favor the available Strudel palette.

## Reuse and source availability

- MIDI-grep's README states MIT, but no root license file was found at the
  inspected revision. Verify the terms before copying substantial source.
- No root license file was identified for audio-reference, INSTRUMENTAL, or
  Sound2Synth at the inspected revisions. Public source availability alone does
  not establish permission to redistribute it.
- Demucs identifies MIT; MT3 and Syntheon identify Apache-2.0. Review the terms
  of any selected model checkpoints separately from the surrounding code.
- SAM Audio uses the SAM License and requires checkpoint access approval.

For the first implementation experiment, reuse clearly licensed model packages
through their APIs and use the direct Strudel projects as architecture
references. Confirm code and checkpoint terms for whichever components the
experiment selects.

## Source revisions

Links below are pinned to the revisions inspected, so the findings can be
rechecked even if upstream documentation changes.

[voice-pr]: https://github.com/AntonC9018/strasbeat/pull/1
[midi-grep]: https://github.com/dygy/MIDI-grep/blob/0a70aa5804beff0e406f649f268f279697041a74/README.md
[midi-grep-orchestrator]: https://github.com/dygy/MIDI-grep/blob/0a70aa5804beff0e406f649f268f279697041a74/internal/pipeline/orchestrator.go
[midi-grep-params]: https://github.com/dygy/MIDI-grep/blob/0a70aa5804beff0e406f649f268f279697041a74/scripts/python/audio_to_strudel_params.py
[midi-grep-comparison]: https://github.com/dygy/MIDI-grep/blob/0a70aa5804beff0e406f649f268f279697041a74/scripts/python/compare_audio.py
[audio-reference]: https://github.com/lmorchard/audio-reference/blob/a6ce27f6292d5397666a13daad8266d2c4321e87/README.md
[demucs]: https://github.com/facebookresearch/demucs/blob/e976d93ecc3865e5757426930257e200846a520a/README.md
[sam-audio]: https://github.com/facebookresearch/sam-audio/blob/bb4c6999d2677c7402360e426afc01ddfad6dce0/README.md
[mt3]: https://github.com/magenta/mt3/blob/88f4b3d63d7d1ce35a6e380ec190debbbd9b4b4d/README.md
[syntheon]: https://github.com/gudgud96/syntheon/blob/8a7f5c32ee7e704b3553cc75074bb7db4921da52/README.md
[syntheon-inferencer]: https://github.com/gudgud96/syntheon/blob/8a7f5c32ee7e704b3553cc75074bb7db4921da52/syntheon/inferencer/vital/vital_inferencer.py
[instrumental]: https://github.com/philippbogdan/instrumental/blob/b596a0e1d3a801c470ca5c10fde60b775e73bcfb/README.md
[sound2synth]: https://github.com/Sound2Synth/Sound2Synth/blob/44d9176176d794f7fe3ec96573ce758f4a56896c/README.md
