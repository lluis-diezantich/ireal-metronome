/* chords.js - turn chord text into lead-sheet markup.
 *
 * Accepts iReal Pro shorthand and plain spellings:
 *   C^7  Cmaj7  CM7   -> C triangle-7
 *   C-7  Cm7    Cmin7 -> C dash-7
 *   Ch7  Cm7b5        -> C half-diminished 7
 *   Co7  Cdim7        -> C diminished 7
 *   C7b9#11, F/A, Bb69, N.C., %
 *
 * Case matters where the convention does: M is major, m is minor.
 */
(function (global) {
  'use strict';

  var SHARP = '♯';   /* sharp */
  var FLAT  = '♭';   /* flat  */
  var TRI   = '△';   /* major seventh triangle */
  var HDIM  = 'ø';   /* half diminished */
  var DIM   = '°';   /* diminished */

  /* {p: pattern, ci: case-insensitive, q: quality glyph, e: extension} */
  var QUALITIES = [
    /* half diminished */
    { p: 'min7b5', ci: true,  q: HDIM, e: '7' },
    { p: 'm7b5',   ci: false, q: HDIM, e: '7' },
    { p: '-7b5',   ci: false, q: HDIM, e: '7' },
    { p: 'h7',     ci: false, q: HDIM, e: '7' },
    { p: 'h',      ci: false, q: HDIM, e: '7' },
    { p: HDIM + '7', ci: false, q: HDIM, e: '7' },
    { p: HDIM,     ci: false, q: HDIM, e: '7' },

    /* diminished */
    { p: 'dim7',   ci: true,  q: DIM, e: '7' },
    { p: 'dim',    ci: true,  q: DIM, e: ''  },
    { p: DIM + '7', ci: false, q: DIM, e: '7' },
    { p: DIM,      ci: false, q: DIM, e: ''  },
    { p: 'o7',     ci: false, q: DIM, e: '7' },
    { p: 'o',      ci: false, q: DIM, e: ''  },

    /* minor-major seventh */
    { p: 'minmaj7', ci: true,  q: '-', e: TRI + '7' },
    { p: 'mmaj7',   ci: true,  q: '-', e: TRI + '7' },
    { p: '-maj7',   ci: true,  q: '-', e: TRI + '7' },
    { p: 'm^7',     ci: false, q: '-', e: TRI + '7' },
    { p: '-^7',     ci: false, q: '-', e: TRI + '7' },

    /* minor */
    { p: 'min13', ci: true,  q: '-', e: '13'  },
    { p: 'min11', ci: true,  q: '-', e: '11'  },
    { p: 'min9',  ci: true,  q: '-', e: '9'   },
    { p: 'min7',  ci: true,  q: '-', e: '7'   },
    { p: 'min6',  ci: true,  q: '-', e: '6'   },
    { p: 'min',   ci: true,  q: '-', e: ''    },
    { p: 'm69',   ci: false, q: '-', e: '6/9' },
    { p: 'm13',   ci: false, q: '-', e: '13'  },
    { p: 'm11',   ci: false, q: '-', e: '11'  },
    { p: 'm9',    ci: false, q: '-', e: '9'   },
    { p: 'm7',    ci: false, q: '-', e: '7'   },
    { p: 'm6',    ci: false, q: '-', e: '6'   },
    { p: 'm',     ci: false, q: '-', e: ''    },
    { p: '-69',   ci: false, q: '-', e: '6/9' },
    { p: '-13',   ci: false, q: '-', e: '13'  },
    { p: '-11',   ci: false, q: '-', e: '11'  },
    { p: '-9',    ci: false, q: '-', e: '9'   },
    { p: '-7',    ci: false, q: '-', e: '7'   },
    { p: '-6',    ci: false, q: '-', e: '6'   },
    { p: '-',     ci: false, q: '-', e: ''    },

    /* major seventh family */
    { p: 'maj13', ci: true,  q: TRI, e: '13' },
    { p: 'maj9',  ci: true,  q: TRI, e: '9'  },
    { p: 'maj7',  ci: true,  q: TRI, e: '7'  },
    { p: 'ma7',   ci: true,  q: TRI, e: '7'  },
    { p: 'maj',   ci: true,  q: TRI, e: '7'  },
    { p: 'M13',   ci: false, q: TRI, e: '13' },
    { p: 'M9',    ci: false, q: TRI, e: '9'  },
    { p: 'M7',    ci: false, q: TRI, e: '7'  },
    { p: 'M',     ci: false, q: TRI, e: '7'  },
    { p: '^13',   ci: false, q: TRI, e: '13' },
    { p: '^9',    ci: false, q: TRI, e: '9'  },
    { p: '^7',    ci: false, q: TRI, e: '7'  },
    { p: '^',     ci: false, q: TRI, e: '7'  },
    { p: TRI + '7', ci: false, q: TRI, e: '7' },
    { p: TRI,     ci: false, q: TRI, e: '7'  },

    /* augmented */
    { p: 'aug', ci: true,  q: '+', e: '' },
    { p: '+',   ci: false, q: '+', e: '' },

    /* suspensions, altered, plain extensions */
    { p: '13sus4', ci: true, q: '', e: '13sus4' },
    { p: '9sus4',  ci: true, q: '', e: '9sus4'  },
    { p: '7sus4',  ci: true, q: '', e: '7sus4'  },
    { p: '7sus',   ci: true, q: '', e: '7sus4'  },
    { p: 'sus4',   ci: true, q: '', e: 'sus4'   },
    { p: 'sus2',   ci: true, q: '', e: 'sus2'   },
    { p: 'sus',    ci: true, q: '', e: 'sus4'   },
    { p: '7alt',   ci: true, q: '', e: '7alt'   },
    { p: 'alt',    ci: true, q: '', e: '7alt'   },
    { p: '6/9',    ci: false, q: '', e: '6/9'   },
    { p: '69',     ci: false, q: '', e: '6/9'   },
    { p: '13',     ci: false, q: '', e: '13'    },
    { p: '11',     ci: false, q: '', e: '11'    },
    { p: '9',      ci: false, q: '', e: '9'     },
    { p: '7',      ci: false, q: '', e: '7'     },
    { p: '6',      ci: false, q: '', e: '6'     },
    { p: '5',      ci: false, q: '', e: '5'     },
    { p: '4',      ci: false, q: '', e: 'sus4'  },
    { p: '2',      ci: false, q: '', e: '2'     }
  ].sort(function (a, b) { return b.p.length - a.p.length; });

  var ALT_TOKEN = /^(?:[#b♯♭+](?:5|9|11|13)|add9|add11|add13|omit3|no3|no5)/i;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function prettyAcc(s) {
    return s.replace(/#/g, SHARP).replace(/b/g, FLAT);
  }

  function matchQuality(rest) {
    for (var i = 0; i < QUALITIES.length; i++) {
      var cand = QUALITIES[i];
      var head = rest.slice(0, cand.p.length);
      var hit = cand.ci ? head.toLowerCase() === cand.p.toLowerCase() : head === cand.p;
      if (hit) return { spec: cand, rest: rest.slice(cand.p.length) };
    }
    return null;
  }

  /* Pull alteration tokens off the tail: b9, #11, add9, ... */
  function eatAlterations(rest) {
    var alts = [];
    var s = rest.replace(/[()\s]/g, '');
    while (s.length) {
      var m = s.match(ALT_TOKEN);
      if (!m) break;
      alts.push(prettyAcc(m[0].replace(/^\+/, SHARP)));
      s = s.slice(m[0].length);
    }
    return { alts: alts, leftover: s };
  }

  /* text -> {root, acc, qual, ext, alts[], bass, special, raw, ok} */
  function parse(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    if (raw === '%' || raw === 'x') return { special: 'pct', raw: raw };
    if (/^(n\.?c\.?|nc)$/i.test(raw)) return { special: 'nc', raw: raw };

    var body = raw, bass = '';
    var slash = raw.lastIndexOf('/');
    if (slash > 0) {
      var tail = raw.slice(slash + 1);
      if (/^[A-Ga-g][#b♯♭]?$/.test(tail)) {
        body = raw.slice(0, slash);
        bass = tail.charAt(0).toUpperCase() + prettyAcc(tail.slice(1));
      }
    }

    var rm = body.match(/^([A-Ga-g])([#b♯♭]?)/);
    if (!rm) return { special: 'raw', raw: raw };

    var rest = body.slice(rm[0].length);
    var q = matchQuality(rest);
    var qual = '', ext = '';
    if (q) { qual = q.spec.q; ext = q.spec.e; rest = q.rest; }

    var a = eatAlterations(rest);

    return {
      root: rm[1].toUpperCase(),
      acc:  prettyAcc(rm[2]),
      qual: qual,
      ext:  ext,
      alts: a.alts,
      tail: a.leftover,
      bass: bass,
      raw:  raw
    };
  }

  /* text -> HTML string for one chord symbol */
  function render(text, extraClass) {
    var c = parse(text);
    var cls = 'chord' + (extraClass ? ' ' + extraClass : '');
    if (!c) return '';

    if (c.special === 'pct') return '<span class="' + cls + ' pct">%</span>';
    if (c.special === 'nc')  return '<span class="' + cls + ' nc">N.C.</span>';
    if (c.special === 'raw') return '<span class="' + cls + '">' + esc(c.raw) + '</span>';

    var out = '<span class="' + cls + '">' + c.root;
    if (c.acc) {
      out += '<span class="acc' + (c.acc === SHARP ? ' sharp' : '') + '">' + c.acc + '</span>';
    }

    var sup = c.qual + c.ext;
    if (sup) out += '<span class="q">' + sup + '</span>';

    if (c.alts.length) {
      out += '<span class="alts">';
      for (var i = 0; i < c.alts.length && i < 3; i++) out += '<span>' + c.alts[i] + '</span>';
      out += '</span>';
    }
    if (c.tail) out += '<span class="q">' + esc(c.tail) + '</span>';
    if (c.bass) {
      out += '<span class="bass">/' +
             c.bass.replace(SHARP, '<span class="sharp">' + SHARP + '</span>') + '</span>';
    }

    return out + '</span>';
  }

  global.Chords = { parse: parse, render: render, esc: esc };
})(window);
