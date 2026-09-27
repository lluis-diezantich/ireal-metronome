/* chart.js - the chart model, repeat expansion, and rendering.
 *
 * A bar holds four chord slots (quarters of the measure), so one, two or
 * four changes per bar all land in the right horizontal position
 * regardless of the time signature.
 */
(function (global) {
  'use strict';

  var SLOTS = 4;

  function newBar(chords) {
    return {
      chords: (chords || ['', '', '', '']).slice(0, SLOTS),
      section: '',
      repOpen: false,
      repClose: false,
      repCount: 2,
      double: false
    };
  }

  function bar(text) {
    var b = newBar(parseBarInput(text || ''));
    return b;
  }

  function defaults() {
    var bars = ['F7', 'Bb7', 'F7', 'F7', 'Bb7', 'Bb7', 'F7', 'D7',
                'G-7', 'C7', 'F7 D7', 'G-7 C7'].map(bar);
    bars[0].section  = 'A';
    bars[0].repOpen  = true;
    bars[11].repClose = true;
    return {
      title: 'Blues in F',
      composer: '',
      style: 'Medium Swing',
      key: 'F',
      tempo: 130,
      timeSig: '4/4',
      countIn: 1,
      ramp: 0,
      loop: true,
      chordsOn: false,
      chordVol: 55,
      bars: bars
    };
  }

  function beatsPerBar(chart) {
    var n = parseInt(String(chart.timeSig).split('/')[0], 10);
    return n > 0 ? n : 4;
  }

  /* "G-7 C7" -> ['G-7','','C7','']   "F7 . . C7" -> ['F7','','','C7'] */
  function parseBarInput(str) {
    var slots = ['', '', '', ''];
    var toks = String(str || '').trim().split(/\s+/).filter(function (t) { return t.length; });
    if (!toks.length) return slots;

    if (String(str).indexOf('.') >= 0) {
      for (var i = 0; i < toks.length && i < SLOTS; i++) {
        slots[i] = toks[i] === '.' ? '' : toks[i];
      }
      return slots;
    }

    var spread = { 1: [0], 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };
    var where = spread[Math.min(toks.length, SLOTS)];
    for (var j = 0; j < where.length; j++) slots[where[j]] = toks[j];
    return slots;
  }

  function barToInput(b) {
    var c = b.chords, last = -1, i;
    for (i = 0; i < SLOTS; i++) if (c[i]) last = i;
    if (last < 0) return '';
    if (last === 2 && c[0] && !c[1] && c[2]) return c[0] + ' ' + c[2];
    var out = [];
    for (i = 0; i <= last; i++) out.push(c[i] || '.');
    return out.join(' ');
  }

  /* Chord slots -> when each one starts and how many beats it holds.
     One chord in the bar therefore lasts the whole bar. */
  function chordEvents(b, bpb) {
    var out = [];
    for (var k = 0; k < SLOTS; k++) {
      if (!b.chords[k]) continue;
      var at = Math.round(k * bpb / SLOTS);
      if (out.length && out[out.length - 1].beat === at) out[out.length - 1].text = b.chords[k];
      else out.push({ beat: at, text: b.chords[k] });
    }
    for (var i = 0; i < out.length; i++) {
      out[i].beats = (i + 1 < out.length ? out[i + 1].beat : bpb) - out[i].beat;
    }
    return out.filter(function (e) { return e.beats > 0; });
  }

  /* Which chord is sounding, given how far through the bar we are (0..1). */
  function activeSlot(b, frac) {
    var best = -1;
    for (var i = 0; i < SLOTS; i++) {
      if (b.chords[i] && i / SLOTS <= frac + 1e-9) best = i;
    }
    return best;
  }

  /* Expand repeat signs into a flat list of bar indices to play.
   * One level deep; a close with no matching open repeats from the top. */
  function playOrder(chart) {
    var order = [], passes = {}, openAt = 0, i = 0, guard = 0;
    var bars = chart.bars;
    if (!bars.length) return [0];

    while (i < bars.length && guard++ < 4096) {
      var b = bars[i];
      if (b.repOpen) openAt = i;
      order.push(i);

      if (b.repClose) {
        passes[i] = (passes[i] || 0) + 1;
        var times = Math.max(2, Math.min(8, b.repCount || 2));
        if (passes[i] < times) { i = openAt; continue; }
      }
      i++;
    }
    return order.length ? order : [0];
  }

  function render(chart, host, selected) {
    var bpb = beatsPerBar(chart);
    var sig = String(chart.timeSig).split('/');
    var html = '';

    for (var i = 0; i < chart.bars.length; i++) {
      var b = chart.bars[i];
      var cls = ['bar'];
      if (i === 0) cls.push('first');
      if (b.repOpen)  cls.push('rep-open');
      if (b.repClose) cls.push('rep-close');
      if (b.double)   cls.push('double');
      if (i === selected) cls.push('selected');

      html += '<div class="' + cls.join(' ') + '" data-i="' + i + '" role="gridcell" tabindex="-1">';
      html += '<i class="hl"></i>';
      if (b.section) html += '<span class="section">' + Chords.esc(b.section) + '</span>';
      if (i === 0) {
        html += '<span class="timesig">' + Chords.esc(sig[0] || '4') +
                '<br>' + Chords.esc(sig[1] || '4') + '</span>';
      }

      html += '<div class="slots">';
      for (var s = 0; s < SLOTS; s++) {
        html += '<div class="slot" data-s="' + s + '">' + Chords.render(b.chords[s]) + '</div>';
      }
      html += '</div>';

      html += '<div class="beats">';
      for (var k = 0; k < bpb; k++) html += '<span class="beat"></span>';
      html += '</div>';

      html += '</div>';
    }

    host.innerHTML = html;
  }

  /* Accept an imported object, filling in anything missing. */
  function sanitize(raw) {
    var d = defaults();
    if (!raw || typeof raw !== 'object') return d;
    var out = {
      title:    String(raw.title || ''),
      composer: String(raw.composer || ''),
      style:    String(raw.style || ''),
      key:      String(raw.key || ''),
      tempo:    Math.min(320, Math.max(30, parseInt(raw.tempo, 10) || 120)),
      timeSig:  /^\d{1,2}\/\d{1,2}$/.test(raw.timeSig) ? raw.timeSig : '4/4',
      countIn:  Math.min(2, Math.max(0, parseInt(raw.countIn, 10) || 0)),
      ramp:     Math.min(30, Math.max(0, parseInt(raw.ramp, 10) || 0)),
      loop:     raw.loop !== false,
      chordsOn: raw.chordsOn === true,
      chordVol: Math.min(100, Math.max(0, parseInt(raw.chordVol, 10) || 55)),
      bars:     []
    };
    var bars = Array.isArray(raw.bars) ? raw.bars : [];
    for (var i = 0; i < bars.length && i < 512; i++) {
      var s = bars[i] || {};
      var chords = Array.isArray(s.chords) ? s.chords : [];
      var b = newBar([0, 1, 2, 3].map(function (n) { return String(chords[n] || ''); }));
      b.section  = String(s.section || '').slice(0, 4);
      b.repOpen  = !!s.repOpen;
      b.repClose = !!s.repClose;
      b.repCount = Math.min(8, Math.max(2, parseInt(s.repCount, 10) || 2));
      b.double   = !!s.double;
      out.bars.push(b);
    }
    if (!out.bars.length) out.bars = [newBar()];
    return out;
  }

  global.Chart = {
    SLOTS: SLOTS,
    newBar: newBar,
    bar: bar,
    defaults: defaults,
    beatsPerBar: beatsPerBar,
    parseBarInput: parseBarInput,
    barToInput: barToInput,
    activeSlot: activeSlot,
    chordEvents: chordEvents,
    playOrder: playOrder,
    render: render,
    sanitize: sanitize
  };
})(window);
