"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up to its value the first time it is seen.
 *
 * The page is sent with the real value in it, so a reader without JavaScript,
 * a search engine and a visitor who asked for less motion all get the number
 * itself. The counting is decoration on top of that.
 */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const element = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const node = element.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / duration);
          // Fast at first, settling at the end, so the last digits are easy to read as they land.
          setShown(Math.round(value * (1 - (1 - progress) ** 3)));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return (
    <span ref={element} className="tabular-nums">
      {shown}
    </span>
  );
}
