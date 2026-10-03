import { voiceToPattern } from "../voice-to-strudel.js";

const MAX_SECONDS = 30;
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/webm",
];
let active = false;

export function showVoiceCaptureDialog({
  baseUrl = "",
  bpm = 120,
  onInsert,
  onStart,
}) {
  if (active) return;
  active = true;
  const previousFocus = document.activeElement;
  const root = document.createElement("div");
  root.className = "modal-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Capture voice melody");
  // All dynamic values are assigned via textContent/value below.
  root.innerHTML = `<div class="modal voice-capture">
    <div class="modal__title">Capture voice melody</div>
    <div class="modal__message">Sing or hum a short melody in a quiet room. Stop when you're done (30 seconds maximum). Your recording is sent to the transcription service.</div>
    <div class="voice-capture__status" role="status" aria-live="polite"></div>
    <label class="modal__label">Tempo (BPM)<input class="modal__input" type="number" min="30" max="300" step="1" data-bpm></label>
    <fieldset class="voice-capture__grid"><legend>Quantize</legend>
      <label><input type="radio" name="voice-grid" value="" checked> Auto</label>
      <label><input type="radio" name="voice-grid" value="4"> 1/4</label>
      <label><input type="radio" name="voice-grid" value="8"> 1/8</label>
      <label><input type="radio" name="voice-grid" value="16"> 1/16</label>
    </fieldset>
    <audio controls hidden aria-label="Recorded melody"></audio>
    <pre class="voice-capture__code" tabindex="0" hidden></pre>
    <div class="modal__error" role="alert"></div>
    <div class="modal__actions">
      <button class="btn btn--ghost" type="button" data-cancel>Cancel</button>
      <button class="btn" type="button" data-record disabled>Starting…</button>
      <button class="btn modal__confirm" type="button" data-insert hidden>Open as pattern</button>
    </div>
  </div>`;
  const status = root.querySelector('[role="status"]');
  const error = root.querySelector('[role="alert"]');
  const record = root.querySelector("[data-record]");
  const insert = root.querySelector("[data-insert]");
  const tempo = root.querySelector("[data-bpm]");
  const preview = root.querySelector("pre");
  const audio = root.querySelector("audio");
  tempo.value = String(Math.round(bpm));
  let closed = false,
    stream = null,
    recorder = null,
    timer = null;
  let audioUrl = null,
    result = null,
    code = "",
    chunks = [],
    bytes = 0;
  let state = "starting";
  let controller = null;

  function releaseMicrophone() {
    clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function close() {
    if (closed) return;
    closed = true;
    active = false;
    controller?.abort();
    if (recorder?.state === "recording") recorder.stop();
    releaseMicrophone();
    audio.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("pagehide", close);
    root.remove();
    previousFocus?.focus();
  }

  function fail(message) {
    state = "error";
    error.textContent = message;
    status.textContent = "Recording stopped";
    record.textContent = "Record again";
    record.disabled = false;
    record.classList.remove("is-recording");
    insert.hidden = true;
    insert.disabled = true;
    releaseMicrophone();
    if (recorder?.state === "recording") recorder.stop();
  }

  function updatePreview() {
    if (!result) return;
    try {
      const grid = root.querySelector('input[name="voice-grid"]:checked').value;
      code = voiceToPattern(result, {
        bpm: Number(tempo.value),
        gridSubdivision: grid ? Number(grid) : undefined,
      });
      preview.textContent = code;
      preview.hidden = false;
      insert.hidden = false;
      insert.disabled = false;
      error.textContent = "";
    } catch (err) {
      error.textContent = err.message;
      insert.disabled = true;
    }
  }

  async function transcribe(blob) {
    state = "transcribing";
    record.disabled = true;
    record.classList.remove("is-recording");
    record.textContent = "Transcribing…";
    status.textContent = "Finding notes…";
    audioUrl = URL.createObjectURL(blob);
    audio.src = audioUrl;
    audio.hidden = false;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${baseUrl}/api/voice/transcribe`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload.detail ||
            "The transcription service is unavailable. Check the backend configuration.",
        );
      if (closed) return;
      result = payload;
      state = "preview";
      updatePreview();
      status.textContent = `${payload.notes?.length ?? 0} notes detected · adjust tempo and quantization, then open the pattern`;
      record.textContent = "Record again";
      record.disabled = false;
      insert.focus();
    } catch (err) {
      if (!closed)
        fail(
          err.name === "AbortError"
            ? "Transcription timed out. Try a shorter recording."
            : err.name === "TypeError"
              ? "Cannot reach the transcription service. Check the voice backend and try again."
              : err.message,
        );
    } finally {
      clearTimeout(timeout);
    }
  }

  function stop() {
    if (state !== "recording") return;
    state = "stopping";
    record.disabled = true;
    recorder.stop();
    releaseMicrophone();
  }

  async function start() {
    state = "starting";
    record.disabled = true;
    record.textContent = "Starting…";
    error.textContent = "";
    status.textContent = "Checking transcription service…";
    preview.hidden = true;
    insert.hidden = true;
    audio.pause();
    audio.hidden = true;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;
    result = null;
    chunks = [];
    bytes = 0;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error(
          "Microphone recording requires HTTPS or localhost and a browser with MediaRecorder support.",
        );
      }
      const mimeType = MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType)
        throw new Error(
          "This browser does not support a compatible audio recording format.",
        );
      controller = new AbortController();
      const healthTimeout = setTimeout(() => controller.abort(), 10000);
      try {
        const health = await fetch(`${baseUrl}/api/voice/health`, {
          signal: controller.signal,
        });
        const payload = await health.json().catch(() => ({}));
        if (!health.ok || payload.ok !== true)
          throw new Error(
            "Start the voice backend or configure VITE_VOICE_API_URL to use voice capture.",
          );
      } finally {
        clearTimeout(healthTimeout);
      }
      if (closed) return;
      status.textContent = "Allow microphone access to begin…";
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (closed) {
        acquired.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = acquired;
      onStart?.();
      recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });
      const currentRecorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (closed || recorder !== currentRecorder || state === "error") return;
        bytes += data.size;
        if (bytes > MAX_BYTES) {
          fail("Recording exceeded 8 MB. Try a shorter phrase.");
          return;
        }
        if (data.size) chunks.push(data);
      };
      recorder.onerror = () => {
        if (!closed && recorder === currentRecorder)
          fail("Microphone recording failed. Try again.");
      };
      recorder.onstop = () => {
        if (recorder !== currentRecorder) return;
        releaseMicrophone();
        if (closed || state === "error") return;
        const blob = new Blob(chunks, { type: currentRecorder.mimeType });
        if (!blob.size) {
          fail("No audio was recorded. Try again.");
          return;
        }
        void transcribe(blob);
      };
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (state === "recording")
            fail(
              "Microphone disconnected. Record again after reconnecting it.",
            );
        };
      }
      recorder.start(250);
      state = "recording";
      record.textContent = "Stop & transcribe";
      record.disabled = false;
      record.classList.add("is-recording");
      const started = performance.now();
      const tick = () => {
        const elapsed = (performance.now() - started) / 1000;
        status.textContent = `Recording · ${Math.floor(elapsed)} / ${MAX_SECONDS}s`;
        if (elapsed >= MAX_SECONDS) stop();
      };
      tick();
      timer = setInterval(tick, 100);
      record.focus();
    } catch (err) {
      if (closed) return;
      const message =
        err.name === "NotAllowedError"
          ? "Microphone access was denied. Allow access in your browser and record again."
          : err.name === "NotFoundError"
            ? "No microphone found. Connect one and record again."
            : err.name === "TypeError" || err.name === "AbortError"
              ? "Cannot reach the voice backend. Start it or check VITE_VOICE_API_URL."
              : err.message;
      fail(message);
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === "Tab") {
      const focusable = [
        ...root.querySelectorAll(
          'button:not([disabled]), input, audio, [tabindex="0"]',
        ),
      ].filter((el) => !el.hidden && el.offsetParent !== null);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("pagehide", close);
  root.querySelector("[data-cancel]").onclick = close;
  root.onmousedown = (event) => {
    if (event.target === root) close();
  };
  record.onclick = () => (state === "recording" ? stop() : void start());
  tempo.oninput = updatePreview;
  root.querySelectorAll('[name="voice-grid"]').forEach((input) => {
    input.onchange = updatePreview;
  });
  insert.onclick = async () => {
    insert.disabled = true;
    record.disabled = true;
    try {
      if (await onInsert(code)) close();
      else
        error.textContent =
          "Could not save the pattern. Check browser storage and try again.";
    } catch (err) {
      error.textContent = err.message;
    } finally {
      if (!closed) {
        insert.disabled = false;
        record.disabled = false;
      }
    }
  };
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add("modal-overlay--open"));
  root.querySelector("[data-cancel]").focus();
  void start();
}
