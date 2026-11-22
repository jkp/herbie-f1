// Replay buffer: the last few seconds of every car's position, for TV-style action replays.
export interface Frame { x: number; z: number; heading: number; steer: number; s: number; on: boolean }
const F = 6; // floats per car per frame

export function makeReplay(cars: number, seconds = 40, hz = 30) {
  const size = Math.ceil(seconds * hz), data = new Float32Array(size * cars * F), times = new Float64Array(size);
  let count = 0, head = 0; // frames held, and where the next one goes
  const at = (k: number) => (head - count + k + size) % size; // the k-th oldest frame's slot
  const read = (slot: number, car: number) => {
    const o = (slot * cars + car) * F;
    return { x: data[o], z: data[o + 1], heading: data[o + 2], steer: data[o + 3], s: data[o + 4], on: data[o + 5] > 0 };
  };
  return {
    get from() { return count ? times[at(0)] : 0; },
    get to() { return count ? times[at(count - 1)] : 0; },
    record(time: number, frame: Frame[]) {
      if (count && time - times[at(count - 1)] < 1 / hz - 1e-9) return;
      times[head] = time;
      frame.forEach((f, car) => data.set([f.x, f.z, f.heading, f.steer, f.s, f.on ? 1 : 0], (head * cars + car) * F));
      head = (head + 1) % size; count = Math.min(size, count + 1);
    },
    clear() { count = 0; head = 0; },
    /** Car `car` at `time`, between the frames either side of it. */
    sample(time: number, car: number): Frame {
      let lo = 0, hi = count - 1;
      if (time <= times[at(0)]) return read(at(0), car);
      if (time >= times[at(hi)]) return read(at(hi), car);
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[at(m)] <= time) lo = m; else hi = m; }
      const a = read(at(lo), car), b = read(at(hi), car), k = (time - times[at(lo)]) / (times[at(hi)] - times[at(lo)]);
      const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
      // across the start line s jumps back to zero: don't sweep through the whole lap
      const ds = Math.abs(b.s - a.s) > 1000 ? 0 : b.s - a.s;
      return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, heading: a.heading + dh * k, steer: a.steer + (b.steer - a.steer) * k, s: a.s + ds * k, on: a.on };
    },
  };
}
export type Replay = ReturnType<typeof makeReplay>;
