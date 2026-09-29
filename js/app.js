/* app.js - wiring: transport, editing, playhead, persistence. */
(function () {
  'use strict';

  var STORE = 'irealMetronome.v1';
  var SONGS = 'irealMetronome.songs.v1';

  var $ = function (id) { return document.getElementById(id); };

  var chartEl   = $('chart');
  var playBtn   = $('play');
  var bpmEl     = $('bpm');
  var sliderEl  = $('bpmSlider');
  var statusEl  = $('status');
  var barEditor = $('barEditor');

  var chart    = load();
  var selected = 0;
  var editing  = null;
  var lastStep = null;
  var baseTempo = chart.tempo;
  var taps = [];
  var saveTimer = null;

  var metro = new Metronome();
  metro.getBpm = function () { return chart.tempo; };
  metro.getBeatsPerBar = function () { return Chart.beatsPerBar(chart); };
  metro.getBarChords = function (i) { return chart.bars[i]; };
  metro.getTranspose = function () { return chart.transpose; };

  metro.onPassEnd = function () {
    if (chart.ramp > 0) setTempo(chart.tempo + chart.ramp);
    metro.playOrder = Chart.playOrder(chart);
    return chart.loop;
  };

  metro.onStop = function () {
    playBtn.classList.remove('on');
    if (chart.ramp > 0) setTempo(baseTempo);
    lastStep = null;
    clearNow();
    statusEl.textContent = '';
  };

  /* ---------- persistence ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) return Chart.sanitize(JSON.parse(raw));
    } catch (e) { /* corrupt or unavailable: fall through */ }
    return Chart.defaults();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE, JSON.stringify(chart)); } catch (e) {}
    }, 250);
  }

  /* ---------- saved songs ----------
     A small library in localStorage. Each entry is a whole chart, so tempo,
     time signature, transpose and practice range come back with it. */

  function readSongs() {
    try {
      var list = JSON.parse(localStorage.getItem(SONGS) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeSongs(list) {
    try { localStorage.setItem(SONGS, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function libMsg(kind, text) {
    var el = $('libMsg');
    el.className = 'import-msg' + (kind ? ' ' + kind : '');
    el.textContent = text || '';
  }

  function indexOfName(list, name) {
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return i;
    return -1;
  }

  function renderSongList() {
    var list = readSongs();
    var ul = $('songList');
    if (!list.length) {
      ul.innerHTML = '<li class="song-empty">Nothing saved yet.</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var bars = (list[i].chart && list[i].chart.bars) ? list[i].chart.bars.length : 0;
      html += '<li class="song-row">' +
              '<button class="song-open" data-n="' + i + '">' +
                Chords.esc(list[i].name) + '</button>' +
              '<span class="song-meta">' + bars + ' bars</span>' +
              '<button class="song-del" data-n="' + i + '" ' +
                'aria-label="Delete ' + Chords.esc(list[i].name) + '">&times;</button>' +
              '</li>';
    }
    ul.innerHTML = html;
  }

  function saveSong() {
    var name = ($('songName').value || chart.title || 'Untitled').trim();
    if (!name) { libMsg('bad', 'give it a name'); return; }

    var list = readSongs();
    var at = indexOfName(list, name);
    if (at >= 0 && !window.confirm('Replace the saved song "' + name + '"?')) return;

    var entry = { name: name, savedAt: Date.now(), chart: JSON.parse(JSON.stringify(chart)) };
    if (at >= 0) list[at] = entry; else list.push(entry);
    list.sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });

    if (!writeSongs(list)) {
      libMsg('bad', 'could not save \u2014 storage full or blocked');
      return;
    }
    renderSongList();
    libMsg('ok', 'saved \u201c' + name + '\u201d');
  }

  function openSong(n) {
    var entry = readSongs()[n];
    if (!entry) return;
    if (!confirmReplace()) return;

    /* the song carries its own tempo and layout; muting is about your
       speakers, not the song, so that stays as you have it */
    var keepOn = chart.chordsOn, keepVol = chart.chordVol;
    chart = Chart.sanitize(entry.chart);
    chart.chordsOn = keepOn;
    chart.chordVol = keepVol;

    selected = 0;
    syncAll();
    $('songName').value = entry.name;
    $('libraryBar').hidden = true;
    statusEl.textContent = 'loaded \u201c' + entry.name + '\u201d';
  }

  function deleteSong(n) {
    var list = readSongs();
    if (!list[n]) return;
    if (!window.confirm('Delete \u201c' + list[n].name + '\u201d? This cannot be undone.')) return;
    list.splice(n, 1);
    writeSongs(list);
    renderSongList();
    libMsg('', '');
  }

  $('songs').addEventListener('click', function () {
    var bar = $('libraryBar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) {
      libMsg('', '');
      if (!$('songName').value) $('songName').value = chart.title || '';
      renderSongList();
      $('songName').focus();
    }
  });
  $('libClose').addEventListener('click', function () { $('libraryBar').hidden = true; });
  $('songSave').addEventListener('click', saveSong);
  $('songName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); saveSong(); }
    else if (e.key === 'Escape') { $('libraryBar').hidden = true; }
  });
  $('songList').addEventListener('click', function (e) {
    var t = e.target;
    if (!t.dataset || t.dataset.n === undefined) return;
    var n = parseInt(t.dataset.n, 10);
    if (t.classList.contains('song-open')) openSong(n);
    else if (t.classList.contains('song-del')) deleteSong(n);
  });

  /* ---------- rendering ---------- */

  function barAt(i) { return chartEl.querySelector('.bar[data-i="' + i + '"]'); }

  /* Chords are stored at concert pitch; the transpose offset is applied for
     display and for the piano. Editing happens in the key you can see, so
     what comes out of a field is shifted back before it is stored. */
  function barInputDisplay(b) {
    if (!chart.transpose) return Chart.barToInput(b);
    return Chart.barToInput({
      chords: b.chords.map(function (c) { return Chords.transpose(c, chart.transpose); })
    });
  }

  function barChordsFromInput(str) {
    var slots = Chart.parseBarInput(str);
    if (!chart.transpose) return slots;
    return slots.map(function (c) { return Chords.transpose(c, -chart.transpose); });
  }

  function keyDisplay() { return Chords.transpose(chart.key, chart.transpose); }

  /* --- practice range --- */

  function syncLoopChip() {
    var r = Chart.loopRange(chart);
    $('loopChip').hidden = !r;
    if (r) {
      $('loopChipText').textContent = r.from === r.to
        ? 'bar ' + (r.from + 1)
        : 'bars ' + (r.from + 1) + '\u2013' + (r.to + 1);
    }
  }

  function setLoopRange(from, to) {
    chart.loopFrom = from;
    chart.loopTo = to;

    /* take effect straight away rather than at the end of the pass */
    if (metro.running) {
      metro.playOrder = Chart.playOrder(chart);
      if (metro.pos >= metro.playOrder.length) metro.pos = 0;
    }
    refresh();
    syncLoopChip();
  }

  function refresh() {
    Chart.render(chart, chartEl, selected);
    if (lastStep) paintNow(lastStep, true);
    save();
  }

  function clearNow() {
    var drop = function (sel, cls) {
      var list = chartEl.querySelectorAll(sel);
      for (var i = 0; i < list.length; i++) list[i].classList.remove(cls);
    };
    drop('.bar.now', 'now');
    drop('.bar.counting', 'counting');
    drop('.hl.pulse', 'pulse');
    drop('.beat.on', 'on');
    drop('.chord.active', 'active');
  }

  /* Restart the pulse animation; the reflow between remove and add is
     what makes it replay rather than sit at its end state. */
  function pulse(barEl) {
    var hl = barEl.querySelector('.hl');
    if (!hl) return;
    hl.classList.remove('pulse');
    void hl.offsetWidth;
    hl.classList.add('pulse');
  }

  function paintNow(step, force) {
    if (!force && lastStep === step) return;

    clearNow();

    if (step.countIn) {
      statusEl.textContent = 'count-in ' + step.remaining;

      /* Pulse the measure the count-in is leading into, filling its beat
         dots, so the playhead arrives rather than appearing from nowhere. */
      var lead = barAt(step.upcoming);
      if (!lead) return;
      lead.classList.add('counting');
      var dots = lead.querySelectorAll('.beat');
      for (var i = 0; i <= step.beat && i < dots.length; i++) {
        dots[i].classList.add('on');
      }
      pulse(lead);
      return;
    }

    var el = barAt(step.barIndex);
    if (!el) return;
    el.classList.add('now');
    statusEl.textContent = 'm.' + (step.barIndex + 1);

    var dot = el.querySelectorAll('.beat')[step.beat];
    if (dot) dot.classList.add('on');

    var bar = chart.bars[step.barIndex];
    var slot = Chart.activeSlot(bar, step.beat / Chart.beatsPerBar(chart));
    if (slot >= 0) {
      var chord = el.querySelector('.slot[data-s="' + slot + '"] .chord');
      if (chord) chord.classList.add('active');
    }
  }

  /* Runs only while playing, so the page goes idle when stopped. */
  function frame() {
    if (!metro.running) return;
    var s = metro.current();
    if (s) { paintNow(s); lastStep = s; }
    requestAnimationFrame(frame);
  }

  /* ---------- selection and the measure editor ---------- */

  function select(i) {
    selected = Math.max(0, Math.min(chart.bars.length - 1, i));
    var prev = chartEl.querySelector('.bar.selected');
    if (prev) prev.classList.remove('selected');
    var el = barAt(selected);
    if (el) el.classList.add('selected');
    barEditor.hidden = false;
    syncBarEditor();
  }

  function syncBarEditor() {
    var b = chart.bars[selected];
    if (!b) return;
    $('beNum').textContent  = String(selected + 1);
    $('beChords').value     = barInputDisplay(b);
    $('beSection').value    = b.section;
    $('beRepOpen').checked  = b.repOpen;
    $('beRepClose').checked = b.repClose;
    $('beRepCount').value   = b.repCount;
    $('beDouble').checked   = b.double;
  }

  function openInline(i) {
    closeInline();
    var el = barAt(i);
    if (!el) return;
    var slots = el.querySelector('.slots');
    var input = document.createElement('input');
    input.className = 'bar-input';
    input.value = barInputDisplay(chart.bars[i]);
    input.setAttribute('aria-label', 'Chords for measure ' + (i + 1));
    slots.innerHTML = '';
    slots.appendChild(input);

    editing = { i: i, input: input };
    input.addEventListener('keydown', onInlineKey);
    input.addEventListener('blur', function () { commitInline(0); });
    input.focus();
    input.select();
  }

  function closeInline() {
    if (!editing) return;
    editing = null;
    refresh();
  }

  function commitInline(move) {
    if (!editing) return;
    var i = editing.i, value = editing.input.value;
    editing = null;

    chart.bars[i].chords = barChordsFromInput(value);
    refresh();
    syncBarEditor();

    if (move) {
      var j = i + move;
      if (j >= 0 && j < chart.bars.length) { select(j); openInline(j); }
    }
  }

  function onInlineKey(e) {
    if (e.key === 'Enter')       { e.preventDefault(); commitInline(1); }
    else if (e.key === 'Tab')    { e.preventDefault(); commitInline(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); closeInline(); }
  }

  chartEl.addEventListener('mousedown', function (e) {
    if (inFocus()) { e.preventDefault(); togglePlay(); return; }
    var el = e.target.closest ? e.target.closest('.bar') : null;
    if (!el || (editing && editing.input === e.target)) return;
    var i = parseInt(el.dataset.i, 10);

    /* a section letter grabs that whole section as the practice range */
    if (e.target.classList && e.target.classList.contains('section')) {
      e.preventDefault();
      commitInline(0);           /* setLoopRange re-renders; save any open edit */
      var sec = Chart.sectionRange(chart, i);
      setLoopRange(sec.from, sec.to);
      return;
    }

    /* shift-click extends a range from the selected bar */
    if (e.shiftKey) {
      e.preventDefault();
      commitInline(0);
      setLoopRange(Math.min(selected, i), Math.max(selected, i));
      return;
    }

    if (editing && editing.i === i) return;
    e.preventDefault();          /* keep focus handling predictable */
    select(i);
    openInline(i);
  });

  $('loopClear').addEventListener('click', function () { setLoopRange(null, null); });

  /* ---------- transport ---------- */

  function setTempo(v) {
    var n = Math.round(Math.max(30, Math.min(320, v || 0)));
    if (!n) return;
    chart.tempo = n;
    bpmEl.value = n;
    sliderEl.value = n;
    save();
  }

  function togglePlay() {
    if (metro.running) { metro.stop(); return; }
    baseTempo = chart.tempo;
    metro.setVolume($('vol').value / 100);
    metro.setChordVolume(chart.chordVol / 100);
    metro.chordsOn = chart.chordsOn;
    if (!metro.start(Chart.playOrder(chart), chart.countIn)) {
      statusEl.textContent = 'no audio';
      return;
    }
    playBtn.classList.add('on');
    requestAnimationFrame(frame);
  }

  function tapTempo() {
    var now = (window.performance || Date).now();
    if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      var span = taps[taps.length - 1] - taps[0];
      setTempo(60000 / (span / (taps.length - 1)));
    }
  }

  playBtn.addEventListener('click', togglePlay);
  $('bpmUp').addEventListener('click',   function () { setTempo(chart.tempo + 1); });
  $('bpmDown').addEventListener('click', function () { setTempo(chart.tempo - 1); });
  $('tap').addEventListener('click', tapTempo);
  bpmEl.addEventListener('change',   function () { setTempo(parseInt(bpmEl.value, 10)); });
  sliderEl.addEventListener('input', function () { setTempo(parseInt(sliderEl.value, 10)); });

  $('timeSig').addEventListener('change', function () {
    chart.timeSig = this.value;
    refresh();
  });
  $('transpose').addEventListener('change', function () {
    chart.transpose = parseInt(this.value, 10) || 0;
    $('fKey').value = keyDisplay();
    refresh();
    syncBarEditor();
  });
  $('countIn').addEventListener('change', function () {
    chart.countIn = parseInt(this.value, 10) || 0;
    save();
  });
  $('ramp').addEventListener('change', function () {
    chart.ramp = Math.max(0, Math.min(30, parseInt(this.value, 10) || 0));
    this.value = chart.ramp;
    save();
  });
  $('loop').addEventListener('change', function () {
    chart.loop = this.checked;
    save();
  });
  $('vol').addEventListener('input', function () {
    metro.setVolume(this.value / 100);
  });
  $('chords').addEventListener('change', function () {
    chart.chordsOn = this.checked;
    metro.chordsOn = this.checked;
    save();
  });
  $('chordVol').addEventListener('input', function () {
    chart.chordVol = parseInt(this.value, 10) || 0;
    metro.setChordVolume(chart.chordVol / 100);
    save();
  });

  /* ---------- head fields ---------- */

  $('fKey').addEventListener('input', function () {
    chart.key = chart.transpose ? Chords.transpose(this.value, -chart.transpose) : this.value;
    save();
  });

  [['fTitle', 'title'], ['fComposer', 'composer'], ['fStyle', 'style']]
    .forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () {
        chart[pair[1]] = this.value;
        save();
      });
    });

  /* ---------- measure editor controls ---------- */

  $('beChords').addEventListener('change', function () {
    chart.bars[selected].chords = barChordsFromInput(this.value);
    refresh();
  });
  $('beSection').addEventListener('input', function () {
    chart.bars[selected].section = this.value.slice(0, 4);
    refresh();
  });
  $('beRepOpen').addEventListener('change', function () {
    chart.bars[selected].repOpen = this.checked;
    refresh();
  });
  $('beRepClose').addEventListener('change', function () {
    chart.bars[selected].repClose = this.checked;
    refresh();
  });
  $('beRepCount').addEventListener('change', function () {
    var n = Math.max(2, Math.min(8, parseInt(this.value, 10) || 2));
    this.value = n;
    chart.bars[selected].repCount = n;
    save();
  });
  $('beDouble').addEventListener('change', function () {
    chart.bars[selected].double = this.checked;
    refresh();
  });
  $('beInsert').addEventListener('click', function () {
    chart.bars.splice(selected + 1, 0, Chart.newBar());
    refresh();
    select(selected + 1);
  });
  $('beDelete').addEventListener('click', function () {
    if (chart.bars.length <= 1) return;
    chart.bars.splice(selected, 1);
    if (Chart.loopRange(chart)) { chart.loopFrom = null; chart.loopTo = null; syncLoopChip(); }
    if (selected >= chart.bars.length) selected = chart.bars.length - 1;
    refresh();
    select(selected);
  });

  $('addBar').addEventListener('click', function () {
    chart.bars.push(Chart.newBar());
    refresh();
    select(chart.bars.length - 1);
  });
  $('addFour').addEventListener('click', function () {
    for (var i = 0; i < 4; i++) chart.bars.push(Chart.newBar());
    refresh();
    select(chart.bars.length - 4);
  });

  /* ---------- import, export ---------- */

  function inFocus() { return document.body.classList.contains('focus-mode'); }

  function setFocus(on) {
    if (on) document.body.classList.add('focus-mode');
    else document.body.classList.remove('focus-mode');
    $('focusExit').hidden = !on;
    if (on) { $('importBar').hidden = true; $('libraryBar').hidden = true; }
  }

  $('focus').addEventListener('click', function () { setFocus(true); });
  $('focusExit').addEventListener('click', function () { setFocus(false); });

  $('export').addEventListener('click', function () {
    var name = (chart.title || 'chart').replace(/[^\w\- ]+/g, '').trim() || 'chart';
    var blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  /* Importing replaces the one chart we hold, so ask before discarding work. */
  function hasChordContent() {
    for (var i = 0; i < chart.bars.length; i++) {
      for (var k = 0; k < Chart.SLOTS; k++) if (chart.bars[i].chords[k]) return true;
    }
    return false;
  }

  function confirmReplace() {
    return !hasChordContent() ||
      window.confirm('Replace the current chart? Export it first if you want to keep it.');
  }

  function loadIReal() {
    var msg = $('irealMsg');
    var res = null;
    try { res = IReal.parse($('irealUrl').value); } catch (e) { res = null; }

    if (!res) {
      msg.className = 'import-msg bad';
      msg.textContent = 'not an irealb:// link';
      return;
    }
    if (!confirmReplace()) return;

    /* the link supplies the song; playback preferences stay the user's */
    var song = res.songs[0];
    var keep = ['countIn', 'ramp', 'loop', 'chordsOn', 'chordVol'];
    var prefs = {};
    for (var i = 0; i < keep.length; i++) prefs[keep[i]] = chart[keep[i]];

    chart = IReal.toChart(song);
    for (var k = 0; k < keep.length; k++) chart[keep[k]] = prefs[keep[k]];

    selected = 0;
    syncAll();

    var notes = [];
    if (res.songs.length > 1) notes.push('loaded song 1 of ' + res.songs.length);
    if (song.unsupported.length) notes.push('not supported: ' + song.unsupported.join(', '));
    $('irealUrl').value = '';

    /* A clean import closes the bar; one with something to read stays open. */
    if (notes.length) {
      msg.className = 'import-msg';
      msg.textContent = notes.join(' \u2014 ');
    } else {
      msg.textContent = '';
      $('importBar').hidden = true;
      statusEl.textContent = 'loaded ' + chart.bars.length + ' bars';
    }
  }

  $('ireal').addEventListener('click', function () {
    var bar = $('importBar');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) {
      $('libraryBar').hidden = true;
      $('irealMsg').textContent = '';
      $('irealUrl').focus();
    }
  });
  $('irealLoad').addEventListener('click', loadIReal);
  $('irealCancel').addEventListener('click', function () {
    $('importBar').hidden = true;
    $('irealUrl').value = '';
  });
  $('irealUrl').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); loadIReal(); }
    else if (e.key === 'Escape') { $('importBar').hidden = true; }
  });

  $('importBtn').addEventListener('click', function () { $('importFile').click(); });

  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var next = Chart.sanitize(JSON.parse(reader.result));
        if (!confirmReplace()) return;
        chart = next;
        selected = 0;
        syncAll();
      } catch (e) {
        statusEl.textContent = 'bad file';
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  /* ---------- keyboard ---------- */

  /* Somewhere a space is a real character: a chord field, a song name, a
     title. Anywhere else — number boxes, dropdowns, sliders, checkboxes,
     the page itself — space means play. */
  function isTextField(t) {
    if (!t) return false;
    if (t.tagName === 'TEXTAREA') return true;
    if (t.tagName !== 'INPUT') return false;
    var type = (t.getAttribute('type') || 'text').toLowerCase();
    return type === 'text' || type === 'search' || type === 'url' ||
           type === 'email' || type === 'password' || type === 'tel';
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

    if (e.code === 'Space' && !isTextField(t)) { e.preventDefault(); togglePlay(); return; }
    if (typing) return;

    if (e.key === 'Escape') {
      if (!$('importBar').hidden)  { $('importBar').hidden = true; return; }
      if (!$('libraryBar').hidden) { $('libraryBar').hidden = true; return; }
      if (inFocus()) { setFocus(false); return; }
    }

    if (e.key === 'ArrowRight' && e.shiftKey) {
      var rr = Chart.loopRange(chart);
      setLoopRange(rr ? rr.from : selected,
                   Math.min(chart.bars.length - 1, (rr ? rr.to : selected) + 1));
    }
    else if (e.key === 'ArrowLeft' && e.shiftKey) {
      var rl = Chart.loopRange(chart);
      if (rl) setLoopRange(rl.from, Math.max(rl.from, rl.to - 1));
    }
    else if (e.key === 'ArrowRight')      { select(selected + 1); }
    else if (e.key === 'ArrowLeft')  { select(selected - 1); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); setTempo(chart.tempo + 1); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); setTempo(chart.tempo - 1); }
    else if (e.key === 'Enter')      { if (!inFocus()) { e.preventDefault(); openInline(selected); } }
    else if (e.key === 't' || e.key === 'T') { tapTempo(); }
  });

  /* ---------- boot ---------- */

  function syncAll() {
    $('fTitle').value    = chart.title;
    $('fComposer').value = chart.composer;
    $('fStyle').value    = chart.style;
    $('fKey').value      = keyDisplay();
    $('timeSig').value   = chart.timeSig;
    $('transpose').value = String(chart.transpose);
    syncLoopChip();
    $('countIn').value   = String(chart.countIn);
    $('ramp').value      = String(chart.ramp);
    $('loop').checked    = chart.loop;
    $('chords').checked  = chart.chordsOn;
    $('chordVol').value  = String(chart.chordVol);
    setTempo(chart.tempo);
    refresh();
    select(selected);
  }

  (function buildTransposeOptions() {
    var sel = $('transpose'), html = '';
    for (var n = -6; n <= 6; n++) {
      var label = n === 0 ? '0' : (n > 0 ? '+' + n : '\u2212' + Math.abs(n));
      html += '<option value="' + n + '">' + label + '</option>';
    }
    sel.innerHTML = html;
  })();

  syncAll();
})();
