/**
 * Acoustic-feedback ("screech") detector, fed one analyser frame at a time.
 *
 * Feedback is a single, very steady, loud tone. Speech, laughter and music are spread over
 * many harmonics and their pitch moves, so a frame only counts when ALL of these hold:
 *   - loud input (RMS above LOUD_DB),
 *   - one narrow peak (+-2 FFT bins) holding most of the energy (TONAL_SHARE),
 *   - the peak on the same frequency (+-1 bin) as the previous frame.
 * HOLD_MS of consecutive such frames trips it.
 */
export const SCREECH = {
  TICK_MS: 50,
  HOLD_MS: 500,
  LOUD_DB: -24, // dBFS RMS (measured after the browser's own noise suppression)
  TONAL_SHARE: 0.75,
  MIN_HZ: 400,
  MAX_HZ: 5000,
  COOLDOWN_MS: 5000,
};

export class ScreechDetector {
  private streak = 0;
  private lastBin = -1;
  private quietUntil = 0;
  private readonly lo: number;
  private readonly hi: number;
  private readonly bins: number;

  constructor(sampleRate: number, bins: number) {
    this.bins = bins;
    const binHz = sampleRate / (bins * 2);
    this.lo = Math.max(3, Math.floor(SCREECH.MIN_HZ / binHz));
    this.hi = Math.min(bins - 3, Math.ceil(SCREECH.MAX_HZ / binHz));
  }

  /** time: samples in [-1, 1]; freqDb: analyser.getFloatFrequencyData output. True = screech. */
  frame(time: Float32Array, freqDb: Float32Array, now: number): boolean {
    let sum = 0;
    for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
    if (10 * Math.log10(sum / time.length + 1e-12) < SCREECH.LOUD_DB) {
      this.streak = 0;
      this.lastBin = -1;
      return false;
    }
    let total = 0;
    let peak = -1;
    let peakP = 0;
    for (let i = 2; i < this.bins; i++) {
      const p = Math.pow(10, freqDb[i] / 10);
      total += p;
      if (i >= this.lo && i <= this.hi && p > peakP) {
        peakP = p;
        peak = i;
      }
    }
    if (peak < 0 || total <= 0) return false;
    let near = 0;
    for (let j = peak - 2; j <= peak + 2; j++) near += Math.pow(10, freqDb[j] / 10);
    const tonal = near / total >= SCREECH.TONAL_SHARE;
    const steady = this.lastBin >= 0 && Math.abs(peak - this.lastBin) <= 1;
    this.lastBin = peak;
    this.streak = tonal ? (steady ? this.streak + 1 : 1) : 0;
    if (this.streak * SCREECH.TICK_MS >= SCREECH.HOLD_MS && now > this.quietUntil) {
      this.streak = 0;
      this.quietUntil = now + SCREECH.COOLDOWN_MS;
      return true;
    }
    return false;
  }
}
