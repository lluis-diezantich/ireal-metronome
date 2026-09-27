/* app.js - wiring: transport, editing, playhead, persistence. */
(function () {
  'use strict';

  var STORE = 'irealMetronome.v1';
  var THEME = 'irealMetronome.theme';

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

  /* ---------- rendering ---------- */

  function barAt(i) { return chartEl.querySelector('.bar[data-i="' + i + '"]'); }

  function refresh() {
    Chart.render(chart, chartEl, selected);
    if (lastStep) paintNow(lastStep, true);
    save();
  }

  function clearNow() {
    var el = chartEl.querySelector('.bar.now');
    if (el) el.classList.remove('now');
    var on = chartEl.querySelector('.beat.on');
    if (on) on.classList.remove('on');
    var act = chartEl.querySelector('.chord.active');
    if (act) act.classList.remove('active');
  }

  function paintNow(step, force) {
    if (!force && lastStep === step) return;

    clearNow();

    if (step.countIn) {
      statusEl.textContent = 'count-in ' + step.remaining;
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
    $('beChords').value     = Chart.barToInput(b);
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
    input.value = Chart.barToInput(chart.bars[i]);
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

    chart.bars[i].chords = Chart.parseBarInput(value);
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
    var el = e.target.closest ? e.target.closest('.bar') : null;
    if (!el || (editing && editing.input === e.target)) return;
    var i = parseInt(el.dataset.i, 10);
    if (editing && editing.i === i) return;
    e.preventDefault();          /* keep focus handling predictable */
    select(i);
    openInline(i);
  });

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

  /* ---------- head fields ---------- */

  [['fTitle', 'title'], ['fComposer', 'composer'], ['fStyle', 'style'], ['fKey', 'key']]
    .forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () {
        chart[pair[1]] = this.value;
        save();
      });
    });

  /* ---------- measure editor controls ---------- */

  $('beChords').addEventListener('change', function () {
    chart.bars[selected].chords = Chart.parseBarInput(this.value);
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

  /* ---------- theme, import, export ---------- */

  function setTheme(name) {
    document.body.dataset.theme = name;
    $('theme').textContent = name === 'dark' ? 'Paper' : 'Dark';
    try { localStorage.setItem(THEME, name); } catch (e) {}
  }

  $('theme').addEventListener('click', function () {
    setTheme(document.body.dataset.theme === 'dark' ? 'paper' : 'dark');
  });

  $('export').addEventListener('click', function () {
    var name = (chart.title || 'chart').replace(/[^\w\- ]+/g, '').trim() || 'chart';
    var blob = new Blob([JSON.stringify(chart, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('importBtn').addEventListener('click', function () { $('importFile').click(); });

  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        chart = Chart.sanitize(JSON.parse(reader.result));
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

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

    if (e.code === 'Space' && !typing) { e.preventDefault(); togglePlay(); return; }
    if (typing) return;

    if (e.key === 'ArrowRight')      { select(selected + 1); }
    else if (e.key === 'ArrowLeft')  { select(selected - 1); }
    else if (e.key === 'ArrowUp')    { e.preventDefault(); setTempo(chart.tempo + 1); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); setTempo(chart.tempo - 1); }
    else if (e.key === 'Enter')      { e.preventDefault(); openInline(selected); }
    else if (e.key === 't' || e.key === 'T') { tapTempo(); }
  });

  /* ---------- boot ---------- */

  function syncAll() {
    $('fTitle').value    = chart.title;
    $('fComposer').value = chart.composer;
    $('fStyle').value    = chart.style;
    $('fKey').value      = chart.key;
    $('timeSig').value   = chart.timeSig;
    $('countIn').value   = String(chart.countIn);
    $('ramp').value      = String(chart.ramp);
    $('loop').checked    = chart.loop;
    setTempo(chart.tempo);
    refresh();
    select(selected);
  }

  try { setTheme(localStorage.getItem(THEME) === 'dark' ? 'dark' : 'paper'); }
  catch (e) { setTheme('paper'); }

  syncAll();
})();
