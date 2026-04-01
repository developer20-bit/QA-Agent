import { useEffect, useState } from "react";

/** Live elapsed ms from an ISO start time; updates every second while `active`. */
export function useElapsedMs(startedAtIso: string | undefined, active: boolean): number {
  const [ms, setMs] = useState(0);

  useEffect(() => {
    if (!startedAtIso || !active) {
      setMs(0);
      return;
    }
    const start = new Date(startedAtIso).getTime();
    if (Number.isNaN(start)) {
      setMs(0);
      return;
    }
    const tick = () => setMs(Math.max(0, Date.now() - start));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAtIso, active]);

  return ms;
}
