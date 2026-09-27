/* audio.js - Web Audio click with lookahead scheduling.
 *
 * Beats are scheduled ahead of time against the audio clock, never with
 * setTimeout, so the click does not drift. A 25 ms interval fills a 100 ms
 * window; the UI reads the same queue to move the playhead in sync.
 */
(function (global) {
  'use strict';

  var LOOKAHEAD = 0.10;   /* seconds of audio scheduled in advance */
  var TICK_MS   = 25;     /* how often we top the schedule up      */

  function Metronome() {
    this.ctx = null;
    this.master = null;
    this.running = false;
    this.queue = [];        /* {step, time} pending visual events */
    this.timer = null;

    this.playOrder = [0];
    this.pos = 0;           /* index into playOrder */
    this.beat = 0;          /* beat within the current bar */
    this.countIn = 0;       /* count-in beats left */
    this.countInTotal = 0;
    this.nextTime = 0;
    this.stopAt = 0;
    this.finishing = false;

    /* host supplies these */
    this.getBpm = function () { return 120; };
    this.getBeatsPerBar = function () { return 4; };
    this.onPassEnd = null;  /* -> truthy to keep looping */
    this.onStop = null;
  }

  Metronome.prototype._ensureCtx = function () {
    if (!this.ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  };

  Metronome.prototype.setVolume = function (v) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
    this._vol = v;
  };

  Metronome.prototype._click = function (t, accent) {
    var ctx = this.ctx;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();

    osc.type = 'square';
    osc.frequency.value = accent ? 1560 : 990;

    var peak = accent ? 0.42 : 0.24;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (accent ? 0.055 : 0.040));

    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.07);
  };

  Metronome.prototype._step = function () {
    if (this.countIn > 0) {
      var bpb = this.getBeatsPerBar();
      var done = this.countInTotal - this.countIn;
      return { countIn: true, barIndex: -1, beat: done % bpb, pos: -1,
               remaining: Math.ceil(this.countIn / bpb) };
    }
    return {
      countIn: false,
      pos: this.pos,
      barIndex: this.playOrder[this.pos],
      beat: this.beat
    };
  };

  /* Move to the next beat. Returns false when playback should end. */
  Metronome.prototype._advance = function () {
    if (this.countIn > 0) {
      this.countIn--;
      if (this.countIn === 0) { this.beat = 0; this.pos = 0; }
      return true;
    }

    this.beat++;
    if (this.beat >= this.getBeatsPerBar()) {
      this.beat = 0;
      this.pos++;
      if (this.pos >= this.playOrder.length) {
        var again = this.onPassEnd ? this.onPassEnd() : false;
        if (!again) return false;
        this.pos = 0;
      }
    }
    return true;
  };

  Metronome.prototype._tick = function () {
    var ctx = this.ctx;

    if (this.finishing) {
      if (ctx.currentTime >= this.stopAt) this.stop();
      return;
    }

    var horizon = ctx.currentTime + LOOKAHEAD;
    var guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      var step = this._step();
      this._click(this.nextTime, step.beat === 0);
      this.queue.push({ step: step, time: this.nextTime });

      var bpm = Math.max(20, Math.min(400, this.getBpm()));
      this.nextTime += 60 / bpm;

      if (!this._advance()) {
        this.finishing = true;
        this.stopAt = this.nextTime + 0.15;
        break;
      }
    }
  };

  Metronome.prototype.start = function (playOrder, countInBars) {
    if (this.running) return true;
    if (!this._ensureCtx()) return false;
    if (typeof this._vol === 'number') this.setVolume(this._vol);

    this.playOrder = (playOrder && playOrder.length) ? playOrder : [0];
    this.pos = 0;
    this.beat = 0;
    this.countInTotal = (countInBars || 0) * this.getBeatsPerBar();
    this.countIn = this.countInTotal;
    this.queue.length = 0;
    this.finishing = false;
    this.running = true;
    this.nextTime = this.ctx.currentTime + 0.12;

    var self = this;
    this._tick();
    this.timer = setInterval(function () { self._tick(); }, TICK_MS);
    return true;
  };

  Metronome.prototype.stop = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
    this.finishing = false;
    this.queue.length = 0;
    if (this.onStop) this.onStop();
  };

  Metronome.prototype.toggle = function (playOrder, countInBars) {
    if (this.running) { this.stop(); return false; }
    return this.start(playOrder, countInBars);
  };

  /* Newest beat whose scheduled time has arrived, or null. */
  Metronome.prototype.current = function () {
    if (!this.ctx) return null;
    var now = this.ctx.currentTime;
    var last = null;
    while (this.queue.length && this.queue[0].time <= now) last = this.queue.shift();
    return last ? last.step : null;
  };

  global.Metronome = Metronome;
})(window);
