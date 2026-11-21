/** Moments (seconds from the start of the pit stop cutscene) of a realistic stop lasting `stop` seconds stationary. */
export function pitTimeline(stop: number) {
  const arrive = 1.8, go = arrive + stop;
  return {
    arrive,                       // car stops on its marks
    jackUp: arrive + 0.15,        // front and rear jacks lift it
    wheelsOff: arrive + 0.45,     // guns undo the nuts, old wheels come off
    wheelsOn: go - 0.55,          // new wheels on and tightened
    jackDown: go - 0.2,           // car dropped
    go,                           // release light goes green
    end: go + 1.8,                // car out of shot down the pit lane
  };
}
