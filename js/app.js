/* Ish Recorders — recording, live transcription, and library management. */
(() => {
  "use strict";

  // ---- Element refs ----
  const $ = (sel) => document.querySelector(sel);
  const recordBtn = $("#recordBtn");
  const pauseBtn = $("#pauseBtn");
  const stopBtn = $("#stopBtn");
  const statusDot = $("#statusDot");
  const statusText = $("#statusText");
  const timerEl = $("#timer");
  const sttBadge = $("#sttBadge");
  const liveTranscript = $("#liveTranscript");
  const visualizer = $("#visualizer");
  const listEl = $("#recordingList");
  const emptyState = $("#emptyState");
  const countEl = $("#count");
  const rowTemplate = $("#rowTemplate");

  // ---- State ----
  let mediaStream = null;
  let recorder = null;
  let chunks = [];
  let startTime = 0;
  let elapsedBeforePause = 0;
  let timerInterval = null;
  let recognition = null;
  let finalTranscript = "";
  let interimTranscript = "";
  let audioCtx = null;
  let analyser = null;
  let rafId = null;

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = Boolean(SpeechRecognition);

  // ---- Helpers ----
  function fmtTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function pickMime() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return "";
  }

  function extFor(mime) {
    if (mime.includes("webm")) return "webm";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("mp4")) return "m4a";
    return "audio";
  }

  function setStatus(state, text) {
    statusDot.className = `status-dot ${state}`;
    statusText.textContent = text;
  }

  // ---- Visualizer ----
  function startVisualizer(stream) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const ctx = visualizer.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      rafId = requestAnimationFrame(draw);
      const w = (visualizer.width = visualizer.clientWidth);
      const h = visualizer.height;
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#6c8cff";
      ctx.beginPath();
      const slice = w / data.length;
      let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128.0;
        const y = (v * h) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += slice;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
    draw();
  }

  function stopVisualizer() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    const ctx = visualizer.getContext("2d");
    ctx.clearRect(0, 0, visualizer.width, visualizer.height);
  }

  // ---- Speech recognition (live transcript) ----
  function setupRecognition() {
    if (!speechSupported) return;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    recognition.onresult = (e) => {
      interimTranscript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t + " ";
        else interimTranscript += t;
      }
      renderLive();
    };

    // Keep listening across the auto-stops the API does on silence.
    recognition.onend = () => {
      if (recorder && recorder.state === "recording") {
        try { recognition.start(); } catch (_) {}
      }
    };

    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        sttBadge.textContent = "mic blocked";
        sttBadge.className = "badge off";
      }
    };
  }

  function renderLive() {
    const html =
      (finalTranscript ? `<span>${escapeHtml(finalTranscript)}</span>` : "") +
      (interimTranscript ? `<span class="interim">${escapeHtml(interimTranscript)}</span>` : "");
    liveTranscript.innerHTML =
      html || '<span class="placeholder">Your speech will appear here as you talk…</span>';
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---- Timer ----
  function startTimer() {
    startTime = Date.now();
    timerInterval = setInterval(() => {
      timerEl.textContent = fmtTime(elapsedBeforePause + (Date.now() - startTime));
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // ---- Recording lifecycle ----
  async function startRecording() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      alert("Microphone access is required to record. Please allow it and try again.");
      return;
    }

    chunks = [];
    finalTranscript = "";
    interimTranscript = "";
    elapsedBeforePause = 0;
    renderLive();

    const mime = pickMime();
    recorder = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = finalizeRecording;
    recorder.start(250);

    if (recognition) { try { recognition.start(); } catch (_) {} }
    startVisualizer(mediaStream);
    startTimer();

    recordBtn.classList.add("is-recording");
    recordBtn.querySelector(".label").textContent = "Recording";
    recordBtn.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    setStatus("recording", "Recording…");
  }

  function pauseRecording() {
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      stopTimer();
      elapsedBeforePause += Date.now() - startTime;
      if (recognition) { try { recognition.stop(); } catch (_) {} }
      pauseBtn.textContent = "Resume";
      setStatus("paused", "Paused");
    } else if (recorder.state === "paused") {
      recorder.resume();
      startTimer();
      if (recognition) { try { recognition.start(); } catch (_) {} }
      pauseBtn.textContent = "Pause";
      setStatus("recording", "Recording…");
    }
  }

  function stopRecording() {
    if (!recorder) return;
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    recorder.stop();
    stopTimer();
    stopVisualizer();
    mediaStream.getTracks().forEach((t) => t.stop());

    recordBtn.classList.remove("is-recording");
    recordBtn.querySelector(".label").textContent = "Record";
    recordBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = "Pause";
    stopBtn.disabled = true;
    timerEl.textContent = "00:00";
    setStatus("idle", "Ready");
  }

  async function finalizeRecording() {
    const mime = recorder.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    const duration = elapsedBeforePause;
    const transcript = (finalTranscript + interimTranscript).trim();

    const record = {
      id: `rec_${Date.now()}`,
      title: `Recording ${fmtDate(Date.now())}`,
      createdAt: Date.now(),
      duration,
      mime,
      transcript,
      blob,
    };

    await RecordingsDB.add(record);
    renderRow(record, true);
    updateCount();
    liveTranscript.innerHTML =
      '<span class="placeholder">Your speech will appear here as you talk…</span>';
  }

  // ---- Library rendering ----
  function renderRow(record, prepend = false) {
    const node = rowTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = record.id;

    const titleEl = node.querySelector(".rec-title");
    const dateEl = node.querySelector(".rec-date");
    const durEl = node.querySelector(".rec-dur");
    const audioEl = node.querySelector(".rec-audio");
    const transcriptEl = node.querySelector(".rec-transcript");

    titleEl.value = record.title;
    dateEl.textContent = fmtDate(record.createdAt);
    durEl.textContent = fmtTime(record.duration);
    transcriptEl.value = record.transcript || "";

    const url = URL.createObjectURL(record.blob);
    audioEl.src = url;

    // Persist title / transcript edits.
    titleEl.addEventListener("change", () =>
      RecordingsDB.update(record.id, { title: titleEl.value.trim() || "Untitled" }));
    transcriptEl.addEventListener("change", () =>
      RecordingsDB.update(record.id, { transcript: transcriptEl.value }));

    // Actions
    node.querySelector(".act-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(transcriptEl.value);
        flash(node.querySelector(".act-copy"), "Copied");
      } catch (_) { alert("Copy failed — your browser blocked clipboard access."); }
    });

    node.querySelector(".act-audio").addEventListener("click", () => {
      download(url, `${safeName(titleEl.value)}.${extFor(record.mime)}`);
    });

    node.querySelector(".act-txt").addEventListener("click", () => {
      const txtBlob = new Blob([transcriptEl.value || "(no transcript)"], { type: "text/plain" });
      const txtUrl = URL.createObjectURL(txtBlob);
      download(txtUrl, `${safeName(titleEl.value)}.txt`);
      setTimeout(() => URL.revokeObjectURL(txtUrl), 1000);
    });

    node.querySelector(".act-delete").addEventListener("click", async () => {
      if (!confirm("Delete this recording? This can't be undone.")) return;
      await RecordingsDB.remove(record.id);
      URL.revokeObjectURL(url);
      node.remove();
      updateCount();
    });

    if (prepend) listEl.prepend(node);
    else listEl.appendChild(node);
  }

  function flash(btn, text) {
    const orig = btn.textContent;
    btn.textContent = text;
    setTimeout(() => (btn.textContent = orig), 1200);
  }

  function safeName(name) {
    return (name || "recording").replace(/[^\w\-]+/g, "_").slice(0, 60);
  }

  function download(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function updateCount() {
    const n = listEl.children.length;
    countEl.textContent = n;
    emptyState.style.display = n ? "none" : "block";
  }

  // ---- Init ----
  async function init() {
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      recordBtn.disabled = true;
      setStatus("idle", "Recording not supported in this browser");
    }

    if (speechSupported) {
      setupRecognition();
      sttBadge.textContent = "ready";
      sttBadge.className = "badge ok";
    } else {
      sttBadge.textContent = "unavailable";
      sttBadge.className = "badge off";
      liveTranscript.innerHTML =
        '<span class="placeholder">Live transcription needs Chrome or Edge. Audio recording still works.</span>';
    }

    recordBtn.addEventListener("click", startRecording);
    pauseBtn.addEventListener("click", pauseRecording);
    stopBtn.addEventListener("click", stopRecording);

    try {
      const records = await RecordingsDB.all();
      records.forEach((r) => renderRow(r));
    } catch (err) {
      console.error("Failed to load recordings", err);
    }
    updateCount();
  }

  init();
})();
