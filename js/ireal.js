/* ireal.js - import a single song from a pasted irealb:// URL.
 *
 * The URL format is undocumented by the vendor and was reverse-engineered by
 * others. The de-obfuscation step and the token vocabulary below follow the
 * MIT-licensed pianosnake/ireal-reader, which credits ironss/accompaniser.
 * This is an independent implementation targeting our own chart model: it
 * keeps repeats as barline markers instead of expanding them into bars.
 */
(function (global) {
  'use strict';

  var PREFIX = '1r34LbKcu7';

  var TIME_SIGS = {
    '22': '2/2', '32': '3/2', '24': '2/4', '34': '3/4', '44': '4/4',
    '54': '5/4', '64': '6/4', '74': '7/4', '58': '5/8', '68': '6/8',
    '78': '7/8', '98': '9/8', '12': '12/8'
  };

  /* The body is obfuscated in 50-character blocks: within each block the
     characters at 0-4 and 10-23 are swapped with their mirror positions.
     The final short block is left alone. Swapping is its own inverse. */
  function unscramble(s) {
    var out = '', block;
    while (s.length > 50) {
      block = s.substring(0, 50);
      s = s.substring(50);
      out += (s.length < 2) ? block : swapBlock(block);
    }
    return out + s;
  }

  function swapBlock(s) {
    var a = s.split(''), i;
    for (i = 0; i < 5; i++)  { a[i] = s[49 - i]; a[49 - i] = s[i]; }
    for (i = 10; i < 24; i++) { a[i] = s[49 - i]; a[49 - i] = s[i]; }
    return a.join('');
  }

  var CHORD = /^[A-GW][+\-^\dhob#suadltn]*(?:\/[A-G][#b]?)?/;

  /* Read the token stream into bars of our own shape. */
  function readBody(body) {
    var bars = [];
    var cur = blank();
    var timeSig = null;
    var lastChord = null;
    var unsupported = {};
    var pendingCopies = [];    /* upcoming bars that copy an earlier one */
    var pendingRepCount = 0;   /* "3x" style repeat count from a comment */
    var s = body;
    var guard = 0;

    /* A bar with no cells at all is a formatting artifact, not a measure.
       One with cells but no chords is a real empty bar, so it is kept.
       A bar owed by an r or Kcl commits even with no cells of its own,
       because those symbols stand in for the chords. */
    function boundary() {
      if (cur.cells > 0 || pendingCopies.length) {
        if (pendingCopies.length) {
          var back = pendingCopies.shift();
          if (bars.length >= back) cur.chords = bars[bars.length - back].chords.slice();
        }
        bars.push(cur);
        cur = blank();
      }
    }

    /* Comments carry a two-digit position prefix: <*163x> is the text "3x". */
    function readComment(inner) {
      var text = String(inner).replace(/^\*\d\d/, '');
      var rep = text.match(/^(\d+)x$/i);
      if (rep) { pendingRepCount = parseInt(rep[1], 10); return; }
      noteUnsupported(unsupported, text);
    }

    function eat(n) { s = s.substring(n).replace(/^\s+/, ''); }

    while (s.length && guard++ < 20000) {
      var m;

      if (s.indexOf('XyQ') === 0)  { cur.cells++; eat(3); continue; }
      if (s.indexOf('LZ') === 0)   { boundary(); eat(2); continue; }

      /* Kcl repeats the previous measure as a new one */
      if (s.indexOf('Kcl') === 0)  { boundary(); pendingCopies.push(1); eat(3); continue; }

      if ((m = s.match(/^\*(\w)/)))      { cur.section = m[1].toUpperCase(); eat(m[0].length); continue; }
      if ((m = s.match(/^T(\d\d)/)))     { timeSig = TIME_SIGS[m[1]] || timeSig; eat(m[0].length); continue; }
      if ((m = s.match(/^<(.*?)>/)))     { readComment(m[1]); eat(m[0].length); continue; }
      if ((m = s.match(/^N(\d)/)))       { unsupported['numbered endings'] = true; eat(m[0].length); continue; }
      if ((m = s.match(/^Y+/)))          { eat(m[0].length); continue; }

      switch (s.charAt(0)) {
        case '{': boundary(); cur.repOpen = true; eat(1); continue;
        case '}': boundary();   /* commit this bar first, then close on it */
                  if (bars.length) {
                    bars[bars.length - 1].repClose = true;
                    if (pendingRepCount > 1) {
                      bars[bars.length - 1].repCount = Math.min(8, pendingRepCount);
                      pendingRepCount = 0;
                    }
                  }
                  eat(1); continue;
        case '|': boundary(); eat(1); continue;
        case '[': boundary(); eat(1); continue;
        case ']': boundary();
                  if (bars.length) bars[bars.length - 1].double = true;
                  eat(1); continue;
        case 'Z': boundary(); eat(1); continue;
        case 'x': cur.cells++; cur.chords.push('%'); eat(1); continue;
        /* r stands in for the previous two measures, over this bar and the next */
        case 'r': pendingCopies.push(2, 2); eat(1); continue;
        case 'n': cur.cells++; cur.chords.push('N.C.'); eat(1); continue;
        case 'p': cur.cells++; eat(1); continue;      /* slash: previous chord holds */
        case 'U': eat(1); continue;
        case 'S': unsupported.segno = true; eat(1); continue;
        case 'Q': unsupported.coda  = true; eat(1); continue;
        case ',': eat(1); continue;
      }

      if ((m = s.match(CHORD))) {
        var text = m[0];
        if (text.charAt(0) === 'W') {
          text = lastChord ? lastChord + text.substring(1) : '';
        } else {
          lastChord = text.split('/')[0];
        }
        if (text) { cur.chords.push(text); cur.cells++; }
        eat(m[0].length);
        continue;
      }

      eat(1);   /* unknown character: skip it rather than stall */
    }

    boundary();

    /* trim leading and trailing bars that carry nothing */
    while (bars.length && isBlank(bars[0])) bars.shift();
    while (bars.length && isBlank(bars[bars.length - 1])) bars.pop();

    return { bars: bars, timeSig: timeSig, unsupported: Object.keys(unsupported) };
  }

  function blank() {
    return { chords: [], cells: 0, section: '', repOpen: false,
             repClose: false, repCount: 2, double: false };
  }

  function isBlank(b) {
    return !b.chords.length && !b.section && !b.repOpen && !b.repClose && !b.double;
  }

  function noteUnsupported(bag, comment) {
    var c = String(comment).toLowerCase();
    if (c.indexOf('d.c.') >= 0) bag['D.C.'] = true;
    else if (c.indexOf('d.s.') >= 0) bag['D.S.'] = true;
    else if (c.indexOf('fine') >= 0) bag.fine = true;
    else if (c.indexOf('coda') >= 0) bag.coda = true;
  }

  /* One song record from the =-separated field list. */
  function readSong(chunk) {
    var parts = chunk.split(/=+/).filter(function (x) { return x !== ''; });
    var f = { title: parts[0], composer: parts[1], style: parts[2], key: parts[3] };
    var music = null, bpm = null;

    /* the music field is the one carrying the magic prefix */
    for (var i = 4; i < parts.length; i++) {
      if (parts[i] && parts[i].indexOf(PREFIX) === 0) { music = parts[i]; break; }
    }
    /* tempo is the first plausible number after the music field */
    for (var k = i + 1; k < parts.length; k++) {
      var n = parseInt(parts[k], 10);
      if (n >= 30 && n <= 320) { bpm = n; break; }
    }
    if (!music) return null;

    var body = readBody(unscramble(music.substring(PREFIX.length)));

    return {
      title:    f.title || 'Untitled',
      composer: f.composer || '',
      style:    f.style || '',
      key:      f.key || '',
      tempo:    bpm,
      timeSig:  body.timeSig || '4/4',
      bars:     body.bars,
      unsupported: body.unsupported
    };
  }

  /* Pasted text -> {name, songs:[...]}. Accepts a bare or embedded URL. */
  function parse(text) {
    var m = String(text || '').match(/irealb:\/\/([^\s"']+)/);
    if (!m) return null;

    var decoded;
    try { decoded = decodeURIComponent(m[1]); }
    catch (e) { decoded = m[1]; }

    var chunks = decoded.split('===');
    var name = chunks.length > 1 ? chunks.pop() : undefined;
    var songs = [];
    for (var i = 0; i < chunks.length; i++) {
      var song = readSong(chunks[i]);
      if (song) songs.push(song);
    }
    return songs.length ? { name: name, songs: songs } : null;
  }

  /* Song record -> a chart this app can play. */
  function toChart(song) {
    var bars = song.bars.map(function (b) {
      var bar = global.Chart.newBar(global.Chart.parseBarInput(b.chords.join(' ')));
      bar.section  = b.section;
      bar.repOpen  = b.repOpen;
      bar.repClose = b.repClose;
      bar.double   = b.double;
      return bar;
    });
    if (!bars.length) bars = [global.Chart.newBar()];

    return global.Chart.sanitize({
      title:    song.title,
      composer: song.composer,
      style:    song.style,
      key:      song.key,
      tempo:    song.tempo || 120,
      timeSig:  song.timeSig,
      bars:     bars
    });
  }

  global.IReal = { parse: parse, toChart: toChart, unscramble: unscramble };
})(window);
