/* piano.js - chord text -> synthesized piano notes.
 *
 * No samples: each note is a triangle fundamental plus a few sine partials,
 * through a lowpass that closes as the note decays. That gives a struck,
 * piano-ish envelope rather than an organ drone.
 */
(function (global) {
  'use strict';

  var SHARP = '♯', FLAT = '♭', TRI = '△', HDIM = 'ø', DIM = '°';
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  /* semitones above the root, keyed by quality + extension as chords.js emits */
  var SHAPES = {
    '':            [0, 4, 7],
    '5':           [0, 7],
    '2':           [0, 2, 7],
    '6':           [0, 4, 7, 9],
    '6/9':         [0, 4, 7, 9, 14],
    '7':           [0, 4, 7, 10],
    '9':           [0, 4, 7, 10, 14],
    '11':          [0, 7, 10, 14, 17],
    '13':          [0, 4, 7, 10, 14, 21],
    '7alt':        [0, 4, 8, 10, 13],
    'sus4':        [0, 5, 7],
    'sus2':        [0, 2, 7],
    '7sus4':       [0, 5, 7, 10],
    '9sus4':       [0, 5, 7, 10, 14],
    '13sus4':      [0, 5, 7, 10, 14, 21],
    '+':           [0, 4, 8],
    '-':           [0, 3, 7],
    '-6':          [0, 3, 7, 9],
    '-6/9':        [0, 3, 7, 9, 14],
    '-7':          [0, 3, 7, 10],
    '-9':          [0, 3, 7, 10, 14],
    '-11':         [0, 3, 7, 10, 14, 17],
    '-13':         [0, 3, 7, 10, 14, 21]
  };

  /* glyph keys must be assigned, not written as object literal keys */
  SHAPES['-' + TRI + '7'] = [0, 3, 7, 11];
  SHAPES[TRI + '7']       = [0, 4, 7, 11];
  SHAPES[TRI + '9']       = [0, 4, 7, 11, 14];
  SHAPES[TRI + '13']      = [0, 4, 7, 11, 14, 21];
  SHAPES[HDIM + '7']      = [0, 3, 6, 10];
  SHAPES[DIM]             = [0, 3, 6];
  SHAPES[DIM + '7']       = [0, 3, 6, 9];

  function swap(list, from, to) {
    return list.map(function (n) { return n === from ? to : n; });
  }

  function pitchClass(letter, acc) {
    var n = PC[letter];
    if (n === undefined) return 0;
    if (acc === SHARP) n += 1;
    else if (acc === FLAT) n -= 1;
    return (n + 12) % 12;
  }

  function intervals(c) {
    var base = SHAPES[(c.qual || '') + (c.ext || '')] || SHAPES[c.qual || ''] || [0, 4, 7];
    base = base.slice();

    for (var i = 0; i < c.alts.length; i++) {
      var a = c.alts[i];
      if (a === FLAT + '5')        base = swap(base, 7, 6);
      else if (a === SHARP + '5')  base = swap(base, 7, 8);
      else if (a === FLAT + '9')   base.push(13);
      else if (a === SHARP + '9')  base.push(15);
      else if (a === SHARP + '11') base.push(18);
      else if (a === FLAT + '13')  base.push(20);
      else if (/^add9$/i.test(a))  base.push(14);
      else if (/^add11$/i.test(a)) base.push(17);
      else if (/^add13$/i.test(a)) base.push(21);
    }
    return base;
  }

  /* text -> {bass, notes} as MIDI numbers, or null if nothing should sound */
  function voice(text) {
    var c = global.Chords.parse(text);
    if (!c || c.special) return null;      /* %, N.C. and unparsed stay silent */

    var pc = pitchClass(c.root, c.acc);
    var start = 60 + pc;
    if (pc > 6) start -= 12;               /* keep the voicing near middle C */

    var bassPc = pc;
    if (c.bass) {
      var m = c.bass.match(/^([A-G])(.*)$/);
      if (m) {
        var acc = m[2].indexOf(SHARP) >= 0 ? SHARP : (m[2].indexOf(FLAT) >= 0 ? FLAT : '');
        bassPc = pitchClass(m[1], acc);
      }
    }

    return {
      bass: 36 + bassPc,
      notes: intervals(c).map(function (n) { return start + n; })
    };
  }

  function note(ctx, dest, midi, t, dur, vel) {
    var f = 440 * Math.pow(2, (midi - 69) / 12);

    var amp = ctx.createGain();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(7000, f * 9), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(480, f * 2.4), t + 0.55);
    lp.connect(amp);
    amp.connect(dest);

    /* high notes die away faster, as on a real instrument */
    var decay = Math.max(0.8, 3.4 - (midi - 48) * 0.038);
    var knee = Math.min(dur, decay) * 0.45;

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.007);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.28), t + knee);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);

    var parts = [['triangle', 1, 1], ['sine', 2, 0.28], ['sine', 3, 0.09],
                 ['triangle', 1.002, 0.34]];
    var stop = t + dur + 0.45;
    for (var i = 0; i < parts.length; i++) {
      var o = ctx.createOscillator();
      o.type = parts[i][0];
      o.frequency.value = f * parts[i][1];
      var g = ctx.createGain();
      g.gain.value = parts[i][2];
      o.connect(g);
      g.connect(lp);
      o.start(t);
      o.stop(stop);
    }
  }

  function play(ctx, dest, text, t, dur, vel) {
    var v = voice(text);
    if (!v) return;
    var midis = [v.bass];
    for (var i = 0; i < v.notes.length; i++) {
      if (midis.indexOf(v.notes[i]) < 0) midis.push(v.notes[i]);
    }
    /* a few ms between notes reads as a hand, not a machine */
    for (var k = 0; k < midis.length; k++) {
      note(ctx, dest, midis[k], t + k * 0.006, dur,
           (vel || 0.5) * (k === 0 ? 0.85 : 0.7));
    }
  }

  global.Piano = { voice: voice, play: play };
})(window);
